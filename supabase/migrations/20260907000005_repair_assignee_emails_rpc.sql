-- RPC：回傳維修單相關使用者（assigned_to / created_by / changed_by）的 email / full_name 對照表
-- 用途：auth.users 在 auth schema，PostgREST 預設 db-schemas 不含 auth，
--       無法以 `table:col(email)` embed（PGRST200），改由這支 RPC 提供 id → email/full_name 地圖。
-- 僅 authenticated 可執行；SECURITY DEFINER 繞過 profiles RLS 唯讀列出參與維修流程的使用者。
create or replace function public.repair_assignee_emails()
returns table (user_id uuid, email text, full_name text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct u.id::uuid as user_id, u.email::text as email, p.full_name::text as full_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id in (select assigned_to from public.repair_orders where assigned_to is not null)
     or u.id in (select created_by from public.repair_orders where created_by is not null)
     or u.id in (select changed_by from public.repair_order_status_history where changed_by is not null);
$$;

revoke all on function public.repair_assignee_emails() from public, anon;
grant execute on function public.repair_assignee_emails() to authenticated;