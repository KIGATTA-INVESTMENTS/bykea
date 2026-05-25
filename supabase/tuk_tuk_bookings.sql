-- Dedicated Tuk-Tuk bookings from /book-tuk-tuk (mirrors taxi_bookings minus ride_type).
-- Run after `register_login.sql`. Optional FK matches taxi_bookings pattern.

create table if not exists public.tuk_tuk_bookings (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid references public.app_users (id) on delete set null,

  pickup_location text not null,
  destination_location text not null,

  estimated_distance_label text,
  estimated_duration_label text,
  quoted_price numeric(12, 4),
  currency text not null default 'USD',

  status text not null default 'requested',

  created_at timestamptz not null default now(),

  constraint tuk_tuk_bookings_status_chk check (
    status in ('requested', 'confirmed', 'completed', 'cancelled')
  )
);

create index if not exists tuk_tuk_bookings_app_user_id_idx on public.tuk_tuk_bookings (app_user_id);
create index if not exists tuk_tuk_bookings_created_at_idx on public.tuk_tuk_bookings (created_at desc);

comment on table public.tuk_tuk_bookings is 'Customer Tuk-Tuk booking from /book-tuk-tuk';

alter table public.tuk_tuk_bookings enable row level security;

drop policy if exists "tuk_tuk_bookings_insert_anon" on public.tuk_tuk_bookings;
create policy "tuk_tuk_bookings_insert_anon"
on public.tuk_tuk_bookings for insert to anon with check (true);

drop policy if exists "tuk_tuk_bookings_select_anon" on public.tuk_tuk_bookings;
create policy "tuk_tuk_bookings_select_anon"
on public.tuk_tuk_bookings for select to anon using (true);

drop policy if exists "tuk_tuk_bookings_delete_anon" on public.tuk_tuk_bookings;
create policy "tuk_tuk_bookings_delete_anon"
on public.tuk_tuk_bookings for delete to anon using (true);
