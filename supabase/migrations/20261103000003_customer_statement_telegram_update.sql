-- ═══════════════════════════════════════════════════════════════
-- 客戶對帳單 Telegram 通知：標題/日期變更時更新原訊息
-- ═══════════════════════════════════════════════════════════════

-- 1. 專用 bot 補上 customer_statement_updated 事件
UPDATE public.notification_bots
SET event_types = ARRAY['customer_statement_created', 'customer_statement_updated']
WHERE name = '對帳單通知 Bot'
  AND channel = 'telegram';

-- 2. trigger function：標題或日期變更 → 佇列更新事件
CREATE OR REPLACE FUNCTION public.trgfn_customer_statement_notify_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 僅在標題或日期區間實際變更時觸發
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.date_from IS DISTINCT FROM OLD.date_from
     OR NEW.date_to IS DISTINCT FROM OLD.date_to THEN
    PERFORM public.enqueue_notification(
      'customer_statement_updated', 'customer_statement', NEW.id,
      jsonb_build_object('title', NEW.title)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trgfn_customer_statement_notify_update() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_customer_statement_notify_update ON public.customer_statement_shares;
CREATE TRIGGER trg_customer_statement_notify_update
  AFTER UPDATE ON public.customer_statement_shares
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_customer_statement_notify_update();