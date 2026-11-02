-- product_variants.wholesale_price / retail_price 為 NOT NULL DEFAULT 0。
-- 前端/REST 直接 upsert 時若送 null（例如 Excel 匯入空格）會觸發 23502。
-- 加 BEFORE INSERT/UPDATE trigger，把 null 自動 COALESCE 為 0，作為最後一道安全網。
CREATE OR REPLACE FUNCTION public.trgfn_coalesce_variant_prices()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.wholesale_price := COALESCE(NEW.wholesale_price, 0);
  NEW.retail_price := COALESCE(NEW.retail_price, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coalesce_variant_prices ON public.product_variants;
CREATE TRIGGER trg_coalesce_variant_prices
BEFORE INSERT OR UPDATE ON public.product_variants
FOR EACH ROW
EXECUTE FUNCTION public.trgfn_coalesce_variant_prices();