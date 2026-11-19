-- 修復 cancel_order_items：status 欄位為 order_item_status enum，p_target_status 為 text
-- 原 SQL `SET status = p_target_status` 會拋 "column status is of type order_item_status but expression is of type text"
-- 加上 ::public.order_item_status cast 修正；並在 target='discontinued' 時同步變更產品/變體上架狀態。
CREATE OR REPLACE FUNCTION public.cancel_order_items(p_item_ids uuid[], p_target_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_updated integer := 0;
  v_skipped integer := 0;
  v_item RECORD;
BEGIN
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION '未選擇品項';
  END IF;

  IF p_target_status NOT IN ('cancelled', 'discontinued', 'waiting') THEN
    RAISE EXCEPTION '無效的目標狀態：%', p_target_status;
  END IF;

  -- 只允許 waiting/partial 狀態的品項被取消/停產
  UPDATE public.order_items
  SET status = p_target_status::public.order_item_status, updated_at = NOW()
  WHERE id = ANY(p_item_ids)
    AND status IN ('waiting'::public.order_item_status, 'partial'::public.order_item_status);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 計算被跳過的（已出貨或已取消）
  SELECT count(*) INTO v_skipped
  FROM public.order_items
  WHERE id = ANY(p_item_ids)
    AND status NOT IN ('waiting'::public.order_item_status, 'partial'::public.order_item_status);

  -- 停產：同步變更產品/變體上架狀態
  IF p_target_status = 'discontinued' THEN
    FOR v_item IN
      SELECT DISTINCT product_id, variant_id
      FROM public.order_items
      WHERE id = ANY(p_item_ids)
        AND status = 'discontinued'::public.order_item_status
    LOOP
      IF v_item.variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET status = 'discontinued', updated_at = NOW()
        WHERE id = v_item.variant_id;
      END IF;
      IF v_item.product_id IS NOT NULL THEN
        UPDATE public.products
        SET status = 'discontinued', updated_at = NOW()
        WHERE id = v_item.product_id
          AND NOT EXISTS (
            SELECT 1 FROM public.product_variants pv
            WHERE pv.product_id = v_item.product_id
              AND pv.status <> 'discontinued'
          );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'skipped', v_skipped
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_order_items(uuid[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order_items(uuid[], text) TO authenticated;