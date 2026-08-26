-- Weekly product popularity for customer shop shelves + filter shops without products.
-- Run in Supabase Dashboard → SQL Editor after shop_customer_orders / shop_products exist.

-- Only list shops that have at least one active product.
create or replace function public.customer_shop_cards()
returns table (
  id uuid,
  business_name text,
  business_type text,
  business_address text,
  shop_image_url text
)
language sql
stable
security invoker
as $$
  select
    o.id,
    o.business_name,
    o.business_type,
    o.business_address,
    case
      when o.shop_image_url is null then null
      when o.shop_image_url like 'data:%' then null
      when length(o.shop_image_url) > 2048 then null
      else o.shop_image_url
    end as shop_image_url
  from public.shop_owners o
  where exists (
    select 1
    from public.shop_products p
    where p.shop_owner_id = o.id
      and p.is_active = true
  )
  order by o.business_name asc;
$$;

grant execute on function public.customer_shop_cards() to anon, authenticated;

-- Aggregate sales in the last 7 days for weekly ranking.
create or replace function public.customer_shop_weekly_product_stats()
returns table (
  product_id uuid,
  sales_qty bigint,
  order_count bigint
)
language sql
stable
security invoker
as $$
  select
    l.product_id,
    coalesce(sum(l.quantity), 0)::bigint as sales_qty,
    count(distinct l.order_id)::bigint as order_count
  from public.shop_customer_order_lines l
  join public.shop_customer_orders o on o.id = l.order_id
  where l.product_id is not null
    and o.placed_at >= (now() - interval '7 days')
    and coalesce(lower(o.status), '') not in ('cancelled', 'canceled')
  group by l.product_id
  order by sales_qty desc, order_count desc;
$$;

grant execute on function public.customer_shop_weekly_product_stats() to anon, authenticated;
