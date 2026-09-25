-- ═══════════════════════════════════════════════════════════════
-- 客戶對帳單分享（月份對帳單）
-- 新表 customer_statement_shares：選店家（客戶）＋日期區間產生一組
-- 分享連結（access_token 隨機、permanent，同 orders 模式）。
-- 管理僅限 admin（RLS）；瀏覽者免登入即可看價格（RPC SECURITY DEFINER + anon）。
-- 分享頁路由 /share/statement/:statementId?token=…
-- ================================================================

CREATE TABLE IF NOT EXISTS public.customer_statement_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  store_id uuid NOT NULL REFERENCES public.stores(id),
  date_from date NOT NULL,
  date_to date NOT NULL,
  access_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_statement_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage customer_statement_shares"
  ON public.customer_statement_shares
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.system_role));

-- ═══════════════════════════════════════════════════════════════
-- 分享 RPC：回傳對帳單表頭＋店家＋區間內全部銷貨單（逐單含品項/運費/收款狀態/內建分享 token）
-- 日期基準＝出貨日（shipped_at）；單據依 shipped_at 升冪排序。
-- 驗證：id＋access_token 隨機 token（不支援決定性 token）。非法 uuid 或驗證不符回 NULL。
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_shared_customer_statement(p_statement_id text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_statement public.customer_statement_shares%ROWTYPE;
  v_result JSONB;
BEGIN
  BEGIN
    SELECT * INTO v_statement
    FROM public.customer_statement_shares cs
    WHERE cs.id = p_statement_id::uuid
      AND cs.access_token = p_token::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'statement', jsonb_build_object(
      'id', v_statement.id,
      'title', v_statement.title,
      'date_from', v_statement.date_from,
      'date_to', v_statement.date_to,
      'created_at', v_statement.created_at
    ),
    'store', (
      SELECT jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'code', s.code,
        'recipient', s.recipient,
        'phone', s.phone,
        'city', s.city,
        'district', s.district,
        'address', s.address
      )
      FROM public.stores s
      WHERE s.id = v_statement.store_id
    ),
    'notes', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', sn.id,
          'code', sn.code,
          'status', sn.status,
          'payment_status', COALESCE(sn.payment_status, 'unpaid'),
          'shipped_at', sn.shipped_at,
          'notes', sn.notes,
          'shipping_fee', sn.shipping_fee,
          'delivery_method_title', sn.delivery_method_title,
          'access_token', sn.access_token,
          'items', (
            SELECT jsonb_agg(
              jsonb_build_object(
                'product_name', p.name,
                'variant_name', pv.name,
                'quantity', sni.quantity,
                'unit_price', oi.unit_price,
                'sort_order', COALESCE(sni.sort_order, 0)
              )
              ORDER BY COALESCE(sni.sort_order, 0), oi.sort_order, oi.created_at
            )
            FROM public.sales_note_items sni
            JOIN public.order_items oi ON oi.id = sni.order_item_id
            JOIN public.products p ON p.id = oi.product_id
            LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
            WHERE sni.sales_note_id = sn.id
          )
        )
        ORDER BY sn.shipped_at, sn.code, sn.id
      ), '[]'::jsonb)
      FROM public.sales_notes sn
      WHERE sn.store_id = v_statement.store_id
        AND sn.shipped_at IS NOT NULL
        AND sn.shipped_at >= (v_statement.date_from::timestamp)
        AND sn.shipped_at < (v_statement.date_to::timestamp + interval '1 day')
    )
  ) INTO v_result;

  IF (v_result->'store') IS NULL OR (v_result->'store') = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_shared_customer_statement(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_shared_customer_statement(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_shared_customer_statement(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_customer_statement(TEXT, TEXT) TO authenticated;