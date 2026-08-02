-- ==========================================
-- Fix all RPCs for the new product/variant schema
-- 1. duplicate_product_with_variants
-- 2. import_product_batch
-- 3. compare_product_row
-- 4. Reload PostgREST schema cache
-- ==========================================

-- ==========================================
-- 1. duplicate_product_with_variants
-- New schema: products has no sku/brand_id/status/etc.
-- Uses product_brands junction, product_series_links,
-- product_option_groups/values/variant_options
-- ==========================================
DROP FUNCTION IF EXISTS public.duplicate_product_with_variants;

CREATE OR REPLACE FUNCTION public.duplicate_product_with_variants(
    target_product_id UUID,
    new_name TEXT,
    new_sku TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_product_id UUID;
    v_code TEXT;
    old_variant RECORD;
    new_variant_id UUID;
    old_group RECORD;
    new_group_id UUID;
    old_value RECORD;
    new_value_id UUID;
BEGIN
    -- Generate code from new_sku or new_name
    v_code := COALESCE(new_sku, new_name);

    -- Create new product (only columns that exist)
    INSERT INTO products (
        name, description, code
    ) SELECT
        new_name, description, v_code
    FROM products
    WHERE id = target_product_id
    RETURNING id INTO new_product_id;

    -- Copy product_brands links
    INSERT INTO product_brands (product_id, brand_id, is_primary)
    SELECT new_product_id, brand_id, is_primary
    FROM product_brands
    WHERE product_id = target_product_id;

    -- Copy product_series_links
    INSERT INTO product_series_links (product_id, brand_series_id)
    SELECT new_product_id, brand_series_id
    FROM product_series_links
    WHERE product_id = target_product_id;

    -- Copy product_category_links
    INSERT INTO product_category_links (product_id, category_id, variant_id)
    SELECT new_product_id, category_id, NULL
    FROM product_category_links
    WHERE product_id = target_product_id AND variant_id IS NULL;

    -- Copy entity_model_relations (product-level)
    INSERT INTO entity_model_relations (product_id, variant_id, model_id, group_id, relation_type, reason)
    SELECT new_product_id, NULL, model_id, group_id, relation_type, reason
    FROM entity_model_relations
    WHERE product_id = target_product_id AND variant_id IS NULL;

    -- Copy entity_spec_values (product-level)
    INSERT INTO entity_spec_values (entity_type, entity_id, category_id, spec_id, parent_id, instance_uuid, lifecycle_state, display_order, value, is_inherited, origin_entity_id)
    SELECT 'product', new_product_id, category_id, spec_id, parent_id, gen_random_uuid(), 'active', display_order, value, is_inherited, NULL
    FROM entity_spec_values
    WHERE entity_type = 'product' AND entity_id = target_product_id;

    -- Copy product_images (product-level)
    INSERT INTO product_images (entity_type, entity_id, url, storage_path, external_url, is_cover, sort_order, alt_text)
    SELECT entity_type, new_product_id, url, storage_path, external_url, is_cover, sort_order, alt_text
    FROM product_images
    WHERE entity_type = 'product' AND entity_id = target_product_id;

    -- Copy variants
    FOR old_variant IN
        SELECT * FROM product_variants WHERE product_id = target_product_id
    LOOP
        INSERT INTO product_variants (
            product_id, name, sku, wholesale_price, retail_price, status, barcode, sort_order
        ) VALUES (
            new_product_id,
            old_variant.name,
            old_variant.sku || '-COPY-' || floor(random()*1000),
            old_variant.wholesale_price,
            old_variant.retail_price,
            'active',
            old_variant.barcode,
            old_variant.sort_order
        )
        RETURNING id INTO new_variant_id;

        -- Copy variant-level entity_model_relations
        INSERT INTO entity_model_relations (product_id, variant_id, model_id, group_id, relation_type, reason)
        SELECT new_product_id, new_variant_id, model_id, group_id, relation_type, reason
        FROM entity_model_relations
        WHERE variant_id = old_variant.id;

        -- Copy variant-level entity_spec_values
        INSERT INTO entity_spec_values (entity_type, entity_id, category_id, spec_id, parent_id, instance_uuid, lifecycle_state, display_order, value, is_inherited, origin_entity_id)
        SELECT 'variant', new_variant_id, category_id, spec_id, parent_id, gen_random_uuid(), 'active', display_order, value, is_inherited, NULL
        FROM entity_spec_values
        WHERE entity_type = 'variant' AND entity_id = old_variant.id;

        -- Copy variant-level product_images
        INSERT INTO product_images (entity_type, entity_id, url, storage_path, external_url, is_cover, sort_order, alt_text)
        SELECT entity_type, new_variant_id, url, storage_path, external_url, is_cover, sort_order, alt_text
        FROM product_images
        WHERE entity_type = 'variant' AND entity_id = old_variant.id;

        -- Copy product_category_links (variant-level)
        INSERT INTO product_category_links (product_id, category_id, variant_id)
        SELECT new_product_id, category_id, new_variant_id
        FROM product_category_links
        WHERE variant_id = old_variant.id;
    END LOOP;

    -- Copy option groups, values, and variant-option links
    FOR old_group IN
        SELECT * FROM product_option_groups WHERE product_id = target_product_id
    LOOP
        INSERT INTO product_option_groups (product_id, name, sort_order)
        VALUES (new_product_id, old_group.name, old_group.sort_order)
        RETURNING id INTO new_group_id;

        FOR old_value IN
            SELECT * FROM product_option_values WHERE group_id = old_group.id
        LOOP
            INSERT INTO product_option_values (group_id, label, value, hex_code, sort_order)
            VALUES (new_group_id, old_value.label, old_value.value, old_value.hex_code, old_value.sort_order)
            RETURNING id INTO new_value_id;

            -- Link new variants to new values
            INSERT INTO product_variant_options (variant_id, option_value_id, option_group_id)
            SELECT pv.id, new_value_id, new_group_id
            FROM product_variants pv
            JOIN product_variants old_pv ON old_pv.product_id = target_product_id
            JOIN product_variant_options pvo ON pvo.variant_id = old_pv.id AND pvo.option_value_id = old_value.id
            WHERE pv.product_id = new_product_id
              AND old_pv.sku = pv.sku;
        END LOOP;
    END LOOP;

    -- Bump version
    PERFORM public.bump_data_version('products', 'duplicate_product_with_variants');

    RETURN new_product_id;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '複製失敗: %', SQLERRM;
END;
$$;

-- ==========================================
-- 2. import_product_batch
-- New schema: no products.brand_id, uses product_brands junction
-- ==========================================
DROP FUNCTION IF EXISTS public.import_product_batch;

CREATE OR REPLACE FUNCTION public.import_product_batch(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item JSONB;
    variant JSONB;
    v_product_id UUID;
    v_product_ids UUID[] := '{}';
    v_imported_count INT := 0;
    v_skipped_count INT := 0;
    v_has_diff BOOLEAN;
    v_diff TEXT[];
    v_variant_id UUID;
    v_brand_ids UUID[];
    v_brand_id UUID;
    v_series_ids UUID[];
    v_series_id UUID;
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_has_diff := TRUE;
        IF item ? 'diff' AND item ? 'action' THEN
            IF item->>'action' = 'update' THEN
                v_diff := ARRAY(SELECT jsonb_array_elements_text(item->'diff'));
                IF array_length(v_diff, 1) IS NULL OR array_length(v_diff, 1) = 0 THEN
                    v_has_diff := FALSE;
                END IF;
            END IF;
        END IF;

        IF NOT v_has_diff THEN
            v_skipped_count := v_skipped_count + 1;
            CONTINUE;
        END IF;

        -- Insert or update product (by code) -- no brand_id on products!
        INSERT INTO public.products (
            code, name, description
        ) VALUES (
            item->>'code',
            item->>'name',
            item->>'description'
        )
        ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            updated_at = NOW()
        RETURNING id INTO v_product_id;

        v_product_ids := array_append(v_product_ids, v_product_id);

        -- Brand links via product_brands junction
        IF item ? 'brand_ids' AND jsonb_typeof(item->'brand_ids') = 'array' THEN
            v_brand_ids := ARRAY(SELECT jsonb_array_elements_text(item->'brand_ids')::UUID);
            IF array_length(v_brand_ids, 1) > 0 THEN
                INSERT INTO public.product_brands (product_id, brand_id, is_primary)
                SELECT v_product_id, unnest(v_brand_ids), true
                ON CONFLICT (product_id, brand_id) DO NOTHING;
            END IF;
        ELSIF item ? 'brand_id' AND item->>'brand_id' IS NOT NULL THEN
            -- Single brand (backward compat)
            INSERT INTO public.product_brands (product_id, brand_id, is_primary)
            VALUES (v_product_id, (item->>'brand_id')::UUID, true)
            ON CONFLICT (product_id, brand_id) DO NOTHING;
        END IF;

        -- Series links via product_series_links junction
        IF item ? 'series_ids' AND jsonb_typeof(item->'series_ids') = 'array' THEN
            v_series_ids := ARRAY(SELECT jsonb_array_elements_text(item->'series_ids')::UUID);
            IF array_length(v_series_ids, 1) > 0 THEN
                INSERT INTO public.product_series_links (product_id, brand_series_id)
                SELECT v_product_id, unnest(v_series_ids)
                ON CONFLICT (product_id, brand_series_id) DO NOTHING;
            END IF;
        END IF;

        -- Category links
        IF item ? 'category_ids' AND jsonb_typeof(item->'category_ids') = 'array'
           AND jsonb_array_length(item->'category_ids') > 0 THEN
            INSERT INTO public.product_category_links (product_id, category_id)
            SELECT v_product_id, cid::UUID
            FROM jsonb_array_elements_text(item->'category_ids') AS cid
            ON CONFLICT (product_id, category_id) DO NOTHING;
        END IF;

        -- Specs (product-level)
        IF item ? 'specs' AND jsonb_typeof(item->'specs') = 'array'
           AND jsonb_array_length(item->'specs') > 0 THEN
            PERFORM public.sync_product_specs_v6(
                (spec->>'category_id')::UUID,
                v_product_id,
                'product'::public.spec_entity_type,
                (spec->>'spec_data')::JSONB
            )
            FROM jsonb_array_elements(item->'specs') AS spec;
        END IF;

        -- Variants
        IF item ? 'variants' AND jsonb_typeof(item->'variants') = 'array'
           AND jsonb_array_length(item->'variants') > 0 THEN
            FOR variant IN SELECT * FROM jsonb_array_elements(item->'variants')
            LOOP
                INSERT INTO public.product_variants (
                    product_id, sku, name,
                    wholesale_price, retail_price, status, barcode
                ) VALUES (
                    v_product_id,
                    variant->>'sku',
                    variant->>'name',
                    COALESCE((variant->>'wholesale_price')::NUMERIC, 0),
                    COALESCE((variant->>'retail_price')::NUMERIC, 0),
                    COALESCE(variant->>'status', 'active')::public.product_status,
                    variant->>'barcode'
                )
                ON CONFLICT (sku) DO UPDATE SET
                    product_id = EXCLUDED.product_id,
                    name = EXCLUDED.name,
                    wholesale_price = EXCLUDED.wholesale_price,
                    retail_price = EXCLUDED.retail_price,
                    status = EXCLUDED.status,
                    barcode = EXCLUDED.barcode,
                    updated_at = NOW()
                RETURNING id INTO v_variant_id;

                -- Specs (variant-level)
                IF variant ? 'specs' AND jsonb_typeof(variant->'specs') = 'array'
                   AND jsonb_array_length(variant->'specs') > 0 THEN
                    PERFORM public.sync_product_specs_v6(
                        (vs->>'category_id')::UUID,
                        v_variant_id,
                        'variant'::public.spec_entity_type,
                        (vs->>'spec_data')::JSONB
                    )
                    FROM jsonb_array_elements(variant->'specs') AS vs;
                END IF;
            END LOOP;
        ELSE
            -- No variants provided: create a default variant
            INSERT INTO public.product_variants (
                product_id, sku, name, wholesale_price, retail_price, status
            ) VALUES (
                v_product_id,
                item->>'code',
                COALESCE(item->>'name', 'Default'),
                0, 0, 'active'
            )
            ON CONFLICT (sku) DO NOTHING;
        END IF;

        v_imported_count := v_imported_count + 1;
    END LOOP;

    PERFORM public.bump_data_version('products', 'import_product_batch');

    RETURN jsonb_build_object(
        'success', true,
        'imported_count', v_imported_count,
        'skipped_count', v_skipped_count,
        'product_ids', to_jsonb(v_product_ids)
    );
END;
$$;

-- ==========================================
-- 3. compare_product_row
-- New schema: no brand_id on products, compare by code/name/description only
-- ==========================================
DROP FUNCTION IF EXISTS public.compare_product_row;

CREATE OR REPLACE FUNCTION public.compare_product_row(
    p_code TEXT,
    p_name TEXT,
    p_description TEXT
) RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_product public.products%ROWTYPE;
    v_diff TEXT[] := '{}';
BEGIN
    SELECT * INTO v_product FROM public.products WHERE code = p_code;
    IF NOT FOUND THEN
        RETURN v_diff;
    END IF;

    IF v_product.name IS DISTINCT FROM p_name THEN
        v_diff := array_append(v_diff, '產品名稱');
    END IF;
    IF v_product.description IS DISTINCT FROM p_description THEN
        v_diff := array_append(v_diff, '描述');
    END IF;

    RETURN v_diff;
END;
$$;

-- Overload: also accept old signature with p_brand_id (ignored)
CREATE OR REPLACE FUNCTION public.compare_product_row(
    p_code TEXT,
    p_name TEXT,
    p_description TEXT,
    p_brand_id UUID
) RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN public.compare_product_row(p_code, p_name, p_description);
END;
$$;

-- ==========================================
-- 4. Reload PostgREST schema cache
-- ==========================================
NOTIFY pgrst, 'reload schema';
