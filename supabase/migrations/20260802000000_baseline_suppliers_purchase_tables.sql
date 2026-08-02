-- ============================================================
-- Baseline: suppliers / purchase_orders / purchase_order_items
-- 這三張表存在於 live DB（經由 Dashboard 手動建立）但從未寫入 migration。
-- 寄賣功能會對 suppliers 建立 FK，故以 IF NOT EXISTS 補齊定義，
-- 讓 migration 成為唯一 schema 權威來源（重建環境不失敗，現有環境不衝突）。
-- ============================================================

-- ------------------------------------------------------------
-- suppliers
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Admins can manage suppliers') THEN
    CREATE POLICY "Admins can manage suppliers"
    ON public.suppliers FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.system_role));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.suppliers'::regclass AND tgname = 'update_suppliers_updated_at'
  ) THEN
    CREATE TRIGGER update_suppliers_updated_at
    BEFORE UPDATE ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- ------------------------------------------------------------
-- purchase_order_status enum + purchase_orders
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
    CREATE TYPE public.purchase_order_status AS ENUM ('draft', 'ordered', 'partial_received', 'received', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id),
  supplier_order_number TEXT,
  status public.purchase_order_status NOT NULL DEFAULT 'draft',
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  received_date DATE,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Admins can manage purchase orders') THEN
    CREATE POLICY "Admins can manage purchase orders"
    ON public.purchase_orders FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.system_role));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.purchase_orders'::regclass AND tgname = 'update_purchase_orders_updated_at'
  ) THEN
    CREATE TRIGGER update_purchase_orders_updated_at
    BEFORE UPDATE ON public.purchase_orders
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- ------------------------------------------------------------
-- purchase_order_items
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  variant_id UUID REFERENCES public.product_variants(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  received_quantity INTEGER NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  source_order_ids UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Admins can manage purchase order items') THEN
    CREATE POLICY "Admins can manage purchase order items"
    ON public.purchase_order_items FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.system_role));
  END IF;
END $$;
