-- Customer in-app wallet: balance, ledger, and top-up payment rows.
-- Run in Supabase SQL Editor after register_login.sql (app_users).

create table if not exists public.customer_wallets (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  balance_gbp numeric(12, 2) not null default 0 check (balance_gbp >= 0),
  currency text not null default 'USD',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.customer_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  entry_type text not null check (entry_type in ('credit', 'debit')),
  amount_gbp numeric(12, 2) not null check (amount_gbp > 0),
  balance_after numeric(12, 2) not null,
  label text not null default '',
  package_label text,
  km_credits numeric(10, 2),
  ref_type text,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists customer_wallet_transactions_user_created_idx
  on public.customer_wallet_transactions (user_id, created_at desc);

-- Pending/paid top-ups (Paynow / Stripe), same pattern as driver_wallet_topups.
create table if not exists public.customer_wallet_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,

  amount_gbp numeric(12, 2) not null check (amount_gbp > 0),
  currency text not null default 'USD',
  package_id text,
  package_label text,
  km_credits numeric(10, 2),

  payment_gateway text,
  payment_status text not null default 'pending',
  paynow_reference text,
  paynow_poll_url text,
  paynow_redirect_url text,
  stripe_payment_intent_id text,
  payment_started_at timestamptz,
  payment_completed_at timestamptz,
  credited_at timestamptz,

  created_at timestamptz not null default now()
);

alter table public.customer_wallet_topups drop constraint if exists customer_wallet_topups_payment_status_chk;
alter table public.customer_wallet_topups
  add constraint customer_wallet_topups_payment_status_chk check (
    payment_status in ('pending', 'paid', 'failed', 'cancelled')
  );

create unique index if not exists customer_wallet_topups_paynow_reference_uidx
  on public.customer_wallet_topups (paynow_reference)
  where paynow_reference is not null;

create index if not exists customer_wallet_topups_user_id_idx
  on public.customer_wallet_topups (user_id, created_at desc);

create index if not exists customer_wallet_topups_stripe_pi_idx
  on public.customer_wallet_topups (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

comment on table public.customer_wallets is 'Running customer wallet balance (USD).';
comment on table public.customer_wallet_transactions is 'Wallet ledger: top-ups (credit) and ride/order deductions (debit).';
comment on table public.customer_wallet_topups is 'Paynow/Stripe wallet top-up rows; credit balance when payment_status=paid.';

-- Ensure wallet row exists; credit balance + ledger once per top-up (idempotent via credited_at).
create or replace function public.credit_customer_wallet_from_topup(p_topup_id uuid)
returns boolean
language plpgsql
security definer
as $$
declare
  t public.customer_wallet_topups%rowtype;
  cur numeric(12, 2);
  next_bal numeric(12, 2);
  lbl text;
begin
  select * into t from public.customer_wallet_topups where id = p_topup_id for update;
  if not found then
    return false;
  end if;
  if lower(coalesce(t.payment_status, '')) <> 'paid' then
    return false;
  end if;
  if t.credited_at is not null then
    return true;
  end if;
  if t.amount_gbp is null or t.amount_gbp <= 0 then
    return false;
  end if;

  insert into public.customer_wallets (user_id, balance_gbp, updated_at)
  values (t.user_id, 0, now())
  on conflict (user_id) do nothing;

  select balance_gbp into cur from public.customer_wallets where user_id = t.user_id for update;
  cur := coalesce(cur, 0);
  next_bal := round((cur + t.amount_gbp)::numeric, 2);

  update public.customer_wallets
  set balance_gbp = next_bal, updated_at = now()
  where user_id = t.user_id;

  lbl := coalesce(nullif(trim(t.package_label), ''), 'Wallet top-up');

  insert into public.customer_wallet_transactions (
    user_id, entry_type, amount_gbp, balance_after, label, package_label, km_credits, ref_type, ref_id
  ) values (
    t.user_id, 'credit', t.amount_gbp, next_bal, lbl, t.package_label, t.km_credits, 'topup', t.id
  );

  update public.customer_wallet_topups
  set credited_at = now()
  where id = t.id;

  return true;
end;
$$;

grant execute on function public.credit_customer_wallet_from_topup(uuid) to anon, authenticated, service_role;

-- Debit wallet for delivery / shop payments (idempotent per ref_type + ref_id).
-- Also in customer_wallet_checkout.sql for databases that already ran an older customer_wallet.sql.
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

-- Admin / office credit (also in admin_customer_wallet.sql).
create or replace function public.credit_customer_wallet_admin(
  p_user_id uuid,
  p_amount numeric,
  p_label text default 'Admin credit',
  p_source text default 'admin',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  cur numeric(12, 2);
  next_bal numeric(12, 2);
  amt numeric(12, 2);
  lbl text;
  src text;
  tx_id uuid;
begin
  amt := round(coalesce(p_amount, 0)::numeric, 2);
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user');
  end if;
  if amt is null or amt <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;

  src := lower(trim(coalesce(p_source, 'admin')));
  if src not in ('bank_transfer', 'cash', 'admin', 'office') then
    src := 'admin';
  end if;

  lbl := coalesce(nullif(trim(p_label), ''),
    case src
      when 'bank_transfer' then 'Bank transfer top-up'
      when 'cash' then 'Cash top-up (office)'
      else 'Admin wallet credit'
    end
  );
  if p_note is not null and trim(p_note) <> '' then
    lbl := lbl || ' — ' || trim(p_note);
  end if;

  insert into public.customer_wallets (user_id, balance_gbp, updated_at)
  values (p_user_id, 0, now())
  on conflict (user_id) do nothing;

  select balance_gbp into cur from public.customer_wallets where user_id = p_user_id for update;
  cur := coalesce(cur, 0);
  next_bal := round((cur + amt)::numeric, 2);

  update public.customer_wallets
  set balance_gbp = next_bal, updated_at = now()
  where user_id = p_user_id;

  insert into public.customer_wallet_transactions (
    user_id, entry_type, amount_gbp, balance_after, label, ref_type, ref_id
  ) values (
    p_user_id, 'credit', amt, next_bal, lbl, 'admin_' || src, null
  )
  returning id into tx_id;

  return jsonb_build_object(
    'ok', true,
    'balance_after', next_bal,
    'transaction_id', tx_id,
    'label', lbl
  );
end;
$$;

grant execute on function public.credit_customer_wallet_admin(uuid, numeric, text, text, text)
  to anon, authenticated, service_role;

alter table public.customer_wallets enable row level security;
alter table public.customer_wallet_transactions enable row level security;
alter table public.customer_wallet_topups enable row level security;

drop policy if exists "customer_wallets_select_anon" on public.customer_wallets;
create policy "customer_wallets_select_anon"
on public.customer_wallets for select to anon using (true);

drop policy if exists "customer_wallets_insert_anon" on public.customer_wallets;
create policy "customer_wallets_insert_anon"
on public.customer_wallets for insert to anon with check (true);

drop policy if exists "customer_wallets_update_anon" on public.customer_wallets;
create policy "customer_wallets_update_anon"
on public.customer_wallets for update to anon using (true) with check (true);

drop policy if exists "customer_wallet_transactions_select_anon" on public.customer_wallet_transactions;
create policy "customer_wallet_transactions_select_anon"
on public.customer_wallet_transactions for select to anon using (true);

drop policy if exists "customer_wallet_transactions_insert_anon" on public.customer_wallet_transactions;
create policy "customer_wallet_transactions_insert_anon"
on public.customer_wallet_transactions for insert to anon with check (true);

drop policy if exists "customer_wallet_topups_select_anon" on public.customer_wallet_topups;
create policy "customer_wallet_topups_select_anon"
on public.customer_wallet_topups for select to anon using (true);

drop policy if exists "customer_wallet_topups_insert_anon" on public.customer_wallet_topups;
create policy "customer_wallet_topups_insert_anon"
on public.customer_wallet_topups for insert to anon with check (true);

drop policy if exists "customer_wallet_topups_update_anon" on public.customer_wallet_topups;
create policy "customer_wallet_topups_update_anon"
on public.customer_wallet_topups for update to anon using (true) with check (true);

notify pgrst, 'reload schema';
