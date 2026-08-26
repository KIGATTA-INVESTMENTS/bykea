-- Allow EcoCash Instant Payments on shop checkout.
-- Delivery/taxi already include 'ecocash' in payment_method CHECK.

alter table public.shop_customer_orders drop constraint if exists shop_customer_orders_payment_method_chk;

alter table public.shop_customer_orders
  add constraint shop_customer_orders_payment_method_chk
  check (
    payment_method is null
    or payment_method in ('cod', 'paynow', 'card', 'stripe', 'wallet', 'ecocash')
  );

comment on column public.shop_customer_orders.payment_method is
  'cod | paynow | card | stripe | wallet | ecocash (EcoCash Instant Payments)';

notify pgrst, 'reload schema';
