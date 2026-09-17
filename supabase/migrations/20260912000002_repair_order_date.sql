-- 維修單指定日期（對齊 purchase_orders.order_date 模式）
alter table public.repair_orders
  add column if not exists order_date date not null default current_date;