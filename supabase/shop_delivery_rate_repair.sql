-- Fix absurd shop delivery per-km rates (often caused by copying a flat fee into price_per_km).
-- Run in Supabase SQL Editor. Safe to re-run.
-- Example bug: $97/km × ~1 km = $97 delivery on a short shop order.

update public.shop_delivery_settings
set
  delivery_fee_per_km = 1.00,
  price_per_km = 1.00,
  updated_at = now()
where id = 1
  and (
    coalesce(delivery_fee_per_km, 0) > 15
    or coalesce(price_per_km, 0) > 15
  );

-- Ensure both columns match after any partial/legacy values.
update public.shop_delivery_settings
set
  delivery_fee_per_km = coalesce(nullif(delivery_fee_per_km, 0), price_per_km, 1.00),
  price_per_km = coalesce(nullif(price_per_km, 0), delivery_fee_per_km, 1.00),
  updated_at = now()
where id = 1;
