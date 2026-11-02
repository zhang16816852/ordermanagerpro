-- 匯入商品解析：當廠商料號缺漏時，以「廠商品名」比對 supplier_product_mappings
--
-- 背景：_po_resolve_item 原本只在 vendor_product_id（廠商料號）有值時才查 mapping，
-- 若檔案只有「品名」欄，mapping 路徑完全跳過，只能靠 import_resolve_item 的
-- SKU／產品名 fallback（且品名對不上時整張單 RAISE 中止）。
-- 本次在 mapping 查詢後新增「廠商品名」分支：當廠商料號缺漏、但品名有值時，
-- 以 btrim(vendor_product_name) = btrim(p_item_name) 查詢 supplier_product_mappings，
-- 採用與廠商料號分支完全相同的排序與 ambiguous 定義，找到即回傳（source='mapping'）。
--
-- 簽名不變（p_supplier_id, p_sku, p_item_name, p_vendor_product_id），避免 PostgREST
-- overload / PGRST203；CREATE OR REPLACE + 重新 REVOKE/GRANT。

CREATE OR REPLACE FUNCTION public._po_resolve_item(
  p_supplier_id uuid DEFAULT NULL::uuid,
  p_sku text DEFAULT NULL::text,
  p_item_name text DEFAULT NULL::text,
  p_vendor_product_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_vendor_id text := NULLIF(btrim(COALESCE(p_vendor_product_id, '')), '');
  v_name_id   text := NULLIF(btrim(COALESCE(p_item_name, '')), '');
  v_product_id uuid;
  v_variant_id uuid;
  v_cost numeric;
  v_label text;
  v_res jsonb;
  v_mapping_id uuid;
  v_is_primary boolean;
  v_candidates integer := 0;
  v_primary_count integer := 0;
BEGIN
  -- (1) 供應商對照：廠商料號（既有）
  IF v_vendor_id IS NOT NULL AND p_supplier_id IS NOT NULL THEN
    SELECT count(*) INTO v_candidates
      FROM public.supplier_product_mappings m
     WHERE m.supplier_id = p_supplier_id
       AND m.vendor_product_id = v_vendor_id;

    SELECT count(*) INTO v_primary_count
      FROM public.supplier_product_mappings m
     WHERE m.supplier_id = p_supplier_id
       AND m.vendor_product_id = v_vendor_id
       AND m.is_primary;

    SELECT m.id, m.internal_product_id, m.internal_variant_id, m.vendor_unit_cost, m.is_primary
      INTO v_mapping_id, v_product_id, v_variant_id, v_cost, v_is_primary
      FROM public.supplier_product_mappings m
     WHERE m.supplier_id = p_supplier_id
       AND m.vendor_product_id = v_vendor_id
     ORDER BY m.is_primary DESC, m.updated_at DESC NULLS LAST, m.created_at DESC, m.id
     LIMIT 1;

    IF FOUND THEN
      SELECT COALESCE(pv.name, p.name)
        INTO v_label
        FROM public.products p
        LEFT JOIN public.product_variants pv ON pv.id = v_variant_id
       WHERE p.id = v_product_id;

      RETURN jsonb_build_object(
        'product_id', v_product_id,
        'variant_id', v_variant_id,
        'name', COALESCE(v_label, v_vendor_id),
        'unit_cost', v_cost,
        'source', 'mapping',
        'mapping_id', v_mapping_id,
        'is_primary', COALESCE(v_is_primary, false),
        'candidate_count', v_candidates,
        'ambiguous', (v_candidates > 1 AND v_primary_count = 0)
      );
    END IF;
  END IF;

  -- (1b) 供應商對照：廠商品名（新增；僅當廠商料號缺漏時嘗試）
  --      用途：匯入檔案只有「品名」欄、沒有「廠商料號」時，仍可從 mapping 找到對應商品。
  IF v_vendor_id IS NULL AND v_name_id IS NOT NULL AND p_supplier_id IS NOT NULL THEN
    SELECT count(*) INTO v_candidates
      FROM public.supplier_product_mappings m
     WHERE m.supplier_id = p_supplier_id
       AND btrim(COALESCE(m.vendor_product_name, '')) = v_name_id;

    SELECT count(*) INTO v_primary_count
      FROM public.supplier_product_mappings m
     WHERE m.supplier_id = p_supplier_id
       AND btrim(COALESCE(m.vendor_product_name, '')) = v_name_id
       AND m.is_primary;

    SELECT m.id, m.internal_product_id, m.internal_variant_id, m.vendor_unit_cost, m.is_primary
      INTO v_mapping_id, v_product_id, v_variant_id, v_cost, v_is_primary
      FROM public.supplier_product_mappings m
     WHERE m.supplier_id = p_supplier_id
       AND btrim(COALESCE(m.vendor_product_name, '')) = v_name_id
     ORDER BY m.is_primary DESC, m.updated_at DESC NULLS LAST, m.created_at DESC, m.id
     LIMIT 1;

    IF FOUND THEN
      SELECT COALESCE(pv.name, p.name)
        INTO v_label
        FROM public.products p
        LEFT JOIN public.product_variants pv ON pv.id = v_variant_id
       WHERE p.id = v_product_id;

      RETURN jsonb_build_object(
        'product_id', v_product_id,
        'variant_id', v_variant_id,
        'name', COALESCE(v_label, v_name_id),
        'unit_cost', v_cost,
        'source', 'mapping',
        'mapping_id', v_mapping_id,
        'is_primary', COALESCE(v_is_primary, false),
        'candidate_count', v_candidates,
        'ambiguous', (v_candidates > 1 AND v_primary_count = 0)
      );
    END IF;
  END IF;

  -- (2)(3) 內部 SKU / 品名 fallback（既有 import_resolve_item）
  v_res := public.import_resolve_item(p_sku, p_item_name);
  IF v_res IS NOT NULL THEN
    RETURN (v_res - 'fallback_price')
      || jsonb_build_object(
           'unit_cost', v_res->'fallback_price',
           'source', 'sku',
           'mapping_id', NULL,
           'is_primary', NULL,
           'candidate_count', 0,
           'ambiguous', false
         );
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._po_resolve_item(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._po_resolve_item(uuid, text, text, text) TO authenticated;