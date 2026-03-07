-- 1. 更新獲取分享訂單詳情的函數：支援 UUID 或流水號 (code)
CREATE OR REPLACE FUNCTION public.get_shared_order_details(
  p_identifier TEXT, -- 可以是 UUID 或是 流水號 (code)
  p_token TEXT
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_uuid_id UUID;
BEGIN
  -- 嘗試將識別符轉為 UUID (如果失敗則代表它是 code)
  BEGIN
    v_uuid_id := p_identifier::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_uuid_id := NULL;
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
        'access_token', o.access_token -- 前端驗證 token 用
      )
      FROM public.orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE (o.id = v_uuid_id OR o.code = p_identifier)
        AND o.access_token = p_token
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price
        )
      )
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id IN (
        SELECT o.id FROM public.orders o 
        WHERE (o.id = v_uuid_id OR o.code = p_identifier)
          AND o.access_token = p_token
      )
    )
  ) INTO v_result;

  -- 如果沒找到訂單，回傳 NULL 或空 JSON，讓前端處理錯誤
  IF (v_result->>'order') IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$$;

-- 2. 更新獲取分享銷貨單詳情的函數：支援 UUID 或流水號 (code)
CREATE OR REPLACE FUNCTION public.get_shared_sales_note_details(
  p_identifier TEXT, -- 可以是 UUID 或是 流水號 (code)
  p_token TEXT
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_uuid_id UUID;
BEGIN
  -- 嘗試將識別符轉為 UUID
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
        'status', sn.status,
        'notes', sn.notes,
        'store_name', s.name,
        'access_token', sn.access_token
      )
      FROM public.sales_notes sn
      JOIN public.stores s ON s.id = sn.store_id
      WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
        AND sn.access_token = p_token
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'quantity', sni.quantity,
          'unit_price', oi.unit_price
        )
      )
      FROM public.sales_note_items sni
      JOIN public.order_items oi ON oi.id = sni.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      WHERE sni.sales_note_id IN (
        SELECT sn.id FROM public.sales_notes sn
        WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
          AND sn.access_token = p_token
      )
    )
  ) INTO v_result;

  IF (v_result->>'sales_note') IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$$;
