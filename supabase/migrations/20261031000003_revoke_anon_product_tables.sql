-- =============================================================================
-- 收斂匿名對 products/product_variants/store_products/stores 的直接讀取權限
-- -----------------------------------------------------------------------------
-- 目的：公開店面一律走 get_public_* SECURITY DEFINER RPC（欄位白名單），
--       不應讓匿名持 anon key 直讀成本/個資欄位。
-- 範圍：僅 REVOKE anon 的 table-level SELECT，不動 authenticated/RLS，
--       避免影響既有後台/門市功能。
-- =============================================================================
REVOKE SELECT ON public.products FROM anon;
REVOKE SELECT ON public.product_variants FROM anon;
REVOKE SELECT ON public.store_products FROM anon;
REVOKE SELECT ON public.stores FROM anon;