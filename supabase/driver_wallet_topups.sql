-- Driver wallet deposit top-ups (Paynow). Run after driver_registrations.sql.
-- Merchant reference format from app: ING-DEP-{10 hex} (must match paynow-result lookup).

create table if not exists public.driver_wallet_topups (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_registrations (id) on delete cascade,

  amount_gbp numeric(12, 2) not null default 10.00,
  currency text not null default 'USD',

  payment_gateway text,
  payment_status text not null default 'pending',
  paynow_reference text,
  paynow_poll_url text,
  paynow_redirect_url text,
  payment_started_at timestamptz,
  payment_completed_at timestamptz,

  created_at timestamptz not null default now()
);

alter table public.driver_wallet_topups drop constraint if exists driver_wallet_topups_payment_status_chk;
alter table public.driver_wallet_topups
  add constraint driver_wallet_topups_payment_status_chk check (
    payment_status in ('pending', 'paid', 'failed', 'cancelled')
  );

create unique index if not exists driver_wallet_topups_paynow_reference_uidx
  on public.driver_wallet_topups (paynow_reference)
  where paynow_reference is not null;

create index if not exists driver_wallet_topups_driver_id_idx
  on public.driver_wallet_topups (driver_id, created_at desc);

comment on table public.driver_wallet_topups is 'Paynow (or other) wallet deposit rows for drivers; sum paid rows for deposit balance in UI';

alter table public.driver_wallet_topups enable row level security;

drop policy if exists "driver_wallet_topups_insert_anon" on public.driver_wallet_topups;
create policy "driver_wallet_topups_insert_anon"
on public.driver_wallet_topups for insert to anon with check (true);

drop policy if exists "driver_wallet_topups_select_anon" on public.driver_wallet_topups;
create policy "driver_wallet_topups_select_anon"
on public.driver_wallet_topups for select to anon using (true);

drop policy if exists "driver_wallet_topups_update_anon" on public.driver_wallet_topups;
create policy "driver_wallet_topups_update_anon"
on public.driver_wallet_topups for update to anon using (true) with check (true);

drop policy if exists "driver_wallet_topups_delete_anon" on public.driver_wallet_topups;
create policy "driver_wallet_topups_delete_anon"
on public.driver_wallet_topups for delete to anon using (true);
