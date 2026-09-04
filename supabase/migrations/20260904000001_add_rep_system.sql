-- 業務身分系統（system_role = 'rep'）主體
-- 跨店、非單店成員；ADMIN 統一管理店家與分配；
-- 業務可打單 / 編輯自己名下訂單 / 查看名下店家訂單與銷貨單。
-- 佣金 = (售價 - 業務成本) × commission_rate

-- 前置 migration：20260904000000_add_rep_system_role_enum（ALTER TYPE system_role ADD VALUE 'rep'）

-- ============================================================
-- A. 新表 rep_store_assignments（業務 ↔ 店家）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rep_store_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rep_id, store_id)
);
ALTER TABLE public.rep_store_assignments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_rep_store_assignments_rep ON public.rep_store_assignments(rep_id);
CREATE INDEX IF NOT EXISTS idx_rep_store_assignments_store ON public.rep_store_assignments(store_id);

-- ============================================================
-- B. 新表 rep_product_costs（業務自己的進貨成本）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rep_product_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  cost NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (rep_id, product_id, variant_id)
);
ALTER TABLE public.rep_product_costs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_rep_product_costs_rep ON public.rep_product_costs(rep_id);
CREATE INDEX IF NOT EXISTS idx_rep_product_costs_product ON public.rep_product_costs(product_id);

-- ============================================================
-- C. 欄位新增
-- ============================================================
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_orders_sales_rep ON public.orders(sales_rep_id);

-- ============================================================
-- D. Helper functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_rep(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = 'rep'::public.system_role
  );
$$;

CREATE OR REPLACE FUNCTION public.get_rep_commission_rate(_user_id UUID)
RETURNS NUMERIC
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT ur.commission_rate FROM public.user_roles ur
     WHERE ur.user_id = _user_id AND ur.role = 'rep'::public.system_role),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.is_rep_store(_user_id UUID, _store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.rep_store_assignments rsa ON rsa.rep_id = ur.user_id
    WHERE ur.user_id = _user_id
      AND ur.role = 'rep'::public.system_role
      AND rsa.store_id = _store_id
  );
$$;

-- ============================================================
-- E. RLS Policies（新表 + 既有表更新）
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage rep store assignments" ON public.rep_store_assignments;
CREATE POLICY "Admins can manage rep store assignments" ON public.rep_store_assignments
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Reps can view own assignments" ON public.rep_store_assignments;
CREATE POLICY "Reps can view own assignments" ON public.rep_store_assignments
  FOR SELECT USING (auth.uid() = rep_id);

DROP POLICY IF EXISTS "Admins can manage rep product costs" ON public.rep_product_costs;
CREATE POLICY "Admins can manage rep product costs" ON public.rep_product_costs
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Reps can view own product costs" ON public.rep_product_costs;
CREATE POLICY "Reps can view own product costs" ON public.rep_product_costs
  FOR SELECT USING (auth.uid() = rep_id);

-- stores：業務只讀名下店家
DROP POLICY IF EXISTS "Members can view their stores" ON public.stores;
CREATE POLICY "Members and reps can view their stores" ON public.stores
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin')
    OR public.is_store_member(auth.uid(), id)
    OR public.is_rep_store(auth.uid(), id)
  );

-- orders：INSERT 業務可在名下店家建立訂單
DROP POLICY IF EXISTS "Store members can create orders" ON public.orders;
CREATE POLICY "Members and reps can create orders" ON public.orders
  FOR INSERT WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (public.is_store_member(auth.uid(), store_id)
        AND public.get_store_role(auth.uid(), store_id) IN ('founder', 'manager', 'employee'))
    OR (public.is_rep(auth.uid()) AND public.is_rep_store(auth.uid(), store_id))
  );

-- orders：SELECT 業務可看自己建立（sales_rep_id）的訂單
DROP POLICY IF EXISTS "Store members can view their store orders" ON public.orders;
CREATE POLICY "Members and reps can view their orders" ON public.orders
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin')
    OR public.is_store_member(auth.uid(), store_id)
    OR sales_rep_id = auth.uid()
  );

-- orders：UPDATE 業務可編輯自己的訂單
DROP POLICY IF EXISTS "Store members can update pending orders" ON public.orders;
CREATE POLICY "Members reps and sales reps can update orders" ON public.orders
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'admin')
    OR (status = 'pending' AND public.is_store_member(auth.uid(), store_id))
    OR sales_rep_id = auth.uid()
  );

-- sales_notes：SELECT 業務可看名下店家的銷貨單
DROP POLICY IF EXISTS "Store members can view their sales notes" ON public.sales_notes;
CREATE POLICY "Members and reps can view their sales notes" ON public.sales_notes
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin')
    OR public.is_store_member(auth.uid(), store_id)
    OR public.is_rep_store(auth.uid(), store_id)
  );

-- order_items：SELECT 業務可看自己訂單的品項
DROP POLICY IF EXISTS "Store members can view their order items" ON public.order_items;
CREATE POLICY "Members and reps can view their order items" ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
      AND (public.has_role(auth.uid(), 'admin')
           OR public.is_store_member(auth.uid(), o.store_id)
           OR o.sales_rep_id = auth.uid())
    )
  );

-- order_items：INSERT 業務可在自己名下的訂單新增品項
DROP POLICY IF EXISTS "Store members can create order items" ON public.order_items;
CREATE POLICY "Members and reps can create order items" ON public.order_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
      AND (public.has_role(auth.uid(), 'admin')
           OR (public.is_store_member(auth.uid(), o.store_id)
               AND public.get_store_role(auth.uid(), o.store_id) IN ('founder', 'manager', 'employee'))
           OR o.sales_rep_id = auth.uid())
    )
  );

-- sales_note_items：SELECT 業務可看名下店家銷貨單的品項
DROP POLICY IF EXISTS "Store members can view their sales note items" ON public.sales_note_items;
CREATE POLICY "Members and reps can view their sales note items" ON public.sales_note_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sales_notes sn
      WHERE sn.id = sales_note_id
      AND (public.has_role(auth.uid(), 'admin')
           OR public.is_store_member(auth.uid(), sn.store_id)
           OR public.is_rep_store(auth.uid(), sn.store_id))
    )
  );

-- ============================================================
-- F. update_order_with_items 授權加固
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_order_with_items(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]',
  p_deleted_item_ids UUID[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF NOT (
      public.has_role(auth.uid(), 'admin')
      OR public.is_store_member(auth.uid(), v_order.store_id)
      OR v_order.sales_rep_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE orders
  SET notes = p_notes, updated_at = now()
  WHERE id = p_order_id;

  IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
    DELETE FROM order_items
    WHERE id = ANY(p_deleted_item_ids)
      AND order_id = p_order_id;
  END IF;

  UPDATE order_items oi
  SET quantity = (iu.elem->>'quantity')::INT,
      unit_price = (iu.elem->>'unit_price')::NUMERIC,
      sort_order = (iu.elem->>'sort_order')::INT,
      selected_model_name = (iu.elem->>'selected_model_name')::TEXT,
      updated_at = now()
  FROM (
    SELECT elem
    FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NOT NULL
  ) iu
  WHERE oi.id = (iu.elem->>'id')::UUID
    AND oi.order_id = p_order_id;

  INSERT INTO order_items (
    order_id, product_id, variant_id, quantity, unit_price,
    selected_model_name, store_id, sort_order
  )
  SELECT
    p_order_id,
    (elem->>'product_id')::UUID,
    NULLIF(elem->>'variant_id', '')::UUID,
    (elem->>'quantity')::INT,
    (elem->>'unit_price')::NUMERIC,
    NULLIF(elem->>'selected_model_name', ''),
    o.store_id,
    (elem->>'sort_order')::INT
  FROM jsonb_array_elements(p_items) AS elem
  CROSS JOIN orders o
  WHERE o.id = p_order_id
    AND (elem->>'id') IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;