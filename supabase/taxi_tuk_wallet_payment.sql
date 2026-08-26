-- Allow Ingo Kilometres (wallet) as a payment method on taxi / tuk-tuk bookings.
-- Also allows stripe (used by the app) alongside legacy card/ecocash/cod.
-- Run after taxi_tuk_payment_method.sql and taxi_tuk_bookings_paynow.sql.

alter table public.taxi_bookings drop constraint if exists taxi_bookings_payment_method_chk;
alter table public.taxi_bookings
  add constraint taxi_bookings_payment_method_chk check (
    payment_method in ('ecocash', 'card', 'cod', 'stripe', 'wallet')
  );

comment on column public.taxi_bookings.payment_method is
  'card = Paynow; stripe = Stripe; cod = cash; wallet = Ingo Kilometres; ecocash = legacy';

alter table public.tuk_tuk_bookings drop constraint if exists tuk_tuk_bookings_payment_method_chk;
alter table public.tuk_tuk_bookings
  add constraint tuk_tuk_bookings_payment_method_chk check (
    payment_method in ('ecocash', 'card', 'cod', 'stripe', 'wallet')
  );

comment on column public.tuk_tuk_bookings.payment_method is
  'card = Paynow; stripe = Stripe; cod = cash; wallet = Ingo Kilometres; ecocash = legacy';

notify pgrst, 'reload schema';
