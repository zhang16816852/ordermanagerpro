-- get_public_category_specs：回傳分類（含子分類）適用的 spec definitions（schema-level）
-- 讓 Shop 公開端能顯示 spec 欄位名稱，即使產品尚未填值（對齊 Admin 行為）
DROP FUNCTION IF EXISTS public.get_public_category_specs(uuid);
CREATE OR REPLACE FUNCTION public.get_public_category_specs(p_category_id uuid)
RETURNS TABLE (
  spec_id    uuid,
  spec_name  text,
  spec_type  text,
  sort_order int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH RECURSIVE subcats(id) AS (
    SELECT p_category_id
    WHERE p_category_id IS NOT NULL
    UNION
    SELECT ch.child_id
    FROM public.category_hierarchy ch
    JOIN subcats s ON ch.parent_id = s.id
  )
  SELECT
    sd.id AS spec_id,
    sd.name AS spec_name,
    sd.type AS spec_type,
    sd.sort_order
  FROM public.category_spec_links csl
  JOIN public.specification_definitions sd ON sd.id = csl.spec_id
  WHERE csl.category_id IN (SELECT id FROM subcats)
    AND (csl.deleted_at IS NULL)
  ORDER BY sd.sort_order ASC NULLS LAST, sd.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_category_specs(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_category_specs(uuid) TO anon, authenticated;
