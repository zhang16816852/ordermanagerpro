-- 20260907000004 revoke_repair_order_summary
-- advisor ERROR lint `auth_users_exposed`：repair_order_summary VIEW 含 auth.users email，
-- 預設 expose 給 anon；前端從未使用該 view（查無 `.from('repair_order_summary')`），
-- 直接 REVOKE anon/authenticated 全數存取止血。
REVOKE ALL ON public.repair_order_summary FROM anon;
REVOKE ALL ON public.repair_order_summary FROM authenticated;