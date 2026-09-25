-- 20260925000001_share_rpc_line_note.sql
-- 分享頁收據的「備註」欄位恆空：新增於 items 暴露 order_items.line_note
-- （get_shared_order_details）與 line_type/line_note（get_shared_sales_note_details），
-- 供 SharedOrder/SharedSales 的 toReceiptItems 帶入每列備註。

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
          'line_note', oi.line_note,
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
          'shipping_payment', oi.shipping_payment,
          'line_type', oi.line_type,
          'line_note', oi.line_note
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

GRANT EXECUTE ON FUNCTION public.get_shared_sales_note_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_sales_note_details(TEXT, TEXT) TO authenticated;