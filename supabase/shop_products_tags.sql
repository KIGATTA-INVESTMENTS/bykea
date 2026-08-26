-- Search tags on shop products (helps customer product search).
-- Run in Supabase Dashboard → SQL Editor after shop_products.sql.

alter table public.shop_products
  add column if not exists tags jsonb not null default '[]'::jsonb;

comment on column public.shop_products.tags is
  'Lowercase search keywords, e.g. ["organic","milk","1l"]. Used by customer search.';

create index if not exists shop_products_tags_gin_idx
  on public.shop_products using gin (tags);
