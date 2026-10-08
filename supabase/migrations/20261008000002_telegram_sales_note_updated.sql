-- Telegram 通知系統（追加）：
--   1. 多 bot 預留表 notification_bots（含 nullable bot_token，env 仍為現行來源）
--   2. notification_outbox.bot_id（記錄實際使用之 bot）
--   3. sales_note_updated 事件：sales_notes AFTER UPDATE → 佇列更新事件 + 站內通知
--
-- 說明：correct_sales_note 修正銷貨單時，唯一保證會變的欄位是 sales_notes.updated_at，
--       故採 AFTER UPDATE 全面觸發（涵蓋所有修正路徑）。Edge Function 以
--       editMessageText 更新原訊息；`message is not modified` 視為無事可做並靜默略過。

-- ─────────────────────────────────────────────────────────────
-- 1. 通知 bot 設定表（多 bot 預留；現行 bot_token/chat 仍可留空並 fallback env）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'telegram',
  bot_token text,
  chat_id text,
  event_types text[] NOT NULL DEFAULT '{}'::text[],
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 每個 channel 至多一筆預設
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_bots_channel_default
  ON public.notification_bots (channel)
  WHERE is_default;

ALTER TABLE public.notification_bots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_bots_admin_all ON public.notification_bots;
CREATE POLICY notification_bots_admin_all ON public.notification_bots
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

-- updated_at 自動維護
DROP TRIGGER IF EXISTS trg_notification_bots_set_updated_at ON public.notification_bots;
CREATE TRIGGER trg_notification_bots_set_updated_at
  BEFORE UPDATE ON public.notification_bots
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_set_updated_at();

-- 預設 bot（token/chat_id 留 NULL → Edge Function fallback env）
INSERT INTO public.notification_bots (name, channel, is_default, is_active)
SELECT '管理群組', 'telegram', true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_bots WHERE channel = 'telegram' AND is_default
);

-- ─────────────────────────────────────────────────────────────
-- 2. outbox 記錄實際使用之 bot
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS bot_id uuid REFERENCES public.notification_bots(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. sales_note_updated（修正銷貨單 → 更新原訊息 + 站內通知）
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trgfn_sales_note_notify_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_notification(
    'sales_note_updated', 'sales_note', NEW.id,
    jsonb_build_object('code', NEW.code, 'store_id', NEW.store_id)
  );

  PERFORM public.notify_admins(
    '銷貨單已更新',
    '銷貨單 ' || COALESCE(NEW.code, NEW.id::text) || ' 已更新',
    '/admin/sales-notes',
    NEW.store_id
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trgfn_sales_note_notify_update() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sales_note_notify_update ON public.sales_notes;
CREATE TRIGGER trg_sales_note_notify_update
  AFTER UPDATE ON public.sales_notes
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_sales_note_notify_update();