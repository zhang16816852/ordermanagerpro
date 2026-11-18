-- 維修零件版本 + 分類 flag
-- 1. repair_parts 新增 version 欄位（自由文字，如 a版、b版、dtp、c3f）
-- 2. categories 新增 is_repair_part flag（標記維修零件分類）

ALTER TABLE public.repair_parts
  ADD COLUMN IF NOT EXISTS version text;

COMMENT ON COLUMN public.repair_parts.version IS '零件版本號（自由文字，如 a版、b版、dtp、c3f），NULL = 無版本區分';

-- categories 加 is_repair_part flag
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_repair_part boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.categories.is_repair_part IS '是否為維修零件分類（true = 維修零件專用分類）';

-- 索引：方便篩選維修零件分類
CREATE INDEX IF NOT EXISTS idx_categories_is_repair_part
  ON public.categories (is_repair_part) WHERE is_repair_part = true;

-- 索引：方便按版本搜尋
CREATE INDEX IF NOT EXISTS idx_repair_parts_version
  ON public.repair_parts (version) WHERE version IS NOT NULL;