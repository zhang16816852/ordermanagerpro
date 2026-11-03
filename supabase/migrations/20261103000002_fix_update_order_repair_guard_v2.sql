-- 20261103000002_fix_update_order_repair_guard_v2.sql
-- 修復 update_order_with_items 的 line_type ↔ return_status / is_repair 守門：
-- 舊 guard 把 'exchange'（換貨）排除在可設 is_repair 的清單之外，
-- 導致「送修」（exchange + is_repair = true）儲存時被擋下
-- （reason: 僅退貨列可設定 return_status / is_repair）。
-- 新 guard 拆成兩條獨立條件：
--   (A) return_status 只允許退貨列／瑕疵列
--   (B) is_repair 只允許退貨列／換貨列（送修 = exchange + is_repair）
-- 以遠端當前 prosrc 為基底做 in-place patch，避免把狀態收斂等後續修正還原。

DO $$
DECLARE
  v_body text;
BEGIN
  SELECT prosrc INTO v_body FROM pg_proc WHERE proname = 'update_order_with_items';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'update_order_with_items not found';
  END IF;

  -- 若已套用（含新 reason 文字）則跳過
  IF position('僅退貨列／瑕疵列可設定 return_status' in v_body) = 0 THEN
    v_body := regexp_replace(
      v_body,
      '-- 3\\) line_type.*?-- 1\\. 更新訂單備註',
      $newguard$-- 3) line_type ↔ return_status / is_repair 組合校驗
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS el
      LEFT JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND (el->>'id') IS NOT NULL
      WHERE COALESCE(NULLIF(el->>'line_type', ''), oi.line_type, 'sale') NOT IN ('return', 'defective')
        AND NULLIF(el->>'return_status', '') IS NOT NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '僅退貨列／瑕疵列可設定 return_status');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS el
      LEFT JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND (el->>'id') IS NOT NULL
      WHERE COALESCE(NULLIF(el->>'line_type', ''), oi.line_type, 'sale') NOT IN ('return', 'exchange')
        AND COALESCE((el->>'is_repair')::boolean, false)
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '僅退貨列／換貨列可設定 is_repair');
    END IF;
  END IF;

  -- 1. 更新訂單備註$newguard$,
      's'
    );
  END IF;

  EXECUTE 'CREATE OR REPLACE FUNCTION public.update_order_with_items(' ||
          'p_order_id UUID, ' ||
          'p_notes TEXT DEFAULT NULL, ' ||
          'p_items JSONB DEFAULT ''[]''::jsonb, ' ||
          'p_deleted_item_ids UUID[] DEFAULT ''{}''::uuid[]) ' ||
          'RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$' ||
          v_body || '$body$;';

  REVOKE ALL ON FUNCTION public.update_order_with_items(UUID, TEXT, JSONB, UUID[]) FROM public, anon;
  GRANT EXECUTE ON FUNCTION public.update_order_with_items(UUID, TEXT, JSONB, UUID[]) TO authenticated;
END $$;
