-- ============================================================
-- 20261007000001_correct_sales_note_allow_return_add.sql
-- correct_sales_note 允許把訂單退貨列（line_type='return'）追加進銷貨單：
--   移除原本 Phase 2 的 '退貨列不可追加至銷貨單' RAISE。
--   退貨列追加＝sni 以負數量（-v_item_quantity）＋ inventory_source_type='self' 寫入，
--   並以 _receive_return_to_stock 把退貨量回補自有倉（customer_return movement），
--   鏡像 ship_from_pool（20260924000008 L766-777）的退貨出貨分支。
--   寄賣路徑（consignment_mode=true）對退貨列仍 RAISE（與 ship_from_pool L776 一致）。
--   order_items 同步：return_status pending→'stock'、line_note 併接 '退貨出貨入庫'、
--   shipped_quantity 正向遞增＋status CASE（與 ship_from_pool L797-814 一致）。
-- 底本為 20260924000010_correct_sales_note_downgrade.sql（簽名/權限/其餘 Phase 全數不變）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.correct_sales_note(
  p_sales_note_id UUID,
  p_items_to_remove UUID[] DEFAULT '{}',
  p_items_to_add JSONB DEFAULT '[]',
  p_new_items JSONB DEFAULT '[]',
  p_created_by UUID DEFAULT NULL,
  p_price_updates JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_sn RECORD;
  v_own_wh UUID;
  v_consignment_wh UUID;
  v_item_order_item_id UUID;
  v_item_quantity INTEGER;
  v_elem JSONB;
  v_oi RECORD;
  v_sni RECORD;
  v_new_shipped INTEGER;
  v_pool_quantity INTEGER;
  v_affected_order_ids UUID[] := '{}';
  v_order_id UUID;
  v_all_shipped BOOLEAN;
  v_is_consignment BOOLEAN;
  v_source_type TEXT;
  v_owner TEXT;
  v_ship_wh UUID;
  v_remaining INTEGER;
  v_new_order_id UUID;
  v_new_order_item_id UUID;
  v_new_sni_code TEXT;
  v_removed_qty INTEGER := 0;
  v_added_qty INTEGER := 0;
  v_new_items_qty INTEGER := 0;
  v_result JSONB;
  v_pu_elem JSONB;
  v_pu_oi_id UUID;
  v_pu_new_price INTEGER;
  v_pu_old_price NUMERIC;
  v_pu_oi RECORD;
  v_pu_order_code TEXT;
  v_pu_other_sni RECORD;
  v_price_updates_result JSONB := '[]'::JSONB;
  v_other_notes JSONB;
  v_rest RECORD;
  v_plain_qty INTEGER;
  v_item_abs_qty INTEGER;
  v_is_return_line BOOLEAN;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可修正銷貨單');
  END IF;

  SELECT * INTO v_sn FROM public.sales_notes WHERE id = p_sales_note_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單不存在');
  END IF;
  v_new_sni_code := v_sn.code;

  IF v_sn.status = 'received' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單已收貨，無法修正', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'sales_note', 'label', '已收貨狀態')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounting_entries ae
    WHERE ae.reference_type = 'sales_note' AND ae.reference_id = p_sales_note_id
    UNION
    SELECT 1 FROM public.accounting_entry_references aer
    WHERE aer.reference_type = 'sales_note' AND aer.reference_id = p_sales_note_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單已有會計分錄（如收款），請先至會計模組回退/刪除分錄', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'accounting', 'label', '會計分錄（收款）')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rep_commission_payouts rcp WHERE rcp.sales_note_id = p_sales_note_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單已完成業務佣金發放（或已登記），請先撤銷發放', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'rep_payout', 'label', '業務佣金發放')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consignment_sales cs WHERE cs.sales_note_id = p_sales_note_id AND NOT cs.reversed
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單為寄賣確認銷售產生的收款單，請由寄賣流程反向處理', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'consignment_sale', 'label', '寄賣確認銷售')));
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  SELECT id INTO v_consignment_wh FROM public.warehouses WHERE code = 'supplier_consignment';

  -- Phase 1: 移除
  IF p_items_to_remove IS NOT NULL AND array_length(p_items_to_remove, 1) > 0 THEN
    FOREACH v_item_order_item_id IN ARRAY p_items_to_remove LOOP
      SELECT * INTO v_sni FROM public.sales_note_items WHERE id = v_item_order_item_id AND sales_note_id = p_sales_note_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION '要移除的品項不存在於此銷貨單';
      END IF;

      SELECT * INTO v_oi FROM public.order_items WHERE id = v_sni.order_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION '品項對應的訂單項目不存在（資料異常）';
      END IF;

      v_is_consignment := v_sni.inventory_source_type IN ('supplier_consignment', 'store_consignment');
      v_item_abs_qty := ABS(v_sni.quantity);
      v_is_return_line := (v_oi.line_type = 'return');

      -- 批次還原資料：在 DELETE 出貨 movements 前先讀取批次+倉位分佈
      IF NOT v_is_consignment THEN
        IF v_is_return_line THEN
          -- 退貨列：庫存逆轉＝扣回 abs（customer_return 回補反向）
          PERFORM public.upsert_sales_note_deletion_movement(
            p_sales_note_id, v_sni.order_item_id, v_oi.product_id, v_oi.variant_id,
            v_own_wh, -v_item_abs_qty, v_new_sni_code, p_created_by
          );
        ELSE
          v_plain_qty := v_sni.quantity;
          FOR v_rest IN
            SELECT m.batch_id, m.warehouse_id, -SUM(m.quantity_change) AS qty
            FROM public.inventory_movements m
            WHERE m.sales_note_id = p_sales_note_id
              AND m.order_item_id = v_sni.order_item_id
              AND m.source_type = 'sales_shipment'
              AND m.batch_id IS NOT NULL
            GROUP BY m.batch_id, m.warehouse_id
          LOOP
            PERFORM public.upsert_sales_note_deletion_movement(
              p_sales_note_id, v_sni.order_item_id, v_oi.product_id, v_oi.variant_id,
              v_rest.warehouse_id, v_rest.qty, v_new_sni_code, p_created_by, v_rest.batch_id
            );
            v_plain_qty := v_plain_qty - v_rest.qty;
          END LOOP;
          IF v_plain_qty > 0 THEN
            PERFORM public.upsert_sales_note_deletion_movement(
              p_sales_note_id, v_sni.order_item_id, v_oi.product_id, v_oi.variant_id,
              v_own_wh, v_plain_qty, v_new_sni_code, p_created_by
            );
          END IF;
        END IF;
      END IF;

      IF v_is_consignment THEN
        IF v_sni.inventory_source_type = 'store_consignment' THEN
          v_source_type := 'consignment_shipment_reversal';
          v_owner := 'store_consignment';
          v_ship_wh := v_own_wh;
        ELSE
          v_source_type := 'consignment_sale_reversal';
          v_owner := 'supplier_consignment';
          v_ship_wh := v_consignment_wh;
        END IF;

        IF v_sni.inventory_source_type = 'store_consignment' THEN
          -- 寄賣已出貨（store_consignment）：逐批還原
          v_plain_qty := v_sni.quantity;
          FOR v_rest IN
            SELECT m.batch_id, m.warehouse_id, -SUM(m.quantity_change) AS qty
            FROM public.inventory_movements m
            WHERE m.sales_note_id = p_sales_note_id
              AND m.order_item_id = v_sni.order_item_id
              AND m.source_type = 'consignment_out_shipment'
              AND m.batch_id IS NOT NULL
            GROUP BY m.batch_id, m.warehouse_id
          LOOP
            INSERT INTO public.inventory_movements (
              product_id, variant_id, warehouse_id, quantity_change, source_type,
              sales_note_id, order_item_id, inventory_owner, reference_code, created_by, batch_id
            )
            VALUES (
              v_oi.product_id, v_oi.variant_id, v_rest.warehouse_id, v_rest.qty, v_source_type,
              p_sales_note_id, v_sni.order_item_id, v_owner, v_new_sni_code, p_created_by, v_rest.batch_id
            );
            v_plain_qty := v_plain_qty - v_rest.qty;
          END LOOP;
          IF v_plain_qty > 0 THEN
            INSERT INTO public.inventory_movements (
              product_id, variant_id, warehouse_id, quantity_change, source_type,
              sales_note_id, order_item_id, inventory_owner, reference_code, created_by
            )
            VALUES (
              v_oi.product_id, v_oi.variant_id, v_ship_wh, v_plain_qty, v_source_type,
              p_sales_note_id, v_sni.order_item_id, v_owner, v_new_sni_code, p_created_by
            );
          END IF;
        ELSE
          INSERT INTO public.inventory_movements (
            product_id, variant_id, warehouse_id, quantity_change, source_type,
            sales_note_id, order_item_id, inventory_owner, reference_code, created_by
          )
          VALUES (
            v_oi.product_id, v_oi.variant_id, v_ship_wh, v_sni.quantity, v_source_type,
            p_sales_note_id, v_sni.order_item_id, v_owner, v_new_sni_code, p_created_by
          );
        END IF;
      END IF;

      -- 出貨 movements（sales_shipment / consignment_out_shipment / 退貨回補 customer_return）
      -- 在此才刪除，確保上方批次還原先用原批次+倉位分布讀取並寫回
      DELETE FROM public.inventory_movements
      WHERE sales_note_id = p_sales_note_id
        AND order_item_id = v_sni.order_item_id
        AND source_type IN ('sales_shipment', 'consignment_out_shipment', 'customer_return');

      v_new_shipped := GREATEST(0, v_oi.shipped_quantity - v_item_abs_qty);
      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped,
          status = CASE
                     WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                     WHEN v_new_shipped < v_oi.quantity THEN 'partial'::order_item_status
                     ELSE 'shipped'::order_item_status
                   END,
          return_status = CASE WHEN v_is_return_line THEN 'pending'::text ELSE return_status END,
          line_note = CASE WHEN v_is_return_line
                           THEN regexp_replace(COALESCE(line_note, ''), '(；)?(退貨出貨入庫|出貨退回入庫)$', '')
                           ELSE line_note END,
          updated_at = NOW()
      WHERE id = v_sni.order_item_id;

      SELECT quantity INTO v_pool_quantity FROM public.shipping_pool WHERE order_item_id = v_sni.order_item_id;
      IF FOUND THEN
        UPDATE public.shipping_pool
        SET quantity = v_pool_quantity + v_item_abs_qty
        WHERE order_item_id = v_sni.order_item_id;
      ELSE
        INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
        VALUES (v_sni.order_item_id, v_item_abs_qty, v_sn.store_id, p_created_by);
      END IF;

      -- 上限防呆：回補後不得超過訂單剩餘未出貨量；剩餘量 <= 0 時（殘留整列）直接刪除
      IF v_oi.quantity - v_new_shipped <= 0 THEN
        DELETE FROM public.shipping_pool WHERE order_item_id = v_sni.order_item_id;
      ELSE
        UPDATE public.shipping_pool
        SET quantity = v_oi.quantity - v_new_shipped
        WHERE order_item_id = v_sni.order_item_id
          AND quantity > v_oi.quantity - v_new_shipped;
      END IF;

      IF NOT (v_oi.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_oi.order_id);
      END IF;

      DELETE FROM public.sales_note_items WHERE id = v_sni.id;
      v_removed_qty := v_removed_qty + v_sni.quantity;
    END LOOP;
  END IF;

  -- Phase 2: 追加已有品項
  IF p_items_to_add IS NOT NULL AND jsonb_typeof(p_items_to_add) = 'array' AND jsonb_array_length(p_items_to_add) > 0 THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items_to_add)
    LOOP
      v_item_order_item_id := (v_elem->>'order_item_id')::UUID;
      v_item_quantity := (v_elem->>'quantity')::INTEGER;

      SELECT * INTO v_oi
      FROM public.order_items oi
      JOIN public.orders oo ON oo.id = oi.order_id
      WHERE oi.id = v_item_order_item_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION '要追加的品項不存在';
      END IF;

      IF v_oi.store_id <> v_sn.store_id THEN
        RAISE EXCEPTION '不可跨店家追加品項';
      END IF;

      v_remaining := v_oi.quantity - v_oi.shipped_quantity;
      IF v_item_quantity > v_remaining THEN
        RAISE EXCEPTION '品項未出貨量不足，剩餘 % 件', v_remaining;
      END IF;

      v_is_return_line := (v_oi.line_type = 'return');

      IF v_is_return_line AND v_oi.consignment_mode THEN
        RAISE EXCEPTION '退貨列不支援寄賣路徑';
      END IF;

      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type, sort_order)
      VALUES (
        p_sales_note_id, v_item_order_item_id,
        CASE WHEN v_is_return_line THEN -v_item_quantity ELSE v_item_quantity END,
        CASE WHEN v_is_return_line THEN 'self'
             WHEN v_oi.consignment_mode THEN 'store_consignment'
             ELSE 'self' END,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id)
      );

      IF v_is_return_line THEN
        PERFORM public._receive_return_to_stock(
          v_oi.product_id, v_oi.variant_id, v_own_wh, v_item_quantity,
          p_sales_note_id, v_item_order_item_id, v_new_sni_code, p_created_by, '訂單退貨出貨'
        );
      ELSIF v_oi.consignment_mode THEN
        PERFORM public.allocate_inventory(
          v_oi.product_id, v_oi.variant_id, v_item_quantity, 'store_consignment', NULL,
          p_sales_note_id, v_item_order_item_id, v_new_sni_code, v_oi.unit_price, p_created_by
        );
      ELSE
        PERFORM public._ship_stock_movements(
          v_oi.product_id, v_oi.variant_id, v_own_wh, v_item_quantity, 'sales_shipment',
          p_sales_note_id, NULL, NULL, v_item_order_item_id, v_new_sni_code, p_created_by, 'self'
        );
      END IF;

      v_new_shipped := v_oi.shipped_quantity + v_item_quantity;
      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped,
          status = CASE
                     WHEN v_new_shipped >= v_oi.quantity THEN 'shipped'::order_item_status
                     WHEN v_new_shipped > 0 THEN 'partial'::order_item_status
                     ELSE 'waiting'::order_item_status
                   END,
          return_status = CASE
                            WHEN v_is_return_line AND return_status = 'pending' THEN 'stock'
                            ELSE return_status
                          END,
          line_note = CASE
                        WHEN v_is_return_line AND return_status = 'pending'
                          THEN COALESCE(line_note, '') || CASE WHEN COALESCE(line_note, '') = '' THEN '' ELSE '；' END || '退貨出貨入庫'
                        ELSE line_note
                      END,
          updated_at = NOW()
      WHERE id = v_item_order_item_id;

      DELETE FROM public.shipping_pool
      WHERE order_item_id = v_item_order_item_id AND store_id = v_sn.store_id;

      IF NOT (v_oi.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_oi.order_id);
      END IF;

      v_added_qty := v_added_qty + v_item_quantity;
    END LOOP;
  END IF;

  -- Phase 3: 追加完全新品（自動建單）
  IF p_new_items IS NOT NULL AND jsonb_typeof(p_new_items) = 'array' AND jsonb_array_length(p_new_items) > 0 THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_new_items)
    LOOP
      IF (v_elem->>'product_id') IS NULL THEN
        RAISE EXCEPTION '新品項缺少 product_id';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = (v_elem->>'product_id')::UUID) THEN
        RAISE EXCEPTION '新品項對應產品不存在';
      END IF;

      v_item_quantity := COALESCE((v_elem->>'quantity')::INTEGER, 1);
      IF v_item_quantity < 1 THEN
        RAISE EXCEPTION '新品項數量需大於 0';
      END IF;

      IF (v_elem->>'unit_price') IS NULL THEN
        RAISE EXCEPTION '新品項需提供 unit_price';
      END IF;

      v_new_order_item_id := gen_random_uuid();

      IF (v_elem->>'variant_id') IS NOT NULL THEN
        INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode, access_token, delivery_type)
        VALUES (v_sn.store_id, p_created_by, '系統自動建立（銷貨單修正）', 'admin_proxy', 'shipped', false, gen_random_uuid(), NULL)
        RETURNING id INTO v_new_order_id;

        INSERT INTO public.order_items (
          id, order_id, product_id, variant_id, store_id,
          quantity, unit_price, unit_cost, shipped_quantity, status, line_type
        )
        VALUES (
          v_new_order_item_id, v_new_order_id, (v_elem->>'product_id')::UUID, (v_elem->>'variant_id')::UUID,
          v_sn.store_id, v_item_quantity, (v_elem->>'unit_price')::NUMERIC, NULL,
          v_item_quantity, 'shipped', 'sale'
        );
      ELSE
        INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode, access_token, delivery_type)
        VALUES (v_sn.store_id, p_created_by, '系統自動建立（銷貨單修正）', 'admin_proxy', 'shipped', false, gen_random_uuid(), NULL)
        RETURNING id INTO v_new_order_id;

        INSERT INTO public.order_items (
          id, order_id, product_id, variant_id, store_id,
          quantity, unit_price, unit_cost, shipped_quantity, status, line_type
        )
        VALUES (
          v_new_order_item_id, v_new_order_id, (v_elem->>'product_id')::UUID, NULL,
          v_sn.store_id, v_item_quantity, (v_elem->>'unit_price')::NUMERIC, NULL,
          v_item_quantity, 'shipped', 'sale'
        );
      END IF;

      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
      VALUES (
        p_sales_note_id, v_new_order_item_id, v_item_quantity,
        CASE WHEN v_sni.quantity < 0 THEN 'self' ELSE 'self' END
      );

      PERFORM public._ship_stock_movements(
        (v_elem->>'product_id')::UUID, (v_elem->>'variant_id')::UUID, v_own_wh, v_item_quantity,
        'sales_shipment', p_sales_note_id, NULL, NULL, v_new_order_item_id,
        v_new_sni_code, p_created_by, 'self'
      );

      v_new_items_qty := v_new_items_qty + v_item_quantity;

      IF NOT (v_new_order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_new_order_id);
      END IF;
    END LOOP;
  END IF;

  -- Phase 4: 價格更新
  IF p_price_updates IS NOT NULL AND jsonb_typeof(p_price_updates) = 'array' AND jsonb_array_length(p_price_updates) > 0 THEN
    FOR v_pu_elem IN SELECT * FROM jsonb_array_elements(p_price_updates)
    LOOP
      v_pu_oi_id := (v_pu_elem->>'order_item_id')::UUID;
      v_pu_new_price := (v_pu_elem->>'new_unit_price')::INTEGER;

      SELECT * INTO v_pu_oi FROM public.order_items WHERE id = v_pu_oi_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION '要調價的品項不存在';
      END IF;

      IF v_pu_new_price < 0 THEN
        RAISE EXCEPTION '新單價不可為負數';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.sales_note_items sni
        WHERE sni.sales_note_id = p_sales_note_id AND sni.order_item_id = v_pu_oi_id
      ) THEN
        RAISE EXCEPTION '要調價的品項不屬於此銷貨單';
      END IF;

      v_pu_old_price := v_pu_oi.unit_price;

      v_other_notes := (
        SELECT jsonb_agg(jsonb_build_object(
          'sales_note_id', sni.sales_note_id,
          'code', sn.code,
          'paid', (sn.payment_status IN ('paid', 'partial'))
        ))
        FROM public.sales_note_items sni
        JOIN public.sales_notes sn ON sn.id = sni.sales_note_id
        WHERE sni.order_item_id = v_pu_oi_id
          AND sni.sales_note_id <> p_sales_note_id
      );

      SELECT sn.code, sn.payment_status
      INTO v_pu_order_code, v_pu_oi.consignment_mode
      FROM public.sales_notes sn
      WHERE sn.id IN (
        SELECT sni.sales_note_id
        FROM public.sales_note_items sni
        WHERE sni.order_item_id = v_pu_oi_id
          AND sni.sales_note_id <> p_sales_note_id
      )
      LIMIT 1;

      v_price_updates_result := v_price_updates_result || jsonb_build_object(
        'order_item_id', v_pu_oi_id,
        'order_code', v_pu_order_code,
        'old_unit_price', v_pu_old_price,
        'new_unit_price', v_pu_new_price,
        'other_affected_sales_notes', v_other_notes
      );

      UPDATE public.order_items
      SET unit_price = v_pu_new_price, updated_at = NOW()
      WHERE id = v_pu_oi_id;
    END LOOP;
  END IF;

  -- Phase 5: 收斂
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id
  ) THEN
    UPDATE public.sales_notes SET status = 'shipped' WHERE id = p_sales_note_id;
  END IF;

  UPDATE public.sales_notes SET updated_at = NOW() WHERE id = p_sales_note_id;

  -- 對稱升降級：全數已出貨（含 return 豁免）→ shipped；
  -- 已無任何已出貨/部分出貨 item 且訂單仍為 shipped → 降回 processing（與 delete_sales_note 一致）
  FOREACH v_order_id IN ARRAY v_affected_order_ids LOOP
    SELECT bool_and(oi.shipped_quantity >= oi.quantity OR oi.status IN ('cancelled', 'discontinued')
                    OR oi.line_type = 'return')
    INTO v_all_shipped
    FROM public.order_items oi
    WHERE oi.order_id = v_order_id;

    IF v_all_shipped THEN
      UPDATE public.orders SET status = 'shipped', updated_at = NOW() WHERE id = v_order_id;
    ELSE
      UPDATE public.orders SET status = 'processing', updated_at = NOW()
      WHERE id = v_order_id
        AND status = 'shipped'
        AND NOT EXISTS (
          SELECT 1 FROM public.order_items oi2
          WHERE oi2.order_id = v_order_id
            AND (oi2.shipped_quantity > 0 OR oi2.status IN ('shipped', 'partial'))
        );
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'ok', true,
    'removed_qty', v_removed_qty,
    'added_qty', v_added_qty,
    'new_items_qty', v_new_items_qty,
    'affected_order_ids', v_affected_order_ids,
    'price_updates', v_price_updates_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_sales_note(uuid, uuid[], jsonb, jsonb, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.correct_sales_note(uuid, uuid[], jsonb, jsonb, uuid, jsonb) TO authenticated;