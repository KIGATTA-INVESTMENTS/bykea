-- Customer shop orders (from /shops → cart → checkout).
-- Run after `shop_owners.sql` and `shop_products.sql` (FKs reference those tables).
-- One order can include lines from multiple shops; each line stores shop_owner_id + product snapshot.

create table if not exists public.shop_customer_orders (
  id uuid primary key default gen_random_uuid(),

  -- Human-readable reference (e.g. ING-482931); shown on confirmation page.
  order_number text not null unique,

  customer_full_name text not null,
  customer_phone text not null,
  customer_email text,
  customer_address text not null,
  customer_notes text,

  subtotal numeric(12, 4) not null default 0,
  currency text not null default 'USD',
  status text not null default 'placed',

  placed_at timestamptz not null default now()
);

create table if not exists public.shop_customer_order_lines (
  id uuid primary key default gen_random_uuid(),

  order_id uuid not null references public.shop_customer_orders (id) on delete cascade,

  shop_owner_id uuid not null references public.shop_owners (id) on delete restrict,
  product_id uuid references public.shop_products (id) on delete set null,

  product_name text not null,
  unit_price numeric(12, 4) not null default 0,
  quantity int not null check (quantity > 0),
  line_total numeric(12, 4) not null default 0,

  shop_name text,
  image_url text
);

create index if not exists shop_customer_order_lines_order_id_idx on public.shop_customer_order_lines (order_id);
create index if not exists shop_customer_order_lines_shop_owner_id_idx on public.shop_customer_order_lines (shop_owner_id);
create index if not exists shop_customer_orders_placed_at_idx on public.shop_customer_orders (placed_at desc);

comment on table public.shop_customer_orders is 'Checkout from /shop/checkout — customer details + totals';
comment on table public.shop_customer_order_lines is 'Line items per shop product; snapshot fields for history';

alter table public.shop_customer_orders enable row level security;
alter table public.shop_customer_order_lines enable row level security;

drop policy if exists "shop_customer_orders_insert_anon" on public.shop_customer_orders;
create policy "shop_customer_orders_insert_anon"
on public.shop_customer_orders for insert to anon with check (true);

drop policy if exists "shop_customer_orders_select_anon" on public.shop_customer_orders;
create policy "shop_customer_orders_select_anon"
on public.shop_customer_orders for select to anon using (true);

drop policy if exists "shop_customer_orders_update_anon" on public.shop_customer_orders;
create policy "shop_customer_orders_update_anon"
on public.shop_customer_orders for update to anon using (true) with check (true);

drop policy if exists "shop_customer_order_lines_insert_anon" on public.shop_customer_order_lines;
create policy "shop_customer_order_lines_insert_anon"
on public.shop_customer_order_lines for insert to anon with check (true);

drop policy if exists "shop_customer_order_lines_select_anon" on public.shop_customer_order_lines;
create policy "shop_customer_order_lines_select_anon"
on public.shop_customer_order_lines for select to anon using (true);

drop policy if exists "shop_customer_order_lines_update_anon" on public.shop_customer_order_lines;
create policy "shop_customer_order_lines_update_anon"
on public.shop_customer_order_lines for update to anon using (true) with check (true);

drop policy if exists "shop_customer_orders_delete_anon" on public.shop_customer_orders;
create policy "shop_customer_orders_delete_anon"
on public.shop_customer_orders for delete to anon using (true);

drop policy if exists "shop_customer_order_lines_delete_anon" on public.shop_customer_order_lines;
create policy "shop_customer_order_lines_delete_anon"
on public.shop_customer_order_lines for delete to anon using (true);
