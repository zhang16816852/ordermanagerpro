-- ============================================================
-- 20261022000005_currency_fifo_balance_trigger.sql
-- 外幣 FIFO：accounts.balance 由 currency_movements 觸發器自動同步
-- 單一權威帳本：餘額 = SUM(currency_movements.amount_change)
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_account_balance_from_movements()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_account_id := OLD.account_id;
  ELSE
    v_account_id := NEW.account_id;
  END IF;

  UPDATE public.accounts
  SET balance = COALESCE((
    SELECT SUM(amount_change)
    FROM public.currency_movements
    WHERE account_id = v_account_id
  ), 0),
  updated_at = now()
  WHERE id = v_account_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_currency_movements_balance_sync ON public.currency_movements;
CREATE TRIGGER trg_currency_movements_balance_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.currency_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_account_balance_from_movements();

REVOKE ALL ON FUNCTION public.sync_account_balance_from_movements() FROM public, anon, authenticated;