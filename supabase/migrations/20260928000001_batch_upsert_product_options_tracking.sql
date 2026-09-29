-- ============================================================
-- 20260928000001_batch_upsert_product_options_tracking.sql
-- batch_upsert_product_options 支援寫入 product_variants.tracking_mode
-- （none/serial/batch，20260924000002 schema 新增；前端 VariantBatchCreator
--   已加入「預設追蹤模式」）。p_variants 元素可選帶 tracking_mode；
-- 缺省時 INSERT 用資料表預設 'none'，既有 SKU UPDATE 保留原值不覆寫。
-- 簽名不變，types.ts 無需重產生。
-- ============================================================

CREATE OR REPLACE FUNCTION public.batch_upsert_product_options(
  p_product_id UUID,
  p_groups JSONB,
  p_variants JSONB,
  p_variant_options JSONB,
  p_model_relations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_row RECORD;
  v_value_row RECORD;
  v_var_row RECORD;
  v_opt_row RECORD;
  v_rel_row RECORD;
  v_group_ids JSONB := '{}'::jsonb;    -- client ref -> real group id
  v_value_ids JSONB := '{}'::jsonb;    -- client ref -> real value id
  v_sku_to_id JSONB := '{}'::jsonb;    -- sku -> real variant id
  v_group_id UUID;
  v_value_id UUID;
  v_variant_id UUID;
  v_relations JSONB := '[]'::jsonb;
  v_group_order INT;
  v_value_order INT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可批次更新產品選項');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '產品不存在');
  END IF;

  -- 1. 刪除舊資料（依 FK CASCADE 自動清掉 values / variant_options）
  DELETE FROM public.product_option_groups WHERE product_id = p_product_id;

  -- 2. 插入新群組 + 值，並記錄 client ref -> real id
  v_group_order := 0;
  FOR v_group_row IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_groups, '[]'::jsonb))
  LOOP
    IF (v_group_row.value->>'name') IS NULL OR trim(v_group_row.value->>'name') = '' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.product_option_groups (product_id, name, sort_order)
    VALUES (p_product_id, trim(v_group_row.value->>'name'), v_group_order)
    RETURNING id INTO v_group_id;

    v_group_ids := jsonb_set(v_group_ids, ARRAY[v_group_row.value->>'ref'], to_jsonb(v_group_id));
    v_group_order := v_group_order + 1;

    v_value_order := 0;
    FOR v_value_row IN
      SELECT * FROM jsonb_array_elements(COALESCE(v_group_row.value->'values', '[]'::jsonb))
    LOOP
      IF (v_value_row.value->>'label') IS NULL OR trim(v_value_row.value->>'label') = '' THEN
        CONTINUE;
      END IF;

      INSERT INTO public.product_option_values (group_id, label, value, hex_code, sort_order)
      VALUES (
        v_group_id,
        trim(v_value_row.value->>'label'),
        CASE WHEN (v_value_row.value->>'value') IS NULL OR trim(v_value_row.value->>'value') = ''
             THEN trim(v_value_row.value->>'label')
             ELSE trim(v_value_row.value->>'value') END,
        NULLIF(v_value_row.value->>'hex_code', ''),
        v_value_order
      )
      RETURNING id INTO v_value_id;

      v_value_ids := jsonb_set(v_value_ids, ARRAY[v_value_row.value->>'ref'], to_jsonb(v_value_id));
      v_value_order := v_value_order + 1;
    END LOOP;
  END LOOP;

  -- 3. upsert 變體（依 SKU 去重、onConflict sku）
  FOR v_var_row IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_variants, '[]'::jsonb))
  LOOP
    IF (v_var_row.value->>'sku') IS NULL OR trim(v_var_row.value->>'sku') = '' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.product_variants (
      product_id, sku, name, barcode, wholesale_price, retail_price, sort_order, status, tracking_mode
    )
    VALUES (
      p_product_id,
      trim(v_var_row.value->>'sku'),
      v_var_row.value->>'name',
      NULLIF(v_var_row.value->>'barcode', ''),
      NULLIF(v_var_row.value->>'wholesale_price', '')::numeric,
      NULLIF(v_var_row.value->>'retail_price', '')::numeric,
      COALESCE(NULLIF(v_var_row.value->>'sort_order', '')::int, 0),
      'active',
      COALESCE(NULLIF(v_var_row.value->>'tracking_mode', ''), 'none')
    )
    ON CONFLICT (sku) DO UPDATE SET
      name = EXCLUDED.name,
      barcode = EXCLUDED.barcode,
      wholesale_price = EXCLUDED.wholesale_price,
      retail_price = EXCLUDED.retail_price,
      sort_order = EXCLUDED.sort_order,
      status = 'active',
      tracking_mode = CASE
        WHEN (v_var_row.value->>'tracking_mode') IS NULL OR trim(v_var_row.value->>'tracking_mode') = ''
        THEN product_variants.tracking_mode
        ELSE EXCLUDED.tracking_mode
      END,
      updated_at = now();
  END LOOP;

  -- 重新讀取 upsert 後 sku -> id 對照
  SELECT jsonb_object_agg(sku, id)
  INTO v_sku_to_id
  FROM public.product_variants
  WHERE product_id = p_product_id;

  -- 4. 插入變體-選項連結
  FOR v_opt_row IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_variant_options, '[]'::jsonb))
  LOOP
    CONTINUE WHEN (v_opt_row.value->>'sku') IS NULL
             OR (v_opt_row.value->>'group_ref') IS NULL
             OR (v_opt_row.value->>'value_ref') IS NULL;
    v_variant_id := (v_sku_to_id->>v_opt_row.value->>'sku')::uuid;
    v_group_id   := (v_group_ids->>v_opt_row.value->>'group_ref')::uuid;
    v_value_id   := (v_value_ids->>v_opt_row.value->>'value_ref')::uuid;
    CONTINUE WHEN v_variant_id IS NULL OR v_group_id IS NULL OR v_value_id IS NULL;

    INSERT INTO public.product_variant_options (variant_id, option_group_id, option_value_id)
    VALUES (v_variant_id, v_group_id, v_value_id);
  END LOOP;

  -- 5. 重建 entity_model_relations：先刪該產品所有變體之 include 關聯，再依 payload 插入
  DELETE FROM public.entity_model_relations
  WHERE variant_id IN (SELECT id FROM public.product_variants WHERE product_id = p_product_id)
    AND relation_type = 'include';

  v_relations := '[]'::jsonb;
  FOR v_rel_row IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_model_relations, '[]'::jsonb))
  LOOP
    CONTINUE WHEN (v_rel_row.value->>'sku') IS NULL
             OR ((v_rel_row.value->>'model_id') IS NULL AND (v_rel_row.value->>'group_id') IS NULL);
    v_variant_id := (v_sku_to_id->>v_rel_row.value->>'sku')::uuid;
    CONTINUE WHEN v_variant_id IS NULL;
    v_relations := v_relations
      || jsonb_build_object(
           'variant_id', v_variant_id,
           'model_id',   NULLIF(v_rel_row.value->>'model_id', ''),
           'group_id',   NULLIF(v_rel_row.value->>'group_id', ''),
           'relation_type', 'include',
           'sort_order', COALESCE(NULLIF(v_rel_row.value->>'sort_order', '')::int, 0)
         );
  END LOOP;

  IF jsonb_array_length(v_relations) > 0 THEN
    INSERT INTO public.entity_model_relations (variant_id, model_id, group_id, relation_type, sort_order)
    SELECT
      (r->>'variant_id')::uuid,
      NULLIF(r->>'model_id', '')::uuid,
      NULLIF(r->>'group_id', '')::uuid,
      'include',
      COALESCE((r->>'sort_order')::int, 0)
    FROM jsonb_array_elements(v_relations) r;
  END IF;

  -- 6. 同步 storefront（此為 SECURITY DEFINER，內部再 call 同 schema RPC 安全）
  PERFORM public.sync_storefront_items(p_product_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.batch_upsert_product_options(UUID, JSONB, JSONB, JSONB, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.batch_upsert_product_options(UUID, JSONB, JSONB, JSONB, JSONB) TO authenticated;