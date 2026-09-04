-- 帳戶加幣別欄位，支援多幣別帳戶管理
ALTER TABLE accounts ADD COLUMN currency text NOT NULL DEFAULT 'TWD';
