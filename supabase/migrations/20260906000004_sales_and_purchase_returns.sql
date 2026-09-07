-- ============================================================
-- 20260906000004_sales_and_purchase_returns.sql
-- 退貨模組：店鋪/客戶退貨（customer_return）+ 廠商退貨（purchase_return）
-- 1. sales_note_items / purchase_order_items 新增 returned_quantity（退貨標記）
-- 2. return 表：sales_note_returns / sales_note_return_items /
--    purchase_order_returns / purchase_order_return_items
-- 3. 種子會計分類：客戶退貨退款（expense）、供應商退貨沖帳（income）
-- 4. RPC：process_sales_note_return / process_purchase_return
--    （SECURITY DEFINER、僅 admin；回勾/扣除庫存 movement + 自動開退款/沖帳分錄）
-- 5. RLS：admin 全權；門市可讀自家銷貨退貨
-- ============================================================

-- ------------------------------------------------------------
-- 1. returned_quantity 標記欄位
-- ------------------------------------------------------------
ALTER TABLE public.sales_note_items
  ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 2. 退貨單表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_note_returns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_note_id  UUID NOT NULL REFERENCES public.sales_notes(id) ON DELETE CASCADE,
  store_id       UUID NOT NULL REFERENCES public.stores(id),
  warehouse_id   UUID NOT NULL REFERENCES public.warehouses(id),
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'processed',
  total_refund   NUMERIC NOT NULL DEFAULT 0,
  entry_id       UUID REFERENCES public.accounting_entries(id) ON DELETE SET NULL,
  reference_code TEXT,
  created_by     UUID REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales_note_return_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id          UUID NOT NULL REFERENCES public.sales_note_returns(id) ON DELETE CASCADE,
  sales_note_item_id UUID NOT NULL REFERENCES public.sales_note_items(id),
  order_item_id      UUID NOT NULL REFERENCES public.order_items(id) ON DELETE SET NULL,
  product_id         UUID NOT NULL REFERENCES public.products(id),
  variant_id         UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  unit_price         NUMERIC NOT NULL DEFAULT 0,
  refund_amount      NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.purchase_order_returns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id  UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  warehouse_id       UUID NOT NULL REFERENCES public.warehouses(id),
  reason             TEXT,
  status             TEXT NOT NULL DEFAULT 'processed',
  total_credit       NUMERIC NOT NULL DEFAULT 0,
  entry_id           UUID REFERENCES public.accounting_entries(id) ON DELETE SET NULL,
  reference_code     TEXT,
  created_by         UUID REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_return_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id              UUID NOT NULL REFERENCES public.purchase_order_returns(id) ON DELETE CASCADE,
  purchase_order_item_id UUID NOT NULL REFERENCES public.purchase_order_items(id),
  product_id             UUID NOT NULL REFERENCES public.products(id),
  variant_id             UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity               INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost              NUMERIC NOT NULL DEFAULT 0,
  credit_amount          NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sn_returns_sn  ON public.sales_note_returns(sales_note_id);
CREATE INDEX IF NOT EXISTS idx_sn_ri_return   ON public.sales_note_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_po_returns_po  ON public.purchase_order_returns(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_ri_return   ON public.purchase_order_return_items(return_id);

-- ------------------------------------------------------------
-- 3. 種子會計分類
-- ------------------------------------------------------------
INSERT INTO public.accounting_categories (name, type, description, is_active)
SELECT '客戶退貨退款', 'expense', '店鋪/客戶退貨退款', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounting_categories WHERE name = '客戶退貨退款' AND type = 'expense'
);

INSERT INTO public.accounting_categories (name, type, description, is_active)
SELECT '供應商退貨沖帳', 'income', '退回廠商之進貨沖帳', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounting_categories WHERE name = '供應商退貨沖帳' AND type = 'income'
);

-- ------------------------------------------------------------
-- 4. RLS
-- ------------------------------------------------------------
ALTER TABLE public.sales_note_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_note_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_return_items ENABLE ROW LEVEL SECURITY;

-- 店鋪退貨：admin 全權；門市可讀自家退貨
CREATE POLICY "admins_manage_sales_note_returns" ON public.sales_note_returns
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

CREATE POLICY "store_view_sales_note_returns" ON public.sales_note_returns
  FOR SELECT TO authenticated
  USING (is_store_member(auth.uid(), store_id));

CREATE POLICY "admins_manage_sales_note_return_items" ON public.sales_note_return_items
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

CREATE POLICY "store_view_sales_note_return_items" ON public.sales_note_return_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sales_note_returns r
    WHERE r.id = sales_note_return_items.return_id
      AND is_store_member(auth.uid(), r.store_id)
  ));

-- 廠商退貨：僅 admin
CREATE POLICY "admins_manage_purchase_order_returns" ON public.purchase_order_returns
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

CREATE POLICY "admins_manage_purchase_order_return_items" ON public.purchase_order_return_items
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

-- ------------------------------------------------------------
-- 5. RPC：店鋪/客戶退貨
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_sales_note_return(
  p_sales_note_id uuid,
  p_items jsonb,
  p_warehouse_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_refund_account_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid          uuid;
  v_return_id    uuid;
  v_sn_store_id  uuid;
  v_sn_code      text;
  v_sn_status    text;
  v_item         jsonb;
  v_sni_id       uuid;
  v_oi_id        uuid;
  v_product_id   uuid;
  v_variant_id   uuid;
  v_qty          integer;
  v_avail        integer;
  v_line_qty     integer;
  v_returned     integer;
  v_unit_price   numeric;
  v_refund       numeric;
  v_total_refund numeric := 0;
  v_category_id  uuid;
  v_entry_id     uuid;
BEGIN
  v_uid := COALESCE(p_created_by, auth.uid());

  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION '僅限管理員操作';
  END IF;

  IF p_sales_note_id IS NULL OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '缺少必要參數';
  END IF;

  IF p_warehouse_id IS NULL THEN
    SELECT id INTO p_warehouse_id
    FROM public.warehouses
    WHERE code = 'own' OR type = '自有倉'
    ORDER BY (code = 'own') DESC, is_active DESC
    LIMIT 1;
  END IF;
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION '找不到退貨入庫倉庫';
  END IF;

  SELECT sn.store_id, sn.code, sn.status INTO v_sn_store_id, v_sn_code, v_sn_status
  FROM public.sales_notes sn
  WHERE sn.id = p_sales_note_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '銷貨單不存在';
  END IF;
  IF v_sn_status NOT IN ('shipped', 'received') THEN
    RAISE EXCEPTION '此銷貨單狀態不可退貨';
  END IF;

  INSERT INTO public.sales_note_returns (
    sales_note_id, store_id, warehouse_id, reason, status,
    total_refund, reference_code, created_by
  ) VALUES (
    p_sales_note_id, v_sn_store_id, p_warehouse_id, p_reason, 'processed',
    0, v_sn_code, v_uid
  ) RETURNING id INTO v_return_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sni_id := (v_item->>'sales_note_item_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    IF v_sni_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION '退貨品項資料無效';
    END IF;

    SELECT sni.quantity, sni.returned_quantity, oi.id, oi.product_id, oi.variant_id, COALESCE(oi.unit_price, 0)
      INTO v_line_qty, v_returned, v_oi_id, v_product_id, v_variant_id, v_unit_price
    FROM public.sales_note_items sni
    JOIN public.order_items oi ON oi.id = sni.order_item_id
    WHERE sni.id = v_sni_id AND sni.sales_note_id = p_sales_note_id
    FOR UPDATE OF sni;
    IF NOT FOUND THEN
      RAISE EXCEPTION '品項不存在於此銷貨單';
    END IF;

    v_avail := v_line_qty - v_returned;
    IF v_qty > v_avail THEN
      RAISE EXCEPTION '退貨數量超過可退數量（可退 % / 已退 %）', v_avail, v_returned;
    END IF;

    v_refund := COALESCE((v_item->>'refund_amount')::numeric, v_qty * v_unit_price);
    IF v_refund < 0 THEN
      RAISE EXCEPTION '退款金額不可為負';
    END IF;

    UPDATE public.sales_note_items
    SET returned_quantity = returned_quantity + v_qty
    WHERE id = v_sni_id;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, balance_after,
      source_type, sales_note_id, order_item_id, reference_code, note, created_by
    ) VALUES (
      v_product_id, v_variant_id, p_warehouse_id, v_qty, 0,
      'customer_return', p_sales_note_id, v_oi_id, v_sn_code,
      '店鋪/客戶退貨：' || COALESCE(p_reason, ''), v_uid
    );

    INSERT INTO public.sales_note_return_items (
      return_id, sales_note_item_id, order_item_id, product_id, variant_id,
      quantity, unit_price, refund_amount
    ) VALUES (
      v_return_id, v_sni_id, v_oi_id, v_product_id, v_variant_id,
      v_qty, v_unit_price, v_refund
    );

    v_total_refund := v_total_refund + v_refund;
  END LOOP;

  UPDATE public.sales_note_returns
  SET total_refund = v_total_refund
  WHERE id = v_return_id;

  IF v_total_refund > 0 THEN
    IF p_refund_account_id IS NULL THEN
      RAISE EXCEPTION '退貨金額大於 0 但未指定退款帳戶';
    END IF;
    SELECT id INTO v_category_id
    FROM public.accounting_categories
    WHERE name = '客戶退貨退款' AND type = 'expense' AND is_active
    LIMIT 1;
    IF v_category_id IS NULL THEN
      RAISE EXCEPTION '找不到「客戶退貨退款」會計分類';
    END IF;

    INSERT INTO public.accounting_entries (
      type, account_id, category_id, amount, paid_amount, payment_status,
      description, reference_type, reference_id, transaction_date, created_by
    ) VALUES (
      'expense', p_refund_account_id, v_category_id, v_total_refund, v_total_refund, 'paid',
      '銷貨退貨退款', 'sales_note', p_sales_note_id, CURRENT_DATE, v_uid
    ) RETURNING id INTO v_entry_id;

    UPDATE public.accounts SET balance = balance - v_total_refund WHERE id = p_refund_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '退款帳戶不存在';
    END IF;

    UPDATE public.sales_note_returns SET entry_id = v_entry_id WHERE id = v_return_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'return_id', v_return_id,
    'items', jsonb_array_length(p_items), 'total_refund', v_total_refund
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_sales_note_return(uuid, jsonb, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sales_note_return(uuid, jsonb, uuid, text, uuid, uuid) TO authenticated;

-- ------------------------------------------------------------
-- 6. RPC：廠商退貨
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_purchase_return(
  p_purchase_order_id uuid,
  p_items jsonb,
  p_warehouse_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_credit_account_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid          uuid;
  v_return_id    uuid;
  v_po_code      text;
  v_item         jsonb;
  v_poi_id       uuid;
  v_product_id   uuid;
  v_variant_id   uuid;
  v_qty          integer;
  v_avail        integer;
  v_received     integer;
  v_returned     integer;
  v_unit_cost    numeric;
  v_credit       numeric;
  v_total_credit numeric := 0;
  v_category_id  uuid;
  v_entry_id     uuid;
BEGIN
  v_uid := COALESCE(p_created_by, auth.uid());

  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION '僅限管理員操作';
  END IF;

  IF p_purchase_order_id IS NULL OR p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '缺少必要參數';
  END IF;

  IF p_warehouse_id IS NULL THEN
    SELECT id INTO p_warehouse_id
    FROM public.warehouses
    WHERE code = 'own' OR type = '自有倉'
    ORDER BY (code = 'own') DESC, is_active DESC
    LIMIT 1;
  END IF;
  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION '找不到出貨倉庫';
  END IF;

  SELECT po.code INTO v_po_code
  FROM public.purchase_orders po
  WHERE po.id = p_purchase_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '採購單不存在';
  END IF;

  INSERT INTO public.purchase_order_returns (
    purchase_order_id, warehouse_id, reason, status,
    total_credit, reference_code, created_by
  ) VALUES (
    p_purchase_order_id, p_warehouse_id, p_reason, 'processed',
    0, v_po_code, v_uid
  ) RETURNING id INTO v_return_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_poi_id := (v_item->>'purchase_order_item_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    IF v_poi_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION '退貨品項資料無效';
    END IF;

    SELECT poi.received_quantity, poi.returned_quantity, COALESCE(poi.product_id, oi.product_id),
           COALESCE(poi.variant_id, oi.variant_id), COALESCE(poi.unit_cost, 0)
      INTO v_received, v_returned, v_product_id, v_variant_id, v_unit_cost
    FROM public.purchase_order_items poi
    LEFT JOIN public.order_items oi ON oi.id = (poi.source_order_ids::uuid[])[1]
    WHERE poi.id = v_poi_id AND poi.purchase_order_id = p_purchase_order_id
    FOR UPDATE OF poi;

    IF NOT FOUND OR v_product_id IS NULL THEN
      RAISE EXCEPTION '品項不存在於此採購單';
    END IF;

    v_avail := v_received - v_returned;
    IF v_qty > v_avail THEN
      RAISE EXCEPTION '退貨數量超過可退數量（可退 % / 已退 %）', v_avail, v_returned;
    END IF;

    v_credit := COALESCE((v_item->>'credit_amount')::numeric, v_qty * v_unit_cost);
    IF v_credit < 0 THEN
      RAISE EXCEPTION '沖帳金額不可為負';
    END IF;

    UPDATE public.purchase_order_items
    SET returned_quantity = returned_quantity + v_qty
    WHERE id = v_poi_id;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, balance_after,
      source_type, purchase_order_id, reference_code, note, created_by
    ) VALUES (
      v_product_id, v_variant_id, p_warehouse_id, -v_qty, 0,
      'purchase_return', p_purchase_order_id, v_po_code,
      '退回供應商：' || COALESCE(p_reason, ''), v_uid
    );

    INSERT INTO public.purchase_order_return_items (
      return_id, purchase_order_item_id, product_id, variant_id,
      quantity, unit_cost, credit_amount
    ) VALUES (
      v_return_id, v_poi_id, v_product_id, v_variant_id,
      v_qty, v_unit_cost, v_credit
    );

    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  UPDATE public.purchase_order_returns
  SET total_credit = v_total_credit
  WHERE id = v_return_id;

  IF v_total_credit > 0 THEN
    IF p_credit_account_id IS NULL THEN
      RAISE EXCEPTION '沖帳金額大於 0 但未指定入帳帳戶';
    END IF;
    SELECT id INTO v_category_id
    FROM public.accounting_categories
    WHERE name = '供應商退貨沖帳' AND type = 'income' AND is_active
    LIMIT 1;
    IF v_category_id IS NULL THEN
      RAISE EXCEPTION '找不到「供應商退貨沖帳」會計分類';
    END IF;

    INSERT INTO public.accounting_entries (
      type, account_id, category_id, amount, paid_amount, payment_status,
      description, reference_type, reference_id, transaction_date, created_by
    ) VALUES (
      'income', p_credit_account_id, v_category_id, v_total_credit, v_total_credit, 'paid',
      '廠商退貨沖帳', 'purchase_order', p_purchase_order_id, CURRENT_DATE, v_uid
    ) RETURNING id INTO v_entry_id;

    UPDATE public.accounts SET balance = balance + v_total_credit WHERE id = p_credit_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '入帳帳戶不存在';
    END IF;

    UPDATE public.purchase_order_returns SET entry_id = v_entry_id WHERE id = v_return_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'return_id', v_return_id,
    'items', jsonb_array_length(p_items), 'total_credit', v_total_credit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_purchase_return(uuid, jsonb, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_purchase_return(uuid, jsonb, uuid, text, uuid, uuid) TO authenticated;