-- Live driver location fields for customer /live-tracking.
-- Run after driver_booking_assignment.sql.

alter table public.customer_delivery_orders
  add column if not exists driver_live_lat double precision,
  add column if not exists driver_live_lng double precision,
  add column if not exists driver_live_updated_at timestamptz,
  add column if not exists driver_nav_leg text;

alter table public.taxi_bookings
  add column if not exists driver_live_lat double precision,
  add column if not exists driver_live_lng double precision,
  add column if not exists driver_live_updated_at timestamptz,
  add column if not exists driver_nav_leg text;

alter table public.tuk_tuk_bookings
  add column if not exists driver_live_lat double precision,
  add column if not exists driver_live_lng double precision,
  add column if not exists driver_live_updated_at timestamptz,
  add column if not exists driver_nav_leg text;

alter table public.shop_customer_orders
  add column if not exists driver_live_lat double precision,
  add column if not exists driver_live_lng double precision,
  add column if not exists driver_live_updated_at timestamptz,
  add column if not exists driver_nav_leg text;

comment on column public.customer_delivery_orders.driver_nav_leg is 'Driver nav phase: to_pickup | to_dropoff';
comment on column public.taxi_bookings.driver_nav_leg is 'Driver nav phase: to_pickup | to_dropoff';
comment on column public.tuk_tuk_bookings.driver_nav_leg is 'Driver nav phase: to_pickup | to_dropoff';
comment on column public.shop_customer_orders.driver_nav_leg is 'Driver nav phase: to_pickup | to_dropoff';
