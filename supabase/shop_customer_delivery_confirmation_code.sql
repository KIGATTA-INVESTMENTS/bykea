-- Run in Supabase SQL Editor.
-- Shop customers get a 6-digit code at checkout; the driver must enter it at customer drop-off.

alter table public.shop_customer_orders
  add column if not exists delivery_confirmation_code text;

alter table public.shop_customer_orders
  add column if not exists delivery_confirmed_at timestamptz;

comment on column public.shop_customer_orders.delivery_confirmation_code is
  'Six-digit code shown to the customer after shop checkout; driver enters it at customer drop-off.';

comment on column public.shop_customer_orders.delivery_confirmed_at is
  'Set when the driver successfully verifies the customer delivery confirmation code.';

create index if not exists shop_customer_orders_delivery_code_idx
  on public.shop_customer_orders (delivery_confirmation_code)
  where delivery_confirmation_code is not null;
