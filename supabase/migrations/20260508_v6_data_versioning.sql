-- ==========================================
-- 規格系統 v6 版本校驗與自動遞增系統 (Triggers & Functions)
-- 備份時間: 2026-05-08
-- ==========================================

-- 1. 確保基礎資料表存在
CREATE TABLE IF NOT EXISTS data_versions (
    table_name TEXT PRIMARY KEY,
    version INTEGER DEFAULT 1,
    last_triggered_by TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 基礎版本遞增函式
-- @param p_table_name: 要遞增哪個目標表 (例如 'products' 或 'specs')
-- @param p_source_table: 是哪張表觸發的更新 (自動取得 TG_TABLE_NAME)
CREATE OR REPLACE FUNCTION bump_data_version(p_table_name text, p_source_table text DEFAULT NULL)
RETURNS void AS $$
BEGIN
    INSERT INTO data_versions (table_name, version, last_triggered_by, updated_at)
    VALUES (p_table_name, 1, p_source_table, NOW())
    ON CONFLICT (table_name) 
    DO UPDATE SET 
        version = data_versions.version + 1,
        last_triggered_by = EXCLUDED.last_triggered_by,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 產品系統觸發函式
CREATE OR REPLACE FUNCTION trigger_bump_products_version()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM bump_data_version('products', TG_TABLE_NAME);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 4. 規格系統觸發函式
CREATE OR REPLACE FUNCTION trigger_bump_specs_version()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM bump_data_version('specs', TG_TABLE_NAME);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 5. 部署觸發器 (Triggers)

-- A. 產品系統 (包含變體)
DROP TRIGGER IF EXISTS trg_bump_products_version ON products;
CREATE TRIGGER trg_bump_products_version
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH STATEMENT EXECUTE FUNCTION trigger_bump_products_version();

DROP TRIGGER IF EXISTS trg_bump_products_version_on_variant ON product_variants;
CREATE TRIGGER trg_bump_products_version_on_variant
AFTER INSERT OR UPDATE OR DELETE ON product_variants
FOR EACH STATEMENT EXECUTE FUNCTION trigger_bump_products_version();

-- B. 規格系統 (定義、連結、規則)
DROP TRIGGER IF EXISTS trg_bump_specs_on_def ON specification_definitions;
CREATE TRIGGER trg_bump_specs_on_def
AFTER INSERT OR UPDATE OR DELETE ON specification_definitions
FOR EACH STATEMENT EXECUTE FUNCTION trigger_bump_specs_version();

DROP TRIGGER IF EXISTS trg_bump_specs_on_links ON category_spec_links;
CREATE TRIGGER trg_bump_specs_on_links
AFTER INSERT OR UPDATE OR DELETE ON category_spec_links
FOR EACH STATEMENT EXECUTE FUNCTION trigger_bump_specs_version();

DROP TRIGGER IF EXISTS trg_bump_specs_on_triggers ON specification_triggers;
CREATE TRIGGER trg_bump_specs_on_triggers
AFTER INSERT OR UPDATE OR DELETE ON specification_triggers
FOR EACH STATEMENT EXECUTE FUNCTION trigger_bump_specs_version();

-- 初始資料
INSERT INTO data_versions (table_name, version) VALUES ('products', 1), ('specs', 1) ON CONFLICT DO NOTHING;
