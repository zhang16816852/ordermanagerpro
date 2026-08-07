-- ============================================================
-- 最小權限原則（續）：寄賣流水號 trigger function 不再對 anon 開放（v1.5.2）
-- 背景：trgfn_generate_consignment_code 為 SECURITY DEFINER trigger function，
--   advisor 仍標記 anon 可執行。trigger function 只需對實際執行 INSERT 的角色
--   （authenticated）與 service_role 開放 EXECUTE，anon 無權寫入寄賣表，故無需權限。
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.trgfn_generate_consignment_code FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.trgfn_generate_consignment_code TO authenticated;
