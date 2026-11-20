-- 維修單狀態變更歷史：補齊 trigger + RLS INSERT policy（2026-11-19）
-- 1. repair_orders 補 updated_by 欄位（若不存在）
ALTER TABLE public.repair_orders
  ADD COLUMN IF NOT EXISTS updated_by UUID;

-- 2. 重發 log_repair_status_change：使用 auth.uid() 作為 changed_by，避免 updated_by 未填
CREATE OR REPLACE FUNCTION public.log_repair_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.repair_order_status_history (repair_order_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status::TEXT, NEW.status::TEXT, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_repair_orders_status_history ON public.repair_orders;
CREATE TRIGGER trg_repair_orders_status_history
  AFTER UPDATE OF status ON public.repair_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.log_repair_status_change();

-- 3. RLS：允許 INSERT status history（admin / store member / assigned fixengineer）
DROP POLICY IF EXISTS "Users can insert status history of accessible orders" ON public.repair_order_status_history;
CREATE POLICY "Users can insert status history of accessible orders"
  ON public.repair_order_status_history FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.system_role)
    OR EXISTS (
      SELECT 1 FROM public.repair_orders ro
      WHERE ro.id = repair_order_status_history.repair_order_id
        AND (
          public.is_store_member(auth.uid(), ro.store_id)
          OR ro.assigned_to = auth.uid()
        )
    )
  );

-- 4. 修正 deduct_repair_part_stock GRANT 簽名（7 參數）
REVOKE ALL ON FUNCTION public.deduct_repair_part_stock(UUID, UUID, UUID, UUID, INTEGER, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_repair_part_stock(UUID, UUID, UUID, UUID, INTEGER, UUID, UUID) TO authenticated;