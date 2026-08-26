-- 為 category_spec_links 增加 required 欄位，標記分類規格是否必填
ALTER TABLE category_spec_links ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT false;
