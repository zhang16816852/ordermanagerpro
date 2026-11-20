-- 維修零件排序（2026-11-20）
ALTER TABLE public.repair_parts
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- backfill: 依 created_at
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY device_model_id ORDER BY created_at, id) AS rn
  FROM public.repair_parts
)
UPDATE public.repair_parts rp
SET sort_order = r.rn
FROM ranked r
WHERE r.id = rp.id AND rp.sort_order = 0;

CREATE OR REPLACE FUNCTION public.reorder_repair_parts(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_id UUID;
  v_order INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可排序');
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_id := (v_item->>'id')::UUID;
    v_order := (v_item->>'sort_order')::INTEGER;
    UPDATE public.repair_parts SET sort_order = v_order WHERE id = v_id;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_repair_parts(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_repair_parts(JSONB) TO authenticated;