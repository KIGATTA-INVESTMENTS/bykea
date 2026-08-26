-- Package photos: customer (booking) + driver (pickup).
-- Run in Supabase SQL Editor after `customer_delivery_orders.sql` and `delivery_requests.sql`.

alter table public.customer_delivery_orders
  add column if not exists package_photo_data_url text;

alter table public.customer_delivery_orders
  add column if not exists driver_package_photo_data_url text;

comment on column public.customer_delivery_orders.package_photo_data_url is
  'Compressed JPEG data URL from the customer package photo.';

comment on column public.customer_delivery_orders.driver_package_photo_data_url is
  'Compressed JPEG data URL of the package taken by the driver at pickup.';

alter table public.delivery_requests
  add column if not exists package_photo_data_url text;

comment on column public.delivery_requests.package_photo_data_url is
  'Optional compressed JPEG data URL from Package Details.';
