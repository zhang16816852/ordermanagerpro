-- ============================================================
-- 20260922000003_fix_resolve_delivery_unassigned_record.sql
-- 修正 `_resolve_delivery`：p_delivery_method_id IS NULL 時
-- `v_snap`（RECORD）未被賦值，於 ② 類型推導取 `v_snap.type`
-- 會拋 PL/pgSQL 55000「record "v_snap" is not assigned yet」。
-- 解法：方法類型改用獨立標量 `v_method_type`（恆為已賦值），
-- COALESCE 不再觸碰未指派 record 欄位。行為與 0002 語意完全等價。
-- ⚠️ CREATE OR REPLACE 簽名不變，不新增 overload。
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._resolve_delivery(
  p_delivery_type text DEFAULT NULL,
  p_delivery_method_id uuid DEFAULT NULL,
  p_use_method_type_fallback boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $function$
DECLARE
  v_snap RECORD;
  v_method_type TEXT;
  v_type TEXT;
  v_method_id UUID;
  v_method_title TEXT;
  v_method_code TEXT;
  v_method_price NUMERIC;
  v_method_cost NUMERIC;
  v_default_method_id UUID;
BEGIN
  v_method_id := NULL;
  v_method_type := NULL;
  v_method_title := NULL;
  v_method_code := NULL;
  v_method_price := NULL;
  v_method_cost := NULL;

  -- ① 方法驗證＋快照
  IF p_delivery_method_id IS NOT NULL THEN
    SELECT type, name, code, price, cost INTO v_snap
    FROM public.delivery_methods WHERE id = p_delivery_method_id AND is_active;
    IF v_snap.name IS NULL THEN
      RAISE EXCEPTION '配送方式不存在或已停用（id %）', p_delivery_method_id;
    END IF;
    v_method_id := p_delivery_method_id;
    v_method_type := v_snap.type;
    v_method_title := v_snap.name;
    v_method_code := v_snap.code;
    v_method_price := v_snap.price;
    v_method_cost := v_snap.cost;
  END IF;

  -- ② 類型推導（v_method_type 為已賦值標量，避免未賦值 record 欄位取值 55000）
  IF p_use_method_type_fallback THEN
    v_type := COALESCE(p_delivery_type, v_method_type, 'delivery');
  ELSE
    v_type := COALESCE(p_delivery_type, 'delivery');
  END IF;

  -- ③ delivery：未指定方法時套用預設送貨方法快照
  IF v_type = 'delivery' AND v_method_id IS NULL THEN
    SELECT id INTO v_default_method_id FROM public.delivery_methods
    WHERE type = 'delivery' AND is_default AND is_active
    ORDER BY sort_order, created_at LIMIT 1;
    IF v_default_method_id IS NOT NULL THEN
      SELECT type, name, code, price, cost INTO v_snap
      FROM public.delivery_methods WHERE id = v_default_method_id;
      v_method_id := v_default_method_id;
      v_method_type := v_snap.type;
      v_method_title := v_snap.name;
      v_method_code := v_snap.code;
      v_method_price := v_snap.price;
      v_method_cost := v_snap.cost;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'delivery_type', v_type,
    'method_id', v_method_id,
    'method_title', v_method_title,
    'method_code', v_method_code,
    'method_price', v_method_price,
    'method_cost', v_method_cost
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._resolve_delivery(text, uuid, boolean) FROM public;
REVOKE ALL ON FUNCTION public._resolve_delivery(text, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public._resolve_delivery(text, uuid, boolean) FROM authenticated;

COMMENT ON FUNCTION public._resolve_delivery IS '內部共用：解析配送「類型＋方法快照」；僅供出貨 RPC 呼叫，不對外開放';

NOTIFY pgrst, 'reload schema';

COMMIT;