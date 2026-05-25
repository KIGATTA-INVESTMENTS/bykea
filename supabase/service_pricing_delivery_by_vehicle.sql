-- Run in Supabase SQL Editor: per-vehicle delivery rates (Motorbike, Tuk-Tuk, Car only).
-- Copies from legacy `delivery` row when present; safe to re-run.

alter table public.service_pricing
  drop constraint if exists service_pricing_service_type_chk;

-- Remove any row not allowed by the new CHECK (bicycle/taxi delivery, typos, old tests, etc.)
delete from public.service_pricing
where service_type not in (
  'delivery',
  'parcel',
  'taxi',
  'tuk_tuk',
  'delivery_motorbike',
  'delivery_tuk_tuk',
  'delivery_car'
);

alter table public.service_pricing
  add constraint service_pricing_service_type_chk check (
    service_type in (
      'delivery',
      'parcel',
      'taxi',
      'tuk_tuk',
      'delivery_motorbike',
      'delivery_tuk_tuk',
      'delivery_car'
    )
  );

insert into public.service_pricing (service_type, price_per_km, base_fare, service_fee, currency)
select 'delivery_motorbike', price_per_km, base_fare, service_fee, currency
from public.service_pricing where service_type = 'delivery'
on conflict (service_type) do nothing;

insert into public.service_pricing (service_type, price_per_km, base_fare, service_fee, currency)
select 'delivery_tuk_tuk', price_per_km, base_fare, service_fee, currency
from public.service_pricing where service_type = 'delivery'
on conflict (service_type) do nothing;

insert into public.service_pricing (service_type, price_per_km, base_fare, service_fee, currency)
select 'delivery_car', price_per_km, base_fare, service_fee, currency
from public.service_pricing where service_type = 'delivery'
on conflict (service_type) do nothing;

insert into public.service_pricing (service_type, price_per_km, base_fare, service_fee, currency)
values
  ('delivery_motorbike', 0.50, 1.50, 0.20, 'USD'),
  ('delivery_tuk_tuk', 0.55, 1.65, 0.22, 'USD'),
  ('delivery_car', 0.60, 1.80, 0.24, 'USD')
on conflict (service_type) do nothing;
