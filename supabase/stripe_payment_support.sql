-- Stripe card payments: extend payment_method checks and store PaymentIntent id.
-- Run in Supabase SQL Editor after customer_delivery_orders.sql, taxi_tuk_payment_method.sql,
-- shop_customer_orders_paynow.sql, taxi_tuk_bookings_paynow.sql, driver_wallet_topups.sql.

-- customer_delivery_orders: allow `stripe` (Paynow stays as legacy `card` in DB).
alter table public.customer_delivery_orders drop constraint if exists customer_delivery_orders_payment_chk;
alter table public.customer_delivery_orders
  add constraint customer_delivery_orders_payment_chk check (
    payment_method in ('ecocash', 'card', 'cod', 'stripe', 'wallet')
  );

comment on column public.customer_delivery_orders.payment_method is
  'cod = cash; card = Paynow; stripe = Stripe card; wallet = in-app wallet; ecocash = legacy';

alter table public.customer_delivery_orders
  add column if not exists stripe_payment_intent_id text;

create index if not exists customer_delivery_orders_stripe_pi_idx
  on public.customer_delivery_orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- taxi / tuk
alter table public.taxi_bookings drop constraint if exists taxi_bookings_payment_method_chk;
alter table public.taxi_bookings
  add constraint taxi_bookings_payment_method_chk check (
    payment_method in ('ecocash', 'card', 'cod', 'stripe')
  );

alter table public.tuk_tuk_bookings drop constraint if exists tuk_tuk_bookings_payment_method_chk;
alter table public.tuk_tuk_bookings
  add constraint tuk_tuk_bookings_payment_method_chk check (
    payment_method in ('ecocash', 'card', 'cod', 'stripe')
  );

comment on column public.taxi_bookings.payment_method is 'cod = cash; card = Paynow; stripe = Stripe; ecocash = legacy';
comment on column public.tuk_tuk_bookings.payment_method is 'cod = cash; card = Paynow; stripe = Stripe; ecocash = legacy';

alter table public.taxi_bookings
  add column if not exists stripe_payment_intent_id text;
alter table public.tuk_tuk_bookings
  add column if not exists stripe_payment_intent_id text;

-- shop orders
alter table public.shop_customer_orders
  add column if not exists stripe_payment_intent_id text;

create index if not exists shop_customer_orders_stripe_pi_idx
  on public.shop_customer_orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- driver wallet top-ups
alter table public.driver_wallet_topups
  add column if not exists stripe_payment_intent_id text;

create index if not exists driver_wallet_topups_stripe_pi_idx
  on public.driver_wallet_topups (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

notify pgrst, 'reload schema';
