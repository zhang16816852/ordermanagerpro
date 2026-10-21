-- ============================================================
-- 外幣 FIFO（Foreign Currency FIFO）系統 — Schema 建立（修正版）
-- Migration: 20261022000001_foreign_currency_fifo_schema.sql
-- ============================================================

-- ============================================================
-- 1. currency_batches（外幣批次主檔）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.currency_batches (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                UUID NOT NULL REFERENCES public.accounts(id),
  amount                    NUMERIC(18,6) NOT NULL CHECK (amount <> 0),
  exchange_rate             NUMERIC(18,8) NOT NULL CHECK (exchange_rate > 0),
  twd_equivalent            NUMERIC(18,4) NOT NULL,
  source_type               TEXT NOT NULL
                            CHECK (source_type IN (
                              'initial', 'initial_estimated', 'sales', 'transfer_in',
                              'purchase_refund', 'sales_refund', 'manual'
                            )),
  source_id                 UUID,
  transfer_source_batch_id  UUID REFERENCES public.currency_batches(id),
  inbound_movement_id       UUID REFERENCES public.currency_movements(id),
  transaction_date          TIMESTAMPTZ NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cb_id_account UNIQUE (id, account_id)
);

CREATE INDEX idx_cb_account ON public.currency_batches(account_id, transaction_date, created_at, id);
CREATE INDEX idx_cb_source ON public.currency_batches(source_type);
CREATE INDEX idx_cb_status ON public.currency_batches(status) WHERE status IS NOT NULL;

-- ============================================================
-- 2. currency_batch_inventory（批次剩餘數量）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.currency_batch_inventory (
  batch_id          UUID PRIMARY KEY,
  account_id        UUID NOT NULL,
  remaining_amount  NUMERIC(18,6) NOT NULL CHECK (remaining_amount >= 0),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_cbi_batch_account
    FOREIGN KEY (batch_id, account_id) REFERENCES public.currency_batches(id, account_id)
);

CREATE INDEX idx_cbi_account ON public.currency_batch_inventory(account_id);

-- ============================================================
-- 3. currency_movements（外幣異動明細）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.currency_movements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES public.accounts(id),
  amount_change     NUMERIC(18,6) NOT NULL,
  twd_equivalent    NUMERIC(18,4) NOT NULL,
  exchange_rate     NUMERIC(18,8) NOT NULL,
  source_type       TEXT NOT NULL
                    CHECK (source_type IN (
                      'exchange', 'transfer', 'purchase_payment', 'freight_payment',
                      'transfer_fee', 'reversal', 'pending_reconciliation',
                      'sales_refund', 'purchase_refund', 'initial', 'initial_estimated',
                      'manual', 'transfer_in'
                    )),
  reference_id      UUID,
  receipt_id        UUID,
  transaction_date  TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cm_account_date ON public.currency_movements(account_id, transaction_date, created_at, id);
CREATE INDEX idx_cm_source_type ON public.currency_movements(source_type);
CREATE INDEX idx_cm_reference ON public.currency_movements(reference_id);
CREATE INDEX idx_cm_receipt ON public.currency_movements(receipt_id);

-- 同一原 movement 只能有一筆 reversal
CREATE UNIQUE INDEX uq_cm_single_reversal
  ON public.currency_movements (reference_id)
  WHERE source_type = 'reversal' AND reference_id IS NOT NULL;

-- ============================================================
-- 4. currency_batch_consumptions（批次消耗明細）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.currency_batch_consumptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id             UUID NOT NULL REFERENCES public.currency_movements(id),
  batch_id                UUID NOT NULL REFERENCES public.currency_batches(id),
  consumed_amount         NUMERIC(18,6) NOT NULL CHECK (consumed_amount > 0),
  historical_twd_cost     NUMERIC(18,4) NOT NULL,
  transfer_fee_amount     NUMERIC(18,4),
  status                  TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'reversed')),
  reversal_of_movement_id UUID REFERENCES public.currency_movements(id),
  refund_of_movement_id   UUID REFERENCES public.currency_movements(id),
  receipt_id              UUID,  -- 冪等保護
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cbc_movement_batch UNIQUE (movement_id, batch_id)
);

CREATE INDEX idx_cbc_batch ON public.currency_batch_consumptions(batch_id);
CREATE INDEX idx_cbc_status ON public.currency_batch_consumptions(status);
CREATE INDEX idx_cbc_movement ON public.currency_batch_consumptions(movement_id);
CREATE INDEX idx_cbc_receipt ON public.currency_batch_consumptions(receipt_id);

-- ============================================================
-- 5. currency_cost_adjustments（重算紀錄）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.currency_cost_adjustments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id           UUID NOT NULL REFERENCES public.currency_movements(id),
  trigger_reason        TEXT NOT NULL,
  original_consumptions JSONB NOT NULL,
  new_consumptions      JSONB NOT NULL,
  delta_amount          NUMERIC(18,4) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cca_movement ON public.currency_cost_adjustments(movement_id);

-- ============================================================
-- 6. currency_transaction_results（請求層級冪等）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.currency_transaction_results (
  receipt_id      UUID PRIMARY KEY,
  account_id      UUID REFERENCES public.accounts(id),
  operation_type  TEXT NOT NULL
                  CHECK (operation_type IN ('inbound', 'exchange', 'transfer', 'reversal', 'refund', 'purchase_payment', 'freight_payment')),
  request_hash    TEXT NOT NULL,
  result_json     JSONB NOT NULL,
  group_id        UUID,
  is_reversed     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ctr_group ON public.currency_transaction_results(group_id);
CREATE INDEX idx_ctr_account ON public.currency_transaction_results(account_id);
CREATE INDEX idx_ctr_is_reversed ON public.currency_transaction_results(is_reversed);

-- ============================================================
-- 7. RLS 政策
-- ============================================================
ALTER TABLE public.currency_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currency_batch_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currency_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currency_batch_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currency_cost_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currency_transaction_results ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "currency_batches_admin_all" ON public.currency_batches
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "currency_batch_inventory_admin_all" ON public.currency_batch_inventory
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "currency_movements_admin_all" ON public.currency_movements
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "currency_batch_consumptions_admin_all" ON public.currency_batch_consumptions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "currency_cost_adjustments_admin_all" ON public.currency_cost_adjustments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "currency_transaction_results_admin_all" ON public.currency_transaction_results
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Authenticated read access
CREATE POLICY "currency_batches_auth_read" ON public.currency_batches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "currency_batch_inventory_auth_read" ON public.currency_batch_inventory
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "currency_movements_auth_read" ON public.currency_movements
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "currency_batch_consumptions_auth_read" ON public.currency_batch_consumptions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "currency_cost_adjustments_auth_read" ON public.currency_cost_adjustments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "currency_transaction_results_auth_read" ON public.currency_transaction_results
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 8. 複合唯一鍵 + 複合外鍵（批次與帳戶一致性約束）
-- ============================================================
-- currency_batches: 複合唯一鍵
ALTER TABLE public.currency_batches ADD CONSTRAINT uq_cb_id_account UNIQUE (id, account_id);

-- currency_batch_inventory: 複合外鍵
ALTER TABLE public.currency_batch_inventory ADD CONSTRAINT fk_cbi_batch_account
  FOREIGN KEY (batch_id, account_id) REFERENCES public.currency_batches(id, account_id);

-- ============================================================
-- 9. Revoke/Grant RPC permissions (placeholder for future RPCs)
-- ============================================================
-- All currency FIFO RPCs will be SECURITY DEFINER with:
--   SET search_path = public
--   REVOKE ALL FROM public, anon
--   GRANT EXECUTE TO authenticated
-- ============================================================