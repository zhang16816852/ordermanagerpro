-- 1. consignment_orders 新增 access_token 欄位
ALTER TABLE public.consignment_orders
ADD COLUMN IF NOT EXISTS access_token UUID DEFAULT gen_random_uuid();

-- 回填既有資料
UPDATE public.consignment_orders
SET access_token = gen_random_uuid()
WHERE access_token IS NULL;

-- NOT NULL 約束
ALTER TABLE public.consignment_orders
ALTER COLUMN access_token SET NOT NULL;

-- 2. 新增分享 RPC
CREATE OR REPLACE FUNCTION public.get_shared_consignment_details(
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
        'access_token', co.access_token
      )
      FROM public.consignment_orders co
      LEFT JOIN public.stores s ON s.id = co.store_id
      LEFT JOIN public.suppliers sup ON sup.id = co.supplier_id
      WHERE (co.id = v_uuid_id OR co.code = p_identifier)
      AND co.access_token = p_token::UUID
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
        AND co.access_token = p_token::UUID
      )
    )
  ) INTO v_result;

  IF (v_result->'consignment') IS NULL OR (v_result->'consignment') = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$$;

-- 3. 授權
GRANT EXECUTE ON FUNCTION public.get_shared_consignment_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_consignment_details(TEXT, TEXT) TO authenticated;
