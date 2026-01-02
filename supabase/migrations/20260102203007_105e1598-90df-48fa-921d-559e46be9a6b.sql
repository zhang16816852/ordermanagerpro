-- 1. 添加 stores 的 brand 欄位
ALTER TABLE public.stores ADD COLUMN brand TEXT;

-- 2. 修改 store_products 表，添加 brand 欄位來取代 store_id 作為價格區分
ALTER TABLE public.store_products ADD COLUMN brand TEXT;

-- 3. 添加 orders 的狀態欄位 (pending = 未確認, processing = 處理中/已鎖定)
CREATE TYPE public.order_status AS ENUM ('pending', 'processing');

ALTER TABLE public.orders ADD COLUMN status public.order_status NOT NULL DEFAULT 'pending';

-- 4. 更新 store_products 的 RLS policies 來支援 brand 查詢
CREATE POLICY "Anyone can view store products by brand" 
ON public.store_products 
FOR SELECT 
USING (true);

-- 5. 添加 brand 的索引提升查詢效能
CREATE INDEX idx_stores_brand ON public.stores(brand);
CREATE INDEX idx_store_products_brand ON public.store_products(brand);

-- 6. 更新訂單 RLS policies - store 端只能修改 pending 狀態的訂單
DROP POLICY IF EXISTS "Store members can update pending orders" ON public.orders;
CREATE POLICY "Store members can update pending orders" 
ON public.orders 
FOR UPDATE 
USING (
  (status = 'pending' AND is_store_member(auth.uid(), store_id)) 
  OR has_role(auth.uid(), 'admin'::system_role)
);

-- 7. 創建用於批次價格設定的函數
CREATE OR REPLACE FUNCTION public.upsert_brand_product_prices(
  p_brand TEXT,
  p_products JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  product_record JSONB;
BEGIN
  FOR product_record IN SELECT * FROM jsonb_array_elements(p_products)
  LOOP
    INSERT INTO public.store_products (brand, product_id, wholesale_price, retail_price)
    VALUES (
      p_brand,
      (product_record->>'product_id')::uuid,
      (product_record->>'wholesale_price')::numeric,
      (product_record->>'retail_price')::numeric
    )
    ON CONFLICT (brand, product_id) 
    WHERE brand IS NOT NULL
    DO UPDATE SET
      wholesale_price = EXCLUDED.wholesale_price,
      retail_price = EXCLUDED.retail_price,
      updated_at = now();
  END LOOP;
END;
$$;

-- 8. 添加 store_products 的 brand + product_id 唯一約束
CREATE UNIQUE INDEX idx_store_products_brand_product 
ON public.store_products(brand, product_id) 
WHERE brand IS NOT NULL;