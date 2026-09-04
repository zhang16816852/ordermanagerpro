-- 修復刪除銷貨單時 FK SET NULL 違反 chk_invmov_source_fk (23514)
-- 現象：delete_sales_note 刪除 sales_notes 時，FK inventory_movements.sales_note_id ON DELETE SET NULL
--       將舊 sales_shipment 設為 NULL，但舊 chk 要求 sales_shipment 必含 sales_note_id NOT NULL → 23514
--       Failing row: sales_shipment, sales_note_id=null, reference_code=SL2609XT0010001
-- 修正：放寬 chk 為僅約束「不相關 FK 必為 NULL」，允許相關 FK 為 NULL（歷史孤兒）
--       與 FK SET NULL 語意一致，保留歷史 movement 供稽核
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS chk_invmov_source_fk;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT chk_invmov_source_fk CHECK (
    (source_type IN ('purchase_receipt', 'purchase_return')
      AND sales_note_id IS NULL AND consignment_order_id IS NULL)
    OR
    (source_type IN ('sales_shipment', 'sales_note_deletion', 'customer_return')
      AND purchase_order_id IS NULL AND consignment_order_id IS NULL)
    OR
    (source_type IN ('consignment_in_receipt', 'consignment_in_return', 'consignment_out_shipment', 'consignment_out_sale', 'consignment_out_return', 'consignment_sale_reversal', 'consignment_shipment_reversal')
      AND purchase_order_id IS NULL)
    OR
    (source_type IN ('scrap', 'transfer', 'manual_adjustment', 'system_recalculation')
      AND purchase_order_id IS NULL AND sales_note_id IS NULL AND consignment_order_id IS NULL)
  );
