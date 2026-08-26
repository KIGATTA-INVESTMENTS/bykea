-- FCM Web Push tokens for drivers (ring alerts when app is backgrounded/closed).
-- Run in Supabase SQL Editor after driver_registrations.sql

create table if not exists public.driver_push_tokens (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_registrations (id) on delete cascade,
  fcm_token text not null,
  platform text not null default 'web',
  user_agent text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint driver_push_tokens_fcm_token_uidx unique (fcm_token)
);

create index if not exists driver_push_tokens_driver_id_idx
  on public.driver_push_tokens (driver_id);

comment on table public.driver_push_tokens is
  'Firebase Cloud Messaging tokens for driver offer push (Web Push / store WebView).';

alter table public.driver_push_tokens enable row level security;

drop policy if exists "driver_push_tokens_select_anon" on public.driver_push_tokens;
create policy "driver_push_tokens_select_anon"
on public.driver_push_tokens for select to anon using (true);

drop policy if exists "driver_push_tokens_insert_anon" on public.driver_push_tokens;
create policy "driver_push_tokens_insert_anon"
on public.driver_push_tokens for insert to anon with check (true);

drop policy if exists "driver_push_tokens_update_anon" on public.driver_push_tokens;
create policy "driver_push_tokens_update_anon"
on public.driver_push_tokens for update to anon using (true) with check (true);

drop policy if exists "driver_push_tokens_delete_anon" on public.driver_push_tokens;
create policy "driver_push_tokens_delete_anon"
on public.driver_push_tokens for delete to anon using (true);

notify pgrst, 'reload schema';
