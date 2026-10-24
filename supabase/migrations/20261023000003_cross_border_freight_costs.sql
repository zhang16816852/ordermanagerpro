-- ============================================================
-- P2 / M1：跨境運費單據 purchase_freight_costs + stale trigger + CRUD RPC
-- 檔名：20261023000003_cross_border_freight_costs.sql
-- 依賴：20261023000001 (countries/currencies), 20261023000002 (purchase_orders.cross-border fields)
-- 可獨立驗證與回滾：是（DROP TABLE CASCADE + DROP FUNCTION）
-- ============================================================

-- ------------------------------------------------------------
-- 1. purchase_freight_costs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_freight_costs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   UUID        NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  freight_type        TEXT        NOT NULL CHECK (freight_type IN ('international','customs','domestic','insurance','other')),
  amount              NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency            TEXT        NOT NULL DEFAULT 'TWD' CHECK (currency ~ '^[A-Z]{3}$'),
  exchange_rate       NUMERIC(16,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  amount_twd          NUMERIC(14,2) NOT NULL CHECK (amount_twd >= 0),
  supplier_id         UUID        NULL REFERENCES public.suppliers(id),
  payment_account_id  UUID        NULL REFERENCES public.accounts(id),
  payment_status      TEXT        NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  paid_date           DATE        NULL,
  currency_movement_id UUID       NULL REFERENCES public.currency_movements(id),
  accounting_entry_id UUID        NULL REFERENCES public.accounting_entries(id),
  note                TEXT        NULL,
  created_by          UUID        NULL REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pfc_po             ON public.purchase_freight_costs(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_pfc_supplier       ON public.purchase_freight_costs(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pfc_unpaid         ON public.purchase_freight_costs(payment_status) WHERE payment_status = 'unpaid';

ALTER TABLE public.purchase_freight_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pfc_admin_all ON public.purchase_freight_costs;
CREATE POLICY pfc_admin_all
  ON public.purchase_freight_costs FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_pfc_set_updated_at ON public.purchase_freight_costs;
CREATE TRIGGER trg_pfc_set_updated_at
  BEFORE UPDATE ON public.purchase_freight_costs
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_set_updated_at();

-- ------------------------------------------------------------
-- 2. stale trigger：運費表的任何寫入 → 該 PO 標記 freight_allocation_stale=true
--    （UPDATE 換 purchase_order_id 時舊 PO 與新 PO 皆標記）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trgfn_purchase_freight_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.purchase_orders
      SET freight_allocation_stale = true, updated_at = now()
      WHERE id = OLD.purchase_order_id;
  ELSIF TG_OP = 'INSERT' THEN
    UPDATE public.purchase_orders
      SET freight_allocation_stale = true, updated_at = now()
      WHERE id = NEW.purchase_order_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id THEN
      UPDATE public.purchase_orders
        SET freight_allocation_stale = true, updated_at = now()
        WHERE id IN (OLD.purchase_order_id, NEW.purchase_order_id);
    ELSE
      UPDATE public.purchase_orders
        SET freight_allocation_stale = true, updated_at = now()
        WHERE id = NEW.purchase_order_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trgfn_purchase_freight_stale() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_purchase_freight_stale ON public.purchase_freight_costs;
CREATE TRIGGER trg_purchase_freight_stale
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_freight_costs
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_purchase_freight_stale();

-- ------------------------------------------------------------
-- 3. upsert_purchase_freight_cost (admin only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_purchase_freight_cost(
  p_id                  UUID    DEFAULT NULL,
  p_purchase_order_id   UUID    DEFAULT NULL,
  p_freight_type        TEXT    DEFAULT NULL,
  p_amount              NUMERIC DEFAULT NULL,
  p_currency            TEXT    DEFAULT NULL,
  p_exchange_rate       NUMERIC DEFAULT NULL,
  p_supplier_id         UUID    DEFAULT NULL,
  p_payment_account_id  UUID    DEFAULT NULL,
  p_payment_status      TEXT    DEFAULT NULL,
  p_paid_date           DATE    DEFAULT NULL,
  p_note                TEXT    DEFAULT NULL,
  p_created_by          UUID    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.purchase_freight_costs%ROWTYPE;
  v_po  public.purchase_orders%ROWTYPE;
  v_amount_twd NUMERIC(14,2);
  v_currency TEXT;
  v_rate NUMERIC(16,6);
  v_new_id UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.system_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_purchase_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不可為空');
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;
  IF v_po.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已取消的採購單不可新增運費');
  END IF;

  v_currency := COALESCE(NULLIF(p_currency, ''), 'TWD');
  v_rate     := COALESCE(p_exchange_rate, 1);
  IF v_rate <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '匯率必須大於 0');
  END IF;
  v_amount_twd := round(COALESCE(p_amount, 0) * v_rate, 2);

  -- UPDATE 路徑
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.purchase_freight_costs WHERE id = p_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', '運費單據不存在');
    END IF;

    -- 不可改掛到其他 PO
    IF v_row.purchase_order_id IS DISTINCT FROM p_purchase_order_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', '不可將運費改掛到其他採購單');
    END IF;

    -- 已付款列：擋下金額/匯率/幣別變更
    IF v_row.payment_status = 'paid' THEN
      IF (p_amount IS NOT NULL AND p_amount IS DISTINCT FROM v_row.amount)
        OR (p_currency IS NOT NULL AND p_currency IS DISTINCT FROM v_row.currency)
        OR (p_exchange_rate IS NOT NULL AND p_exchange_rate IS DISTINCT FROM v_row.exchange_rate)
        OR (p_freight_type IS NOT NULL AND p_freight_type IS DISTINCT FROM v_row.freight_type) THEN
        RETURN jsonb_build_object('ok', false, 'reason', '已付款運費不可修改金額/幣別/匯率/類型，請先刪除付款紀錄');
      END IF;
    END IF;

    UPDATE public.purchase_freight_costs SET
      freight_type       = COALESCE(NULLIF(p_freight_type, ''), v_row.freight_type),
      amount             = COALESCE(p_amount, v_row.amount),
      currency           = v_currency,
      exchange_rate      = v_rate,
      amount_twd         = v_amount_twd,
      supplier_id        = COALESCE(p_supplier_id, v_row.supplier_id),
      payment_account_id = COALESCE(p_payment_account_id, v_row.payment_account_id),
      payment_status     = COALESCE(NULLIF(p_payment_status, ''), v_row.payment_status),
      paid_date          = COALESCE(p_paid_date, v_row.paid_date),
      note               = COALESCE(p_note, v_row.note),
      updated_at         = now()
    WHERE id = p_id;

    RETURN jsonb_build_object('ok', true, 'id', p_id, 'amount_twd', v_amount_twd);
  END IF;

  -- INSERT 路徑
  IF p_freight_type IS NULL OR p_amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'freight_type 與 amount 不可為空');
  END IF;

  INSERT INTO public.purchase_freight_costs (
    purchase_order_id, freight_type, amount, currency, exchange_rate, amount_twd,
    supplier_id, payment_account_id, payment_status, paid_date, note, created_by
  ) VALUES (
    p_purchase_order_id, p_freight_type, p_amount, v_currency, v_rate, v_amount_twd,
    p_supplier_id, p_payment_account_id, COALESCE(NULLIF(p_payment_status,''),'unpaid'), p_paid_date, p_note,
    COALESCE(p_created_by, v_uid)
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'id', v_new_id, 'amount_twd', v_amount_twd);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_purchase_freight_cost(UUID, UUID, TEXT, NUMERIC, TEXT, NUMERIC, UUID, UUID, TEXT, DATE, TEXT, UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_purchase_freight_cost(UUID, UUID, TEXT, NUMERIC, TEXT, NUMERIC, UUID, UUID, TEXT, DATE, TEXT, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 4. delete_purchase_freight_cost (admin only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_purchase_freight_cost(
  p_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.purchase_freight_costs%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.system_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO v_row FROM public.purchase_freight_costs WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '運費單據不存在');
  END IF;
  IF v_row.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已付款運費不可刪除，請先刪除付款紀錄');
  END IF;

  DELETE FROM public.purchase_freight_costs WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_purchase_freight_cost(UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_purchase_freight_cost(UUID) TO authenticated;

-- ============================================================
-- End of migration 000003
-- ============================================================
