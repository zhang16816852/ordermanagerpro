-- ============================================================
-- 20260907000006_shipping_supplier_binding.sql
-- 運費結算改由「採購商（物流公司）」主導：
--   1. products.supplier_id：運費型商品綁定所屬採購商（物流公司）
--   2. shipping_settlement_periods.supplier_id：結算週期以採購商為鍵
--      （唯一鍵由 carrier_product_id 搬移至 supplier_id）
--   3. register_shipping_settlement 改以 p_supplier_id 過濾月結運費品項
-- ============================================================

-- ------------------------------------------------------------
-- 1. products.supplier_id（僅 item_type='shipping' 使用）
-- ------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier_id uuid
  REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_supplier_id
  ON public.products (supplier_id) WHERE supplier_id IS NOT NULL;

COMMENT ON COLUMN public.products.supplier_id IS '所屬採購商（運費型商品的物流公司）';

-- ------------------------------------------------------------
-- 2. shipping_settlement_periods.supplier_id + 唯一鍵搬移
-- ------------------------------------------------------------
ALTER TABLE public.shipping_settlement_periods
  ALTER COLUMN carrier_product_id DROP NOT NULL;

ALTER TABLE public.shipping_settlement_periods
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- 既有週期列依運費商品綁定的採購商 backfill
UPDATE public.shipping_settlement_periods sp
SET supplier_id = p.supplier_id
FROM public.products p
WHERE sp.carrier_product_id = p.id
  AND p.supplier_id IS NOT NULL
  AND sp.supplier_id IS NULL;

DROP INDEX IF EXISTS uq_shipping_settlement_period;

-- 週期不可重複：同一物流公司同一區間只能有一筆（NULL 不參與唯一性）
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_settlement_period_supplier
  ON public.shipping_settlement_periods (supplier_id, period_start, period_end)
  WHERE supplier_id IS NOT NULL;

COMMENT ON COLUMN public.shipping_settlement_periods.supplier_id IS '物流公司（採購商）';
COMMENT ON COLUMN public.shipping_settlement_periods.carrier_product_id IS '舊欄位（保留相容，新結算一律 NULL，改用 supplier_id）';

-- ------------------------------------------------------------
-- 3. register_shipping_settlement 改以採購商為鍵
--    （參數名由 p_carrier_product_id 改為 p_supplier_id，
--      Postgres 規定 CREATE OR REPLACE 不得改名，故先 DROP）
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.register_shipping_settlement(uuid, uuid[], date, date, date, uuid, uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.register_shipping_settlement(
  p_supplier_id uuid,
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

  if p_supplier_id is null or p_order_item_ids is null
     or array_length(p_order_item_ids, 1) = 0
     or p_period_start is null or p_period_end is null
     or p_paid_date is null or p_account_id is null then
    raise exception '缺少必要參數';
  end if;

  if p_period_end < p_period_start then
    raise exception '期間起訖錯誤';
  end if;

  -- 驗證物流公司（採購商）存在
  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception '物流公司（採購商）不存在';
  end if;

  -- 期間不可重複結算（依物流公司）
  if exists (
    select 1 from public.shipping_settlement_periods
    where supplier_id = p_supplier_id
      and period_start = p_period_start and period_end = p_period_end
      and is_settled = true
  ) then
    raise exception '此期間已結算過運費';
  end if;

  -- 驗證每一筆 order_item 皆為該物流公司之運費型商品且為月結
  for v_item in
    select oi.id, oi.order_id, oi.product_id, oi.quantity, oi.unit_price, oi.shipping_payment,
           o.code as order_code, p.supplier_id as item_supplier_id
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    where oi.id = any(p_order_item_ids)
  loop
    if v_item.item_supplier_id is distinct from p_supplier_id then
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
        and sp.supplier_id = p_supplier_id
    ) then
      v_allowed := false;
      exit;
    end if;
  end loop;

  if not v_allowed then
    raise exception '含非月結運費或少於所選物流公司之品項';
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

  -- 1. 建立（或沿用未結算）期間（依物流公司）
  insert into public.shipping_settlement_periods (
    supplier_id, period_start, period_end, total_amount, is_settled, note, created_by
  ) values (
    p_supplier_id, p_period_start, p_period_end, v_total, false, p_note, p_created_by
  )
  on conflict (supplier_id, period_start, period_end) where supplier_id is not null
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