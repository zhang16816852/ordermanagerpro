-- accounting_entries 加轉帳/跨幣別欄位
-- transfer_to_account_id: 帳戶互轉的目的地帳戶
-- exchange_rate: 匯率（跨幣別轉帳時使用）
-- original_currency: 原始幣別
-- original_amount: 原始金額（轉換前）
ALTER TABLE accounting_entries ADD COLUMN transfer_to_account_id uuid REFERENCES accounts(id);
ALTER TABLE accounting_entries ADD COLUMN exchange_rate numeric;
ALTER TABLE accounting_entries ADD COLUMN original_currency text;
ALTER TABLE accounting_entries ADD COLUMN original_amount numeric;
