-- 確保 data_versions 有這兩個 table 的 row
INSERT INTO public.data_versions (table_name, version) VALUES 
  ('categories', 1),
  ('device_models', 1)
ON CONFLICT DO NOTHING;

-- categories trigger function
CREATE OR REPLACE FUNCTION public.bump_categories_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
    PERFORM public.bump_data_version('categories', 'categories');
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_version ON public.categories;
CREATE TRIGGER trg_categories_version
AFTER INSERT OR UPDATE OR DELETE ON public.categories
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_categories_version();

-- device_models trigger function
CREATE OR REPLACE FUNCTION public.bump_device_models_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
    PERFORM public.bump_data_version('device_models', 'device_models');
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_models_version ON public.device_models;
CREATE TRIGGER trg_device_models_version
AFTER INSERT OR UPDATE OR DELETE ON public.device_models
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_device_models_version();
