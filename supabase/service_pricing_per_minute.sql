-- Add per-minute fare component to service_pricing — run in Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / idempotent updates).

alter table public.service_pricing
  add column if not exists price_per_minute numeric(12, 4) not null default 0;

comment on column public.service_pricing.price_per_minute is 'Amount charged per minute of estimated trip time';

-- Sensible defaults per service (only fills rows still at 0).
update public.service_pricing set price_per_minute = 0.05 where service_type = 'delivery_motorbike' and price_per_minute = 0;
update public.service_pricing set price_per_minute = 0.06 where service_type = 'delivery_tuk_tuk' and price_per_minute = 0;
update public.service_pricing set price_per_minute = 0.08 where service_type = 'delivery_car' and price_per_minute = 0;
update public.service_pricing set price_per_minute = 0.05 where service_type = 'delivery' and price_per_minute = 0;
update public.service_pricing set price_per_minute = 0.04 where service_type = 'parcel' and price_per_minute = 0;
update public.service_pricing set price_per_minute = 0.15 where service_type = 'taxi' and price_per_minute = 0;
update public.service_pricing set price_per_minute = 0.10 where service_type = 'tuk_tuk' and price_per_minute = 0;

-- Optional: persist time component on placed delivery orders (price estimate snapshot).
alter table public.customer_delivery_orders
  add column if not exists time_fee_amount numeric(12, 4) not null default 0;

comment on column public.customer_delivery_orders.time_fee_amount is 'Snapshot: estimated minutes × price_per_minute at checkout';
