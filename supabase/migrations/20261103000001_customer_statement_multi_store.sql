-- ═══════════════════════════════════════════════════════════════
-- 客戶對帳單擴充：支援多店家（同品牌）
-- 新增 join table customer_statement_share_stores；
-- customer_statement_shares.brand 快照欄位；store_id 改 nullable（相容舊資料）。
-- 新 RPC create_customer_statement_share（單一交易建立＋品牌守門）；
-- 重發 get_shared_customer_statement（依 join table 取 store_ids、回傳 stores 陣列）。
-- ================================================================

-- 1. join table
CREATE TABLE IF NOT EXISTS public.customer_statement_share_stores (
  statement_id uuid NOT NULL REFERENCES public.customer_statement_shares(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id),
  PRIMARY KEY (statement_id, store_id)
);

ALTER TABLE public.customer_statement_share_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage customer_statement_share_stores"
  ON public.customer_statement_share_stores;
CREATE POLICY "Admins can manage customer_statement_share_stores"
  ON public.customer_statement_share_stores
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.system_role));

-- 2. 主表：brand 快照欄位 + store_id 改 nullable
ALTER TABLE public.customer_statement_shares
  ADD COLUMN IF NOT EXISTS brand text;

ALTER TABLE public.customer_statement_shares
  ALTER COLUMN store_id DROP NOT NULL;

-- 3. backfill：舊 store_id -> join table + brand
INSERT INTO public.customer_statement_share_stores (statement_id, store_id)
SELECT cs.id, cs.store_id
FROM public.customer_statement_shares cs
WHERE cs.store_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE public.customer_statement_shares cs
SET brand = s.brand
FROM public.stores s
WHERE cs.store_id = s.id
  AND cs.brand IS NULL;

-- 4. 建立 RPC（單一交易＋品牌守門）
CREATE OR REPLACE FUNCTION public.create_customer_statement_share(
  p_title text,
  p_store_ids uuid[],
  p_date_from date,
  p_date_to date,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_brand text;
  v_store_ids uuid[];
  v_statement public.customer_statement_shares%ROWTYPE;
  v_stores jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可建立對帳單');
  END IF;

  IF p_store_ids IS NULL OR COALESCE(array_length(p_store_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '請至少選擇一家店家');
  END IF;

  -- 驗證所有店家存在
  SELECT COALESCE(array_agg(s.id ORDER BY s.name), ARRAY[]::uuid[])
    INTO v_store_ids
    FROM public.stores s
    WHERE s.id = ANY(p_store_ids);

  IF COALESCE(array_length(v_store_ids, 1), 0) <> COALESCE(array_length(p_store_ids, 1), 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '部分店家不存在');
  END IF;

  -- 品牌守門：所有店家必須同品牌
  SELECT s.brand INTO v_brand
  FROM public.stores s
  WHERE s.id = p_store_ids[1];

  IF EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = ANY(p_store_ids)
      AND s.brand IS DISTINCT FROM v_brand
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '所選店家必須屬於同一品牌');
  END IF;

  INSERT INTO public.customer_statement_shares (title, brand, date_from, date_to, created_by)
  VALUES (p_title, v_brand, p_date_from, p_date_to, p_created_by)
  RETURNING * INTO v_statement;

  INSERT INTO public.customer_statement_share_stores (statement_id, store_id)
  SELECT v_statement.id, unnest(p_store_ids)
  ON CONFLICT DO NOTHING;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code, 'brand', s.brand)
    ORDER BY s.name
  ), '[]'::jsonb)
    INTO v_stores
    FROM public.stores s
    WHERE s.id = ANY(p_store_ids);

  RETURN jsonb_build_object('ok', true, 'statement', jsonb_build_object(
    'id', v_statement.id,
    'title', v_statement.title,
    'brand', v_statement.brand,
    'date_from', v_statement.date_from,
    'date_to', v_statement.date_to,
    'access_token', v_statement.access_token,
    'created_by', v_statement.created_by,
    'created_at', v_statement.created_at,
    'stores', v_stores
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.create_customer_statement_share(TEXT, UUID[], DATE, DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_customer_statement_share(TEXT, UUID[], DATE, DATE, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_customer_statement_share(TEXT, UUID[], DATE, DATE, UUID) TO authenticated;

-- 5. 重發讀取 RPC（多店家）
CREATE OR REPLACE FUNCTION public.get_shared_customer_statement(p_statement_id text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_statement public.customer_statement_shares%ROWTYPE;
  v_store_ids uuid[];
  v_result JSONB;
BEGIN
  BEGIN
    SELECT * INTO v_statement
    FROM public.customer_statement_shares cs
    WHERE cs.id = p_statement_id::uuid
      AND cs.access_token = p_token::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 取 store_ids（join table 優先，fallback 舊 store_id）
  SELECT COALESCE(array_agg(css.store_id), ARRAY[]::uuid[])
    INTO v_store_ids
    FROM public.customer_statement_share_stores css
    WHERE css.statement_id = v_statement.id;

  IF COALESCE(array_length(v_store_ids, 1), 0) = 0 AND v_statement.store_id IS NOT NULL THEN
    v_store_ids := ARRAY[v_statement.store_id];
  END IF;

  IF COALESCE(array_length(v_store_ids, 1), 0) = 0 THEN
    RETURN NULL;
  END IF;

  -- 品牌守門：所有店家必須同品牌
  IF EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = ANY(v_store_ids)
      AND s.brand IS DISTINCT FROM (SELECT brand FROM public.stores WHERE id = v_store_ids[1])
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'statement', jsonb_build_object(
      'id', v_statement.id,
      'title', v_statement.title,
      'brand', v_statement.brand,
      'date_from', v_statement.date_from,
      'date_to', v_statement.date_to,
      'created_at', v_statement.created_at
    ),
    'stores', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'code', s.code,
          'brand', s.brand,
          'recipient', s.recipient,
          'phone', s.phone,
          'city', s.city,
          'district', s.district,
          'address', s.address
        )
        ORDER BY s.name
      ), '[]'::jsonb)
      FROM public.stores s
      WHERE s.id = ANY(v_store_ids)
    ),
    'notes', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', sn.id,
          'code', sn.code,
          'status', sn.status,
          'payment_status', COALESCE(sn.payment_status, 'unpaid'),
          'shipped_at', sn.shipped_at,
          'notes', sn.notes,
          'shipping_fee', sn.shipping_fee,
          'delivery_method_title', sn.delivery_method_title,
          'access_token', sn.access_token,
          'store_id', sn.store_id,
          'items', (
            SELECT jsonb_agg(
              jsonb_build_object(
                'product_name', p.name,
                'variant_name', pv.name,
                'quantity', sni.quantity,
                'unit_price', oi.unit_price,
                'sort_order', COALESCE(sni.sort_order, 0),
                'line_type', oi.line_type
              )
              ORDER BY COALESCE(sni.sort_order, 0), oi.sort_order, oi.created_at
            )
            FROM public.sales_note_items sni
            JOIN public.order_items oi ON oi.id = sni.order_item_id
            JOIN public.products p ON p.id = oi.product_id
            LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
            WHERE sni.sales_note_id = sn.id
          )
        )
        ORDER BY sn.shipped_at, sn.code, sn.id
      ), '[]'::jsonb)
      FROM public.sales_notes sn
      WHERE sn.store_id = ANY(v_store_ids)
        AND sn.shipped_at IS NOT NULL
        AND sn.shipped_at >= (v_statement.date_from::timestamp)
        AND sn.shipped_at < (v_statement.date_to::timestamp + interval '1 day')
    )
  ) INTO v_result;

  IF (v_result->'stores') IS NULL OR (v_result->'stores') = 'null'::jsonb
     OR jsonb_array_length(v_result->'stores') = 0 THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_shared_customer_statement(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_shared_customer_statement(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_shared_customer_statement(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_customer_statement(TEXT, TEXT) TO authenticated;
