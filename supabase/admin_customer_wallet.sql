-- Admin wallet management + rider payouts for wallet-paid jobs.
-- Run AFTER customer_wallet.sql (and customer_wallet_checkout.sql recommended).
-- Safe to re-run.

-- —— Admin / office credit (bank transfer or cash received) ——
-- Inserts a ledger credit so it appears on the customer Wallet page.
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

-- —— Rider earnings from wallet-paid jobs (admin marks paid) ——
create table if not exists public.driver_wallet_job_payouts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_registrations (id) on delete cascade,
  booking_table text not null check (
    booking_table in (
      'customer_delivery_orders',
      'shop_customer_orders',
      'taxi_bookings',
      'tuk_tuk_bookings'
    )
  ),
  booking_id uuid not null,
  gross_amount_gbp numeric(12, 2) not null check (gross_amount_gbp >= 0),
  commission_pct numeric(6, 2) not null default 0,
  net_amount_gbp numeric(12, 2) not null check (net_amount_gbp >= 0),
  currency text not null default 'USD',
  status text not null default 'pending',
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_table, booking_id)
);

alter table public.driver_wallet_job_payouts drop constraint if exists driver_wallet_job_payouts_status_chk;
alter table public.driver_wallet_job_payouts
  add constraint driver_wallet_job_payouts_status_chk check (
    status in ('pending', 'paid')
  );

create index if not exists driver_wallet_job_payouts_driver_status_idx
  on public.driver_wallet_job_payouts (driver_id, status, created_at desc);

create index if not exists driver_wallet_job_payouts_status_idx
  on public.driver_wallet_job_payouts (status, created_at desc);

comment on table public.driver_wallet_job_payouts is
  'Admin tracking of rider net earnings from customer wallet-paid jobs; mark paid after bank/cash payout.';

alter table public.driver_wallet_job_payouts enable row level security;

drop policy if exists "driver_wallet_job_payouts_select_anon" on public.driver_wallet_job_payouts;
create policy "driver_wallet_job_payouts_select_anon"
on public.driver_wallet_job_payouts for select to anon using (true);

drop policy if exists "driver_wallet_job_payouts_insert_anon" on public.driver_wallet_job_payouts;
create policy "driver_wallet_job_payouts_insert_anon"
on public.driver_wallet_job_payouts for insert to anon with check (true);

drop policy if exists "driver_wallet_job_payouts_update_anon" on public.driver_wallet_job_payouts;
create policy "driver_wallet_job_payouts_update_anon"
on public.driver_wallet_job_payouts for update to anon using (true) with check (true);

notify pgrst, 'reload schema';
