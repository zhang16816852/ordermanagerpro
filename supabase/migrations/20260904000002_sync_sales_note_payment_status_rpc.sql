-- 銷貨單收款狀態：統一 RPC，計算該銷貨單是否有任一「已付款」收入分錄
-- 供付款 / 回退 / 刪除記錄三種流程連動更新 sales_notes.payment_status
create or replace function public.sync_sales_note_payment_status(p_sales_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_sales_note_id is null then
    return;
  end if;

  update public.sales_notes
  set payment_status = case
    when exists (
      select 1
      from public.accounting_entries ae
      where ae.reference_type = 'sales_note'
        and ae.reference_id = p_sales_note_id
        and ae.type = 'income'
        and ae.payment_status in ('paid', 'partial')
    ) then 'paid'
    else 'unpaid'
  end
  where id = p_sales_note_id;
end;
$$;

revoke all on function public.sync_sales_note_payment_status(uuid) from public, anon;
grant execute on function public.sync_sales_note_payment_status(uuid) to authenticated;
