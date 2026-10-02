-- ============================================================
-- 寄賣鏡像完整性收緊
--
-- ① chk_consignment_send_to_store_source_order 由「僅 draft/cancelled 可無來源」
--    收緊為「send_to_store 一律須有 source_order_id」。
--    原始寬鬆版（`status IN ('draft','cancelled') OR source_order_id IS NOT NULL`）
--    正是孤兒寄賣草稿的成因：舊 useConsignment.createOrderMutation 先無來源
--    INSERT 寄賣單、再另外建立來源訂單並回填，中途失敗就留下無來源草稿。
--    該路徑已改為呼叫 create_consignment_send_draft（單一交易），加上
--    import_consignment_batch（20261002000003）、convert_order_to_consignment_draft
--    與 create_consignment_send_draft，四條寫入路徑皆保證帶來源訂單，
--    線上既有資料亦為 0 筆違規，故可安全收緊。
--
-- ② 新增跨表 trigger：consignment_order_items.order_item_id 若有值，
--    必須屬於該寄賣單的來源訂單，避免鏡像指向別張訂單的品項。
--    order_item_id 為 NULL 是合法狀態（FK 為 ON DELETE SET NULL，
--    刪除被參照的 order_items 會自動解除連結），故 NULL 一律放行。
--
-- 查詢驗證（套用前實測）：
--   send_to_store 且無 source_order_id = 0
--   order_item_id 與 source_order_id 不一致 = 0
--   order_item_id 為 NULL = 0
-- ============================================================

-- ① send_to_store 一律須有來源訂單（先 NOT VALID 再 VALIDATE，避免長時間鎖表）
ALTER TABLE public.consignment_orders
  DROP CONSTRAINT IF EXISTS chk_consignment_send_to_store_source_order;

ALTER TABLE public.consignment_orders
  ADD CONSTRAINT chk_consignment_send_to_store_source_order
  CHECK (direction <> 'send_to_store' OR source_order_id IS NOT NULL) NOT VALID;

ALTER TABLE public.consignment_orders
  VALIDATE CONSTRAINT chk_consignment_send_to_store_source_order;

-- ② 跨表鏡像一致性
CREATE OR REPLACE FUNCTION public._assert_consignment_mirror_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_source_order_id uuid;
BEGIN
  -- 未建立鏡像連結的品項合法（見檔頭說明）
  IF NEW.order_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT co.source_order_id INTO v_source_order_id
  FROM public.consignment_orders co
  WHERE co.id = NEW.consignment_order_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.order_items oi
    WHERE oi.id = NEW.order_item_id
      AND oi.order_id IS NOT DISTINCT FROM v_source_order_id
  ) THEN
    RAISE EXCEPTION '寄賣品項的鏡像訂單品項不屬於該寄賣單的來源訂單（寄賣單 %、訂單品項 %）',
      NEW.consignment_order_id, NEW.order_item_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_consignment_mirror_order() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_consignment_mirror_order ON public.consignment_order_items;

CREATE TRIGGER trg_consignment_mirror_order
BEFORE INSERT OR UPDATE OF order_item_id, consignment_order_id
ON public.consignment_order_items
FOR EACH ROW
EXECUTE FUNCTION public._assert_consignment_mirror_order();