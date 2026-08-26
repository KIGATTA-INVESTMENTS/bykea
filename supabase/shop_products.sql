-- Shop owner catalog items (Add product / products list).
-- Run after `shop_owners.sql` so `shop_owner_id` FK resolves.

create table if not exists public.shop_products (
  id uuid primary key default gen_random_uuid(),

  shop_owner_id uuid not null references public.shop_owners (id) on delete cascade,

  name text not null,
  category text not null,
  brand_name text,
  description text,
  price numeric(12, 4) not null default 0,
  compare_at_price numeric(12, 4),
  stock integer not null default 0,
  sku text,
  weight text,

  currency text not null default 'USD',
  is_active boolean not null default true,
  offers_free_delivery boolean not null default false,

  has_variants boolean not null default false,
  -- e.g. [{"type":"Size","name":"Large","price":"4.5","stock":"10"}]
  variants jsonb not null default '[]'::jsonb,

  -- Optional: filenames or Storage paths when you wire uploads (nullable for now).
  image_primary_url text,
  image_urls jsonb not null default '[]'::jsonb,

  -- Search keywords for customer product search (also see shop_products_tags.sql).
  tags jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_products_shop_owner_id_idx on public.shop_products (shop_owner_id);
create index if not exists shop_products_created_at_idx on public.shop_products (created_at desc);
create index if not exists shop_products_category_idx on public.shop_products (shop_owner_id, category);

comment on table public.shop_products is 'Products created from /shop-owner/products/new';
comment on column public.shop_products.variants is 'JSON array: type, name, price, stock (strings or numbers from UI)';

alter table public.shop_products enable row level security;

drop policy if exists "shop_products_insert_anon" on public.shop_products;
create policy "shop_products_insert_anon"
on public.shop_products for insert to anon with check (true);

drop policy if exists "shop_products_select_anon" on public.shop_products;
create policy "shop_products_select_anon"
on public.shop_products for select to anon using (true);

drop policy if exists "shop_products_update_anon" on public.shop_products;
create policy "shop_products_update_anon"
on public.shop_products for update to anon using (true) with check (true);

drop policy if exists "shop_products_delete_anon" on public.shop_products;
create policy "shop_products_delete_anon"
on public.shop_products for delete to anon using (true);

-- Example insert (replace SHOP_OWNER_UUID with a real id from public.shop_owners):
-- insert into public.shop_products (
--   shop_owner_id, name, category, description, price, compare_at_price, stock, sku, weight,
--   is_active, has_variants, variants
-- ) values (
--   'SHOP_OWNER_UUID'::uuid,
--   'Full cream milk 1L',
--   'Dairy',
--   'Fresh daily',
--   2.99,
--   3.49,
--   24,
--   'SKU-MILK-1L',
--   '1.05 kg',
--   true,
--   false,
--   '[]'::jsonb
-- );
