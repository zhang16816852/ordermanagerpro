-- ============================================================
-- 20260906000002_shipping_settlement_and_commission_cost.sql
-- 1. 種子：運費（expense）會計分類
-- 2. 佣金成本改「優先取 order_items.unit_cost 成本快照，其次 rep_product_costs」
--    （單筆/批次發放 RPC 同步修正，金額一律後端重算）
-- 3. 批次佣金發放 RPC 改為「內部重算 + 一母單 + 關聯單據 references」，
--    不再接受前端計算金額
-- 4. register_shipping_settlement / revoke_shipping_settlement：運費月結結算
--    （比照佣金發放模式：RPC 重算金額 → 一筆支出母單 → 扣帳戶餘額）
-- ============================================================

-- ------------------------------------------------------------
-- 1. 種子分類：運費（expense）
-- ------------------------------------------------------------
INSERT INTO public.accounting_categories (name, type, description, is_active)
SELECT '運費', 'expense', '運費月結結算', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounting_categories WHERE name = '運費' AND type = 'expense'
);

-- ------------------------------------------------------------
-- 2. 單筆佣金發放：成本優先取 oi.unit_cost（成本快照）
-- ------------------------------------------------------------
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

  if exists (select 1 from public.rep_commission_payouts where rep_id = p_rep_id and sales_note_id = p_sales_note_id) then
    raise exception '此銷貨單已發放過分潤';
  end if;

  select ur.commission_rate into v_rate
  from public.user_roles ur
  where ur.user_id = p_rep_id and ur.role = 'rep';
  v_rate := coalesce(v_rate, 0);
  if v_rate <= 0 then
    raise exception '此業務未設定佣金比例';
  end if;

  -- 重算佣金 = Σ max(0, (售價 − 成本) × 數量) × 比例
  -- 成本：優先 oi.unit_cost（成本快照），其次 rep_product_costs（變體→產品層級）
  with items as (
    select
      sni.quantity * oi.unit_price as sales_total,
      coalesce(nullif(oi.unit_cost, 0), coalesce(rc.cost, 0), 0) * sni.quantity as cost_total
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

  insert into public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) values (
    'expense', p_account_id, p_category_id, v_amount, v_amount, 'paid',
    coalesce(p_description, '業務分潤發放'), 'rep_payout', null, p_paid_date, p_created_by
  ) returning id into v_entry_id;

  insert into public.rep_commission_payouts (rep_id, sales_note_id, amount, paid_date, note, created_by, entry_id)
  values (p_rep_id, p_sales_note_id, v_amount, p_paid_date, p_note, p_created_by, v_entry_id)
  returning id into v_payout_id;

  update public.accounting_entries set reference_id = v_payout_id where id = v_entry_id;

  update public.accounts set balance = balance - v_amount where id = p_account_id;
  if not found then
    raise exception '付款帳戶不存在';
  end if;

  return jsonb_build_object('payout_id', v_payout_id, 'amount', v_amount);
end;
$$;

-- ------------------------------------------------------------
-- 3. 批次佣金發放：後端內部重算所有金額（不接受前端金額）
--    簽名改為 p_sales_note_ids uuid[]；一母支出分錄 + references + 逐筆 payouts
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.register_batch_rep_commission_payout(uuid, jsonb, date, uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.register_batch_rep_commission_payout(
  p_rep_id uuid,
  p_sales_note_ids uuid[],
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
  v_rate numeric;
  v_total_amount numeric := 0;
  v_entry_id uuid;
  v_sn_id uuid;
  v_amount numeric;
  v_count int := 0;
  v_sn_code text;
  v_payout_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception '僅限管理員操作';
  end if;

  if p_sales_note_ids is null or array_length(p_sales_note_ids, 1) = 0 or p_paid_date is null or p_account_id is null then
    raise exception '缺少必要參數或無發放項目';
  end if;

  select ur.commission_rate into v_rate
  from public.user_roles ur
  where ur.user_id = p_rep_id and ur.role = 'rep';
  v_rate := coalesce(v_rate, 0);
  if v_rate <= 0 then
    raise exception '此業務未設定佣金比例';
  end if;

  -- 預掃：每筆重算佣金
  create temp table _batch_payout_items (
    sales_note_id uuid primary key,
    amount numeric not null default 0,
    code text
  ) on commit drop;

  for v_sn_id in select unnest(p_sales_note_ids)
  loop
    select code into v_sn_code from public.sales_notes where id = v_sn_id;

    with items as (
      select
        sni.quantity * oi.unit_price as sales_total,
        coalesce(nullif(oi.unit_cost, 0), coalesce(rc.cost, 0), 0) * sni.quantity as cost_total
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
      where sni.sales_note_id = v_sn_id
    )
    select coalesce(sum(greatest(0, sales_total - cost_total)), 0) * (v_rate / 100)
    into v_amount
    from items;

    v_amount := coalesce(v_amount, 0);
    -- 已發放過的不計入
    if v_amount > 0 and not exists (
      select 1 from public.rep_commission_payouts
      where rep_id = p_rep_id and sales_note_id = v_sn_id
    ) then
      insert into _batch_payout_items (sales_note_id, amount, code)
      values (v_sn_id, v_amount, v_sn_code);
      v_total_amount := v_total_amount + v_amount;
    end if;
  end loop;

  if v_total_amount <= 0 then
    raise exception '沒有可發放的新項目（可能已全數發放或無應發分潤）';
  end if;

  -- 1. 建立母支出分錄
  insert into public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) values (
    'expense', p_account_id, p_category_id, v_total_amount, v_total_amount, 'paid',
    coalesce(p_description, '業務分潤批次發放'), 'rep_batch_payout', null, p_paid_date, p_created_by
  ) returning id into v_entry_id;

  -- 2. 逐筆：payout + reference（關聯單據）
  for v_sn_id, v_amount, v_sn_code in
    select sales_note_id, amount, code from _batch_payout_items
  loop
    insert into public.rep_commission_payouts (rep_id, sales_note_id, amount, paid_date, note, created_by, entry_id)
    values (p_rep_id, v_sn_id, v_amount, p_paid_date, '批次發放', p_created_by, v_entry_id)
    returning id into v_payout_id;

    insert into public.accounting_entry_references (entry_id, reference_type, reference_id, item_name, amount_applied)
    values (v_entry_id, 'sales_note', v_sn_id, coalesce(v_sn_code, substring(v_sn_id::text, 1, 8)), v_amount);

    v_count := v_count + 1;
  end loop;

  drop table _batch_payout_items;

  -- 3. 扣帳戶餘額
  update public.accounts set balance = balance - v_total_amount where id = p_account_id;
  if not found then
    raise exception '付款帳戶不存在';
  end if;

  return jsonb_build_object('entry_id', v_entry_id, 'total_amount', v_total_amount, 'count', v_count);
end;
$$;

-- ------------------------------------------------------------
-- 4. 運費月結結算 RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_shipping_settlement(
  p_carrier_product_id uuid,
  p_order_item_ids uuid[],
  p_period_start date,
  p_period_end date,
  p_paid_date date,
  p_account_id uuid,
  p_category_id uuid,
  p_description text,
  p_note text,
  p_created_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
declare
  v_period_id uuid;
  v_entry_id uuid;
  v_total numeric := 0;
  v_order_count int := 0;
  v_item record;
  v_allowed boolean := true;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception '僅限管理員操作';
  end if;

  if p_carrier_product_id is null or p_order_item_ids is null
     or array_length(p_order_item_ids, 1) = 0
     or p_period_start is null or p_period_end is null
     or p_paid_date is null or p_account_id is null then
    raise exception '缺少必要參數';
  end if;

  if p_period_end < p_period_start then
    raise exception '期間起訖錯誤';
  end if;

  -- 驗證物流商為 shipping 型商品
  if not exists (
    select 1 from public.products where id = p_carrier_product_id and item_type = 'shipping'
  ) then
    raise exception '物流商商品不存在或非運費型商品';
  end if;

  -- 期間不可重複結算
  if exists (
    select 1 from public.shipping_settlement_periods
    where carrier_product_id = p_carrier_product_id
      and period_start = p_period_start and period_end = p_period_end
      and is_settled = true
  ) then
    raise exception '此期間已結算過運費';
  end if;

  -- 驗證每一筆 order_item 皆為該物流商之月結運費
  for v_item in
    select oi.id, oi.order_id, oi.product_id, oi.quantity, oi.unit_price, oi.shipping_payment,
           o.code as order_code
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.id = any(p_order_item_ids)
  loop
    if v_item.product_id <> p_carrier_product_id then
      v_allowed := false;
      exit;
    end if;
    if coalesce(v_item.shipping_payment, '') <> 'monthly' then
      v_allowed := false;
      exit;
    end if;
    if exists (
      select 1 from public.orders oo where oo.id = v_item.order_id and oo.status = 'cancelled'
    ) then
      v_allowed := false;
      exit;
    end if;
    -- 已有其他結算分錄涵蓋此訂單（避免同一運費被重複結算）
    if exists (
      select 1
      from public.accounting_entry_references r
      join public.shipping_settlement_periods sp on sp.entry_id = r.entry_id
      where r.reference_type = 'order'
        and r.reference_id = v_item.order_id
        and sp.carrier_product_id = p_carrier_product_id
    ) then
      v_allowed := false;
      exit;
    end if;
  end loop;

  if not v_allowed then
    raise exception '含非月結運費或少於所選物流商之品項';
  end if;

  -- 計算總額（依訂單彙總）
  create temp table _shipping_agg (order_id uuid primary key, order_code text, amount numeric not null default 0)
    on commit drop;

  insert into _shipping_agg (order_id, order_code, amount)
  select oi.order_id, o.code, sum(oi.quantity * oi.unit_price)
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = any(p_order_item_ids)
  group by oi.order_id, o.code;

  select coalesce(sum(amount), 0) into v_total from _shipping_agg;
  select count(*) into v_order_count from _shipping_agg;

  if v_total <= 0 then
    drop table _shipping_agg;
    raise exception '運費總額必須大於 0';
  end if;

  -- 1. 建立（或沿用未結算）期間
  insert into public.shipping_settlement_periods (
    carrier_product_id, period_start, period_end, total_amount, is_settled, note, created_by
  ) values (
    p_carrier_product_id, p_period_start, p_period_end, v_total, false, p_note, p_created_by
  )
  on conflict (carrier_product_id, period_start, period_end)
  do update set total_amount = excluded.total_amount, note = excluded.note, updated_at = now()
  returning id into v_period_id;

  -- 2. 建立支出母單（reference 指向期間）
  insert into public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) values (
    'expense', p_account_id, p_category_id, v_total, v_total, 'paid',
    coalesce(p_description, '運費月結結帳'), 'shipping_settlement', v_period_id, p_paid_date, p_created_by
  ) returning id into v_entry_id;

  -- 3. 關聯單據（per order）
  insert into public.accounting_entry_references (entry_id, reference_type, reference_id, item_name, amount_applied)
  select v_entry_id, 'order', order_id, coalesce(order_code, substring(order_id::text, 1, 8)), amount
  from _shipping_agg;

  drop table _shipping_agg;

  -- 4. 更新期間為已結算
  update public.shipping_settlement_periods
  set is_settled = true, settled_at = now(), entry_id = v_entry_id, updated_at = now()
  where id = v_period_id;

  -- 5. 扣帳戶餘額
  update public.accounts set balance = balance - v_total where id = p_account_id;
  if not found then
    raise exception '付款帳戶不存在';
  end if;

  return jsonb_build_object('period_id', v_period_id, 'entry_id', v_entry_id, 'total_amount', v_total, 'order_count', v_order_count);
end;
$$;

-- 撤銷運費結算：回衝帳戶餘額、刪除支出分錄（連動 references）、解開期間結算
CREATE OR REPLACE FUNCTION public.revoke_shipping_settlement(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
declare
  v_entry public.accounting_entries%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception '僅限管理員操作';
  end if;

  select ae.* into v_entry
  from public.accounting_entries ae
  where ae.reference_type = 'shipping_settlement' and ae.reference_id = p_period_id;

  if v_entry.id is not null then
    update public.accounts set balance = balance + coalesce(v_entry.amount, 0) where id = v_entry.account_id;
    delete from public.accounting_entries where id = v_entry.id;
  end if;

  update public.shipping_settlement_periods
  set is_settled = false, settled_at = null, entry_id = null, updated_at = now()
  where id = p_period_id;

  if not found then
    raise exception '結算期間不存在';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 權限
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.register_rep_commission_payout(uuid, uuid, date, text, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_rep_commission_payout(uuid, uuid, date, text, uuid, uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.register_batch_rep_commission_payout(uuid, uuid[], date, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_batch_rep_commission_payout(uuid, uuid[], date, uuid, uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.register_shipping_settlement(uuid, uuid[], date, date, date, uuid, uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_shipping_settlement(uuid, uuid[], date, date, date, uuid, uuid, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_shipping_settlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_shipping_settlement(uuid) TO authenticated;