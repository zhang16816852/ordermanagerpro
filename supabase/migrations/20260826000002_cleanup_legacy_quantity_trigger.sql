-- 移除與 quantity 複製重疊的 visibility 觸發（N+1 防呆）。
-- 若同一 (source, target) 已存在 relation_type='quantity' 的觸發，則刪除同對的 visibility 觸發，
-- 避免數量複製已負責複製 N 份時，又被一筆 on_value='*' 的 visibility 觸發額外帶出一份。
DELETE FROM specification_triggers t
WHERE t.relation_type = 'visibility'
  AND EXISTS (
    SELECT 1 FROM specification_triggers q
    WHERE q.relation_type = 'quantity'
      AND q.source_spec_id = t.source_spec_id
      AND q.target_spec_id = t.target_spec_id
  );
