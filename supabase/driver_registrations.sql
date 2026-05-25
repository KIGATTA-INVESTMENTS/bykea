-- Driver applications from /driver/register — plain Postgres (no Supabase Auth).
-- Run in Supabase SQL Editor after `register_login.sql` if you want the same project;
-- this file has no FK to app_users (drivers are a separate pool).
--
-- App inserts with the anon key (RLS below). Hash passwords in the app before insert
-- when you wire the form; until then the column stores whatever the client sends (same
-- pattern as public.app_users.password in this repo).

create extension if not exists pgcrypto;

create table if not exists public.driver_registrations (
  id uuid primary key default gen_random_uuid(),

  -- Step 1 — identity & login (table-based, not Auth)
  full_name text not null,
  phone text not null,
  email text not null,
  national_id text not null,
  password text not null,

  phone_country_code text not null default '+44',

  -- Optional: set when you upload a headshot to Storage
  profile_photo_url text,

  -- Step 2 — vehicle
  vehicle_type text not null,
  vehicle_make text not null,
  vehicle_model text not null,
  vehicle_plate text not null,
  vehicle_color text not null,

  constraint driver_registrations_vehicle_type_chk check (
    vehicle_type in ('Motorbike', 'Tuk-Tuk', 'Car')
  ),

  -- Step 3 — document files (store public Storage URLs or paths after upload)
  doc_national_id_url text,
  doc_license_url text,
  doc_vehicle_registration_url text,
  doc_profile_with_vehicle_url text,

  -- Deposit shown in UI (�$10); payment captured later in app / admin
  deposit_required_gbp numeric(12, 2) not null default 10.00,
  deposit_paid boolean not null default false,

  -- Admin workflow
  status text not null default 'pending',

  constraint driver_registrations_status_chk check (
    status in ('pending', 'approved', 'rejected')
  ),

  admin_notes text,

  email_verified_at timestamptz,
  email_verification_code_hash text,
  email_verification_expires_at timestamptz,
  email_verification_sent_at timestamptz,

  password_reset_code_hash text,
  password_reset_expires_at timestamptz,
  password_reset_sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one open application per email (re-apply after rejection is allowed)
create unique index if not exists driver_registrations_one_pending_email_idx
  on public.driver_registrations (lower(trim(email)))
  where (status = 'pending');

create index if not exists driver_registrations_phone_idx on public.driver_registrations (phone);
create index if not exists driver_registrations_status_idx on public.driver_registrations (status);
create index if not exists driver_registrations_created_at_idx on public.driver_registrations (created_at desc);

comment on table public.driver_registrations is 'Driver signup from /driver/register; no Supabase Auth — credentials in-row for your app login flow';
comment on column public.driver_registrations.password is 'App should insert a bcrypt/scrypt hash, not plain text, when wired from the client';
comment on column public.driver_registrations.doc_national_id_url is 'Maps to UI doc id: nid';
comment on column public.driver_registrations.doc_license_url is 'Maps to UI doc id: lic';
comment on column public.driver_registrations.doc_vehicle_registration_url is 'Maps to UI doc id: vreg';
comment on column public.driver_registrations.doc_profile_with_vehicle_url is 'Maps to UI doc id: pv';

-- Keep updated_at fresh on row changes
create or replace function public.set_driver_registrations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists driver_registrations_set_updated_at on public.driver_registrations;
create trigger driver_registrations_set_updated_at
  before update on public.driver_registrations
  for each row
  execute function public.set_driver_registrations_updated_at();

alter table public.driver_registrations enable row level security;

-- Anonymous key: submit application (same open pattern as app_users for local dev)
drop policy if exists "driver_registrations_insert_anon" on public.driver_registrations;
create policy "driver_registrations_insert_anon"
on public.driver_registrations
for insert
to anon
with check (true);

-- Allow anon reads only if you need them from the client (e.g. status poll).
-- Tighten later to auth.uid() or service_role-only for production.
drop policy if exists "driver_registrations_select_anon" on public.driver_registrations;
create policy "driver_registrations_select_anon"
on public.driver_registrations
for select
to anon
using (true);

drop policy if exists "driver_registrations_update_anon" on public.driver_registrations;
create policy "driver_registrations_update_anon"
on public.driver_registrations
for update
to anon
using (true)
with check (true);

drop policy if exists "driver_registrations_delete_anon" on public.driver_registrations;
create policy "driver_registrations_delete_anon"
on public.driver_registrations
for delete
to anon
using (true);
