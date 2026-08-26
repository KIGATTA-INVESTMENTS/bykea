-- Live location for online drivers waiting for offers (customer maps / nearby drivers).
-- Run after driver_registrations.sql

alter table public.driver_registrations
  add column if not exists is_online boolean not null default false,
  add column if not exists driver_live_lat double precision,
  add column if not exists driver_live_lng double precision,
  add column if not exists driver_live_updated_at timestamptz;

create index if not exists driver_registrations_online_live_idx
  on public.driver_registrations (is_online, driver_live_updated_at desc)
  where is_online = true;

comment on column public.driver_registrations.is_online is 'Driver toggled online on home dashboard';
comment on column public.driver_registrations.driver_live_lat is 'Last GPS lat while online';
comment on column public.driver_registrations.driver_live_lng is 'Last GPS lng while online';
comment on column public.driver_registrations.driver_live_updated_at is 'When driver_live_lat/lng was last updated';
