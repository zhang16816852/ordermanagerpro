-- 20260930000001_share_rpc_delivery_type.sql
-- 分享頁收據表頭需判斷「送貨類型是否為物流」才能額外顯示物流單號，
-- 故於三支分享 RPC 的 doc 物件（order / sales_note / consignment）補回傳
-- delivery_type（'delivery' | 'logistics' | 'pickup'）。
-- 簽名不變、其餘欄位與驗證邏輯完全沿用線上最新版本（僅 CREATE OR REPLACE body）。

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
        'delivery_type', o.delivery_type,
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
        'delivery_type', sn.delivery_type,
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
        'delivery_type', co.delivery_type,
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

GRANT EXECUTE ON FUNCTION public.get_shared_consignment_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_consignment_details(TEXT, TEXT) TO authenticated;
