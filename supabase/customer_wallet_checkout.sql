-- Customer wallet checkout: debit RPC + allow `wallet` payment method on delivery & shop orders.
-- Run AFTER customer_wallet.sql (and after customer_delivery_orders / shop_customer_orders base tables).
-- Safe to re-run.
--
-- Also run if you already applied an older customer_wallet.sql without debit support.

-- —— Debit wallet (idempotent per ref_type + ref_id) ——
create or replace function public.debit_customer_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_label text default 'Order payment',
  p_ref_type text default null,
  p_ref_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  cur numeric(12, 2);
  next_bal numeric(12, 2);
  amt numeric(12, 2);
  existing_id uuid;
begin
  amt := round(coalesce(p_amount, 0)::numeric, 2);
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user');
  end if;
  if amt is null or amt <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;

  if p_ref_type is not null and p_ref_id is not null then
    select id into existing_id
    from public.customer_wallet_transactions
    where user_id = p_user_id
      and entry_type = 'debit'
      and ref_type = p_ref_type
      and ref_id = p_ref_id
    limit 1;
    if existing_id is not null then
      select balance_gbp into cur from public.customer_wallets where user_id = p_user_id;
      return jsonb_build_object(
        'ok', true,
        'already', true,
        'balance_after', coalesce(cur, 0),
        'transaction_id', existing_id
      );
    end if;
  end if;

  insert into public.customer_wallets (user_id, balance_gbp, updated_at)
  values (p_user_id, 0, now())
  on conflict (user_id) do nothing;

  select balance_gbp into cur from public.customer_wallets where user_id = p_user_id for update;
  cur := coalesce(cur, 0);
  if cur < amt then
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_balance',
      'balance', cur,
      'required', amt
    );
  end if;

  next_bal := round((cur - amt)::numeric, 2);

  update public.customer_wallets
  set balance_gbp = next_bal, updated_at = now()
  where user_id = p_user_id;

  insert into public.customer_wallet_transactions (
    user_id, entry_type, amount_gbp, balance_after, label, ref_type, ref_id
  ) values (
    p_user_id, 'debit', amt, next_bal, coalesce(nullif(trim(p_label), ''), 'Order payment'), p_ref_type, p_ref_id
  )
  returning id into existing_id;

  return jsonb_build_object(
    'ok', true,
    'balance_after', next_bal,
    'transaction_id', existing_id
  );
end;
$$;

grant execute on function public.debit_customer_wallet(uuid, numeric, text, text, uuid) to anon, authenticated, service_role;

-- —— Delivery orders: allow wallet ——
alter table public.customer_delivery_orders drop constraint if exists customer_delivery_orders_payment_chk;
alter table public.customer_delivery_orders
  add constraint customer_delivery_orders_payment_chk check (
    payment_method in ('ecocash', 'card', 'cod', 'stripe', 'wallet')
  );

comment on column public.customer_delivery_orders.payment_method is
  'cod = cash; card = Paynow; stripe = Stripe; wallet = in-app wallet; ecocash = legacy';

-- —— Shop orders: payment_method + optional customer link ——
alter table public.shop_customer_orders
  add column if not exists payment_method text not null default 'cod';

alter table public.shop_customer_orders
  add column if not exists app_user_id uuid references public.app_users (id) on delete set null;

alter table public.shop_customer_orders drop constraint if exists shop_customer_orders_payment_method_chk;
alter table public.shop_customer_orders
  add constraint shop_customer_orders_payment_method_chk check (
    payment_method in ('cod', 'paynow', 'card', 'stripe', 'wallet')
  );

create index if not exists shop_customer_orders_app_user_id_idx
  on public.shop_customer_orders (app_user_id)
  where app_user_id is not null;

comment on column public.shop_customer_orders.payment_method is
  'cod = cash on delivery; paynow/card = Paynow; stripe = Stripe; wallet = in-app wallet';

notify pgrst, 'reload schema';
