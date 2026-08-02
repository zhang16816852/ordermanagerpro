-- ============================================================
-- 寄賣系統 v1（統一模板）
-- 1. 新表：consignment_orders / consignment_order_items /
--         consignment_sales_reports / consignment_sales /
--         consignment_settlements / consignment_returns / consignment_return_items
-- 2. 既有表變更：inventory_movements 加 inventory_owner +
--    consignment_order_id + consignment_order_item_id；
--    sales_note_items 加 inventory_source_type；order_source_type 加 'consignment'
-- 3. view：consignment_order_item_summary（統計欄計算，不落庫）
-- 4. RPC：receive_consignment_items / create_consignment_shipment /
--         allocate_inventory（FIFO）/ report_consignment_sale /
--         confirm_consignment_sales / return_consignment_items /
--         settle_consignment / 改寫 delete_sales_note
-- 5. 出貨 RPC hook：create_order_with_sales_note / ship_from_pool / direct_ship_order
--    逐項帶 inventory_source_type
-- ============================================================

BEGIN;

-- ============================================================
-- 0. order_source_type 加入 'consignment'
-- ============================================================
ALTER TYPE public.order_source_type ADD VALUE IF NOT EXISTS 'consignment';

-- ============================================================
-- 1. 新表：consignment_orders（統一模板）
-- ============================================================
CREATE TABLE public.consignment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('receive_from_supplier', 'send_to_store')),
  supplier_id UUID REFERENCES public.suppliers(id),
  store_id UUID REFERENCES public.stores(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'settled', 'cancelled')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_consignment_direction_partner CHECK (
    (direction = 'receive_from_supplier' AND supplier_id IS NOT NULL AND store_id IS NULL)
    OR
    (direction = 'send_to_store' AND store_id IS NOT NULL AND supplier_id IS NULL)
  )
);

CREATE INDEX idx_consignment_orders_direction ON public.consignment_orders(direction);
CREATE INDEX idx_consignment_orders_status ON public.consignment_orders(status);
CREATE INDEX idx_consignment_orders_supplier ON public.consignment_orders(supplier_id);
CREATE INDEX idx_consignment_orders_store ON public.consignment_orders(store_id);

ALTER TABLE public.consignment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_consignment_orders" ON public.consignment_orders
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "store_members_view_consignment_orders" ON public.consignment_orders
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::system_role)
    OR (direction = 'send_to_store' AND is_store_member(auth.uid(), store_id))
  );

CREATE TRIGGER trg_consignment_orders_updated_at
  BEFORE UPDATE ON public.consignment_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 寄賣單號：CS-YYMMDD-XXXXX
CREATE OR REPLACE FUNCTION public.trgfn_generate_consignment_code()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_seq_key TEXT;
  v_new_val INTEGER;
BEGIN
  v_seq_key := 'consignment_' || to_char(NEW.created_at, 'YYMMDD');
  INSERT INTO public.system_sequences (name, current_value, updated_at)
  VALUES (v_seq_key, 1, NOW())
  ON CONFLICT (name) DO UPDATE SET current_value = system_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_new_val;
  NEW.code := 'CS-' || to_char(NEW.created_at, 'YYMMDD') || '-' || lpad(v_new_val::text, 5, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_consignment_generate_code
  BEFORE INSERT ON public.consignment_orders
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_generate_consignment_code();

-- ============================================================
-- 2. consignment_order_items
-- ============================================================
CREATE TABLE public.consignment_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_order_id UUID NOT NULL REFERENCES public.consignment_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  variant_id UUID REFERENCES public.product_variants(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coi_order ON public.consignment_order_items(consignment_order_id);
CREATE INDEX idx_coi_product ON public.consignment_order_items(product_id, variant_id);

ALTER TABLE public.consignment_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_consignment_order_items" ON public.consignment_order_items
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "store_members_view_consignment_order_items" ON public.consignment_order_items
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::system_role)
    OR EXISTS (
      SELECT 1 FROM public.consignment_orders co
      WHERE co.id = consignment_order_items.consignment_order_id
        AND co.direction = 'send_to_store'
        AND is_store_member(auth.uid(), co.store_id)
    )
  );

-- ============================================================
-- 3. consignment_sales_reports（店家回報審核層）
-- ============================================================
CREATE TABLE public.consignment_sales_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_order_id UUID NOT NULL REFERENCES public.consignment_orders(id),
  consignment_order_item_id UUID NOT NULL REFERENCES public.consignment_order_items(id),
  store_id UUID REFERENCES public.stores(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  sale_price NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  note TEXT,
  confirmed_by UUID REFERENCES public.profiles(id),
  confirmed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_csr_status ON public.consignment_sales_reports(status);
CREATE INDEX idx_csr_order ON public.consignment_sales_reports(consignment_order_id);
CREATE INDEX idx_csr_store ON public.consignment_sales_reports(store_id);

ALTER TABLE public.consignment_sales_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_consignment_sales_reports" ON public.consignment_sales_reports
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "store_members_view_sales_reports" ON public.consignment_sales_reports
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role) OR is_store_member(auth.uid(), store_id));

CREATE POLICY "store_members_create_sales_reports" ON public.consignment_sales_reports
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role) OR is_store_member(auth.uid(), store_id));

-- ============================================================
-- 4. consignment_sales（統一銷售帳本）
-- ============================================================
CREATE TABLE public.consignment_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_order_id UUID NOT NULL REFERENCES public.consignment_orders(id),
  consignment_order_item_id UUID NOT NULL REFERENCES public.consignment_order_items(id),
  direction TEXT NOT NULL CHECK (direction IN ('receive_from_supplier', 'send_to_store')),
  source_type TEXT NOT NULL CHECK (source_type IN ('store_report', 'customer_order')),
  report_id UUID REFERENCES public.consignment_sales_reports(id),
  sales_note_id UUID REFERENCES public.sales_notes(id) ON DELETE SET NULL,
  order_item_id UUID REFERENCES public.order_items(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  reversed BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cs_order ON public.consignment_sales(consignment_order_id);
CREATE INDEX idx_cs_item ON public.consignment_sales(consignment_order_item_id);
CREATE INDEX idx_cs_sales_note ON public.consignment_sales(sales_note_id);
CREATE INDEX idx_cs_order_item ON public.consignment_sales(order_item_id);

ALTER TABLE public.consignment_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_consignment_sales" ON public.consignment_sales
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "store_members_view_consignment_sales" ON public.consignment_sales
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::system_role)
    OR EXISTS (
      SELECT 1 FROM public.consignment_orders co
      WHERE co.id = consignment_sales.consignment_order_id
        AND co.direction = 'send_to_store'
        AND is_store_member(auth.uid(), co.store_id)
    )
  );

-- ============================================================
-- 5. consignment_settlements
-- ============================================================
CREATE TABLE public.consignment_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_order_id UUID NOT NULL REFERENCES public.consignment_orders(id),
  settlement_type TEXT NOT NULL CHECK (settlement_type IN ('supplier_payment', 'store_receivable', 'commission', 'convert_purchase')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  amount NUMERIC NOT NULL DEFAULT 0,
  account_id UUID REFERENCES public.accounts(id),
  note TEXT,
  settled_by UUID REFERENCES public.profiles(id),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_csettlement_order ON public.consignment_settlements(consignment_order_id);

ALTER TABLE public.consignment_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_consignment_settlements" ON public.consignment_settlements
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "store_members_view_consignment_settlements" ON public.consignment_settlements
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::system_role)
    OR EXISTS (
      SELECT 1 FROM public.consignment_orders co
      WHERE co.id = consignment_settlements.consignment_order_id
        AND co.direction = 'send_to_store'
        AND is_store_member(auth.uid(), co.store_id)
    )
  );

CREATE TRIGGER trg_consignment_settlements_updated_at
  BEFORE UPDATE ON public.consignment_settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 6. consignment_returns + consignment_return_items
-- ============================================================
CREATE TABLE public.consignment_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_order_id UUID NOT NULL REFERENCES public.consignment_orders(id),
  direction TEXT NOT NULL CHECK (direction IN ('receive_from_supplier', 'send_to_store')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_creturn_order ON public.consignment_returns(consignment_order_id);

ALTER TABLE public.consignment_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_consignment_returns" ON public.consignment_returns
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "store_members_view_consignment_returns" ON public.consignment_returns
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::system_role)
    OR EXISTS (
      SELECT 1 FROM public.consignment_orders co
      WHERE co.id = consignment_returns.consignment_order_id
        AND co.direction = 'send_to_store'
        AND is_store_member(auth.uid(), co.store_id)
    )
  );

CREATE TRIGGER trg_consignment_returns_updated_at
  BEFORE UPDATE ON public.consignment_returns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.consignment_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.consignment_returns(id) ON DELETE CASCADE,
  consignment_order_item_id UUID NOT NULL REFERENCES public.consignment_order_items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cri_return ON public.consignment_return_items(return_id);

ALTER TABLE public.consignment_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_consignment_return_items" ON public.consignment_return_items
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

-- ============================================================
-- 7. inventory_movements 變更
--    - inventory_owner（self / supplier_consignment / store_consignment）
--    - consignment_order_id / consignment_order_item_id
--    - 重寫 source_type CHECK（新增 reversal 兩型）
--    - 重寫 chk_invmov_source_fk（consignment_* 綁 consignment_order_id）
-- ============================================================
ALTER TABLE public.inventory_movements
  ADD COLUMN inventory_owner TEXT NOT NULL DEFAULT 'self'
    CHECK (inventory_owner IN ('self', 'supplier_consignment', 'store_consignment')),
  ADD COLUMN consignment_order_id UUID REFERENCES public.consignment_orders(id) ON DELETE SET NULL,
  ADD COLUMN consignment_order_item_id UUID REFERENCES public.consignment_order_items(id) ON DELETE SET NULL;

CREATE INDEX idx_invmov_consignment_order ON public.inventory_movements(consignment_order_id);
CREATE INDEX idx_invmov_consignment_item ON public.inventory_movements(consignment_order_item_id);
CREATE INDEX idx_invmov_owner ON public.inventory_movements(inventory_owner);

-- 移除自動命名（因 rename 產生 _1 尾綴）的 source_type CHECK
DO $$
DECLARE v_con text;
BEGIN
  SELECT conname INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'public.inventory_movements'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE 'CHECK ((source_type%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.inventory_movements DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_source_type_check CHECK (
    source_type IN (
      'purchase_receipt', 'purchase_return',
      'sales_shipment', 'sales_note_deletion',
      'customer_return',
      'consignment_in_receipt', 'consignment_in_return',
      'consignment_out_shipment', 'consignment_out_sale', 'consignment_out_return',
      'consignment_sale_reversal', 'consignment_shipment_reversal',
      'scrap', 'transfer',
      'manual_adjustment', 'system_recalculation'
    )
  );

ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS chk_invmov_source_fk;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT chk_invmov_source_fk CHECK (
    (source_type IN ('purchase_receipt', 'purchase_return')
     AND purchase_order_id IS NOT NULL AND sales_note_id IS NULL AND consignment_order_id IS NULL)
    OR
    (source_type IN ('sales_shipment', 'sales_note_deletion', 'customer_return')
     AND sales_note_id IS NOT NULL AND purchase_order_id IS NULL AND consignment_order_id IS NULL)
    OR
    (source_type IN ('consignment_in_receipt', 'consignment_in_return', 'consignment_out_shipment', 'consignment_out_sale', 'consignment_out_return', 'consignment_sale_reversal', 'consignment_shipment_reversal')
     AND consignment_order_id IS NOT NULL AND purchase_order_id IS NULL)
    OR
    (source_type IN ('scrap', 'transfer', 'manual_adjustment', 'system_recalculation')
     AND purchase_order_id IS NULL AND sales_note_id IS NULL AND consignment_order_id IS NULL)
  );

-- ============================================================
-- 8. sales_note_items 加 inventory_source_type
-- ============================================================
ALTER TABLE public.sales_note_items
  ADD COLUMN inventory_source_type TEXT NOT NULL DEFAULT 'self'
    CHECK (inventory_source_type IN ('self', 'supplier_consignment', 'store_consignment'));

-- ============================================================
-- 9. view：consignment_order_item_summary
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
  COALESCE(-SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_out_shipment'), 0) AS shipped_quantity,
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
-- 10. RPC：receive_consignment_items（廠商方向收貨）
-- ============================================================
CREATE OR REPLACE FUNCTION public.receive_consignment_items(
  p_consignment_order_id UUID,
  p_items JSONB,
  p_created_by UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_item JSONB;
  v_coi_id UUID;
  v_received INTEGER;
  v_wh_id UUID;
  v_order_code TEXT;
BEGIN
  SELECT * INTO v_order FROM public.consignment_orders WHERE id = p_consignment_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣單不存在';
  END IF;
  IF v_order.direction <> 'receive_from_supplier' THEN
    RAISE EXCEPTION '此寄賣單非廠商方向，無法收貨';
  END IF;
  IF v_order.status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION '寄賣單狀態不允許收貨';
  END IF;

  SELECT id INTO v_wh_id FROM public.warehouses WHERE code = 'supplier_consignment';
  IF v_wh_id IS NULL THEN
    RAISE EXCEPTION '找不到供應商寄賣倉';
  END IF;

  v_order_code := v_order.code;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_coi_id := (v_item->>'consignment_order_item_id')::UUID;
    v_received := (v_item->>'received_quantity')::INTEGER;

    IF NOT EXISTS (
      SELECT 1 FROM public.consignment_order_items
      WHERE id = v_coi_id AND consignment_order_id = p_consignment_order_id
    ) THEN
      RAISE EXCEPTION '商品不存在於此寄賣單：%', v_coi_id;
    END IF;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id, reference_code, inventory_owner, created_by
    )
    SELECT product_id, variant_id, v_wh_id, v_received, 'consignment_in_receipt',
           p_consignment_order_id, v_coi_id, v_order_code, 'supplier_consignment', p_created_by
    FROM public.consignment_order_items WHERE id = v_coi_id;
  END LOOP;

  UPDATE public.consignment_orders
  SET status = 'active', updated_at = NOW()
  WHERE id = p_consignment_order_id AND status = 'draft';
END;
$$;

-- ============================================================
-- 11. RPC：create_consignment_shipment（店家方向出貨）
--     建 order(source_type='consignment') + sales_note，走既有收貨流程
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
  v_sn_id UUID;
  v_sn_code TEXT;
  v_access_token UUID;
  v_own_wh UUID;
  v_shipped_at TIMESTAMPTZ;
  v_item RECORD;
  v_ship_qty INTEGER;
  v_oi_id UUID;
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

  v_shipped_at := COALESCE(p_shipped_at, NOW());
  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  v_access_token := gen_random_uuid();

  INSERT INTO public.orders (store_id, created_by, notes, source_type, status)
  VALUES (v_order.store_id, p_created_by, p_notes, 'consignment', 'shipped')
  RETURNING id, code INTO v_order_id, v_order_code;

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
  VALUES (v_order.store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_own_wh)
  RETURNING id, code INTO v_sn_id, v_sn_code;

  FOR v_item IN
    SELECT s.consignment_order_item_id, s.unit_price,
           s.shipped_quantity - s.sold_quantity - s.returned_from_store AS remaining,
           coi.product_id, coi.variant_id
    FROM public.consignment_order_item_summary s
    JOIN public.consignment_order_items coi ON coi.id = s.consignment_order_item_id
    WHERE s.consignment_order_id = p_consignment_order_id
  LOOP
    v_ship_qty := v_item.remaining;
    CONTINUE WHEN v_ship_qty <= 0;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, store_id,
      quantity, unit_price, shipped_quantity, status
    )
    VALUES (
      v_order_id, v_item.product_id, v_item.variant_id, v_order.store_id,
      v_ship_qty, v_item.unit_price, v_ship_qty, 'shipped'
    )
    RETURNING id INTO v_oi_id;

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
    VALUES (v_sn_id, v_oi_id, v_ship_qty, 'store_consignment');

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      sales_note_id, consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_item.product_id, v_item.variant_id, v_own_wh, -v_ship_qty, 'consignment_out_shipment',
      v_sn_id, p_consignment_order_id, v_item.consignment_order_item_id,
      v_sn_code, 'store_consignment', p_created_by
    );
  END LOOP;

  UPDATE public.consignment_orders
  SET status = 'active', updated_at = NOW()
  WHERE id = p_consignment_order_id AND status = 'draft';

  v_result := jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'sales_note_id', v_sn_id,
    'sales_note_code', v_sn_code,
    'access_token', v_access_token
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- 12. RPC：allocate_inventory（FIFO 分攤，出貨 RPC 共用）
--     回傳結構化 allocation 陣列；source='self' 時不寫入，
--     由呼叫端沿用原本 self 流程；supplier_consignment 時
--     寫入 movements + consignment_sales（customer_order）。
-- ============================================================
CREATE OR REPLACE FUNCTION public.allocate_inventory(
  p_product_id UUID,
  p_variant_id UUID,
  p_quantity INTEGER,
  p_source TEXT DEFAULT 'self',
  p_warehouse_id UUID DEFAULT NULL,
  p_sales_note_id UUID DEFAULT NULL,
  p_order_item_id UUID DEFAULT NULL,
  p_reference_code TEXT DEFAULT NULL,
  p_unit_price NUMERIC DEFAULT 0,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_own_wh_id UUID;
  v_supplier_wh_id UUID;
  v_remaining INTEGER;
  v_take INTEGER;
  v_alloc JSONB := '[]'::JSONB;
  v_batch RECORD;
  v_received INTEGER;
  v_returned INTEGER;
  v_sold INTEGER;
BEGIN
  IF p_source = 'self' THEN
    SELECT id INTO v_own_wh_id FROM public.warehouses WHERE code = 'own';
    v_alloc := jsonb_build_array(jsonb_build_object(
      'inventory_owner', 'self',
      'warehouse_id', COALESCE(p_warehouse_id, v_own_wh_id),
      'quantity', p_quantity,
      'consignment_order_id', NULL,
      'consignment_order_item_id', NULL,
      'unit_cost', 0
    ));
    RETURN v_alloc;
  END IF;

  IF p_source = 'supplier_consignment' THEN
    SELECT id INTO v_supplier_wh_id FROM public.warehouses WHERE code = 'supplier_consignment';
    IF v_supplier_wh_id IS NULL THEN
      RAISE EXCEPTION '找不到供應商寄賣倉';
    END IF;

    -- 鎖定候選品項，序列化同商品並行分攤
    PERFORM 1
    FROM public.consignment_order_items coi_lock
    JOIN public.consignment_orders co_lock ON co_lock.id = coi_lock.consignment_order_id
    WHERE co_lock.direction = 'receive_from_supplier'
      AND co_lock.status IN ('draft', 'active')
      AND coi_lock.product_id = p_product_id
      AND coi_lock.variant_id IS NOT DISTINCT FROM p_variant_id
    FOR UPDATE OF coi_lock;

    v_remaining := p_quantity;

    FOR v_batch IN
      SELECT coi.id AS item_id, co.id AS order_id, coi.unit_cost
      FROM public.consignment_order_items coi
      JOIN public.consignment_orders co ON co.id = coi.consignment_order_id
      WHERE co.direction = 'receive_from_supplier'
        AND co.status IN ('draft', 'active')
        AND coi.product_id = p_product_id
        AND coi.variant_id IS NOT DISTINCT FROM p_variant_id
      ORDER BY coi.created_at ASC, coi.id ASC
    LOOP
      CONTINUE WHEN v_remaining <= 0;

      SELECT
        COALESCE((SELECT SUM(im.quantity_change) FROM public.inventory_movements im
                  WHERE im.consignment_order_item_id = v_batch.item_id
                    AND im.source_type = 'consignment_in_receipt'), 0),
        COALESCE(-(SELECT SUM(im.quantity_change) FROM public.inventory_movements im
                   WHERE im.consignment_order_item_id = v_batch.item_id
                     AND im.source_type = 'consignment_in_return'), 0),
        COALESCE((SELECT SUM(cs.quantity) FROM public.consignment_sales cs
                  WHERE cs.consignment_order_item_id = v_batch.item_id AND NOT cs.reversed), 0)
      INTO v_received, v_returned, v_sold;

      v_take := LEAST(v_remaining, GREATEST(0, v_received - v_returned - v_sold));
      CONTINUE WHEN v_take <= 0;

      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        sales_note_id, consignment_order_id, consignment_order_item_id,
        reference_code, inventory_owner, created_by
      )
      VALUES (
        p_product_id, p_variant_id, v_supplier_wh_id, -v_take, 'consignment_out_sale',
        p_sales_note_id, v_batch.order_id, v_batch.item_id,
        p_reference_code, 'supplier_consignment', p_created_by
      );

      INSERT INTO public.consignment_sales (
        consignment_order_id, consignment_order_item_id, direction, source_type,
        sales_note_id, order_item_id, quantity, unit_price, unit_cost, created_by
      )
      VALUES (
        v_batch.order_id, v_batch.item_id, 'receive_from_supplier', 'customer_order',
        p_sales_note_id, p_order_item_id, v_take, p_unit_price, v_batch.unit_cost, p_created_by
      );

      v_alloc := v_alloc || jsonb_build_object(
        'inventory_owner', 'supplier_consignment',
        'warehouse_id', v_supplier_wh_id,
        'quantity', v_take,
        'consignment_order_id', v_batch.order_id,
        'consignment_order_item_id', v_batch.item_id,
        'unit_cost', v_batch.unit_cost
      );

      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION '供應商寄賣庫存不足（缺 % 件）', v_remaining;
    END IF;

    RETURN v_alloc;
  END IF;

  RAISE EXCEPTION '不支援的庫存來源：%', p_source;
END;
$$;

-- ============================================================
-- 13. RPC：report_consignment_sale（店家回報銷售）
-- ============================================================
CREATE OR REPLACE FUNCTION public.report_consignment_sale(
  p_consignment_order_item_id UUID,
  p_quantity INTEGER,
  p_sale_price NUMERIC DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_available INTEGER;
  v_report_id UUID;
BEGIN
  SELECT co.id AS order_id, co.direction, co.status, co.store_id
  INTO v_order
  FROM public.consignment_order_items coi
  JOIN public.consignment_orders co ON co.id = coi.consignment_order_id
  WHERE coi.id = p_consignment_order_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣商品不存在';
  END IF;
  IF v_order.direction <> 'send_to_store' THEN
    RAISE EXCEPTION '此寄賣單非店家方向，無法回報銷售';
  END IF;
  IF v_order.status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION '寄賣單狀態不允許回報';
  END IF;
  IF p_created_by IS NOT NULL AND NOT public.is_store_member(p_created_by, v_order.store_id) THEN
    RAISE EXCEPTION '非門市成員，無法回報銷售';
  END IF;

  SELECT
    s.shipped_quantity - s.sold_quantity - s.returned_from_store
    - COALESCE((
        SELECT SUM(pr.quantity) FROM public.consignment_sales_reports pr
        WHERE pr.consignment_order_item_id = p_consignment_order_item_id AND pr.status = 'pending'
      ), 0)
  INTO v_available
  FROM public.consignment_order_item_summary s
  WHERE s.consignment_order_item_id = p_consignment_order_item_id;

  IF p_quantity > v_available THEN
    RAISE EXCEPTION '可回報數量不足（可回報 %，回報 %）', v_available, p_quantity;
  END IF;

  INSERT INTO public.consignment_sales_reports (
    consignment_order_id, consignment_order_item_id, store_id,
    quantity, sale_price, note, created_by
  )
  VALUES (
    v_order.order_id, p_consignment_order_item_id, v_order.store_id,
    p_quantity, p_sale_price, p_note, p_created_by
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

-- ============================================================
-- 14. RPC：confirm_consignment_sales（後台審核店家回報）
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_consignment_sales(
  p_report_ids UUID[],
  p_confirmed_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_report_id UUID;
  v_report RECORD;
  v_available INTEGER;
  v_count INTEGER := 0;
BEGIN
  FOREACH v_report_id IN ARRAY p_report_ids LOOP
    SELECT r.*, co.direction, coi.unit_price AS default_price, coi.unit_cost
    INTO v_report
    FROM public.consignment_sales_reports r
    JOIN public.consignment_orders co ON co.id = r.consignment_order_id
    JOIN public.consignment_order_items coi ON coi.id = r.consignment_order_item_id
    WHERE r.id = v_report_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '回報單不存在：%', v_report_id;
    END IF;
    IF v_report.status <> 'pending' THEN
      RAISE EXCEPTION '回報單已處理：%', v_report_id;
    END IF;
    IF v_report.direction <> 'send_to_store' THEN
      RAISE EXCEPTION '僅店家方向回報需要審核';
    END IF;

    SELECT
      s.shipped_quantity - s.sold_quantity - s.returned_from_store
      - COALESCE((
          SELECT SUM(pr.quantity) FROM public.consignment_sales_reports pr
          WHERE pr.consignment_order_item_id = v_report.consignment_order_item_id
            AND pr.status = 'pending' AND pr.id <> v_report.id
        ), 0)
    INTO v_available
    FROM public.consignment_order_item_summary s
    WHERE s.consignment_order_item_id = v_report.consignment_order_item_id;

    IF v_report.quantity > v_available THEN
      RAISE EXCEPTION '可確認數量不足（可確認 %，回報 %）', v_available, v_report.quantity;
    END IF;

    INSERT INTO public.consignment_sales (
      consignment_order_id, consignment_order_item_id, direction, source_type,
      report_id, quantity, unit_price, unit_cost, created_by
    )
    VALUES (
      v_report.consignment_order_id, v_report.consignment_order_item_id,
      'send_to_store', 'store_report', v_report.id,
      v_report.quantity, COALESCE(v_report.sale_price, v_report.default_price),
      v_report.unit_cost, p_confirmed_by
    );

    UPDATE public.consignment_sales_reports
    SET status = 'confirmed', confirmed_by = p_confirmed_by, confirmed_at = NOW()
    WHERE id = v_report_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- 15. RPC：return_consignment_items（退回：廠商退貨 / 店家退貨）
-- ============================================================
CREATE OR REPLACE FUNCTION public.return_consignment_items(
  p_consignment_order_id UUID,
  p_items JSONB,
  p_created_by UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_item JSONB;
  v_coi_id UUID;
  v_qty INTEGER;
  v_available INTEGER;
  v_wh_id UUID;
  v_return_id UUID;
  v_source TEXT;
  v_owner TEXT;
  v_direction_sign INTEGER;
BEGIN
  SELECT * INTO v_order FROM public.consignment_orders WHERE id = p_consignment_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣單不存在';
  END IF;
  IF v_order.status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION '寄賣單狀態不允許退回';
  END IF;

  IF v_order.direction = 'receive_from_supplier' THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE code = 'supplier_consignment';
    v_source := 'consignment_in_return';
    v_owner := 'supplier_consignment';
    v_direction_sign := -1;
  ELSE
    SELECT id INTO v_wh_id FROM public.warehouses WHERE code = 'own';
    v_source := 'consignment_out_return';
    v_owner := 'store_consignment';
    v_direction_sign := 1;
  END IF;

  IF v_wh_id IS NULL THEN
    RAISE EXCEPTION '找不到對應倉庫';
  END IF;

  INSERT INTO public.consignment_returns (consignment_order_id, direction, note, status, created_by)
  VALUES (p_consignment_order_id, v_order.direction, p_note, 'completed', p_created_by)
  RETURNING id INTO v_return_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_coi_id := (v_item->>'consignment_order_item_id')::UUID;
    v_qty := (v_item->>'quantity')::INTEGER;

    SELECT
      CASE WHEN v_order.direction = 'receive_from_supplier'
           THEN received_quantity - sold_quantity - returned_to_supplier
           ELSE shipped_quantity - sold_quantity - returned_from_store END
    INTO v_available
    FROM public.consignment_order_item_summary
    WHERE consignment_order_item_id = v_coi_id;

    IF v_available IS NULL THEN
      RAISE EXCEPTION '商品不存在於此寄賣單';
    END IF;
    IF v_qty > v_available THEN
      RAISE EXCEPTION '可退回數量不足（可退回 %，退回 %）', v_available, v_qty;
    END IF;

    INSERT INTO public.consignment_return_items (return_id, consignment_order_item_id, quantity)
    VALUES (v_return_id, v_coi_id, v_qty);

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id, inventory_owner, created_by
    )
    SELECT product_id, variant_id, v_wh_id, v_direction_sign * v_qty, v_source,
           p_consignment_order_id, v_coi_id, v_owner, p_created_by
    FROM public.consignment_order_items WHERE id = v_coi_id;
  END LOOP;
END;
$$;

-- ============================================================
-- 16. RPC：settle_consignment（結算）
--     v1 僅支援 supplier_payment / store_receivable
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_consignment(
  p_consignment_order_id UUID,
  p_settlement_type TEXT,
  p_amount NUMERIC,
  p_account_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_expected NUMERIC;
  v_settled NUMERIC;
  v_settlement_id UUID;
BEGIN
  SELECT * INTO v_order FROM public.consignment_orders WHERE id = p_consignment_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣單不存在';
  END IF;
  IF v_order.status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION '僅進行中寄賣單可結算';
  END IF;
  IF p_settlement_type NOT IN ('supplier_payment', 'store_receivable') THEN
    RAISE EXCEPTION 'v1 僅支援 supplier_payment / store_receivable 結算';
  END IF;
  IF (v_order.direction = 'receive_from_supplier' AND p_settlement_type <> 'supplier_payment')
     OR (v_order.direction = 'send_to_store' AND p_settlement_type <> 'store_receivable') THEN
    RAISE EXCEPTION '結算類型與寄賣方向不符';
  END IF;

  IF v_order.direction = 'receive_from_supplier' THEN
    SELECT COALESCE(SUM(cs.quantity * cs.unit_cost), 0) INTO v_expected
    FROM public.consignment_sales cs
    WHERE cs.consignment_order_id = p_consignment_order_id AND NOT cs.reversed;
  ELSE
    SELECT COALESCE(SUM(cs.quantity * cs.unit_price), 0) INTO v_expected
    FROM public.consignment_sales cs
    WHERE cs.consignment_order_id = p_consignment_order_id AND NOT cs.reversed;
  END IF;

  INSERT INTO public.consignment_settlements (
    consignment_order_id, settlement_type, amount, account_id, note, status, settled_by, settled_at
  )
  VALUES (
    p_consignment_order_id, p_settlement_type, p_amount, p_account_id,
    p_note, 'paid', p_created_by, NOW()
  )
  RETURNING id INTO v_settlement_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_settled
  FROM public.consignment_settlements
  WHERE consignment_order_id = p_consignment_order_id AND status = 'paid';

  IF v_settled >= v_expected AND v_expected > 0 THEN
    UPDATE public.consignment_orders
    SET status = 'settled', updated_at = NOW()
    WHERE id = p_consignment_order_id;
  END IF;

  RETURN v_settlement_id;
END;
$$;

-- ============================================================
-- 17. 改寫 delete_sales_note
--     consignment 來源不得直刪：reverse movement + consignment_sales.reversed=true
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
  v_consignment_wh_id UUID;
  v_is_consignment BOOLEAN;
  v_source_type TEXT;
  v_owner TEXT;
BEGIN
  SELECT id INTO v_own_warehouse_id FROM public.warehouses WHERE code = 'own';
  SELECT id INTO v_consignment_wh_id FROM public.warehouses WHERE code = 'supplier_consignment';

  IF EXISTS (SELECT 1 FROM public.sales_notes WHERE id = p_sales_note_id AND status = 'received') THEN
    RAISE EXCEPTION '無法刪除已收貨的銷貨單';
  END IF;

  FOR v_item IN
    SELECT si.order_item_id, si.quantity, si.inventory_source_type,
           oi.quantity AS total_quantity,
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

    v_is_consignment := v_item.inventory_source_type IN ('supplier_consignment', 'store_consignment')
      OR EXISTS (
        SELECT 1 FROM public.consignment_sales cs
        WHERE cs.order_item_id = v_item.order_item_id
          AND cs.sales_note_id = p_sales_note_id
          AND NOT cs.reversed
      );

    IF v_is_consignment THEN
      UPDATE public.consignment_sales
      SET reversed = true
      WHERE order_item_id = v_item.order_item_id
        AND sales_note_id = p_sales_note_id
        AND NOT reversed;

      IF v_item.inventory_source_type = 'store_consignment' THEN
        v_source_type := 'consignment_shipment_reversal';
        v_owner := 'store_consignment';
      ELSE
        v_source_type := 'consignment_sale_reversal';
        v_owner := 'supplier_consignment';
      END IF;

      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        sales_note_id, consignment_order_id, consignment_order_item_id,
        inventory_owner, created_by
      )
      SELECT
        v_item.product_id, v_item.variant_id,
        CASE WHEN v_item.inventory_source_type = 'store_consignment'
             THEN v_own_warehouse_id ELSE v_consignment_wh_id END,
        v_item.quantity, v_source_type,
        p_sales_note_id, m.consignment_order_id, m.consignment_order_item_id,
        v_owner, NULL
      FROM public.inventory_movements m
      WHERE m.sales_note_id = p_sales_note_id
        AND m.consignment_order_item_id IS NOT NULL
        AND m.product_id = v_item.product_id
        AND m.variant_id IS NOT DISTINCT FROM v_item.variant_id
      LIMIT 1;

      CONTINUE;
    END IF;

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
-- 18. 出貨 RPC hook：create_order_with_sales_note
--     逐項帶 inventory_source_type，supplier_consignment 走 allocate_inventory
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_order_with_sales_note(
  p_store_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]',
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
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
  v_source TEXT;
  v_result JSONB;
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_shipped_at TIMESTAMPTZ;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_access_token := gen_random_uuid();

  INSERT INTO public.orders (store_id, created_by, notes, source_type, status)
  VALUES (p_store_id, p_created_by, p_notes, 'admin_proxy', 'shipped')
  RETURNING id, code INTO v_order_id, v_order_code;

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
  VALUES (p_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_default_warehouse_id)
  RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := (v_item->>'variant_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_source := COALESCE(v_item->>'inventory_source_type', 'self');
    v_item_warehouse_id := COALESCE(
      (v_item->>'warehouse_id')::UUID,
      v_default_warehouse_id
    );

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

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
    VALUES (v_sales_note_id, v_order_item_id, v_quantity, v_source);

    IF v_source = 'self' THEN
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
      VALUES (v_product_id, v_variant_id, v_item_warehouse_id, -v_quantity, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
    ELSE
      PERFORM public.allocate_inventory(
        v_product_id, v_variant_id, v_quantity, v_source, NULL,
        v_sales_note_id, v_order_item_id, v_sales_note_code,
        (v_item->>'unit_price')::NUMERIC, p_created_by
      );
    END IF;
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
-- 19. 出貨 RPC hook：ship_from_pool
--     新增 p_source_map {order_item_id: 'self'|'supplier_consignment'}
-- ============================================================
CREATE OR REPLACE FUNCTION public.ship_from_pool(
  p_store_ids UUID[],
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_warehouse_map JSONB DEFAULT '{}',
  p_source_map JSONB DEFAULT '{}'
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
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_source TEXT;
  v_shipped_at TIMESTAMPTZ;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_result := '[]'::JSONB;

  FOR v_store_id IN SELECT unnest(p_store_ids) LOOP
    v_access_token := gen_random_uuid();

    INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
    VALUES (v_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_default_warehouse_id)
    RETURNING id, code INTO v_sales_note_id, v_sn_code;

    FOR v_item IN
      SELECT sp.id AS pool_id, sp.order_item_id, sp.quantity, sp.store_id,
             sp.warehouse_id AS pool_warehouse_id,
             oi.quantity AS total_qty, oi.shipped_quantity AS current_shipped,
             oi.order_id, oi.product_id, oi.variant_id, oi.unit_price
      FROM public.shipping_pool sp
      JOIN public.order_items oi ON oi.id = sp.order_item_id
      WHERE sp.store_id = v_store_id
    LOOP
      v_item_warehouse_id := COALESCE(
        v_item.pool_warehouse_id,
        (p_warehouse_map->>v_item.order_item_id::TEXT)::UUID,
        v_default_warehouse_id
      );
      v_source := COALESCE(p_source_map->>v_item.order_item_id::TEXT, 'self');

      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
      VALUES (v_sales_note_id, v_item.order_item_id, v_item.quantity, v_source);

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

      IF v_source = 'self' THEN
        INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
        VALUES (v_item.product_id, v_item.variant_id, v_item_warehouse_id, -v_item.quantity, 'sales_shipment', v_sales_note_id, v_sn_code, p_created_by);
      ELSE
        PERFORM public.allocate_inventory(
          v_item.product_id, v_item.variant_id, v_item.quantity, v_source, NULL,
          v_sales_note_id, v_item.order_item_id, v_sn_code, v_item.unit_price, p_created_by
        );
      END IF;

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
-- 20. 出貨 RPC hook：direct_ship_order
--     新增 p_source_map {order_item_id: 'self'|'supplier_consignment'}
-- ============================================================
CREATE OR REPLACE FUNCTION public.direct_ship_order(
  p_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_warehouse_map JSONB DEFAULT '{}',
  p_source_map JSONB DEFAULT '{}'
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
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_source TEXT;
  v_shipped_at TIMESTAMPTZ;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

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

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
  VALUES (v_order.store_id, p_created_by, 'shipped', v_shipped_at, v_sn_notes, v_access_token, v_default_warehouse_id)
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

    v_item_warehouse_id := COALESCE(
      (p_warehouse_map->>v_item.id::TEXT)::UUID,
      v_default_warehouse_id
    );
    v_source := COALESCE(p_source_map->>v_item.id::TEXT, 'self');

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
    VALUES (v_sales_note_id, v_item.id, v_remaining_qty, v_source);

    v_new_shipped_qty := v_item.shipped_quantity + v_remaining_qty;

    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped_qty,
        status = 'shipped',
        updated_at = NOW()
    WHERE id = v_item.id;

    IF v_source = 'self' THEN
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
      VALUES (v_item.product_id, v_item.variant_id, v_item_warehouse_id, -v_remaining_qty, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
    ELSE
      PERFORM public.allocate_inventory(
        v_item.product_id, v_item.variant_id, v_remaining_qty, v_source, NULL,
        v_sales_note_id, v_item.id, v_sales_note_code, v_item.unit_price, p_created_by
      );
    END IF;
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

COMMIT;
