-- 收斂危險商業 RPC 的 anon/PUBLIC EXECUTE 權限
-- 這些函式皆為 SECURITY DEFINER 且無內部守門，anon 持有 anon key 即可直接呼叫
-- 逐一移除 anon/PUBLIC 的 EXECUTE，並授權給 authenticated（登入後的前端呼叫不受影響）
-- 刻意保留 anon 可用者（分享連結、RLS helper、trigger/版本內部函式）不在本清單內

DO $$
DECLARE
    r record;
    v_names text[] := ARRAY[
        'adjust_inventory',
        'delete_sales_note',
        'duplicate_product_with_variants',
        'import_product_batch',
        'receive_purchase_items',
        'recalculate_inventory',
        'upsert_brand_product_prices',
        'upsert_store_products_batch',
        'sync_product_specs_v6',
        'sync_storefront_items',
        'migrate_historical_specs_to_v6',
        'cleanup_category_spec_values',
        'cleanup_expired_invitations',
        'accept_invitation',
        'bind_user_to_store'
    ];
BEGIN
    FOR r IN
        SELECT p.oid
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname = ANY(v_names)
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', r.oid::regprocedure::text);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.oid::regprocedure::text);
    END LOOP;
END $$;
