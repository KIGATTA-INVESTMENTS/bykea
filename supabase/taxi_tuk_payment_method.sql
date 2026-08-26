-- Payment method for taxi + Tuk-Tuk bookings (same values as customer_delivery_orders).
-- Run in Supabase SQL editor after taxi_bookings.sql and tuk_tuk_bookings.sql.

alter table public.taxi_bookings
  add column if not exists payment_method text;

update public.taxi_bookings
set payment_method = 'cod'
where payment_method is null;

alter table public.taxi_bookings
  alter column payment_method set default 'cod';

alter table public.taxi_bookings
  alter column payment_method set not null;

alter table public.taxi_bookings drop constraint if exists taxi_bookings_payment_method_chk;
alter table public.taxi_bookings
  add constraint taxi_bookings_payment_method_chk check (
    payment_method in ('ecocash', 'card', 'cod', 'stripe', 'wallet')
  );

comment on column public.taxi_bookings.payment_method is
  'card = Paynow; stripe = Stripe; cod = cash; wallet = Ingo Kilometres; ecocash = legacy bank transfer';

alter table public.tuk_tuk_bookings
  add column if not exists payment_method text;

update public.tuk_tuk_bookings
set payment_method = 'cod'
where payment_method is null;

alter table public.tuk_tuk_bookings
  alter column payment_method set default 'cod';

alter table public.tuk_tuk_bookings
  alter column payment_method set not null;

alter table public.tuk_tuk_bookings drop constraint if exists tuk_tuk_bookings_payment_method_chk;
alter table public.tuk_tuk_bookings
  add constraint tuk_tuk_bookings_payment_method_chk check (
    payment_method in ('ecocash', 'card', 'cod', 'stripe', 'wallet')
  );

comment on column public.tuk_tuk_bookings.payment_method is
  'card = Paynow; stripe = Stripe; cod = cash; wallet = Ingo Kilometres; ecocash = legacy bank transfer';

-- Refresh PostgREST schema cache if clients report "Could not find ... in the schema cache"
notify pgrst, 'reload schema';
