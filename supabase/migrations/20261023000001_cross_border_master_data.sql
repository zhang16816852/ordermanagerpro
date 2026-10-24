-- ============================================================
-- P1 (前半) / M0：國別 & 幣別主資料 + 供應商 country_code + 商品重量/材積
-- 檔名：20261023000001_cross_border_master_data.sql（原 20261022000004，因前綴與已 commit 之外幣 FIFO 檔撞號而改名；全檔冪等，遠端重跑安全）
-- 依賴：無（首支跨境 migration）
-- 可獨立驗證與回滾：是
-- ============================================================

-- ------------------------------------------------------------
-- 1. currencies（幣別主資料，不存匯率）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.currencies (
  code        TEXT        PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name_zh     TEXT        NOT NULL,
  symbol      TEXT        NULL,
  decimals    SMALLINT    NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 4),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS currencies_select_authenticated ON public.currencies;
CREATE POLICY currencies_select_authenticated
  ON public.currencies FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS currencies_admin_all ON public.currencies;
CREATE POLICY currencies_admin_all
  ON public.currencies FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

DROP TRIGGER IF EXISTS trg_currencies_set_updated_at ON public.currencies;
CREATE TRIGGER trg_currencies_set_updated_at
  BEFORE UPDATE ON public.currencies
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_set_updated_at();

-- ------------------------------------------------------------
-- 2. countries（國別主資料，default_currency_code FK → currencies）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.countries (
  code                   TEXT        PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name_zh                TEXT        NOT NULL,
  name_en                TEXT        NULL,
  default_currency_code  TEXT        NOT NULL REFERENCES public.currencies(code),
  is_active              BOOLEAN     NOT NULL DEFAULT true,
  sort_order             INT         NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS countries_select_authenticated ON public.countries;
CREATE POLICY countries_select_authenticated
  ON public.countries FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS countries_admin_all ON public.countries;
CREATE POLICY countries_admin_all
  ON public.countries FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

DROP TRIGGER IF EXISTS trg_countries_set_updated_at ON public.countries;
CREATE TRIGGER trg_countries_set_updated_at
  BEFORE UPDATE ON public.countries
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_set_updated_at();

-- ------------------------------------------------------------
-- 3. suppliers.country_code（FK → countries，NULL 允許、不 backfill 猜測）
-- ------------------------------------------------------------
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS country_code TEXT NULL REFERENCES public.countries(code);

-- ------------------------------------------------------------
-- 4. products / product_variants 重量 & 材積欄位
-- ------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS weight_kg  NUMERIC(10,3) NULL CHECK (weight_kg  >= 0),
  ADD COLUMN IF NOT EXISTS volume_m3  NUMERIC(12,6) NULL CHECK (volume_m3  >= 0);

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS weight_kg  NUMERIC(10,3) NULL CHECK (weight_kg  >= 0),
  ADD COLUMN IF NOT EXISTS volume_m3  NUMERIC(12,6) NULL CHECK (volume_m3  >= 0);

-- ------------------------------------------------------------
-- 5. Seed（冪等）
-- ------------------------------------------------------------
INSERT INTO public.currencies (code, name_zh, symbol, decimals, is_active, sort_order) VALUES
  ('TWD','新台幣','$', 2, true, 1),
  ('USD','美元','$', 2, true, 2),
  ('JPY','日圓','¥', 0, true, 3),
  ('CNY','人民幣','¥', 2, true, 4),
  ('EUR','歐元','€', 2, true, 5),
  ('HKD','港幣','HK$',2, true, 6),
  ('KRW','韓元','₩', 0, true, 7),
  ('GBP','英鎊','£', 2, true, 8)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.countries (code, name_zh, default_currency_code, sort_order, is_active) VALUES
  ('TW','台灣','TWD',1,true),
  ('JP','日本','JPY',2,true),
  ('US','美國','USD',3,true),
  ('CN','中國','CNY',4,true),
  ('KR','韓國','KRW',5,true),
  ('HK','香港','HKD',6,true),
  ('GB','英國','GBP',7,true),
  ('DE','德國','EUR',8,true)
ON CONFLICT (code) DO NOTHING;
