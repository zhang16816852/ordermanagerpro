-- 檢查目前訂單與銷貨單的流水號生成情況
SELECT 'orders' as type, id, code, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5;
SELECT 'sales_notes' as type, id, code, status, created_at FROM sales_notes ORDER BY created_at DESC LIMIT 5;

-- 檢查系統序列狀態
SELECT * FROM system_sequences;
