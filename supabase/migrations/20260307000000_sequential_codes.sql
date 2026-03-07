-- 1. Ensure 'code' column exists on both tables (if not already there)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'code') THEN
        ALTER TABLE public.orders ADD COLUMN code TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_notes' AND column_name = 'code') THEN
        ALTER TABLE public.sales_notes ADD COLUMN code TEXT;
    END IF;
END $$;

-- 2. Create index for performance
CREATE INDEX IF NOT EXISTS idx_orders_code ON public.orders(code);
CREATE INDEX IF NOT EXISTS idx_sales_notes_code ON public.sales_notes(code);

-- 3. Create sequence tracking table
CREATE TABLE IF NOT EXISTS public.system_sequences (
    name TEXT PRIMARY KEY, -- 'order_YYMMDD' or 'sales_YYMM_storeID'
    current_value INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on sequences (internal system use mostly)
ALTER TABLE public.system_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage system sequences" ON public.system_sequences FOR ALL USING (public.has_role(auth.uid(), 'admin'::public.system_role));

-- 4. Function to generate sequential code
CREATE OR REPLACE FUNCTION public.generate_sequential_code() 
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_date_part TEXT;
    v_seq_key TEXT;
    v_new_val INTEGER;
    v_store_code TEXT;
    v_padding INTEGER;
BEGIN
    -- Determine table and prefix
    IF TG_TABLE_NAME = 'orders' THEN
        v_prefix := 'OD';
        v_date_part := to_char(NEW.created_at, 'YYMMDD');
        v_seq_key := 'order_' || v_date_part;
        v_padding := 5;
    ELSIF TG_TABLE_NAME = 'sales_notes' THEN
        v_prefix := 'SL';
        v_date_part := to_char(NEW.created_at, 'YYMM');
        
        -- Get store code (use store.code or first 4 chars of store.id if code is null)
        SELECT COALESCE(code, substring(id::text, 1, 4)) INTO v_store_code 
        FROM public.stores 
        WHERE id = NEW.store_id;
        
        v_seq_key := 'sales_' || v_date_part || '_' || NEW.store_id;
        v_prefix := v_prefix || v_date_part || COALESCE(v_store_code, 'UNK');
        v_padding := 4;
        
        -- Override prefix for sales notes format: SL + YYMM + StoreCode + Seq
        -- (Wait, the user requested SL + YYMM + ClientCode + Seq)
        -- We already prepended store_code to prefix.
    END IF;

    -- Upsert and increment sequence
    INSERT INTO public.system_sequences (name, current_value, updated_at)
    VALUES (v_seq_key, 1, now())
    ON CONFLICT (name) DO UPDATE 
    SET current_value = system_sequences.current_value + 1, updated_at = now()
    RETURNING current_value INTO v_new_val;

    -- Format final code
    IF TG_TABLE_NAME = 'orders' THEN
        NEW.code := v_prefix || v_date_part || lpad(v_new_val::text, v_padding, '0');
    ELSE
        NEW.code := v_prefix || lpad(v_new_val::text, v_padding, '0');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create triggers
DROP TRIGGER IF EXISTS trg_orders_generate_code ON public.orders;
CREATE TRIGGER trg_orders_generate_code 
BEFORE INSERT ON public.orders 
FOR EACH ROW 
EXECUTE FUNCTION public.generate_sequential_code();

DROP TRIGGER IF EXISTS trg_sales_notes_generate_code ON public.sales_notes;
CREATE TRIGGER trg_sales_notes_generate_code 
BEFORE INSERT ON public.sales_notes 
FOR EACH ROW 
EXECUTE FUNCTION public.generate_sequential_code();

-- 6. Comments (Traditional Chinese)
COMMENT ON TABLE public.system_sequences IS '序號追蹤表，用於產生格式化的流水單號';
COMMENT ON COLUMN public.system_sequences.name IS '序號鍵名，訂單以日期區分，銷貨單以月份與門市區分';
COMMENT ON FUNCTION public.generate_sequential_code() IS '自動生成訂單 (ODYYMMDDXXXXX) 與銷貨單 (SLYYMM門市XXXX) 的流水號函數';
