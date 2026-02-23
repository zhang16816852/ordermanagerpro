-- Create junction table for Product-Category M:N
CREATE TABLE IF NOT EXISTS public.product_category_links (
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

-- Enable RLS
ALTER TABLE public.product_category_links ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY "Allow all authenticated users to read product_category_links"
    ON public.product_category_links FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated users to insert product_category_links"
    ON public.product_category_links FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update product_category_links"
    ON public.product_category_links FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated users to delete product_category_links"
    ON public.product_category_links FOR DELETE
    TO authenticated
    USING (true);

-- Migrate existing data from products table
INSERT INTO public.product_category_links (product_id, category_id)
SELECT id, category_id 
FROM public.products 
WHERE category_id IS NOT NULL;
