-- ============================================================
-- 店家寄賣草稿 = 真實來源訂單（v1.4）
-- 目的：讓「所有訂單」將 send_to_store 草稿寄賣單以真實訂單呈現
--   （可勾選、可轉處理中/轉出貨池、商品模式看得到數量、可編輯）
-- 1. consignment_order_items 加 order_item_id 連結鏡像 order_items
-- 2. 重寫 create_consignment_shipment_layer：
--    依 order_item_id 重用既有寄賣品項，不再重複建列
-- 3. 重寫 create_consignment_shipment：
--    重用既有 source order / order_items（標 shipped），僅 legacy 才補建
-- 4. Backfill：既有 send_to_store 草稿補 source order(pending)+items(waiting)；
--    非草稿依 product/variant 補連結 order_item_id
-- ============================================================

-- ============================================================
-- 1. 連結欄位
-- ============================================================
ALTER TABLE public.consignment_order_items
  ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES public.order_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coi_order_item ON public.consignment_order_items(order_item_id);

-- ============================================================
-- 2. 重寫 create_consignment_shipment_layer
--    出貨池/轉寄賣路徑：找到既有寄賣單時，依 order_item_id
--    重用既有寄賣品項（草稿建立時已預先建立），不再重複建列
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_consignment_shipment_layer(
  p_order_items JSONB,
  p_warehouse_id UUID,
  p_created_by UUID
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_rec JSONB;
  v_order_item_id UUID;
  v_qty INTEGER;
  v_oi RECORD;
  v_co_id UUID;
  v_coi_id UUID;
BEGIN
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_order_items)
  LOOP
    v_order_item_id := (v_rec->>'order_item_id')::UUID;
    v_qty := (v_rec->>'quantity')::INTEGER;
    CONTINUE WHEN v_qty IS NULL OR v_qty <= 0;

    SELECT oi.product_id, oi.variant_id, oi.unit_price, oi.store_id, oi.order_id,
           o.code AS order_code
    INTO v_oi
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = v_order_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_item 不存在：%', v_order_item_id;
    END IF;

    SELECT id INTO v_co_id FROM public.consignment_orders
    WHERE direction = 'send_to_store'
      AND store_id = v_oi.store_id
      AND source_order_id = v_oi.order_id
      AND status IN ('draft', 'active')
    LIMIT 1;

    IF v_co_id IS NULL THEN
      INSERT INTO public.consignment_orders (direction, store_id, status, created_by, source_order_id)
      VALUES ('send_to_store', v_oi.store_id, 'active', p_created_by, v_oi.order_id)
      RETURNING id INTO v_co_id;
    ELSE
      UPDATE public.consignment_orders
      SET status = 'active', updated_at = NOW()
      WHERE id = v_co_id AND status = 'draft';
    END IF;

    -- 重用既有寄賣品項（草稿建立時已預先建立並連結 order_item_id）
    SELECT id INTO v_coi_id FROM public.consignment_order_items
    WHERE consignment_order_id = v_co_id
      AND order_item_id = v_order_item_id
    LIMIT 1;

    IF v_coi_id IS NULL THEN
      INSERT INTO public.consignment_order_items (
        consignment_order_id, order_item_id, product_id, variant_id,
        quantity, unit_price, unit_cost
      )
      VALUES (
        v_co_id, v_order_item_id, v_oi.product_id, v_oi.variant_id,
        v_qty, v_oi.unit_price, 0
      )
      RETURNING id INTO v_coi_id;
    END IF;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_oi.product_id, v_oi.variant_id, p_warehouse_id, -v_qty, 'consignment_out_shipment',
      v_co_id, v_coi_id, v_oi.order_code, 'store_consignment', p_created_by
    );
  END LOOP;
END;
$$;

-- ============================================================
-- 3. 重寫 create_consignment_shipment（獨立寄賣單出貨）
--    優先重用既有 source order / order_items；僅 legacy 才補建
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_consignment_shipment(
  p_consignment_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_order_id UUID;
  v_order_code TEXT;
  v_item RECORD;
  v_ship_qty INTEGER;
  v_oi_id UUID;
  v_oi_qty INTEGER;
  v_oi_shipped INTEGER;
  v_own_wh UUID;
  v_result JSONB;
BEGIN
  SELECT * INTO v_order FROM public.consignment_orders WHERE id = p_consignment_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣單不存在';
  END IF;
  IF v_order.direction <> 'send_to_store' THEN
    RAISE EXCEPTION '此寄賣單非店家方向，無法出貨';
  END IF;
  IF v_order.status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION '寄賣單狀態不允許出貨';
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  IF v_own_wh IS NULL THEN
    RAISE EXCEPTION '找不到自有倉庫';
  END IF;

  -- 來源訂單：優先重用既有（草稿建立時已建），僅 legacy 才補建
  IF v_order.source_order_id IS NULL THEN
    INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode)
    VALUES (v_order.store_id, p_created_by, COALESCE(p_notes, v_order.note), 'consignment', 'shipped', true)
    RETURNING id, code INTO v_order_id, v_order_code;

    UPDATE public.consignment_orders
    SET source_order_id = v_order_id, updated_at = NOW()
    WHERE id = p_consignment_order_id;
  ELSE
    SELECT id, code INTO v_order_id, v_order_code
    FROM public.orders WHERE id = v_order.source_order_id;
  END IF;

  FOR v_item IN
    SELECT coi.id AS consignment_order_item_id, coi.order_item_id,
           coi.product_id, coi.variant_id, coi.unit_price,
           s.order_quantity - s.shipped_quantity AS remaining
    FROM public.consignment_order_item_summary s
    JOIN public.consignment_order_items coi ON coi.id = s.consignment_order_item_id
    WHERE s.consignment_order_id = p_consignment_order_id
  LOOP
    v_ship_qty := v_item.remaining;
    CONTINUE WHEN v_ship_qty IS NULL OR v_ship_qty <= 0;

    -- 重用既有 order_item；無則補建並回填連結
    v_oi_id := v_item.order_item_id;
    IF v_oi_id IS NOT NULL THEN
      SELECT quantity, shipped_quantity INTO v_oi_qty, v_oi_shipped
      FROM public.order_items WHERE id = v_oi_id;
      IF NOT FOUND THEN
        v_oi_id := NULL;
      END IF;
    END IF;

    IF v_oi_id IS NULL THEN
      INSERT INTO public.order_items (
        order_id, product_id, variant_id, store_id,
        quantity, unit_price, shipped_quantity, status
      )
      VALUES (
        v_order_id, v_item.product_id, v_item.variant_id, v_order.store_id,
        v_ship_qty, v_item.unit_price, v_ship_qty, 'shipped'
      )
      RETURNING id INTO v_oi_id;

      UPDATE public.consignment_order_items
      SET order_item_id = v_oi_id
      WHERE id = v_item.consignment_order_item_id;
    ELSE
      UPDATE public.order_items
      SET shipped_quantity = v_oi_shipped + v_ship_qty,
          status = CASE WHEN v_oi_shipped + v_ship_qty >= v_oi_qty THEN 'shipped' ELSE 'partial' END,
          updated_at = NOW()
      WHERE id = v_oi_id;
    END IF;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_item.product_id, v_item.variant_id, v_own_wh, -v_ship_qty, 'consignment_out_shipment',
      p_consignment_order_id, v_item.consignment_order_item_id,
      v_order_code, 'store_consignment', p_created_by
    );
  END LOOP;

  UPDATE public.consignment_orders
  SET status = 'active', updated_at = NOW()
  WHERE id = p_consignment_order_id AND status = 'draft';

  UPDATE public.orders
  SET status = 'shipped', updated_at = NOW()
  WHERE id = v_order_id AND status IN ('pending', 'processing');

  v_result := jsonb_build_object(
    'consignment_order_id', p_consignment_order_id,
    'order_id', v_order_id,
    'order_code', v_order_code
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- 4. Backfill
--    A. send_to_store 草稿：補 source order(pending) + items(waiting) + 連結
--    B. send_to_store 非草稿：依 product/variant 補連結既有 order_items
-- ============================================================
DO $$
DECLARE
  v_rec RECORD;
  v_item RECORD;
  v_order_id UUID;
  v_oi_id UUID;
  v_fallback_user UUID;
BEGIN
  SELECT id INTO v_fallback_user FROM auth.users ORDER BY created_at ASC LIMIT 1;
  IF v_fallback_user IS NULL THEN
    RAISE EXCEPTION '找不到可用使用者（auth.users 為空）';
  END IF;

  FOR v_rec IN
    SELECT co.id, co.store_id, co.note, COALESCE(co.created_by, v_fallback_user) AS created_by
    FROM public.consignment_orders co
    WHERE co.direction = 'send_to_store'
      AND co.status = 'draft'
      AND co.source_order_id IS NULL
  LOOP
    INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode)
    VALUES (v_rec.store_id, v_rec.created_by, v_rec.note, 'consignment', 'pending', true)
    RETURNING id INTO v_order_id;

    UPDATE public.consignment_orders
    SET source_order_id = v_order_id, updated_at = NOW()
    WHERE id = v_rec.id;

    FOR v_item IN
      SELECT coi.id AS coi_id, coi.product_id, coi.variant_id, coi.quantity, coi.unit_price
      FROM public.consignment_order_items coi
      WHERE coi.consignment_order_id = v_rec.id
      ORDER BY coi.created_at ASC, coi.id ASC
    LOOP
      INSERT INTO public.order_items (
        order_id, product_id, variant_id, store_id,
        quantity, unit_price, shipped_quantity, status
      )
      VALUES (
        v_order_id, v_item.product_id, v_item.variant_id, v_rec.store_id,
        v_item.quantity, v_item.unit_price, 0, 'waiting'
      )
      RETURNING id INTO v_oi_id;

      UPDATE public.consignment_order_items
      SET order_item_id = v_oi_id
      WHERE id = v_item.coi_id;
    END LOOP;
  END LOOP;

  FOR v_item IN
    SELECT coi.id AS coi_id, oi.id AS oi_id
    FROM public.consignment_order_items coi
    JOIN public.consignment_orders co ON co.id = coi.consignment_order_id
    JOIN public.order_items oi ON oi.order_id = co.source_order_id
    WHERE co.direction = 'send_to_store'
      AND co.status IN ('active', 'settled')
      AND co.source_order_id IS NOT NULL
      AND coi.order_item_id IS NULL
      AND oi.product_id = coi.product_id
      AND oi.variant_id IS NOT DISTINCT FROM coi.variant_id
  LOOP
    UPDATE public.consignment_order_items
    SET order_item_id = v_item.oi_id
    WHERE id = v_item.coi_id AND order_item_id IS NULL;
  END LOOP;
END $$;
