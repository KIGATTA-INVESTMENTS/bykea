-- Referral / promo codes for customer, driver, and shop-owner sign-up.
-- Run in Supabase SQL Editor after register_login.sql, driver_registrations.sql, shop_owners.sql.

-- Master list of valid codes (20 seeded below).
create table if not exists public.referral_codes (
  code text primary key,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.referral_codes is 'Valid referral/promo codes users may enter at sign-up (optional).';

alter table public.referral_codes enable row level security;

drop policy if exists "referral_codes_select_anon" on public.referral_codes;
create policy "referral_codes_select_anon"
on public.referral_codes for select to anon using (active = true);

-- Optional code stored on each sign-up row (nullable).
alter table public.app_users add column if not exists referral_code text;
alter table public.driver_registrations add column if not exists referral_code text;
alter table public.shop_owners add column if not exists referral_code text;

comment on column public.app_users.referral_code is 'Optional promo/referral code entered at customer register.';
comment on column public.driver_registrations.referral_code is 'Optional promo/referral code entered at driver register.';
comment on column public.shop_owners.referral_code is 'Optional promo/referral code entered at shop owner register.';

-- FK only when a code is provided (must exist in referral_codes).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_users_referral_code_fkey'
  ) then
    alter table public.app_users
      add constraint app_users_referral_code_fkey
      foreign key (referral_code) references public.referral_codes (code)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'driver_registrations_referral_code_fkey'
  ) then
    alter table public.driver_registrations
      add constraint driver_registrations_referral_code_fkey
      foreign key (referral_code) references public.referral_codes (code)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'shop_owners_referral_code_fkey'
  ) then
    alter table public.shop_owners
      add constraint shop_owners_referral_code_fkey
      foreign key (referral_code) references public.referral_codes (code)
      on delete set null;
  end if;
end $$;

create index if not exists app_users_referral_code_idx on public.app_users (referral_code) where referral_code is not null;
create index if not exists driver_registrations_referral_code_idx on public.driver_registrations (referral_code) where referral_code is not null;
create index if not exists shop_owners_referral_code_idx on public.shop_owners (referral_code) where referral_code is not null;

-- Seed 20 referral codes (idempotent).
insert into public.referral_codes (code, label) values
  ('INGO-PROMO01', 'Partner referral 01'),
  ('INGO-PROMO02', 'Partner referral 02'),
  ('INGO-PROMO03', 'Partner referral 03'),
  ('INGO-PROMO04', 'Partner referral 04'),
  ('INGO-PROMO05', 'Partner referral 05'),
  ('INGO-PROMO06', 'Partner referral 06'),
  ('INGO-PROMO07', 'Partner referral 07'),
  ('INGO-PROMO08', 'Partner referral 08'),
  ('INGO-PROMO09', 'Partner referral 09'),
  ('INGO-PROMO10', 'Partner referral 10'),
  ('INGO-PROMO11', 'Partner referral 11'),
  ('INGO-PROMO12', 'Partner referral 12'),
  ('INGO-PROMO13', 'Partner referral 13'),
  ('INGO-PROMO14', 'Partner referral 14'),
  ('INGO-PROMO15', 'Partner referral 15'),
  ('INGO-PROMO16', 'Partner referral 16'),
  ('INGO-PROMO17', 'Partner referral 17'),
  ('INGO-PROMO18', 'Partner referral 18'),
  ('INGO-PROMO19', 'Partner referral 19'),
  ('INGO-PROMO20', 'Partner referral 20')
on conflict (code) do nothing;
