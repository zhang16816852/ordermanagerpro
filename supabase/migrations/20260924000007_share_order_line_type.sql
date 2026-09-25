-- 20260924000007_share_order_line_type.sql
-- get_shared_order_details 於 items 暴露 line_type / return_status / is_repair，
-- 供分享訂單頁（SharedOrder）將退貨/送修列以負數量淨扣呈現。

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
          'shipping_payment', oi.shipping_payment,
          'line_type', oi.line_type,
          'return_status', oi.return_status,
          'is_repair', oi.is_repair
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

GRANT EXECUTE ON FUNCTION public.get_shared_order_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_order_details(TEXT, TEXT) TO authenticated;