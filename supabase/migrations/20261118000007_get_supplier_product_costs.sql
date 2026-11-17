-- 20261118000007 供應商商品成本查詢 RPC：一次回傳該供應商所有商品的成本 Map
-- 優先序：供應商對照 vendor_unit_cost → 最新進貨成本 → FIFO 最早批次成本
-- 前端只需一次呼叫，不論產品數量

CREATE OR REPLACE FUNCTION public.get_supplier_product_costs(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
BEGIN
  IF p_supplier_id IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  WITH
  -- 1. 供應商對照成本（最高優先）
  mapping_costs AS (
    SELECT spm.internal_product_id,
           spm.internal_variant_id,
           spm.vendor_unit_cost AS cost,
           'mapping' AS source
    FROM public.supplier_product_mappings spm
    WHERE spm.supplier_id = p_supplier_id
      AND spm.vendor_unit_cost IS NOT NULL
      AND spm.vendor_unit_cost > 0
  ),
  -- 2. 最新進貨成本（同供應商 + 同商品/變體，按 created_at DESC）
  historical_costs AS (
    SELECT DISTINCT ON (poi.product_id, poi.variant_id)
      poi.product_id,
      poi.variant_id,
      poi.unit_cost AS cost,
      'historical' AS source
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    WHERE po.supplier_id = p_supplier_id
      AND poi.unit_cost > 0
    ORDER BY poi.product_id, poi.variant_id, poi.created_at DESC
  ),
  -- 3. FIFO 最早批次成本（按 received_at ASC）
  fifo_costs AS (
    SELECT DISTINCT ON (pb.product_id, pb.variant_id)
      pb.product_id,
      pb.variant_id,
      pb.unit_cost AS cost,
      'fifo' AS source
    FROM public.product_batches pb
    WHERE pb.unit_cost > 0
    ORDER BY pb.product_id, pb.variant_id, pb.received_at ASC NULLS LAST, pb.created_at ASC
  ),
  -- 合併：mapping 優先，其次 historical，最後 fifo
  merged AS (
    SELECT
      COALESCE(m.internal_product_id, h.product_id, f.product_id) AS product_id,
      COALESCE(m.internal_variant_id, h.variant_id, f.variant_id) AS variant_id,
      COALESCE(m.cost, h.cost, f.cost) AS cost,
      CASE
        WHEN m.cost IS NOT NULL THEN 'mapping'
        WHEN h.cost IS NOT NULL THEN 'historical'
        ELSE 'fifo'
      END AS source
    FROM mapping_costs m
    FULL OUTER JOIN historical_costs h
      ON m.internal_product_id = h.product_id
     AND (m.internal_variant_id IS NOT DISTINCT FROM h.variant_id)
    FULL OUTER JOIN fifo_costs f
      ON COALESCE(m.internal_product_id, h.product_id) = f.product_id
     AND (COALESCE(m.internal_variant_id, h.variant_id) IS NOT DISTINCT FROM f.variant_id)
    WHERE COALESCE(m.cost, h.cost, f.cost) IS NOT NULL
  )
  SELECT COALESCE(jsonb_object_agg(
    mc.product_id::text || '_' || COALESCE(mc.variant_id::text, ''),
    jsonb_build_object('cost', mc.cost, 'source', mc.source)
  ), '{}'::jsonb)
  INTO v_result
  FROM merged mc;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_supplier_product_costs(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_product_costs(uuid) TO authenticated;