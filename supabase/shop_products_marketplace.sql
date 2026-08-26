-- Marketplace fields for customer shop browse (brand, free delivery).
-- Run in Supabase Dashboard → SQL Editor after shop_products.sql.
-- Sale pricing continues to use existing compare_at_price > price.

alter table public.shop_products
  add column if not exists brand_name text;

alter table public.shop_products
  add column if not exists offers_free_delivery boolean not null default false;

create index if not exists shop_products_brand_name_idx
  on public.shop_products (lower(brand_name))
  where brand_name is not null and length(trim(brand_name)) > 0;

create index if not exists shop_products_on_sale_idx
  on public.shop_products (shop_owner_id)
  where is_active = true
    and compare_at_price is not null
    and compare_at_price > price;

create index if not exists shop_products_free_delivery_idx
  on public.shop_products (offers_free_delivery)
  where is_active = true and offers_free_delivery = true;

comment on column public.shop_products.brand_name is 'Optional product brand for marketplace filters and PDP';
comment on column public.shop_products.offers_free_delivery is 'When true, product appears in Free delivery marketplace shelf';

-- Faster customer shelf: include brand + free delivery, prefer recent / sale items.
drop function if exists public.customer_shop_product_shelf(integer);

create or replace function public.customer_shop_product_shelf(lim integer default 48)
returns table (
  id uuid,
  shop_owner_id uuid,
  name text,
  category text,
  brand_name text,
  price numeric,
  compare_at_price numeric,
  stock integer,
  is_active boolean,
  offers_free_delivery boolean,
  image_primary_url text,
  tags jsonb,
  created_at timestamptz
)
language sql
stable
security invoker
as $$
  select
    p.id,
    p.shop_owner_id,
    p.name,
    p.category,
    nullif(trim(p.brand_name), '') as brand_name,
    p.price,
    p.compare_at_price,
    p.stock,
    p.is_active,
    coalesce(p.offers_free_delivery, false) as offers_free_delivery,
    case
      when p.image_primary_url is null then null
      when p.image_primary_url like 'data:%' then null
      when length(p.image_primary_url) > 2048 then null
      else p.image_primary_url
    end as image_primary_url,
    coalesce(p.tags, '[]'::jsonb) as tags,
    p.created_at
  from public.shop_products p
  where p.is_active = true
  order by
    case when p.compare_at_price is not null and p.compare_at_price > p.price then 0 else 1 end,
    case when p.image_primary_url is not null and p.image_primary_url not like 'data:%' then 0 else 1 end,
    p.created_at desc nulls last,
    p.name asc
  limit greatest(1, least(coalesce(lim, 48), 120));
$$;

grant execute on function public.customer_shop_product_shelf(integer) to anon, authenticated;
