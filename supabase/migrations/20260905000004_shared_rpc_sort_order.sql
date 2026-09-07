-- 修正分享頁 RPC：品項依 order_items.sort_order 排序，與訂單詳情一致
-- 1. get_shared_order_details
CREATE OR REPLACE FUNCTION public.get_shared_order_details(
  p_identifier TEXT,
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        'store_name', s.name
      )
      FROM public.orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE (o.id = v_order_id OR o.code = p_identifier)
      AND o.access_token = p_token::UUID
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'variant_name', pv.name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'sort_order', oi.sort_order
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
$$;

-- 2. get_shared_sales_note_details
CREATE OR REPLACE FUNCTION public.get_shared_sales_note_details(
  p_identifier TEXT,
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        'access_token', sn.access_token
      )
      FROM public.sales_notes sn
      JOIN public.stores s ON s.id = sn.store_id
      WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
      AND sn.access_token = p_token::UUID
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'variant_name', pv.name,
          'quantity', sni.quantity,
          'unit_price', oi.unit_price,
          'sort_order', oi.sort_order
        )
        ORDER BY oi.sort_order, oi.created_at
      )
      FROM public.sales_note_items sni
      JOIN public.order_items oi ON oi.id = sni.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
      WHERE sni.sales_note_id IN (
        SELECT sn.id FROM public.sales_notes sn
        WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
        AND sn.access_token = p_token::UUID
      )
    )
  ) INTO v_result;

  IF (v_result->'sales_note') IS NULL OR (v_result->'sales_note') = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shared_order_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_order_details(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_sales_note_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_sales_note_details(TEXT, TEXT) TO authenticated;
