-- =============================================================================
-- 公開資料層 Phase A-1：分類樹 + 品牌/系列
-- -----------------------------------------------------------------------------
-- 目的：讓公開 /shop 能顯示子分類與品牌/系列篩選，比照後台 CatalogSidebar。
-- 安全：SECURITY DEFINER、欄位白名單、不含成本；anon/authenticated 可執行。
-- =============================================================================
-- 1) get_public_category_tree：扁平回傳（含 parent_id），前端組樹
DROP FUNCTION IF EXISTS public.get_public_category_tree();
CREATE OR REPLACE FUNCTION public.get_public_category_tree()
RETURNS TABLE (
  id            uuid,
  parent_id     uuid,
  name          text,
  slug          text,
  sort_order    int,
  product_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    ch.parent_id,
    c.name,
    c.slug,
    c.sort_order,
    COUNT(DISTINCT si.product_id) AS product_count
  FROM public.categories c
  LEFT JOIN public.category_hierarchy ch ON ch.child_id = c.id
  LEFT JOIN public.product_category_links pcl ON pcl.category_id = c.id
  LEFT JOIN public.storefront_items si
    ON si.product_id = pcl.product_id
   AND si.status = 'active'
   AND (pcl.variant_id IS NULL OR pcl.variant_id = si.variant_id)
  LEFT JOIN public.products p ON p.id = si.product_id
  WHERE NOT c.is_hidden
    AND (si.product_id IS NULL OR (NOT p.is_hidden AND p.item_type = 'product'))
  GROUP BY c.id, ch.parent_id, c.name, c.slug, c.sort_order
  ORDER BY c.sort_order ASC NULLS LAST, c.name ASC;
$$;

-- 2) get_public_brands：品牌清單 + 商品數
DROP FUNCTION IF EXISTS public.get_public_brands();
CREATE OR REPLACE FUNCTION public.get_public_brands()
RETURNS TABLE (
  id            uuid,
  name          text,
  product_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    b.id,
    b.name,
    COUNT(DISTINCT si.product_id) AS product_count
  FROM public.brands b
  JOIN public.product_brands pb ON pb.brand_id = b.id
  JOIN public.storefront_items si ON si.product_id = pb.product_id
  JOIN public.products p ON p.id = si.product_id
  WHERE si.status = 'active'
    AND NOT p.is_hidden
    AND p.item_type = 'product'
  GROUP BY b.id, b.name
  ORDER BY b.name ASC;
$$;

-- 3) get_public_brand_series：品牌 × 系列 + 商品數
DROP FUNCTION IF EXISTS public.get_public_brand_series();
CREATE OR REPLACE FUNCTION public.get_public_brand_series()
RETURNS TABLE (
  brand_id      uuid,
  brand_name    text,
  series_id     uuid,
  series_name   text,
  product_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    b.id AS brand_id,
    b.name AS brand_name,
    bs.id AS series_id,
    bs.name AS series_name,
    COUNT(DISTINCT si.product_id) AS product_count
  FROM public.brands b
  JOIN public.brand_series bs ON bs.brand_id = b.id
  JOIN public.product_series_links psl ON psl.brand_series_id = bs.id
  JOIN public.storefront_items si ON si.product_id = psl.product_id
  JOIN public.products p ON p.id = si.product_id
  WHERE si.status = 'active'
    AND NOT p.is_hidden
    AND p.item_type = 'product'
  GROUP BY b.id, b.name, bs.id, bs.name
  ORDER BY b.name ASC, bs.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_category_tree() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_category_tree() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_brands() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_brands() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_brand_series() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_brand_series() TO anon, authenticated;