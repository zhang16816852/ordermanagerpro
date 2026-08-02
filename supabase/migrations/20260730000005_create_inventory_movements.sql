-- 庫存交易明細表：記錄每一筆 +/- 的來源
-- 並修改既有 RPC 寫入明細，新增 adjust_inventory RPC

-- ============================================================
-- 1. 建立 inventory_movements 交易明細表
-- ============================================================

CREATE TABLE public.inventory_movements (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id      UUID NOT NULL REFERENCES public.products(id),
    variant_id      UUID REFERENCES public.product_variants(id),
    quantity_change INTEGER NOT NULL,
    balance_after   INTEGER NOT NULL,
    source_type     TEXT NOT NULL CHECK (source_type IN ('purchase_receipt', 'sales_shipment', 'sales_note_deletion', 'manual_adjustment')),
    source_id       UUID,
    reference_code  TEXT,
    note            TEXT,
    created_by      UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inv_movements_product ON public.inventory_movements(product_id, variant_id);
CREATE INDEX idx_inv_movements_source ON public.inventory_movements(source_type, source_id);
CREATE INDEX idx_inv_movements_created ON public.inventory_movements(created_at DESC);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_view_inventory_movements" ON public.inventory_movements
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admins_manage_inventory_movements" ON public.inventory_movements
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

-- ============================================================
-- 2. 新增 RPC：手動調整庫存（原子操作，同時寫入明細）
-- ============================================================

CREATE OR REPLACE FUNCTION public.adjust_inventory(
    p_id UUID,
    p_new_quantity INTEGER,
    p_created_by UUID,
    p_note TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_old_quantity INTEGER;
    v_product_id UUID;
    v_variant_id UUID;
    v_diff INTEGER;
BEGIN
    SELECT quantity, product_id, variant_id
    INTO v_old_quantity, v_product_id, v_variant_id
    FROM public.product_inventory
    WHERE id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '庫存記錄不存在';
    END IF;

    v_diff := p_new_quantity - v_old_quantity;

    UPDATE public.product_inventory
    SET quantity = p_new_quantity, updated_at = NOW()
    WHERE id = p_id;

    INSERT INTO public.inventory_movements (product_id, variant_id, quantity_change, balance_after, source_type, note, created_by)
    VALUES (v_product_id, v_variant_id, v_diff, p_new_quantity, 'manual_adjustment', p_note, p_created_by);
END;
$$;

-- ============================================================
-- 3. 更新 ship_from_pool：寫入庫存明細
-- ============================================================

CREATE OR REPLACE FUNCTION public.ship_from_pool(
  p_store_ids UUID[],
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_store_id UUID;
  v_sales_note_id UUID;
  v_access_token UUID;
  v_item RECORD;
  v_new_shipped_qty INTEGER;
  v_new_status public.order_item_status;
  v_affected_order_ids UUID[] := '{}';
  v_order_id UUID;
  v_all_shipped BOOLEAN;
  v_result JSONB;
  v_new_balance INTEGER;
  v_sn_code TEXT;
BEGIN
  v_result := '[]'::JSONB;

  FOR v_store_id IN SELECT unnest(p_store_ids) LOOP
    v_access_token := gen_random_uuid();

    INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token)
    VALUES (v_store_id, p_created_by, 'shipped', NOW(), p_notes, v_access_token)
    RETURNING id, code INTO v_sales_note_id, v_sn_code;

    FOR v_item IN
      SELECT sp.id AS pool_id, sp.order_item_id, sp.quantity, sp.store_id,
             oi.quantity AS total_qty, oi.shipped_quantity AS current_shipped,
             oi.order_id, oi.product_id, oi.variant_id
      FROM public.shipping_pool sp
      JOIN public.order_items oi ON oi.id = sp.order_item_id
      WHERE sp.store_id = v_store_id
    LOOP
      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity)
      VALUES (v_sales_note_id, v_item.order_item_id, v_item.quantity);

      v_new_shipped_qty := v_item.current_shipped + v_item.quantity;
      IF v_new_shipped_qty >= v_item.total_qty THEN
        v_new_status := 'shipped';
      ELSIF v_new_shipped_qty > 0 THEN
        v_new_status := 'partial';
      ELSE
        v_new_status := 'waiting';
      END IF;

      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped_qty, status = v_new_status, updated_at = NOW()
      WHERE id = v_item.order_item_id;

      UPDATE public.product_inventory
      SET quantity = quantity - v_item.quantity, updated_at = NOW()
      WHERE product_id = v_item.product_id AND variant_id = v_item.variant_id
      RETURNING quantity INTO v_new_balance;

      IF NOT FOUND THEN
        v_new_balance := 0;
      END IF;

      INSERT INTO public.inventory_movements (product_id, variant_id, quantity_change, balance_after, source_type, source_id, reference_code, created_by)
      VALUES (v_item.product_id, v_item.variant_id, -v_item.quantity, v_new_balance, 'sales_shipment', v_sales_note_id, v_sn_code, p_created_by);

      IF NOT (v_item.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_item.order_id);
      END IF;

      INSERT INTO public.audit_logs (entity_type, entity_id, action, performed_by, store_id, old_value, new_value)
      VALUES ('order_item', v_item.order_item_id, 'shipped_quantity_updated', p_created_by, v_store_id,
        jsonb_build_object('shipped_quantity', v_item.current_shipped),
        jsonb_build_object('shipped_quantity', v_new_shipped_qty, 'status', v_new_status::text));
    END LOOP;

    DELETE FROM public.shipping_pool WHERE store_id = v_store_id;

    v_result := v_result || jsonb_build_object(
      'store_id', v_store_id,
      'sales_note_id', v_sales_note_id,
      'access_token', v_access_token
    );
  END LOOP;

  FOREACH v_order_id IN ARRAY v_affected_order_ids LOOP
    SELECT bool_and(oi.shipped_quantity >= oi.quantity OR oi.status IN ('cancelled', 'discontinued'))
    INTO v_all_shipped
    FROM public.order_items oi
    WHERE oi.order_id = v_order_id;

    IF v_all_shipped THEN
      UPDATE public.orders SET status = 'shipped' WHERE id = v_order_id;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 4. 更新 direct_ship_order：寫入庫存明細
-- ============================================================

CREATE OR REPLACE FUNCTION public.direct_ship_order(
  p_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_sales_note_id UUID;
  v_sales_note_code TEXT;
  v_access_token UUID;
  v_remaining_qty INTEGER;
  v_new_shipped_qty INTEGER;
  v_sn_notes TEXT;
  v_result JSONB;
  v_new_balance INTEGER;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單不存在';
  END IF;

  IF v_order.status NOT IN ('processing', 'pending') THEN
    RAISE EXCEPTION '僅能對處理中或待確認的訂單執行轉銷貨單';
  END IF;

  v_access_token := gen_random_uuid();

  v_sn_notes := CASE
    WHEN v_order.notes IS NOT NULL AND p_notes IS NOT NULL THEN v_order.notes || ' | ' || p_notes
    WHEN v_order.notes IS NOT NULL THEN v_order.notes
    ELSE p_notes
  END;

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token)
  VALUES (v_order.store_id, p_created_by, 'shipped', NOW(), v_sn_notes, v_access_token)
  RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.shipped_quantity,
           oi.unit_price, oi.selected_model_name, oi.store_id
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status NOT IN ('cancelled', 'discontinued')
  LOOP
    v_remaining_qty := v_item.quantity - v_item.shipped_quantity;
    CONTINUE WHEN v_remaining_qty <= 0;

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity)
    VALUES (v_sales_note_id, v_item.id, v_remaining_qty);

    v_new_shipped_qty := v_item.shipped_quantity + v_remaining_qty;

    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped_qty,
        status = 'shipped',
        updated_at = NOW()
    WHERE id = v_item.id;

    UPDATE public.product_inventory
    SET quantity = quantity - v_remaining_qty, updated_at = NOW()
    WHERE product_id = v_item.product_id AND variant_id = v_item.variant_id
    RETURNING quantity INTO v_new_balance;

    IF NOT FOUND THEN
      v_new_balance := 0;
    END IF;

    INSERT INTO public.inventory_movements (product_id, variant_id, quantity_change, balance_after, source_type, source_id, reference_code, created_by)
    VALUES (v_item.product_id, v_item.variant_id, -v_remaining_qty, v_new_balance, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
  END LOOP;

  UPDATE public.orders
  SET status = 'shipped', updated_at = NOW()
  WHERE id = p_order_id;

  v_result := jsonb_build_object(
    'sales_note_id', v_sales_note_id,
    'sales_note_code', v_sales_note_code,
    'access_token', v_access_token
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- 5. 更新 create_order_with_sales_note：寫入庫存明細
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_order_with_sales_note(
  p_store_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order_id UUID;
  v_order_code TEXT;
  v_sales_note_id UUID;
  v_sales_note_code TEXT;
  v_access_token UUID;
  v_item JSONB;
  v_order_item_id UUID;
  v_product_id UUID;
  v_variant_id UUID;
  v_quantity INTEGER;
  v_result JSONB;
  v_new_balance INTEGER;
BEGIN
  v_access_token := gen_random_uuid();

  INSERT INTO public.orders (store_id, created_by, notes, source_type, status)
  VALUES (p_store_id, p_created_by, p_notes, 'admin_proxy', 'shipped')
  RETURNING id, code INTO v_order_id, v_order_code;

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token)
  VALUES (p_store_id, p_created_by, 'shipped', NOW(), p_notes, v_access_token)
  RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := (v_item->>'variant_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, store_id,
      quantity, unit_price, selected_model_name,
      shipped_quantity, status
    )
    VALUES (
      v_order_id,
      v_product_id,
      v_variant_id,
      p_store_id,
      v_quantity,
      (v_item->>'unit_price')::NUMERIC,
      (v_item->>'selected_model_name'),
      v_quantity,
      'shipped'
    )
    RETURNING id INTO v_order_item_id;

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity)
    VALUES (v_sales_note_id, v_order_item_id, v_quantity);

    UPDATE public.product_inventory
    SET quantity = quantity - v_quantity, updated_at = NOW()
    WHERE product_id = v_product_id AND variant_id = v_variant_id
    RETURNING quantity INTO v_new_balance;

    IF NOT FOUND THEN
      v_new_balance := 0;
    END IF;

    INSERT INTO public.inventory_movements (product_id, variant_id, quantity_change, balance_after, source_type, source_id, reference_code, created_by)
    VALUES (v_product_id, v_variant_id, -v_quantity, v_new_balance, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
  END LOOP;

  v_result := jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'sales_note_id', v_sales_note_id,
    'sales_note_code', v_sales_note_code,
    'access_token', v_access_token
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- 6. 更新 delete_sales_note：寫入庫存明細（回補為正數）
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_sales_note(
  p_sales_note_id UUID
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_item RECORD;
  v_new_shipped int;
  v_total_quantity int;
  v_order_ids UUID[] := '{}';
  v_pool_quantity int;
  v_new_balance INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales_notes WHERE id = p_sales_note_id AND status = 'received') THEN
    RAISE EXCEPTION '無法刪除已收貨的銷貨單';
  END IF;

  FOR v_item IN 
    SELECT si.order_item_id, si.quantity, oi.quantity AS total_quantity, 
           oi.shipped_quantity, oi.order_id, oi.product_id, oi.variant_id
    FROM public.sales_note_items si
    JOIN public.order_items oi ON si.order_item_id = oi.id
    WHERE si.sales_note_id = p_sales_note_id
  LOOP
    IF NOT (v_item.order_id = ANY(v_order_ids)) THEN
      v_order_ids := array_append(v_order_ids, v_item.order_id);
    END IF;

    v_new_shipped := GREATEST(0, v_item.shipped_quantity - v_item.quantity);
    v_total_quantity := v_item.total_quantity;

    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped,
        status = CASE 
                    WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                    WHEN v_new_shipped < v_total_quantity THEN 'partial'::order_item_status
                    ELSE 'shipped'::order_item_status
                 END
    WHERE id = v_item.order_item_id;

    UPDATE public.product_inventory
    SET quantity = quantity + v_item.quantity, updated_at = NOW()
    WHERE product_id = v_item.product_id AND variant_id = v_item.variant_id
    RETURNING quantity INTO v_new_balance;

    IF NOT FOUND THEN
      v_new_balance := v_item.quantity;
    END IF;

    INSERT INTO public.inventory_movements (product_id, variant_id, quantity_change, balance_after, source_type, source_id, created_by)
    VALUES (v_item.product_id, v_item.variant_id, v_item.quantity, v_new_balance, 'sales_note_deletion', p_sales_note_id, NULL);

    SELECT quantity INTO v_pool_quantity
    FROM public.shipping_pool WHERE order_item_id = v_item.order_item_id;

    IF FOUND THEN
      UPDATE public.shipping_pool
      SET quantity = v_pool_quantity + v_item.quantity
      WHERE order_item_id = v_item.order_item_id;
    ELSE
      INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
      SELECT v_item.order_item_id, v_item.quantity, o.store_id, o.created_by
      FROM public.orders o WHERE o.id = v_item.order_id;
    END IF;
  END LOOP;

  DELETE FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id;
  DELETE FROM public.sales_notes WHERE id = p_sales_note_id;

  UPDATE public.orders o
  SET status = 'processing'
  WHERE o.id = ANY(v_order_ids)
    AND o.status = 'shipped'
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi2
      WHERE oi2.order_id = o.id
        AND (oi2.shipped_quantity > 0 OR oi2.status IN ('shipped', 'partial'))
    );
END;
$$;

-- ============================================================
-- 7. 採購入庫也要寫入明細（ReceivingTab + usePurchaseOrders）
-- 用獨立 RPC 統一入庫邏輯
-- ============================================================

CREATE OR REPLACE FUNCTION public.receive_purchase_items(
  p_items JSONB
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_variant_id UUID;
  v_received_qty INTEGER;
  v_po_id UUID;
  v_po_code TEXT;
  v_current_qty INTEGER;
  v_new_qty INTEGER;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := (v_item->>'variant_id')::UUID;
    v_received_qty := (v_item->>'received_quantity')::INTEGER;
    v_po_id := (v_item->>'purchase_order_id')::UUID;
    v_po_code := v_item->>'purchase_order_code';

    SELECT quantity INTO v_current_qty
    FROM public.product_inventory
    WHERE product_id = v_product_id AND variant_id IS NOT DISTINCT FROM v_variant_id;

    v_new_qty := COALESCE(v_current_qty, 0) + v_received_qty;

    INSERT INTO public.product_inventory (product_id, variant_id, quantity, updated_at)
    VALUES (v_product_id, v_variant_id, v_new_qty, NOW())
    ON CONFLICT (product_id, variant_id) DO UPDATE
    SET quantity = v_new_qty, updated_at = NOW();

    INSERT INTO public.inventory_movements (product_id, variant_id, quantity_change, balance_after, source_type, source_id, reference_code)
    VALUES (v_product_id, v_variant_id, v_received_qty, v_new_qty, 'purchase_receipt', v_po_id, v_po_code);
  END LOOP;
END;
$$;

-- ============================================================
-- 8. 系統重算 RPC：根據採購單與訂單重新計算庫存數量
-- ============================================================

CREATE OR REPLACE FUNCTION public.recalculate_inventory(
  p_created_by UUID DEFAULT NULL
)
RETURNS TABLE(out_product_id UUID, out_variant_id UUID, old_quantity INTEGER, new_quantity INTEGER, diff INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_rec RECORD;
  v_old_qty INTEGER;
  v_diff INTEGER;
BEGIN
  FOR v_rec IN
    WITH received AS (
      SELECT poi.product_id, poi.variant_id, COALESCE(SUM(poi.received_quantity), 0) AS total_received
      FROM purchase_order_items poi
      GROUP BY poi.product_id, poi.variant_id
    ),
    shipped AS (
      SELECT oi.product_id, oi.variant_id, COALESCE(SUM(sni.quantity), 0) AS total_shipped
      FROM sales_note_items sni
      JOIN sales_notes sn ON sn.id = sni.sales_note_id AND sn.status != 'draft'
      JOIN order_items oi ON oi.id = sni.order_item_id
      GROUP BY oi.product_id, oi.variant_id
    ),
    calculated AS (
      SELECT COALESCE(r.product_id, s.product_id) AS pid,
             COALESCE(r.variant_id, s.variant_id) AS vid,
             COALESCE(r.total_received, 0) - COALESCE(s.total_shipped, 0) AS calc_qty
      FROM received r
      FULL OUTER JOIN shipped s ON r.product_id = s.product_id AND r.variant_id IS NOT DISTINCT FROM s.variant_id
    ),
    existing AS (
      SELECT pi.product_id, pi.variant_id, pi.quantity FROM product_inventory pi
    )
    SELECT DISTINCT ON (COALESCE(c.pid, e.product_id), COALESCE(c.vid, e.variant_id))
           COALESCE(c.pid, e.product_id) AS pid,
           COALESCE(c.vid, e.variant_id) AS vid,
           c.calc_qty,
           e.quantity AS existing_qty
    FROM calculated c
    FULL OUTER JOIN existing e ON e.product_id = c.pid AND e.variant_id IS NOT DISTINCT FROM c.vid
  LOOP
    v_old_qty := COALESCE(v_rec.existing_qty, 0);
    v_diff := COALESCE(v_rec.calc_qty, 0) - v_old_qty;

    IF v_diff != 0 OR v_rec.existing_qty IS NULL THEN
      INSERT INTO public.product_inventory (product_id, variant_id, quantity, updated_at)
      VALUES (v_rec.pid, v_rec.vid, COALESCE(v_rec.calc_qty, 0), NOW())
      ON CONFLICT (product_id, variant_id) DO UPDATE
      SET quantity = COALESCE(v_rec.calc_qty, 0), updated_at = NOW();

      INSERT INTO public.inventory_movements (product_id, variant_id, quantity_change, balance_after, source_type, note, created_by)
      VALUES (v_rec.pid, v_rec.vid, v_diff, COALESCE(v_rec.calc_qty, 0), 'manual_adjustment', '系統重算', p_created_by);

      out_product_id := v_rec.pid;
      out_variant_id := v_rec.vid;
      old_quantity := v_old_qty;
      new_quantity := COALESCE(v_rec.calc_qty, 0);
      diff := v_diff;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
