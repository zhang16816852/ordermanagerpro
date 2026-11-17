-- 合併 direct_ship_order 至 direct_ship_orders
-- direct_ship_order 已無任何前端呼叫端（AdminOrderForm 改用 direct_ship_orders 單筆呼叫）
-- 本 migration 刪除舊函數以避免 PostgREST overload 歧義

DROP FUNCTION IF EXISTS public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text, jsonb, jsonb);