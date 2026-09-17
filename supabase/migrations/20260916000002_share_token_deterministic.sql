-- ============================================================
-- 決定性分享 token（銷貨單＋寄賣單）
-- 目的：分享 token 由單號（code）決定性推導（HMAC-SHA256），
--   同 code 必得同 token；舊隨機 access_token 仍有效（OR 驗證），
--   不需回填、QR 不失效。
-- 對象：sales_notes、consignment_orders（orders 維持隨機永久 token 不動）。
-- ============================================================

-- 1. 確保 pgcrypto（hmac / gen_random_bytes）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. 私有密鑰表：僅 admin 可讀寫（SECURITY DEFINER 函數以 owner 身分讀取，不受 RLS 阻擋）
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_secrets_admin_all" ON public.app_secrets;
CREATE POLICY "app_secrets_admin_all" ON public.app_secrets
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.system_role));

-- 匿名一律拒（未建 anon policy）

INSERT INTO public.app_secrets (key, value)
VALUES ('share_token_v1', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

-- 3. share_token_for_code：HMAC(code, secret, 'sha256') → 取前 16 bytes → UUID
CREATE OR REPLACE FUNCTION public.share_token_for_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
  v_hex TEXT;
BEGIN
  IF p_code IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT value INTO v_secret FROM public.app_secrets WHERE key = 'share_token_v1';
  IF v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  v_hex := encode(extensions.hmac(p_code::BYTEA, v_secret::BYTEA, 'sha256'), 'hex');

  RETURN (
    substr(v_hex, 1, 8) || '-' ||
    substr(v_hex, 9, 4) || '-' ||
    substr(v_hex, 13, 4) || '-' ||
    substr(v_hex, 17, 4) || '-' ||
    substr(v_hex, 21, 12)
  )::UUID;
END;
$$;

REVOKE ALL ON FUNCTION public.share_token_for_code(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.share_token_for_code(TEXT) TO authenticated;

-- 4. get_shared_sales_note_details：驗證「stored 隨機 token」OR「code 推導 token」
CREATE OR REPLACE FUNCTION public.get_shared_sales_note_details(
  p_identifier TEXT,
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid_id UUID;
  v_result JSONB;
BEGIN
  BEGIN
    v_uuid_id := p_identifier::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_uuid_id := NULL;
  END;

  SELECT jsonb_build_object(
    'sales_note', (
      SELECT jsonb_build_object(
        'id', sn.id,
        'code', sn.code,
        'created_at', sn.created_at,
        'shipped_at', sn.shipped_at,
        'status', sn.status,
        'notes', sn.notes,
        'store_name', s.name,
        'access_token', sn.access_token
      )
      FROM public.sales_notes sn
      JOIN public.stores s ON s.id = sn.store_id
      WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
      AND (sn.access_token = p_token::UUID OR public.share_token_for_code(sn.code) = p_token::UUID)
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'variant_name', pv.name,
          'quantity', sni.quantity,
          'unit_price', oi.unit_price,
          'sort_order', COALESCE(sni.sort_order, 0),
          'item_type', p.item_type,
          'parent_order_item_id', oi.parent_order_item_id,
          'shipping_payment', oi.shipping_payment
        )
        ORDER BY COALESCE(sni.sort_order, 0), oi.sort_order, oi.created_at
      )
      FROM public.sales_note_items sni
      JOIN public.order_items oi ON oi.id = sni.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
      WHERE sni.sales_note_id IN (
        SELECT sn.id FROM public.sales_notes sn
        WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
        AND (sn.access_token = p_token::UUID OR public.share_token_for_code(sn.code) = p_token::UUID)
      )
    )
  ) INTO v_result;

  IF (v_result->'sales_note') IS NULL OR (v_result->'sales_note') = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shared_sales_note_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_sales_note_details(TEXT, TEXT) TO authenticated;

-- 5. get_shared_consignment_details：同上 OR 驗證
CREATE OR REPLACE FUNCTION public.get_shared_consignment_details(
  p_identifier TEXT,
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid_id UUID;
  v_result JSONB;
BEGIN
  BEGIN
    v_uuid_id := p_identifier::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_uuid_id := NULL;
  END;

  SELECT jsonb_build_object(
    'consignment', (
      SELECT jsonb_build_object(
        'id', co.id,
        'code', co.code,
        'direction', co.direction,
        'created_at', co.created_at,
        'status', co.status,
        'notes', co.note,
        'store_name', CASE WHEN co.direction = 'send_to_store' THEN s.name ELSE NULL END,
        'supplier_name', CASE WHEN co.direction = 'receive_from_supplier' THEN sup.name ELSE NULL END,
        'access_token', co.access_token,
        'shipped_at', co.shipped_at
      )
      FROM public.consignment_orders co
      LEFT JOIN public.stores s ON s.id = co.store_id
      LEFT JOIN public.suppliers sup ON sup.id = co.supplier_id
      WHERE (co.id = v_uuid_id OR co.code = p_identifier)
      AND (co.access_token = p_token::UUID OR public.share_token_for_code(co.code) = p_token::UUID)
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'variant_name', pv.name,
          'quantity', coi.quantity,
          'unit_price', coi.unit_price
        )
        ORDER BY coi.created_at
      )
      FROM public.consignment_order_items coi
      JOIN public.products p ON p.id = coi.product_id
      LEFT JOIN public.product_variants pv ON pv.id = coi.variant_id
      WHERE coi.consignment_order_id IN (
        SELECT co.id FROM public.consignment_orders co
        WHERE (co.id = v_uuid_id OR co.code = p_identifier)
        AND (co.access_token = p_token::UUID OR public.share_token_for_code(co.code) = p_token::UUID)
      )
    )
  ) INTO v_result;

  IF (v_result->'consignment') IS NULL OR (v_result->'consignment') = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shared_consignment_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_consignment_details(TEXT, TEXT) TO authenticated;