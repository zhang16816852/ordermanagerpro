-- 業務佣金發放登記（rep_commission_payouts）
-- 記錄 admin 將某筆銷貨單的佣金實際發放給業務的時間。
-- 佣金鍵 = (rep_id, sales_note_id)，一筆銷貨單對一業務一次發放。

CREATE TABLE IF NOT EXISTS public.rep_commission_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sales_note_id UUID NOT NULL REFERENCES public.sales_notes(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  paid_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rep_id, sales_note_id)
);
ALTER TABLE public.rep_commission_payouts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_rep_commission_payouts_rep ON public.rep_commission_payouts(rep_id);
CREATE INDEX IF NOT EXISTS idx_rep_commission_payouts_sales_note ON public.rep_commission_payouts(sales_note_id);
CREATE INDEX IF NOT EXISTS idx_rep_commission_payouts_paid_date ON public.rep_commission_payouts(paid_date);

-- RLS：僅 admin 可管理（發放登記），業務可看自己的發放紀錄
DROP POLICY IF EXISTS "Admins can manage rep commission payouts" ON public.rep_commission_payouts;
CREATE POLICY "Admins can manage rep commission payouts" ON public.rep_commission_payouts
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Reps can view own commission payouts" ON public.rep_commission_payouts;
CREATE POLICY "Reps can view own commission payouts" ON public.rep_commission_payouts
  FOR SELECT USING (auth.uid() = rep_id);