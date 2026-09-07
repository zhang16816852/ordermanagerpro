-- 20260908000000 purchase_order_items_sort_order
-- 採購單品項排序：新增 sort_order 欄位，既有資料依「變體名稱（無變體回退產品名稱）降冪」為預設，
-- 並提供 reorder_purchase_order_items RPC 供前端拖曳 / 名稱表頭排序後批次持久化。

-- 1. 新增 sort_order 欄位
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill：每張採購單內依 COALESCE(變體名稱, 產品名稱) 降冪排定（tiebreak created_at）
WITH ranked AS (
  SELECT poi.id,
         ROW_NUMBER() OVER (
           PARTITION BY poi.purchase_order_id
           ORDER BY COALESCE(pv.name, p.name) DESC NULLS LAST, poi.created_at ASC
         ) AS rn
  FROM public.purchase_order_items poi
  LEFT JOIN public.product_variants pv ON pv.id = poi.variant_id
  LEFT JOIN public.products p ON p.id = poi.product_id
)
UPDATE public.purchase_order_items poi
SET sort_order = r.rn
FROM ranked r
WHERE r.id = poi.id
  AND poi.sort_order = 0;

-- 3. RPC：批次寫入品項順序（僅 admin）
CREATE OR REPLACE FUNCTION public.reorder_purchase_order_items(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.system_role) THEN
    RAISE EXCEPTION '權限不足：僅管理員可調整採購單品項順序';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items 必須為非空陣列';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE public.purchase_order_items
    SET sort_order = (v_item->>'sort_order')::INT
    WHERE id = (v_item->>'id')::UUID;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_purchase_order_items(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_purchase_order_items(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_purchase_order_items(jsonb) TO authenticated;