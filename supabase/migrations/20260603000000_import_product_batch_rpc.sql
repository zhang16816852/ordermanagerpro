-- ==========================================
-- 批次產品匯入統一後端接口 (Unified Batch Import RPC)
-- 建立時間: 2026-06-03
-- ==========================================

-- 1. compare_product_row: 全欄位比對，回傳 diff 陣列
-- 用於前端判斷該筆是「新增」「更新」還是「無變化(跳過)」
CREATE OR REPLACE FUNCTION public.compare_product_row(
    p_sku TEXT,
    p_name TEXT,
    p_description TEXT,
    p_model TEXT,
    p_series TEXT,
    p_brand_id UUID,
    p_base_wholesale_price NUMERIC,
    p_base_retail_price NUMERIC,
    p_status TEXT,
    p_barcode TEXT,
    p_has_variants BOOLEAN,
    p_color TEXT
) RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_product public.products%ROWTYPE;
    v_diff TEXT[] := '{}';
BEGIN
    SELECT * INTO v_product FROM public.products WHERE sku = p_sku;
    IF NOT FOUND THEN
        RETURN v_diff;
    END IF;

    IF v_product.name IS DISTINCT FROM p_name THEN
        v_diff := array_append(v_diff, '產品名稱');
    END IF;
    IF v_product.description IS DISTINCT FROM p_description THEN
        v_diff := array_append(v_diff, '描述');
    END IF;
    IF v_product.model IS DISTINCT FROM p_model THEN
        v_diff := array_append(v_diff, '型號');
    END IF;
    IF v_product.series IS DISTINCT FROM p_series THEN
        v_diff := array_append(v_diff, '系列');
    END IF;
    IF v_product.brand_id IS DISTINCT FROM p_brand_id THEN
        v_diff := array_append(v_diff, '品牌');
    END IF;
    IF v_product.base_wholesale_price IS DISTINCT FROM p_base_wholesale_price THEN
        v_diff := array_append(v_diff, '批發價');
    END IF;
    IF v_product.base_retail_price IS DISTINCT FROM p_base_retail_price THEN
        v_diff := array_append(v_diff, '零售價');
    END IF;
    IF v_product.status::text IS DISTINCT FROM p_status THEN
        v_diff := array_append(v_diff, '狀態');
    END IF;
    IF v_product.barcode IS DISTINCT FROM p_barcode THEN
        v_diff := array_append(v_diff, '條碼');
    END IF;
    IF v_product.color IS DISTINCT FROM p_color THEN
        v_diff := array_append(v_diff, '顏色');
    END IF;
    IF v_product.has_variants IS DISTINCT FROM p_has_variants THEN
        v_diff := array_append(v_diff, '多變體');
    END IF;

    RETURN v_diff;
END;
$$;

-- 2. import_product_batch: 統一批次匯入接口
-- 接收 JSONB 陣列，每元素包含一筆產品 + 變體 + 分類 + 規格序列化資料
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

        INSERT INTO public.products (
            sku, name, description, brand_id, model, series,
            base_wholesale_price, base_retail_price, status,
            has_variants, barcode, color
        ) VALUES (
            item->>'sku',
            item->>'name',
            item->>'description',
            (item->>'brand_id')::UUID,
            item->>'model',
            item->>'series',
            COALESCE((item->>'base_wholesale_price')::NUMERIC, 0),
            COALESCE((item->>'base_retail_price')::NUMERIC, 0),
            COALESCE(item->>'status', 'active')::public.product_status,
            COALESCE((item->>'has_variants')::BOOLEAN, false),
            item->>'barcode',
            item->>'color'
        )
        ON CONFLICT (sku) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            brand_id = EXCLUDED.brand_id,
            model = EXCLUDED.model,
            series = EXCLUDED.series,
            base_wholesale_price = EXCLUDED.base_wholesale_price,
            base_retail_price = EXCLUDED.base_retail_price,
            status = EXCLUDED.status,
            has_variants = EXCLUDED.has_variants,
            barcode = EXCLUDED.barcode,
            color = EXCLUDED.color,
            updated_at = NOW()
        RETURNING id INTO v_product_id;

        v_product_ids := array_append(v_product_ids, v_product_id);

        IF item ? 'category_ids' AND jsonb_typeof(item->'category_ids') = 'array'
           AND jsonb_array_length(item->'category_ids') > 0 THEN
            INSERT INTO public.product_category_links (product_id, category_id)
            SELECT v_product_id, cid::UUID
            FROM jsonb_array_elements_text(item->'category_ids') AS cid
            ON CONFLICT (product_id, category_id) DO NOTHING;
        END IF;

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

        IF item ? 'variants' AND jsonb_typeof(item->'variants') = 'array'
           AND jsonb_array_length(item->'variants') > 0 THEN
            FOR variant IN SELECT * FROM jsonb_array_elements(item->'variants')
            LOOP
                INSERT INTO public.product_variants (
                    product_id, sku, name, option_1, option_2, option_3,
                    wholesale_price, retail_price, status, barcode
                ) VALUES (
                    v_product_id,
                    variant->>'sku',
                    variant->>'name',
                    variant->>'option_1',
                    variant->>'option_2',
                    variant->>'option_3',
                    COALESCE((variant->>'wholesale_price')::NUMERIC, 0),
                    COALESCE((variant->>'retail_price')::NUMERIC, 0),
                    COALESCE(variant->>'status', 'active')::public.product_status,
                    variant->>'barcode'
                )
                ON CONFLICT (sku) DO UPDATE SET
                    product_id = EXCLUDED.product_id,
                    name = EXCLUDED.name,
                    option_1 = EXCLUDED.option_1,
                    option_2 = EXCLUDED.option_2,
                    option_3 = EXCLUDED.option_3,
                    wholesale_price = EXCLUDED.wholesale_price,
                    retail_price = EXCLUDED.retail_price,
                    status = EXCLUDED.status,
                    barcode = EXCLUDED.barcode,
                    updated_at = NOW()
                RETURNING id INTO v_variant_id;

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
