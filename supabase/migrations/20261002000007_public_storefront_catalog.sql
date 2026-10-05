-- =============================================================================
-- 公開店面型錄（storefront catalog）唯讀 RPC
-- -----------------------------------------------------------------------------
-- 目的：讓匿名訪客在公開首頁讀到分類與商品，且「只拿得到零售價」。
--
-- 為什麼需要 SECURITY DEFINER：
--   products / product_variants 雖有 anon 的 table grant，但有效 RLS policy 只允許
--   authenticated，匿名讀不到 → 取不到 MSRP。與其放寬 products 的 policy（會連帶
--   暴露 unified_wholesale_price），改由這兩支 definer 函式在「回傳欄位白名單」
--   的前提下取值。
--
-- ⚠️ 安全紅線：本檔所有 SELECT 一律不得帶出
--    products.unified_wholesale_price / product_variants.wholesale_price。
--    若日後要加成本相關欄位，請先確認該欄位確實適合公開。
--
-- ⚠️ 這兩支一律 DROP 後重建，而非 CREATE OR REPLACE：
--    回傳欄位有變動時 CREATE OR REPLACE 會直接報 cannot change return type of
--    existing function。DROP 也順帶清掉多載，避免 PostgREST PGRST203
--    「無法選出唯一函數」。
--
-- ⚠️ 關於分類鍵值：categories.slug 目前「全站 37 筆皆為 NULL」且前端沒有任何
--    讀取（既有欄位從未被填入，非本次造成）。因此公開 API 一律以 categories.id
--    為鍵；slug 仍原樣回傳（nullable），待日後真的補上 slug 後，前端網址可以
--    無需改動 RPC 就自動改用可讀網址。
--
-- ⚠️ 關於名稱欄位（實測資料後的決定，勿隨意改回）：
--    storefront_items 是「產品 × 機型」矩陣（3159 列 = 376 產品 × 338 機型），
--    三個名稱欄長度差異極大：
--      products.name          avg 22 / max 56   ← 適合作為卡片標題
--      product_variants.name  avg 37 / max 93   ← 常與產品名重複，僅作補充
--      storefront_items.display_name avg 50 / max 105 ← ERP 用整串規格描述，
--                                                     **不可**當公開標題
--    因此本函式刻意「不」回傳 display_name，避免前端誤用成卡片標題。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) 先清掉既有版本（含本檔初版的 slug 版多載）
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_products(text, uuid[], int, int);
DROP FUNCTION IF EXISTS public.get_public_products(uuid, uuid[], int, int);
DROP FUNCTION IF EXISTS public.get_public_categories();

-- -----------------------------------------------------------------------------
-- 1) get_public_categories：首頁「分類導覽」區塊
--    區塊未指定分類時，前端用這個結果依商品數自動取前 N 個。
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_categories()
RETURNS TABLE (
  id            uuid,
  slug          text,
  name          text,
  product_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    c.slug,
    c.name,
    count(DISTINCT si.product_id) AS product_count
  FROM public.categories c
  JOIN public.product_category_links pcl
    ON pcl.category_id = c.id
  JOIN public.storefront_items si
    ON si.product_id = pcl.product_id
   -- pcl 可能掛在變體層級（variant_id NOT NULL），此時只認同一個變體的項目
   AND (pcl.variant_id IS NULL OR pcl.variant_id = si.variant_id)
  JOIN public.products p
    ON p.id = si.product_id
  WHERE si.status = 'active'
    AND NOT p.is_hidden
    AND p.item_type = 'product'
    AND NOT c.is_hidden
  GROUP BY c.id, c.slug, c.name
  ORDER BY count(DISTINCT si.product_id) DESC, c.name ASC;
$$;

COMMENT ON FUNCTION public.get_public_categories() IS
  '公開型錄用：分類清單與在售商品數。鍵值為 categories.id。';

-- -----------------------------------------------------------------------------
-- 2) get_public_products：首頁「精選商品」區塊
--    - p_category_id 有值 → 依分類過濾
--    - p_product_ids 有值 → 手動挑選（區塊 source.kind='handpicked'）
--    - 零售價優先變體價，缺或為 0 時回退產品統一價；兩者皆無回 NULL
--      （前端遇到 NULL 會整行隱藏，不顯示 $0）
--    - 排序「有圖優先」：目前全站只有 1 個產品有圖片，圖片就是唯一可用的策展訊號；
--      補圖後此條件自然退化為依名稱排序。
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_products(
  p_category_id uuid   DEFAULT NULL,
  p_product_ids uuid[] DEFAULT NULL,
  p_limit       int    DEFAULT 12,
  p_offset      int    DEFAULT 0
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
  SELECT
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
    img.url                                      AS image_url
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
      -- 變體層級的歸屬優先（更精確），再依分類排序與名稱穩定排序
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
  ORDER BY
    (img.url IS NULL) ASC,   -- 有圖優先
    p.name ASC,
    dm.name ASC NULLS LAST,
    si.id ASC
  LIMIT GREATEST(COALESCE(p_limit, 12), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.get_public_products(uuid, uuid[], int, int) IS
  '公開型錄用：商品清單（僅零售價；不外洩任何成本欄位）。分類鍵值為 categories.id。'
  '標題請用 product_name，適用機型用 model_name；不要用 storefront_items.display_name。';

-- -----------------------------------------------------------------------------
-- 授權：這兩支是公開唯讀，刻意開放給 anon；寫入權限完全不涉及。
-- REVOKE 必須明列 authenticated —— 舊的 explicit grant 會蓋過 PUBLIC 預設權限，
-- 只寫 PUBLIC 無法收掉既有的 authenticated 權限（見 AGENTS.md 權限落差教訓）。
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_public_categories() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_categories() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_products(uuid, uuid[], int, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_products(uuid, uuid[], int, int) TO anon, authenticated;