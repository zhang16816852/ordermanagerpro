-- ============================================================
-- 20260921000003_shipment_rpcs.sql
-- 物流系統重構 Phase B-1：
--   * public._recompute_doc_shipping(p_doc_type, p_doc_id) 內部共用 helper
--     → 依 shipments 加總，回寫單據層 shipping_fee/shipping_cost；
--       doc 的 delivery_method_id 為 NULL 時順帶補第一包的方法快照。
--   * public.upsert_shipment(...) 新增/更新包裹（帶 delivery_method 快照；
--     未帶 fee/cost 時預設取 delivery_method.price/cost）
--   * public.delete_shipment(p_shipment_id) 刪除包裹並重算
--   兩支 RPC 皆僅 admin 可執行（SECURITY DEFINER）。
-- ============================================================

BEGIN;

-- 共用：重算單據層運費總額（包裹＝唯一收支單位）
CREATE OR REPLACE FUNCTION public._recompute_doc_shipping(p_doc_type text, p_doc_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_fee numeric := 0;
  v_cost numeric := 0;
  v_method_id uuid;
  v_method_title text;
  v_method_code text;
BEGIN
  SELECT coalesce(sum(s.fee), 0), coalesce(sum(s.cost), 0)
  INTO v_fee, v_cost
  FROM public.shipments s
  WHERE s.doc_type = p_doc_type AND s.doc_id = p_doc_id;

  -- 方法快照取最早一包（doc 尚未有方法時回填）
  SELECT s.delivery_method_id, s.delivery_method_title, s.delivery_method_code
  INTO v_method_id, v_method_title, v_method_code
  FROM public.shipments s
  WHERE s.doc_type = p_doc_type AND s.doc_id = p_doc_id
  ORDER BY s.created_at, s.id
  LIMIT 1;

  IF p_doc_type = 'order' THEN
    UPDATE public.orders o
    SET shipping_fee = v_fee,
        shipping_cost = v_cost,
        delivery_method_id = coalesce(o.delivery_method_id, v_method_id),
        delivery_method_title = coalesce(o.delivery_method_title, v_method_title),
        delivery_method_code = coalesce(o.delivery_method_code, v_method_code),
        updated_at = now()
    WHERE o.id = p_doc_id;
  ELSIF p_doc_type = 'sales_note' THEN
    UPDATE public.sales_notes o
    SET shipping_fee = v_fee,
        shipping_cost = v_cost,
        delivery_method_id = coalesce(o.delivery_method_id, v_method_id),
        delivery_method_title = coalesce(o.delivery_method_title, v_method_title),
        delivery_method_code = coalesce(o.delivery_method_code, v_method_code),
        updated_at = now()
    WHERE o.id = p_doc_id;
  ELSIF p_doc_type = 'consignment_order' THEN
    UPDATE public.consignment_orders o
    SET shipping_fee = v_fee,
        shipping_cost = v_cost,
        delivery_method_id = coalesce(o.delivery_method_id, v_method_id),
        delivery_method_title = coalesce(o.delivery_method_title, v_method_title),
        delivery_method_code = coalesce(o.delivery_method_code, v_method_code),
        updated_at = now()
    WHERE o.id = p_doc_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'doc_type', p_doc_type, 'doc_id', p_doc_id,
    'shipping_fee', v_fee, 'shipping_cost', v_cost
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._recompute_doc_shipping(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._recompute_doc_shipping(text, uuid) TO postgres;

-- 新增/更新包裹（doc 存在性由各路徑自行確保；RLS 以 admin 守門）
CREATE OR REPLACE FUNCTION public.upsert_shipment(
  p_doc_type text,
  p_doc_id uuid,
  p_delivery_method_id uuid DEFAULT NULL,
  p_fee numeric DEFAULT NULL,
  p_cost numeric DEFAULT NULL,
  p_fee_payment text DEFAULT 'one_time',
  p_tracking_company text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL,
  p_tracking_url text DEFAULT NULL,
  p_shipped_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_shipment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_method_id uuid;
  v_method_title text;
  v_method_code text;
  v_fee numeric;
  v_cost numeric;
  v_fee_payment text;
  v_shipment_id uuid;
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION '僅限管理員操作';
  END IF;

  IF p_doc_type NOT IN ('order', 'sales_note', 'consignment_order') OR p_doc_id IS NULL THEN
    RAISE EXCEPTION '缺少必要參數（doc_type/doc_id）';
  END IF;

  -- 方法快照
  IF p_delivery_method_id IS NOT NULL THEN
    SELECT dm.id, dm.name, dm.code, dm.price, dm.cost, dm.fee_payment
    INTO v_method_id, v_method_title, v_method_code, v_fee, v_cost, v_fee_payment
    FROM public.delivery_methods dm
    WHERE dm.id = p_delivery_method_id AND dm.is_active;

    IF v_method_id IS NULL THEN
      RAISE EXCEPTION '配送方式不存在或已停用（id %）', p_delivery_method_id;
    END IF;
  END IF;

  -- 未帶則回退方法預設；皆無則 0
  v_fee := coalesce(p_fee, v_fee, 0);
  v_cost := coalesce(p_cost, v_cost, 0);
  v_fee_payment := coalesce(NULLIF(p_fee_payment, ''), v_fee_payment, 'one_time');

  IF p_shipment_id IS NULL THEN
    INSERT INTO public.shipments (
      doc_type, doc_id, delivery_method_id, delivery_method_title, delivery_method_code,
      fee, cost, fee_payment, tracking_company, tracking_number, tracking_url,
      shipped_at, note, created_by
    ) VALUES (
      p_doc_type, p_doc_id, v_method_id, v_method_title, v_method_code,
      v_fee, v_cost, v_fee_payment, p_tracking_company, p_tracking_number, p_tracking_url,
      coalesce(p_shipped_at, now()), p_note, p_created_by
    )
    RETURNING id INTO v_shipment_id;
  ELSE
    UPDATE public.shipments
    SET delivery_method_id = coalesce(p_delivery_method_id, delivery_method_id),
        delivery_method_title = coalesce(v_method_title, delivery_method_title),
        delivery_method_code = coalesce(v_method_code, delivery_method_code),
        fee = v_fee,
        cost = v_cost,
        fee_payment = v_fee_payment,
        tracking_company = coalesce(p_tracking_company, tracking_company),
        tracking_number = coalesce(p_tracking_number, tracking_number),
        tracking_url = coalesce(p_tracking_url, tracking_url),
        shipped_at = coalesce(p_shipped_at, shipped_at),
        note = coalesce(p_note, note),
        updated_at = now()
    WHERE id = p_shipment_id AND doc_type = p_doc_type AND doc_id = p_doc_id
    RETURNING id INTO v_shipment_id;

    IF v_shipment_id IS NULL THEN
      RAISE EXCEPTION '包裹不存在或與 doc 不匹配（id %）', p_shipment_id;
    END IF;
  END IF;

  v_result := public._recompute_doc_shipping(p_doc_type, p_doc_id);
  RETURN v_result || jsonb_build_object('shipment_id', v_shipment_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_shipment(text, uuid, uuid, numeric, numeric, text, text, text, text, timestamptz, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_shipment(text, uuid, uuid, numeric, numeric, text, text, text, text, timestamptz, text, uuid, uuid) TO authenticated;

-- 刪除包裹並重算
CREATE OR REPLACE FUNCTION public.delete_shipment(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_doc_type text;
  v_doc_id uuid;
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION '僅限管理員操作';
  END IF;

  SELECT doc_type, doc_id INTO v_doc_type, v_doc_id
  FROM public.shipments WHERE id = p_shipment_id;

  IF v_doc_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '包裹不存在');
  END IF;

  DELETE FROM public.shipments WHERE id = p_shipment_id;

  v_result := public._recompute_doc_shipping(v_doc_type, v_doc_id);
  RETURN v_result || jsonb_build_object('deleted_shipment_id', p_shipment_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_shipment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_shipment(uuid) TO authenticated;

COMMIT;