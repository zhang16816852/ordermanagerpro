-- 訂單/訂單項目狀態轉換 RPC 全部改走後端
-- 目的：消除前端直接 UPDATE orders/order_items 的不一致與缺乏 guards

-- RPC 1: 批次確認訂單（pending → processing）
CREATE OR REPLACE FUNCTION public.confirm_orders(p_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_updated integer := 0;
  v_skipped integer := 0;
BEGIN
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION '未選擇訂單';
  END IF;

  -- 只更新 pending 狀態的訂單
  UPDATE public.orders
  SET status = 'processing', updated_at = NOW()
  WHERE id = ANY(p_order_ids)
    AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 計算被跳過的（非 pending 狀態）
  SELECT count(*) INTO v_skipped
  FROM public.orders
  WHERE id = ANY(p_order_ids)
    AND status <> 'pending';

  RETURN jsonb_build_object(
    'updated', v_updated,
    'skipped', v_skipped
  );
END;
$function$;

-- RPC 2: 同步訂單出貨狀態（processing → shipped，若所有品項已出貨）
CREATE OR REPLACE FUNCTION public.sync_order_shipped_status(p_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_updated integer := 0;
  v_order_id uuid;
  v_all_shipped boolean;
BEGIN
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION '未選擇訂單';
  END IF;

  FOR v_order_id IN SELECT unnest(p_order_ids) LOOP
    -- 檢查該訂單的所有品項是否都已處理（shipped/cancelled/discontinued/out_of_stock）
    SELECT NOT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id = v_order_id
        AND oi.status NOT IN ('shipped', 'cancelled', 'discontinued', 'out_of_stock')
        AND oi.line_type NOT IN ('return', 'defective')
    ) INTO v_all_shipped;

    -- 且至少有一個品項已出貨（shipped_quantity > 0 或 status = shipped）
    IF v_all_shipped AND EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id = v_order_id
        AND (oi.shipped_quantity > 0 OR oi.status = 'shipped')
    ) THEN
      UPDATE public.orders
      SET status = 'shipped', updated_at = NOW()
      WHERE id = v_order_id
        AND status IN ('processing', 'pending');
      IF FOUND THEN
        v_updated := v_updated + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated);
END;
$function$;

-- RPC 3: 鎖定訂單為處理中（加入出貨池時，僅 pending 單）
CREATE OR REPLACE FUNCTION public.lock_orders_for_shipping_pool(p_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_updated integer := 0;
BEGIN
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION '未選擇訂單';
  END IF;

  UPDATE public.orders
  SET status = 'processing', updated_at = NOW()
  WHERE id = ANY(p_order_ids)
    AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated);
END;
$function$;

-- RPC 4: 取消/停產品項
CREATE OR REPLACE FUNCTION public.cancel_order_items(p_item_ids uuid[], p_target_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_updated integer := 0;
  v_skipped integer := 0;
BEGIN
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION '未選擇品項';
  END IF;

  IF p_target_status NOT IN ('cancelled', 'discontinued', 'waiting') THEN
    RAISE EXCEPTION '無效的目標狀態：%', p_target_status;
  END IF;

  -- 只允許 waiting/partial 狀態的品項被取消/停產
  UPDATE public.order_items
  SET status = p_target_status, updated_at = NOW()
  WHERE id = ANY(p_item_ids)
    AND status IN ('waiting', 'partial');

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 計算被跳過的（已出貨或已取消）
  SELECT count(*) INTO v_skipped
  FROM public.order_items
  WHERE id = ANY(p_item_ids)
    AND status NOT IN ('waiting', 'partial');

  RETURN jsonb_build_object(
    'updated', v_updated,
    'skipped', v_skipped
  );
END;
$function$;

-- RPC 5: 切換訂單狀態（pending ↔ processing）
CREATE OR REPLACE FUNCTION public.toggle_order_status(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_order RECORD;
  v_new_status text;
  v_has_shipped boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單不存在';
  END IF;

  IF v_order.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION '僅未確認或處理中的訂單可切換狀態';
  END IF;

  -- 如果有已出貨品項，不可回退到 pending
  IF v_order.status = 'processing' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id = p_order_id AND oi.shipped_quantity > 0
    ) INTO v_has_shipped;
    IF v_has_shipped THEN
      RAISE EXCEPTION '已有出貨紀錄，無法回退為未確認';
    END IF;
  END IF;

  v_new_status := CASE WHEN v_order.status = 'pending' THEN 'processing' ELSE 'pending' END;

  UPDATE public.orders
  SET status = v_new_status, updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('new_status', v_new_status);
END;
$function$;

-- 權限設定
REVOKE ALL ON FUNCTION public.confirm_orders(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_orders(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.sync_order_shipped_status(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sync_order_shipped_status(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.lock_orders_for_shipping_pool(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lock_orders_for_shipping_pool(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_order_items(uuid[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order_items(uuid[], text) TO authenticated;

REVOKE ALL ON FUNCTION public.toggle_order_status(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.toggle_order_status(uuid) TO authenticated;