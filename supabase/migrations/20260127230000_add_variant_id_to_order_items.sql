-- Add variant_id to order_items table
alter table public.order_items
add column variant_id uuid references public.product_variants(id);

-- Optional: Create index for performance
create index idx_order_items_variant_id on public.order_items(variant_id);
