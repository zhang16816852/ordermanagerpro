-- 維修零件多型號支援（2026-11-20）
CREATE TABLE IF NOT EXISTS public.repair_part_device_models (
  repair_part_id UUID NOT NULL REFERENCES public.repair_parts(id) ON DELETE CASCADE,
  device_model_id UUID NOT NULL REFERENCES public.device_models(id) ON DELETE CASCADE,
  PRIMARY KEY (repair_part_id, device_model_id)
);

-- RLS
ALTER TABLE public.repair_part_device_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "repair_part_device_models_admin_all" ON public.repair_part_device_models;
CREATE POLICY "repair_part_device_models_admin_all" ON public.repair_part_device_models FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.system_role));
DROP POLICY IF EXISTS "repair_part_device_models_read" ON public.repair_part_device_models;
CREATE POLICY "repair_part_device_models_read" ON public.repair_part_device_models FOR SELECT TO authenticated USING (true);

-- Backfill from repair_parts.device_model_id
INSERT INTO public.repair_part_device_models (repair_part_id, device_model_id)
SELECT id, device_model_id FROM public.repair_parts WHERE device_model_id IS NOT NULL
ON CONFLICT DO NOTHING;