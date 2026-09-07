-- 出貨池寫入路徑統一自動指派 sort_order
-- 之前所有 INSERT INTO shipping_pool 的 RPC 皆未寫 sort_order（預設 0），
-- 靠 created_at 當浮動次序。新增 BEFORE INSERT trigger 統一指派
-- 「該店家目前最大 sort_order + 1」，無需逐支 RPC 修改。

-- 1. Backfill 既有資料：每店家依 created_at, id 給定 1..N
WITH ranked AS (
  SELECT id, store_id,
         row_number() OVER (PARTITION BY store_id ORDER BY created_at, id) AS rn
  FROM public.shipping_pool
)
UPDATE public.shipping_pool sp
SET sort_order = ranked.rn
FROM ranked
WHERE sp.id = ranked.id;

-- 2. BEFORE INSERT trigger：未指定（<=0）時自動接在該店家尾端
CREATE OR REPLACE FUNCTION public.shipping_pool_auto_sort_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.sort_order := COALESCE(NEW.sort_order, 0);
  IF NEW.sort_order <= 0 THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1
    INTO NEW.sort_order
    FROM public.shipping_pool
    WHERE store_id = NEW.store_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shipping_pool_auto_sort_order
BEFORE INSERT ON public.shipping_pool
FOR EACH ROW EXECUTE FUNCTION public.shipping_pool_auto_sort_order();