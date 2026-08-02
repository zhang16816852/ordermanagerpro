-- 讓 category_hierarchy 的變動觸發 'categories' 版本更新
-- categoryHierarchy 在 IndexedDB 中與 categories 捆綁，共用 'categories' 版本鍵
-- 此前 category_hierarchy 的 INSERT/UPDATE/DELETE 不會 bump 任何版本，
-- 導致客戶端快取與 Supabase 資料不同步

DROP TRIGGER IF EXISTS trg_bump_categories_version_on_hierarchy ON public.category_hierarchy;
CREATE TRIGGER trg_bump_categories_version_on_hierarchy
  AFTER INSERT OR UPDATE OR DELETE ON public.category_hierarchy
  FOR EACH STATEMENT
  EXECUTE FUNCTION bump_categories_version();
