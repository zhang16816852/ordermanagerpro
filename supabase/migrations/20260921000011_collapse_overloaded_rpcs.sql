-- ============================================================
-- 20260921000011_collapse_overloaded_rpcs.sql
-- 收斂多簽名 RPC 為單一簽名，根治 PostgREST PGRST203
-- （Could not choose the best candidate function）
-- ============================================================
-- 背景：Phase B/C 加配送參數時用 CREATE OR REPLACE FUNCTION，
--   但新簽名（尾端增參數）與舊簽名不同 → Postgres 不覆寫、
--   而是「新舊 overload 並存」。PostgREST 以具名參數解析時，
--   只要請求參數集合是多個 overload 的子集（例如前端省略
--   undefined 參數）就無法選出唯一函數 → PGRST203。
--   前例：correct_sales_note 原 5 參數版已於 20260911000009 DROP。
-- 做法：每個函數名只保留「最長、尾參數含 DEFAULT」的簽名
--   （語意超集，短呼叫仍可依 DEFAULT 解析），DROP 其餘短版。
--   前端零改動。已套用遠端後驗證：8 個函數名皆單一簽名、
--   authenticated GRANT 皆在、6 具名參數呼叫 direct_ship_order
--   於 BEGIN…ROLLBACK 內解析並正常執行。
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 出貨類（兩支 20260921000004/0006 已提供超集簽名）
-- ------------------------------------------------------------
DROP FUNCTION public.create_consignment_shipment_layer(uuid, uuid, jsonb, timestamptz, text, uuid);
DROP FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean);
DROP FUNCTION public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb);
DROP FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb);
DROP FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb, uuid, numeric, jsonb);

-- ------------------------------------------------------------
-- 庫存 / 內部工具類（保留版皆有 DEFAULT 尾參數）
-- ------------------------------------------------------------
DROP FUNCTION public.adjust_inventory(uuid, integer, uuid);
DROP FUNCTION public.receive_purchase_items(jsonb);
DROP FUNCTION public.bump_data_version(text);
-- compare_product_row：4 參數版為純相容 wrapper（body 僅委派
-- 3 參數主邏輯、未用 p_brand_id、無任何函數引用），直接 DROP。
DROP FUNCTION public.compare_product_row(text, text, text, uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;