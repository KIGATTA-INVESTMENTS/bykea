-- Pricing per service: per km, base fare, service fee — run in Supabase SQL Editor

create table if not exists public.service_pricing (
  id uuid primary key default gen_random_uuid(),
  service_type text not null unique,
  price_per_km numeric(12, 4) not null default 0,
  base_fare numeric(12, 4) not null default 0,
  service_fee numeric(12, 4) not null default 0,
  currency text not null default 'USD',
  updated_at timestamptz not null default now(),
  constraint service_pricing_service_type_chk check (
    service_type in (
      'delivery',
      'parcel',
      'taxi',
      'tuk_tuk',
      'delivery_motorbike',
      'delivery_tuk_tuk',
      'delivery_car'
    )
  )
);

alter table public.service_pricing add column if not exists base_fare numeric(12, 4) not null default 0;
alter table public.service_pricing add column if not exists service_fee numeric(12, 4) not null default 0;

-- Strip hourly columns from older schemas (safe to re-run)
alter table public.service_pricing drop column if exists base_price_per_hour_off_peak;
alter table public.service_pricing drop column if exists base_price_per_hour_peak;
alter table public.service_pricing drop column if exists base_price_per_hour;

create index if not exists service_pricing_service_type_idx on public.service_pricing (service_type);

-- Widen CHECK on existing DBs (create table if not exists may skip new constraint)
alter table public.service_pricing drop constraint if exists service_pricing_service_type_chk;

-- Remove rows not in the new allowlist (avoids ERROR 23514 when adding CHECK)
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

comment on table public.service_pricing is 'Admin-set fare components per service';
comment on column public.service_pricing.price_per_km is 'Amount charged per kilometre';
comment on column public.service_pricing.base_fare is 'Flat base fare before distance';
comment on column public.service_pricing.service_fee is 'Platform / service fee';

alter table public.service_pricing enable row level security;

drop policy if exists "service_pricing_select_anon" on public.service_pricing;
create policy "service_pricing_select_anon"
on public.service_pricing for select to anon using (true);

drop policy if exists "service_pricing_insert_anon" on public.service_pricing;
create policy "service_pricing_insert_anon"
on public.service_pricing for insert to anon with check (true);

drop policy if exists "service_pricing_update_anon" on public.service_pricing;
create policy "service_pricing_update_anon"
on public.service_pricing for update to anon using (true) with check (true);

-- Default rows (safe to re-run). Delivery: separate rate per vehicle class; ride rows unchanged.
insert into public.service_pricing (
  service_type,
  price_per_km,
  base_fare,
  service_fee,
  currency
)
values
  ('delivery_motorbike', 0.50, 1.50, 0.20, 'USD'),
  ('delivery_tuk_tuk', 0.55, 1.65, 0.22, 'USD'),
  ('delivery_car', 0.60, 1.80, 0.24, 'USD'),
  ('parcel', 0.45, 1.20, 0.15, 'USD'),
  ('taxi', 1.20, 3.00, 0.50, 'USD'),
  ('tuk_tuk', 0.80, 2.00, 0.35, 'USD')
on conflict (service_type) do nothing;

-- Legacy single delivery row (optional fallback for older app builds)
insert into public.service_pricing (service_type, price_per_km, base_fare, service_fee, currency)
values ('delivery', 0.50, 1.50, 0.20, 'USD')
on conflict (service_type) do nothing;

update public.service_pricing set base_fare = 1.50, service_fee = 0.20
where service_type = 'delivery_motorbike' and base_fare = 0 and service_fee = 0;

update public.service_pricing set base_fare = 1.65, service_fee = 0.22
where service_type = 'delivery_tuk_tuk' and base_fare = 0 and service_fee = 0;

update public.service_pricing set base_fare = 1.80, service_fee = 0.24
where service_type = 'delivery_car' and base_fare = 0 and service_fee = 0;

update public.service_pricing set base_fare = 1.50, service_fee = 0.20
where service_type = 'delivery' and base_fare = 0 and service_fee = 0;

update public.service_pricing set base_fare = 1.20, service_fee = 0.15
where service_type = 'parcel' and base_fare = 0 and service_fee = 0;

update public.service_pricing set base_fare = 3.00, service_fee = 0.50
where service_type = 'taxi' and base_fare = 0 and service_fee = 0;

update public.service_pricing set base_fare = 2.00, service_fee = 0.35
where service_type = 'tuk_tuk' and base_fare = 0 and service_fee = 0;
