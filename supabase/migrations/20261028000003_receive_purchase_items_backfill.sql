-- ============================================================
-- Cost FIFO Phase 2：receive_purchase_items 後補配對
-- 依賴：20261028000002 (_backfill_match_batches)
-- ============================================================
-- 此 migration 以 CREATE OR REPLACE 重發 receive_purchase_items，
-- 在每次建立 product_batches 後呼叫 _backfill_match_batches，
-- 將新批次配對至懸空 movement（pending_match）。
-- 簽名不變：(JSONB, UUID, JSONB) → void
-- ============================================================

-- 注意：此處為 receive_purchase_items 的完整重發，body 與
-- 20261023000005 一致，僅在 serial/batch/none 三路徑的
-- INSERT inventory_movements 之後追加 PERFORM _backfill_match_batches(...)
-- 為避免重複，請以 20261023000005 為基底套用。
--
-- 由於函式體積龐大，此 migration 僅新增一個 AFTER INSERT trigger
-- 在 product_batches 上呼叫 _backfill_match_batches，避免重發整支 RPC。
-- ============================================================

CREATE OR REPLACE FUNCTION public.trgfn_backfill_on_batch_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_product_id UUID;
  v_variant_id UUID;
  v_qty INTEGER;
BEGIN
  v_variant_id := NEW.variant_id;
  v_qty := COALESCE(NEW.quantity, 0);

  -- 取得 product_id
  IF v_variant_id IS NOT NULL THEN
    SELECT pv.product_id INTO v_product_id
    FROM public.product_variants pv
    WHERE pv.id = v_variant_id;
  END IF;

  -- 若無 variant，從 purchase_order_item 取 product
  IF v_product_id IS NULL AND NEW.purchase_order_item_id IS NOT NULL THEN
    SELECT poi.product_id INTO v_product_id
    FROM public.purchase_order_items poi
    WHERE poi.id = NEW.purchase_order_item_id;
  END IF;

  IF v_qty <= 0 THEN
    RETURN NEW;
  END IF;

  -- 呼叫後補配對
  PERFORM public._backfill_match_batches(
    NEW.purchase_order_item_id,
    NEW.id,
    v_variant_id,
    v_product_id,
    v_qty,
    NULL
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_backfill_on_batch_insert ON public.product_batches;
CREATE TRIGGER trg_backfill_on_batch_insert
  AFTER INSERT ON public.product_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.trgfn_backfill_on_batch_insert();

REVOKE ALL ON FUNCTION public.trgfn_backfill_on_batch_insert() FROM public, anon, authenticated;

-- ============================================================
-- End of migration 20261028000003
-- ============================================================