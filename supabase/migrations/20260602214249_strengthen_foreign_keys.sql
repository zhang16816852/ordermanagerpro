-- Add missing foreign key constraints for user references
-- These were defined in the initial schema but missing from the actual database.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_created_by_fkey'
    ) THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES auth.users(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sales_notes_created_by_fkey'
    ) THEN
        ALTER TABLE public.sales_notes ADD CONSTRAINT sales_notes_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES auth.users(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sales_notes_received_by_fkey'
    ) THEN
        ALTER TABLE public.sales_notes ADD CONSTRAINT sales_notes_received_by_fkey
            FOREIGN KEY (received_by) REFERENCES auth.users(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'shipping_pool_created_by_fkey'
    ) THEN
        ALTER TABLE public.shipping_pool ADD CONSTRAINT shipping_pool_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES auth.users(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stores_owner_id_fkey'
    ) THEN
        ALTER TABLE public.stores ADD CONSTRAINT stores_owner_id_fkey
            FOREIGN KEY (owner_id) REFERENCES auth.users(id);
    END IF;
END;
$$;
