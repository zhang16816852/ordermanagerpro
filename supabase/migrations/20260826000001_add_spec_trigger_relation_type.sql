-- 將數量連動 (Model B / per-cable) 合併進 specification_triggers，
-- 以 relation_type 區分：'visibility'（條件觸發）與 'quantity'（數值型來源複製下游 N 份）。
ALTER TABLE specification_triggers ADD COLUMN IF NOT EXISTS relation_type text NOT NULL DEFAULT 'visibility';

-- 將舊欄位 quantity_source_id（儲存於下游規格、指向數值型來源）回填為 quantity 觸發列。
-- 正確方向：source_spec_id = 數值型來源規格、target_spec_id = 被複製的下游規格。
INSERT INTO specification_triggers (source_spec_id, target_spec_id, relation_type, condition_dsl, priority, created_at)
SELECT d.id, d.quantity_source_id, 'quantity', '{}'::jsonb, 0, now()
FROM specification_definitions d
WHERE d.quantity_source_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM specification_triggers st
    WHERE st.source_spec_id = d.id
      AND st.target_spec_id = d.quantity_source_id
      AND st.relation_type = 'quantity'
  );
