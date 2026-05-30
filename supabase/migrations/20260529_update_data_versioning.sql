-- ==========================================
-- 規格系統 v8.1 版本校驗日期+流水號升級 (YYMMDD-xxxx)
-- 時間: 2026-05-29
-- ==========================================

-- 1. 修改版本號與快照欄位型態為 TEXT
ALTER TABLE public.data_versions ALTER COLUMN version TYPE TEXT;
ALTER TABLE public.data_snapshots ALTER COLUMN last_sequence_id TYPE TEXT;

-- 2. 建立封裝函數：組裝與拆解版本號
-- 採用台北時間 YYMMDD-xxxx 格式
CREATE OR REPLACE FUNCTION public.fn_pack_data_version(p_date text, p_seq int)
RETURNS text AS $$
BEGIN
    RETURN p_date || '-' || lpad(p_seq::text, 4, '0');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.fn_unpack_data_version(p_version text, OUT r_date text, OUT r_seq int)
AS $$
DECLARE
    v_parts text[];
BEGIN
    IF p_version IS NULL OR p_version = '' THEN
        r_date := to_char(timezone('Asia/Taipei', NOW()), 'YYMMDD');
        r_seq := 0;
        RETURN;
    END IF;
    
    v_parts := string_to_array(p_version, '-');
    IF array_length(v_parts, 1) = 2 THEN
        r_date := v_parts[1];
        r_seq := COALESCE(v_parts[2]::int, 0);
    ELSE
        -- 回退機制 (非預期格式，例如舊版整數型態)
        r_date := to_char(timezone('Asia/Taipei', NOW()), 'YYMMDD');
        r_seq := 0;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. 重寫並升級核心 bump_data_version
CREATE OR REPLACE FUNCTION public.bump_data_version(p_table_name text, p_source_table text DEFAULT NULL)
RETURNS void AS $$
DECLARE
    v_today text;
    v_current_version text;
    v_curr_date text;
    v_curr_seq int;
    v_next_version text;
BEGIN
    -- 取得台北時間 YYMMDD
    v_today := to_char(timezone('Asia/Taipei', NOW()), 'YYMMDD');
    
    -- 讀取當前版本
    SELECT version INTO v_current_version
    FROM public.data_versions
    WHERE table_name = p_table_name;
    
    IF v_current_version IS NOT NULL AND v_current_version LIKE '%-%' THEN
        -- 拆解現有版本
        SELECT r_date, r_seq INTO v_curr_date, v_curr_seq FROM public.fn_unpack_data_version(v_current_version);
        
        IF v_curr_date = v_today THEN
            -- 同一天，序號 + 1
            v_next_version := public.fn_pack_data_version(v_today, v_curr_seq + 1);
        ELSE
            -- 不同天，歸零從 1 開始
            v_next_version := public.fn_pack_data_version(v_today, 1);
        END IF;
    ELSE
        -- 初始狀態或舊格式
        v_next_version := public.fn_pack_data_version(v_today, 1);
    END IF;

    INSERT INTO public.data_versions (table_name, version, last_triggered_by, updated_at)
    VALUES (p_table_name, v_next_version, p_source_table, NOW())
    ON CONFLICT (table_name) 
    DO UPDATE SET 
        version = EXCLUDED.version,
        last_triggered_by = EXCLUDED.last_triggered_by,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 重新對接舊 trigger 函數以確保相容
CREATE OR REPLACE FUNCTION public.notify_product_image_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM public.bump_data_version('products', 'product_images');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.increment_data_version()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.bump_data_version(TG_ARGV[0], TG_TABLE_NAME);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
