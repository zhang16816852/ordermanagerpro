-- 回填收款狀態：比照 sync_sales_note_payment_status 的判定（entry row 或 references 子表任一已入帳 paid/partial income）
-- 修復「從銷貨單詳情登記收款時把其他單據加進清單、但送出後只同步第一張單據」造成的欠收標記（2026-09-23）
update public.sales_notes sn
set payment_status = case
  when exists (
    select 1
    from public.accounting_entries ae
    where ae.type = 'income'
      and ae.payment_status in ('paid', 'partial')
      and (
        (ae.reference_type = 'sales_note' and ae.reference_id = sn.id)
        or exists (
          select 1
          from public.accounting_entry_references aer
          where aer.entry_id = ae.id
            and aer.reference_type = 'sales_note'
            and aer.reference_id = sn.id
        )
      )
  ) then 'paid'
  else 'unpaid'
end;

-- 補齊 counterparty_name（僅 NULL）：entry row 直接綁定但先前未回填的銷貨單
update public.accounting_entries ae
set counterparty_name = st.name
from public.sales_notes sn
join public.stores st on st.id = sn.store_id
where ae.reference_type = 'sales_note'
  and ae.reference_id = sn.id
  and ae.counterparty_name is null;

-- 補齊 counterparty_name：entry row 直接綁定但先前未回填的採購單
update public.accounting_entries ae
set counterparty_name = sp.name
from public.purchase_orders po
left join public.suppliers sp on sp.id = po.supplier_id
where ae.reference_type = 'purchase_order'
  and ae.reference_id = po.id
  and ae.counterparty_name is null;

-- 補齊 counterparty_name：entry row 直接綁定但先前未回填的維修單
update public.accounting_entries ae
set counterparty_name = ro.customer_name
from public.repair_orders ro
where ae.reference_type = 'repair_order'
  and ae.reference_id = ro.id
  and ae.counterparty_name is null;