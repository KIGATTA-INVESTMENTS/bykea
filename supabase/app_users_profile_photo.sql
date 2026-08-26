-- Customer profile photos: DB column + Storage bucket for uploads.
-- Run once in Supabase Dashboard → SQL Editor (after register_login.sql).
--
-- App uploads to: shop-media/customers/<user-id>/avatar.jpg
-- Then stores the public URL in app_users.profile_photo_url

-- ----- Column on app_users -----
alter table public.app_users add column if not exists profile_photo_url text;

comment on column public.app_users.profile_photo_url is
  'Optional avatar; public Storage URL under shop-media/customers/<id>/ or compressed data URL fallback.';

-- Refresh PostgREST schema cache so the app sees the new column immediately.
notify pgrst, 'reload schema';

-- ----- Storage bucket (shared with shop images) -----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shop-media',
  'shop-media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "shop_media_objects_select_public" on storage.objects;
create policy "shop_media_objects_select_public"
  on storage.objects
  for select
  to public
  using (bucket_id = 'shop-media');

drop policy if exists "shop_media_objects_insert_anon" on storage.objects;
create policy "shop_media_objects_insert_anon"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'shop-media');

drop policy if exists "shop_media_objects_update_anon" on storage.objects;
create policy "shop_media_objects_update_anon"
  on storage.objects
  for update
  to anon
  using (bucket_id = 'shop-media')
  with check (bucket_id = 'shop-media');

drop policy if exists "shop_media_objects_delete_anon" on storage.objects;
create policy "shop_media_objects_delete_anon"
  on storage.objects
  for delete
  to anon
  using (bucket_id = 'shop-media');
