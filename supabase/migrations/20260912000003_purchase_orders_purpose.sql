-- 採購單目的/類型：一般採購 / 維修叫料
-- 供應商寄賣走 consignment_orders 而非 purchase_orders，故僅兩種
alter table public.purchase_orders
  add column if not exists purpose text not null default 'general'
  check (purpose in ('general', 'repair_parts'));

-- 回填：依備註字串推斷
update public.purchase_orders
set purpose = 'repair_parts'
where purpose = 'general'
  and notes ~* '維修叫料';