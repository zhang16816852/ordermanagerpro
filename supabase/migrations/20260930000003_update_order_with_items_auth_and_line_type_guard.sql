-- 20260930000003_update_order_with_items_auth_and_line_type_guard.sql
--
-- 兩項修正（皆為 CREATE OR REPLACE，簽名不變，前端零改動）：
--
-- 1) 補回授權守門（安全修正）：
--    update_order_with_items 為 SECURITY DEFINER，但 20260916000004 與
--    20260924000005 的重發版本沿用了 20260903000002 的 body，**遺漏了**
--    20260904000001 原本的授權檢查（admin / 店成員 / 該單業務）。
--    遠端實測 has_function_privilege('anon', ..., 'EXECUTE') = true，
--    代表任何持有 anon key 者可改寫任意訂單的備註與品項（數量／單價）。
--    本 migration 以線上最新 prosrc 為基底補回：
--      - 訂單不存在 → RAISE
--      - 非 admin / 非店成員 / 非該單業務 → RAISE 'not authorized'
--
--    ⚠️ 三值邏輯坑：原寫法 NOT (has_role(...) OR is_store_member(...) OR
--       sales_rep_id = auth.uid()) 在「orders.sales_rep_id IS NULL」時整條
--       OR 鏈結果為 NULL，而 IF NOT NULL 不成立 → **完全略過守門**。
--       實測非管理員即可改寫任意非業務訂單的備註與品項。
--       修正：先取 v_uid 並在 auth.uid() IS NULL 時直接拒絕，
--       且三個 disjunct 一律 COALESCE(..., false)，確保 OR 鏈恆為
--       TRUE／FALSE（只加 v_uid IS NULL 仍不足夠，OR 鏈本身還是 NULL）。
--
-- 2) 已收款訂單的「打單性質（line_type）」變更守門：
--    原守門只檢查 quantity / unit_price 差異，故已收款訂單仍可把
--    一般品項改成退貨列（或反向），使銷貨單金額與訂單性質不一致。
--    將 line_type 差異併入 v_affecting_changes 判定，並補上 reason 文案。
--
-- 對應前端：useOrderFormMutations 的 lineTypeFields() 固定成組送出
-- line_type / line_note / return_status / is_repair。
--
-- 套用紀錄：本檔首版套用遠端後才於測試中發現 COALESCE 修正需求，故
-- **遠端最終 body 由直接 CREATE OR REPLACE 覆寫為本檔內容**（現行
-- prosrc md5 = 42a999a0068cb706b7c455f8a4765048）。本檔為權威來源，
-- 新環境 `supabase db push` 會一次套用正確版本。

CREATE OR REPLACE FUNCTION public.update_order_with_items(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]',
  p_deleted_item_ids UUID[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_uid UUID;
  v_elem JSONB;
  v_item_id UUID;
  v_temp_key TEXT;
  v_parent_temp TEXT;
  v_has_paid_note BOOLEAN;
  v_paid_note_code TEXT;
  v_affecting_changes BOOLEAN;
  v_shipped_deletion BOOLEAN;
  v_low_quantity BOOLEAN;
BEGIN
  -- 0. 授權守門（補回 20260904000001 版並修正三值邏輯；否則 anon／一般使用者皆可改寫任意訂單）
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_uid := auth.uid();
  -- ⚠️ 三個 disjunct 一律 COALESCE，確保 OR 鏈恆為 TRUE/FALSE。
  --    orders.sales_rep_id 多為 NULL，若保留原始寫法則整條 OR 鏈為 NULL，
  --    而「IF NOT NULL」不成立 → 守門被完全略過（實測非管理員可改寫任意訂單）。
  IF v_uid IS NULL OR NOT (
       COALESCE(public.has_role(v_uid, 'admin'), false)
       OR COALESCE(public.is_store_member(v_uid, v_order.store_id), false)
       OR COALESCE(v_order.sales_rep_id = v_uid, false)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.sales_notes sn
    JOIN public.sales_note_items sni ON sni.sales_note_id = sn.id
    JOIN public.order_items oi ON oi.id = sni.order_item_id
    WHERE oi.order_id = p_order_id
      AND sn.payment_status = 'paid'
  ) INTO v_has_paid_note;

  IF v_has_paid_note THEN
    v_affecting_changes := false;

    IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
      IF EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.id = ANY(p_deleted_item_ids) AND oi.order_id = p_order_id
      ) THEN
        v_affecting_changes := true;
      END IF;
    END IF;

    IF NOT v_affecting_changes AND p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) AS el
        WHERE (el->>'id') IS NULL
      ) THEN
        v_affecting_changes := true;
      END IF;
    END IF;

    IF NOT v_affecting_changes AND p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS el
        JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND oi.order_id = p_order_id
        WHERE (el->>'id') IS NOT NULL
          AND (
            oi.quantity <> (el->>'quantity')::INT
            OR oi.unit_price <> (el->>'unit_price')::NUMERIC
          )
      ) INTO v_affecting_changes;
    END IF;

    -- 新增：打單性質（line_type）差異亦屬影響會計的變更
    -- （退貨列以負數進入銷貨單，改 line_type 會使已收款金額與訂單性質不一致）
    IF NOT v_affecting_changes AND p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS el
        JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND oi.order_id = p_order_id
        WHERE (el->>'id') IS NOT NULL
          AND COALESCE(NULLIF(el->>'line_type', ''), oi.line_type) <> oi.line_type
      ) INTO v_affecting_changes;
    END IF;

    IF v_affecting_changes THEN
      SELECT sn.code INTO v_paid_note_code
      FROM public.sales_notes sn
      JOIN public.sales_note_items sni ON sni.sales_note_id = sn.id
      JOIN public.order_items oi ON oi.id = sni.order_item_id
      WHERE oi.order_id = p_order_id AND sn.payment_status = 'paid'
      LIMIT 1;
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '此訂單已有已收款的銷貨單（' || COALESCE(v_paid_note_code, '') || '），修改品項、數量、單價或打單性質會導致會計紀錄不一致。請先至會計模組回退收款後再修改。',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'paid_sales_note', 'code', v_paid_note_code, 'label', '已收款銷貨單'))
      );
    END IF;
  END IF;

  -- 數量守門
  IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.id = ANY(p_deleted_item_ids)
        AND oi.order_id = p_order_id
        AND oi.shipped_quantity > 0
    ) INTO v_shipped_deletion;

    IF v_shipped_deletion THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '有品項已出貨（shipped_quantity > 0），無法直接刪除；請先至銷貨單/寄賣管理回滾出貨後再移除。',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'shipped_order_item', 'code', NULL::text, 'label', '已出貨品項'))
      );
    END IF;
  END IF;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS el
      JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND oi.order_id = p_order_id
      WHERE (el->>'id') IS NOT NULL
        AND (el->>'quantity')::INT < oi.shipped_quantity
    ) INTO v_low_quantity;

    IF v_low_quantity THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '品項新數量不可低於已出貨數量（shipped_quantity）；請先於銷貨單/寄賣管理回滾出貨量後再調整。',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'quantity_below_shipped', 'code', NULL::text, 'label', '數量低於已出貨'))
      );
    END IF;
  END IF;

  -- 3) line_type ↔ return_status / is_repair 組合校驗
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS el
      LEFT JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND (el->>'id') IS NOT NULL
      WHERE COALESCE(NULLIF(el->>'line_type', ''), oi.line_type, 'sale') = 'return'
        AND (NULLIF(el->>'return_status', '') IS NULL
             OR NULLIF(el->>'return_status', '') NOT IN ('pending', 'stock', 'exchange', 'repaired'))
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '退貨列必須指定有效的 return_status（pending/stock/exchange/repaired）');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS el
      LEFT JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND (el->>'id') IS NOT NULL
      WHERE COALESCE(NULLIF(el->>'line_type', ''), oi.line_type, 'sale') <> 'return'
        AND (NULLIF(el->>'return_status', '') IS NOT NULL
             OR COALESCE((el->>'is_repair')::boolean, false))
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '僅退貨列可設定 return_status / is_repair');
    END IF;
  END IF;

  -- 1. 更新訂單備註
  UPDATE orders
  SET notes = p_notes, updated_at = now()
  WHERE id = p_order_id;

  IF (p_items IS NULL OR jsonb_array_length(p_items) = 0)
     AND (p_deleted_item_ids IS NULL OR array_length(p_deleted_item_ids, 1) = 0) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- 2. 刪除被移除的品項
  IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
    DELETE FROM order_items
    WHERE id = ANY(p_deleted_item_ids)
      AND order_id = p_order_id;
  END IF;

  -- 3. 更新既有品項
  UPDATE order_items oi
  SET quantity = (iu.elem->>'quantity')::INT,
      unit_price = (iu.elem->>'unit_price')::NUMERIC,
      unit_cost = COALESCE(NULLIF((iu.elem->>'unit_cost'), '')::NUMERIC, 0),
      sort_order = (iu.elem->>'sort_order')::INT,
      selected_model_name = (iu.elem->>'selected_model_name')::TEXT,
      parent_order_item_id = CASE
        WHEN (iu.elem->>'parent_temp_key') IS NOT NULL THEN NULL
        ELSE NULLIF(iu.elem->>'parent_order_item_id', '')::UUID
      END,
      shipping_payment = NULLIF(iu.elem->>'shipping_payment', ''),
      line_type = COALESCE(NULLIF(iu.elem->>'line_type', ''), oi.line_type),
      line_note = CASE
        WHEN iu.elem ? 'line_note' THEN NULLIF(iu.elem->>'line_note', '')
        ELSE oi.line_note
      END,
      return_status = CASE
        WHEN iu.elem ? 'return_status' THEN NULLIF(iu.elem->>'return_status', '')
        ELSE oi.return_status
      END,
      is_repair = COALESCE((iu.elem->>'is_repair')::boolean, oi.is_repair),
      updated_at = now()
  FROM (
    SELECT elem
    FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NOT NULL
  ) iu
  WHERE oi.id = (iu.elem->>'id')::UUID
    AND oi.order_id = p_order_id;

  -- 4. 插入新品項
  CREATE TEMP TABLE _new_item_map (temp_key text PRIMARY KEY, item_id uuid)
    ON COMMIT DROP;

  FOR v_elem IN
    SELECT elem FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NULL
    ORDER BY (elem->>'sort_order')::INT NULLS LAST
  LOOP
    INSERT INTO order_items (
      order_id, product_id, variant_id, quantity, unit_price,
      unit_cost, selected_model_name, store_id, sort_order, shipping_payment,
      line_type, line_note, return_status, is_repair
    )
    SELECT
      p_order_id,
      (v_elem->>'product_id')::UUID,
      NULLIF(v_elem->>'variant_id', '')::UUID,
      (v_elem->>'quantity')::INT,
      (v_elem->>'unit_price')::NUMERIC,
      COALESCE(NULLIF(v_elem->>'unit_cost', '')::NUMERIC, 0),
      NULLIF(v_elem->>'selected_model_name', ''),
      o.store_id,
      (v_elem->>'sort_order')::INT,
      NULLIF(v_elem->>'shipping_payment', ''),
      COALESCE(NULLIF(v_elem->>'line_type', ''), 'sale'),
      NULLIF(v_elem->>'line_note', ''),
      NULLIF(v_elem->>'return_status', ''),
      COALESCE((v_elem->>'is_repair')::boolean, false)
    FROM orders o
    WHERE o.id = p_order_id
    RETURNING id INTO v_item_id;

    v_temp_key := v_elem->>'temp_key';
    IF v_temp_key IS NOT NULL THEN
      INSERT INTO _new_item_map (temp_key, item_id) VALUES (v_temp_key, v_item_id);
    END IF;
  END LOOP;

  -- 5. 承接子行
  FOR v_elem, v_temp_key, v_parent_temp IN
    SELECT elem, elem->>'temp_key', elem->>'parent_temp_key'
    FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NULL
      AND (elem->>'parent_temp_key') IS NOT NULL
  LOOP
    UPDATE order_items oi
    SET parent_order_item_id = m.item_id
    FROM _new_item_map m
    WHERE m.temp_key = v_parent_temp
      AND oi.id = (SELECT item_id FROM _new_item_map WHERE temp_key = v_temp_key)
      AND oi.order_id = p_order_id;
  END LOOP;

  DROP TABLE _new_item_map;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_order_with_items(UUID, TEXT, JSONB, UUID[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_order_with_items(UUID, TEXT, JSONB, UUID[]) TO authenticated;
