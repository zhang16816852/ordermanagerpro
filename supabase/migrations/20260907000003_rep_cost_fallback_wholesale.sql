-- 業務佣金成本 fallback：未設定 rep_product_costs 時，成本改以「進貨成本（變體批發價 product_variants.wholesale_price）」為預設
-- 成本優先序：order_items.unit_cost 快照（>0）→ rep_product_costs（變體→產品層級）→ 進貨成本 → 0

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
  -- 成本：unit_cost 快照 → rep_product_costs（變體→產品層級）→ 進貨成本（變體批發價）
  with items as (
    select
      sni.quantity * oi.unit_price as sales_total,
      coalesce(nullif(oi.unit_cost, 0), rc.cost, pv.wholesale_price, 0) * sni.quantity as cost_total
    from public.sales_note_items sni
    join public.order_items oi on oi.id = sni.order_item_id
    left join public.product_variants pv on pv.id = oi.variant_id
    left join lateral (
      select coalesce(
        (select cost from public.rep_product_costs c2
          where c2.rep_id = p_rep_id and c2.product_id = oi.product_id
            and c2.variant_id = oi.variant_id
          limit 1),
        (select cost from public.rep_product_costs c3
          where c3.rep_id = p_rep_id and c3.product_id = oi.product_id
            and c3.variant_id is null
          limit 1)
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
        coalesce(nullif(oi.unit_cost, 0), rc.cost, pv.wholesale_price, 0) * sni.quantity as cost_total
      from public.sales_note_items sni
      join public.order_items oi on oi.id = sni.order_item_id
      left join public.product_variants pv on pv.id = oi.variant_id
      left join lateral (
        select coalesce(
          (select cost from public.rep_product_costs c2
            where c2.rep_id = p_rep_id and c2.product_id = oi.product_id
              and c2.variant_id = oi.variant_id
            limit 1),
          (select cost from public.rep_product_costs c3
            where c3.rep_id = p_rep_id and c3.product_id = oi.product_id
              and c3.variant_id is null
            limit 1)
        ) as cost
      ) rc on true
      where sni.sales_note_id = v_sn_id
    )
    select coalesce(sum(greatest(0, sales_total - cost_total)), 0) * (v_rate / 100)
    into v_amount
    from items;

    v_amount := coalesce(v_amount, 0);
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

  insert into public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) values (
    'expense', p_account_id, p_category_id, v_total_amount, v_total_amount, 'paid',
    coalesce(p_description, '業務分潤批次發放'), 'rep_batch_payout', null, p_paid_date, p_created_by
  ) returning id into v_entry_id;

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

  update public.accounts set balance = balance - v_total_amount where id = p_account_id;
  if not found then
    raise exception '付款帳戶不存在';
  end if;

  return jsonb_build_object('entry_id', v_entry_id, 'total_amount', v_total_amount, 'count', v_count);
end;
$$;

REVOKE ALL ON FUNCTION public.register_rep_commission_payout(uuid, uuid, date, text, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_rep_commission_payout(uuid, uuid, date, text, uuid, uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.register_batch_rep_commission_payout(uuid, uuid[], date, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_batch_rep_commission_payout(uuid, uuid[], date, uuid, uuid, text, uuid) TO authenticated;