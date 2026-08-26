-- Per-driver notification preferences (Profile → Notifications).
-- Run in Supabase SQL Editor after driver_registrations.sql

create table if not exists public.driver_notification_prefs (
  driver_id uuid primary key references public.driver_registrations (id) on delete cascade,
  -- Master: alert this driver about new booking offers (in-app toast / system banner when open)
  new_offers boolean not null default true,
  -- Play ring / vibration with new offers
  offer_sound boolean not null default true,
  -- Allow FCM push when the app is backgrounded or closed
  push_when_closed boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.driver_notification_prefs is
  'Driver toggles for offer alerts, sound, and closed-app push (Profile → Notifications).';

alter table public.driver_notification_prefs enable row level security;

drop policy if exists "driver_notification_prefs_select_anon" on public.driver_notification_prefs;
create policy "driver_notification_prefs_select_anon"
on public.driver_notification_prefs for select to anon using (true);

drop policy if exists "driver_notification_prefs_insert_anon" on public.driver_notification_prefs;
create policy "driver_notification_prefs_insert_anon"
on public.driver_notification_prefs for insert to anon with check (true);

drop policy if exists "driver_notification_prefs_update_anon" on public.driver_notification_prefs;
create policy "driver_notification_prefs_update_anon"
on public.driver_notification_prefs for update to anon using (true) with check (true);

drop policy if exists "driver_notification_prefs_delete_anon" on public.driver_notification_prefs;
create policy "driver_notification_prefs_delete_anon"
on public.driver_notification_prefs for delete to anon using (true);

notify pgrst, 'reload schema';
