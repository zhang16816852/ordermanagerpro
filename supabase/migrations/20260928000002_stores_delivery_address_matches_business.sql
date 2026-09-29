-- 店鋪「收件地址同營業地址」勾勾狀態持久化（先前僅存在於前端 state，重新編輯必為未勾）
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS delivery_address_matches_business boolean NOT NULL DEFAULT false;

-- 既有資料回填：配送地址四欄與營業地址四欄全等且非空 → true
-- （空地址店維持 false；地址不同者維持 false）
UPDATE public.stores
SET delivery_address_matches_business = true
WHERE NOT delivery_address_matches_business
  AND COALESCE(address, '') <> ''
  AND COALESCE(postal_code, '')  = COALESCE(business_postal_code, '')
  AND COALESCE(city, '')         = COALESCE(business_city, '')
  AND COALESCE(district, '')     = COALESCE(business_district, '')
  AND COALESCE(address, '')      = COALESCE(business_address, '');
