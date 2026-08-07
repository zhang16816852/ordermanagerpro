-- ============================================================
-- 寄賣出貨回滾（v1.4.1）
-- 目的：店家寄賣（send_to_store）出貨後、店家確認收貨前，
--   若打錯品項/打錯單，可整單回滾：
--   1. 補 consignment_shipment_reversal movement（+qty 回自有倉）
--   2. 來源 order_items.shipped_quantity 扣回、狀態重算
--   3. 品項放回出貨池（有列累加、無列新增）
--   4. 寄賣單回 draft、來源訂單降 processing（全數回滾時）
-- 守門：僅 active + 未確認收貨 + 無已售 / 無待審核銷售回報
-- ============================================================

-- ============================================================
-- 1. 修正 consignment_order_item_summary
--    shipped_quantity 需扣除 consignment_shipment_reversal，
--    否則回滾後重新出貨會把 shipped 重複計算
-- ============================================================
CREATE OR REPLACE VIEW public.consignment_order_item_summary AS
SELECT
  coi.id AS consignment_order_item_id,
  coi.consignment_order_id,
  co.direction,
  coi.product_id,
  coi.variant_id,
  coi.quantity AS order_quantity,
  coi.unit_price,
  coi.unit_cost,
  COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_in_receipt'), 0) AS received_quantity,
  COALESCE(-SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_out_shipment'), 0)
    - COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_shipment_reversal'), 0) AS shipped_quantity,
  COALESCE(-SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_in_return'), 0) AS returned_to_supplier,
  COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_out_return'), 0) AS returned_from_store,
  COALESCE(SUM(cs.quantity) FILTER (WHERE NOT cs.reversed), 0) AS sold_quantity,
  CASE
    WHEN co.direction = 'receive_from_supplier' THEN
      COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_in_receipt'), 0)
      - COALESCE(SUM(cs.quantity) FILTER (WHERE NOT cs.reversed), 0)
      - COALESCE(-SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_in_return'), 0)
    ELSE
      COALESCE(-SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_out_shipment'), 0)
        - COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_shipment_reversal'), 0)
        - COALESCE(SUM(cs.quantity) FILTER (WHERE NOT cs.reversed), 0)
        - COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_out_return'), 0)
  END AS remaining_quantity
FROM public.consignment_order_items coi
JOIN public.consignment_orders co ON co.id = coi.consignment_order_id
LEFT JOIN public.inventory_movements im ON im.consignment_order_item_id = coi.id
LEFT JOIN public.consignment_sales cs ON cs.consignment_order_item_id = coi.id
GROUP BY coi.id, co.direction;

COMMENT ON VIEW public.consignment_order_item_summary IS
  '寄賣單品項統計視圖：收貨/出貨/銷售/退回/剩餘數量皆由此計算，不落庫避免不同步';

-- ============================================================
-- 2. 新 RPC：reverse_consignment_shipment（整單回滾出貨）
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_consignment_shipment(
  p_consignment_order_id UUID,
  p_created_by UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_own_wh UUID;
  v_reverse_qty INTEGER;
  v_oi_id UUID;
  v_oi_shipped INTEGER;
  v_oi_qty INTEGER;
  v_new_shipped INTEGER;
  v_pool_quantity INTEGER;
  v_reversed_items INTEGER := 0;
  v_reversed_quantity INTEGER := 0;
  v_result JSONB;
BEGIN
  SELECT * INTO v_order FROM public.consignment_orders WHERE id = p_consignment_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣單不存在';
  END IF;
  IF v_order.direction <> 'send_to_store' THEN
    RAISE EXCEPTION '僅店家方向寄賣單可回滾出貨';
  END IF;
  IF v_order.status <> 'active' THEN
    RAISE EXCEPTION '僅進行中的寄賣單可回滾出貨';
  END IF;
  IF v_order.received_at IS NOT NULL THEN
    RAISE EXCEPTION '店家已確認收貨，請改用「退回」流程';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.consignment_sales
    WHERE consignment_order_id = p_consignment_order_id AND NOT reversed
  ) THEN
    RAISE EXCEPTION '已有已售出紀錄，無法回滾出貨';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.consignment_sales_reports
    WHERE consignment_order_id = p_consignment_order_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION '尚有待審核的銷售回報，無法回滾出貨';
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  IF v_own_wh IS NULL THEN
    RAISE EXCEPTION '找不到自有倉庫';
  END IF;

  FOR v_item IN
    SELECT s.consignment_order_item_id AS coi_id,
           s.shipped_quantity,
           coi.order_item_id,
           coi.product_id,
           coi.variant_id
    FROM public.consignment_order_item_summary s
    JOIN public.consignment_order_items coi ON coi.id = s.consignment_order_item_id
    WHERE s.consignment_order_id = p_consignment_order_id
      AND s.shipped_quantity > 0
  LOOP
    v_reverse_qty := v_item.shipped_quantity;

    -- 1) 回補自有倉庫（consignment_shipment_reversal，+qty）
    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_item.product_id, v_item.variant_id, v_own_wh, v_reverse_qty,
      'consignment_shipment_reversal',
      p_consignment_order_id, v_item.coi_id,
      v_order.code, 'store_consignment', p_created_by
    );

    -- 2) 來源 order_items：優先既有連結，legacy 依 product/variant 補找
    v_oi_id := v_item.order_item_id;
    IF v_oi_id IS NULL AND v_order.source_order_id IS NOT NULL THEN
      SELECT oi.id INTO v_oi_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order.source_order_id
        AND oi.product_id = v_item.product_id
        AND oi.variant_id IS NOT DISTINCT FROM v_item.variant_id
      LIMIT 1;
    END IF;

    IF v_oi_id IS NOT NULL THEN
      SELECT quantity, shipped_quantity INTO v_oi_qty, v_oi_shipped
      FROM public.order_items WHERE id = v_oi_id;
      IF FOUND THEN
        v_new_shipped := GREATEST(0, v_oi_shipped - v_reverse_qty);
        UPDATE public.order_items
        SET shipped_quantity = v_new_shipped,
            status = CASE
                       WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                       WHEN v_new_shipped < v_oi_qty THEN 'partial'::order_item_status
                       ELSE 'shipped'::order_item_status
                     END,
            updated_at = NOW()
        WHERE id = v_oi_id;

        -- 3) 放回出貨池（有列累加、無列新增）
        SELECT quantity INTO v_pool_quantity
        FROM public.shipping_pool WHERE order_item_id = v_oi_id;
        IF FOUND THEN
          UPDATE public.shipping_pool
          SET quantity = v_pool_quantity + v_reverse_qty
          WHERE order_item_id = v_oi_id;
        ELSE
          INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
          SELECT v_oi_id, v_reverse_qty, o.store_id, o.created_by
          FROM public.orders o WHERE o.id = v_order.source_order_id;
        END IF;
      END IF;
    END IF;

    v_reversed_items := v_reversed_items + 1;
    v_reversed_quantity := v_reversed_quantity + v_reverse_qty;
  END LOOP;

  IF v_reversed_items = 0 THEN
    RAISE EXCEPTION '此寄賣單沒有可回滾的出貨紀錄';
  END IF;

  -- 4) 寄賣單回草稿；來源訂單全數回滾時降 processing
  UPDATE public.consignment_orders
  SET status = 'draft', updated_at = NOW()
  WHERE id = p_consignment_order_id;

  IF v_order.source_order_id IS NOT NULL THEN
    UPDATE public.orders
    SET status = 'processing', updated_at = NOW()
    WHERE id = v_order.source_order_id
      AND status = 'shipped'
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi2
        WHERE oi2.order_id = v_order.source_order_id
          AND (oi2.shipped_quantity > 0 OR oi2.status IN ('shipped', 'partial'))
      );
  END IF;

  v_result := jsonb_build_object(
    'consignment_order_id', p_consignment_order_id,
    'source_order_id', v_order.source_order_id,
    'reversed_items', v_reversed_items,
    'reversed_quantity', v_reversed_quantity
  );

  RETURN v_result;
END;
$$;

-- RLS 不可直接保護 SECURITY DEFINER 內的資料表操作；RPC 本身以
-- has_role(admin) 於前端側控管，與既有 create_consignment_shipment 等一致。
