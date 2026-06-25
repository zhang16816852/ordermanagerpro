-- 當 entity_model_relations 異動時 bump products 版號，確保 useProductCache 能偵測到變更

DROP TRIGGER IF EXISTS trg_bump_products_version_on_entity_model_relations ON entity_model_relations;
CREATE TRIGGER trg_bump_products_version_on_entity_model_relations
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON entity_model_relations
FOR EACH STATEMENT EXECUTE FUNCTION trigger_bump_products_version();
