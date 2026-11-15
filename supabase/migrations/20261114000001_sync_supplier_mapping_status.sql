-- Atomic sync of supplier mapping + product/variant status
-- Replaces separate client-side UPDATE calls to avoid partial failures

CREATE OR REPLACE FUNCTION public.sync_supplier_mapping_status(
  p_mapping_id uuid,
  p_vendor_product_name text DEFAULT NULL,
  p_vendor_unit_cost numeric DEFAULT NULL,
  p_is_hidden boolean DEFAULT NULL,
  p_variant_status text DEFAULT NULL,
  p_variant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mapping record;
  v_updated_mapping boolean := false;
  v_updated_product boolean := false;
  v_updated_variants int := 0;
BEGIN
  -- 1. Fetch the mapping
  SELECT * INTO v_mapping
  FROM supplier_product_mappings
  WHERE id = p_mapping_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mapping not found');
  END IF;

  -- 2. Update mapping (name/cost)
  UPDATE supplier_product_mappings
  SET
    vendor_product_name = COALESCE(p_vendor_product_name, vendor_product_name),
    vendor_unit_cost = COALESCE(p_vendor_unit_cost, vendor_unit_cost),
    updated_at = now()
  WHERE id = p_mapping_id;
  v_updated_mapping := true;

  -- 3. Update product is_hidden
  IF p_is_hidden IS NOT NULL AND v_mapping.internal_product_id IS NOT NULL THEN
    UPDATE products
    SET is_hidden = p_is_hidden, updated_at = now()
    WHERE id = v_mapping.internal_product_id;
    v_updated_product := true;
  END IF;

  -- 4. Update variant status
  IF p_variant_status IS NOT NULL THEN
    IF p_variant_id IS NOT NULL THEN
      -- Specific variant
      UPDATE product_variants
      SET status = p_variant_status::public.product_status, updated_at = now()
      WHERE id = p_variant_id;
      GET DIAGNOSTICS v_updated_variants = ROW_COUNT;
    ELSIF v_mapping.internal_product_id IS NOT NULL THEN
      -- All variants of the product
      UPDATE product_variants
      SET status = p_variant_status::public.product_status, updated_at = now()
      WHERE product_id = v_mapping.internal_product_id;
      GET DIAGNOSTICS v_updated_variants = ROW_COUNT;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_mapping', v_updated_mapping,
    'updated_product', v_updated_product,
    'updated_variants', v_updated_variants
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_supplier_mapping_status(uuid, text, numeric, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_supplier_mapping_status(uuid, text, numeric, boolean, text, uuid) TO authenticated;
