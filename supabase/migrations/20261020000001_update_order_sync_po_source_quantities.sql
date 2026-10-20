-- ============================================================
-- 訂單編輯同步採購單 source_quantities（Phase B）
--
-- 單一 RPC sync_order_po_quantities(p_order_id, p_items,
-- p_deleted_item_ids, p_apply)：
--   p_apply = false｜預覽（唯讀，不寫入）回傳 {changes:[...]}
--   p_apply = true ｜套用並回傳 {ok:true, applied:[...]}
-- 供前端「原為 N 調整為 M」二次確認流程一次呼叫。
--
-- 規則：
--   1. 既有品項數量變更採 delta 方式（quantity += delta、
--      share += delta），絕不以 SUM(source_quantities) 反推。
--   2. 減少時不得低於「其他來源訂單貢獻量（others）」；
--      不得刪除他單貨品。
--   3. 刪除品項時移除本訂單貢獻量（share=0），quantity 扣減
--      至剩餘 others；others=0 且 received_quantity=0 時刪列。
--   4. 任何實際套用的品項若 received_quantity > 0，回傳
--      {ok:false, reason} 且整筆不寫入。
--   5. update_order_with_items 不變（不在每次存檔時動採購）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_order_po_quantities(
  p_order_id UUID,
  p_items JSONB DEFAULT '[]',
  p_deleted_item_ids UUID[] DEFAULT '{}',
  p_apply BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_uid UUID;
  v_item RECORD;
  v_oi RECORD;
  v_poi RECORD;
  v_delta INT;
  v_my_share INT;
  v_others INT;
  v_new_quantity INT;
  v_new_share INT;
  v_new_source_qtys JSONB;
  v_changes JSONB := '[]'::jsonb;
  v_applied JSONB := '[]'::jsonb;
  v_received_hit TEXT;
  v_po_ids UUID[] := '{}';
  v_po_id UUID;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    IF p_apply THEN
      RAISE EXCEPTION 'order not found';
    END IF;
    RETURN jsonb_build_object('changes', '[]'::jsonb);
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT (
       COALESCE(public.has_role(v_uid, 'admin'), false)
       OR COALESCE(public.is_store_member(v_uid, v_order.store_id), false)
       OR COALESCE(v_order.sales_rep_id = v_uid, false)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- ----------------------------------------------------------
  -- 收集異動清單（不寫入）
  -- 既有品項：數量變更 -> delta 同步
  -- input_items：本訂單目前所有既有品項（p_items 中含 id 者）
  -- ----------------------------------------------------------
  CREATE TEMP TABLE IF NOT EXISTS _po_sync_change (
    purchase_order_item_id UUID,
    purchase_order_id UUID,
    purchase_order_code TEXT,
    product_id UUID,
    variant_id UUID,
    old_quantity INT,
    new_quantity INT,
    old_share INT,
    new_share INT,
    received_quantity INT,
    action TEXT
  ) ON COMMIT DROP;
  TRUNCATE _po_sync_change;

  FOR v_item IN
    SELECT elem
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS elem
    WHERE (elem->>'id') IS NOT NULL
      AND (elem->>'quantity') IS NOT NULL
  LOOP
    FOR v_oi IN
      SELECT oi.id AS order_item_id, oi.quantity AS oi_quantity,
             oi.product_id AS oi_product_id, oi.variant_id AS oi_variant_id
      FROM public.order_items oi
      WHERE oi.id = (v_item.elem->>'id')::UUID
        AND oi.order_id = p_order_id
    LOOP
      v_delta := (v_item.elem->>'quantity')::INT - v_oi.oi_quantity;
      IF v_delta = 0 THEN
        CONTINUE;
      END IF;

      FOR v_poi IN
        SELECT poi.id, poi.purchase_order_id, poi.quantity, poi.received_quantity,
               poi.source_quantities,
               COALESCE(po.supplier_order_number, po.id::text) AS po_code
        FROM public.purchase_order_items poi
        JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
        WHERE poi.source_order_ids IS NOT NULL
          AND p_order_id = ANY(poi.source_order_ids)
          AND poi.product_id = v_oi.oi_product_id
          AND poi.variant_id IS NOT DISTINCT FROM v_oi.oi_variant_id
          AND po.status NOT IN ('cancelled')
          AND po.purpose IS DISTINCT FROM 'purchase_return'
          AND poi.source_quantities IS NOT NULL
          AND poi.source_quantities ? p_order_id::text
      LOOP
        v_my_share := COALESCE((v_poi.source_quantities ->> p_order_id::text)::INT, 0);
        v_others := GREATEST(0, v_poi.quantity - v_my_share);

        v_new_share := GREATEST(0, v_my_share + v_delta);
        v_new_quantity := v_poi.quantity + v_delta;
        IF v_new_quantity < v_others THEN v_new_quantity := v_others; END IF;
        IF v_new_quantity < 0 THEN v_new_quantity := 0; END IF;

        IF v_new_quantity = v_poi.quantity AND v_new_share = v_my_share THEN
          CONTINUE;
        END IF;

        INSERT INTO _po_sync_change VALUES (
          v_poi.id, v_poi.purchase_order_id, v_poi.po_code,
          v_oi.oi_product_id, v_oi.oi_variant_id,
          v_poi.quantity, v_new_quantity, v_my_share, v_new_share,
          v_poi.received_quantity, 'update'
        );
      END LOOP;
    END LOOP;
  END LOOP;

  -- 被刪除品項：移除本訂單貢獻量
  -- 以 DISTINCT 去重，避免多個被刪品項同 (product, variant) 造成重複列
  IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
    FOR v_poi IN
      SELECT DISTINCT ON (poi.id)
             poi.id, poi.purchase_order_id, poi.quantity, poi.received_quantity,
             poi.source_quantities,
             COALESCE(po.supplier_order_number, po.id::text) AS po_code,
             poi.product_id AS oi_product_id, poi.variant_id AS oi_variant_id
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
      WHERE poi.source_order_ids IS NOT NULL
        AND p_order_id = ANY(poi.source_order_ids)
        AND po.status NOT IN ('cancelled')
        AND po.purpose IS DISTINCT FROM 'purchase_return'
        AND poi.source_quantities IS NOT NULL
        AND poi.source_quantities ? p_order_id::text
        AND EXISTS (
          SELECT 1 FROM public.order_items oi
          WHERE oi.id = ANY(p_deleted_item_ids)
            AND oi.product_id = poi.product_id
            AND oi.variant_id IS NOT DISTINCT FROM poi.variant_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM _po_sync_change c
          WHERE c.purchase_order_item_id = poi.id
        )
      ORDER BY poi.id
    LOOP
      v_my_share := COALESCE((v_poi.source_quantities ->> p_order_id::text)::INT, 0);
      v_others := GREATEST(0, v_poi.quantity - v_my_share);

      v_new_share := 0;
      v_new_quantity := GREATEST(v_others, 0);

      IF v_new_quantity = v_poi.quantity AND v_my_share = 0 THEN
        CONTINUE;
      END IF;

      INSERT INTO _po_sync_change VALUES (
        v_poi.id, v_poi.purchase_order_id, v_poi.po_code,
        v_poi.oi_product_id, v_poi.oi_variant_id,
        v_poi.quantity, v_new_quantity, v_my_share, v_new_share,
        v_poi.received_quantity, 'remove'
      );
    END LOOP;
  END IF;

  -- ----------------------------------------------------------
  -- 建構 changes 輸出
  -- ----------------------------------------------------------
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'purchase_order_item_id', c.purchase_order_item_id,
    'purchase_order_id', c.purchase_order_id,
    'purchase_order_code', c.purchase_order_code,
    'product_id', c.product_id,
    'variant_id', c.variant_id,
    'old_quantity', c.old_quantity,
    'new_quantity', c.new_quantity,
    'old_share', c.old_share,
    'new_share', c.new_share,
    'action', c.action
  )), '[]'::jsonb)
  INTO v_changes
  FROM _po_sync_change c;

  IF NOT p_apply THEN
    RETURN jsonb_build_object('changes', v_changes);
  END IF;

  IF jsonb_array_length(v_changes) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'applied', '[]'::jsonb);
  END IF;

  -- ----------------------------------------------------------
  -- 守門：任何實際異動品項若已收貨即整筆擋下
  -- ----------------------------------------------------------
  SELECT string_agg(DISTINCT c.purchase_order_code, ', ')
  INTO v_received_hit
  FROM _po_sync_change c
  WHERE c.received_quantity > 0;
  IF v_received_hit IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', '部分採購單品項已收貨（' || v_received_hit || '），無法自動調整數量，請先處理收貨紀錄'
    );
  END IF;

  -- ----------------------------------------------------------
  -- 套用
  -- ----------------------------------------------------------
  FOR v_item IN SELECT DISTINCT purchase_order_id FROM _po_sync_change LOOP
    v_po_ids := array_append(v_po_ids, v_item.purchase_order_id);
  END LOOP;

  FOR v_item IN SELECT * FROM _po_sync_change ORDER BY purchase_order_id, purchase_order_item_id LOOP
    IF v_item.action = 'remove'
       AND v_item.new_quantity = 0
       AND v_item.new_share = 0 THEN
      DELETE FROM public.purchase_order_items WHERE id = v_item.purchase_order_item_id;
    ELSE
      v_new_source_qtys := NULL;
      SELECT poi.source_quantities INTO v_new_source_qtys
      FROM public.purchase_order_items poi
      WHERE poi.id = v_item.purchase_order_item_id;

      IF v_new_source_qtys IS NOT NULL THEN
        IF v_item.new_share > 0 THEN
          v_new_source_qtys := jsonb_set(
            v_new_source_qtys, ARRAY[p_order_id::text], to_jsonb(v_item.new_share), true
          );
        ELSE
          v_new_source_qtys := v_new_source_qtys - p_order_id::text;
        END IF;
      END IF;

      UPDATE public.purchase_order_items
      SET quantity = v_item.new_quantity,
          source_quantities = v_new_source_qtys
      WHERE id = v_item.purchase_order_item_id;
    END IF;

    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id', v_item.purchase_order_item_id,
      'purchase_order_id', v_item.purchase_order_id,
      'purchase_order_code', v_item.purchase_order_code,
      'product_id', v_item.product_id,
      'variant_id', v_item.variant_id,
      'old_quantity', v_item.old_quantity,
      'new_quantity', v_item.new_quantity,
      'action', v_item.action
    ));
  END LOOP;

  -- 重算受影響採購單總金額
  FOREACH v_po_id IN ARRAY v_po_ids LOOP
    UPDATE public.purchase_orders po
    SET total_amount = COALESCE((
      SELECT SUM(poi.quantity * poi.unit_cost)
      FROM public.purchase_order_items poi
      WHERE poi.purchase_order_id = v_po_id
    ), 0)
    WHERE po.id = v_po_id;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'applied', v_applied);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_order_po_quantities(UUID, JSONB, UUID[], BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sync_order_po_quantities(UUID, JSONB, UUID[], BOOLEAN) TO authenticated;
