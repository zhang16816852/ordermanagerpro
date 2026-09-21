-- ============================================================
-- 20260921000001_delivery_methods_schema.sql
-- 物流系統重構 Phase A（2026-09-21 定案）：
--   1. delivery_methods：配送方式（送貨/物流/自取）——price＝客人實收、cost＝物流成本（可不同）
--   2. shipments：包裹＝運費的唯一收支單位，每包自帶 delivery_method 快照 + fee(實收) + cost(成本)
--   3. 單據層（orders / sales_notes / consignment_orders）：
--        delivery_method_id + title/code 快照、shipping_fee＝SUM(fee)、shipping_cost＝SUM(cost)、
--        shipping_address jsonb（快照，預填自 stores）
--   4. 既有 shipping 產品（products.item_type='shipping'）自動轉入 delivery_methods（logistics），
--      對應採購商標 is_logistics_company=true
--   5. 既有單據預設補上「送貨」方式（價/成本 0），事後可改物流/自取
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. delivery_methods（配送方式）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'delivery'
    CHECK (type IN ('delivery', 'logistics', 'pickup')),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  price numeric NOT NULL DEFAULT 0,
  cost numeric NOT NULL DEFAULT 0,
  fee_payment text NOT NULL DEFAULT 'one_time'
    CHECK (fee_payment IN ('one_time', 'monthly')),
  tracking_url_template text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_delivery_method_logistics_supplier
    CHECK (type <> 'logistics' OR supplier_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_delivery_methods_supplier
  ON public.delivery_methods (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_methods_active
  ON public.delivery_methods (is_active, type);

CREATE OR REPLACE FUNCTION public.trgfn_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_methods_updated_at ON public.delivery_methods;
CREATE TRIGGER trg_delivery_methods_updated_at
  BEFORE UPDATE ON public.delivery_methods
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_set_updated_at();

COMMENT ON TABLE public.delivery_methods IS '配送方式（物流服務類型）：delivery＝送貨（店家自送，無供應商）、logistics＝物流（物流公司配送，綁 supplier_id）、pickup＝自取；price＝客人實收、cost＝物流成本（可高於實收或 0）';
COMMENT ON COLUMN public.delivery_methods.cost IS '物流成本（付給物流公司），可高於 price（倒貼）或 0（免運）';

ALTER TABLE public.delivery_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admins_manage_delivery_methods ON public.delivery_methods;
CREATE POLICY admins_manage_delivery_methods ON public.delivery_methods
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.system_role));

DROP POLICY IF EXISTS authenticated_read_delivery_methods ON public.delivery_methods;
CREATE POLICY authenticated_read_delivery_methods ON public.delivery_methods
  FOR SELECT TO authenticated USING (true);

-- ------------------------------------------------------------
-- 2. shipments（包裹＝運費收支單位；沿用 source_type+source_id 多型慣例）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type text NOT NULL CHECK (doc_type IN ('order', 'sales_note', 'consignment_order')),
  doc_id uuid NOT NULL,
  delivery_method_id uuid REFERENCES public.delivery_methods(id) ON DELETE SET NULL,
  delivery_method_title text,
  delivery_method_code text,
  fee numeric NOT NULL DEFAULT 0,
  cost numeric NOT NULL DEFAULT 0,
  fee_payment text NOT NULL DEFAULT 'one_time'
    CHECK (fee_payment IN ('one_time', 'monthly')),
  tracking_company text,
  tracking_number text,
  tracking_url text,
  shipped_at timestamptz,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipments_doc ON public.shipments (doc_type, doc_id);

DROP TRIGGER IF EXISTS trg_shipments_updated_at ON public.shipments;
CREATE TRIGGER trg_shipments_updated_at
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_set_updated_at();

COMMENT ON TABLE public.shipments IS '物流包裹：單一單據可多包；每包各自 delivery_method 快照 + fee(客人實收) + cost(物流成本)';
COMMENT ON COLUMN public.shipments.fee IS '客人實收運費（預設帶 delivery_method.price）';
COMMENT ON COLUMN public.shipments.cost IS '實際物流成本（預設帶 delivery_method.cost，可逐包改）';

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admins_manage_shipments ON public.shipments;
CREATE POLICY admins_manage_shipments ON public.shipments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.system_role));

DROP POLICY IF EXISTS authenticated_read_shipments ON public.shipments;
CREATE POLICY authenticated_read_shipments ON public.shipments
  FOR SELECT TO authenticated USING (true);

-- ------------------------------------------------------------
-- 3. suppliers：物流公司身分牌
-- ------------------------------------------------------------
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS is_logistics_company boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.suppliers.is_logistics_company IS '物流公司身分牌：配送方式（logistics）依此篩選候選供應商';

-- ------------------------------------------------------------
-- 4. stores：預設配送方式 + 結構化地址
-- ------------------------------------------------------------
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS default_delivery_method_id uuid REFERENCES public.delivery_methods(id) ON DELETE SET NULL;
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS district text;

COMMENT ON COLUMN public.stores.default_delivery_method_id IS '門市預設配送方式（建立單據時預選）';
COMMENT ON COLUMN public.stores.postal_code IS '郵遞區號（3 碼或 3+2）';
COMMENT ON COLUMN public.stores.address IS '詳細地址（street）；city/district 另分段';

-- ------------------------------------------------------------
-- 5. 單據層欄位（orders / sales_notes / consignment_orders）
-- ------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_method_id uuid REFERENCES public.delivery_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_method_title text,
  ADD COLUMN IF NOT EXISTS delivery_method_code text,
  ADD COLUMN IF NOT EXISTS shipping_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_address jsonb;

ALTER TABLE public.sales_notes
  ADD COLUMN IF NOT EXISTS delivery_method_id uuid REFERENCES public.delivery_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_method_title text,
  ADD COLUMN IF NOT EXISTS delivery_method_code text,
  ADD COLUMN IF NOT EXISTS shipping_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_address jsonb;

ALTER TABLE public.consignment_orders
  ADD COLUMN IF NOT EXISTS delivery_method_id uuid REFERENCES public.delivery_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_method_title text,
  ADD COLUMN IF NOT EXISTS delivery_method_code text,
  ADD COLUMN IF NOT EXISTS shipping_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_address jsonb;

COMMENT ON COLUMN public.orders.shipping_fee IS '運費總額（客人實收，＝SUM(shipments.fee) 快照）';
COMMENT ON COLUMN public.orders.shipping_cost IS '物流成本總額（＝SUM(shipments.cost) 快照，內部）';
COMMENT ON COLUMN public.orders.shipping_address IS '收件地址快照 {recipient, phone, postal_code, city, district, address}（預填自 stores，不自動回填）';
COMMENT ON COLUMN public.sales_notes.shipping_fee IS '運費總額（客人實收，＝SUM(shipments.fee) 快照）';
COMMENT ON COLUMN public.sales_notes.shipping_cost IS '物流成本總額（＝SUM(shipments.cost) 快照，內部）';
COMMENT ON COLUMN public.sales_notes.shipping_address IS '收件地址快照 {recipient, phone, postal_code, city, district, address}';
COMMENT ON COLUMN public.consignment_orders.shipping_fee IS '運費總額（客人實收，＝SUM(shipments.fee) 快照）';
COMMENT ON COLUMN public.consignment_orders.shipping_cost IS '物流成本總額（＝SUM(shipments.cost) 快照，內部）';
COMMENT ON COLUMN public.consignment_orders.shipping_address IS '收件地址快照 {recipient, phone, postal_code, city, district, address}';

-- ------------------------------------------------------------
-- 6. Seed：內建「送貨」方式（既有單據預設補此方式）
-- ------------------------------------------------------------
INSERT INTO public.delivery_methods (code, name, type, price, cost, fee_payment, is_default, is_active, sort_order)
SELECT 'DELIVERY_DEFAULT', '送貨', 'delivery', 0, 0, 'one_time', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM public.delivery_methods WHERE code = 'DELIVERY_DEFAULT');

-- ------------------------------------------------------------
-- 7. 既有 shipping 產品 → delivery_methods（logistics）自動轉入
--    * 產品無供應商時建立物流採購商（身分牌）
--    * 每變體一筆方法：code=SKU、name=變體名、price=cost=變體批發價（實收先與成本持平，事後可調）
--    * 原 shipping 產品 is_hidden=true（被配送方式取代，保留歷史）
-- ------------------------------------------------------------
DO $$
DECLARE
  v_product record;
  v_variant record;
  v_logistics_supplier uuid;
BEGIN
  FOR v_product IN
    SELECT p.id, p.name, p.supplier_id, count(*) AS variant_count
    FROM public.products p
    JOIN public.product_variants pv ON pv.product_id = p.id
    WHERE p.item_type = 'shipping'
    GROUP BY p.id
    ORDER BY p.name
  LOOP
    v_logistics_supplier := NULL;
    -- 找出該商品所屬採購商；無則建立「{產品名去運費後綴}」物流採購商（整產品共用一間）
    IF v_product.supplier_id IS NOT NULL THEN
      SELECT s.id INTO v_logistics_supplier
      FROM public.suppliers s
      WHERE s.id = v_product.supplier_id;
    END IF;
    IF v_logistics_supplier IS NULL THEN
      INSERT INTO public.suppliers (
        name, is_active, is_logistics_company
      ) VALUES (
        nullif(regexp_replace(coalesce(v_product.name, '物流公司'), '運費$', ''), ''),
        true, true
      )
      RETURNING id INTO v_logistics_supplier;
    ELSE
      UPDATE public.suppliers SET is_logistics_company = true WHERE id = v_logistics_supplier;
    END IF;

    FOR v_variant IN
      SELECT pv.id, pv.name AS variant_name, pv.sku, pv.wholesale_price, pv.sort_order
      FROM public.product_variants pv
      WHERE pv.product_id = v_product.id
      ORDER BY pv.sort_order, pv.name
    LOOP
      INSERT INTO public.delivery_methods (
        code, name, type, supplier_id, price, cost, fee_payment, is_default, is_active, sort_order
      ) VALUES (
        v_variant.sku,
        coalesce(v_variant.variant_name, v_product.name),
        'logistics',
        v_logistics_supplier,
        coalesce(v_variant.wholesale_price, 0),
        coalesce(v_variant.wholesale_price, 0),
        'one_time',
        false,
        true,
        coalesce(v_variant.sort_order, 0)
      )
      ON CONFLICT (code) DO NOTHING;
    END LOOP;
  END LOOP;

  -- 原 shipping 產品隱藏，避免重複出現於目錄
  UPDATE public.products
  SET is_hidden = true
  WHERE item_type = 'shipping'
    AND EXISTS (
      SELECT 1 FROM public.delivery_methods dm
      JOIN public.product_variants pv ON pv.product_id = products.id AND pv.sku = dm.code
    );
END;
$$;

-- ------------------------------------------------------------
-- 8. 既有含運費品項的訂單 → shipments（doc_type='order'，每單一部落一包）
--    並回寫單據層 delivery 快照 / shipping_fee / shipping_cost
-- ------------------------------------------------------------
DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT o.id AS order_id, o.created_at, o.updated_at,
           count(*) FILTER (WHERE dm.id IS NOT NULL) AS mapped_methods,
           jsonb_agg(dm.id) AS method_ids,
           sum((oi.quantity * oi.unit_price)) AS fee_sum,
           sum((oi.quantity * oi.unit_cost)) AS cost_sum
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.products p ON p.id = oi.product_id AND p.item_type = 'shipping'
    LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
    LEFT JOIN public.delivery_methods dm ON dm.code = pv.sku
    WHERE o.shipping_fee = 0
    GROUP BY o.id
  LOOP
    IF v_row.method_ids IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.shipments (
      doc_type, doc_id, delivery_method_id, delivery_method_title, delivery_method_code,
      fee, cost, fee_payment, shipped_at, created_by
    ) VALUES (
      'order', v_row.order_id,
      (v_row.method_ids->>0)::uuid,
      (SELECT m.name FROM public.delivery_methods m WHERE m.id = (v_row.method_ids->>0)::uuid),
      (SELECT m.code FROM public.delivery_methods m WHERE m.id = (v_row.method_ids->>0)::uuid),
      coalesce(v_row.fee_sum, 0), coalesce(v_row.cost_sum, 0), 'one_time',
      coalesce(v_row.updated_at, v_row.created_at), NULL
    );

    UPDATE public.orders o
    SET delivery_method_id = (v_row.method_ids->>0)::uuid,
        delivery_method_title = (SELECT m.name FROM public.delivery_methods m WHERE m.id = (v_row.method_ids->>0)::uuid),
        delivery_method_code = (SELECT m.code FROM public.delivery_methods m WHERE m.id = (v_row.method_ids->>0)::uuid),
        shipping_fee = coalesce(v_row.fee_sum, 0),
        shipping_cost = coalesce(v_row.cost_sum, 0),
        updated_at = now()
    WHERE o.id = v_row.order_id;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 9. 既有單據預設補「送貨」方式 + 收件地址自 stores 快照
-- ------------------------------------------------------------
-- 9a. 訂單
UPDATE public.orders o
SET delivery_method_id = dt.id,
    delivery_method_title = dt.name,
    delivery_method_code = dt.code,
    shipping_address = (
      SELECT jsonb_build_object(
        'recipient', coalesce(s.name, ''),
        'phone', coalesce(s.phone, ''),
        'postal_code', coalesce(s.postal_code, ''),
        'city', coalesce(s.city, ''),
        'district', coalesce(s.district, ''),
        'address', coalesce(s.address, '')
      )
      FROM public.stores s WHERE s.id = o.store_id
    ),
    updated_at = now()
FROM public.delivery_methods dt
WHERE dt.code = 'DELIVERY_DEFAULT'
  AND o.delivery_method_id IS NULL;

-- 9b. 銷貨單
UPDATE public.sales_notes sn
SET delivery_method_id = dt.id,
    delivery_method_title = dt.name,
    delivery_method_code = dt.code,
    shipping_address = (
      SELECT jsonb_build_object(
        'recipient', coalesce(s.name, ''),
        'phone', coalesce(s.phone, ''),
        'postal_code', coalesce(s.postal_code, ''),
        'city', coalesce(s.city, ''),
        'district', coalesce(s.district, ''),
        'address', coalesce(s.address, '')
      )
      FROM public.stores s WHERE s.id = sn.store_id
    ),
    updated_at = now()
FROM public.delivery_methods dt
WHERE dt.code = 'DELIVERY_DEFAULT'
  AND sn.delivery_method_id IS NULL;

-- 9c. 寄賣單
UPDATE public.consignment_orders co
SET delivery_method_id = dt.id,
    delivery_method_title = dt.name,
    delivery_method_code = dt.code,
    shipping_address = (
      SELECT jsonb_build_object(
        'recipient', coalesce(s.name, ''),
        'phone', coalesce(s.phone, ''),
        'postal_code', coalesce(s.postal_code, ''),
        'city', coalesce(s.city, ''),
        'district', coalesce(s.district, ''),
        'address', coalesce(s.address, '')
      )
      FROM public.stores s WHERE s.id = co.store_id
    ),
    updated_at = now()
FROM public.delivery_methods dt
WHERE dt.code = 'DELIVERY_DEFAULT'
  AND co.delivery_method_id IS NULL;

COMMIT;