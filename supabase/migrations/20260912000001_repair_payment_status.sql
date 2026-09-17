-- 維修單收款狀態：repair_orders.payment_status
-- 對齊 sales_notes 慣例，提供列表/詳情顯示已收款/未收款，並以會計分錄為單一事實來源
alter table public.repair_orders
  add column if not exists payment_status text not null default 'unpaid';

-- 同步 RPC：只要有任一「維修收款」income 分錄（entry row 或 references 子表兩路徑）即視為已收款
create or replace function public.sync_repair_order_payment_status(p_repair_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_repair_order_id is null then
    return;
  end if;

  update public.repair_orders
  set payment_status = case
    when exists (
      select 1
      from public.accounting_entries ae
      where ae.type = 'income'
        and (
          -- 路徑 A：entry row 直接綁定
          (ae.reference_type = 'repair_order' and ae.reference_id = p_repair_order_id)
          or
          -- 路徑 B：經由 accounting_entry_references 子表綁定
          exists (
            select 1
            from public.accounting_entry_references aer
            where aer.entry_id = ae.id
              and aer.reference_type = 'repair_order'
              and aer.reference_id = p_repair_order_id
          )
        )
    ) then 'paid'
    else 'unpaid'
  end
  where id = p_repair_order_id;
end;
$$;

revoke all on function public.sync_repair_order_payment_status(uuid) from public, anon;
grant execute on function public.sync_repair_order_payment_status(uuid) to authenticated;

-- 回填：凡有維修收款分錄的既有維修單標記為已收款
update public.repair_orders ro
set payment_status = 'paid'
where exists (
  select 1
  from public.accounting_entries ae
  where ae.type = 'income'
    and (
      (ae.reference_type = 'repair_order' and ae.reference_id = ro.id)
      or exists (
        select 1
        from public.accounting_entry_references aer
        where aer.entry_id = ae.id
          and aer.reference_type = 'repair_order'
          and aer.reference_id = ro.id
      )
    )
);