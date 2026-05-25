-- Taxi ride requests from Book a Ride — run after `register_login.sql` (optional `app_users` FK).

create table if not exists public.taxi_bookings (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid references public.app_users (id) on delete set null,

  pickup_location text not null,
  destination_location text not null,

  ride_type text not null,
  vehicle_type text not null default 'car',

  estimated_distance_label text,
  estimated_duration_label text,
  quoted_price numeric(12, 4),
  currency text not null default 'USD',

  status text not null default 'requested',

  created_at timestamptz not null default now(),

  constraint taxi_bookings_ride_type_chk check (
    ride_type in ('tuk', 'std', 'prem')
  ),
  constraint taxi_bookings_vehicle_type_chk check (
    vehicle_type in ('bicycle', 'tuktuk', 'car', 'minibus')
  ),
  constraint taxi_bookings_status_chk check (
    status in ('requested', 'confirmed', 'completed', 'cancelled')
  )
);

create index if not exists taxi_bookings_app_user_id_idx on public.taxi_bookings (app_user_id);
create index if not exists taxi_bookings_created_at_idx on public.taxi_bookings (created_at desc);

comment on table public.taxi_bookings is 'Customer taxi booking from /book-ride';
comment on column public.taxi_bookings.ride_type is 'UI ride key: tuk | std | prem';
comment on column public.taxi_bookings.vehicle_type is 'Customer choice: bicycle | tuktuk | car | minibus';
comment on column public.taxi_bookings.estimated_distance_label is 'Free-text estimate shown in app (e.g. 3.2 km)';
comment on column public.taxi_bookings.quoted_price is 'Displayed fare snapshot at booking time';

alter table public.taxi_bookings enable row level security;

drop policy if exists "taxi_bookings_insert_anon" on public.taxi_bookings;
create policy "taxi_bookings_insert_anon"
on public.taxi_bookings for insert to anon with check (true);

drop policy if exists "taxi_bookings_select_anon" on public.taxi_bookings;
create policy "taxi_bookings_select_anon"
on public.taxi_bookings for select to anon using (true);

drop policy if exists "taxi_bookings_delete_anon" on public.taxi_bookings;
create policy "taxi_bookings_delete_anon"
on public.taxi_bookings for delete to anon using (true);
