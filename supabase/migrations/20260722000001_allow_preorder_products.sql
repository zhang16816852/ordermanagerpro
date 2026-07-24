-- Allow preorder products to be visible in storefront
-- Currently only 'active' products are visible to non-admin users
-- This changes the policy to also include 'preorder' status

DROP POLICY IF EXISTS "Authenticated users can view active products" ON public.products;

CREATE POLICY "Authenticated users can view active products" ON public.products
  FOR SELECT USING (
    status IN ('active'::product_status, 'preorder'::product_status)
    OR has_role(auth.uid(), 'admin'::system_role)
  );
