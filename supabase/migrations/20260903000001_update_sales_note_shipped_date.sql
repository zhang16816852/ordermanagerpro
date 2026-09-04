-- 1. orders 表新增 access_token 欄位，保存最後一次出貨的分享 token
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS access_token UUID;

-- 2. 更新銷貨單出貨日期 RPC（僅日期精度）
CREATE OR REPLACE FUNCTION public.update_sales_note_shipped_date(
  p_sales_note_id UUID,
  p_date DATE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.sales_notes
  SET shipped_at = p_date::TIMESTAMPTZ,
      updated_at = NOW()
  WHERE id = p_sales_note_id;
END;
$$;
