-- 新增設備類型與尺寸爛位到型號庫
ALTER TABLE public.device_models
ADD COLUMN device_type TEXT; -- 例如：手機、平板、主機

ALTER TABLE public.device_models
ADD COLUMN screen_size TEXT; -- 例如：6.1吋、6.7吋
