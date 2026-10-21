-- ============================================================
-- 20261022000007_currency_fifo_delete_rpcs.sql
-- 外幣 FIFO：新增刪除 RPC（inbound / consume / transfer）
-- 刪除 movement 時觸發器自動同步 accounts.balance，並清理相關會計分錄與批次
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_currency_inbound(p_movement_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement RECORD;
  v_batch RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除外幣入帳');
  END IF;

  SELECT * INTO v_movement FROM public.currency_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '外幣入帳異動不存在');
  END IF;

  IF v_movement.amount_change <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '非入帳異動，請使用一般刪除');
  END IF;

  IF EXISTS (SELECT 1 FROM public.currency_movements WHERE reference_id = p_movement_id AND source_type = 'reversal') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此入帳已被沖銷');
  END IF;

  DELETE FROM public.accounting_entries
  WHERE reference_type = 'currency_movement' AND reference_id = p_movement_id;

  FOR v_batch IN
    SELECT id FROM public.currency_batches WHERE inbound_movement_id = p_movement_id
  LOOP
    DELETE FROM public.currency_batch_inventory WHERE batch_id = v_batch.id;
    DELETE FROM public.currency_batches WHERE id = v_batch.id;
  END LOOP;

  DELETE FROM public.currency_movements WHERE id = p_movement_id;

  RETURN jsonb_build_object('ok', true, 'movement_id', p_movement_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_currency_inbound(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_currency_inbound(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_currency_consume(p_movement_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement RECORD;
  v_consumption RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除外幣消耗');
  END IF;

  SELECT * INTO v_movement FROM public.currency_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '外幣消耗異動不存在');
  END IF;

  IF v_movement.amount_change >= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '非消耗異動，請使用一般刪除');
  END IF;

  IF EXISTS (SELECT 1 FROM public.currency_movements WHERE reference_id = p_movement_id AND source_type = 'reversal') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此消耗已被沖銷');
  END IF;

  DELETE FROM public.accounting_entries
  WHERE reference_type = 'currency_movement' AND reference_id = p_movement_id;

  FOR v_consumption IN
    SELECT cbc.batch_id, cbc.consumed_amount
    FROM public.currency_batch_consumptions cbc
    WHERE cbc.movement_id = p_movement_id AND cbc.status = 'active'
  LOOP
    UPDATE public.currency_batch_inventory
    SET remaining_amount = remaining_amount + v_consumption.consumed_amount,
        updated_at = now()
    WHERE batch_id = v_consumption.batch_id;

    UPDATE public.currency_batch_consumptions
    SET status = 'reversed'
    WHERE id = v_consumption.id;
  END LOOP;

  DELETE FROM public.currency_movements WHERE id = p_movement_id;

  RETURN jsonb_build_object('ok', true, 'movement_id', p_movement_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_currency_consume(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_currency_consume(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_currency_transfer(p_movement_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_movement RECORD;
  v_to_movement RECORD;
  v_consumption RECORD;
  v_new_batch RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除外幣轉帳');
  END IF;

  SELECT * INTO v_from_movement FROM public.currency_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '轉帳來源異動不存在');
  END IF;

  IF v_from_movement.source_type <> 'transfer' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '非轉帳來源異動');
  END IF;

  SELECT * INTO v_to_movement FROM public.currency_movements
  WHERE reference_id = v_from_movement.reference_id
    AND source_type = 'transfer_in'
    AND account_id <> v_from_movement.account_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '找不到對應的轉入異動');
  END IF;

  IF EXISTS (SELECT 1 FROM public.currency_movements WHERE reference_id = p_movement_id AND source_type = 'reversal') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此轉帳已被沖銷');
  END IF;

  DELETE FROM public.accounting_entries
  WHERE reference_type = 'currency_movement' AND reference_id IN (p_movement_id, v_to_movement.id);

  FOR v_consumption IN
    SELECT cbc.batch_id, cbc.consumed_amount
    FROM public.currency_batch_consumptions cbc
    WHERE cbc.movement_id = p_movement_id AND cbc.status = 'active'
  LOOP
    UPDATE public.currency_batch_inventory
    SET remaining_amount = remaining_amount + v_consumption.consumed_amount,
        updated_at = now()
    WHERE batch_id = v_consumption.batch_id;

    UPDATE public.currency_batch_consumptions
    SET status = 'reversed'
    WHERE id = v_consumption.id;
  END LOOP;

  FOR v_new_batch IN
    SELECT id FROM public.currency_batches WHERE inbound_movement_id = v_to_movement.id
  LOOP
    DELETE FROM public.currency_batch_inventory WHERE batch_id = v_new_batch.id;
    DELETE FROM public.currency_batches WHERE id = v_new_batch.id;
  END LOOP;

  DELETE FROM public.currency_movements WHERE id = p_movement_id;
  DELETE FROM public.currency_movements WHERE id = v_to_movement.id;

  RETURN jsonb_build_object('ok', true, 'movement_id', p_movement_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_currency_transfer(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_currency_transfer(UUID) TO authenticated;