-- ============================================================
-- 最小權限原則：寄賣資料/操作不再開放給 anon（v1.5.2 安全補強）
-- 背景：
--   1. consignment_order_item_summary view 為 SECURITY DEFINER 且 anon 有
--      SELECT，任何持 anon key 者都可讀全部寄賣資料（含 unit_cost）→ 資料外洩
--   2. 多支寄賣寫入/操作 RPC 對 anon 與 PUBLIC 開放 EXECUTE
-- 修正：
--   1. view 改 security_invoker=true：以呼叫者權限 + RLS 執行
--      （authenticated 內 RLS：admin 全見、門市成員僅見自家 send_to_store；
--      SECURITY DEFINER RPC 以 owner(postgres) 執行仍可全量讀取，不影響既有邏輯）
--   2. 收回 anon/PUBLIC 對 view 的權限，僅 authenticated 有 SELECT
--   3. 收回 anon/PUBLIC 對 14 支寄賣/出貨 RPC 的 EXECUTE，僅 authenticated
--      （門市/後台登入使用者）與 service_role 可執行
-- ============================================================

ALTER VIEW public.consignment_order_item_summary SET (security_invoker = true);
REVOKE ALL ON public.consignment_order_item_summary FROM anon, PUBLIC;
GRANT SELECT ON public.consignment_order_item_summary TO authenticated;

DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'create_consignment_shipment',
    'create_consignment_shipment_layer',
    'reverse_consignment_shipment',
    'direct_ship_order',
    'ship_from_pool',
    'create_order_with_sales_note',
    'confirm_consignment_receipt',
    'report_consignment_sale',
    'report_consignment_sale_by_product',
    'confirm_consignment_sales',
    'return_consignment_items',
    'settle_consignment',
    'receive_consignment_items',
    'allocate_inventory'
  ]
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM anon, PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO authenticated', fn);
  END LOOP;
END $$;
