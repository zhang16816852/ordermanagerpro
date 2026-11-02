-- ═══════════════════════════════════════════════════════════════
-- 客戶對帳單 Telegram 通知：建立對帳單時推送標題＋總單數＋總金額＋網址
-- ═══════════════════════════════════════════════════════════════

-- 1. 專用 bot 記錄（event_types 僅 customer_statement_created）
INSERT INTO public.notification_bots (name, channel, bot_token, chat_id, event_types, is_default, is_active)
VALUES (
  '對帳單通知 Bot',
  'telegram',
  '9263545712:AAH1QtH78n48sCeiOIb-udLVs_aucA2DXYE',
  '954855435',
  ARRAY['customer_statement_created'],
  false,
  true
)
ON CONFLICT DO NOTHING;

-- 2. trigger function：建立對帳單 → 佇列通知 + 站內通知
CREATE OR REPLACE FUNCTION public.trgfn_customer_statement_notify_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_notification(
    'customer_statement_created', 'customer_statement', NEW.id,
    jsonb_build_object('title', NEW.title)
  );

  PERFORM public.notify_admins(
    '新客戶對帳單',
    '對帳單 ' || COALESCE(NEW.title, NEW.id::text) || ' 已建立',
    '/admin/sales-notes',
    NULL
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trgfn_customer_statement_notify_insert() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_customer_statement_notify_insert ON public.customer_statement_shares;
CREATE TRIGGER trg_customer_statement_notify_insert
  AFTER INSERT ON public.customer_statement_shares
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_customer_statement_notify_insert();