-- 維修接案人清單 RPC
-- 店家端「發布維修單給特定接案人」需要可列舉的接案人清單。
-- 現階段接案人 = system_role 'admin' 的使用者（平台擁有者）；
-- 對外開放後可換成市場媒合（見 AGENTS.md 架構摘要）。
-- 授權範圍最小化：僅回傳 id / email / full_name，不暴露其他欄位。

CREATE OR REPLACE FUNCTION public.list_repair_contractors()
RETURNS TABLE (
  id        UUID,
  email     TEXT,
  full_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.email, p.full_name
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role = 'admin'::public.system_role
  ORDER BY p.full_name NULLS LAST, p.email;
$$;

REVOKE ALL ON FUNCTION public.list_repair_contractors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_repair_contractors() TO authenticated;