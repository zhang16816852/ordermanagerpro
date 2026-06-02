-- Consolidate device_model_links, device_model_group_links, device_model_exclusions
-- into a single entity_model_relations table with proper FK constraints.
-- Also drops obsolete product_effective_models_base view.

-- 1. Create the consolidated table
CREATE TABLE IF NOT EXISTS public.entity_model_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
    model_id UUID REFERENCES public.device_models(id) ON DELETE CASCADE,
    group_id UUID REFERENCES public.device_model_groups(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK (relation_type IN ('include', 'exclude')),
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT emr_exactly_one_entity CHECK (
        (product_id IS NOT NULL AND variant_id IS NULL) OR
        (product_id IS NULL AND variant_id IS NOT NULL)
    ),
    CONSTRAINT emr_exactly_one_target CHECK (
        (model_id IS NOT NULL AND group_id IS NULL) OR
        (model_id IS NULL AND group_id IS NOT NULL)
    ),
    CONSTRAINT emr_exclude_no_group CHECK (
        relation_type != 'exclude' OR group_id IS NULL
    )
);

-- 2. Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_emr_product_id ON public.entity_model_relations(product_id);
CREATE INDEX IF NOT EXISTS idx_emr_variant_id ON public.entity_model_relations(variant_id);
CREATE INDEX IF NOT EXISTS idx_emr_model_id ON public.entity_model_relations(model_id);
CREATE INDEX IF NOT EXISTS idx_emr_group_id ON public.entity_model_relations(group_id);
CREATE INDEX IF NOT EXISTS idx_emr_relation_type ON public.entity_model_relations(relation_type);

-- 3. Unique constraints (partial indexes) to replace old per-table unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_emr_product_include_model
    ON public.entity_model_relations(product_id, model_id)
    WHERE product_id IS NOT NULL AND model_id IS NOT NULL AND relation_type = 'include';
CREATE UNIQUE INDEX IF NOT EXISTS idx_emr_variant_include_model
    ON public.entity_model_relations(variant_id, model_id)
    WHERE variant_id IS NOT NULL AND model_id IS NOT NULL AND relation_type = 'include';
CREATE UNIQUE INDEX IF NOT EXISTS idx_emr_product_include_group
    ON public.entity_model_relations(product_id, group_id)
    WHERE product_id IS NOT NULL AND group_id IS NOT NULL AND relation_type = 'include';
CREATE UNIQUE INDEX IF NOT EXISTS idx_emr_variant_include_group
    ON public.entity_model_relations(variant_id, group_id)
    WHERE variant_id IS NOT NULL AND group_id IS NOT NULL AND relation_type = 'include';
CREATE UNIQUE INDEX IF NOT EXISTS idx_emr_product_exclude_model
    ON public.entity_model_relations(product_id, model_id)
    WHERE product_id IS NOT NULL AND model_id IS NOT NULL AND relation_type = 'exclude';
CREATE UNIQUE INDEX IF NOT EXISTS idx_emr_variant_exclude_model
    ON public.entity_model_relations(variant_id, model_id)
    WHERE variant_id IS NOT NULL AND model_id IS NOT NULL AND relation_type = 'exclude';

-- 4. RLS policies
ALTER TABLE public.entity_model_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated full access on entity_model_relations"
    ON public.entity_model_relations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read on entity_model_relations"
    ON public.entity_model_relations FOR SELECT TO anon USING (true);

-- 5. Migrate data from old tables, skipping orphaned references
INSERT INTO public.entity_model_relations (product_id, variant_id, model_id, relation_type, created_at)
SELECT
    CASE WHEN entity_type = 'product' THEN entity_id ELSE NULL END,
    CASE WHEN entity_type = 'variant' THEN entity_id ELSE NULL END,
    model_id,
    'include',
    COALESCE(created_at, now())
FROM public.device_model_links dml
WHERE (dml.entity_type = 'product' AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = dml.entity_id))
   OR (dml.entity_type = 'variant' AND EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id = dml.entity_id));

INSERT INTO public.entity_model_relations (product_id, variant_id, group_id, relation_type, created_at)
SELECT
    CASE WHEN entity_type = 'product' THEN entity_id ELSE NULL END,
    CASE WHEN entity_type = 'variant' THEN entity_id ELSE NULL END,
    group_id,
    'include',
    COALESCE(created_at, now())
FROM public.device_model_group_links dgl
WHERE (dgl.entity_type = 'product' AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = dgl.entity_id))
   OR (dgl.entity_type = 'variant' AND EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id = dgl.entity_id));

INSERT INTO public.entity_model_relations (product_id, variant_id, model_id, relation_type, reason, created_at)
SELECT
    CASE WHEN entity_type = 'product' THEN entity_id ELSE NULL END,
    CASE WHEN entity_type = 'variant' THEN entity_id ELSE NULL END,
    model_id,
    'exclude',
    reason,
    COALESCE(created_at, now())
FROM public.device_model_exclusions de
WHERE (de.entity_type = 'product' AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = de.entity_id))
   OR (de.entity_type = 'variant' AND EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id = de.entity_id));

-- 6. Drop old tables (CASCADE drops dependent view product_effective_models_base)
DROP TABLE IF EXISTS public.device_model_links CASCADE;
DROP TABLE IF EXISTS public.device_model_group_links CASCADE;
DROP TABLE IF EXISTS public.device_model_exclusions CASCADE;

-- 7. Recreate product_effective_models_base as a view over entity_model_relations
-- (was previously dependent on device_model_links, dropped by CASCADE)
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

-- 8. Create backward-compatible views so existing RPCs continue to work
CREATE VIEW public.device_model_links AS
SELECT
    id,
    CASE WHEN product_id IS NOT NULL THEN 'product' ELSE 'variant' END AS entity_type,
    COALESCE(product_id, variant_id) AS entity_id,
    model_id,
    created_at
FROM public.entity_model_relations
WHERE model_id IS NOT NULL AND relation_type = 'include';

CREATE VIEW public.device_model_group_links AS
SELECT
    id,
    CASE WHEN product_id IS NOT NULL THEN 'product' ELSE 'variant' END AS entity_type,
    COALESCE(product_id, variant_id) AS entity_id,
    group_id,
    created_at
FROM public.entity_model_relations
WHERE group_id IS NOT NULL AND relation_type = 'include';

CREATE VIEW public.device_model_exclusions AS
SELECT
    id,
    CASE WHEN product_id IS NOT NULL THEN 'product' ELSE 'variant' END AS entity_type,
    COALESCE(product_id, variant_id) AS entity_id,
    model_id,
    reason,
    created_at
FROM public.entity_model_relations
WHERE model_id IS NOT NULL AND relation_type = 'exclude';
