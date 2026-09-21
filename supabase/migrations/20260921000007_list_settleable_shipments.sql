-- 20260921000007_list_settleable_shipments.sql
-- 物流系統重構 Phase C-6：運費結帳清單改以 shipments（包裹）為單位。
--   新 RPC public.list_settleable_shipments(p_supplier_id)
--   → 列出該物流公司（suppliers.is_logistics_company）名下可結算之月結包裹
--     （fee_payment='monthly'、方式屬該公司、未結算過），附單據編號（訂單/銷貨單/寄賣單）。
--   前端「運費結帳」Tab 以本 RPC 取代舊 order_items(.product.supplier_id) 查詢。

BEGIN;

CREATE OR REPLACE FUNCTION public.list_settleable_shipments(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_ship record;
  v_doc_code text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION '僅限管理員操作';
  END IF;

  IF p_supplier_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'doc_type', s.doc_type,
      'doc_id', s.doc_id,
      'doc_code',
        CASE s.doc_type
          WHEN 'order' THEN (SELECT o.code FROM public.orders o WHERE o.id = s.doc_id)
          WHEN 'sales_note' THEN (SELECT sn.code FROM public.sales_notes sn WHERE sn.id = s.doc_id)
          WHEN 'consignment_order' THEN (SELECT co.code FROM public.consignment_orders co WHERE co.id = s.doc_id)
          ELSE NULL
        END,
      'method_id', s.delivery_method_id,
      'method_title', s.delivery_method_title,
      'method_code', s.delivery_method_code,
      'fee', s.fee,
      'cost', s.cost,
      'fee_payment', s.fee_payment,
      'tracking_company', s.tracking_company,
      'tracking_number', s.tracking_number,
      'tracking_url', s.tracking_url,
      'shipped_at', s.shipped_at,
      'note', s.note
    ) ORDER BY s.shipped_at DESC NULLS LAST, s.created_at DESC
  )
  INTO v_result
  FROM public.shipments s
  WHERE s.fee_payment = 'monthly'
    AND s.delivery_method_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.delivery_methods dm
      WHERE dm.id = s.delivery_method_id
        AND dm.supplier_id = p_supplier_id
        AND dm.is_active
    )
    -- 未被任何「已結算」期間涵蓋
    AND NOT EXISTS (
      SELECT 1
      FROM public.accounting_entry_references r
      JOIN public.shipping_settlement_periods sp ON sp.entry_id = r.entry_id
      WHERE r.reference_type = 'shipment'
        AND r.reference_id = s.id
        AND sp.supplier_id = p_supplier_id
        AND sp.is_settled = true
    );

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.list_settleable_shipments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_settleable_shipments(uuid) TO authenticated;

COMMIT;