-- Add source_order_ids to purchase_order_items to track which orders contributed to each PO item.
-- This prevents duplicate purchasing by recording the origin orders.
ALTER TABLE purchase_order_items
ADD COLUMN IF NOT EXISTS source_order_ids UUID[];
