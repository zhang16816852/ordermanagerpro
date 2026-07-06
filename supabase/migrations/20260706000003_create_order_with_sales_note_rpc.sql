-- Atomic RPC: create order (shipped) + sales note + order items + sales note items in one transaction

CREATE OR REPLACE FUNCTION public.create_order_with_sales_note(
  p_store_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order_id UUID;
  v_order_code TEXT;
  v_sales_note_id UUID;
  v_sales_note_code TEXT;
  v_access_token UUID;
  v_item JSONB;
  v_order_item_id UUID;
  v_result JSONB;
BEGIN
  -- 1. Generate access token
  v_access_token := gen_random_uuid();

  -- 2. Insert order (shipped status)
  INSERT INTO public.orders (store_id, created_by, notes, source_type, status)
  VALUES (p_store_id, p_created_by, p_notes, 'admin_proxy', 'shipped')
  RETURNING id, code INTO v_order_id, v_order_code;

  -- 3. Insert sales note (shipped status)
  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token)
  VALUES (p_store_id, p_created_by, 'shipped', NOW(), p_notes, v_access_token)
  RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

  -- 4. Loop through items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- 4a. Insert order_item
    INSERT INTO public.order_items (
      order_id, product_id, variant_id, store_id,
      quantity, unit_price, selected_model_name,
      shipped_quantity, status
    )
    VALUES (
      v_order_id,
      (v_item->>'product_id')::UUID,
      (v_item->>'variant_id')::UUID,
      p_store_id,
      (v_item->>'quantity')::INTEGER,
      (v_item->>'unit_price')::NUMERIC,
      (v_item->>'selected_model_name'),
      (v_item->>'quantity')::INTEGER,
      'shipped'
    )
    RETURNING id INTO v_order_item_id;

    -- 4b. Insert sales_note_item
    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity)
    VALUES (v_sales_note_id, v_order_item_id, (v_item->>'quantity')::INTEGER);
  END LOOP;

  -- 5. Return result
  v_result := jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'sales_note_id', v_sales_note_id,
    'sales_note_code', v_sales_note_code,
    'access_token', v_access_token
  );

  RETURN v_result;
END;
$$;
