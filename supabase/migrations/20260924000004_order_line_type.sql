-- ============================================================
-- 20260924000004_order_line_type.sql
-- 訂單退貨/換貨/送修（order line 層級整合）
--
-- 1) order_items 新增 line_type / line_note / return_status / is_repair：
--    - line_type = 'sale'（一般，預設）| 'exchange'（換貨新貨）| 'return'（退貨/送修）
--    - return_status 僅適用 return 列：pending（待結清）/ stock（已退庫存）/ exchange（已換貨）/ repaired（送修已歸還）
--    - is_repair 僅適用 return 列（送修標記；純維修列 unit_price=0、pending、is_repair=true）
--    - line_note：v1 廠商往返只記註記（如「送廠：○○公司」）
-- 2) 遷移既有唯一一筆歷史銷貨退貨（SL2609JR0010001）為 order 上的 return 列（已退庫存、無退款）
-- 3) 刪除舊退貨表 sales_note_returns / sales_note_return_items 與 RPC process_sales_note_return
-- 4) 重建 delete_order_if_unadopted：退貨守門改看 line_type='return'（不再參照舊表）
-- ============================================================

-- ------------------------------------------------------------
-- 1) order_items 新增 line 屬性
-- ------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN line_type text NOT NULL DEFAULT 'sale',
  ADD COLUMN line_note text,
  ADD COLUMN return_status text,
  ADD COLUMN is_repair boolean NOT NULL DEFAULT false;

ALTER TABLE public.order_items
  ADD CONSTRAINT chk_order_item_line_type
    CHECK (line_type IN ('sale', 'exchange', 'return')),
  ADD CONSTRAINT chk_order_item_return_status_scope
    CHECK (
      CASE WHEN line_type = 'return'
        THEN return_status IS NOT NULL AND return_status IN ('pending', 'stock', 'exchange', 'repaired')
        ELSE return_status IS NULL
      END
    ),
  ADD CONSTRAINT chk_order_item_is_repair_scope
    CHECK (NOT is_repair OR line_type = 'return');

-- 部分索引：只索引非一般列（退貨/換貨列量少）
CREATE INDEX IF NOT EXISTS idx_order_items_line_type
  ON public.order_items (line_type)
  WHERE line_type <> 'sale';

-- ------------------------------------------------------------
-- 2) 遷移歷史銷貨退貨 → order_items return 列
--    SL2609JR0010001 / OD26081700009：同一品項退 1 件，
--    total_refund=0（無退款分錄）、庫存已由舊流程以 customer_return 回勾；
--    故封存為 return_status='stock'（已退庫存、無退款）
-- ------------------------------------------------------------
INSERT INTO public.order_items (
  order_id, product_id, variant_id, store_id,
  quantity, unit_price, shipped_quantity, status,
  unit_cost, sort_order,
  line_type, line_note, return_status, is_repair
)
SELECT
  oi.order_id, oi.product_id, oi.variant_id, oi.store_id,
  sri.quantity, sri.unit_price, 0, 'waiting'::public.order_item_status,
  COALESCE(oi.unit_cost, 0),
  (SELECT COALESCE(MAX(oi2.sort_order), 0) + 1
   FROM public.order_items oi2 WHERE oi2.order_id = oi.order_id),
  'return',
  '歷史退貨（' || sn.code || '，已退庫存、無退款）',
  'stock', false
FROM public.sales_note_return_items sri
JOIN public.order_items oi ON oi.id = sri.order_item_id
JOIN public.sales_note_returns r ON r.id = sri.return_id
JOIN public.sales_notes sn ON sn.id = r.sales_note_id;

-- ------------------------------------------------------------
-- 3) 移除舊銷貨退貨流程（已由 order line 取代）
-- ------------------------------------------------------------
DROP TABLE IF EXISTS public.sales_note_return_items;
DROP TABLE IF EXISTS public.sales_note_returns;
DROP FUNCTION IF EXISTS public.process_sales_note_return(uuid, jsonb, uuid, text, uuid, uuid);

-- ------------------------------------------------------------
-- 4) 重建 delete_order_if_unadopted：退貨守門改看 order line
--    （其餘守門完整保留，源自 20260909000003 版本）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_order_if_unadopted(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status  TEXT;
  v_source  TEXT;
  v_lines   JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除訂單');
  END IF;

  SELECT status, source_type INTO v_status, v_source
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '訂單不存在');
  END IF;

  -- 寄賣鏡像訂單（send_to_store 同步建立的 orders）不可直接刪除
  IF v_source = 'consignment' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '寄賣鏡像訂單請至寄賣管理處理');
  END IF;

  -- 已被銷貨單採用：列出銷貨單編號
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', 'sales_note',
    'code', sn.code,
    'label', '銷貨單'
  )), '[]'::jsonb) INTO v_lines
  FROM public.sales_note_items sni
  JOIN public.sales_notes sn ON sn.id = sni.sales_note_id
  JOIN public.order_items oi ON oi.id = sni.order_item_id
  WHERE oi.order_id = p_order_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被銷貨單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 尚有品項在出貨池
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'shipping_pool', 'label', '出貨池')), '[]'::jsonb) INTO v_lines
  FROM public.shipping_pool sp
  WHERE sp.order_item_id IN (
    SELECT oi2.id FROM public.order_items oi2 WHERE oi2.order_id = p_order_id
  );
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '仍有品項在出貨池，請先移出訂單', 'adopted_by', v_lines);
  END IF;

  -- 已被寄賣單採用（來源單）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', 'consignment',
    'code', co.code,
    'label', '寄賣單'
  )), '[]'::jsonb) INTO v_lines
  FROM public.consignment_orders co
  WHERE co.source_order_id = p_order_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被寄賣單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 寄賣品項已出貨
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'consignment_item', 'label', '寄賣品項')), '[]'::jsonb) INTO v_lines
  FROM public.consignment_order_items coi
  WHERE coi.order_item_id IN (
    SELECT oi2.id FROM public.order_items oi2 WHERE oi2.order_id = p_order_id
  );
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '寄賣品項已出貨，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 寄賣銷售已記帳
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'consignment_sale', 'label', '寄賣銷售')), '[]'::jsonb) INTO v_lines
  FROM public.consignment_sales cs
  WHERE cs.order_item_id IN (
    SELECT oi2.id FROM public.order_items oi2 WHERE oi2.order_id = p_order_id
  );
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '寄賣銷售已記帳，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已有庫存異動紀錄
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('kind', 'inventory', 'label', '庫存異動')), '[]'::jsonb) INTO v_lines
  FROM public.inventory_movements im
  WHERE im.order_item_id IN (
    SELECT oi2.id FROM public.order_items oi2 WHERE oi2.order_id = p_order_id
  );
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有庫存異動紀錄，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 訂單含退貨列（line_type='return'，含送修/已結清）
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'order_return_line', 'label', '訂單退貨列')), '[]'::jsonb) INTO v_lines
  FROM public.order_items oi2
  WHERE oi2.order_id = p_order_id AND oi2.line_type = 'return';
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '訂單含退貨列，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被採購單採用（source_quantities jsonb 含此訂單 id）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', 'purchase_order',
    'code', po.code,
    'label', '採購單'
  )), '[]'::jsonb) INTO v_lines
  FROM public.purchase_order_items poi
  JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
  WHERE poi.source_quantities ? p_order_id::text;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被採購單採用，請先解除連結', 'adopted_by', v_lines);
  END IF;

  -- 已被會計分錄採用（entry row 或 entry_references 子表 two-path）
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'accounting', 'label', '會計分錄')), '[]'::jsonb) INTO v_lines
  FROM (
    SELECT 1 FROM public.accounting_entries ae WHERE ae.reference_type = 'order' AND ae.reference_id = p_order_id
    UNION
    SELECT 1 FROM public.accounting_entry_references aer WHERE aer.reference_type = 'order' AND aer.reference_id = p_order_id
  ) x;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被會計分錄採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  DELETE FROM public.orders
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_order_if_unadopted(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_order_if_unadopted(UUID) TO authenticated;