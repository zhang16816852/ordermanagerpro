-- 1. 移除舊的函數簽章 (避免參數名稱不一致導致 404)
DROP FUNCTION IF EXISTS public.get_shared_order_details(UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_shared_sales_note_details(UUID, TEXT);

-- 2. 建立新的-- 獲取分享訂單詳情 (支援 UUID 或 序號)
CREATE OR REPLACE FUNCTION get_shared_order_details(p_identifier TEXT, p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id UUID;
    v_result JSONB;
BEGIN
    -- 嘗試將識別碼解釋為 UUID (如果是這樣的話)
    BEGIN
        v_order_id := p_identifier::UUID;
    EXCEPTION WHEN OTHERS THEN
        -- 如果不是 UUID，則通過 code 查找 ID
        SELECT id INTO v_order_id FROM public.orders WHERE code = p_identifier;
    END;

    -- 查詢訂單與其項目
    SELECT jsonb_build_object(
        'order', (
            SELECT jsonb_build_object(
                'id', o.id,
                'code', o.code,
                'created_at', o.created_at,
                'status', o.status,
                'notes', o.notes,
                'store_name', s.name
            )
            FROM public.orders o
            JOIN public.stores s ON s.id = o.store_id
            WHERE (o.id = v_order_id OR o.code = p_identifier)
            AND o.access_token = p_token
        ),
        'items', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'product_name', p.name,
                    'variant_name', pv.name,
                    'quantity', oi.quantity,
                    'unit_price', oi.unit_price
                )
            )
            FROM public.order_items oi
            JOIN public.products p ON p.id = oi.product_id
            LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
            WHERE oi.order_id IN (
                SELECT o.id FROM public.orders o 
                WHERE (o.id = v_order_id OR o.code = p_identifier) 
                AND o.access_token = p_token
            )
        )
    ) INTO v_result;

    -- 如果找不到訂單，返回 NULL
    IF (v_result->'order') IS NULL OR (v_result->'order') = 'null'::jsonb THEN
        RETURN NULL;
    END IF;

    RETURN v_result;
END;
$$;

-- 獲取分享出貨單詳情 (支援 UUID 或 序號)
CREATE OR REPLACE FUNCTION get_shared_sales_note_details(p_identifier TEXT, p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uuid_id UUID;
    v_result JSONB;
BEGIN
    -- 嘗試解釋為 UUID
    BEGIN
        v_uuid_id := p_identifier::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_uuid_id := NULL;
    END;

    SELECT jsonb_build_object(
        'sales_note', (
            SELECT jsonb_build_object(
                'id', sn.id,
                'code', sn.code,
                'created_at', sn.created_at,
                'status', sn.status,
                'notes', sn.notes,
                'store_name', s.name,
                'access_token', sn.access_token
            )
            FROM public.sales_notes sn
            JOIN public.stores s ON s.id = sn.store_id
            WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
            AND sn.access_token = p_token
        ),
        'items', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'product_name', p.name,
                    'variant_name', pv.name,
                    'quantity', sni.quantity,
                    'unit_price', oi.unit_price
                )
            )
            FROM public.sales_note_items sni
            JOIN public.order_items oi ON oi.id = sni.order_item_id
            JOIN public.products p ON p.id = oi.product_id
            LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
            WHERE sni.sales_note_id IN (
                SELECT sn.id FROM public.sales_notes sn 
                WHERE (sn.id = v_uuid_id OR sn.code = p_identifier) 
                AND sn.access_token = p_token
            )
        )
    ) INTO v_result;

    IF (v_result->'sales_note') IS NULL OR (v_result->'sales_note') = 'null'::jsonb THEN
        RETURN NULL;
    END IF;

    RETURN v_result;
END;
$$;

-- 重新賦予執行權限
GRANT EXECUTE ON FUNCTION get_shared_order_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_shared_order_details(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_shared_sales_note_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_shared_sales_note_details(TEXT, TEXT) TO authenticated;
