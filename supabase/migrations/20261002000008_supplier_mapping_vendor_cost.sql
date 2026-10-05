-- =============================================================================
-- 補齊 supplier_product_mappings.vendor_unit_cost（schema drift 修補）
-- -----------------------------------------------------------------------------
-- 問題：此欄位存在於遠端 DB 與 src/integrations/supabase/types.ts，但**所有**
--       本地 migration 從未建立它（已掃描 207 支）。推測是當初直接在遠端
--       ALTER TABLE 加的，未記入 migration。
--
-- 影響：全新環境執行 supabase db push 後，採購單「預算外品項」的廠商成本
--       預填（PurchaseProductPicker 的 ['po-vendor-costs', supplierId] query）
--       會因欄位不存在而整條查詢失敗，成本自動帶值功能完全失效。
--
-- 為什麼冪等：遠端已有此欄，若用 ADD COLUMN 會報 duplicate_column。故一律
--       IF NOT EXISTS，讓本地與遠端都能安全套用同一支檔案。
--
-- 型別對齊：既有型別為 numeric → 前端 types.ts 對應 number | null。
-- =============================================================================

ALTER TABLE public.supplier_product_mappings
  ADD COLUMN IF NOT EXISTS vendor_unit_cost numeric;

COMMENT ON COLUMN public.supplier_product_mappings.vendor_unit_cost IS
  '廠商成本（單價）。採購成本優先來源，優先於 product_variants.wholesale_price。';