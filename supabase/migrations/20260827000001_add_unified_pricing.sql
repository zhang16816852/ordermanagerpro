-- 統一價格 (Unified Pricing) 標記
-- 產品勾選「統一價格」後，其所有變體的批發價/零售價被綁定為同一組價格；
-- 連鎖客戶價格（store_products）則以產品層級（variant_id = null）儲存，對所有變體統一生效。

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS unified_pricing BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS unified_wholesale_price NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unified_retail_price NUMERIC DEFAULT 0;

-- 變體寫入時：若所屬產品為統一價，強制價格 = 產品統一價（任何途徑都無法讓變體價格漂移）
CREATE OR REPLACE FUNCTION public.enforce_unified_variant_price()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_unified BOOLEAN;
    v_w NUMERIC;
    v_r NUMERIC;
BEGIN
    SELECT unified_pricing, unified_wholesale_price, unified_retail_price
    INTO v_unified, v_w, v_r
    FROM public.products
    WHERE id = NEW.product_id;

    IF v_unified THEN
        NEW.wholesale_price := COALESCE(v_w, 0);
        NEW.retail_price := COALESCE(v_r, 0);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_unified_variant_price ON public.product_variants;
CREATE TRIGGER trg_enforce_unified_variant_price
    BEFORE INSERT OR UPDATE ON public.product_variants
    FOR EACH ROW
    WHEN (NEW.product_id IS NOT NULL)
    EXECUTE FUNCTION public.enforce_unified_variant_price();

-- 產品切換/修改統一價時，同步所有現有變體價格
CREATE OR REPLACE FUNCTION public.sync_unified_price_to_variants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.unified_pricing = true AND (
        OLD.unified_pricing IS DISTINCT FROM NEW.unified_pricing
        OR OLD.unified_wholesale_price IS DISTINCT FROM NEW.unified_wholesale_price
        OR OLD.unified_retail_price IS DISTINCT FROM NEW.unified_retail_price
    ) THEN
        UPDATE public.product_variants
        SET wholesale_price = COALESCE(NEW.unified_wholesale_price, 0),
            retail_price = COALESCE(NEW.unified_retail_price, 0)
        WHERE product_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_unified_price_to_variants ON public.products;
CREATE TRIGGER trg_sync_unified_price_to_variants
    AFTER UPDATE ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_unified_price_to_variants();
