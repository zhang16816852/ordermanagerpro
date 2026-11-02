-- 20261103000001_list_settleable_shipments_all.sql
-- 運費結帳：顯示所有物流公司（跨供應商）的月結未結算包裹，不再強制先選供應商。
--   1. p_supplier_id 改為 DEFAULT NULL：NULL 時回傳所有 logistics 供應商的月結未結算包裹
--   2. 輸出加入 supplier_id / supplier_name，方便前端顯示與篩選
--   3. 既有呼叫端（帶 supplier_id）行為不變

BEGIN;

DROP FUNCTION IF EXISTS public.list_settleable_shipments(uuid);

CREATE OR REPLACE FUNCTION public.list_settleable_shipments(p_supplier_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION '僅限管理員操作';
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
      'note', s.note,
      'supplier_id', dm.supplier_id,
      'supplier_name', sup.name
    ) ORDER BY sup.name, s.shipped_at DESC NULLS LAST, s.created_at DESC
  )
  INTO v_result
  FROM public.shipments s
  JOIN public.delivery_methods dm ON dm.id = s.delivery_method_id
  LEFT JOIN public.suppliers sup ON sup.id = dm.supplier_id
  WHERE s.fee_payment = 'monthly'
    AND s.delivery_method_id IS NOT NULL
    AND dm.is_active
    AND (p_supplier_id IS NULL OR dm.supplier_id = p_supplier_id)
    AND (p_supplier_id IS NULL OR sup.is_logistics_company = true)
    -- 未被任何「已結算」期間涵蓋
    AND NOT EXISTS (
      SELECT 1
      FROM public.accounting_entry_references r
      JOIN public.shipping_settlement_periods sp ON sp.entry_id = r.entry_id
      WHERE r.reference_type = 'shipment'
        AND r.reference_id = s.id
        AND sp.is_settled = true
        AND (p_supplier_id IS NULL OR sp.supplier_id = p_supplier_id)
    );

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.list_settleable_shipments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_settleable_shipments(uuid) TO authenticated;

COMMIT;
