-- Placed customer delivery orders — full snapshot (pricing, payment, route, package).
-- Driver assignment / rider fields can be added later.
-- Run in Supabase SQL Editor after `register_login.sql`, `delivery_requests.sql`.

create table if not exists public.customer_delivery_orders (
  id uuid primary key default gen_random_uuid(),

  -- Optional link to row created at Package Details (wire app to pass UUID later)
  delivery_request_id uuid references public.delivery_requests (id) on delete set null,

  app_user_id uuid references public.app_users (id) on delete set null,

  pickup_location text not null,
  dropoff_location text not null,
  extra_stops jsonb not null default '[]'::jsonb,

  delivery_type text not null default 'standard',
  distance_estimate text,

  package_size text,
  package_weight text,
  package_category text,
  package_notes text,
  package_photo_filename text,

  requested_vehicle_type text,

  -- Snapshot of fare at checkout (from service_pricing + distance at estimate time)
  base_fare_amount numeric(12, 4) not null default 0,
  distance_fee_amount numeric(12, 4) not null default 0,
  service_fee_amount numeric(12, 4) not null default 0,
  total_amount numeric(12, 4) not null,
  currency text not null default 'USD',

  payment_method text not null,

  payment_gateway text,
  payment_status text,
  paynow_reference text,
  paynow_poll_url text,
  paynow_redirect_url text,
  payment_started_at timestamptz,
  payment_completed_at timestamptz,

  delivery_title text,
  eta_text text,
  scheduled_for timestamptz,

  status text not null default 'placed',

  created_at timestamptz not null default now(),

  constraint customer_delivery_orders_payment_chk check (
    payment_method in ('ecocash', 'card', 'cod')
  ),
  constraint customer_delivery_orders_status_chk check (
    status in ('placed', 'paid', 'cancelled')
  ),
  constraint customer_delivery_orders_payment_status_chk check (
    payment_status is null or payment_status in ('pending', 'paid', 'failed', 'cancelled')
  )
);

comment on column public.customer_delivery_orders.package_category is
  'Snapshot of customer free-text package type at checkout (same meaning as delivery_requests.package_category).';

create index if not exists customer_delivery_orders_app_user_id_idx
  on public.customer_delivery_orders (app_user_id);

create index if not exists customer_delivery_orders_created_at_idx
  on public.customer_delivery_orders (created_at desc);

create index if not exists customer_delivery_orders_delivery_request_id_idx
  on public.customer_delivery_orders (delivery_request_id);

comment on table public.customer_delivery_orders is 'Customer placed order: route, package, pricing snapshot, payment (no driver yet)';
comment on column public.customer_delivery_orders.delivery_request_id is 'FK to delivery_requests when app passes id through the flow';
comment on column public.customer_delivery_orders.payment_method is 'ecocash = bank transfer UI id; adjust CHECK if you rename methods';

alter table public.customer_delivery_orders enable row level security;

drop policy if exists "customer_delivery_orders_insert_anon" on public.customer_delivery_orders;
create policy "customer_delivery_orders_insert_anon"
on public.customer_delivery_orders
for insert
to anon
with check (true);

drop policy if exists "customer_delivery_orders_select_anon" on public.customer_delivery_orders;
create policy "customer_delivery_orders_select_anon"
on public.customer_delivery_orders
for select
to anon
using (true);

drop policy if exists "customer_delivery_orders_delete_anon" on public.customer_delivery_orders;
create policy "customer_delivery_orders_delete_anon"
on public.customer_delivery_orders
for delete
to anon
using (true);
