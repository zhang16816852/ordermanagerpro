-- =============================================================================
-- get_public_products：擴充篩選參數 + 回傳 spec_values
-- -----------------------------------------------------------------------------
-- 新增：p_search (text), p_brand_ids (uuid[]), p_model_ids (uuid[])
-- 新增回傳欄位：spec_values jsonb（產品層級規格值，供前端規格篩選）
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_public_products(uuid, uuid[], int, int, boolean);

CREATE OR REPLACE FUNCTION public.get_public_products(
  p_category_id       uuid    DEFAULT NULL,
  p_product_ids       uuid[]  DEFAULT NULL,
  p_limit             int     DEFAULT 12,
  p_offset            int     DEFAULT 0,
  p_distinct_products boolean DEFAULT false,
  p_search            text    DEFAULT NULL,
  p_brand_ids         uuid[]  DEFAULT NULL,
  p_model_ids         uuid[]  DEFAULT NULL
)
RETURNS TABLE (
  product_id    uuid,
  item_id       uuid,
  item_slug     text,
  product_name  text,
  variant_name  text,
  model_name    text,
  category_id   uuid,
  category_slug text,
  category_name text,
  brand_name    text,
  retail_price  numeric,
  image_url     text,
  spec_values   jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH base AS (
    SELECT
      si.product_id                                AS product_id,
      si.id                                        AS item_id,
      si.slug                                      AS item_slug,
      p.name                                       AS product_name,
      pv.name                                      AS variant_name,
      dm.name                                      AS model_name,
      cat.id                                       AS category_id,
      cat.slug                                     AS category_slug,
      cat.name                                     AS category_name,
      br.name                                      AS brand_name,
      COALESCE(
        NULLIF(pv.retail_price, 0),
        NULLIF(p.unified_retail_price, 0)
      )                                            AS retail_price,
      img.url                                      AS image_url,
      (img.url IS NULL)                            AS img_missing,
      COALESCE(
        (SELECT jsonb_object_agg(esv.spec_id::text, esv.value)
         FROM public.entity_spec_values esv
         WHERE esv.entity_type = 'product'::public.spec_entity_type
           AND esv.entity_id = si.product_id
           AND esv.deleted_at IS NULL),
        '{}'::jsonb
      )                                            AS spec_values
    FROM public.storefront_items si
    JOIN public.products p
      ON p.id = si.product_id
    LEFT JOIN public.product_variants pv
      ON pv.id = si.variant_id
    LEFT JOIN public.device_models dm
      ON dm.id = si.model_id
    LEFT JOIN LATERAL (
      SELECT c.id, c.slug, c.name
      FROM public.product_category_links pcl2
      JOIN public.categories c ON c.id = pcl2.category_id
      WHERE pcl2.product_id = si.product_id
        AND NOT c.is_hidden
        AND (pcl2.variant_id IS NULL OR pcl2.variant_id = si.variant_id)
      ORDER BY
        (pcl2.variant_id IS NOT NULL) DESC,
        c.sort_order ASC NULLS LAST,
        c.name ASC
      LIMIT 1
    ) cat ON true
    LEFT JOIN LATERAL (
      SELECT b.name, b.id AS brand_id
      FROM public.product_brands pb
      JOIN public.brands b ON b.id = pb.brand_id
      WHERE pb.product_id = si.product_id
      ORDER BY pb.is_primary DESC NULLS LAST, b.name ASC
      LIMIT 1
    ) br ON true
    LEFT JOIN LATERAL (
      SELECT pi.url
      FROM public.product_images pi
      WHERE pi.entity_type = 'product'
        AND pi.entity_id = si.product_id
      ORDER BY pi.is_cover DESC, pi.sort_order ASC
      LIMIT 1
    ) img ON true
    WHERE si.status = 'active'
      AND NOT p.is_hidden
      AND p.item_type = 'product'
      AND (p_category_id IS NULL OR cat.id = p_category_id)
      AND (
        p_product_ids IS NULL
        OR cardinality(p_product_ids) = 0
        OR si.product_id = ANY (p_product_ids)
      )
      AND (
        p_search IS NULL OR p_search = ''
        OR p.name ILIKE '%' || p_search || '%'
        OR br.name ILIKE '%' || p_search || '%'
        OR cat.name ILIKE '%' || p_search || '%'
        OR dm.name ILIKE '%' || p_search || '%'
        OR pv.name ILIKE '%' || p_search || '%'
      )
      AND (
        p_brand_ids IS NULL
        OR cardinality(p_brand_ids) = 0
        OR br.brand_id = ANY (p_brand_ids)
      )
      AND (
        p_model_ids IS NULL
        OR cardinality(p_model_ids) = 0
        OR si.model_id = ANY (p_model_ids)
      )
  ),
  picked AS (
    SELECT DISTINCT ON (
      CASE WHEN COALESCE(p_distinct_products, false) THEN product_id ELSE item_id END
    ) b.*
    FROM base b
    ORDER BY
      (CASE WHEN COALESCE(p_distinct_products, false) THEN product_id ELSE item_id END),
      img_missing ASC,
      product_name ASC,
      model_name ASC NULLS LAST,
      item_id ASC
  )
  SELECT
    product_id,
    item_id,
    item_slug,
    product_name,
    variant_name,
    model_name,
    category_id,
    category_slug,
    category_name,
    brand_name,
    retail_price,
    image_url,
    spec_values
  FROM picked
  ORDER BY
    img_missing ASC,
    product_name ASC,
    model_name ASC NULLS LAST,
    item_id ASC
  LIMIT GREATEST(COALESCE(p_limit, 12), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.get_public_products(uuid, uuid[], int, int, boolean, text, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_products(uuid, uuid[], int, int, boolean, text, uuid[], uuid[]) TO anon, authenticated;