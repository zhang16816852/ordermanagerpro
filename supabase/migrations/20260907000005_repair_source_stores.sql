-- 20260907000005 repair_source_stores
-- FixEngineer 建單時可指定「來源店家」（幫店家建案）。
-- stores 表 RLS 僅授權 admin / 店成員 / 業務（業務需 is_rep_store），
-- FixEngineer 讀不到；故新增 SECURITY DEFINER RPC，只回傳最小欄位，
-- 且僅 admin / fixengineer 兩角色有內容。
CREATE OR REPLACE FUNCTION public.list_repair_source_stores()
RETURNS TABLE (id UUID, name TEXT, code TEXT, brand TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, code, brand
  FROM public.stores
  WHERE public.has_role(auth.uid(), 'admin'::public.system_role)
     OR public.has_role(auth.uid(), 'fixengineer'::public.system_role)
  ORDER BY name, code;
$$;

REVOKE ALL ON FUNCTION public.list_repair_source_stores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_repair_source_stores() TO authenticated;