-- P0.1: 移除 shipping_pool 的 UNIQUE 索引，允許同一 order_item 分批出貨
DROP INDEX IF EXISTS public.idx_shipping_pool_order_item;

-- P1.1: 移除 handle_sales_note_shipped 觸發器（前端 shipMutation 已手動更新 order_items，造成雙重邏輯）
DROP TRIGGER IF EXISTS on_sales_note_shipped ON public.sales_notes;
DROP FUNCTION IF EXISTS public.handle_sales_note_shipped;
