-- Fix + extend upsert_product_variant_options_batch：
--  1. 修正 product_option_values FK 欄位名（group_id，非 option_group_id）——原 20260918000000 執行時會 42703 並整筆回滾
--  2. payload 支援 {name(身份 key), display(第1列顯示名), label, value(SKU 段)}
--  3. 群組改名：第1列顯示名與現有群組名不同即改名；找不到時以「值集比對」兜底（第1、4列都改時）
--  4. 選項值 SKU 段（product_option_values.value）round-trip
CREATE OR REPLACE FUNCTION public.upsert_product_variant_options_batch(
    p_product_id UUID,
    p_variants JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_var_record JSONB;
    v_opt_record JSONB;
    v_group_col RECORD;
    v_mp RECORD;
    v_db_row RECORD;
    v_variant_id UUID;
    v_col_key TEXT;
    v_col_name TEXT;
    v_col_display TEXT;
    v_label TEXT;
    v_sku_value TEXT;
    v_group_id UUID;
    v_value_id UUID;
    v_hex_code TEXT;
    v_is_color BOOLEAN;
    v_max_sort INT;
    v_groups JSONB := '{}'::jsonb;
    v_db_groups JSONB := '[]'::jsonb;
    v_group_variant_labels JSONB := '{}'::jsonb;
    v_matched_ids UUID[] := ARRAY[]::UUID[];
    v_match_id UUID;
    v_match_count INT;
    v_labels_match BOOLEAN;
    v_labels_for_col JSONB;
    v_db_labels JSONB;
    v_actions JSONB := '[]'::jsonb;
    v_action TEXT;
    v_vc INT;
    v_vu INT;
    v_label_to_value JSONB;
    v_gid UUID;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'Unauthorized');
    END IF;

    IF p_variants IS NULL OR jsonb_typeof(p_variants) <> 'array' THEN
        RETURN jsonb_build_object('ok', true, 'groups', '[]'::jsonb);
    END IF;

    -- A. 彙整欄位（依 identity name 去重合併，labels/values 以 variant_id 為鍵）
    FOR v_var_record IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
        BEGIN
            v_variant_id := (v_var_record->>'variant_id')::UUID;
        EXCEPTION WHEN others THEN
            CONTINUE;
        END;
        IF v_variant_id IS NULL THEN CONTINUE; END IF;
        IF NOT EXISTS (SELECT 1 FROM product_variants WHERE id = v_variant_id AND product_id = p_product_id) THEN CONTINUE; END IF;
        IF v_var_record->'options' IS NULL OR jsonb_typeof(v_var_record->'options') <> 'array' THEN CONTINUE; END IF;

        FOR v_opt_record IN SELECT * FROM jsonb_array_elements(v_var_record->'options') LOOP
            v_col_name := trim(COALESCE(NULLIF(v_opt_record->>'name', ''), v_opt_record->>'group_name', ''));
            IF v_col_name = '' THEN CONTINUE; END IF;
            v_col_display := trim(COALESCE(NULLIF(v_opt_record->>'display', ''), v_col_name));
            v_label := trim(COALESCE(v_opt_record->>'label', ''));
            v_sku_value := NULLIF(trim(COALESCE(v_opt_record->>'value', '')), '');
            v_col_key := lower(v_col_name);

            IF NOT (v_groups ? v_col_key) THEN
                v_groups := jsonb_set(v_groups, ARRAY[v_col_key], jsonb_build_object(
                    'name', v_col_name, 'display', v_col_display,
                    'labels', '{}'::jsonb, 'values', '{}'::jsonb), true);
            ELSIF v_col_display <> (v_groups->v_col_key->>'name') THEN
                v_groups := jsonb_set(v_groups, ARRAY[v_col_key, 'display'], to_jsonb(v_col_display), true);
            END IF;

            IF v_label <> '' THEN
                v_groups := jsonb_set(v_groups, ARRAY[v_col_key, 'labels', v_variant_id::text], to_jsonb(v_label), true);
            END IF;
            IF v_sku_value IS NOT NULL THEN
                v_groups := jsonb_set(v_groups, ARRAY[v_col_key, 'values', v_variant_id::text], to_jsonb(v_sku_value), true);
            END IF;
        END LOOP;
    END LOOP;

    IF v_groups = '{}'::jsonb THEN
        RETURN jsonb_build_object('ok', true, 'groups', '[]'::jsonb);
    END IF;

    -- B. 讀取現有群組，以及各群組的「變體 -> label」現況（供值集比對兜底）
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'ln', lower(trim(g.name)))), '[]'::jsonb)
    INTO v_db_groups
    FROM product_option_groups g
    WHERE g.product_id = p_product_id;

    SELECT COALESCE(jsonb_object_agg(g.id::text, COALESCE(lbl.map, '{}'::jsonb)), '{}'::jsonb)
    INTO v_group_variant_labels
    FROM product_option_groups g
    LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(pvo.variant_id::text, pov.label) AS map
        FROM product_variant_options pvo
        JOIN product_option_values pov ON pov.id = pvo.option_value_id
        WHERE pvo.option_group_id = g.id
    ) lbl ON true
    WHERE g.product_id = p_product_id;

    -- 標記被任何欄位（name 或 display）命中的群組
    FOR v_group_col IN SELECT value FROM jsonb_each(v_groups) LOOP
        v_col_name := v_group_col.value->>'name';
        v_col_display := v_group_col.value->>'display';
        FOR v_db_row IN SELECT * FROM jsonb_array_elements(v_db_groups) LOOP
            IF (v_db_row.value->>'ln') = lower(v_col_name) OR (v_db_row.value->>'ln') = lower(v_col_display) THEN
                v_gid := (v_db_row.value->>'id')::UUID;
                IF NOT (v_gid = ANY(v_matched_ids)) THEN
                    v_matched_ids := array_append(v_matched_ids, v_gid);
                END IF;
            END IF;
        END LOOP;
    END LOOP;

    -- C. 逐欄位解析群組（改名 / 沿用 / 建立），並同步值與連結
    FOR v_group_col IN SELECT key, value FROM jsonb_each(v_groups) LOOP
        v_col_key := v_group_col.key;
        v_col_name := v_group_col.value->>'name';
        v_col_display := v_group_col.value->>'display';
        v_group_id := NULL;
        v_action := 'updated';

        -- 1. 依 identity(name) 找
        SELECT id INTO v_group_id FROM product_option_groups
        WHERE product_id = p_product_id AND lower(trim(name)) = lower(v_col_name) LIMIT 1;

        IF v_group_id IS NOT NULL THEN
            -- 第1列顯示名與群組名不同（且無同名衝突）→ 改名
            IF lower(v_col_display) <> lower(v_col_name)
               AND NOT EXISTS (SELECT 1 FROM product_option_groups
                               WHERE product_id = p_product_id AND id <> v_group_id
                                 AND lower(trim(name)) = lower(v_col_display)) THEN
                UPDATE product_option_groups SET name = v_col_display WHERE id = v_group_id;
                v_action := 'renamed';
            END IF;
        ELSE
            -- 2. 依 display 找
            SELECT id INTO v_group_id FROM product_option_groups
            WHERE product_id = p_product_id AND lower(trim(name)) = lower(v_col_display) LIMIT 1;

            IF v_group_id IS NULL THEN
                -- 3. 值集比對兜底：找「未被任何欄位命中」且逐變體 label 完全吻合的群組，唯一時視為改名
                v_labels_for_col := COALESCE(v_group_col.value->'labels', '{}'::jsonb);
                v_match_id := NULL;
                v_match_count := 0;
                IF (SELECT count(*) FROM jsonb_object_keys(v_labels_for_col)) > 0 THEN
                    FOR v_db_row IN
                        SELECT id FROM product_option_groups g
                        WHERE g.product_id = p_product_id AND NOT (g.id = ANY(v_matched_ids))
                    LOOP
                        v_db_labels := COALESCE(v_group_variant_labels->((v_db_row.id)::text), '{}'::jsonb);
                        v_labels_match := true;
                        FOR v_mp IN SELECT * FROM jsonb_each_text(v_labels_for_col) LOOP
                            IF COALESCE(v_db_labels->>v_mp.key, '') <> v_mp.value THEN
                                v_labels_match := false;
                            END IF;
                        END LOOP;
                        IF v_labels_match THEN
                            v_match_count := v_match_count + 1;
                            v_match_id := v_db_row.id;
                        END IF;
                    END LOOP;
                END IF;

                IF v_match_count = 1 THEN
                    v_group_id := v_match_id;
                    UPDATE product_option_groups SET name = v_col_display WHERE id = v_group_id;
                    v_action := 'renamed';
                END IF;
            END IF;

            -- 4. 建立
            IF v_group_id IS NULL THEN
                SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_max_sort
                FROM product_option_groups WHERE product_id = p_product_id;
                INSERT INTO product_option_groups (product_id, name, sort_order)
                VALUES (p_product_id, v_col_display, v_max_sort)
                RETURNING id INTO v_group_id;
                v_action := 'created';
            END IF;
        END IF;

        -- 顏色群組判定
        v_is_color := (v_col_display ~* '(顏色|色|color)') OR (v_col_name ~* '(顏色|色|color)');

        -- D. 值同步（label 為鍵；value = SKU 段）
        v_vc := 0;
        v_vu := 0;
        v_label_to_value := '{}'::jsonb;

        FOR v_label IN SELECT DISTINCT value FROM jsonb_each_text(v_group_col.value->'labels') LOOP
            v_label := trim(v_label);
            CONTINUE WHEN v_label = '';

            v_sku_value := NULL;
            SELECT v.value INTO v_sku_value
            FROM jsonb_each_text(v_group_col.value->'values') v
            WHERE (v_group_col.value->'labels'->>v.key) = v_label LIMIT 1;

            v_hex_code := NULL;
            IF v_is_color THEN
                SELECT hex_code INTO v_hex_code FROM product_colors
                WHERE lower(name) = lower(v_label) OR upper(code) = upper(v_label) LIMIT 1;
            END IF;

            SELECT id INTO v_value_id FROM product_option_values
            WHERE group_id = v_group_id
              AND (lower(trim(label)) = lower(v_label) OR lower(trim(value)) = lower(v_label)) LIMIT 1;

            IF v_value_id IS NULL THEN
                SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_max_sort
                FROM product_option_values WHERE group_id = v_group_id;
                INSERT INTO product_option_values (group_id, label, value, hex_code, sort_order)
                VALUES (v_group_id, v_label, COALESCE(v_sku_value, v_label), v_hex_code, v_max_sort)
                RETURNING id INTO v_value_id;
                v_vc := v_vc + 1;
            ELSE
                UPDATE product_option_values
                SET value = COALESCE(v_sku_value, value),
                    hex_code = COALESCE(hex_code, v_hex_code)
                WHERE id = v_value_id
                  AND ((v_sku_value IS NOT NULL AND value IS DISTINCT FROM v_sku_value)
                       OR (hex_code IS NULL AND v_hex_code IS NOT NULL));
                IF FOUND THEN v_vu := v_vu + 1; END IF;
            END IF;

            v_label_to_value := jsonb_set(v_label_to_value, ARRAY[lower(v_label)], to_jsonb(v_value_id), true);
        END LOOP;

        -- E. 連結同步（非破壞性：未在檔案中提及的群組連結予以保留）
        FOR v_mp IN SELECT * FROM jsonb_each_text(v_group_col.value->'labels') LOOP
            BEGIN
                v_variant_id := v_mp.key::UUID;
            EXCEPTION WHEN others THEN
                CONTINUE;
            END;
            v_label := trim(v_mp.value);
            CONTINUE WHEN v_label = '';
            v_value_id := (v_label_to_value->>lower(v_label))::UUID;
            CONTINUE WHEN v_value_id IS NULL;

            INSERT INTO product_variant_options (variant_id, option_group_id, option_value_id)
            VALUES (v_variant_id, v_group_id, v_value_id)
            ON CONFLICT (variant_id, option_group_id)
            DO UPDATE SET option_value_id = EXCLUDED.option_value_id;
        END LOOP;

        v_actions := v_actions || jsonb_build_object(
            'name', v_col_display, 'action', v_action,
            'values_created', v_vc, 'values_updated', v_vu);
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'groups', v_actions);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_product_variant_options_batch(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_product_variant_options_batch(UUID, JSONB) TO authenticated;
