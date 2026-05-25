-- Run this in Supabase SQL Editor
-- Creates a plain table-based register/login flow (no Supabase Auth)

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text not null unique,
  password text not null,
  email_verified_at timestamptz,
  email_verification_code_hash text,
  email_verification_expires_at timestamptz,
  email_verification_sent_at timestamptz,
  password_reset_code_hash text,
  password_reset_expires_at timestamptz,
  password_reset_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.app_users enable row level security;

-- Allow frontend anon key to register (insert) and login lookup (select).
-- NOTE: This is intentionally open for your requested simple setup.
drop policy if exists "app_users_insert_anon" on public.app_users;
create policy "app_users_insert_anon"
on public.app_users
for insert
to anon
with check (true);

drop policy if exists "app_users_select_anon" on public.app_users;
create policy "app_users_select_anon"
on public.app_users
for select
to anon
using (true);

drop policy if exists "app_users_update_anon" on public.app_users;
create policy "app_users_update_anon"
on public.app_users
for update
to anon
using (true)
with check (true);

-- Admin (/admin/customers) and customer self-delete (/profile) use anon delete — see app_users_self_delete_customer.sql.
drop policy if exists "app_users_delete_anon" on public.app_users;
create policy "app_users_delete_anon"
on public.app_users
for delete
to anon
using (true);
