-- Run in Supabase SQL Editor after `driver_booking_completed_at.sql`.
-- Customer gets a 6-digit code at checkout; driver must enter it to mark parcel delivered.

alter table public.customer_delivery_orders
  add column if not exists delivery_confirmation_code text;

alter table public.customer_delivery_orders
  add column if not exists delivery_confirmed_at timestamptz;

comment on column public.customer_delivery_orders.delivery_confirmation_code is
  'Six-digit code shown to the customer after order confirmation; driver enters it at drop-off.';

comment on column public.customer_delivery_orders.delivery_confirmed_at is
  'Set when the driver successfully verifies the customer delivery confirmation code.';

create index if not exists customer_delivery_orders_delivery_code_idx
  on public.customer_delivery_orders (delivery_confirmation_code)
  where delivery_confirmation_code is not null;
