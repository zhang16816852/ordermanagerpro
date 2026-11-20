-- Fix correct_sales_note order status convergence bug
-- 問題：移除品項後，未完全出貨的品項也被標記為 shipped
-- 修復：
-- 1. v_all_shipped 檢查加入 out_of_stock 為「已完成」狀態（與前端 getOrderShipmentStatus 一致）
-- 2. ELSE 降級分支：僅在沒有任何 shipped_quantity > 0 的品項時才降回 processing
--    （避免 status='shipped' 但 shipped_quantity=0 的品項阻止降級）

DO $$
DECLARE
  v_funcdef TEXT;
BEGIN
  SELECT pg_get_functiondef('public.correct_sales_note(uuid,jsonb,jsonb,jsonb,uuid,jsonb)'::regprocedure) INTO v_funcdef;

  -- Fix 1: Add out_of_stock to the v_all_shipped exclusion list
  v_funcdef := replace(v_funcdef,
    'bool_and(oi.shipped_quantity >= oi.quantity OR oi.status IN (''cancelled'', ''discontinued'')',
    'bool_and(oi.shipped_quantity >= oi.quantity OR oi.status IN (''cancelled'', ''discontinued'', ''out_of_stock'')');

  -- Fix 2: In the ELSE branch, only keep shipped if there's at least one item with shipped_quantity > 0
  v_funcdef := replace(v_funcdef,
    'AND (oi2.shipped_quantity > 0 OR oi2.status IN (''shipped'', ''partial''))',
    'AND oi2.shipped_quantity > 0');

  EXECUTE v_funcdef;
END $$;