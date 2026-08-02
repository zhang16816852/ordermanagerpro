-- After variant redesign, option groups/values/variant-links are catalog metadata
-- (colors, sizes, names) that all authenticated users need to render the storefront.
-- The previous SELECT policies incorrectly required the admin role, so non-admin
-- users silently received empty arrays. Widen SELECT to all authenticated users,
-- matching the products / product_variants fix.
DROP POLICY IF EXISTS "Authenticated users can view option groups" ON public.product_option_groups;

CREATE POLICY "Authenticated users can view option groups"
ON public.product_option_groups
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can view option values" ON public.product_option_values;

CREATE POLICY "Authenticated users can view option values"
ON public.product_option_values
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can view variant options" ON public.product_variant_options;

CREATE POLICY "Authenticated users can view variant options"
ON public.product_variant_options
FOR SELECT
TO authenticated
USING (true);
