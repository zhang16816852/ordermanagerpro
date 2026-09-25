-- stores.default_delivery_type：店家預設配送類型（delivery / logistics / pickup）
-- 供出貨 Dialog 開啟時繼承（DirectShipDialog / 寄賣 ShipDialog）與配送共享 hook 讀取
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS default_delivery_type text;

-- 回填：依既有 default_delivery_method_id join delivery_methods.type
UPDATE public.stores s
SET default_delivery_type = dm.type
FROM public.delivery_methods dm
WHERE s.default_delivery_type IS NULL
  AND s.default_delivery_method_id IS NOT NULL
  AND dm.id = s.default_delivery_method_id;

COMMENT ON COLUMN public.stores.default_delivery_type IS
  '店家預設配送類型（delivery=送貨/logistics=物流/pickup=自取），供出貨流程繼承；與 default_delivery_method_id 並存，前者優先';

GRANT SELECT (default_delivery_type) ON public.stores TO authenticated;