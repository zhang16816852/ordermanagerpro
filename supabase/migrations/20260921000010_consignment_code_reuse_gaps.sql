-- ============================================================
-- 20260921000010_consignment_code_reuse_gaps.sql
-- 寄賣單號改遞補制（與銷貨單一致），根治 23505 撞碼
-- ============================================================
-- 背景：next_consignment_code 原以 system_sequences 的
--   consignment_{YYMM}_{store_id} key 累加產號；但店家既有單號
--   屬舊 key 世代（未回填這組新 key）→ 首次產號又從 1 起，
--   生成 …0001 與既有單撞號（consignment_orders.code UNIQUE
--   → 23505）。
-- 做法：改為遞補制——以既有 consignment_orders.code 為唯一真值，
--   找「該店家該月份」第一個空缺號碼（store_id IS NOT DISTINCT
--   FROM 分群；receive_from_supplier 共用 'SP'），
--   pg_advisory_xact_lock(hashtext(v_seq_key)) 防並行。
--   不再依賴 system_sequences（舊 consignment_* 序列 key 成孤立、
--   無害）。
--   驗證：SMALLP001 → CS2609SMALLP0010003、全新店家 → CS2609{店碼}0001、
--   SP → CS2609SP0001。
-- 已知風險：刪單後重用空缺號碼 + 決定性分享 token
--   （share_token_for_code）⇒ 持舊單決定性連結者會看到新單
--   （同 sales_notes 的已知權衡）。
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.next_consignment_code(
  p_shipped_at timestamptz,
  p_store_id uuid
) RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $function$
DECLARE
  v_yy TEXT;
  v_seq_key TEXT;
  v_new_val INTEGER;
  v_store_code TEXT;
  v_prefix TEXT;
BEGIN
  p_shipped_at := COALESCE(p_shipped_at, NOW());

  SELECT COALESCE(code, substring(id::text, 1, 4)) INTO v_store_code
  FROM public.stores WHERE id = p_store_id;

  v_store_code := COALESCE(v_store_code, 'SP');

  v_yy := to_char(p_shipped_at, 'YYMM');
  v_seq_key := 'consignment_' || v_yy || '_' || COALESCE(p_store_id::text, 'SP');
  v_prefix := 'CS' || v_yy || v_store_code;

  -- 並行保護（同銷貨單遞補制）
  PERFORM pg_advisory_xact_lock(hashtext(v_seq_key));

  -- 遞補制：找第一個空缺號碼（store_id 分群；receive_from_supplier 共用 'SP'）
  SELECT COALESCE(
    (SELECT t.n
     FROM generate_series(1, 9999) t(n)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.consignment_orders co
       WHERE co.code = v_prefix || lpad(t.n::text, 4, '0')
         AND co.store_id IS NOT DISTINCT FROM p_store_id
     )
     ORDER BY t.n
     LIMIT 1),
    1
  ) INTO v_new_val;

  RETURN v_prefix || lpad(v_new_val::text, 4, '0');
END;
$function$;

REVOKE ALL ON FUNCTION public.next_consignment_code(timestamptz, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.next_consignment_code(timestamptz, uuid) TO authenticated;

COMMIT;