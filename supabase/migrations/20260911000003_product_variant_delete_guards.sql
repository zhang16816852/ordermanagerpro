-- ============================================================
-- 20260911000003_product_variant_delete_guards.sql
-- 1) delete_product_if_safe：守門產品刪除
--    檢查 order_items / sales_note_items / purchase_order_items /
--    inventory_movements / product_inventory / consignment_order_items /
--    repair_order_items / accounting_entries 等引用，
--    回傳 {ok, reason, adopted_by}。
-- 2) delete_variant_if_safe：守門變體刪除
--    檢查上述表中 variant_id 引用。
-- ============================================================

-- ============================================================
-- 1) delete_product_if_safe
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_product_if_safe(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines JSONB := '[]'::jsonb;
  v_name TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除產品');
  END IF;

  SELECT name INTO v_name FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '產品不存在');
  END IF;

  -- 已被訂單品項引用
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('kind', 'order_item', 'label', '訂單品項')), '[]'::jsonb) INTO v_lines
  FROM public.order_items oi
  WHERE oi.product_id = p_product_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此產品已被訂單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被銷貨單品項引用（透過 order_items）
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'sales_note', 'label', '銷貨單')), '[]'::jsonb) INTO v_lines
  FROM public.sales_note_items sni
  JOIN public.order_items oi ON oi.id = sni.order_item_id
  WHERE oi.product_id = p_product_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此產品已被銷貨單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被採購單引用
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'purchase_order', 'label', '採購單')), '[]'::jsonb) INTO v_lines
  FROM public.purchase_order_items poi
  WHERE poi.product_id = p_product_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此產品已被採購單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已有庫存異動
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('kind', 'inventory', 'label', '庫存異動')), '[]'::jsonb) INTO v_lines
  FROM public.inventory_movements im
  WHERE im.product_id = p_product_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此產品已有庫存異動紀錄，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已有庫存餘額
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'inventory', 'label', '庫存')), '[]'::jsonb) INTO v_lines
  FROM public.product_inventory pi
  WHERE pi.product_id = p_product_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此產品仍有庫存紀錄，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被寄賣單品項引用
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'consignment', 'label', '寄賣單')), '[]'::jsonb) INTO v_lines
  FROM public.consignment_order_items coi
  WHERE coi.product_id = p_product_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此產品已被寄賣單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被維修單引用
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'repair_order', 'label', '維修單')), '[]'::jsonb) INTO v_lines
  FROM public.repair_order_items roi
  WHERE roi.product_id = p_product_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此產品已被維修單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被會計分錄引用（透過 product_inventory 或其他間接引用不需檢查，因為會計只引用單據）

  DELETE FROM public.products WHERE id = p_product_id;

  RETURN jsonb_build_object('ok', true, 'name', v_name);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_product_if_safe(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_product_if_safe(UUID) TO authenticated;

-- ============================================================
-- 2) delete_variant_if_safe
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_variant_if_safe(p_variant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines JSONB := '[]'::jsonb;
  v_name TEXT;
  v_product_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除變體');
  END IF;

  SELECT name, product_id INTO v_name, v_product_id FROM public.product_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '變體不存在');
  END IF;

  -- 已被訂單品項引用
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('kind', 'order_item', 'label', '訂單品項')), '[]'::jsonb) INTO v_lines
  FROM public.order_items oi
  WHERE oi.variant_id = p_variant_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此變體已被訂單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被銷貨單品項引用
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'sales_note', 'label', '銷貨單')), '[]'::jsonb) INTO v_lines
  FROM public.sales_note_items sni
  JOIN public.order_items oi ON oi.id = sni.order_item_id
  WHERE oi.variant_id = p_variant_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此變體已被銷貨單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被採購單引用
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'purchase_order', 'label', '採購單')), '[]'::jsonb) INTO v_lines
  FROM public.purchase_order_items poi
  WHERE poi.variant_id = p_variant_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此變體已被採購單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已有庫存異動
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('kind', 'inventory', 'label', '庫存異動')), '[]'::jsonb) INTO v_lines
  FROM public.inventory_movements im
  WHERE im.variant_id = p_variant_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此變體已有庫存異動紀錄，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已有庫存餘額
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'inventory', 'label', '庫存')), '[]'::jsonb) INTO v_lines
  FROM public.product_inventory pi
  WHERE pi.variant_id = p_variant_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此變體仍有庫存紀錄，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被寄賣單品項引用
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'consignment', 'label', '寄賣單')), '[]'::jsonb) INTO v_lines
  FROM public.consignment_order_items coi
  WHERE coi.variant_id = p_variant_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此變體已被寄賣單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被維修單引用
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'repair_order', 'label', '維修單')), '[]'::jsonb) INTO v_lines
  FROM public.repair_order_items roi
  WHERE roi.variant_id = p_variant_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此變體已被維修單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被供應商映射引用
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'supplier_mapping', 'label', '供應商映射')), '[]'::jsonb) INTO v_lines
  FROM public.supplier_product_mappings spm
  WHERE spm.internal_variant_id = p_variant_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此變體已被供應商映射採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  DELETE FROM public.product_variants WHERE id = p_variant_id;

  RETURN jsonb_build_object('ok', true, 'name', v_name, 'product_id', v_product_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_variant_if_safe(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_variant_if_safe(UUID) TO authenticated;
