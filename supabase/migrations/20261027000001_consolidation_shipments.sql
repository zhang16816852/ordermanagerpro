-- ============================================================
-- 集運倉管理：集運單 + 快遞單號/採購單關聯 + 集運單層級運費
-- Migration: 20261027000001_consolidation_shipments.sql
-- 依賴：purchase_orders, purchase_order_items, suppliers, currencies
-- ============================================================

-- ------------------------------------------------------------
-- 1. consolidation_shipments（集運單主表）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consolidation_shipments (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    TEXT        NOT NULL UNIQUE,
  name                    TEXT        NOT NULL,
  date                    DATE        NOT NULL DEFAULT CURRENT_DATE,
  status                  TEXT        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','pending','shipped','received','cancelled')),
  warehouse_name          TEXT        NULL,
  customs_clearance_number TEXT       NULL,
  shipping_type           TEXT        NOT NULL DEFAULT 'sea_fast'
                            CHECK (shipping_type IN ('sea_fast','sea','air')),
  note                    TEXT        NULL,
  consolidation_total_weight NUMERIC(12,3) NULL CHECK (consolidation_total_weight >= 0),
  freight_amount          NUMERIC(14,2) NULL CHECK (freight_amount >= 0),
  freight_currency        TEXT        NOT NULL DEFAULT 'TWD' CHECK (freight_currency ~ '^[A-Z]{3}$'),
  freight_allocation_stale BOOLEAN    NOT NULL DEFAULT false,
  landed_total_amount     NUMERIC(14,2) NULL,
  created_by              UUID        NULL REFERENCES auth.users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cs_status ON public.consolidation_shipments(status);
CREATE INDEX IF NOT EXISTS idx_cs_date ON public.consolidation_shipments(date DESC);

ALTER TABLE public.consolidation_shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_admin_all ON public.consolidation_shipments;
CREATE POLICY cs_admin_all
  ON public.consolidation_shipments FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

DROP TRIGGER IF EXISTS trg_cs_set_updated_at ON public.consolidation_shipments;
CREATE TRIGGER trg_cs_set_updated_at
  BEFORE UPDATE ON public.consolidation_shipments
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_set_updated_at();

-- ------------------------------------------------------------
-- 2. consolidation_shipment_pos（集運單 ↔ 採購單 關聯表）
--    每筆採購單只能被一個集運單引用（排他性）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consolidation_shipment_pos (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  consolidation_shipment_id UUID     NOT NULL REFERENCES public.consolidation_shipments(id) ON DELETE CASCADE,
  purchase_order_id       UUID        NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  consolidation_weight    NUMERIC(10,3) NULL CHECK (consolidation_weight >= 0),
  allocated_freight       NUMERIC(14,2) NOT NULL DEFAULT 0,
  landed_unit_cost_delta  NUMERIC(14,2) NULL,
  status                  TEXT        NOT NULL DEFAULT 'linked'
                            CHECK (status IN ('linked','confirmed')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_order_id)  -- 排他性：一張 PO 只能被一個集運單引用
);

CREATE INDEX IF NOT EXISTS idx_csp_cs ON public.consolidation_shipment_pos(consolidation_shipment_id);
CREATE INDEX IF NOT EXISTS idx_csp_po ON public.consolidation_shipment_pos(purchase_order_id);

ALTER TABLE public.consolidation_shipment_pos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS csp_admin_all ON public.consolidation_shipment_pos;
CREATE POLICY csp_admin_all
  ON public.consolidation_shipment_pos FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

-- ------------------------------------------------------------
-- 3. consolidation_freight_costs（集運單層級運費，可多筆）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consolidation_freight_costs (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  consolidation_shipment_id UUID     NOT NULL REFERENCES public.consolidation_shipments(id) ON DELETE CASCADE,
  freight_type            TEXT        NOT NULL CHECK (freight_type IN ('international','customs','domestic','insurance','other')),
  amount                  NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  amount_twd              NUMERIC(14,2) NULL,  -- 由 FIFO 付款後回寫
  supplier_id             UUID        NULL REFERENCES public.suppliers(id),
  payment_account_id      UUID        NULL REFERENCES public.accounts(id),
  payment_status          TEXT        NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  paid_date               DATE        NULL,
  currency_movement_id    UUID        NULL REFERENCES public.currency_movements(id),
  accounting_entry_id     UUID        NULL REFERENCES public.accounting_entries(id),
  note                    TEXT        NULL,
  created_by              UUID        NULL REFERENCES auth.users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfc_cs ON public.consolidation_freight_costs(consolidation_shipment_id);

ALTER TABLE public.consolidation_freight_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfc_admin_all ON public.consolidation_freight_costs;
CREATE POLICY cfc_admin_all
  ON public.consolidation_freight_costs FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

DROP TRIGGER IF EXISTS trg_cfc_set_updated_at ON public.consolidation_freight_costs;
CREATE TRIGGER trg_cfc_set_updated_at
  BEFORE UPDATE ON public.consolidation_freight_costs
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_set_updated_at();

-- ============================================================
-- End of migration 000001 (consolidation shipments)
-- ============================================================
