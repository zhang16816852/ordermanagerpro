CREATE OR REPLACE FUNCTION public.trim_device_model_name()
RETURNS TRIGGER AS $$
BEGIN
  NEW.name = TRIM(NEW.name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trim_device_model_name ON public.device_models;

CREATE TRIGGER trg_trim_device_model_name
  BEFORE INSERT OR UPDATE ON public.device_models
  FOR EACH ROW
  EXECUTE FUNCTION public.trim_device_model_name();
