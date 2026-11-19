-- get_public_products_count：回傳與 get_public_products 相同篩選條件下的總筆數
-- 供 Shop 頁面分頁使用
DROP FUNCTION IF EXISTS public.get_public_products_count(uuid, uuid[], boolean, text, uuid[], uuid[]);
CREATE OR REPLACE FUNCTION public.get_public_products_count(
  p_category_id       uuid    DEFAULT NULL,
  p_product_ids       uuid[]  DEFAULT NULL,
  p_distinct_products boolean DEFAULT false,
  p_search            text    DEFAULT NULL,
  p_brand_ids         uuid[]  DEFAULT NULL,
  p_model_ids         uuid[]  DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH base AS (
    SELECT
      si.product_id AS product_id,
      si.id         AS item_id,
      (img.url IS NULL) AS img_missing
    FROM public.storefront_items si
    JOIN public.products p ON p.id = si.product_id
    LEFT JOIN public.product_variants pv ON pv.id = si.variant_id
    LEFT JOIN public.device_models dm ON dm.id = si.model_id
    LEFT JOIN LATERAL (
      SELECT c.id, c.name
      FROM public.product_category_links pcl2
      JOIN public.categories c ON c.id = pcl2.category_id
      WHERE pcl2.product_id = si.product_id
        AND NOT c.is_hidden
        AND (pcl2.variant_id IS NULL OR pcl2.variant_id = si.variant_id)
      ORDER BY (pcl2.variant_id IS NOT NULL) DESC, c.sort_order ASC NULLS LAST, c.name ASC
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
      WHERE pi.entity_type = 'product' AND pi.entity_id = si.product_id
      ORDER BY pi.is_cover DESC, pi.sort_order ASC
      LIMIT 1
    ) img ON true
    WHERE si.status = 'active'
      AND NOT p.is_hidden
      AND p.item_type = 'product'
      AND (p_category_id IS NULL OR cat.id = p_category_id)
      AND (p_product_ids IS NULL OR cardinality(p_product_ids) = 0 OR si.product_id = ANY (p_product_ids))
      AND (
        p_search IS NULL OR trim(p_search) = ''
        OR NOT EXISTS (
          SELECT 1 FROM unnest(regexp_split_to_array(trim(p_search), '\s+')) AS tok
          WHERE tok <> ''
            AND NOT (
              p.name ILIKE '%' || tok || '%'
              OR p.code ILIKE '%' || tok || '%'
              OR br.name ILIKE '%' || tok || '%'
              OR cat.name ILIKE '%' || tok || '%'
              OR dm.name ILIKE '%' || tok || '%'
              OR pv.name ILIKE '%' || tok || '%'
              OR pv.sku ILIKE '%' || tok || '%'
              OR pv.barcode ILIKE '%' || tok || '%'
            )
        )
      )
      AND (p_brand_ids IS NULL OR cardinality(p_brand_ids) = 0 OR br.brand_id = ANY (p_brand_ids))
      AND (p_model_ids IS NULL OR cardinality(p_model_ids) = 0 OR si.model_id = ANY (p_model_ids))
  ),
  picked AS (
    SELECT DISTINCT ON (
      CASE WHEN COALESCE(p_distinct_products, false) THEN product_id ELSE item_id END
    ) product_id
    FROM base
    ORDER BY
      (CASE WHEN COALESCE(p_distinct_products, false) THEN product_id ELSE item_id END),
      img_missing ASC
  )
  SELECT count(*) FROM picked;
$$;

REVOKE ALL ON FUNCTION public.get_public_products_count(uuid, uuid[], boolean, text, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_products_count(uuid, uuid[], boolean, text, uuid[], uuid[]) TO anon, authenticated;
