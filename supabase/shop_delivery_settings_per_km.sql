-- Per-km shop delivery pricing (run after shop_delivery_settings.sql).
-- Admin: /admin/shop-delivery-price — checkout uses distance × rate.

alter table public.shop_delivery_settings
  add column if not exists delivery_fee_per_km numeric(12, 4)
    constraint shop_delivery_fee_per_km_chk check (delivery_fee_per_km is null or delivery_fee_per_km >= 0);

alter table public.shop_delivery_settings
  add column if not exists price_per_km numeric(12, 4);

alter table public.shop_delivery_settings
  add column if not exists min_delivery_fee numeric(12, 4) not null default 0
    constraint shop_min_delivery_fee_chk check (min_delivery_fee >= 0);

alter table public.shop_delivery_settings
  alter column price_per_km set default 1.00;

comment on column public.shop_delivery_settings.delivery_fee_per_km is 'USD charged per billable km (shop → customer)';
comment on column public.shop_delivery_settings.price_per_km is 'Same as delivery_fee_per_km (kept for older migrations)';
comment on column public.shop_delivery_settings.min_delivery_fee is 'Unused minimum (legacy column, always 0)';
comment on column public.shop_delivery_settings.delivery_fee is 'Legacy flat fee — not used at checkout';

-- Backfill both per-km columns. Never copy flat `delivery_fee` into per-km rates.
update public.shop_delivery_settings
set
  delivery_fee_per_km = coalesce(delivery_fee_per_km, price_per_km, 1.00),
  price_per_km = coalesce(price_per_km, delivery_fee_per_km, 1.00),
  min_delivery_fee = coalesce(min_delivery_fee, 0),
  updated_at = now()
where id = 1;

insert into public.shop_delivery_settings (
  id,
  delivery_fee,
  delivery_fee_per_km,
  price_per_km,
  min_delivery_fee,
  currency
)
values (1, 2.99, 1.00, 1.00, 0, 'USD')
on conflict (id) do update
set
  delivery_fee_per_km = coalesce(public.shop_delivery_settings.delivery_fee_per_km, excluded.delivery_fee_per_km, 1.00),
  price_per_km = coalesce(public.shop_delivery_settings.price_per_km, excluded.price_per_km, excluded.delivery_fee_per_km, 1.00),
  min_delivery_fee = coalesce(public.shop_delivery_settings.min_delivery_fee, 0),
  updated_at = now();
