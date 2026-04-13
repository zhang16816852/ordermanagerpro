-- 建立變體與型號的關聯表 (Many-to-Many)
CREATE TABLE public.variant_model_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES public.device_models(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(variant_id, model_id)
);

-- 設定 RLS
ALTER TABLE public.variant_model_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage variant models" ON public.variant_model_links FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.system_role));
CREATE POLICY "Users can view variant models" ON public.variant_model_links FOR SELECT TO authenticated USING (true);
