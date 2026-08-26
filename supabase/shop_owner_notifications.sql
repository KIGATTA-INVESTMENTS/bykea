-- Shop owner alerts when admin removes a product or product image.
-- Run after shop_owners.sql.

create table if not exists public.shop_owner_notifications (
  id uuid primary key default gen_random_uuid(),
  shop_owner_id uuid not null references public.shop_owners (id) on delete cascade,
  type text not null check (type in ('admin_product_deleted', 'admin_product_image_removed')),
  title text not null,
  body text not null,
  product_id uuid,
  product_name text,
  created_at timestamptz not null default now()
);

create index if not exists shop_owner_notifications_owner_created_idx
  on public.shop_owner_notifications (shop_owner_id, created_at desc);

comment on table public.shop_owner_notifications is
  'Persistent alerts for shop owners (e.g. admin removed product/image).';

alter table public.shop_owner_notifications enable row level security;

drop policy if exists "shop_owner_notifications_insert_anon" on public.shop_owner_notifications;
create policy "shop_owner_notifications_insert_anon"
on public.shop_owner_notifications for insert to anon with check (true);

drop policy if exists "shop_owner_notifications_select_anon" on public.shop_owner_notifications;
create policy "shop_owner_notifications_select_anon"
on public.shop_owner_notifications for select to anon using (true);

drop policy if exists "shop_owner_notifications_update_anon" on public.shop_owner_notifications;
create policy "shop_owner_notifications_update_anon"
on public.shop_owner_notifications for update to anon using (true) with check (true);
