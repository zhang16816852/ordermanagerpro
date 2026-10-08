-- 補上 20261008000002 新增的 notification_outbox.bot_id 外鍵所需索引
-- （advisor: unindexed_foreign_keys，INFO 級；ON DELETE SET NULL 與按 bot 查詢皆受益）
CREATE INDEX IF NOT EXISTS idx_notification_outbox_bot_id
  ON public.notification_outbox (bot_id);
