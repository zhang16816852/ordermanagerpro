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
    v_variant_id UUID;
    v_group_name TEXT;
    v_label TEXT;
    v_group_id UUID;
    v_value_id UUID;
    v_hex_code TEXT;
    v_is_color BOOLEAN;
    v_max_sort INT;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'Unauthorized');
    END IF;

    IF p_variants IS NULL OR jsonb_typeof(p_variants) <> 'array' THEN
        RETURN jsonb_build_object('ok', true);
    END IF;

    FOR v_var_record IN SELECT * FROM jsonb_array_elements(p_variants)
    LOOP
        v_variant_id := (v_var_record->>'variant_id')::UUID;
        
        -- Verify variant belongs to product
        IF NOT EXISTS (SELECT 1 FROM product_variants WHERE id = v_variant_id AND product_id = p_product_id) THEN
            CONTINUE;
        END IF;

        IF v_var_record->'options' IS NULL OR jsonb_typeof(v_var_record->'options') <> 'array' THEN
            CONTINUE;
        END IF;

        FOR v_opt_record IN SELECT * FROM jsonb_array_elements(v_var_record->'options')
        LOOP
            v_group_name := trim(v_opt_record->>'group_name');
            v_label := trim(v_opt_record->>'label');

            IF v_group_name = '' OR v_label = '' THEN
                CONTINUE;
            END IF;

            -- Find or create option group by name (case-insensitive)
            SELECT id INTO v_group_id
            FROM product_option_groups
            WHERE product_id = p_product_id
              AND lower(trim(name)) = lower(v_group_name);

            IF v_group_id IS NULL THEN
                SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_max_sort
                FROM product_option_groups
                WHERE product_id = p_product_id;

                INSERT INTO product_option_groups (product_id, name, sort_order)
                VALUES (p_product_id, v_group_name, v_max_sort)
                RETURNING id INTO v_group_id;
            END IF;

            -- Check if color group
            v_is_color := (v_group_name ~* '(顏色|色|color)');
            v_hex_code := NULL;

            IF v_is_color THEN
                SELECT hex_code INTO v_hex_code
                FROM product_colors
                WHERE lower(name) = lower(v_label) OR upper(code) = upper(v_label)
                LIMIT 1;
            END IF;

            -- Find or create option value
            SELECT id INTO v_value_id
            FROM product_option_values
            WHERE option_group_id = v_group_id
              AND (lower(trim(label)) = lower(v_label) OR lower(trim(value)) = lower(v_label));

            IF v_value_id IS NULL THEN
                SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_max_sort
                FROM product_option_values
                WHERE option_group_id = v_group_id;

                INSERT INTO product_option_values (option_group_id, label, value, hex_code, sort_order)
                VALUES (v_group_id, v_label, v_label, v_hex_code, v_max_sort)
                RETURNING id INTO v_value_id;
            ELSEIF v_hex_code IS NOT NULL THEN
                UPDATE product_option_values
                SET hex_code = COALESCE(hex_code, v_hex_code)
                WHERE id = v_value_id;
            END IF;

            -- Upsert variant option link (non-destructive to other groups)
            INSERT INTO product_variant_options (variant_id, option_group_id, option_value_id)
            VALUES (v_variant_id, v_group_id, v_value_id)
            ON CONFLICT (variant_id, option_group_id)
            DO UPDATE SET option_value_id = EXCLUDED.option_value_id;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_product_variant_options_batch(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_product_variant_options_batch(UUID, JSONB) TO authenticated;
