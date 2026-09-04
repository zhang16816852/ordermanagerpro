-- 銷貨單收款狀態：與收貨狀態 status 分離
-- payment_status (text) = unpaid | paid，預設 unpaid
alter table public.sales_notes
  add column if not exists payment_status text not null default 'unpaid'
  check (payment_status in ('unpaid', 'paid'));

-- 回填：凡 accounting_entries 有 reference_type='sales_note' 且 type='income' 且 payment_status='paid' 的銷貨單設為 paid
update public.sales_notes sn
set payment_status = 'paid'
where exists (
  select 1
  from public.accounting_entries ae
  where ae.reference_type = 'sales_note'
    and ae.reference_id = sn.id
    and ae.type = 'income'
    and ae.payment_status = 'paid'
);
