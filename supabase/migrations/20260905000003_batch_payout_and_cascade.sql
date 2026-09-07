-- 批次佣金發放與會計刪除連動（ON DELETE CASCADE）遷移

-- 1. 為 rep_commission_payouts 增加 entry_id 欄位，綁定 accounting_entries ON DELETE CASCADE
-- 這樣當管理員在會計模組刪除該筆收支紀錄時，對應的發放記錄會自動刪除，業務頁面即時同步。
ALTER TABLE public.rep_commission_payouts
  ADD COLUMN IF NOT EXISTS entry_id UUID REFERENCES public.accounting_entries(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_rep_commission_payouts_entry ON public.rep_commission_payouts(entry_id);

-- 2. 更新單筆發放 RPC：先建會計分錄，再建發放記錄並回填 entry_id
CREATE OR REPLACE FUNCTION public.register_rep_commission_payout(
  p_rep_id uuid,
  p_sales_note_id uuid,
  p_paid_date date,
  p_note text,
  p_account_id uuid,
  p_category_id uuid,
  p_description text,
  p_created_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
declare
  v_rate numeric;
  v_amount numeric;
  v_payout_id uuid;
  v_entry_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception '僅限管理員操作';
  end if;

  if p_sales_note_id is null or p_paid_date is null or p_account_id is null then
    raise exception '缺少必要參數';
  end if;

  -- 檢查是否已發放過
  if exists (select 1 from public.rep_commission_payouts where rep_id = p_rep_id and sales_note_id = p_sales_note_id) then
    raise exception '此銷貨單已發放過分潤';
  end if;

  -- 佣金比例
  select ur.commission_rate into v_rate
  from public.user_roles ur
  where ur.user_id = p_rep_id and ur.role = 'rep';
  v_rate := coalesce(v_rate, 0);
  if v_rate <= 0 then
    raise exception '此業務未設定佣金比例';
  end if;

  -- 重算佣金 = Σ max(0, (售價 − 成本) × 數量) × 比例
  with items as (
    select
      sni.quantity * oi.unit_price as sales_total,
      coalesce(rc.cost, 0) * sni.quantity as cost_total
    from public.sales_note_items sni
    join public.order_items oi on oi.id = sni.order_item_id
    left join lateral (
      select coalesce(
        (select cost from public.rep_product_costs c2
          where c2.rep_id = p_rep_id and c2.product_id = oi.product_id
            and c2.variant_id = oi.variant_id
          limit 1),
        (select cost from public.rep_product_costs c3
          where c3.rep_id = p_rep_id and c3.product_id = oi.product_id
            and c3.variant_id is null
          limit 1),
        0
      ) as cost
    ) rc on true
    where sni.sales_note_id = p_sales_note_id
  )
  select coalesce(sum(greatest(0, sales_total - cost_total)), 0) * (v_rate / 100)
  into v_amount
  from items;

  if v_amount <= 0 then
    raise exception '此銷貨單無應發分潤';
  end if;

  -- 1. 先建立會計支出分錄
  insert into public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) values (
    'expense', p_account_id, p_category_id, v_amount, v_amount, 'paid',
    coalesce(p_description, '業務分潤發放'), 'rep_payout', null, p_paid_date, p_created_by
  ) returning id into v_entry_id;

  -- 2. 建立發放登記（綁定 entry_id）
  insert into public.rep_commission_payouts (rep_id, sales_note_id, amount, paid_date, note, created_by, entry_id)
  values (p_rep_id, p_sales_note_id, v_amount, p_paid_date, p_note, p_created_by, v_entry_id)
  returning id into v_payout_id;

  -- 3. 回填 reference_id
  update public.accounting_entries set reference_id = v_payout_id where id = v_entry_id;

  -- 4. 扣帳戶餘額
  update public.accounts set balance = balance - v_amount where id = p_account_id;
  if not found then
    raise exception '付款帳戶不存在';
  end if;

  return jsonb_build_object('payout_id', v_payout_id, 'amount', v_amount);
end;
$$;

-- 3. 批次發放 RPC（關聯單據方式：一筆母支出分錄 ＋ 多筆 references ＋ 多筆 payouts 綁定該 entry_id）
CREATE OR REPLACE FUNCTION public.register_batch_rep_commission_payout(
  p_rep_id uuid,
  p_items jsonb, -- array of {sales_note_id, amount}
  p_paid_date date,
  p_account_id uuid,
  p_category_id uuid,
  p_description text,
  p_created_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
declare
  v_total_amount numeric := 0;
  v_entry_id uuid;
  v_item jsonb;
  v_sn_id uuid;
  v_amount numeric;
  v_count int := 0;
  v_sn_code text;
  v_payout_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception '僅限管理員操作';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 or p_paid_date is null or p_account_id is null then
    raise exception '缺少必要參數或無發放項目';
  end if;

  -- 計算總金額並驗證
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_amount := coalesce((v_item->>'amount')::numeric, 0);
    if v_amount > 0 then
      v_total_amount := v_total_amount + v_amount;
    end if;
  end loop;

  if v_total_amount <= 0 then
    raise exception '總發放金額必須大於 0';
  end if;

  -- 1. 建立母支出分錄
  insert into public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) values (
    'expense', p_account_id, p_category_id, v_total_amount, v_total_amount, 'paid',
    coalesce(p_description, '業務分潤批次發放'), 'rep_batch_payout', null, p_paid_date, p_created_by
  ) returning id into v_entry_id;

  -- 2. 迴圈處理每筆項目
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_sn_id := (v_item->>'sales_note_id')::uuid;
    v_amount := coalesce((v_item->>'amount')::numeric, 0);
    if v_sn_id is not null and v_amount > 0 then
      -- 檢查是否已發放
      if not exists (select 1 from public.rep_commission_payouts where rep_id = p_rep_id and sales_note_id = v_sn_id) then
        -- 取得單號供 item_name
        select code into v_sn_code from public.sales_notes where id = v_sn_id;

        -- 建立發放記錄（綁定 entry_id）
        insert into public.rep_commission_payouts (rep_id, sales_note_id, amount, paid_date, note, created_by, entry_id)
        values (p_rep_id, v_sn_id, v_amount, p_paid_date, '批次發放', p_created_by, v_entry_id)
        returning id into v_payout_id;

        -- 建立關聯單據 references
        insert into public.accounting_entry_references (entry_id, reference_type, reference_id, item_name, amount_applied)
        values (v_entry_id, 'sales_note', v_sn_id, coalesce(v_sn_code, substring(v_sn_id::text, 1, 8)), v_amount);

        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  if v_count = 0 then
    raise exception '沒有可發放的新項目（可能已全數發放）';
  end if;

  -- 3. 扣帳戶餘額
  update public.accounts set balance = balance - v_total_amount where id = p_account_id;
  if not found then
    raise exception '付款帳戶不存在';
  end if;

  return jsonb_build_object('entry_id', v_entry_id, 'total_amount', v_total_amount, 'count', v_count);
end;
$$;

-- 4. 撤銷發放 RPC：刪除對應的會計分錄（會自動 CASCADE 刪除 rep_commission_payouts 並回衝餘額）
CREATE OR REPLACE FUNCTION public.revoke_rep_commission_payout(p_payout_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
declare
  v_entry_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception '僅限管理員操作';
  end if;

  select entry_id into v_entry_id
  from public.rep_commission_payouts
  where id = p_payout_id;

  if v_entry_id is not null then
    -- 刪除會計分錄：這會觸發 ON DELETE CASCADE 自動刪除 rep_commission_payouts，
    -- 同時透過 accounting_entries 的刪除連動或前端/已有邏輯回衝帳戶。
    -- 為確保帳戶餘額正確回衝，先手動回衝或讓會計刪除機制處理。
    -- 這裡我們直接刪除會計分錄前先回衝餘額：
    declare
      v_acc uuid;
      v_amt numeric;
    begin
      select account_id, amount into v_acc, v_amt from public.accounting_entries where id = v_entry_id;
      if v_acc is not null and v_amt is not null then
        update public.accounts set balance = balance + v_amt where id = v_acc;
      end if;
    end;

    delete from public.accounting_entries where id = v_entry_id;
  else
    -- 舊資料無 entry_id 時直接刪除 payout
    delete from public.rep_commission_payouts where id = p_payout_id;
  end if;
end;
$$;

REVOKE ALL ON FUNCTION public.register_rep_commission_payout(uuid, uuid, date, text, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_rep_commission_payout(uuid, uuid, date, text, uuid, uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.register_batch_rep_commission_payout(uuid, jsonb, date, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_batch_rep_commission_payout(uuid, jsonb, date, uuid, uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_rep_commission_payout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_rep_commission_payout(uuid) TO authenticated;
