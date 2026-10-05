-- 修正：shipments.fee_payment 改以 delivery_methods.fee_payment 為唯一真值
--
-- 問題：6 個 upsert_shipment 呼叫點（ship_from_pool×2、direct_ship_order、
-- create_order_with_sales_note、create_consignment_shipment、
-- create_consignment_shipment_layer）全部硬寫 'one_time'，導致配送方式設定為
-- monthly 的包裹仍被寫成 one_time，導致 list_settleable_shipments 抓不到、
-- 物流商月結漏算。
--
-- 修法：不在 5 支呼叫端函式逐一改字面值（合計約 47KB 函式內容），改為讓
-- upsert_shipment 內部以已 SELECT 到的配送方式 fee_payment 優先。簽名不變，
-- 前端零改動。CALLER 傳入的 p_fee_payment 退為次要 fallback，且 p_fee_payment
-- 過去從未被傳過 'one_time' 以外的值，故無行為倒退風險。

CREATE OR REPLACE FUNCTION public.upsert_shipment(p_doc_type text, p_doc_id uuid, p_delivery_method_id uuid DEFAULT NULL::uuid, p_fee numeric DEFAULT NULL::numeric, p_cost numeric DEFAULT NULL::numeric, p_fee_payment text DEFAULT 'one_time'::text, p_tracking_company text DEFAULT NULL::text, p_tracking_number text DEFAULT NULL::text, p_tracking_url text DEFAULT NULL::text, p_shipped_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_note text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_shipment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  IF p_delivery_method_id IS NOT NULL THEN
    SELECT dm.id, dm.name, dm.code, dm.price, dm.cost, dm.fee_payment
    INTO v_method_id, v_method_title, v_method_code, v_fee, v_cost, v_fee_payment
    FROM public.delivery_methods dm
    WHERE dm.id = p_delivery_method_id AND dm.is_active;

    IF v_method_id IS NULL THEN
      RAISE EXCEPTION '配送方式不存在或已停用（id %）', p_delivery_method_id;
    END IF;
  END IF;

  v_fee := coalesce(p_fee, v_fee, 0);
  v_cost := coalesce(p_cost, v_cost, 0);
  v_fee_payment := coalesce(v_fee_payment, NULLIF(p_fee_payment, ''), 'one_time');

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

-- 重發後明確收斂權限（與遠端現況一致：anon/public 無權，authenticated 與 service_role 可執行）
REVOKE ALL ON FUNCTION public.upsert_shipment(text, uuid, uuid, numeric, numeric, text, text, text, text, timestamptz, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_shipment(text, uuid, uuid, numeric, numeric, text, text, text, text, timestamptz, text, uuid, uuid) TO authenticated, service_role;

-- 歷史資料回填：把「配送方式為 monthly、但包裹被硬寫成 one_time」既有資料改回 monthly。
--
-- 遠端實測（2026-10-04）：共 15 筆 = HCTBASE 13 筆（cost 1430、fee 110）
--                              + SF      2 筆（cost 0、fee 0）
--   * order       2 筆 / cost 220  / fee 110
--   * sales_note 13 筆 / cost 1210 / fee 0（其中 11 筆為客戶免運，正確值）
-- 僅改 fee_payment，絕不動 fee / cost（費用與月結金額無關，見 list_settleable_shipments
-- 以 shipments.cost 為結算依據）。此 UPDATE 具冪等性：僅挑 fee_payment='one_time'
-- 且所綁配送方式為 monthly 的列，重複執行不會二次改動。
UPDATE public.shipments s
SET fee_payment = dm.fee_payment,
    updated_at = now()
FROM public.delivery_methods dm
WHERE dm.id = s.delivery_method_id
  AND s.fee_payment = 'one_time'
  AND dm.fee_payment = 'monthly';