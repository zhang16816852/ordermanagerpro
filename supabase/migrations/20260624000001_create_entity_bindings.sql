-- Migration: Product Binding (實體商品綁定同步)
-- 允許 product ↔ product 及 variant ↔ variant 之間建立直接綁定關係
-- 規格值、價格、型號關聯、分類會透過 DB Trigger 自動同步

-- 1. 建立 entity_bindings 表
CREATE TABLE IF NOT EXISTS public.entity_bindings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    binding_type      TEXT NOT NULL CHECK (binding_type IN ('product', 'variant')),
    product_id        UUID REFERENCES public.products(id) ON DELETE CASCADE,
    variant_id        UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
    bound_product_id  UUID REFERENCES public.products(id) ON DELETE CASCADE,
    bound_variant_id  UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_source CHECK (
        (binding_type = 'product' AND product_id IS NOT NULL AND variant_id IS NULL) OR
        (binding_type = 'variant' AND product_id IS NULL AND variant_id IS NOT NULL)
    ),
    CONSTRAINT chk_bound CHECK (
        (binding_type = 'product' AND bound_product_id IS NOT NULL AND bound_variant_id IS NULL) OR
        (binding_type = 'variant' AND bound_product_id IS NULL AND bound_variant_id IS NOT NULL)
    ),
    CONSTRAINT chk_not_self CHECK (
        COALESCE(product_id::text, variant_id::text) !=
        COALESCE(bound_product_id::text, bound_variant_id::text)
    )
);

CREATE INDEX IF NOT EXISTS idx_eb_product_id ON public.entity_bindings(product_id);
CREATE INDEX IF NOT EXISTS idx_eb_bound_product_id ON public.entity_bindings(bound_product_id);
CREATE INDEX IF NOT EXISTS idx_eb_variant_id ON public.entity_bindings(variant_id);
CREATE INDEX IF NOT EXISTS idx_eb_bound_variant_id ON public.entity_bindings(bound_variant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eb_product_unique
  ON public.entity_bindings(
    LEAST(COALESCE(product_id, '00000000-0000-0000-0000-000000000000'), COALESCE(bound_product_id, '00000000-0000-0000-0000-000000000000')),
    GREATEST(COALESCE(product_id, '00000000-0000-0000-0000-000000000000'), COALESCE(bound_product_id, '00000000-0000-0000-0000-000000000000'))
  ) WHERE binding_type = 'product';

CREATE UNIQUE INDEX IF NOT EXISTS idx_eb_variant_unique
  ON public.entity_bindings(
    LEAST(COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'), COALESCE(bound_variant_id, '00000000-0000-0000-0000-000000000000')),
    GREATEST(COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'), COALESCE(bound_variant_id, '00000000-0000-0000-0000-000000000000'))
  ) WHERE binding_type = 'variant';

-- 2. 輔助函數：遞迴找出所有連通產品 (避免 A→B→C 需間接更新)
CREATE OR REPLACE FUNCTION public.get_bound_product_ids(p_product_id UUID)
RETURNS UUID[] AS $$
DECLARE
    v_result UUID[];
BEGIN
    WITH RECURSIVE chain AS (
        SELECT 
            CASE WHEN product_id = p_product_id THEN bound_product_id ELSE product_id END AS node_id,
            1 AS depth
        FROM public.entity_bindings
        WHERE binding_type = 'product'
          AND (product_id = p_product_id OR bound_product_id = p_product_id)
        
        UNION
        
        SELECT 
            CASE WHEN eb.product_id = c.node_id THEN eb.bound_product_id ELSE eb.product_id END,
            c.depth + 1
        FROM chain c
        JOIN public.entity_bindings eb ON eb.binding_type = 'product'
          AND (eb.product_id = c.node_id OR eb.bound_product_id = c.node_id)
        WHERE c.depth < 20
    )
    SELECT array_agg(DISTINCT node_id) INTO v_result
    FROM chain
    WHERE node_id IS NOT NULL AND node_id != p_product_id;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. Trigger: 價格同步 (products.base_wholesale_price / base_retail_price)
CREATE OR REPLACE FUNCTION public.trgfn_sync_product_prices()
RETURNS TRIGGER AS $$
DECLARE
    v_ids UUID[];
BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
    IF NOT (OLD.base_wholesale_price IS DISTINCT FROM NEW.base_wholesale_price
         OR OLD.base_retail_price IS DISTINCT FROM NEW.base_retail_price)
    THEN RETURN NEW; END IF;

    v_ids := public.get_bound_product_ids(NEW.id);
    IF v_ids IS NOT NULL THEN
        UPDATE public.products SET
            base_wholesale_price = NEW.base_wholesale_price,
            base_retail_price = NEW.base_retail_price,
            updated_at = now()
        WHERE id = ANY(v_ids);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_product_prices ON public.products;
CREATE TRIGGER trg_sync_product_prices
    AFTER UPDATE OF base_wholesale_price, base_retail_price ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.trgfn_sync_product_prices();

-- 4. Trigger: 規格值同步 (entity_spec_values)
CREATE OR REPLACE FUNCTION public.trgfn_sync_spec_values()
RETURNS TRIGGER AS $$
DECLARE
    v_ids UUID[];
    v_eid UUID;
BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;

    v_eid := COALESCE(NEW.entity_id, OLD.entity_id);
    IF COALESCE(NEW.entity_type, OLD.entity_type) != 'product' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    v_ids := public.get_bound_product_ids(v_eid);

    IF v_ids IS NOT NULL THEN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            DELETE FROM public.entity_spec_values
            WHERE entity_id = ANY(v_ids)
              AND entity_type = 'product'
              AND spec_id = NEW.spec_id
              AND category_id = NEW.category_id
              AND COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
                  = COALESCE(NEW.parent_id, '00000000-0000-0000-0000-000000000000')
              AND instance_uuid = NEW.instance_uuid;

            INSERT INTO public.entity_spec_values
                (entity_id, entity_type, spec_id, category_id, value,
                 parent_id, instance_uuid, is_inherited, origin_entity_id,
                 lifecycle_state, display_order)
            SELECT
                unnest(v_ids), 'product', NEW.spec_id, NEW.category_id, NEW.value,
                NEW.parent_id, NEW.instance_uuid, NEW.is_inherited, NEW.origin_entity_id,
                NEW.lifecycle_state, NEW.display_order;
        ELSIF TG_OP = 'DELETE' THEN
            DELETE FROM public.entity_spec_values
            WHERE entity_id = ANY(v_ids)
              AND entity_type = 'product'
              AND spec_id = OLD.spec_id
              AND category_id = OLD.category_id
              AND COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
                  = COALESCE(OLD.parent_id, '00000000-0000-0000-0000-000000000000')
              AND instance_uuid = OLD.instance_uuid;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_spec_values ON public.entity_spec_values;
CREATE TRIGGER trg_sync_spec_values
    AFTER INSERT OR UPDATE OR DELETE ON public.entity_spec_values
    FOR EACH ROW EXECUTE FUNCTION public.trgfn_sync_spec_values();

-- 5. Trigger: 型號關聯同步 (entity_model_relations)
CREATE OR REPLACE FUNCTION public.trgfn_sync_model_relations()
RETURNS TRIGGER AS $$
DECLARE
    v_ids UUID[];
    v_eid UUID;
BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;

    v_eid := COALESCE(NEW.product_id, OLD.product_id);
    IF v_eid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;  -- variant-level, skip

    v_ids := public.get_bound_product_ids(v_eid);

    IF v_ids IS NOT NULL THEN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            INSERT INTO public.entity_model_relations
                (product_id, model_id, group_id, relation_type, reason)
            SELECT unnest(v_ids), NEW.model_id, NEW.group_id, NEW.relation_type, NEW.reason
            ON CONFLICT DO NOTHING;
        ELSIF TG_OP = 'DELETE' THEN
            DELETE FROM public.entity_model_relations
            WHERE product_id = ANY(v_ids)
              AND model_id IS NOT DISTINCT FROM OLD.model_id
              AND group_id IS NOT DISTINCT FROM OLD.group_id
              AND relation_type = OLD.relation_type;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_model_relations ON public.entity_model_relations;
CREATE TRIGGER trg_sync_model_relations
    AFTER INSERT OR UPDATE OR DELETE ON public.entity_model_relations
    FOR EACH ROW EXECUTE FUNCTION public.trgfn_sync_model_relations();

-- 6. Trigger: 分類同步 (product_category_links)
CREATE OR REPLACE FUNCTION public.trgfn_sync_category_links()
RETURNS TRIGGER AS $$
DECLARE
    v_ids UUID[];
BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;

    v_ids := public.get_bound_product_ids(COALESCE(NEW.product_id, OLD.product_id));

    IF v_ids IS NOT NULL THEN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            INSERT INTO public.product_category_links (product_id, category_id)
            SELECT unnest(v_ids), COALESCE(NEW.category_id, OLD.category_id)
            ON CONFLICT DO NOTHING;
        ELSIF TG_OP = 'DELETE' THEN
            DELETE FROM public.product_category_links
            WHERE product_id = ANY(v_ids)
              AND category_id = OLD.category_id;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_category_links ON public.product_category_links;
CREATE TRIGGER trg_sync_category_links
    AFTER INSERT OR UPDATE OR DELETE ON public.product_category_links
    FOR EACH ROW EXECUTE FUNCTION public.trgfn_sync_category_links();

-- 7. RLS
ALTER TABLE public.entity_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated full access on entity_bindings"
    ON public.entity_bindings FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow public read on entity_bindings"
    ON public.entity_bindings FOR SELECT
    TO anon
    USING (true);
