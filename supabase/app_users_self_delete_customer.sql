-- Customer self-delete from /profile (and admin delete from /admin/customers).
-- Run in Supabase SQL Editor if delete returns a policy/permission error.
-- Safe to re-run. Requires register_login.sql (app_users table) first.
--
-- After delete, the row is removed — login with that email fails (no account).
-- Bookings linked via app_user_id are kept; FKs use ON DELETE SET NULL (guest).

drop policy if exists "app_users_delete_anon" on public.app_users;
create policy "app_users_delete_anon"
on public.app_users
for delete
to anon
using (true);
