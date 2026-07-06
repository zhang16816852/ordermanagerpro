-- 修復直接以 shipped 狀態建立的訂單無法取得 OD 單號的問題
-- 調整 generate_sequential_code() 讓 shipped 狀態的 INSERT 也能產號

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
        -- 訂單：processing 或 shipped 狀態時給號
        -- (支援直接以 shipped 建立的訂單，例如 create_order_with_sales_note RPC)
        IF (TG_OP = 'INSERT' AND NEW.status IN ('processing', 'shipped')) OR 
           (TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status IN ('processing', 'shipped')) THEN
            v_should_generate := TRUE;
        END IF;
    ELSIF TG_TABLE_NAME = 'sales_notes' THEN
        -- 銷貨單：只要不是 draft 狀態就給號
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
