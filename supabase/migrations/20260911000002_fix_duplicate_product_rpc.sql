-- ==========================================
-- Fix duplicate_product_with_variants RPC
-- 1. Fix emr_exactly_one_entity violation: variant-level entity_model_relations
--    should NOT set product_id (require exactly one of product_id/variant_id)
-- 2. Copy product-level entity_model_relations → variant-level for ALL variants
--    (products always have variants, no need for product-level relations)
-- 3. Fix product_variant_options linking: use temp table old→new variant ID mapping
--    instead of SKU matching (new SKUs have -COPY-XXXX suffix, never match)
-- 4. Copy sort_order for entity_model_relations
-- 5. Copy product_addon_bindings (was missing)
-- 6. Copy additional product columns (unified_pricing, item_type, etc.)
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
    addon RECORD;
BEGIN
    v_code := COALESCE(new_sku, new_name);

    -- Create new product (include all relevant columns)
    INSERT INTO products (
        name, description, code,
        unified_pricing, unified_wholesale_price, unified_retail_price,
        item_type, is_hidden, supplier_id
    ) SELECT
        new_name, description, v_code,
        unified_pricing, unified_wholesale_price, unified_retail_price,
        item_type, is_hidden, supplier_id
    FROM products
    WHERE id = target_product_id
    RETURNING id INTO new_product_id;

    -- Copy product_brands
    INSERT INTO product_brands (product_id, brand_id, is_primary)
    SELECT new_product_id, brand_id, is_primary
    FROM product_brands
    WHERE product_id = target_product_id;

    -- Copy product_series_links
    INSERT INTO product_series_links (product_id, brand_series_id)
    SELECT new_product_id, brand_series_id
    FROM product_series_links
    WHERE product_id = target_product_id;

    -- Copy product_category_links (product-level)
    INSERT INTO product_category_links (product_id, category_id, variant_id)
    SELECT new_product_id, category_id, NULL
    FROM product_category_links
    WHERE product_id = target_product_id AND variant_id IS NULL;

    -- Copy entity_spec_values (product-level)
    INSERT INTO entity_spec_values (entity_type, entity_id, category_id, spec_id, parent_id,
        instance_uuid, lifecycle_state, display_order, value, is_inherited, origin_entity_id)
    SELECT 'product', new_product_id, category_id, spec_id, parent_id, gen_random_uuid(),
        'active', display_order, value, is_inherited, NULL
    FROM entity_spec_values
    WHERE entity_type = 'product' AND entity_id = target_product_id;

    -- Copy product_images (product-level)
    INSERT INTO product_images (entity_type, entity_id, url, storage_path, external_url,
        is_cover, sort_order, alt_text)
    SELECT entity_type, new_product_id, url, storage_path, external_url, is_cover, sort_order, alt_text
    FROM product_images
    WHERE entity_type = 'product' AND entity_id = target_product_id;

    -- Temp table: map old variant IDs → new variant IDs
    CREATE TEMPORARY TABLE _variant_id_map (
        old_id UUID PRIMARY KEY,
        new_id UUID NOT NULL
    ) ON COMMIT DROP;

    -- Copy variants
    FOR old_variant IN
        SELECT * FROM product_variants WHERE product_id = target_product_id ORDER BY sort_order, created_at
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

        -- Store old→new mapping
        INSERT INTO _variant_id_map (old_id, new_id) VALUES (old_variant.id, new_variant_id);

        -- Copy variant-level entity_model_relations (product_id=NULL, only variant_id)
        INSERT INTO entity_model_relations (product_id, variant_id, model_id, group_id, relation_type, reason, sort_order)
        SELECT NULL, new_variant_id, model_id, group_id, relation_type, reason, sort_order
        FROM entity_model_relations
        WHERE variant_id = old_variant.id;

        -- Copy product-level entity_model_relations as variant-level for this variant
        -- (skip if variant already has same model/group to avoid unique index conflict)
        INSERT INTO entity_model_relations (product_id, variant_id, model_id, group_id, relation_type, reason, sort_order)
        SELECT NULL, new_variant_id, emr.model_id, emr.group_id, emr.relation_type, emr.reason, emr.sort_order
        FROM entity_model_relations emr
        WHERE emr.product_id = target_product_id AND emr.variant_id IS NULL
        AND NOT EXISTS (
            SELECT 1 FROM entity_model_relations existing
            WHERE existing.variant_id = new_variant_id
            AND existing.model_id IS NOT DISTINCT FROM emr.model_id
            AND existing.group_id IS NOT DISTINCT FROM emr.group_id
            AND existing.relation_type = emr.relation_type
        );

        -- Copy variant-level entity_spec_values
        INSERT INTO entity_spec_values (entity_type, entity_id, category_id, spec_id, parent_id,
            instance_uuid, lifecycle_state, display_order, value, is_inherited, origin_entity_id)
        SELECT 'variant', new_variant_id, category_id, spec_id, parent_id, gen_random_uuid(),
            'active', display_order, value, is_inherited, NULL
        FROM entity_spec_values
        WHERE entity_type = 'variant' AND entity_id = old_variant.id;

        -- Copy variant-level product_images
        INSERT INTO product_images (entity_type, entity_id, url, storage_path, external_url,
            is_cover, sort_order, alt_text)
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
        SELECT * FROM product_option_groups WHERE product_id = target_product_id ORDER BY sort_order
    LOOP
        INSERT INTO product_option_groups (product_id, name, sort_order)
        VALUES (new_product_id, old_group.name, old_group.sort_order)
        RETURNING id INTO new_group_id;

        FOR old_value IN
            SELECT * FROM product_option_values WHERE group_id = old_group.id ORDER BY sort_order
        LOOP
            INSERT INTO product_option_values (group_id, label, value, hex_code, sort_order)
            VALUES (new_group_id, old_value.label, old_value.value, old_value.hex_code, old_value.sort_order)
            RETURNING id INTO new_value_id;

            -- Link new variants to new values using temp table mapping
            INSERT INTO product_variant_options (variant_id, option_value_id, option_group_id)
            SELECT m.new_id, new_value_id, new_group_id
            FROM _variant_id_map m
            JOIN product_variant_options pvo ON pvo.variant_id = m.old_id AND pvo.option_value_id = old_value.id;
        END LOOP;
    END LOOP;

    -- Copy product_addon_bindings
    FOR addon IN
        SELECT * FROM product_addon_bindings WHERE parent_product_id = target_product_id
    LOOP
        INSERT INTO product_addon_bindings (parent_product_id, addon_product_id, addon_variant_id, quantity, sort_order)
        VALUES (new_product_id, addon.addon_product_id, addon.addon_variant_id, addon.quantity, addon.sort_order);
    END LOOP;

    -- Bump version
    PERFORM public.bump_data_version('products', 'duplicate_product_with_variants');

    RETURN new_product_id;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '複製失敗: %', SQLERRM;
END;
$$;

NOTIFY pgrst, 'reload schema';
