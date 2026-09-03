-- ============================================================
-- 移除過時的 delete_sales_note overload (p_warehouse_id param)
--
-- 現況：live DB 同時存在兩個 overload
--   1. delete_sales_note(uuid)                        —— 現行版本（consignment_system_v1）
--   2. delete_sales_note(uuid, uuid)                  —— 過時（add_warehouse_id_param 時代引入）
-- PostgREST 無法從單一參數呼叫解析兩個簽章 → HTTP 300，導致銷貨單無法刪除。
-- 此 migration 移除過時簽章，保留單一 (uuid) 簽章。
-- ============================================================
DROP FUNCTION IF EXISTS public.delete_sales_note(p_sales_note_id uuid, p_warehouse_id uuid);