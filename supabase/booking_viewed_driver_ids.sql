-- Track which drivers have seen an open booking offer (customer live tracking).
-- Run after: driver_booking_assignment.sql, shop_customer_orders_driver_assignment.sql

alter table public.customer_delivery_orders
  add column if not exists viewed_driver_ids uuid[] not null default '{}'::uuid[];

alter table public.taxi_bookings
  add column if not exists viewed_driver_ids uuid[] not null default '{}'::uuid[];

alter table public.tuk_tuk_bookings
  add column if not exists viewed_driver_ids uuid[] not null default '{}'::uuid[];

alter table public.shop_customer_orders
  add column if not exists viewed_driver_ids uuid[] not null default '{}'::uuid[];

comment on column public.customer_delivery_orders.viewed_driver_ids is 'Drivers who loaded this open offer on their home screen';
comment on column public.taxi_bookings.viewed_driver_ids is 'Drivers who loaded this open offer on their home screen';
comment on column public.tuk_tuk_bookings.viewed_driver_ids is 'Drivers who loaded this open offer on their home screen';
comment on column public.shop_customer_orders.viewed_driver_ids is 'Drivers who loaded this open shop delivery offer on their home screen';
