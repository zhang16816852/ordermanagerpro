-- ============================================================
-- 20260912000000_upsert_variant_options.sql
-- 新增 RPC upsert_variant_options(p_variant_id, p_items) ——
-- 將 VariantEditDialog 原本「先刪後建、逐筆 HTTP」的
-- manageVariantOptions 流程，改為單一資料庫 transaction 內完成：
--   1. 依 (label OR value) 對齊每個傳入群組的既有選項值
--   2. 顏色群組依 product_colors 補 hex_code（新值 INSERT 即帶）
--   3. DELETE 該 variant 全部 product_variant_options → 重新 INSERT
--   4. orphan 清理：刪除該產品所有群組中、無任何變體使用的
--      product_option_values
-- 任一環節失敗 → 自動 ROLLBACK，舊資料不受影響。
--
-- p_items 為 JSONB 陣列：[{ group_id, label }]
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_variant_options(
  p_variant_id UUID,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_product_id UUID;
  v_value_id UUID;
  v_existing_id UUID;
  v_existing_hex TEXT;
  v_hex TEXT;
  v_is_color BOOLEAN;
  v_sort INT;
  v_links JSONB := '[]'::jsonb;
  v_link RECORD;
  v_group_name TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可更新變體選項');
  END IF;

  SELECT product_id INTO v_product_id
  FROM public.product_variants
  WHERE id = p_variant_id;

  IF v_product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '變體不存在');
  END IF;

  -- 1-2. 對齊/建立選項值
  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    CONTINUE WHEN (v_item.value->>'group_id') IS NULL
             OR (v_item.value->>'label') IS NULL
             OR trim(v_item.value->>'label') = '';

    SELECT name INTO v_group_name
    FROM public.product_option_groups
    WHERE id = (v_item.value->>'group_id')::uuid
      AND product_id = v_product_id;

    CONTINUE WHEN v_group_name IS NULL;

    v_is_color := v_group_name ~* '(顏色|色|color)';
    v_hex := NULL;
    IF v_is_color THEN
      SELECT pc.hex_code INTO v_hex
      FROM public.product_colors pc
      WHERE lower(trim(pc.name)) = lower(trim(v_item.value->>'label'))
         OR upper(coalesce(pc.code, '')) = upper(trim(v_item.value->>'label'))
      LIMIT 1;
    END IF;

    SELECT id, hex_code INTO v_existing_id, v_existing_hex
    FROM public.product_option_values
    WHERE group_id = (v_item.value->>'group_id')::uuid
      AND (label = trim(v_item.value->>'label')
           OR value = trim(v_item.value->>'label'))
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      IF v_hex IS NOT NULL AND v_existing_hex IS NULL THEN
        UPDATE public.product_option_values
        SET hex_code = v_hex
        WHERE id = v_existing_id;
      END IF;
      v_value_id := v_existing_id;
    ELSE
      SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort
      FROM public.product_option_values
      WHERE group_id = (v_item.value->>'group_id')::uuid;

      INSERT INTO public.product_option_values (group_id, label, value, hex_code, sort_order)
      VALUES (
        (v_item.value->>'group_id')::uuid,
        trim(v_item.value->>'label'),
        trim(v_item.value->>'label'),
        v_hex,
        v_sort
      )
      RETURNING id INTO v_value_id;
    END IF;

    v_links := v_links
      || jsonb_build_object(
           'variant_id', p_variant_id,
           'option_group_id', (v_item.value->>'group_id')::uuid,
           'option_value_id', v_value_id
         );
  END LOOP;

  -- 3. 重建變體-選項連結
  DELETE FROM public.product_variant_options WHERE variant_id = p_variant_id;

  IF jsonb_array_length(v_links) > 0 THEN
    INSERT INTO public.product_variant_options (variant_id, option_group_id, option_value_id)
    SELECT
      (l->>'variant_id')::uuid,
      (l->>'option_group_id')::uuid,
      (l->>'option_value_id')::uuid
    FROM jsonb_array_elements(v_links) l;
  END IF;

  -- 4. orphan 清理：該產品所有群組的值中，無任何變體使用的刪除
  DELETE FROM public.product_option_values pv
  WHERE pv.group_id IN (SELECT id FROM public.product_option_groups WHERE product_id = v_product_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_variant_options l
      WHERE l.option_value_id = pv.id
    );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_variant_options(UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.upsert_variant_options(UUID, JSONB) TO authenticated;