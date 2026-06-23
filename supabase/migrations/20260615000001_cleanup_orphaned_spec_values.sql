-- ==========================================
-- 清理 entity_spec_values 孤兒 & 舊格式殘留
-- 情境：
--   1. 規格類型變更 → 舊值格式不符，soft-delete
--   2. 分類移除規格 → 殘留值不再有用，soft-delete
-- 時間: 2026-06-15
-- ==========================================

-- 1. Trigger: 規格類型變更時自動 soft-delete 相關的 entity_spec_values
CREATE OR REPLACE FUNCTION public.handle_spec_type_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
  IF OLD.type IS DISTINCT FROM NEW.type THEN
    UPDATE entity_spec_values 
    SET deleted_at = NOW(), lifecycle_state = 'deleted'
    WHERE spec_id = NEW.id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spec_type_change ON public.specification_definitions;
CREATE TRIGGER trg_spec_type_change
AFTER UPDATE OF type ON public.specification_definitions
FOR EACH ROW
EXECUTE FUNCTION public.handle_spec_type_change();

-- 2. RPC: 清理分類下已移除規格的殘留值 (讓前端可以呼叫)
CREATE OR REPLACE FUNCTION public.cleanup_category_spec_values(
  p_category_id UUID,
  p_active_spec_ids UUID[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
  UPDATE entity_spec_values 
  SET deleted_at = NOW(), lifecycle_state = 'deleted'
  WHERE category_id = p_category_id
    AND deleted_at IS NULL
    AND (p_active_spec_ids IS NULL OR spec_id <> ALL(p_active_spec_ids));
END;
$$;
