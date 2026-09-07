-- 1. 修復 sync_sales_note_payment_status RPC：同時查 entry row 和 accounting_entry_references 子表
-- 解決「entry 的 reference_type/reference_id 為 null 但 references 子表有記錄」時 RPC 無法識別的問題
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
      where ae.type = 'income'
        and ae.payment_status in ('paid', 'partial')
        and (
          -- 路徑 A：entry row 直接綁定（維修單、已修復後的清單路徑）
          (ae.reference_type = 'sales_note' and ae.reference_id = p_sales_note_id)
          or
          -- 路徑 B：經由 accounting_entry_references 子表綁定（清單/銷貨單收款歷史路徑）
          exists (
            select 1
            from public.accounting_entry_references aer
            where aer.entry_id = ae.id
              and aer.reference_type = 'sales_note'
              and aer.reference_id = p_sales_note_id
          )
        )
    ) then 'paid'
    else 'unpaid'
  end
  where id = p_sales_note_id;
end;
$$;

revoke all on function public.sync_sales_note_payment_status(uuid) from public, anon;
grant execute on function public.sync_sales_note_payment_status(uuid) to authenticated;

-- 2. 新增 counterparty_name 欄位：記錄「對象」（店家名/供應商名/業務名）
ALTER TABLE public.accounting_entries ADD COLUMN IF NOT EXISTS counterparty_name text;

-- 3. 回填現有資料：從 accounting_entry_references 關聯到對應的實體名稱
-- 銷貨單 → 店家名
UPDATE public.accounting_entries ae
SET counterparty_name = s.store_name
FROM (
  SELECT aer.entry_id, st.name AS store_name
  FROM public.accounting_entry_references aer
  JOIN public.sales_notes sn ON sn.id = aer.reference_id::uuid
  JOIN public.stores st ON st.id = sn.store_id
  WHERE aer.reference_type = 'sales_note'
) s
WHERE ae.id = s.entry_id
  AND ae.counterparty_name IS NULL;

-- 採購單 → 供應商名
UPDATE public.accounting_entries ae
SET counterparty_name = s.supplier_name
FROM (
  SELECT aer.entry_id, sp.company_name AS supplier_name
  FROM public.accounting_entry_references aer
  JOIN public.purchase_orders po ON po.id = aer.reference_id::uuid
  LEFT JOIN public.suppliers sp ON sp.id = po.supplier_id
  WHERE aer.reference_type = 'purchase_order'
) s
WHERE ae.id = s.entry_id
  AND ae.counterparty_name IS NULL;

-- 維修單 → 客戶名
UPDATE public.accounting_entries ae
SET counterparty_name = r.customer_name
FROM (
  SELECT aer.entry_id, ro.customer_name
  FROM public.accounting_entry_references aer
  JOIN public.repair_orders ro ON ro.id = aer.reference_id::uuid
  WHERE aer.reference_type = 'repair_order'
) r
WHERE ae.id = r.entry_id
  AND ae.counterparty_name IS NULL;

-- 補償：從 description 推斷對象（已有描述但缺 counterparty 的歷史資料）
UPDATE public.accounting_entries
SET counterparty_name = substring(description from '銷貨單收款:\s*(.+)')
WHERE counterparty_name IS NULL
  AND description ~ '^銷貨單收款:\s*.+';

UPDATE public.accounting_entries
SET counterparty_name = substring(description from '維修收款.*?（(.+?)）')
WHERE counterparty_name IS NULL
  AND description ~ '維修收款.*（.+）';
