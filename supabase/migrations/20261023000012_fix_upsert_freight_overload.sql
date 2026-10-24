-- ============================================================
-- P2 / M1b：修復 upsert_purchase_freight_cost 的 PostgREST overload 歧義
-- 檔名：20261023000012_fix_upsert_freight_overload.sql
-- 問題：20261023000003 建立 12 參數版本時，舊的 10 參數版本（缺少 currency/exchange_rate）
--       並未被 DROP，導致 PostgREST PGRST203「Could not choose the best candidate function」。
-- 修復：DROP 舊的 10 參數版本，只保留 12 參數版本。
-- 依賴：20261023000003 (purchase_freight_costs, upsert_purchase_freight_cost)
-- 可獨立驗證與回滾：是
-- ============================================================

DROP FUNCTION IF EXISTS public.upsert_purchase_freight_cost(
  uuid, uuid, text, numeric, uuid, uuid, text, date, text, uuid
);

-- ============================================================
-- End of migration 000012
-- ============================================================
