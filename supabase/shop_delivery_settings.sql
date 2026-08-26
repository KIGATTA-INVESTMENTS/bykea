-- Shop delivery fee (singleton). Run in Supabase SQL Editor.
-- Admin: /admin/shop-delivery-price — customer checkout shows this as "Delivery" and adds it to the order total.

create table if not exists public.shop_delivery_settings (
  id smallint primary key default 1,
  constraint shop_delivery_settings_singleton_chk check (id = 1),

  delivery_fee numeric(12, 4) not null default 2.99
    constraint shop_delivery_fee_chk check (delivery_fee >= 0),

  delivery_fee_per_km numeric(12, 4)
    constraint shop_delivery_fee_per_km_chk check (delivery_fee_per_km is null or delivery_fee_per_km >= 0),

  price_per_km numeric(12, 4) not null default 1.00
    constraint shop_price_per_km_chk check (price_per_km >= 0),

  min_delivery_fee numeric(12, 4) not null default 0
    constraint shop_min_delivery_fee_chk check (min_delivery_fee >= 0),

  currency text not null default 'USD',
  updated_at timestamptz not null default now(),

  constraint shop_delivery_currency_chk check (char_length(trim(currency)) > 0)
);

comment on table public.shop_delivery_settings is 'Single row (id=1): platform delivery charge for shop checkout';
comment on column public.shop_delivery_settings.delivery_fee is 'Legacy flat fee (kept for older rows)';
comment on column public.shop_delivery_settings.delivery_fee_per_km is 'USD per billable km from shop to customer at checkout';
comment on column public.shop_delivery_settings.price_per_km is 'Per-km rate (mirrors delivery_fee_per_km)';
comment on column public.shop_delivery_settings.min_delivery_fee is 'Minimum delivery charge at checkout';

alter table public.shop_delivery_settings enable row level security;

drop policy if exists "shop_delivery_settings_select_anon" on public.shop_delivery_settings;
create policy "shop_delivery_settings_select_anon"
on public.shop_delivery_settings for select to anon using (true);

drop policy if exists "shop_delivery_settings_insert_anon" on public.shop_delivery_settings;
create policy "shop_delivery_settings_insert_anon"
on public.shop_delivery_settings for insert to anon with check (true);

drop policy if exists "shop_delivery_settings_update_anon" on public.shop_delivery_settings;
create policy "shop_delivery_settings_update_anon"
on public.shop_delivery_settings for update to anon using (true) with check (true);

insert into public.shop_delivery_settings (id, delivery_fee, delivery_fee_per_km, price_per_km, min_delivery_fee, currency)
values (1, 2.99, 1.00, 1.00, 0, 'USD')
on conflict (id) do nothing;

-- Persist delivery fee on each shop order (historical snapshot).
alter table public.shop_customer_orders
  add column if not exists delivery_fee numeric(12, 4) not null default 0
    constraint shop_customer_orders_delivery_fee_chk check (delivery_fee >= 0);

comment on column public.shop_customer_orders.delivery_fee is 'Delivery charge snapshot from shop_delivery_settings at order time';
