-- ============================================================
-- 20260921000006_ship_from_pool_delivery_overrides.sql
-- 物流系統重構 Phase C-4：
--   ship_from_pool 新增 p_delivery_overrides jsonb（末尾 DEFAULT，向後相容）：
--     {
--       "<store_id>": {
--         "address": { recipient, phone, postal_code, city, district, address },
--         "parcels": [
--           { delivery_method_id, fee, cost, tracking_company, tracking_number, tracking_url, note }
--         ]
--       }
--     }
--   * 同一店家（＝同一張銷貨單）可拆多包裹：地址共享（單據層快照）、逐包帶方式/實收/成本/追蹤
--   * 無 override 的店家完全維持既有行為（全局 p_delivery_method_id/fee/address → 1 包）
--   * 純寄賣店家（無銷貨單、走 layer）：override 僅取首包的方式/fee/address 帶入 layer
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.ship_from_pool(
  p_store_ids uuid[],
  p_created_by uuid,
  p_notes text DEFAULT NULL,
  p_shipped_at timestamptz DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_warehouse_map jsonb DEFAULT '{}'::jsonb,
  p_source_map jsonb DEFAULT '{}'::jsonb,
  p_consignment_override_map jsonb DEFAULT '{}'::jsonb,
  p_delivery_method_id uuid DEFAULT NULL,
  p_shipping_fee numeric DEFAULT NULL,
  p_shipping_address jsonb DEFAULT NULL,
  p_delivery_overrides jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $function$
DECLARE
  v_store_id UUID;
  v_sales_note_id UUID;
  v_sales_note_code TEXT;
  v_access_token UUID;
  v_item RECORD;
  v_new_shipped_qty INTEGER;
  v_new_status public.order_item_status;
  v_affected_order_ids UUID[] := '{}';
  v_order_id UUID;
  v_all_shipped BOOLEAN;
  v_result JSONB;
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_source TEXT;
  v_is_consignment BOOLEAN;
  v_shipped_at TIMESTAMPTZ;
  v_consignment_items JSONB := '[]'::JSONB;
  v_sort_counter INTEGER;
  v_m_fee NUMERIC;
  v_m_cost NUMERIC;
  v_m_title TEXT;
  v_m_code TEXT;
  v_override JSONB;
  v_override_addr JSONB;
  v_override_parcels JSONB := '[]'::JSONB;
  v_parcel JSONB;
  v_o_dm_id UUID;
  v_o_fee NUMERIC;
  v_o_cost NUMERIC;
  v_o_tracking_co TEXT;
  v_o_tracking_no TEXT;
  v_o_tracking_url TEXT;
  v_o_note TEXT;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  IF p_delivery_method_id IS NOT NULL THEN
    SELECT name, code, price, cost INTO v_m_title, v_m_code, v_m_fee, v_m_cost
    FROM public.delivery_methods WHERE id = p_delivery_method_id AND is_active;
    IF v_m_title IS NULL THEN
      RAISE EXCEPTION '配送方式不存在或已停用（id %）', p_delivery_method_id;
    END IF;
  END IF;

  v_result := '[]'::JSONB;

  FOR v_store_id IN SELECT unnest(p_store_ids) LOOP
    v_sales_note_id := NULL;
    v_sales_note_code := NULL;
    v_access_token := NULL;
    v_consignment_items := '[]'::JSONB;
    v_sort_counter := 0;
    v_override := NULL;
    v_override_parcels := '[]'::JSONB;

    IF p_delivery_overrides IS NOT NULL AND jsonb_typeof(p_delivery_overrides) = 'object' THEN
      v_override := p_delivery_overrides -> v_store_id::text;
      IF jsonb_typeof(v_override) <> 'object' THEN
        v_override := NULL;
      ELSE
        v_override_addr := v_override -> 'address';
        v_override_parcels := v_override -> 'parcels';
        IF jsonb_typeof(v_override_parcels) <> 'array' OR jsonb_array_length(v_override_parcels) = 0 THEN
          v_override_parcels := '[]'::JSONB;
        END IF;
      END IF;
    END IF;

    FOR v_item IN
      SELECT sp.id AS pool_id, sp.order_item_id, sp.quantity, sp.store_id,
             sp.warehouse_id AS pool_warehouse_id, sp.sort_order AS pool_sort_order,
             oi.quantity AS total_qty, oi.shipped_quantity AS current_shipped,
             oi.order_id, oi.product_id, oi.variant_id, oi.unit_price,
             oo.consignment_mode
      FROM public.shipping_pool sp
      JOIN public.order_items oi ON oi.id = sp.order_item_id
      JOIN public.orders oo ON oo.id = oi.order_id
      WHERE sp.store_id = v_store_id
      ORDER BY sp.sort_order, sp.created_at
    LOOP
      v_item_warehouse_id := COALESCE(
        v_item.pool_warehouse_id,
        (p_warehouse_map->>v_item.order_item_id::TEXT)::UUID,
        v_default_warehouse_id
      );
      v_source := COALESCE(p_source_map->>v_item.order_item_id::TEXT, 'self');

      v_is_consignment := CASE
        WHEN p_consignment_override_map ? v_item.order_item_id::TEXT
          THEN COALESCE((p_consignment_override_map->>v_item.order_item_id::TEXT)::BOOLEAN, v_item.consignment_mode)
        ELSE v_item.consignment_mode
      END;

      IF v_item.quantity > v_item.total_qty - v_item.current_shipped THEN
        RAISE EXCEPTION '出貨池品項 % 欲出貨 % 件，但訂單尚未出貨僅剩 % 件（shipped_quantity 已 %/%）',
          v_item.order_item_id, v_item.quantity, v_item.total_qty - v_item.current_shipped,
          v_item.current_shipped, v_item.total_qty;
      END IF;

      IF v_is_consignment THEN
        v_consignment_items := v_consignment_items || jsonb_build_object(
          'order_item_id', v_item.order_item_id,
          'quantity', v_item.quantity
        );
      ELSE
        IF v_sales_note_id IS NULL THEN
          v_access_token := gen_random_uuid();

          INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
          VALUES (v_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_default_warehouse_id)
          RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

          -- 配送：每張銷貨單產 1 包（僅在銷售單建立時）
          IF jsonb_array_length(v_override_parcels) > 0 THEN
            -- override：逐包建立（多包裹共享單據地址）
            FOR v_parcel IN SELECT * FROM jsonb_array_elements(v_override_parcels) LOOP
              v_o_dm_id := NULLIF(v_parcel->>'delivery_method_id', '')::UUID;
              IF v_o_dm_id IS NULL THEN
                CONTINUE; -- 該包未選方式＝不建立
              END IF;
              v_o_fee := NULLIF(v_parcel->>'fee', '')::NUMERIC;
              v_o_cost := NULLIF(v_parcel->>'cost', '')::NUMERIC;
              v_o_tracking_co := NULLIF(v_parcel->>'tracking_company', '');
              v_o_tracking_no := NULLIF(v_parcel->>'tracking_number', '');
              v_o_tracking_url := NULLIF(v_parcel->>'tracking_url', '');
              v_o_note := NULLIF(v_parcel->>'note', '');
              PERFORM public.upsert_shipment(
                'sales_note', v_sales_note_id, v_o_dm_id, v_o_fee, v_o_cost,
                'one_time', v_o_tracking_co, v_o_tracking_no, v_o_tracking_url,
                v_shipped_at, COALESCE(v_o_note, p_notes), p_created_by, NULL
              );
            END LOOP;
            IF jsonb_typeof(v_override_addr) = 'object' AND (v_override_addr->>'city') IS NOT NULL THEN
              UPDATE public.sales_notes
              SET shipping_address = v_override_addr, updated_at = NOW()
              WHERE id = v_sales_note_id;
            END IF;
          ELSIF p_delivery_method_id IS NOT NULL THEN
            PERFORM public.upsert_shipment(
              'sales_note', v_sales_note_id, p_delivery_method_id, p_shipping_fee, NULL,
              'one_time', NULL, NULL, NULL, v_shipped_at, p_notes, p_created_by, NULL
            );
          END IF;
        END IF;

        v_sort_counter := v_sort_counter + 1;

        INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type, sort_order)
        VALUES (v_sales_note_id, v_item.order_item_id, v_item.quantity, v_source, v_sort_counter);

        IF v_source = 'self' THEN
          INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, order_item_id, reference_code, created_by)
          VALUES (v_item.product_id, v_item.variant_id, v_item_warehouse_id, -v_item.quantity, 'sales_shipment', v_sales_note_id, v_item.order_item_id, v_sales_note_code, p_created_by);
        ELSE
          PERFORM public.allocate_inventory(
            v_item.product_id, v_item.variant_id, v_item.quantity, v_source, NULL,
            v_sales_note_id, v_item.order_item_id, v_sales_note_code, v_item.unit_price, p_created_by
          );
        END IF;
      END IF;

      v_new_shipped_qty := v_item.current_shipped + v_item.quantity;
      IF v_new_shipped_qty >= v_item.total_qty THEN
        v_new_status := 'shipped';
      ELSIF v_new_shipped_qty > 0 THEN
        v_new_status := 'partial';
      ELSE
        v_new_status := 'waiting';
      END IF;

      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped_qty, status = v_new_status, updated_at = NOW()
      WHERE id = v_item.order_item_id;

      IF NOT (v_item.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_item.order_id);
      END IF;

      INSERT INTO public.audit_logs (entity_type, entity_id, action, performed_by, store_id, old_value, new_value)
      VALUES ('order_item', v_item.order_item_id, 'shipped_quantity_updated', p_created_by, v_store_id,
        jsonb_build_object('shipped_quantity', v_item.current_shipped),
        jsonb_build_object('shipped_quantity', v_new_shipped_qty, 'status', v_new_status::text));
    END LOOP;

    DELETE FROM public.shipping_pool WHERE store_id = v_store_id;

    IF jsonb_array_length(v_consignment_items) > 0 THEN
      -- 純寄賣店家：override 存在時取首包的方式/fee/address 帶入 layer（寄賣層維持 1 包）
      IF jsonb_array_length(v_override_parcels) > 0 THEN
        v_o_dm_id := NULLIF(v_override_parcels->0->>'delivery_method_id', '')::UUID;
        v_o_fee := NULLIF(v_override_parcels->0->>'fee', '')::NUMERIC;
        PERFORM public.create_consignment_shipment_layer(
          v_store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes,
          v_default_warehouse_id, v_o_dm_id, v_o_fee, v_override_addr
        );
      ELSE
        PERFORM public.create_consignment_shipment_layer(
          v_store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes,
          v_default_warehouse_id, p_delivery_method_id, p_shipping_fee, p_shipping_address
        );
      END IF;
    END IF;

    v_result := v_result || jsonb_build_object(
      'store_id', v_store_id,
      'sales_note_id', v_sales_note_id,
      'sales_note_code', v_sales_note_code,
      'access_token', v_access_token
    );
  END LOOP;

  FOREACH v_order_id IN ARRAY v_affected_order_ids LOOP
    SELECT bool_and(oi.shipped_quantity >= oi.quantity OR oi.status IN ('cancelled', 'discontinued'))
    INTO v_all_shipped
    FROM public.order_items oi
    WHERE oi.order_id = v_order_id;

    IF v_all_shipped THEN
      UPDATE public.orders SET status = 'shipped' WHERE id = v_order_id;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;

COMMIT;