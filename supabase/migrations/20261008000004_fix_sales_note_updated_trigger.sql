-- 移除 blanket sales_note_updated trigger（改為僅 correct_sales_note 明確 enqueue）
DROP TRIGGER IF EXISTS trg_sales_note_notify_update ON public.sales_notes;
DROP FUNCTION IF EXISTS public.trgfn_sales_note_notify_update();
