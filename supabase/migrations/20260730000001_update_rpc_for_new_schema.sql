-- ==========================================
-- Update RPCs for new product/variant schema
-- ==========================================

-- 1. Updated compare_product_row (no longer references old columns)
CREATE OR REPLACE FUNCTION public.compare_product_row(
    p_code TEXT,
    p_name TEXT,
    p_description TEXT,
    p_brand_id UUID
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
    IF v_product.brand_id IS DISTINCT FROM p_brand_id THEN
        v_diff := array_append(v_diff, '品牌');
    END IF;

    RETURN v_diff;
END;
$$;

-- 2. Updated import_product_batch (new schema)
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
    v_group_id UUID;
    v_option_val RECORD;
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

        -- Insert or update product (by code)
        INSERT INTO public.products (
            code, name, description, brand_id
        ) VALUES (
            item->>'code',
            item->>'name',
            item->>'description',
            (item->>'brand_id')::UUID
        )
        ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            brand_id = EXCLUDED.brand_id,
            updated_at = NOW()
        RETURNING id INTO v_product_id;

        v_product_ids := array_append(v_product_ids, v_product_id);

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
