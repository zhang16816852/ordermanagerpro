-- 20260911000001_add_order_item_source_tracking.sql
-- 新增 order_items 來源追蹤欄位
-- source_pool_id：追蹤該項目來源於哪個 shipping_pool 列
-- source_order_id：追蹤該項目原本屬於哪個訂單（用於 A+B 訂單合併時的來源歸屬）

COMMENT ON COLUMN public.order_items.source_pool_id IS '追蹤該 order_item 來源之 shipping_pool id，用於追蹤從 pool 歸還的項目';
COMMENT ON COLUMN public.order_items.source_order_id IS '追蹤該 order_item 原本屬於之來源訂單 id，用於 A+B 訂單合併時正確歸屬項目';

-- 新增欄位，預設為 NULL（舊資料不影響）
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS source_pool_id UUID;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS source_order_id UUID;

-- 更新 source_pool_id：針對目前還在 shipping_pool 中的項目，記錄 pool id
-- 這有助於後續的回滽操作知道這個項目原本來自哪個 pool 列
UPDATE public.order_items
SET source_pool_id = sp.id
FROM public.shipping_pool sp
WHERE public.order_items.id = sp.order_item_id
  AND public.order_items.source_pool_id IS NULL;

-- source_order_id 暫時留空（NULL），由後續的 RPC 邏輯在處理 ship_from_pool 和 reverse_consignment_shipment 時填入
-- 這樣可以避免背對錯誤的資料（因為現有資料可能已經經過複雜的轉換）
-- 前端/RPC 在新增項目時會主動設定此欄位

-- 驗證：顯示新增欄位與更新計數
SELECT 
  'order_items' AS table_name,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'order_items' AND column_name IN ('source_pool_id', 'source_order_id')) AS new_columns_count,
  (SELECT count(*) FROM public.order_items WHERE source_pool_id IS NOT NULL) AS items_with_pool_tracking,
  (SELECT count(*) FROM public.order_items WHERE source_order_id IS NOT NULL) AS items_with_order_tracking;