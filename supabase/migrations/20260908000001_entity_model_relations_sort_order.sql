-- 為 entity_model_relations 新增 sort_order，
-- 讓批次建立變體時「型號/群組的選取順序」可跨對話回合保存。
-- (VariantBatchCreator 於建立 relations 時依選取順序寫入，
--  重新載入時依 sort_order 重建選取順序)

ALTER TABLE public.entity_model_relations
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill：既有資料依「每個實體（product / variant）各自」排列，
-- 模型在前（依 device_models.sort_order）、群組在後（依名稱），
-- 確保重新載入時有穩定且合理的順序。
WITH ranked AS (
    SELECT
        e.id,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(e.product_id, e.variant_id)
            ORDER BY
                CASE WHEN e.group_id IS NOT NULL THEN 1 ELSE 0 END,
                COALESCE(dm.sort_order, 0),
                dm.name,
                g.name,
                e.created_at,
                e.id
        ) - 1 AS rn
    FROM public.entity_model_relations e
    LEFT JOIN public.device_models dm ON dm.id = e.model_id
    LEFT JOIN public.device_model_groups g ON g.id = e.group_id
    WHERE e.relation_type = 'include'
)
UPDATE public.entity_model_relations e
SET sort_order = r.rn
FROM ranked r
WHERE e.id = r.id;