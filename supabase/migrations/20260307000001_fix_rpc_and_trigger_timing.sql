-- 1. 更新 RPC 函數：在回傳的 JSON 中包含 code 欄位

-- 修復獲取分享銷貨單詳情的函數
CREATE OR REPLACE FUNCTION public.get_shared_sales_note_details(
  p_sales_note_id UUID,
  p_token TEXT
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT jsonb_build_object(
    'sales_note', (
      SELECT jsonb_build_object(
        'id', sn.id,
        'code', sn.code, -- 重要：加入此欄位以利前端顯示
        'created_at', sn.created_at,
        'status', sn.status,
        'notes', sn.notes,
        'store_name', s.name
      )
      FROM public.sales_notes sn
      JOIN public.stores s ON s.id = sn.store_id
      WHERE sn.id = p_sales_note_id
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'quantity', sni.quantity,
          'unit_price', oi.unit_price
        )
      )
      FROM public.sales_note_items sni
      JOIN public.order_items oi ON oi.id = sni.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      WHERE sni.sales_note_id = p_sales_note_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 修復獲取分享訂單詳情的函數
CREATE OR REPLACE FUNCTION public.get_shared_order_details(
  p_order_id UUID,
  p_token TEXT
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT jsonb_build_object(
    'order', (
      SELECT jsonb_build_object(
        'id', o.id,
        'code', o.code, -- 重要：加入此欄位以利前端顯示
        'created_at', o.created_at,
        'status', o.status,
        'notes', o.notes,
        'store_name', s.name
      )
      FROM public.orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE o.id = p_order_id
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price
        )
      )
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = p_order_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 2. 調整觸發器規則：延後到「處理中」或「出貨/已建單」時才正式產號

CREATE OR REPLACE FUNCTION public.generate_sequential_code() 
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_date_part TEXT;
    v_seq_key TEXT;
    v_new_val INTEGER;
    v_store_code TEXT;
    v_padding INTEGER;
    v_should_generate BOOLEAN := FALSE;
BEGIN
    -- [判斷產號時機]
    IF TG_TABLE_NAME = 'orders' THEN
        -- 訂單：只有當狀態從 pending 變為 processing 時才給號
        -- (或是 INSERT 時直接就是 processing 狀態)
        IF (TG_OP = 'INSERT' AND NEW.status = 'processing') OR 
           (TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'processing') THEN
            v_should_generate := TRUE;
        END IF;
    ELSIF TG_TABLE_NAME = 'sales_notes' THEN
        -- 銷貨單：只要不是 draft 狀態就給號
        -- (例如從出貨池建立時直接是 shipped 狀態)
        IF (TG_OP = 'INSERT' AND NEW.status != 'draft') OR 
           (TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status != 'draft') THEN
            v_should_generate := TRUE;
        END IF;
    END IF;

    -- 已有單號或不符合產號條件則跳過
    IF NOT v_should_generate OR NEW.code IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- [產號邏輯]
    IF TG_TABLE_NAME = 'orders' THEN
        v_prefix := 'OD';
        v_date_part := to_char(NEW.created_at, 'YYMMDD');
        v_seq_key := 'order_' || v_date_part;
        v_padding := 5;
    ELSIF TG_TABLE_NAME = 'sales_notes' THEN
        v_prefix := 'SL';
        v_date_part := to_char(NEW.created_at, 'YYMM');
        -- 取得門市代碼
        SELECT COALESCE(code, substring(id::text, 1, 4)) INTO v_store_code 
        FROM public.stores 
        WHERE id = NEW.store_id;
        v_seq_key := 'sales_' || v_date_part || '_' || NEW.store_id;
        v_prefix := v_prefix || v_date_part || COALESCE(v_store_code, 'UNK');
        v_padding := 4;
    END IF;

    -- 序號計數器存取
    INSERT INTO public.system_sequences (name, current_value, updated_at)
    VALUES (v_seq_key, 1, now())
    ON CONFLICT (name) DO UPDATE 
    SET current_value = system_sequences.current_value + 1, updated_at = now()
    RETURNING current_value INTO v_new_val;

    -- 格式化輸出
    IF TG_TABLE_NAME = 'orders' THEN
        NEW.code := v_prefix || v_date_part || lpad(v_new_val::text, v_padding, '0');
    ELSE
        NEW.code := v_prefix || lpad(v_new_val::text, v_padding, '0');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 更新觸發器至 BEFORE INSERT OR UPDATE
DROP TRIGGER IF EXISTS trg_orders_generate_code ON public.orders;
CREATE TRIGGER trg_orders_generate_code 
BEFORE INSERT OR UPDATE ON public.orders 
FOR EACH ROW 
EXECUTE FUNCTION public.generate_sequential_code();

DROP TRIGGER IF EXISTS trg_sales_notes_generate_code ON public.sales_notes;
CREATE TRIGGER trg_sales_notes_generate_code 
BEFORE INSERT OR UPDATE ON public.sales_notes 
FOR EACH ROW 
EXECUTE FUNCTION public.generate_sequential_code();
