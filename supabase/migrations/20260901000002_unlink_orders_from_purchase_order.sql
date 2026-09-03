-- ============================================================
-- 解除訂單 ↔ 採購單連結 + 強制禁止重複採購（精確扣量）
--
-- 1. purchase_order_items 新增 source_quantities (jsonb)：
--    { orderId: 數量 } —— 記錄每個來源訂單貢獻了多少數量，
--    讓「轉採購單」能精確計算剩餘可採購量、避免同一訂單重複採購。
-- 2. 舊資料回填：單一來源訂單的品項直接回填 {orderId: quantity}；
--    多來源品項無法精確拆分，保持 NULL（RPC 遇到時只解除連結、不扣量）。
-- 3. RPC unlink_orders_from_purchase_order：被移除訂單的未收貨數量精確扣除；
--    已收貨部分只在仍收貨條件下解除連結（不扣量、不刪列）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 新增 source_quantities 欄位
-- ------------------------------------------------------------
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS source_quantities jsonb;

-- ------------------------------------------------------------
-- 2. 回填既有單一來源品項
-- ------------------------------------------------------------
UPDATE public.purchase_order_items
SET source_quantities = jsonb_build_object(source_order_ids[1]::text, quantity)
WHERE source_order_ids IS NOT NULL
  AND cardinality(source_order_ids) = 1
  AND source_quantities IS NULL;

-- ------------------------------------------------------------
-- 3. RPC：解除訂單與採購單的連結
--    精確扣除被移除訂單的未收貨數量（quantity - received_quantity）
-- ============================================================
CREATE OR REPLACE FUNCTION public.unlink_orders_from_purchase_order(
  p_purchase_order_id UUID,
  p_order_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_item RECORD;
  v_removed_item_count INT := 0;
  v_updated_item_count INT := 0;
  v_source_qtys jsonb;
  v_remove_qty INT;
  v_unconsumed INT;
  v_new_qty INT;
  v_new_source_ids UUID[];
  v_new_source_qtys jsonb;
  v_total_amount NUMERIC := 0;
  v_any_received BOOLEAN := FALSE;
  v_all_received BOOLEAN := TRUE;
  v_remaining_item_count INT := 0;
  v_order_code TEXT;
  v_order_ids_joined TEXT;
BEGIN
  IF p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION '缺少採購單 ID';
  END IF;
  IF p_order_ids IS NULL OR cardinality(p_order_ids) = 0 THEN
    RAISE EXCEPTION '請至少選擇一筆要解除的訂單';
  END IF;

  -- 先驗證：被解除的訂單必須存在於此採購單，否則提示錯誤
  SELECT string_agg(c.code, ', ')
  INTO v_order_ids_joined
  FROM public.orders c
  WHERE c.id = ANY(p_order_ids);

  IF v_order_ids_joined IS NULL OR v_order_ids_joined = '' THEN
    RAISE EXCEPTION '找不到對應的來源訂單';
  END IF;

  FOR v_item IN
    SELECT poi.id, poi.quantity, poi.received_quantity, poi.unit_cost,
           poi.source_order_ids, poi.source_quantities,
           o.code AS source_order_code
    FROM public.purchase_order_items poi
    LEFT JOIN LATERAL (
      SELECT array_agg(c.code) AS code
      FROM public.orders c
      WHERE c.id = ANY(poi.source_order_ids)
    ) o ON TRUE
    WHERE poi.purchase_order_id = p_purchase_order_id
  LOOP
    -- 此品項是否有任何被移除的來源訂單？
    IF v_item.source_order_ids IS NULL
       OR NOT EXISTS (SELECT 1 FROM unnest(p_order_ids) pid WHERE pid = ANY(v_item.source_order_ids)) THEN
      -- 不在移除範圍，但仍是剩餘品項 —— 保留
      v_total_amount := v_total_amount + v_item.quantity * v_item.unit_cost;
      v_remaining_item_count := v_remaining_item_count + 1;
      IF v_item.received_quantity > 0 THEN
        v_any_received := TRUE;
        IF v_item.received_quantity < v_item.quantity THEN v_all_received := FALSE; END IF;
      ELSE
        v_all_received := FALSE;
      END IF;
      CONTINUE;
    END IF;

    v_source_qtys := v_item.source_quantities;
    v_remove_qty := 0;

    -- 精確扣除：只有在 source_quantities 有資料時才扣量
    -- （多來源舊資料回填不了：只解除連結、不扣量）
    IF v_source_qtys IS NOT NULL THEN
      FOR v_order_code IN SELECT jsonb_object_keys(v_source_qtys) LOOP
        IF EXISTS (SELECT 1 FROM unnest(p_order_ids) pid WHERE pid::text = v_order_code) THEN
          v_remove_qty := v_remove_qty + COALESCE((v_source_qtys ->> v_order_code)::int, 0);
        END IF;
      END LOOP;
    END IF;

    -- 未收貨數量才可扣除（保護已收貨的庫存）
    v_unconsumed := GREATEST(0, v_item.quantity - v_item.received_quantity);
    v_new_qty := v_item.quantity - LEAST(v_unconsumed, v_remove_qty);

    -- 重組剩餘來源
    v_new_source_ids := ARRAY(
      SELECT s FROM unnest(v_item.source_order_ids) s
      WHERE NOT (s = ANY(p_order_ids))
    );
    IF v_source_qtys IS NOT NULL THEN
      v_new_source_qtys := (
        SELECT COALESCE(jsonb_agg(j)::jsonb, '{}'::jsonb)
        FROM (
          SELECT jsonb_build_object(k, v) AS j
          FROM jsonb_each(v_source_qtys) e(k, v)
          WHERE NOT EXISTS (SELECT 1 FROM unnest(p_order_ids) pid WHERE pid::text = k)
        ) t
      );
    ELSE
      v_new_source_qtys := NULL;
    END IF;

    -- 剩餘來源為空 ＋ 無收貨 → 直接刪列（避免留下空白採購項目）
    IF cardinality(v_new_source_ids) = 0 AND v_item.received_quantity = 0 THEN
      DELETE FROM public.purchase_order_items WHERE id = v_item.id;
      v_removed_item_count := v_removed_item_count + 1;
      CONTINUE;
    END IF;

    -- 更新品項
    UPDATE public.purchase_order_items
    SET quantity = v_new_qty,
        source_order_ids = CASE WHEN cardinality(v_new_source_ids) = 0 THEN NULL ELSE v_new_source_ids END,
        source_quantities = CASE WHEN cardinality(v_new_source_ids) = 0 THEN NULL ELSE v_new_source_qtys END
    WHERE id = v_item.id;

    v_updated_item_count := v_updated_item_count + 1;
    v_total_amount := v_total_amount + v_new_qty * v_item.unit_cost;
    v_remaining_item_count := v_remaining_item_count + 1;
    IF v_item.received_quantity > 0 THEN
      v_any_received := TRUE;
      IF v_item.received_quantity < v_new_qty THEN v_all_received := FALSE; END IF;
    ELSE
      v_all_received := FALSE;
    END IF;
  END LOOP;

  -- 回寫採購單總金額
  UPDATE public.purchase_orders
  SET total_amount = v_total_amount
  WHERE id = p_purchase_order_id;

  -- 重算採購單狀態（保護既有收貨進度）
  IF v_remaining_item_count = 0 THEN
    UPDATE public.purchase_orders SET status = 'draft' WHERE id = p_purchase_order_id;
  ELSIF v_all_received THEN
    UPDATE public.purchase_orders SET status = 'received' WHERE id = p_purchase_order_id;
  ELSIF v_any_received THEN
    UPDATE public.purchase_orders SET status = 'partial_received' WHERE id = p_purchase_order_id;
  END IF;

  RETURN jsonb_build_object(
    'purchase_order_id', p_purchase_order_id,
    'removed_item_count', v_removed_item_count,
    'updated_item_count', v_updated_item_count,
    'total_amount', v_total_amount
  );
END;
$$;

-- 授權：依專案慣例（見 20260805000005_revoke_anon_business_rpcs.sql），
--   新商業 RPC 併入該檔案撤除 anon/PUBLIC EXECUTE。