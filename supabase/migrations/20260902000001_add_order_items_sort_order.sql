-- Add sort_order column to order_items for stable custom ordering.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Backfill existing rows: assign sort_order based on insertion order per order.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at, id) AS rn
  FROM public.order_items
)
UPDATE public.order_items oi
SET sort_order = r.rn
FROM ranked r
WHERE oi.id = r.id
  AND oi.sort_order = 0;

-- Ensure the column is NOT NULL for new rows (default 0 remains).
ALTER TABLE public.order_items
  ALTER COLUMN sort_order SET NOT NULL;
