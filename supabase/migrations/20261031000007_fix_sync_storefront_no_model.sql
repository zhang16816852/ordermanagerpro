-- =============================================================================
-- sync_storefront_items：無裝置型號的變體也要產生 storefront_items 列
-- -----------------------------------------------------------------------------
-- 問題：原函式在變體沒有任何 device model 連結時，內層 model loop 不執行、
--       v_active_models 為空陣列，後續 DELETE ... WHERE model_id != ALL(empty)
--       會把該變體所有列刪光 → 產品（如行動電源）完全不出現在公開目錄。
-- 修法：無 model 時插入一列 model_id = NULL（display_name = 變體名），
--       並讓清理 DELETE 只在有 active model 時執行。
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sync_storefront_items(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_variant RECORD;
    v_model RECORD;
    v_display_name TEXT;
    v_slug TEXT;
    v_active_models UUID[];
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.products
        WHERE id = p_product_id
          AND (
              is_hidden = true
              OR item_type NOT IN ('product', 'packaging')
          )
    ) THEN
        DELETE FROM public.storefront_items
        WHERE product_id = p_product_id;

        RETURN;
    END IF;

    FOR v_variant IN
        SELECT id, name
        FROM public.product_variants
        WHERE product_id = p_product_id
    LOOP

        v_active_models := ARRAY[]::UUID[];

        FOR v_model IN
            WITH variant_models AS (
                SELECT model_id
                FROM public.device_model_links
                WHERE entity_id = v_variant.id
                  AND entity_type = 'variant'

                UNION

                SELECT model_id
                FROM public.device_model_links
                WHERE entity_id = p_product_id
                  AND entity_type = 'product'

                UNION

                SELECT i.model_id
                FROM public.device_model_group_links gl
                JOIN public.device_model_group_items i
                  ON gl.group_id = i.group_id
                WHERE gl.entity_id = v_variant.id
                  AND gl.entity_type = 'variant'

                UNION

                SELECT i.model_id
                FROM public.device_model_group_links gl
                JOIN public.device_model_group_items i
                  ON gl.group_id = i.group_id
                WHERE gl.entity_id = p_product_id
                  AND gl.entity_type = 'product'
            ),

            exclusions AS (
                SELECT model_id
                FROM public.device_model_exclusions
                WHERE entity_id = v_variant.id
                  AND entity_type = 'variant'

                UNION

                SELECT model_id
                FROM public.device_model_exclusions
                WHERE entity_id = p_product_id
                  AND entity_type = 'product'
            )

            SELECT
                m.id,
                m.name
            FROM variant_models vm
            JOIN public.device_models m
              ON vm.model_id = m.id
            WHERE vm.model_id NOT IN (
                SELECT model_id
                FROM exclusions
            )
        LOOP

            IF v_variant.name LIKE '%{model}%' THEN
                v_display_name :=
                    REPLACE(
                        v_variant.name,
                        '{model}',
                        v_model.name
                    );
            ELSE
                v_display_name :=
                    '(' || v_model.name || ') ' || v_variant.name;
            END IF;

            v_slug := 'item-' || encode(
                extensions.digest(
                    (
                        v_variant.id::text ||
                        v_model.id::text
                    )::text,
                    'sha1'::text
                ),
                'hex'
            );

            INSERT INTO public.storefront_items (
                product_id,
                variant_id,
                model_id,
                display_name,
                slug,
                updated_at
            )
            VALUES (
                p_product_id,
                v_variant.id,
                v_model.id,
                v_display_name,
                v_slug,
                now()
            )
            ON CONFLICT (variant_id, model_id)
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                updated_at = now();

            v_active_models :=
                array_append(
                    v_active_models,
                    v_model.id
                );

        END LOOP;

        -- 無裝置型號：仍產生一列（model_id = NULL），讓產品出現在公開目錄
        IF COALESCE(array_length(v_active_models, 1), 0) = 0 THEN
            v_slug := 'item-' || encode(
                extensions.digest(
                    (v_variant.id::text || '-nomodel')::text,
                    'sha1'::text
                ),
                'hex'
            );

            INSERT INTO public.storefront_items (
                product_id,
                variant_id,
                model_id,
                display_name,
                slug,
                updated_at
            )
            VALUES (
                p_product_id,
                v_variant.id,
                NULL,
                v_variant.name,
                v_slug,
                now()
            )
            ON CONFLICT (variant_id, model_id)
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                updated_at = now();

            v_active_models := ARRAY[NULL::uuid];
        END IF;

        -- 只在有 active model 時才清理舊列（避免空陣列誤刪）
        IF COALESCE(array_length(v_active_models, 1), 0) > 0
           AND v_active_models[1] IS NOT NULL THEN
            DELETE FROM public.storefront_items
            WHERE variant_id = v_variant.id
              AND model_id != ALL(v_active_models);
        END IF;

    END LOOP;

    DELETE FROM public.storefront_items
    WHERE product_id = p_product_id
      AND variant_id NOT IN (
          SELECT id
          FROM public.product_variants
          WHERE product_id = p_product_id
      );

    PERFORM public.bump_data_version(
        'storefront_items'::text,
        NULL::text
    );
END;
$function$;