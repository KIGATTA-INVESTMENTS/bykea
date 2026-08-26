-- Delivery company fleets: owner registers company + bikes/bikers.
-- Each biker gets their own email + password on driver_registrations and logs in at /driver/login.
-- Run in Supabase SQL Editor after driver_registrations.sql

-- ----- Company -----
create table if not exists public.driver_companies (
  id uuid primary key default gen_random_uuid(),
  owner_driver_id uuid not null references public.driver_registrations (id) on delete cascade,
  company_name text not null,
  trading_name text,
  phone text,
  email text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_companies_owner_idx on public.driver_companies (owner_driver_id);
create index if not exists driver_companies_status_idx on public.driver_companies (status);

comment on table public.driver_companies is
  'Delivery companies owned by a driver_registrations row (account_mode = company_owner).';

-- ----- Account mode on drivers -----
alter table public.driver_registrations
  add column if not exists account_mode text not null default 'solo';

alter table public.driver_registrations
  drop constraint if exists driver_registrations_account_mode_chk;

alter table public.driver_registrations
  add constraint driver_registrations_account_mode_chk
  check (account_mode in ('solo', 'company_owner', 'company_biker'));

alter table public.driver_registrations
  add column if not exists company_id uuid references public.driver_companies (id) on delete set null;

create index if not exists driver_registrations_company_id_idx
  on public.driver_registrations (company_id);

create index if not exists driver_registrations_account_mode_idx
  on public.driver_registrations (account_mode);

-- Each biker (and owner) logs in with email + password stored on this table.
-- Unique emails required so each company biker can sign in separately.
do $$
begin
  create unique index if not exists driver_registrations_email_lower_uidx
    on public.driver_registrations (lower(trim(email)));
exception
  when unique_violation then
    raise notice 'driver_registrations_email_lower_uidx skipped: duplicate emails already exist — clean duplicates then re-run.';
  when others then
    raise notice 'driver_registrations_email_lower_uidx skipped: %', SQLERRM;
end $$;

comment on column public.driver_registrations.account_mode is
  'solo = independent rider; company_owner = fleet owner; company_biker = rider under a company (own email/password login)';
comment on column public.driver_registrations.company_id is
  'Set for company_owner and company_biker accounts';
comment on column public.driver_registrations.email is
  'Unique login email. Company bikes each have their own email + password.';
comment on column public.driver_registrations.password is
  'Login password for /driver/login (plain text matching existing driver login flow).';

-- ----- Fleet bikes -----
create table if not exists public.company_fleet_bikes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.driver_companies (id) on delete cascade,
  driver_id uuid references public.driver_registrations (id) on delete set null,
  biker_name text not null,
  biker_phone text,
  biker_email text not null,
  vehicle_type text not null default 'Motorbike'
    check (vehicle_type in ('Motorbike', 'Tuk-Tuk', 'Car')),
  vehicle_make text not null default '',
  vehicle_model text not null default '',
  vehicle_plate text not null,
  vehicle_color text not null default '',
  status text not null default 'active'
    check (status in ('active', 'inactive', 'maintenance')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, vehicle_plate)
);

-- If table already existed without NOT NULL on biker_email, tighten it (skip if nulls remain).
do $$
begin
  update public.company_fleet_bikes
  set biker_email = coalesce(nullif(trim(biker_email), ''), 'unknown+' || id::text || '@fleet.local')
  where biker_email is null or trim(biker_email) = '';

  alter table public.company_fleet_bikes
    alter column biker_email set not null;
exception
  when others then
    raise notice 'biker_email NOT NULL skipped: %', SQLERRM;
end $$;

create index if not exists company_fleet_bikes_company_idx on public.company_fleet_bikes (company_id);
create index if not exists company_fleet_bikes_driver_idx on public.company_fleet_bikes (driver_id);

do $$
begin
  create unique index if not exists company_fleet_bikes_biker_email_lower_uidx
    on public.company_fleet_bikes (lower(trim(biker_email)));
exception
  when others then
    raise notice 'company_fleet_bikes_biker_email_lower_uidx skipped: %', SQLERRM;
end $$;

comment on table public.company_fleet_bikes is
  'Bikes under a delivery company. biker_email matches driver_registrations.email for that biker login.';

-- ----- RLS (anon, same pattern as other tables in this app) -----
alter table public.driver_companies enable row level security;
alter table public.company_fleet_bikes enable row level security;

drop policy if exists "driver_companies_anon_all" on public.driver_companies;
create policy "driver_companies_anon_all"
  on public.driver_companies for all to anon using (true) with check (true);

drop policy if exists "company_fleet_bikes_anon_all" on public.company_fleet_bikes;
create policy "company_fleet_bikes_anon_all"
  on public.company_fleet_bikes for all to anon using (true) with check (true);
