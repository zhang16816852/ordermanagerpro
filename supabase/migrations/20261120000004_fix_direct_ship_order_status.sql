-- Fix direct_ship_orders: order status should be 'processing' if not all items fully shipped
-- 問題：直接轉銷貨單時，orders.status 硬寫 'shipped'，即使有品項 shipped_quantity < quantity 也標為已出貨
-- 修復：status 改為 CASE WHEN 全部品項 shipped_quantity >= quantity THEN 'shipped' ELSE 'processing'

DO $$
DECLARE
  v_funcdef TEXT;
  v_search TEXT;
  v_replace TEXT;
BEGIN
  SELECT pg_get_functiondef('public.direct_ship_orders(uuid[],uuid,text,timestamptz,uuid,jsonb,jsonb,uuid,numeric,jsonb,text,numeric,text,text,text,jsonb,jsonb)'::regprocedure) INTO v_funcdef;

  v_search := 'SET status = ''shipped'',' || chr(10) || '        delivery_method_id = COALESCE';
  v_replace := 'SET status = CASE WHEN (SELECT bool_and(oi.shipped_quantity >= oi.quantity OR oi.status IN (''cancelled'', ''discontinued'', ''out_of_stock'') OR oi.line_type = ''return'') FROM public.order_items oi WHERE oi.order_id = orders.id) THEN ''shipped''::order_status ELSE ''processing''::order_status END,' || chr(10) || '        delivery_method_id = COALESCE';

  IF position(v_search IN v_funcdef) > 0 THEN
    v_funcdef := replace(v_funcdef, v_search, v_replace);
    EXECUTE v_funcdef;
  END IF;
END $$;