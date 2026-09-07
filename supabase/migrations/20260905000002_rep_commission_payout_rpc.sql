-- 業務分潤發放併入會計模組
-- 金額由 RPC 依 rep_product_costs（成本）與 user_roles.commission_rate（比例）重算，
-- 不接受外部傳入金額（發放金額不可手動）。
-- 一次交易完成：rep_commission_payouts 發放登記 + accounting_entries 支出分錄 + 帳戶餘額扣減。

-- 種子分類：業務分潤（expense）
INSERT INTO public.accounting_categories (name, type, description, is_active)
SELECT '業務分潤', 'expense', '業務分潤發放', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounting_categories WHERE name = '業務分潤' AND type = 'expense'
);

-- 登記發放
create or replace function public.register_rep_commission_payout(
  p_rep_id uuid,
  p_sales_note_id uuid,
  p_paid_date date,
  p_note text,
  p_account_id uuid,
  p_category_id uuid,
  p_description text,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rate numeric;
  v_amount numeric;
  v_payout_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception '僅限管理員操作';
  end if;

  if p_sales_note_id is null or p_paid_date is null or p_account_id is null then
    raise exception '缺少必要參數';
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
  -- 成本：先取逐變體（variant_id 精確配對），無則退產品層級（variant_id IS NULL）之成本
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

  -- 發放登記（UNIQUE(rep_id, sales_note_id) 衝突將拋錯＝重複發放）
  insert into public.rep_commission_payouts (rep_id, sales_note_id, amount, paid_date, note, created_by)
  values (p_rep_id, p_sales_note_id, v_amount, p_paid_date, p_note, p_created_by)
  returning id into v_payout_id;

  -- 會計支出分錄（reference 指向 payout id，撤銷時由此回衝）
  insert into public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) values (
    'expense', p_account_id, p_category_id, v_amount, v_amount, 'paid',
    coalesce(p_description, '業務分潤發放'), 'rep_payout', v_payout_id, p_paid_date, p_created_by
  );

  -- 扣帳戶餘額
  update public.accounts set balance = balance - v_amount where id = p_account_id;
  if not found then
    raise exception '付款帳戶不存在';
  end if;

  return jsonb_build_object('payout_id', v_payout_id, 'amount', v_amount);
end;
$$;

-- 撤銷發放（回衝帳戶餘額 + 刪除支出分錄 + 刪除發放登記）
create or replace function public.revoke_rep_commission_payout(p_payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entry public.accounting_entries%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception '僅限管理員操作';
  end if;

  if not exists (select 1 from public.rep_commission_payouts where id = p_payout_id) then
    raise exception '發放記錄不存在';
  end if;

  -- 依 reference_type='rep_payout' 找到對應支出分錄，回衝餘額後刪除
  select * into v_entry
  from public.accounting_entries
  where reference_type = 'rep_payout' and reference_id = p_payout_id;

  if found then
    update public.accounts set balance = balance + coalesce(v_entry.amount, 0) where id = v_entry.account_id;
    delete from public.accounting_entries where id = v_entry.id;
  end if;

  delete from public.rep_commission_payouts where id = p_payout_id;
end;
$$;

revoke all on function public.register_rep_commission_payout(uuid, uuid, date, text, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.register_rep_commission_payout(uuid, uuid, date, text, uuid, uuid, text, uuid) to authenticated;

revoke all on function public.revoke_rep_commission_payout(uuid) from public, anon;
grant execute on function public.revoke_rep_commission_payout(uuid) to authenticated;