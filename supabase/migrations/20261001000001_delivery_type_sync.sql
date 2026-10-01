-- ============================================================
-- 20261001000001_delivery_type_sync.sql
-- 修正「包裹異動後 SHARE 不顯示物流單號」＋補上可事後修改配送類型的入口。
--
-- 根因：`_recompute_doc_shipping`（20260921000003）只加總 shipping_fee/cost
--       並補配送方式快照，從不寫 `delivery_type`；分享頁
--       `SharedReceiptExport` 以 `deliveryType === 'logistics'` 決定是否顯示
--       「物流單號」，故以物流方式建立的包裹不會讓單據變成 logistics。
--
-- 本 migration：
--   1) 重發 `_recompute_doc_shipping`（簽名不變）——補上配送類型同步：
--      有包裹 → 型別與方式快照一律以「第一包」為準；無包裹 → 保留單據自身設定。
--      （舊語意 coalesce(doc, parcel) 會留下「配送方式：送貨 ＋ 物流包裹」的矛盾資料）
--      回傳值新增 `delivery_type`。
--   2) 新增 `set_doc_delivery_type(p_doc_type, p_doc_id, p_delivery_type)`
--      ——已出貨後手動改配送類型（`sales_notes` 的 UPDATE RLS 只有店 founder/manager，
--      admin 也無權直接改表，故需 SECURITY DEFINER RPC）：
--        * logistics：套用物流方式快照；無包裹時自動建立 1 個包裹。
--        * delivery / pickup：沿用出貨流程語意（delivery 套預設送貨方式、
--          pickup 不帶方式），並一併刪除既有包裹；若包裹已被運費月結引用則擋下。
--   3) 一次性回填既有資料：對「型別與第一包方式不符」的單據委派
--      `_recompute_doc_shipping` 修正（無包裹的單據不受影響）。
--      實測影響 4 張銷貨單（皆為物流包裹但 delivery_type='delivery'）：
--      SL2609CASEAGE0010003、SL2609MY0020005、SL2610MY0020001、SL2610MY0020002。
--
-- ⚠️ 重發同一支 RPC 務必以「最新 body」為基底；`_recompute_doc_shipping`
--    遠端 prosrc 與 20260921000003 檔案本體逐字相同（僅套用時未含註解，
--    去除註解行後 md5 = fa942b28f16d6f68a8004e27896dbe60）。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) 重算單據層運費總額（包裹＝唯一收支單位）＋ 配送類型同步
-- ------------------------------------------------------------
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
  v_method_type text;
  v_delivery_type text;
BEGIN
  SELECT coalesce(sum(s.fee), 0), coalesce(sum(s.cost), 0)
  INTO v_fee, v_cost
  FROM public.shipments s
  WHERE s.doc_type = p_doc_type AND s.doc_id = p_doc_id;

  -- 方法快照取最早一包（包裹存在時以此為準）
  SELECT s.delivery_method_id, s.delivery_method_title, s.delivery_method_code
  INTO v_method_id, v_method_title, v_method_code
  FROM public.shipments s
  WHERE s.doc_type = p_doc_type AND s.doc_id = p_doc_id
  ORDER BY s.created_at, s.id
  LIMIT 1;

  -- 配送類型以第一包的方式類型為準；無包裹（或方式已不存在）則保留 doc 自身設定
  IF v_method_id IS NOT NULL THEN
    SELECT dm.type INTO v_method_type
    FROM public.delivery_methods dm
    WHERE dm.id = v_method_id;
  END IF;
  v_method_type := NULLIF(btrim(COALESCE(v_method_type, '')), '');

  -- 有包裹時方式快照一律以第一包為準（包裹＝配送方式唯一真值來源；
  -- 舊語意 coalesce(doc, parcel) 會留下「配送方式：送貨 ＋ 物流包裹」的矛盾資料）
  IF p_doc_type = 'order' THEN
    UPDATE public.orders o
    SET shipping_fee = v_fee,
        shipping_cost = v_cost,
        delivery_type = coalesce(v_method_type, o.delivery_type, 'delivery'),
        delivery_method_id = coalesce(v_method_id, o.delivery_method_id),
        delivery_method_title = coalesce(v_method_title, o.delivery_method_title),
        delivery_method_code = coalesce(v_method_code, o.delivery_method_code),
        updated_at = now()
    WHERE o.id = p_doc_id
    RETURNING delivery_type INTO v_delivery_type;
  ELSIF p_doc_type = 'sales_note' THEN
    UPDATE public.sales_notes o
    SET shipping_fee = v_fee,
        shipping_cost = v_cost,
        delivery_type = coalesce(v_method_type, o.delivery_type, 'delivery'),
        delivery_method_id = coalesce(v_method_id, o.delivery_method_id),
        delivery_method_title = coalesce(v_method_title, o.delivery_method_title),
        delivery_method_code = coalesce(v_method_code, o.delivery_method_code),
        updated_at = now()
    WHERE o.id = p_doc_id
    RETURNING delivery_type INTO v_delivery_type;
  ELSIF p_doc_type = 'consignment_order' THEN
    UPDATE public.consignment_orders o
    SET shipping_fee = v_fee,
        shipping_cost = v_cost,
        delivery_type = coalesce(v_method_type, o.delivery_type, 'delivery'),
        delivery_method_id = coalesce(v_method_id, o.delivery_method_id),
        delivery_method_title = coalesce(v_method_title, o.delivery_method_title),
        delivery_method_code = coalesce(v_method_code, o.delivery_method_code),
        updated_at = now()
    WHERE o.id = p_doc_id
    RETURNING delivery_type INTO v_delivery_type;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'doc_type', p_doc_type, 'doc_id', p_doc_id,
    'shipping_fee', v_fee, 'shipping_cost', v_cost,
    'delivery_type', coalesce(v_delivery_type, v_method_type)
  );
END;
$function$;

-- 內部 helper：僅供 SECURITY DEFINER 的 upsert_shipment / delete_shipment 呼叫。
-- 需一併 REVOKE authenticated —— migration 20260921000003 曾 GRANT EXECUTE TO authenticated
-- （僅 REVOKE PUBLIC/anon 無法收回，explicit grant 優先），與 DATABASE.md「僅 postgres」的意圖不符。
REVOKE ALL ON FUNCTION public._recompute_doc_shipping(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recompute_doc_shipping(text, uuid) TO postgres;

-- ------------------------------------------------------------
-- 2) 已出貨後手動設定配送類型
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_doc_delivery_type(
  p_doc_type text,
  p_doc_id uuid,
  p_delivery_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $function$
DECLARE
  v_type text := NULLIF(btrim(COALESCE(p_delivery_type, '')), '');
  v_delivery jsonb;
  v_method_id uuid;
  v_method_title text;
  v_method_code text;
  v_method_fee numeric;
  v_method_cost numeric;
  v_first_shipment_id uuid;
  v_parcel_count integer := 0;
  v_settled_count integer := 0;
  v_created_shipment_id uuid;
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可修改配送類型');
  END IF;

  -- ⚠️ NULL 不可放進 NOT IN（三值邏輯會讓守門失效），故一併顯式檢查
  IF p_doc_type IS NULL OR p_doc_type NOT IN ('order', 'sales_note', 'consignment_order') OR p_doc_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '缺少必要參數（doc_type/doc_id）');
  END IF;

  IF v_type IS NULL OR v_type NOT IN ('delivery', 'logistics', 'pickup') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '無效的配送類型：' || COALESCE(p_delivery_type, '(空)'));
  END IF;

  -- 單據存在性
  IF p_doc_type = 'order' THEN
    PERFORM 1 FROM public.orders WHERE id = p_doc_id;
  ELSIF p_doc_type = 'sales_note' THEN
    PERFORM 1 FROM public.sales_notes WHERE id = p_doc_id;
  ELSE
    PERFORM 1 FROM public.consignment_orders WHERE id = p_doc_id;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '單據不存在');
  END IF;

  SELECT count(*) INTO v_parcel_count
  FROM public.shipments
  WHERE doc_type = p_doc_type AND doc_id = p_doc_id;

  SELECT id INTO v_first_shipment_id
  FROM public.shipments
  WHERE doc_type = p_doc_type AND doc_id = p_doc_id
  ORDER BY created_at, id
  LIMIT 1;

  IF v_type = 'logistics' THEN
    -- 物流方式：預設優先，其次 sort_order 最前的啟用中物流方式
    SELECT dm.id, dm.name, dm.code, dm.price, dm.cost
    INTO v_method_id, v_method_title, v_method_code, v_method_fee, v_method_cost
    FROM public.delivery_methods dm
    WHERE dm.type = 'logistics' AND dm.is_active
    ORDER BY dm.is_default DESC, dm.sort_order, dm.created_at
    LIMIT 1;

    IF v_method_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', '尚未設定啟用中的物流配送方式');
    END IF;

    IF v_parcel_count = 0 THEN
      -- 尚無包裹：自動建立 1 個（帶方式運費），讓使用者直接填追蹤號碼
      INSERT INTO public.shipments (
        doc_type, doc_id, delivery_method_id, delivery_method_title, delivery_method_code,
        fee, cost, fee_payment, created_by
      )
      SELECT
        p_doc_type, p_doc_id, dm.id, dm.name, dm.code,
        dm.price, dm.cost, dm.fee_payment, auth.uid()
      FROM public.delivery_methods dm
      WHERE dm.id = v_method_id
      RETURNING id INTO v_created_shipment_id;
    ELSE
      -- 已有包裹：僅把第一包換成物流方式（型別由第一包決定），其餘包裹保留由使用者自行調整
      UPDATE public.shipments
      SET delivery_method_id = v_method_id,
          delivery_method_title = v_method_title,
          delivery_method_code = v_method_code,
          fee = COALESCE(fee, v_method_fee, 0),
          cost = COALESCE(cost, v_method_cost, 0),
          updated_at = now()
      WHERE id = v_first_shipment_id;
    END IF;

    -- 覆寫單據層方式快照，避免出現「配送方式：送貨 ＋ 物流單號」
    IF p_doc_type = 'order' THEN
      UPDATE public.orders
      SET delivery_type = 'logistics',
          delivery_method_id = v_method_id,
          delivery_method_title = v_method_title,
          delivery_method_code = v_method_code,
          updated_at = now()
      WHERE id = p_doc_id;
    ELSIF p_doc_type = 'sales_note' THEN
      UPDATE public.sales_notes
      SET delivery_type = 'logistics',
          delivery_method_id = v_method_id,
          delivery_method_title = v_method_title,
          delivery_method_code = v_method_code,
          updated_at = now()
      WHERE id = p_doc_id;
    ELSE
      UPDATE public.consignment_orders
      SET delivery_type = 'logistics',
          delivery_method_id = v_method_id,
          delivery_method_title = v_method_title,
          delivery_method_code = v_method_code,
          updated_at = now()
      WHERE id = p_doc_id;
    END IF;
  ELSE
    -- 非物流：包裹已被運費月結引用時擋下（避免結算紀錄變成孤兒）
    SELECT count(*) INTO v_settled_count
    FROM public.accounting_entry_references r
    JOIN public.shipments s ON s.id = r.reference_id
    WHERE r.reference_type = 'shipment'
      AND s.doc_type = p_doc_type
      AND s.doc_id = p_doc_id;

    IF v_settled_count > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '已有 ' || v_settled_count || ' 個包裹列入運費月結，請先取消結算後再修改配送類型'
      );
    END IF;

    DELETE FROM public.shipments WHERE doc_type = p_doc_type AND doc_id = p_doc_id;

    -- 方式快照沿用出貨流程語意：delivery → 預設送貨方式；pickup → 不帶方式
    v_delivery := public._resolve_delivery(v_type, NULL, true);

    IF p_doc_type = 'order' THEN
      UPDATE public.orders
      SET delivery_type = v_type,
          delivery_method_id = NULLIF(v_delivery->>'method_id', '')::uuid,
          delivery_method_title = v_delivery->>'method_title',
          delivery_method_code = v_delivery->>'method_code',
          updated_at = now()
      WHERE id = p_doc_id;
    ELSIF p_doc_type = 'sales_note' THEN
      UPDATE public.sales_notes
      SET delivery_type = v_type,
          delivery_method_id = NULLIF(v_delivery->>'method_id', '')::uuid,
          delivery_method_title = v_delivery->>'method_title',
          delivery_method_code = v_delivery->>'method_code',
          updated_at = now()
      WHERE id = p_doc_id;
    ELSE
      UPDATE public.consignment_orders
      SET delivery_type = v_type,
          delivery_method_id = NULLIF(v_delivery->>'method_id', '')::uuid,
          delivery_method_title = v_delivery->>'method_title',
          delivery_method_code = v_delivery->>'method_code',
          updated_at = now()
      WHERE id = p_doc_id;
    END IF;
  END IF;

  v_result := public._recompute_doc_shipping(p_doc_type, p_doc_id);

  RETURN v_result
    || jsonb_build_object('delivery_type', v_type, 'created_shipment_id', v_created_shipment_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_doc_delivery_type(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_doc_delivery_type(text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.set_doc_delivery_type IS '事後設定單據配送類型（logistics 自動建立/套用物流方式與包裹；非物流則刪除包裹，套用出貨流程的方式語意）';

-- ------------------------------------------------------------
-- 3) 一次性回填既有資料：以第一包的方式類型修正 delivery_type 與方式快照
--    （委派 _recompute_doc_shipping 統一語意；無包裹的單據不受影響）
-- ------------------------------------------------------------
DO $backfill$
DECLARE
  v_table text;
  v_doc_type text;
  v_count integer;
  v_total integer := 0;
  v_report jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['orders', 'sales_notes', 'consignment_orders'] LOOP
    v_doc_type := CASE v_table
      WHEN 'orders' THEN 'order'
      WHEN 'sales_notes' THEN 'sales_note'
      ELSE 'consignment_order'
    END;

    EXECUTE format(
      'WITH first_parcel AS (
         SELECT DISTINCT ON (s.doc_id) s.doc_id, dm.type AS dm_type
           FROM public.shipments s
           JOIN public.delivery_methods dm ON dm.id = s.delivery_method_id
          WHERE s.doc_type = %L
            AND dm.type IS NOT NULL
            AND dm.type <> ''''
          ORDER BY s.doc_id, s.created_at, s.id
       ), targets AS (
         SELECT o.id
           FROM public.%I o
           JOIN first_parcel fp ON fp.doc_id = o.id
          WHERE o.delivery_type IS DISTINCT FROM fp.dm_type
       )
       SELECT count(*)
         FROM targets t
         CROSS JOIN LATERAL public._recompute_doc_shipping(%L, t.id)',
      v_doc_type, v_table, v_doc_type
    ) INTO v_count;

    v_total := v_total + v_count;
    v_report := v_report || jsonb_build_object(v_doc_type, v_count);
  END LOOP;

  RAISE NOTICE 'delivery_type 回填：% （合計 %）', v_report, v_total;
END;
$backfill$;

NOTIFY pgrst, 'reload schema';

COMMIT;