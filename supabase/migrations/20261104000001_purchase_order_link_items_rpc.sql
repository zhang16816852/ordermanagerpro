-- 把訂單列表「採購連結」查詢改為 RPC，避免 PostgREST max-rows（預設 1000）截斷 purchase_order_items（全表 1590+ 筆）
-- SECURITY INVOKER：RLS 沿用（僅 admin 可讀 purchase_order_items），存取權限不變
-- 回傳 jsonb 陣列：不受 max-rows 截斷，前端聚合邏輯不變

CREATE OR REPLACE FUNCTION public.get_purchase_order_link_items()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'source_order_ids', poi.source_order_ids,
        'source_quantities', poi.source_quantities,
        'purchase_order_id', poi.purchase_order_id,
        'product_id', poi.product_id,
        'variant_id', poi.variant_id,
        'quantity', poi.quantity,
        'received_quantity', poi.received_quantity,
        'purchase_orders', CASE WHEN po.id IS NULL THEN NULL
          ELSE jsonb_build_object('status', po.status, 'purpose', po.purpose) END
      ) ORDER BY poi.created_at, poi.id
    ),
    '[]'::jsonb
  )
  FROM public.purchase_order_items poi
  LEFT JOIN public.purchase_orders po ON po.id = poi.purchase_order_id;
$$;

REVOKE ALL ON FUNCTION public.get_purchase_order_link_items() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_order_link_items() TO authenticated;
