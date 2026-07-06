-- Update upsert_brand_product_prices to support variant-level pricing
-- Now accepts variant_id in p_products entries

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
  v_variant_id UUID;
  v_updated BOOLEAN;
BEGIN
  FOR product_record IN SELECT * FROM jsonb_array_elements(p_products)
  LOOP
    v_variant_id := (product_record->>'variant_id')::UUID;
    v_updated := false;

    IF v_variant_id IS NOT NULL THEN
      UPDATE public.store_products
      SET wholesale_price = (product_record->>'wholesale_price')::numeric,
          retail_price = COALESCE((product_record->>'retail_price')::numeric, wholesale_price),
          updated_at = now()
      WHERE brand = p_brand
        AND product_id = (product_record->>'product_id')::UUID
        AND variant_id = v_variant_id;

      IF FOUND THEN
        v_updated := true;
      END IF;

      IF NOT v_updated THEN
        INSERT INTO public.store_products (brand, product_id, variant_id, wholesale_price, retail_price)
        VALUES (
          p_brand,
          (product_record->>'product_id')::UUID,
          v_variant_id,
          (product_record->>'wholesale_price')::numeric,
          COALESCE((product_record->>'retail_price')::numeric, (product_record->>'wholesale_price')::numeric)
        );
      END IF;
    ELSE
      UPDATE public.store_products
      SET wholesale_price = (product_record->>'wholesale_price')::numeric,
          retail_price = COALESCE((product_record->>'retail_price')::numeric, wholesale_price),
          updated_at = now()
      WHERE brand = p_brand
        AND product_id = (product_record->>'product_id')::UUID
        AND variant_id IS NULL;

      IF FOUND THEN
        v_updated := true;
      END IF;

      IF NOT v_updated THEN
        INSERT INTO public.store_products (brand, product_id, variant_id, wholesale_price, retail_price)
        VALUES (
          p_brand,
          (product_record->>'product_id')::UUID,
          NULL,
          (product_record->>'wholesale_price')::numeric,
          COALESCE((product_record->>'retail_price')::numeric, (product_record->>'wholesale_price')::numeric)
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;
