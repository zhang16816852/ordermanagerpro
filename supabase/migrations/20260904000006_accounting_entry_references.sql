-- 母子單關聯表：一筆母單（accounting_entry）可綁定多張訂單/銷貨單/採購單/維修單
-- entry_id: 母單 id（accounting_entries.id）
-- reference_type: 關聯單據類型（order / sales_note / purchase_order / repair_order）
-- reference_id: 關聯單據 id
-- item_name: 項目名稱（方便顯示）
-- amount_applied: 該筆單據分配到的金額
CREATE TABLE accounting_entry_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES accounting_entries(id) ON DELETE CASCADE,
  reference_type text NOT NULL,
  reference_id uuid NOT NULL,
  item_name text,
  amount_applied numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE accounting_entry_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage entry references"
  ON accounting_entry_references FOR ALL
  USING (auth.role() = 'authenticated');

-- 加速查詢：依 entry_id 查關聯
CREATE INDEX idx_accounting_entry_references_entry_id ON accounting_entry_references(entry_id);
