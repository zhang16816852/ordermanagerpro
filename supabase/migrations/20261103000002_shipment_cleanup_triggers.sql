-- 20261103000002_shipment_cleanup_triggers.sql
-- 根源修復：刪除單據時自動清理對應的包裹記錄（shipments），防止孤兒殘留。
--   1. 建立 BEFORE DELETE trigger 於 sales_notes / orders / consignment_orders
--   2. 清理現有孤兒記錄

BEGIN;

-- 1. Trigger function：刪除單據時自動清理對應包裹
CREATE OR REPLACE FUNCTION public.trgfn_cleanup_shipments_on_doc_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  DELETE FROM public.shipments
  WHERE doc_type = TG_ARGV[0]
    AND doc_id = OLD.id;
  RETURN OLD;
END;
$function$;

-- 2. 建立 trigger（冪等：先 DROP 再 CREATE）
DROP TRIGGER IF EXISTS trg_cleanup_shipments_on_sales_note_delete ON public.sales_notes;
CREATE TRIGGER trg_cleanup_shipments_on_sales_note_delete
  BEFORE DELETE ON public.sales_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.trgfn_cleanup_shipments_on_doc_delete('sales_note');

DROP TRIGGER IF EXISTS trg_cleanup_shipments_on_order_delete ON public.orders;
CREATE TRIGGER trg_cleanup_shipments_on_order_delete
  BEFORE DELETE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trgfn_cleanup_shipments_on_doc_delete('order');

DROP TRIGGER IF EXISTS trg_cleanup_shipments_on_consignment_delete ON public.consignment_orders;
CREATE TRIGGER trg_cleanup_shipments_on_consignment_delete
  BEFORE DELETE ON public.consignment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trgfn_cleanup_shipments_on_doc_delete('consignment_order');

-- 3. 清理現有孤兒記錄
DELETE FROM public.shipments
WHERE (doc_type = 'sales_note' AND doc_id NOT IN (SELECT id FROM public.sales_notes))
   OR (doc_type = 'order' AND doc_id NOT IN (SELECT id FROM public.orders))
   OR (doc_type = 'consignment_order' AND doc_id NOT IN (SELECT id FROM public.consignment_orders));

COMMIT;
