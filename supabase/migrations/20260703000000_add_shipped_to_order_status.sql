-- Add 'shipped' to order_status enum (was added manually, now captured)
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'shipped';

-- Also ensure 'cancelled' exists in order_item_status
ALTER TYPE public.order_item_status ADD VALUE IF NOT EXISTS 'cancelled';
