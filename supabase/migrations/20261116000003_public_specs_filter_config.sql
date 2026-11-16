-- 修正 get_public_spec_options 與 get_public_category_specs：
-- 排除 filter_config.enabled = false 的規格（對齊 Admin getFilterConfig 邏輯）
-- configuration 可為 object 或 array（array 取 [0]），再取 .filter_config.enabled

-- 1) get_public_spec_options
DROP FUNCTION IF EXISTS public.get_public_spec_options(uuid);
CREATE OR REPLACE FUNCTION public.get_public_spec_options(p_category_id uuid DEFAULT NULL)
RETURNS TABLE (
  spec_id          uuid,
  spec_name        text,
  spec_type        text,
  distinct_values  jsonb
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
    -- filter_config.enabled !== false（對齊 Admin getFilterConfig）
    AND COALESCE(
          (CASE WHEN jsonb_typeof(sd.configuration) = 'array'
                THEN sd.configuration->0
                ELSE sd.configuration END)->'filter_config'->>'enabled',
          'true'
        ) <> 'false'
  ORDER BY sd.sort_order ASC NULLS LAST, sd.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_spec_options(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_spec_options(uuid) TO anon, authenticated;

-- 2) get_public_category_specs
DROP FUNCTION IF EXISTS public.get_public_category_specs(uuid);
CREATE OR REPLACE FUNCTION public.get_public_category_specs(p_category_id uuid)
RETURNS TABLE (
  spec_id    uuid,
  spec_name  text,
  spec_type  text,
  sort_order int
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
  )
  SELECT
    sd.id AS spec_id,
    sd.name AS spec_name,
    sd.type AS spec_type,
    sd.sort_order
  FROM public.category_spec_links csl
  JOIN public.specification_definitions sd ON sd.id = csl.spec_id
  WHERE csl.category_id IN (SELECT id FROM subcats)
    AND COALESCE(
          (CASE WHEN jsonb_typeof(sd.configuration) = 'array'
                THEN sd.configuration->0
                ELSE sd.configuration END)->'filter_config'->>'enabled',
          'true'
        ) <> 'false'
  ORDER BY sd.sort_order ASC NULLS LAST, sd.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_category_specs(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_category_specs(uuid) TO anon, authenticated;
