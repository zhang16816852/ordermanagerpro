-- 復原 20260602213529_consolidate_entity_model_relations.sql 中建立的「向後相容 VIEW」。
-- 遠端資料庫只有 entity_model_relations 實表，缺少下列 VIEW，導致 sync_storefront_items 執行時 42P01。
-- 以 CREATE OR REPLACE VIEW 保持冪等。

-- 7. Recreate product_effective_models_base as a view over entity_model_relations
CREATE OR REPLACE VIEW public.product_effective_models_base AS
WITH direct_models AS (
    SELECT
        product_id,
        model_id,
        'direct'::text AS source,
        NULL::uuid AS group_id
    FROM public.entity_model_relations
    WHERE product_id IS NOT NULL AND model_id IS NOT NULL AND relation_type = 'include'
),
group_models AS (
    SELECT
        emr.product_id,
        i.model_id,
        'group'::text AS source,
        emr.group_id
    FROM public.entity_model_relations emr
    JOIN public.device_model_group_items i ON emr.group_id = i.group_id
    JOIN public.device_model_groups g ON emr.group_id = g.id
    WHERE emr.product_id IS NOT NULL AND emr.group_id IS NOT NULL
      AND emr.relation_type = 'include'
      AND g.is_active = true AND g.deleted_at IS NULL
)
SELECT DISTINCT ON (product_id, model_id)
    product_id, model_id, source, group_id
FROM (
    SELECT product_id, model_id, source, group_id FROM direct_models
    UNION ALL
    SELECT product_id, model_id, source, group_id FROM group_models
) all_models
WHERE NOT EXISTS (
    SELECT 1 FROM public.entity_model_relations e
    WHERE e.product_id = all_models.product_id
      AND e.model_id = all_models.model_id
      AND e.relation_type = 'exclude'
);

-- 8. Backward-compatible views so existing RPCs continue to work
CREATE OR REPLACE VIEW public.device_model_links AS
SELECT
    id,
    CASE WHEN product_id IS NOT NULL THEN 'product' ELSE 'variant' END AS entity_type,
    COALESCE(product_id, variant_id) AS entity_id,
    model_id,
    created_at
FROM public.entity_model_relations
WHERE model_id IS NOT NULL AND relation_type = 'include';

CREATE OR REPLACE VIEW public.device_model_group_links AS
SELECT
    id,
    CASE WHEN product_id IS NOT NULL THEN 'product' ELSE 'variant' END AS entity_type,
    COALESCE(product_id, variant_id) AS entity_id,
    group_id,
    created_at
FROM public.entity_model_relations
WHERE group_id IS NOT NULL AND relation_type = 'include';

CREATE OR REPLACE VIEW public.device_model_exclusions AS
SELECT
    id,
    CASE WHEN product_id IS NOT NULL THEN 'product' ELSE 'variant' END AS entity_type,
    COALESCE(product_id, variant_id) AS entity_id,
    model_id,
    reason,
    created_at
FROM public.entity_model_relations
WHERE model_id IS NOT NULL AND relation_type = 'exclude';