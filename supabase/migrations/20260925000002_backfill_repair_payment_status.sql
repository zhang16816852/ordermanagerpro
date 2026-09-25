-- 回填 repair_orders.payment_status
--
-- 背景：20260912000001 的回填只處理「當下已有分錄」的維修單；此後若透過
-- SalesNoteDetailDialog 的「登記收款」記錄維修單收款（該 mutation 當時只同步
-- sales_note、未同步 repair_order），維修單狀態會停留在 unpaid。
-- 本 migration 以與 sync_repair_order_payment_status 相同的判定規則全表重算，
-- 雙向修正（既補 paid 也收回多標的 paid），可重複執行。
--
-- 判定規則（與 public.sync_repair_order_payment_status 一致，勿自行變更）：
--   存在任一 type='income' 的會計分錄，且
--     路徑 A：entry row 的 reference_type='repair_order' 且 reference_id = 維修單
--     路徑 B：經 accounting_entry_references 子表綁定該維修單
--   → paid，否則 unpaid。

with expected as (
  select
    ro.id,
    case when exists (
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
    ) then 'paid' else 'unpaid' end as expected_status
  from public.repair_orders ro
)
update public.repair_orders ro
set payment_status = e.expected_status
from expected e
where e.id = ro.id
  and ro.payment_status is distinct from e.expected_status;
