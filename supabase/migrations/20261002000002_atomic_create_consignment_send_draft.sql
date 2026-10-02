-- ============================================================
-- 20261002000002_atomic_create_consignment_send_draft.sql
-- 寄賣出貨單（send_to_store）改為「單一交易」建立來源訂單
--
-- 問題：前端 createConsignmentSendMutation 以兩次獨立 HTTP 請求建立寄賣單：
--   ① INSERT consignment_orders（draft, send_to_store）
--   ② INSERT consignment_order_items（多筆）
--   缺點：
--   - 與既有 send_to_store 資料不一致：未建立來源 orders/order_items，
--     CO 無 source_order_id、COI 無 order_item_id → 產生孤兒寄賣單。
--   - 非交易：② 失敗會留下沒有品項的孤兒寄賣單（無法回滾 ①）。
--   - 後續所有「來源訂單」機制（出貨層、庫存回補、刪除守門、
--     進度/配送/包裹檢視）都對這些單失效。
--
-- 修法：新增 create_consignment_send_draft，由單一 SECURITY DEFINER 交易
--   依序建立：來源 orders（pending, source_type=consignment）→ order_items（waiting）
--   → consignment_orders（draft, source_order_id）→ consignment_order_items
--   （order_item_id 指向鏡像 order_items）。
--   語意對齊既有 20260804000001_consignment_draft_source_order.sql 的草稿回填
--   與 convert_order_to_consignment_draft 的鏡像慣例：
--   草稿不建立 inventory_movements、不開 sales_notes。
--
-- 介面：items 元素沿用前端既有欄位
--   {product_id, variant_id, quantity, unit_price, unit_cost}
--
-- 回傳：{ok:true, consignment_order_id, consignment_code,
--        source_order_id, source_order_code, item_count}
--      或前置條件失敗時 {ok:false, reason}（前端既有慣例）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_consignment_send_draft(
  p_store_id UUID,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ord_id    UUID;
  v_ord_code  TEXT;
  v_co_id     UUID;
  v_co_code   TEXT;
  v_item      JSONB;
  v_oi_id     UUID;
  v_creator   UUID;
  v_product   UUID;
  v_variant   UUID;
  v_qty       INTEGER;
  v_price     NUMERIC;
  v_cost      NUMERIC;
  v_idx       INTEGER := 0;
  v_count     INTEGER := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可建立寄賣出貨單');
  END IF;

  IF p_store_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '請選擇目標門市');
  END IF;

  -- ⚠️ 用 jsonb_typeof + jsonb_array_length，不可對空陣列用 cardinality()
  --    （空 jsonb 陣列的 cardinality 回 '{}' 為 falsy，會誤判成「有品項」）。
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '請至少新增一項產品');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '目標門市不存在');
  END IF;

  v_creator := COALESCE(p_created_by, auth.uid());

  -- ① 來源訂單：草稿階段維持 pending，出貨時才由既有出貨流程推進為 shipped
  INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode)
  VALUES (p_store_id, v_creator, NULLIF(p_notes, ''), 'consignment', 'pending', true)
  RETURNING id, code INTO v_ord_id, v_ord_code;

  -- ② 寄賣單本體（先取得 id，鏡像品項需參照）
  INSERT INTO public.consignment_orders (direction, store_id, status, source_order_id, created_by, note)
  VALUES ('send_to_store', p_store_id, 'draft', v_ord_id, v_creator, NULLIF(p_notes, ''))
  RETURNING id, code INTO v_co_id, v_co_code;

  -- ③ 鏡像品項：先建 order_items，再以其 id 建立 consignment_order_items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product := NULLIF(v_item->>'product_id', '')::uuid;
    v_variant := NULLIF(v_item->>'variant_id', '')::uuid;
    v_qty     := COALESCE((v_item->>'quantity')::integer, 0);
    v_price   := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);
    v_cost    := COALESCE(NULLIF(v_item->>'unit_cost', '')::numeric, v_price);

    IF v_product IS NULL THEN
      RAISE EXCEPTION '第 % 項缺少商品', v_idx + 1;
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION '第 % 項數量必須為正整數（收到 %）', v_idx + 1, v_qty;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product) THEN
      RAISE EXCEPTION '商品不存在：%', v_product;
    END IF;
    IF v_variant IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_variant) THEN
      RAISE EXCEPTION '商品變體不存在：%', v_variant;
    END IF;

    INSERT INTO public.order_items (order_id, product_id, variant_id, store_id, quantity,
                                    unit_price, unit_cost, shipped_quantity, status, sort_order)
    VALUES (v_ord_id, v_product, v_variant, p_store_id, v_qty, v_price, v_cost, 0, 'waiting', v_idx)
    RETURNING id INTO v_oi_id;

    INSERT INTO public.consignment_order_items (consignment_order_id, order_item_id, product_id,
                                                variant_id, quantity, unit_price, unit_cost)
    VALUES (v_co_id, v_oi_id, v_product, v_variant, v_qty, v_price, v_cost);

    v_idx   := v_idx + 1;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'consignment_order_id', v_co_id,
    'consignment_code', v_co_code,
    'source_order_id', v_ord_id,
    'source_order_code', v_ord_code,
    'item_count', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_consignment_send_draft(UUID, JSONB, TEXT, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_consignment_send_draft(UUID, JSONB, TEXT, UUID) TO authenticated;