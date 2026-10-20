-- 補齊規格相關三張表各自的全量快照列
--
-- 根因：check-data-version Edge Function 以「真實表名」查 data_snapshots，
-- 但規格系三張表（specification_definitions / specification_triggers /
-- category_spec_links）過去從未有 snapshot 列（只有過時的 'specs' 一列）。
-- 因此在冷啟動／斷層（needsFullSync）時 snapshot 恆為 null，改以
-- data_change_logs 差集當作「全量」，導致從未被記錄異動的 30 筆規格永久遺失。
--
-- 本 migration 為 additive：保留既有 products / specs / categories 三分支，
-- 另加規格三張表分支，並各寫入一列以真實表名為 key 的快照。
-- 冪等：可重複執行；每次重算 last_sequence_id 為當前 data_change_logs 最大值。

CREATE OR REPLACE FUNCTION public.fn_create_consistent_snapshot(p_table_name text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_seq BIGINT;
    v_json JSONB;
BEGIN
    -- 取得當前最大序號
    SELECT MAX(id) INTO v_seq FROM data_change_logs;

    -- 根據表名執行特定的全量資料封裝
    IF p_table_name = 'products' THEN
        SELECT json_agg(t) INTO v_json FROM (SELECT * FROM products ORDER BY id) t;
    ELSIF p_table_name = 'specs' THEN
        SELECT json_agg(t) INTO v_json FROM (SELECT * FROM specification_definitions ORDER BY sort_order, name) t;
    ELSIF p_table_name = 'categories' THEN
        SELECT json_agg(t) INTO v_json FROM (SELECT * FROM categories ORDER BY sort_order) t;
    ELSIF p_table_name = 'specification_definitions' THEN
        SELECT json_agg(t) INTO v_json FROM (SELECT * FROM specification_definitions ORDER BY sort_order, name) t;
    ELSIF p_table_name = 'specification_triggers' THEN
        SELECT json_agg(t) INTO v_json FROM (SELECT * FROM specification_triggers ORDER BY priority, created_at, id) t;
    ELSIF p_table_name = 'category_spec_links' THEN
        SELECT json_agg(t) INTO v_json FROM (SELECT * FROM category_spec_links ORDER BY sort_order, category_id, spec_id) t;
    END IF;

    -- 原子寫入
    IF v_json IS NOT NULL THEN
        INSERT INTO data_snapshots (table_name, last_sequence_id, data_json, updated_at)
        VALUES (p_table_name, COALESCE(v_seq, 0), v_json, NOW())
        ON CONFLICT (table_name) DO UPDATE SET
            last_sequence_id = EXCLUDED.last_sequence_id,
            data_json = EXCLUDED.data_json,
            updated_at = NOW();
    END IF;
END;
$function$;

-- 立即刷新三張規格表的快照列
SELECT public.fn_create_consistent_snapshot('specification_definitions');
SELECT public.fn_create_consistent_snapshot('specification_triggers');
SELECT public.fn_create_consistent_snapshot('category_spec_links');

-- 權限收斂：此函式僅供內部／service_role 使用（原本 anon 亦可執行＝可寫 data_snapshots 的安全缺口）
REVOKE ALL ON FUNCTION public.fn_create_consistent_snapshot(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_consistent_snapshot(text) TO service_role;
