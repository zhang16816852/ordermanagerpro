-- 修正 get_public_spec_options：entity_spec_values 有 variant 層級（1233 筆）與 product 層級（8 筆）
-- 原本只查 entity_type='product'，導致 Shop 側邊欄規格篩選幾乎全空
-- 現在同時查 product 與 variant 層級，variant specs 映射到其 parent product 的分類
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
  target_variants AS (
    SELECT pv.id AS variant_id
    FROM public.product_variants pv
    WHERE pv.product_id IN (SELECT product_id FROM target_products)
  ),
  spec_vals AS (
    SELECT
      esv.spec_id,
      esv.value
    FROM public.entity_spec_values esv
    WHERE esv.deleted_at IS NULL
      AND esv.value IS NOT NULL
      AND (
        (esv.entity_type = 'product'::public.spec_entity_type AND esv.entity_id IN (SELECT product_id FROM target_products))
        OR
        (esv.entity_type = 'variant'::public.spec_entity_type AND esv.entity_id IN (SELECT variant_id FROM target_variants))
      )
  )
  SELECT
    sd.id AS spec_id,
    sd.name AS spec_name,
    sd.type AS spec_type,
    COALESCE(
      (SELECT jsonb_agg(DISTINCT sv.value) FROM spec_vals sv WHERE sv.spec_id = sd.id),
      '[]'::jsonb
    ) AS distinct_values
  FROM public.specification_definitions sd
  WHERE EXISTS (SELECT 1 FROM spec_vals sv WHERE sv.spec_id = sd.id)
  ORDER BY sd.sort_order ASC NULLS LAST, sd.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_spec_options(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_spec_options(uuid) TO anon, authenticated;
