-- =============================================================================
-- get_public_products：新增「每個產品只回一列」模式
-- -----------------------------------------------------------------------------
-- 問題（實測發現）：
--   storefront_items 是「產品 × 變體 × 機型」矩陣，所以同一產品會有多列。
--   首頁精選區塊取「前 8 列」時，因排序是「有圖優先 → 產品名 → 機型 → id」，
--   字母序最前的那個產品會整包霸佔畫面：
--     手機殼       前 8 列 = 同一產品 CITYBOSS 5D 軍規殼，單價全部 200
--     玻璃保護貼   前 8 列零售價全部為 NULL
--     鏡頭保護貼   前 8 列零售價全部為 NULL
--   換句話說「取前 N 列」不等於「取 N 個不同產品」，首頁會變成一排重複卡片。
--
-- 解法：
--   新增尾參數 p_distinct_products boolean。為 true 時每個產品只保留一列
--   （保留排序最前的那個變體／機型組合）。
--     - 首頁 featuredProducts 區塊 → true（要 N 個不同產品的卡片）
--     - 未來 /shop 商品列表頁      → false（要看同產品不同變體／機型）
--
-- 實作：以 DISTINCT ON (CASE WHEN flag THEN product_id ELSE item_id END) 達成，
--   flag 為 false 時 item_id 唯一 → 等同不去重，因此只有一條分支、不必 IF。
--
-- ⚠️ 一律 DROP 後重建（不 CREATE OR REPLACE）：
--    尾端加參數會變成多載，CREATE OR REPLACE 會失敗；且舊簽名若留著，
--    PostgREST 會 PGRST203 無法選出唯一函數（AGENTS.md 明載的既有教訓）。
--
-- ⚠️ 安全紅線沿用不變：SELECT 一律不得帶出
--    products.unified_wholesale_price / product_variants.wholesale_price。
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_public_products(uuid, uuid[], int, int);

CREATE OR REPLACE FUNCTION public.get_public_products(
  p_category_id       uuid    DEFAULT NULL,
  p_product_ids       uuid[]  DEFAULT NULL,
  p_limit             int     DEFAULT 12,
  p_offset            int     DEFAULT 0,
  p_distinct_products boolean DEFAULT false
)
RETURNS TABLE (
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
  image_url     text
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
      (img.url IS NULL)                            AS img_missing
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
      SELECT b.name
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
    image_url
  FROM picked
  ORDER BY
    img_missing ASC,
    product_name ASC,
    model_name ASC NULLS LAST,
    item_id ASC
  LIMIT GREATEST(COALESCE(p_limit, 12), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.get_public_products(uuid, uuid[], int, int, boolean) IS
  '公開型錄用：商品清單（僅零售價；不外洩任何成本欄位）。分類鍵值為 categories.id。'
  '標題請用 product_name，適用機型用 model_name；不要用 storefront_items.display_name。'
  '首頁精選請傳 p_distinct_products = true，否則會取到同一產品的多個變體/機型列。';

-- 權限：沿用「明確列出 authenticated」的寫法。舊的 explicit grant 會蓋過
-- PUBLIC 預設權限，只寫 PUBLIC 收不掉既有的 authenticated 權限。
REVOKE ALL ON FUNCTION public.get_public_products(uuid, uuid[], int, int, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_products(uuid, uuid[], int, int, boolean)
  TO anon, authenticated;