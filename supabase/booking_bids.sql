-- Bidding on open bookings: admin fare = minimum; customer/driver can bid up; either party accepts.
-- Run after: customer_delivery_orders.sql, taxi_bookings.sql, tuk_tuk_bookings.sql, service_pricing.sql
--
-- If you get "deadlock detected" / "canceling statement due to lock_timeout":
-- your running app is holding read locks on these tables. Either (a) stop the dev
-- server (Ctrl+C on `npm start`) then run this once, or (b) just RE-RUN this file —
-- it is idempotent and each ALTER waits at most 5s before failing so it never hangs.

set lock_timeout = '5s';

-- ---------- booking columns (one column per statement = shorter locks, fewer deadlocks) ----------
alter table public.customer_delivery_orders add column if not exists minimum_fare_amount numeric;
alter table public.customer_delivery_orders add column if not exists customer_offer_amount numeric;
alter table public.customer_delivery_orders add column if not exists agreed_fare_amount numeric;
alter table public.customer_delivery_orders add column if not exists bid_status text not null default 'open';

alter table public.taxi_bookings add column if not exists minimum_fare_amount numeric;
alter table public.taxi_bookings add column if not exists customer_offer_amount numeric;
alter table public.taxi_bookings add column if not exists agreed_fare_amount numeric;
alter table public.taxi_bookings add column if not exists bid_status text not null default 'open';

alter table public.tuk_tuk_bookings add column if not exists minimum_fare_amount numeric;
alter table public.tuk_tuk_bookings add column if not exists customer_offer_amount numeric;
alter table public.tuk_tuk_bookings add column if not exists agreed_fare_amount numeric;
alter table public.tuk_tuk_bookings add column if not exists bid_status text not null default 'open';

comment on column public.customer_delivery_orders.minimum_fare_amount is 'Admin formula fare at booking — floor for bids';
comment on column public.customer_delivery_orders.customer_offer_amount is 'Customer current offer (>= minimum_fare_amount)';
comment on column public.customer_delivery_orders.agreed_fare_amount is 'Locked fare when bid is accepted';
comment on column public.customer_delivery_orders.bid_status is 'open | matched | cancelled';

-- Backfill existing rows: minimum = total, offer = total
update public.customer_delivery_orders
set
  minimum_fare_amount = coalesce(minimum_fare_amount, total_amount),
  customer_offer_amount = coalesce(customer_offer_amount, total_amount)
where minimum_fare_amount is null or customer_offer_amount is null;

update public.taxi_bookings
set
  minimum_fare_amount = coalesce(minimum_fare_amount, quoted_price),
  customer_offer_amount = coalesce(customer_offer_amount, quoted_price)
where minimum_fare_amount is null or customer_offer_amount is null;

update public.tuk_tuk_bookings
set
  minimum_fare_amount = coalesce(minimum_fare_amount, quoted_price),
  customer_offer_amount = coalesce(customer_offer_amount, quoted_price)
where minimum_fare_amount is null or customer_offer_amount is null;

-- ---------- bid history ----------
create table if not exists public.booking_bids (
  id uuid primary key default gen_random_uuid(),
  booking_table text not null,
  booking_id uuid not null,
  bidder_role text not null check (bidder_role in ('customer', 'driver')),
  bidder_id uuid not null,
  amount numeric not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'withdrawn', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists booking_bids_booking_idx
  on public.booking_bids (booking_table, booking_id, created_at desc);

create index if not exists booking_bids_pending_idx
  on public.booking_bids (booking_table, booking_id, status)
  where status = 'pending';

alter table public.booking_bids enable row level security;

drop policy if exists "booking_bids_select_anon" on public.booking_bids;
create policy "booking_bids_select_anon"
on public.booking_bids for select to anon using (true);

drop policy if exists "booking_bids_insert_anon" on public.booking_bids;
create policy "booking_bids_insert_anon"
on public.booking_bids for insert to anon with check (true);

drop policy if exists "booking_bids_update_anon" on public.booking_bids;
create policy "booking_bids_update_anon"
on public.booking_bids for update to anon using (true) with check (true);
