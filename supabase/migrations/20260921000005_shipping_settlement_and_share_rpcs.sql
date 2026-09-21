-- 20260921000005_shipping_settlement_and_share_rpcs.sql
-- Phase B：register_shipping_settlement 改以 shipments.cost 彙總（不再用 products shipping「偽商品」品項）
--          + 三個分享 RPC 回傳配送方式／包裹／含運總額
-- 本 file 與套用至遠端之內容完全相同；如要 REPLACE 請整份貼上。

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. register_shipping_settlement 重寫（同參數型別 → CREATE OR REPLACE 原地取代）
--    p_order_item_ids 語意改為 p_shipment_ids（包裹 id），前端於 Phase C 更新。
-- ================================================================
CREATE OR REPLACE FUNCTION public.register_shipping_settlement(
  p_supplier_id uuid,
  p_shipment_ids uuid[],
  p_period_start date,
  p_period_end date,
  p_paid_date date,
  p_account_id uuid,
  p_category_id uuid,
  p_description text,
  p_note text,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_period_id uuid;
  v_entry_id uuid;
  v_total numeric := 0;
  v_count int := 0;
  v_ship record;
  v_allowed boolean := true;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception '僅限管理員操作';
  end if;

  if p_supplier_id is null or p_shipment_ids is null
     or array_length(p_shipment_ids, 1) = 0
     or p_period_start is null or p_period_end is null
     or p_paid_date is null or p_account_id is null then
    raise exception '缺少必要參數';
  end if;

  if p_period_end < p_period_start then
    raise exception '期間起訖錯誤';
  end if;

  -- 驗證物流公司存在
  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception '物流公司不存在';
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

  -- 驗證每筆包裹：皆屬該物流公司之配送方式、月結、未結算過
  for v_ship in
    select
      s.id,
      s.fee,
      s.cost,
      s.fee_payment,
      s.delivery_method_id as method_id
    from public.shipments s
    where s.id = any(p_shipment_ids)
  loop
    if v_ship.method_id is null then
      v_allowed := false;
      exit;
    end if;

    if not exists (
      select 1 from public.delivery_methods dm
      where dm.id = v_ship.method_id::uuid
        and dm.supplier_id = p_supplier_id
    ) then
      v_allowed := false;
      exit;
    end if;

    if coalesce(v_ship.fee_payment, 'one_time') <> 'monthly' then
      v_allowed := false;
      exit;
    end if;

    -- 已被其他已結算期間涵蓋 → 不可重複結算
    if exists (
      select 1
      from public.accounting_entry_references r
      join public.shipping_settlement_periods sp on sp.entry_id = r.entry_id
      where r.reference_type = 'shipment'
        and r.reference_id = v_ship.id
        and sp.supplier_id = p_supplier_id
        and sp.is_settled = true
    ) then
      v_allowed := false;
      exit;
    end if;
  end loop;

  if not v_allowed then
    raise exception '含非月結運費或少於所選物流公司之品項';
  end if;

  -- 總額 = SUM(shipments.cost)（物流成本，結給物流公司）
  select coalesce(sum(cost), 0), count(*)
  into v_total, v_count
  from public.shipments
  where id = any(p_shipment_ids);

  if v_total <= 0 then
    raise exception '運費總額必須大於 0';
  end if;

  -- 1. 建立（或沿用未結算）期間
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
    coalesce(p_description, '運費月結結帳（物流）'), 'shipping_settlement', v_period_id, p_paid_date, p_created_by
  ) returning id into v_entry_id;

  -- 3. 關聯每筆包裹（reference_type='shipment'）
  insert into public.accounting_entry_references (entry_id, reference_type, reference_id, item_name, amount_applied)
  select v_entry_id, 'shipment', s.id, coalesce(s.delivery_method_title, substring(s.id::text, 1, 8)), coalesce(s.cost, 0)
  from public.shipments s
  where s.id = any(p_shipment_ids);

  -- 4. 更新期間為已結算
  update public.shipping_settlement_periods
  set is_settled = true, settled_at = now(), entry_id = v_entry_id, updated_at = now()
  where id = v_period_id;

  -- 5. 扣帳戶餘額
  update public.accounts set balance = balance - v_total where id = p_account_id;
  if not found then
    raise exception '付款帳戶不存在';
  end if;

  return jsonb_build_object(
    'period_id', v_period_id,
    'entry_id', v_entry_id,
    'total_amount', v_total,
    'shipment_count', v_count
  );
end;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 2. 分享 RPC：回傳新增 delivery_method/shipping_fee/shipping_cost/shipping_address/shipments
--    包裹陣列統一以 doc_id 關聯（doc_type：order / sales_note / consignment_order）。
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_shared_order_details(p_identifier text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id UUID;
  v_result JSONB;
BEGIN
  BEGIN
    v_order_id := p_identifier::UUID;
  EXCEPTION WHEN OTHERS THEN
    SELECT id INTO v_order_id FROM public.orders WHERE code = p_identifier;
  END;

  SELECT jsonb_build_object(
    'order', (
      SELECT jsonb_build_object(
        'id', o.id,
        'code', o.code,
        'created_at', o.created_at,
        'status', o.status,
        'notes', o.notes,
        'store_name', s.name,
        'delivery_method_id', o.delivery_method_id,
        'delivery_method_title', o.delivery_method_title,
        'delivery_method_code', o.delivery_method_code,
        'shipping_fee', o.shipping_fee,
        'shipping_cost', o.shipping_cost,
        'shipping_address', o.shipping_address
      )
      FROM public.orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE (o.id = v_order_id OR o.code = p_identifier)
      AND o.access_token = p_token::UUID
    ),
    'shipments', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', sh.id,
          'delivery_method', jsonb_build_object(
            'id', sh.delivery_method_id,
            'title', sh.delivery_method_title,
            'code', sh.delivery_method_code
          ),
          'fee', sh.fee,
          'cost', sh.cost,
          'fee_payment', sh.fee_payment,
          'tracking_company', sh.tracking_company,
          'tracking_number', sh.tracking_number,
          'tracking_url', sh.tracking_url,
          'shipped_at', sh.shipped_at,
          'note', sh.note
        )
        ORDER BY sh.created_at, sh.id
      )
      FROM public.shipments sh
      WHERE sh.doc_type = 'order'
        AND sh.doc_id IN (
          SELECT o.id FROM public.orders o
          WHERE (o.id = v_order_id OR o.code = p_identifier)
          AND o.access_token = p_token::UUID
        )
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'variant_name', pv.name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'sort_order', oi.sort_order,
          'item_type', p.item_type,
          'parent_order_item_id', oi.parent_order_item_id,
          'shipping_payment', oi.shipping_payment
        )
        ORDER BY oi.sort_order, oi.created_at
      )
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
      WHERE oi.order_id IN (
        SELECT o.id FROM public.orders o
        WHERE (o.id = v_order_id OR o.code = p_identifier)
        AND o.access_token = p_token::UUID
      )
    )
  ) INTO v_result;

  IF (v_result->'order') IS NULL OR (v_result->'order') = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_shared_sales_note_details(p_identifier text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uuid_id UUID;
  v_result JSONB;
BEGIN
  BEGIN
    v_uuid_id := p_identifier::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_uuid_id := NULL;
  END;

  SELECT jsonb_build_object(
    'sales_note', (
      SELECT jsonb_build_object(
        'id', sn.id,
        'code', sn.code,
        'created_at', sn.created_at,
        'shipped_at', sn.shipped_at,
        'status', sn.status,
        'notes', sn.notes,
        'store_name', s.name,
        'access_token', sn.access_token,
        'delivery_method_id', sn.delivery_method_id,
        'delivery_method_title', sn.delivery_method_title,
        'delivery_method_code', sn.delivery_method_code,
        'shipping_fee', sn.shipping_fee,
        'shipping_cost', sn.shipping_cost,
        'shipping_address', sn.shipping_address
      )
      FROM public.sales_notes sn
      JOIN public.stores s ON s.id = sn.store_id
      WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
      AND (sn.access_token = p_token::UUID OR public.share_token_for_code(sn.code) = p_token::UUID)
    ),
    'shipments', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', sh.id,
          'delivery_method', jsonb_build_object(
            'id', sh.delivery_method_id,
            'title', sh.delivery_method_title,
            'code', sh.delivery_method_code
          ),
          'fee', sh.fee,
          'cost', sh.cost,
          'fee_payment', sh.fee_payment,
          'tracking_company', sh.tracking_company,
          'tracking_number', sh.tracking_number,
          'tracking_url', sh.tracking_url,
          'shipped_at', sh.shipped_at,
          'note', sh.note
        )
        ORDER BY sh.created_at, sh.id
      )
      FROM public.shipments sh
      WHERE sh.doc_type = 'sales_note'
        AND sh.doc_id IN (
          SELECT sn.id FROM public.sales_notes sn
          WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
          AND (sn.access_token = p_token::UUID OR public.share_token_for_code(sn.code) = p_token::UUID)
        )
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'variant_name', pv.name,
          'quantity', sni.quantity,
          'unit_price', oi.unit_price,
          'sort_order', COALESCE(sni.sort_order, 0),
          'item_type', p.item_type,
          'parent_order_item_id', oi.parent_order_item_id,
          'shipping_payment', oi.shipping_payment
        )
        ORDER BY COALESCE(sni.sort_order, 0), oi.sort_order, oi.created_at
      )
      FROM public.sales_note_items sni
      JOIN public.order_items oi ON oi.id = sni.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
      WHERE sni.sales_note_id IN (
        SELECT sn.id FROM public.sales_notes sn
        WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
        AND (sn.access_token = p_token::UUID OR public.share_token_for_code(sn.code) = p_token::UUID)
      )
    )
  ) INTO v_result;

  IF (v_result->'sales_note') IS NULL OR (v_result->'sales_note') = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_shared_consignment_details(p_identifier text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uuid_id UUID;
  v_result JSONB;
BEGIN
  BEGIN
    v_uuid_id := p_identifier::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_uuid_id := NULL;
  END;

  SELECT jsonb_build_object(
    'consignment', (
      SELECT jsonb_build_object(
        'id', co.id,
        'code', co.code,
        'direction', co.direction,
        'created_at', co.created_at,
        'status', co.status,
        'notes', co.note,
        'store_name', CASE WHEN co.direction = 'send_to_store' THEN s.name ELSE NULL END,
        'supplier_name', CASE WHEN co.direction = 'receive_from_supplier' THEN sup.name ELSE NULL END,
        'access_token', co.access_token,
        'shipped_at', co.shipped_at,
        'delivery_method_id', co.delivery_method_id,
        'delivery_method_title', co.delivery_method_title,
        'delivery_method_code', co.delivery_method_code,
        'shipping_fee', co.shipping_fee,
        'shipping_cost', co.shipping_cost,
        'shipping_address', co.shipping_address
      )
      FROM public.consignment_orders co
      LEFT JOIN public.stores s ON s.id = co.store_id
      LEFT JOIN public.suppliers sup ON sup.id = co.supplier_id
      WHERE (co.id = v_uuid_id OR co.code = p_identifier)
      AND (co.access_token = p_token::UUID OR public.share_token_for_code(co.code) = p_token::UUID)
    ),
    'shipments', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', sh.id,
          'delivery_method', jsonb_build_object(
            'id', sh.delivery_method_id,
            'title', sh.delivery_method_title,
            'code', sh.delivery_method_code
          ),
          'fee', sh.fee,
          'cost', sh.cost,
          'fee_payment', sh.fee_payment,
          'tracking_company', sh.tracking_company,
          'tracking_number', sh.tracking_number,
          'tracking_url', sh.tracking_url,
          'shipped_at', sh.shipped_at,
          'note', sh.note
        )
        ORDER BY sh.created_at, sh.id
      )
      FROM public.shipments sh
      WHERE sh.doc_type = 'consignment_order'
        AND sh.doc_id IN (
          SELECT co.id FROM public.consignment_orders co
          WHERE (co.id = v_uuid_id OR co.code = p_identifier)
          AND (co.access_token = p_token::UUID OR public.share_token_for_code(co.code) = p_token::UUID)
        )
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'variant_name', pv.name,
          'quantity', coi.quantity,
          'unit_price', coi.unit_price
        )
        ORDER BY coi.created_at
      )
      FROM public.consignment_order_items coi
      JOIN public.products p ON p.id = coi.product_id
      LEFT JOIN public.product_variants pv ON pv.id = coi.variant_id
      WHERE coi.consignment_order_id IN (
        SELECT co.id FROM public.consignment_orders co
        WHERE (co.id = v_uuid_id OR co.code = p_identifier)
        AND (co.access_token = p_token::UUID OR public.share_token_for_code(co.code) = p_token::UUID)
      )
    )
  ) INTO v_result;

  IF (v_result->'consignment') IS NULL OR (v_result->'consignment') = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$function$;

COMMIT;