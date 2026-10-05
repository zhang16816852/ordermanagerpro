-- 供應商商品對照（supplier_product_mappings）改為「一料號可對多商品」＋主對照
--
-- 背景：原本有 UNIQUE (supplier_id, vendor_product_id)，代表同一供應商的同一廠商料號
--       只能對應到一個內部商品／變體。實務上常見「同料號對應多個品項」（包材分規格、
--       同系列不同內部商品、舊料號沿用），故放寬為多對多，並以「主對照」決定預設解析結果。
--
-- 本 migration：
--   1) 新增 is_primary（同料號至多一筆主對照，partial unique index 守住）
--   2) 移除 UNIQUE (supplier_id, vendor_product_id)
--   3) 新增 (supplier_id, vendor_product_id, internal_product_id, internal_variant_id NULLS NOT DISTINCT)
--      唯一索引 → 仍禁止「完全相同的對照重複建立」，但允許同料號對多商品
--   4) 反查索引：(internal_product_id)、(internal_variant_id)
--   5) 正規化 trigger：廠商料號／名稱 btrim、空白字串轉 NULL、擋空料號、UPDATE 自動 updated_at
--   6) 重發 public._po_resolve_item：ORDER BY is_primary DESC, updated_at DESC, id
--      （簽名不變）並額外回報 mapping_id / is_primary / candidate_count / ambiguous 供前端提示
--
-- ⚠️ 前端 upsert 的 onConflict 必須同步改為
--    'supplier_id, vendor_product_id, internal_product_id, internal_variant_id'，
--    否則 PostgREST 找不到推論用的唯一索引會直接失敗。

-- ── 1) 新增 is_primary ────────────────────────────────────────────────
ALTER TABLE public.supplier_product_mappings
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- 既有資料每個 (supplier_id, vendor_product_id) 僅一筆 → 全部視為主對照
-- （必須在建 partial unique index 之前執行，否則同料號多筆會衝突）
UPDATE public.supplier_product_mappings m
   SET is_primary = true
 WHERE m.is_primary = false
   AND NOT EXISTS (
         SELECT 1
           FROM public.supplier_product_mappings other
          WHERE other.supplier_id = m.supplier_id
            AND other.vendor_product_id = m.vendor_product_id
            AND other.is_primary
       );

-- ── 2) 放寬一料號只能對一商品的限制 ────────────────────────────────────
ALTER TABLE public.supplier_product_mappings
  DROP CONSTRAINT IF EXISTS supplier_product_mappings_supplier_id_vendor_product_id_key;

-- 同料號至多一筆主對照
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_mappings_primary
  ON public.supplier_product_mappings (supplier_id, vendor_product_id)
  WHERE is_primary;

-- 完全相同的對照不得重複（NULLS NOT DISTINCT：internal_variant_id NULL（產品層）也視為同一個 key）
-- ⚠️ 本專案遠端僅支援「index-level」NULLS NOT DISTINCT（欄位層寫法 `c NULLS NOT DISTINCT` 會 42601）
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_mappings_unique_target
  ON public.supplier_product_mappings (
    supplier_id, vendor_product_id, internal_product_id, internal_variant_id
  ) NULLS NOT DISTINCT;

-- ── 3) 反查索引（由內部商品/變體找出廠商對照）────────────────────────
CREATE INDEX IF NOT EXISTS idx_supplier_mappings_internal_product
  ON public.supplier_product_mappings (internal_product_id);

CREATE INDEX IF NOT EXISTS idx_supplier_mappings_internal_variant
  ON public.supplier_product_mappings (internal_variant_id)
  WHERE internal_variant_id IS NOT NULL;

-- ── 4) 正規化 trigger ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._spm_normalize_row()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.vendor_product_id := NULLIF(btrim(COALESCE(NEW.vendor_product_id, '')), '');
  IF NEW.vendor_product_id IS NULL THEN
    RAISE EXCEPTION '廠商料號不可為空白';
  END IF;

  IF NEW.vendor_product_name IS NOT NULL THEN
    NEW.vendor_product_name := NULLIF(btrim(NEW.vendor_product_name), '');
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := COALESCE(NEW.updated_at, now());
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_supplier_product_mappings_normalize ON public.supplier_product_mappings;
CREATE TRIGGER trg_supplier_product_mappings_normalize
  BEFORE INSERT OR UPDATE ON public.supplier_product_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public._spm_normalize_row();

-- ── 5) _po_resolve_item：主對照優先＋回報歧義 ───────────────────────────
CREATE OR REPLACE FUNCTION public._po_resolve_item(
  p_supplier_id uuid DEFAULT NULL::uuid,
  p_sku text DEFAULT NULL::text,
  p_item_name text DEFAULT NULL::text,
  p_vendor_product_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_vendor_id text := NULLIF(btrim(COALESCE(p_vendor_product_id, '')), '');
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
  -- (1) 供應商商品 mapping（廠商料號 → 內部商品／變體 + 廠商單價）
  --     同一料號可能有多筆對照：主對照優先，其次最近更新者。
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
        -- 無主對照且同料號有多筆 → 匯入結果可能不是使用者預期，前端需提示人工確認
        'ambiguous', (v_candidates > 1 AND v_primary_count = 0)
      );
    END IF;
  END IF;

  -- (2)(3) 內部 SKU → 品名（沿用既有 import_resolve_item 行為）
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