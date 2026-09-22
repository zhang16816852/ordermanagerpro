-- 店鋪營業地址（與配送/收件地址分開儲存；配送用 recipient/phone/postal_code/city/district/address 維持不變）
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS business_address text,
  ADD COLUMN IF NOT EXISTS business_city text,
  ADD COLUMN IF NOT EXISTS business_district text,
  ADD COLUMN IF NOT EXISTS business_postal_code text;

-- 既有店家：營業地址預設＝原配送地址快照（若未填）
UPDATE public.stores
SET
  business_address = COALESCE(business_address, address),
  business_city = COALESCE(business_city, city),
  business_district = COALESCE(business_district, district),
  business_postal_code = COALESCE(business_postal_code, postal_code)
WHERE business_city IS NULL OR business_address IS NULL;