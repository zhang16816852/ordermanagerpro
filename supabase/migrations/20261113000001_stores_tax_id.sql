-- stores: 新增統一編號 (tax id) 欄位
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS tax_id text;