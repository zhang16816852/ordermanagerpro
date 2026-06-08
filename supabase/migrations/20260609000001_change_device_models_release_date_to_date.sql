ALTER TABLE public.device_models 
ALTER COLUMN release_date TYPE DATE 
USING CASE 
  WHEN release_date ~ '^\d{4}-\d{2}$' THEN 
    (release_date || '-01')::DATE
  ELSE NULL
END;
