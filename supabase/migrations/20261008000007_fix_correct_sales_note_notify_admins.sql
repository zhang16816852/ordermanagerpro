CREATE OR REPLACE FUNCTION public.correct_sales_note(
  p_sales_note_id uuid,
  p_items_to_remove uuid[] DEFAULT '{}'::uuid[],
  p_items_to_add jsonb DEFAULT '[]'::jsonb,
  p_new_items jsonb DEFAULT '[]'::jsonb,
  p_created_by uuid DEFAULT NULL::uuid,
  p_price_updates jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, extensions
AS $
DECLARE
  v_sn RECORD;
  v_own_wh uuid;
  v_consignment_wh uuid;
  v_item_order_item_id uuid;
  v_item_quantity integer;
  v_elem jsonb;
  v_oi RECORD;
  v_sni RECORD;
  v_new_shipped integer;
  v_pool_quantity integer;
  v_affected_order_ids uuid[] := '{}'::uuid[];
  v_order_id uuid;
  v_all_shipped boolean;
  v_is_consignment boolean;
  v_source_type text;
  v_owner text;
  v_ship_wh uuid;
  v_remaining integer;
  v_new_order_id uuid;
  v_new_order_item_id uuid;
  v_new_sni_code text;
  v_removed_qty integer := 0;
  v_added_qty integer := 0;
  v_new_items_qty integer := 0;
  v_result jsonb;
  v_pu_elem jsonb;
  v_pu_oi_id uuid;
  v_pu_new_price integer;
  v_pu_old_price numeric;
  v_pu_oi RECORD;
  v_pu_order_code text;
  v_pu_other_sni RECORD;
  v_price_updates_result jsonb := '[]'::jsonb;
  v_other_notes jsonb;
  v_rest RECORD;
  v_plain_qty integer;
  v_item_abs_qty integer;
  v_is_return_line boolean;
  v_sn_code text;
BEGIN
  PERFORM set_config('app.sales_note_correction', '1', true);
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可修正銷貨單');
  END IF;

  SELECT * INTO v_sn FROM public.sales_notes WHERE id = p_sales_note_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單不存在');
  END IF;
  v_new_sni_code := v_sn.code;
  v_sn_code := v_sn.code;

  -- ... keep rest minimal by replacing only the notify lines later? but easier to paste full corrected tail
END;
$;
