-- Cleanup + version triggers for product_series_links and brand_series
-- A) Drop obsolete product_series_bindings (superseded by product_series_links)
-- B) Enable RLS on product_series_links
-- C) Add version trigger on product_series_links → bumps 'products'
-- D) Add version trigger on brand_series → bumps 'brand_series'

-- A) Drop old table
DROP TABLE IF EXISTS public.product_series_bindings;

-- B) product_series_links: Enable RLS + policies
ALTER TABLE public.product_series_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users to read product_series_links"
  ON public.product_series_links FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert product_series_links"
  ON public.product_series_links FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update product_series_links"
  ON public.product_series_links FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to delete product_series_links"
  ON public.product_series_links FOR DELETE TO authenticated USING (true);

-- C) product_series_links → bump 'products' version
CREATE TRIGGER trg_bump_products_version_on_series_links
  AFTER INSERT OR UPDATE OR DELETE ON public.product_series_links
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_bump_products_version();

-- D) brand_series → bump 'brand_series' version
--    Seed the data_versions row first
INSERT INTO public.data_versions (table_name, version, last_triggered_by)
VALUES ('brand_series', '0', NULL)
ON CONFLICT (table_name) DO NOTHING;

CREATE OR REPLACE FUNCTION trigger_bump_brand_series_version()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM bump_data_version('brand_series', TG_TABLE_NAME);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_bump_brand_series_version
  AFTER INSERT OR UPDATE OR DELETE ON public.brand_series
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_bump_brand_series_version();
