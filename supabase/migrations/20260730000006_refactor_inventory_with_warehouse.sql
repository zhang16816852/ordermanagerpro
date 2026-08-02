-- ============================================================
-- 庫存系統改造：Warehouse 路線 + Trigger 自動同步 + 單據 FK
-- 1. 新增 warehouses 基礎表
-- 2. product_inventory 加入 warehouse_id
-- 3. inventory_movements 加入 warehouse_id + 單據 FK
-- 4. BEFORE INSERT trigger 自動同步 product_inventory
-- 5. 重寫所有 RPC
-- ============================================================

BEGIN;

-- ============================================================
-- 1. 建立 warehouses 表
-- ============================================================

CREATE TABLE public.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  type TEXT,
  include_in_actual BOOLEAN NOT NULL DEFAULT true,
  include_in_available BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_view_warehouses" ON public.warehouses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins_manage_warehouses" ON public.warehouses
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

-- 預設倉庫
INSERT INTO public.warehouses (code, name, type, include_in_actual, include_in_available) VALUES
  ('own', '自有倉庫', '自有倉', true, true),
  ('supplier_consignment', '供應商寄賣倉', '供應商寄賣', true, false),
  ('defective', '瑕疵倉', '瑕疵', true, false);

-- ============================================================
-- 2. 改造 product_inventory 加入 warehouse_id
-- ============================================================

ALTER TABLE public.product_inventory RENAME TO product_inventory_old;

CREATE TABLE public.product_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id),
  variant_id UUID REFERENCES public.product_variants(id),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, variant_id, warehouse_id)
);

INSERT INTO public.product_inventory (product_id, variant_id, warehouse_id, quantity, updated_at)
SELECT product_id, variant_id, (SELECT id FROM public.warehouses WHERE code = 'own'), quantity, updated_at
FROM public.product_inventory_old;

DROP TABLE public.product_inventory_old;

CREATE INDEX idx_pinv_product ON public.product_inventory(product_id, variant_id);
CREATE INDEX idx_pinv_warehouse ON public.product_inventory(warehouse_id);

ALTER TABLE public.product_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_view_product_inventory" ON public.product_inventory
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins_manage_product_inventory" ON public.product_inventory
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

-- ============================================================
-- 3. 改造 inventory_movements 加入 warehouse_id + 單據 FK
-- ============================================================

ALTER TABLE public.inventory_movements RENAME TO inventory_movements_old;

CREATE TABLE public.inventory_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id),
  variant_id UUID REFERENCES public.product_variants(id),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  quantity_change INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'purchase_receipt', 'purchase_return',
    'sales_shipment', 'sales_note_deletion',
    'customer_return',
    'consignment_in_receipt', 'consignment_in_return',
    'consignment_out_shipment', 'consignment_out_sale', 'consignment_out_return',
    'scrap', 'transfer',
    'manual_adjustment', 'system_recalculation'
  )),
  purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  sales_note_id UUID REFERENCES public.sales_notes(id) ON DELETE SET NULL,
  reference_code TEXT,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invmov_product ON public.inventory_movements(product_id, variant_id);
CREATE INDEX idx_invmov_warehouse ON public.inventory_movements(warehouse_id);
CREATE INDEX idx_invmov_source ON public.inventory_movements(source_type);
CREATE INDEX idx_invmov_po ON public.inventory_movements(purchase_order_id);
CREATE INDEX idx_invmov_sn ON public.inventory_movements(sales_note_id);
CREATE INDEX idx_invmov_created ON public.inventory_movements(created_at DESC);

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT chk_invmov_source_fk CHECK (
    (source_type IN ('purchase_receipt', 'purchase_return', 'consignment_in_receipt', 'consignment_in_return')
     AND purchase_order_id IS NOT NULL AND sales_note_id IS NULL)
    OR
    (source_type IN ('sales_shipment', 'sales_note_deletion', 'customer_return')
     AND sales_note_id IS NOT NULL AND purchase_order_id IS NULL)
    OR
    (source_type IN ('consignment_out_shipment', 'consignment_out_sale', 'consignment_out_return', 'scrap', 'transfer', 'manual_adjustment', 'system_recalculation')
     AND purchase_order_id IS NULL AND sales_note_id IS NULL)
  );

CREATE UNIQUE INDEX idx_invmov_unique_shipment
  ON public.inventory_movements(sales_note_id, product_id, variant_id, warehouse_id)
  WHERE source_type = 'sales_shipment';

CREATE UNIQUE INDEX idx_invmov_unique_deletion
  ON public.inventory_movements(sales_note_id, product_id, variant_id, warehouse_id)
  WHERE source_type = 'sales_note_deletion';

INSERT INTO public.inventory_movements (
  id, product_id, variant_id, warehouse_id,
  quantity_change, balance_after, source_type,
  purchase_order_id, sales_note_id, reference_code, note,
  created_by, created_at
)
SELECT
  id, product_id, variant_id,
  (SELECT id FROM public.warehouses WHERE code = 'own'),
  quantity_change, balance_after, source_type,
  CASE WHEN source_type = 'purchase_receipt' THEN source_id ELSE NULL END,
  CASE WHEN source_type IN ('sales_shipment', 'sales_note_deletion') THEN source_id ELSE NULL END,
  reference_code, note, created_by, created_at
FROM public.inventory_movements_old;

DROP TABLE public.inventory_movements_old;

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_view_inventory_movements" ON public.inventory_movements
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins_manage_inventory_movements" ON public.inventory_movements
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

-- ============================================================
-- 4. Trigger Function：INSERT movement 時自動同步 product_inventory
-- ============================================================

CREATE OR REPLACE FUNCTION public.trgfn_sync_inventory_on_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO public.product_inventory (product_id, variant_id, warehouse_id, quantity, updated_at)
  VALUES (NEW.product_id, NEW.variant_id, NEW.warehouse_id, NEW.quantity_change, NOW())
  ON CONFLICT (product_id, variant_id, warehouse_id)
  DO UPDATE SET
    quantity = product_inventory.quantity + NEW.quantity_change,
    updated_at = NOW()
  RETURNING quantity INTO NEW.balance_after;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_inventory_on_movement
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.trgfn_sync_inventory_on_movement();

-- ============================================================
-- 5. 重寫 adjust_inventory RPC
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
    v_warehouse_id UUID;
    v_diff INTEGER;
BEGIN
    SELECT quantity, product_id, variant_id, warehouse_id
    INTO v_old_quantity, v_product_id, v_variant_id, v_warehouse_id
    FROM public.product_inventory
    WHERE id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '庫存記錄不存在';
    END IF;

    v_diff := p_new_quantity - v_old_quantity;

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, note, created_by)
    VALUES (v_product_id, v_variant_id, v_warehouse_id, v_diff, 'manual_adjustment', p_note, p_created_by);
END;
$$;

-- ============================================================
-- 6. 重寫 ship_from_pool
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
  v_sn_code TEXT;
  v_own_warehouse_id UUID;
BEGIN
  SELECT id INTO v_own_warehouse_id FROM public.warehouses WHERE code = 'own';

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

      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
      VALUES (v_item.product_id, v_item.variant_id, v_own_warehouse_id, -v_item.quantity, 'sales_shipment', v_sales_note_id, v_sn_code, p_created_by);

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
-- 7. 重寫 direct_ship_order
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
  v_own_warehouse_id UUID;
BEGIN
  SELECT id INTO v_own_warehouse_id FROM public.warehouses WHERE code = 'own';

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

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
    VALUES (v_item.product_id, v_item.variant_id, v_own_warehouse_id, -v_remaining_qty, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
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
-- 8. 重寫 create_order_with_sales_note
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
  v_own_warehouse_id UUID;
BEGIN
  SELECT id INTO v_own_warehouse_id FROM public.warehouses WHERE code = 'own';

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

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
    VALUES (v_product_id, v_variant_id, v_own_warehouse_id, -v_quantity, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
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
-- 9. 重寫 delete_sales_note
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
  v_own_warehouse_id UUID;
BEGIN
  SELECT id INTO v_own_warehouse_id FROM public.warehouses WHERE code = 'own';

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

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, created_by)
    VALUES (v_item.product_id, v_item.variant_id, v_own_warehouse_id, v_item.quantity, 'sales_note_deletion', p_sales_note_id, NULL);

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
-- 10. 重寫 receive_purchase_items RPC
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
  v_own_warehouse_id UUID;
BEGIN
  SELECT id INTO v_own_warehouse_id FROM public.warehouses WHERE code = 'own';

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := (v_item->>'variant_id')::UUID;
    v_received_qty := (v_item->>'received_quantity')::INTEGER;
    v_po_id := (v_item->>'purchase_order_id')::UUID;
    v_po_code := v_item->>'purchase_order_code';

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, purchase_order_id, reference_code)
    VALUES (v_product_id, v_variant_id, v_own_warehouse_id, v_received_qty, 'purchase_receipt', v_po_id, v_po_code);
  END LOOP;
END;
$$;

-- ============================================================
-- 11. 重寫 recalculate_inventory RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.recalculate_inventory(
  p_created_by UUID DEFAULT NULL
)
RETURNS TABLE(out_product_id UUID, out_variant_id UUID, out_warehouse_id UUID, old_quantity INTEGER, new_quantity INTEGER, diff INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_rec RECORD;
  v_old_qty INTEGER;
  v_diff INTEGER;
  v_own_warehouse_id UUID;
BEGIN
  SELECT id INTO v_own_warehouse_id FROM public.warehouses WHERE code = 'own';

  FOR v_rec IN
    WITH received AS (
      SELECT poi.product_id, poi.variant_id, COALESCE(SUM(poi.received_quantity), 0) AS total_received
      FROM public.purchase_order_items poi
      GROUP BY poi.product_id, poi.variant_id
    ),
    shipped AS (
      SELECT oi.product_id, oi.variant_id, COALESCE(SUM(sni.quantity), 0) AS total_shipped
      FROM public.sales_note_items sni
      JOIN public.sales_notes sn ON sn.id = sni.sales_note_id AND sn.status != 'draft'
      JOIN public.order_items oi ON oi.id = sni.order_item_id
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
      SELECT pi.product_id, pi.variant_id, pi.quantity
      FROM public.product_inventory pi
      WHERE pi.warehouse_id = v_own_warehouse_id
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
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, note, created_by)
      VALUES (v_rec.pid, v_rec.vid, v_own_warehouse_id, v_diff, 'system_recalculation', '系統重算', p_created_by);

      out_product_id := v_rec.pid;
      out_variant_id := v_rec.vid;
      out_warehouse_id := v_own_warehouse_id;
      old_quantity := v_old_qty;
      new_quantity := COALESCE(v_rec.calc_qty, 0);
      diff := v_diff;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
