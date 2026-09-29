-- 維修零件目錄：舊商品自動轉換（backfill）
--
-- 輸入：products(item_type='repair_part') 的 14 個商品 / 44 個變體（其中 1 個商品無變體）
-- 輸出：37 列 repair_parts（依「型號 × 零件種類」合併）+ 45 列 repair_part_variants
--        並回填既有 19 筆 repair_order_items.repair_part_id
--
-- 設計要點：
--   1. 舊商品本身「不動」——它們仍是有庫存、能進貨/扣料/算成本的實體，零風險。
--   2. 型號比對範圍＝變體名優先（含 ' - ' 時取最後一段），避免「一個商品包多個機型」
--      的情形（紅米 NOTE 11 PRO 系列、小米 POCO 系列）誤配到最長的機型名。
--   3. 無法定位單一機型者（小米 5 機型共用一顆電池、IPHONE 背殼）落為 device_model_id = NULL
--      的通用零件，而非硬塞一個錯的機型。
--   4. 整支可重複執行（全部以 NOT EXISTS 守護，重跑為 no-op）。

-- ============================================================================
-- 1. 常用標籤字典種子
-- ============================================================================
INSERT INTO public.repair_part_tags (name, sort_order)
SELECT t.name, t.sort_order
FROM (VALUES
  ('原廠',       10),
  ('副廠',       20),
  ('BSMI認證',  30),
  ('OLED',      40),
  ('一般',       50)
) AS t(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.repair_part_tags e WHERE e.name = t.name
);

-- ============================================================================
-- 2. 分類：把每個舊變體解析成 (device_model_id, part_name, tags, 顏色)
--    以 TEMP TABLE 保存，後續步驟共用。
-- ============================================================================
CREATE TEMP TABLE tmp_rp_classified ON COMMIT DROP AS
WITH vm AS (
  SELECT p.id  AS product_id,
         p.name AS product_name,
         pv.id  AS variant_id,
         pv.name AS variant_name,
         COALESCE(pv.wholesale_price, 0) AS wholesale_price
  FROM products p
  LEFT JOIN product_variants pv ON pv.product_id = p.id
  WHERE p.item_type = 'repair_part'
),
base AS (
  SELECT vm.*,
         COALESCE(variant_name, product_name) AS label,
         product_name || ' ' || COALESCE(variant_name, '') AS fulltext
  FROM vm
),
-- 比對範圍：變體名優先。有 ' - ' 分隔時取最後一段，否則用整串
scoped AS (
  SELECT b.*,
         CASE WHEN position(' - ' IN b.label) > 0
              THEN btrim(split_part(b.label, ' - ',
                                    array_length(string_to_array(b.label, ' - '), 1)))
              ELSE b.label
         END AS scope
  FROM base b
),
nrm AS (
  SELECT s.*,
         replace(replace(replace(replace(replace(replace(replace(replace(
         replace(replace(upper(s.scope), 'IPHONE', 'IP'),
         ' ', ''), '-', ''), '_', ''), '(', ''), ')', ''),
         '/', ''), '.', ''), '（', ''), '）', '') AS snorm
  FROM scoped s
),
dm AS (
  SELECT id, name,
         replace(replace(replace(replace(replace(replace(replace(replace(
         replace(replace(upper(name), 'IPHONE', 'IP'),
         ' ', ''), '-', ''), '_', ''), '(', ''), ')', ''),
         '/', ''), '.', ''), '（', ''), '）', '') AS m
  FROM device_models
),
matched AS (
  SELECT n.*,
         d.id AS device_model_id,
         -- 零件種類：比對「商品名 + 變體名」全文，由專屬到泛用
         CASE
           WHEN n.fulltext LIKE '%背蓋防水膠%' THEN '背蓋防水膠'
           WHEN n.fulltext LIKE '%螢幕防水膠%' THEN '螢幕防水膠'
           WHEN n.fulltext LIKE '%換蓋板%'   THEN '換蓋板'
           WHEN n.fulltext LIKE '%手機背蓋%' THEN '手機背蓋'
           WHEN n.fulltext LIKE '%背殼%'     THEN '背殼'
           WHEN n.fulltext LIKE '%電池%'     THEN '電池'
           WHEN n.fulltext LIKE '%總成%'     THEN '總成'
           ELSE '零件'
         END AS part_name
  FROM nrm n
  LEFT JOIN LATERAL (
    SELECT id FROM dm
    WHERE n.snorm LIKE '%' || dm.m || '%'
    ORDER BY length(dm.m) DESC, dm.name
    LIMIT 1
  ) d ON TRUE
),
tagged AS (
  SELECT m.*,
         -- 顏色 → 供「一零件對多变體」時的 spec_label（單一連結時不使用）
         COALESCE(
           CASE WHEN m.fulltext LIKE '%白色%' THEN '白色' END,
           CASE WHEN m.fulltext LIKE '%黑色%' THEN '黑色' END,
           CASE WHEN m.fulltext LIKE '%金色%' THEN '金色' END,
           CASE WHEN m.fulltext LIKE '%銀色%' THEN '銀色' END,
           CASE WHEN m.fulltext LIKE '%紅色%' THEN '紅色' END,
           CASE WHEN m.fulltext LIKE '%紫色%' THEN '紫色' END,
           CASE WHEN m.fulltext LIKE '%綠色%' THEN '綠色' END,
           CASE WHEN m.fulltext LIKE '%藍色%' THEN '藍色' END
         ) AS color,
         -- 跨變體共通的型錄屬性
         (ARRAY_REMOVE(ARRAY[
           CASE WHEN m.fulltext LIKE '%原廠%'      THEN '原廠'      END,
           CASE WHEN m.fulltext LIKE '%副廠%'      THEN '副廠'      END,
           CASE WHEN m.fulltext LIKE '%BSMI%'      THEN 'BSMI認證'  END,
           CASE WHEN m.fulltext LIKE '%OLED%'      THEN 'OLED'      END,
           CASE WHEN m.fulltext LIKE '%一般%'      THEN '一般'      END
         ], NULL)) AS tags
  FROM matched m
)
SELECT
  t.device_model_id,
  t.part_name,
  t.product_id,
  t.variant_id,
  t.product_name,
  t.variant_name,
  t.color,
  t.tags,
  t.wholesale_price
FROM tagged t;

-- ============================================================================
-- 3. 建立 repair_parts（每個「型號 × 種類」一列）
--    注意：同一零件可能有多個變體連結，標籤取聯集；因 GROUP BY 查詢的
--    SELECT list 不允許引用未分組欄位，故以 CTE 預先彙總（tag_agg）。
-- ============================================================================
WITH tag_agg AS (
  SELECT c.part_name,
         c.device_model_id,
         COALESCE(
           array_agg(DISTINCT u.tg ORDER BY u.tg) FILTER (WHERE u.tg IS NOT NULL),
           '{}'
         ) AS tags,
         COALESCE(MIN(c.wholesale_price), 0) AS cost
  FROM tmp_rp_classified c
  LEFT JOIN LATERAL (SELECT unnest(c.tags) AS tg) u ON TRUE
  GROUP BY c.part_name, c.device_model_id
)
INSERT INTO public.repair_parts
  (device_model_id, name, tags, is_active, sort_order, default_unit_cost)
SELECT
  t.device_model_id,
  t.part_name,
  t.tags,
  true,
  ROW_NUMBER() OVER (ORDER BY t.part_name, COALESCE(t.device_model_id::text, '~'))::int,
  t.cost
FROM tag_agg t
WHERE NOT EXISTS (
  SELECT 1 FROM public.repair_parts p
  WHERE p.name = t.part_name
    AND p.device_model_id IS NOT DISTINCT FROM t.device_model_id
);

-- ============================================================================
-- 4. 建立 repair_part_variants（零件 ↔ 庫存實體連結）
--    組內以顏色／名稱穩定排序；第一筆為 is_default。
--    連結數 > 1 才需要 spec_label（顏色區分），單一連結時留空。
-- ============================================================================
WITH cnt AS (
  SELECT part_name, device_model_id, COUNT(*) AS n
  FROM tmp_rp_classified
  GROUP BY part_name, device_model_id
),
ranked AS (
  SELECT c.product_id,
         c.variant_id,
         c.color,
         c.part_name,
         c.device_model_id,
         cnt.n,
         ROW_NUMBER() OVER (
           PARTITION BY c.part_name, c.device_model_id
           ORDER BY COALESCE(c.color, ''), COALESCE(c.variant_name, c.product_name), c.variant_id::text
         ) AS rn
  FROM tmp_rp_classified c
  JOIN cnt ON cnt.part_name = c.part_name
          AND cnt.device_model_id IS NOT DISTINCT FROM c.device_model_id
)
INSERT INTO public.repair_part_variants
  (repair_part_id, product_id, variant_id, spec_label, is_default, sort_order)
SELECT
  p.id,
  r.product_id,
  r.variant_id,
  CASE WHEN r.n > 1 THEN r.color ELSE NULL END,
  r.rn = 1,
  r.rn
FROM ranked r
JOIN public.repair_parts p
  ON p.name = r.part_name
 AND p.device_model_id IS NOT DISTINCT FROM r.device_model_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.repair_part_variants v
  WHERE v.repair_part_id = p.id
    AND v.product_id = r.product_id
    AND v.variant_id IS NOT DISTINCT FROM r.variant_id
);

-- ============================================================================
-- 5. 回填既有 repair_order_items.repair_part_id
--    以「原始 product_id + variant_id」精確對應到零件連結，僅補 NULL 者。
--    不動任何金額、數量、庫存欄位。
-- ============================================================================
UPDATE public.repair_order_items i
   SET repair_part_id = v.repair_part_id
  FROM public.repair_part_variants v
 WHERE i.repair_part_id IS NULL
   AND v.product_id IS NOT DISTINCT FROM i.product_id
   AND v.variant_id IS NOT DISTINCT FROM i.variant_id;

-- ============================================================================
-- 6. 驗證
-- ============================================================================
DO $$
DECLARE
  v_parts  int;
  v_links  int;
  v_def    int;
  v_orphan int;
  v_nolink int;
  v_items  int;
  v_multi  int;
BEGIN
  SELECT COUNT(*) INTO v_parts FROM public.repair_parts;
  SELECT COUNT(*) INTO v_links FROM public.repair_part_variants;
  -- 每個零件恰有一個預設連結（應 = v_parts）
  SELECT COUNT(*) INTO v_def FROM (
    SELECT repair_part_id FROM public.repair_part_variants
     WHERE is_default GROUP BY repair_part_id HAVING COUNT(*) = 1) x;
  -- 指向不存在零件的孤兒連結（應為 0）
  SELECT COUNT(*) INTO v_orphan
    FROM public.repair_part_variants v
   WHERE NOT EXISTS (SELECT 1 FROM public.repair_parts p WHERE p.id = v.repair_part_id);
  -- 有商品連結、卻沒被任何 repair_parts 綁定的舊零件商品（應為 0）
  SELECT COUNT(DISTINCT p.id) INTO v_nolink
    FROM products p
   WHERE p.item_type = 'repair_part'
     AND NOT EXISTS (SELECT 1 FROM public.repair_part_variants v WHERE v.product_id = p.id);
  -- 已回填 repair_part_id 的維修單品項數
  SELECT COUNT(*) INTO v_items
    FROM public.repair_order_items
   WHERE repair_part_id IS NOT NULL;
  -- 一零件對多變體（需要規格選擇器）的組數
  SELECT COUNT(*) INTO v_multi
    FROM (SELECT repair_part_id FROM public.repair_part_variants
          GROUP BY repair_part_id HAVING COUNT(*) > 1) x;

  RAISE NOTICE 'repair_parts=% links=% 預設連結零件數=% 孤兒連結=% 未綁定型錄的舊零件商品=% 已回填維修品項=% 多變體零件組=%',
    v_parts, v_links, v_def, v_orphan, v_nolink, v_items, v_multi;
END $$;
