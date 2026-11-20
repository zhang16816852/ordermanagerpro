-- 移除維修零件標籤系統（與 spec_values 重複，2026-11-20）
DROP TABLE IF EXISTS public.repair_part_tags CASCADE;
ALTER TABLE public.repair_parts DROP COLUMN IF EXISTS tags;