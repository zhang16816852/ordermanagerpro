-- After variant redesign, `products` is supplementary metadata (name, code, description)
-- while `product_variants` is the main entity. Widen products SELECT to all authenticated users.
DROP POLICY IF EXISTS "Authenticated users can view products" ON public.products;

CREATE POLICY "Authenticated users can view products"
ON public.products
FOR SELECT
TO authenticated
USING (true);
