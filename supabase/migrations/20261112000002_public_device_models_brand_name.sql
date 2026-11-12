-- get_public_device_models 補回 brand_name（避免前台顯示 UUID）
DROP FUNCTION IF EXISTS public.get_public_device_models();
CREATE OR REPLACE FUNCTION public.get_public_device_models()
RETURNS TABLE (
  id            uuid,
  name          text,
  brand_id      uuid,
  brand_name    text,
  product_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    dm.id,
    dm.name,
    dm.brand_id,
    db.name AS brand_name,
    COUNT(DISTINCT si.product_id) AS product_count
  FROM public.device_models dm
  LEFT JOIN public.device_brands db ON db.id = dm.brand_id
  JOIN public.storefront_items si ON si.model_id = dm.id
  JOIN public.products p ON p.id = si.product_id
  WHERE si.status = 'active'
    AND NOT p.is_hidden
    AND p.item_type = 'product'
    AND dm.is_active = true
  GROUP BY dm.id, dm.name, dm.brand_id, db.name
  ORDER BY dm.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_device_models() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_device_models() TO anon, authenticated;
