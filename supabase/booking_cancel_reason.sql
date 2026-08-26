-- Cancel reason + who cancelled (customer, driver, system).
-- Run once in Supabase SQL Editor. Safe to re-run.

alter table public.customer_delivery_orders
  add column if not exists cancel_reason text;

alter table public.taxi_bookings
  add column if not exists cancel_reason text;

alter table public.tuk_tuk_bookings
  add column if not exists cancel_reason text;

alter table public.shop_customer_orders
  add column if not exists cancel_reason text;

alter table public.customer_delivery_orders
  add column if not exists cancelled_by text;

alter table public.taxi_bookings
  add column if not exists cancelled_by text;

alter table public.tuk_tuk_bookings
  add column if not exists cancelled_by text;

alter table public.shop_customer_orders
  add column if not exists cancelled_by text;

alter table public.customer_delivery_orders
  add column if not exists cancelled_at timestamptz;

alter table public.taxi_bookings
  add column if not exists cancelled_at timestamptz;

alter table public.tuk_tuk_bookings
  add column if not exists cancelled_at timestamptz;

alter table public.shop_customer_orders
  add column if not exists cancelled_at timestamptz;

comment on column public.customer_delivery_orders.cancel_reason is 'Why the order was cancelled (e.g. breakdown, client not reachable).';
comment on column public.taxi_bookings.cancel_reason is 'Why the booking was cancelled.';
comment on column public.tuk_tuk_bookings.cancel_reason is 'Why the booking was cancelled.';
comment on column public.shop_customer_orders.cancel_reason is 'Why the shop order was cancelled.';

comment on column public.customer_delivery_orders.cancelled_by is 'Who cancelled: customer | driver | system';
comment on column public.taxi_bookings.cancelled_by is 'Who cancelled: customer | driver | system';
comment on column public.tuk_tuk_bookings.cancelled_by is 'Who cancelled: customer | driver | system';
comment on column public.shop_customer_orders.cancelled_by is 'Who cancelled: customer | driver | system | shop';
