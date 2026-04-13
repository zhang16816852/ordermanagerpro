-- 新增「設備專用」的前綴欄位，避免與產品屬性混淆
ALTER TABLE public.device_models
ADD COLUMN IF NOT EXISTS device_series VARCHAR(100) COMMENT '設備所屬系列 (如: Galaxy S)',
ADD COLUMN IF NOT EXISTS device_remarks TEXT COMMENT '設備補充備註',
ADD COLUMN IF NOT EXISTS release_date VARCHAR(50) COMMENT '出廠年月 (如: 2024-01)';

-- 為了提示選單效能，我們對系列欄位建立索引
CREATE INDEX IF NOT EXISTS idx_device_models_device_series ON public.device_models(device_series);
