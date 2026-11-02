-- ═══════════════════════════════════════════════════════════════
-- 客戶對帳單 Telegram 通知：刪除時收回原訊息
-- ═══════════════════════════════════════════════════════════════

-- 1. 專用 bot 補上 customer_statement_recalled 事件
UPDATE public.notification_bots
SET event_types = ARRAY['customer_statement_created', 'customer_statement_updated', 'customer_statement_recalled']
WHERE name = '對帳單通知 Bot'
  AND channel = 'telegram';

-- 2. trigger function：刪除 → 佇列收回事件
CREATE OR REPLACE FUNCTION public.trgfn_customer_statement_notify_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_notification(
    'customer_statement_recalled', 'customer_statement', OLD.id,
    jsonb_build_object('title', OLD.title)
  );
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trgfn_customer_statement_notify_delete() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_customer_statement_notify_delete ON public.customer_statement_shares;
CREATE TRIGGER trg_customer_statement_notify_delete
  BEFORE DELETE ON public.customer_statement_shares
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_customer_statement_notify_delete();