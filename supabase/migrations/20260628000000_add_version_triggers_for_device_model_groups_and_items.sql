-- 確保 data_versions 有 device_models row (safe upsert)
INSERT INTO public.data_versions (table_name, version)
VALUES ('device_models', '260628-0001')
ON CONFLICT (table_name) DO NOTHING;

-- device_model_groups trigger function
CREATE OR REPLACE FUNCTION public.bump_device_model_groups_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
    PERFORM public.bump_data_version('device_models', 'device_model_groups');
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_model_groups_version ON public.device_model_groups;
CREATE TRIGGER trg_device_model_groups_version
AFTER INSERT OR UPDATE OR DELETE ON public.device_model_groups
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_device_model_groups_version();

-- device_model_group_items trigger function
CREATE OR REPLACE FUNCTION public.bump_device_model_group_items_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
    PERFORM public.bump_data_version('device_models', 'device_model_group_items');
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_model_group_items_version ON public.device_model_group_items;
CREATE TRIGGER trg_device_model_group_items_version
AFTER INSERT OR UPDATE OR DELETE ON public.device_model_group_items
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_device_model_group_items_version();
