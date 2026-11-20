-- Fix direct_ship_orders: order_item status should be 'partial' when shipped_quantity < quantity
-- 問題：直接轉銷貨單時，品項 status 硬寫 'shipped'，即使 shipped_quantity < quantity 也標為已出貨
-- 另外修復：orders 表 status 誤用了 order_item_status 型別，需恢復為 'shipped'（order_status 型別）

DO $$
DECLARE
  v_funcdef TEXT;
  v_search TEXT;
  v_replace TEXT;
BEGIN
  SELECT pg_get_functiondef('public.direct_ship_orders(uuid[],uuid,text,timestamptz,uuid,jsonb,jsonb,uuid,numeric,jsonb,text,numeric,text,text,text,jsonb,jsonb)'::regprocedure) INTO v_funcdef;

  -- Fix 1: Consignment branch - item status should be partial when not fully shipped
  v_funcdef := replace(v_funcdef,
    'SET shipped_quantity = v_item.shipped_quantity + v_remaining_qty,' || chr(10) || '            status = ''shipped'',',
    'SET shipped_quantity = v_item.shipped_quantity + v_remaining_qty,' || chr(10) || '            status = CASE WHEN (v_item.shipped_quantity + v_remaining_qty) >= v_item.quantity THEN ''shipped''::order_item_status ELSE ''partial''::order_item_status END,');

  -- Fix 2: Non-consignment branch - item status should be partial when not fully shipped
  v_search := 'SET shipped_quantity = v_new_shipped_qty,' || chr(10) || '            status = CASE WHEN (v_item.shipped_quantity + v_remaining_qty) >= v_item.quantity THEN ''shipped''::order_item_status ELSE ''partial''::order_item_status END,';
  v_replace := 'SET shipped_quantity = v_new_shipped_qty,' || chr(10) || '            status = CASE WHEN v_new_shipped_qty >= v_item.quantity THEN ''shipped''::order_item_status ELSE ''partial''::order_item_status END,';

  IF position(v_search IN v_funcdef) > 0 THEN
    v_funcdef := replace(v_funcdef, v_search, v_replace);
  END IF;

  -- Fix 3: Orders table status must use order_status type, not order_item_status
  v_search := 'UPDATE public.orders' || chr(10) || '    SET status = CASE WHEN (v_item.shipped_quantity + v_remaining_qty) >= v_item.quantity THEN ''shipped''::order_item_status ELSE ''partial''::order_item_status END,';
  v_replace := 'UPDATE public.orders' || chr(10) || '    SET status = ''shipped'',';

  IF position(v_search IN v_funcdef) > 0 THEN
    v_funcdef := replace(v_funcdef, v_search, v_replace);
  END IF;

  EXECUTE v_funcdef;
END $$;