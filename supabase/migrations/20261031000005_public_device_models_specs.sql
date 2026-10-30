-- =============================================================================
-- 公開資料層 Phase A-2：裝置型號 + 規格篩選值
-- =============================================================================
-- 1) get_public_device_models：型號清單 + 商品數
DROP FUNCTION IF EXISTS public.get_public_device_models();
CREATE OR REPLACE FUNCTION public.get_public_device_models()
RETURNS TABLE (
  id            uuid,
  name          text,
  brand_id      uuid,
  product_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    dm.id,
    dm.name,
    dm.brand_id,
    COUNT(DISTINCT si.product_id) AS product_count
  FROM public.device_models dm
  JOIN public.storefront_items si ON si.model_id = dm.id
  JOIN public.products p ON p.id = si.product_id
  WHERE si.status = 'active'
    AND NOT p.is_hidden
    AND p.item_type = 'product'
    AND dm.is_active = true
  GROUP BY dm.id, dm.name, dm.brand_id
  ORDER BY dm.name ASC;
$$;

-- 2) get_public_spec_options：給定分類（含子分類）下，各規格的 distinct 值
DROP FUNCTION IF EXISTS public.get_public_spec_options(uuid);
CREATE OR REPLACE FUNCTION public.get_public_spec_options(p_category_id uuid DEFAULT NULL)
RETURNS TABLE (
  spec_id    uuid,
  spec_name  text,
  spec_type  text,
  values     jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH RECURSIVE subcats(id) AS (
    SELECT p_category_id
    WHERE p_category_id IS NOT NULL
    UNION
    SELECT ch.child_id
    FROM public.category_hierarchy ch
    JOIN subcats s ON ch.parent_id = s.id
  ),
  target_products AS (
    SELECT DISTINCT si.product_id
    FROM public.storefront_items si
    JOIN public.products p ON p.id = si.product_id
    JOIN public.product_category_links pcl
      ON pcl.product_id = si.product_id
     AND (pcl.variant_id IS NULL OR pcl.variant_id = si.variant_id)
    WHERE si.status = 'active'
      AND NOT p.is_hidden
      AND p.item_type = 'product'
      AND (p_category_id IS NULL OR pcl.category_id IN (SELECT id FROM subcats))
  ),
  spec_vals AS (
    SELECT
      esv.spec_id,
      esv.value
    FROM public.entity_spec_values esv
    WHERE esv.entity_type = 'product'::public.spec_entity_type
      AND esv.entity_id IN (SELECT product_id FROM target_products)
      AND esv.deleted_at IS NULL
      AND esv.value IS NOT NULL
  )
  SELECT
    sd.id AS spec_id,
    sd.name AS spec_name,
    sd.type AS spec_type,
    COALESCE(
      (SELECT jsonb_agg(DISTINCT sv.value) FROM spec_vals sv WHERE sv.spec_id = sd.id),
      '[]'::jsonb
    ) AS values
  FROM public.specification_definitions sd
  WHERE EXISTS (SELECT 1 FROM spec_vals sv WHERE sv.spec_id = sd.id)
  ORDER BY sd.sort_order ASC NULLS LAST, sd.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_device_models() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_device_models() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_spec_options(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_spec_options(uuid) TO anon, authenticated;