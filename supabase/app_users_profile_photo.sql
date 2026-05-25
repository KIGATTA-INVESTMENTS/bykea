-- Customer profile photo URL (Supabase Storage public URL or compressed data URL).
-- Run in Supabase SQL Editor after register_login.sql.

alter table public.app_users add column if not exists profile_photo_url text;

comment on column public.app_users.profile_photo_url is
  'Optional avatar; public Storage URL under shop-media/customers/<id>/ or inline data URL.';
