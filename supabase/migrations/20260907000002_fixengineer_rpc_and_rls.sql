-- ============================================================
-- 20260907000002 FixEngineer（維修人員）角色：
--   - list_repair_contractors 改回傳 system_role='fixengineer' 的使用者
--   - 新增能見度 helper：can_access_repair_order
--   - repair_orders 及其子表 RLS 加入接單人隔離
-- ============================================================

-- ------------------------------------------------------------
-- 1. helper：維修單能見度
--    可見 = 店成員（整店） OR 系統 admin（全部） OR
--           FixEngineer（待接案 assigned_to IS NULL，或自己已接 single）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_repair_order(p_order public.repair_orders)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
       p_order.store_id IS NULL
    OR public.is_store_member(auth.uid(), p_order.store_id)
    OR public.has_role(auth.uid(), 'admin'::public.system_role)
    OR (
         public.has_role(auth.uid(), 'fixengineer'::public.system_role)
         AND (p_order.assigned_to IS NULL OR p_order.assigned_to = auth.uid())
       )
$$;

REVOKE ALL ON FUNCTION public.can_access_repair_order(public.repair_orders) FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- 2. list_repair_contractors 改回傳 fixengineer 使用者
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_repair_contractors()
RETURNS TABLE (
  id        UUID,
  email     TEXT,
  full_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.email, p.full_name
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role = 'fixengineer'::public.system_role
  ORDER BY p.full_name NULLS LAST, p.email;
$$;

REVOKE ALL ON FUNCTION public.list_repair_contractors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_repair_contractors() TO authenticated;

-- ------------------------------------------------------------
-- 3. repair_orders RLS：加入 FixEngineer 接單人隔離
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view repair orders in their stores" ON public.repair_orders;
CREATE POLICY "Users can view repair orders in their stores"
  ON public.repair_orders FOR SELECT
  TO authenticated
  USING (public.can_access_repair_order(repair_orders));

DROP POLICY IF EXISTS "Users can update repair orders in their stores" ON public.repair_orders;
CREATE POLICY "Users can update repair orders in their stores"
  ON public.repair_orders FOR UPDATE
  TO authenticated
  USING (public.can_access_repair_order(repair_orders));

-- INSERT：店成員 / admin；FixEngineer 可自建（assigned_to = 自己）
DROP POLICY IF EXISTS "Users can insert repair orders" ON public.repair_orders;
CREATE POLICY "Users can insert repair orders"
  ON public.repair_orders FOR INSERT
  TO authenticated
  WITH CHECK (
       store_id IS NULL
    OR is_store_member(auth.uid(), store_id)
    OR has_role(auth.uid(), 'admin'::public.system_role)
    OR (
         has_role(auth.uid(), 'fixengineer'::public.system_role)
         AND assigned_to = auth.uid()
       )
  );

-- ------------------------------------------------------------
-- 4. 子表 RLS：repair_order_items / repair_device_checklists / repair_order_status_history
--    統一改用 can_access_repair_order
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view items of accessible orders" ON public.repair_order_items;
CREATE POLICY "Users can view items of accessible orders"
  ON public.repair_order_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.repair_orders ro
    WHERE ro.id = repair_order_items.repair_order_id
      AND public.can_access_repair_order(ro)
  ));

DROP POLICY IF EXISTS "Users can insert items to accessible orders" ON public.repair_order_items;
CREATE POLICY "Users can insert items to accessible orders"
  ON public.repair_order_items FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.repair_orders ro
    WHERE ro.id = repair_order_items.repair_order_id
      AND public.can_access_repair_order(ro)
  ));

DROP POLICY IF EXISTS "Users can update items of accessible orders" ON public.repair_order_items;
CREATE POLICY "Users can update items of accessible orders"
  ON public.repair_order_items FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.repair_orders ro
    WHERE ro.id = repair_order_items.repair_order_id
      AND public.can_access_repair_order(ro)
  ));

DROP POLICY IF EXISTS "Users can delete items of accessible orders" ON public.repair_order_items;
CREATE POLICY "Users can delete items of accessible orders"
  ON public.repair_order_items FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.repair_orders ro
    WHERE ro.id = repair_order_items.repair_order_id
      AND public.can_access_repair_order(ro)
  ));

DROP POLICY IF EXISTS "Users can view repair device checklists" ON public.repair_device_checklists;
CREATE POLICY "Users can view repair device checklists"
  ON public.repair_device_checklists FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.repair_orders ro
    WHERE ro.id = repair_device_checklists.repair_order_id
      AND public.can_access_repair_order(ro)
  ));

DROP POLICY IF EXISTS "Users can insert repair device checklists" ON public.repair_device_checklists;
CREATE POLICY "Users can insert repair device checklists"
  ON public.repair_device_checklists FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.repair_orders ro
    WHERE ro.id = repair_device_checklists.repair_order_id
      AND public.can_access_repair_order(ro)
  ));

DROP POLICY IF EXISTS "Users can update repair device checklists" ON public.repair_device_checklists;
CREATE POLICY "Users can update repair device checklists"
  ON public.repair_device_checklists FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.repair_orders ro
    WHERE ro.id = repair_device_checklists.repair_order_id
      AND public.can_access_repair_order(ro)
  ));

DROP POLICY IF EXISTS "Users can delete repair device checklists" ON public.repair_device_checklists;
CREATE POLICY "Users can delete repair device checklists"
  ON public.repair_device_checklists FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.repair_orders ro
    WHERE ro.id = repair_device_checklists.repair_order_id
      AND public.can_access_repair_order(ro)
  ));

DROP POLICY IF EXISTS "Users can view status history of accessible orders" ON public.repair_order_status_history;
CREATE POLICY "Users can view status history of accessible orders"
  ON public.repair_order_status_history FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.repair_orders ro
    WHERE ro.id = repair_order_status_history.repair_order_id
      AND public.can_access_repair_order(ro)
  ));