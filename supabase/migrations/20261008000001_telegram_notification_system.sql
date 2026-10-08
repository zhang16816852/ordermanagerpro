-- Telegram 通知系統：銷貨單建立 → 推送至管理群組；單據回滾 → 收回/標記訊息
-- 派送機制：DB trigger 寫 notification_outbox（同交易、原子）+ net.http_post 非阻塞呼叫 Edge Function
-- Edge Function `telegram-notify` 以 service role 重查最新資料組訊息，回寫 chat_id / message_id

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────────────
-- 1. Outbox 資料表（記錄每一筆待發送/已發送通知）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  ref_type text,
  ref_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  chat_id text,
  message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status
  ON public.notification_outbox (status, created_at);

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_outbox_admin_all ON public.notification_outbox;
CREATE POLICY notification_outbox_admin_all ON public.notification_outbox
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

-- ─────────────────────────────────────────────────────────────
-- 2. webhook 共享密鑰（DB 持有；trigger 發送時帶入 header，Edge Function 以 service role 比對）
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.app_secrets (key, value)
SELECT 'telegram_webhook_secret', encode(extensions.gen_random_bytes(32), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM public.app_secrets WHERE key = 'telegram_webhook_secret');

-- ─────────────────────────────────────────────────────────────
-- 2b. 站內通知：寫給所有管理員（鏡射 handle_lifecycle_notifications 的挑選方式）
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admins(
  p_title text,
  p_message text,
  p_link text,
  p_store_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, store_id, title, message, link, read)
  SELECT p.id, p_store_id, p_title, p_message, p_link, false
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role = 'admin';
END;
$$;

REVOKE ALL ON FUNCTION public.notify_admins(text, text, text, uuid) FROM public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. 入列 + 呼叫 Edge Function
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_event_type text,
  p_ref_type text,
  p_ref_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_outbox_id uuid;
  v_secret text;
BEGIN
  INSERT INTO public.notification_outbox (event_type, ref_type, ref_id, payload)
  VALUES (p_event_type, p_ref_type, p_ref_id, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_outbox_id;

  SELECT value INTO v_secret
  FROM public.app_secrets
  WHERE key = 'telegram_webhook_secret';

  -- pg_net 為非阻塞（交易提交後才實際送出）；rollback 不會誤送
  PERFORM net.http_post(
    url := 'https://aweqytcelujpqezjitsk.supabase.co/functions/v1/telegram-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', COALESCE(v_secret, '')
    ),
    body := jsonb_build_object('outbox_id', v_outbox_id),
    timeout_milliseconds := 5000
  );

  RETURN v_outbox_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification(text, text, uuid, jsonb) FROM public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. Triggers on sales_notes
-- ─────────────────────────────────────────────────────────────
-- 3a. 建立銷貨單 → 佇列通知 + 站內通知
CREATE OR REPLACE FUNCTION public.trgfn_sales_note_notify_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_notification(
    'sales_note_created', 'sales_note', NEW.id,
    jsonb_build_object('code', NEW.code, 'store_id', NEW.store_id)
  );

  PERFORM public.notify_admins(
    '新銷貨單',
    '銷貨單 ' || COALESCE(NEW.code, NEW.id::text) || ' 已建立',
    '/admin/sales-notes',
    NEW.store_id
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trgfn_sales_note_notify_insert() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sales_note_notify_insert ON public.sales_notes;
CREATE TRIGGER trg_sales_note_notify_insert
  AFTER INSERT ON public.sales_notes
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_sales_note_notify_insert();

-- 3b. 回滾（真刪除）→ 佇列收回事件（帶原訊息 message_id）
CREATE OR REPLACE FUNCTION public.trgfn_sales_note_notify_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_notification(
    'sales_note_recalled', 'sales_note', OLD.id,
    jsonb_build_object('code', OLD.code)
  );
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trgfn_sales_note_notify_delete() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sales_note_notify_delete ON public.sales_notes;
CREATE TRIGGER trg_sales_note_notify_delete
  BEFORE DELETE ON public.sales_notes
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_sales_note_notify_delete();

-- ─────────────────────────────────────────────────────────────
-- 4. 即時站內通知：將 notifications 加入 realtime publication
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. 失敗重試（每 10 分鐘掃描 failed 且 attempts < 5）
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.retry_failed_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_row record;
BEGIN
  SELECT value INTO v_secret
  FROM public.app_secrets
  WHERE key = 'telegram_webhook_secret';

  FOR v_row IN
    SELECT id FROM public.notification_outbox
    WHERE status = 'failed' AND attempts < 5
    ORDER BY created_at
    LIMIT 20
  LOOP
    UPDATE public.notification_outbox
    SET status = 'pending', processed_at = NULL
    WHERE id = v_row.id;

    PERFORM net.http_post(
      url := 'https://aweqytcelujpqezjitsk.supabase.co/functions/v1/telegram-notify',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', COALESCE(v_secret, '')
      ),
      body := jsonb_build_object('outbox_id', v_row.id),
      timeout_milliseconds := 5000
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_failed_notifications() FROM public, anon, authenticated;

SELECT cron.schedule(
  'retry-failed-notifications',
  '*/10 * * * *',
  $$SELECT public.retry_failed_notifications()$$
);