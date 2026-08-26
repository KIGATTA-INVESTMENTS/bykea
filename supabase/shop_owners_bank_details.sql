-- Shop owner payout: Bank OR mobile money (EcoCash / OneMoney / InnBucks).
-- Run in Supabase SQL Editor after shop_owners.sql / shop_owners_bank_details.sql.

alter table public.shop_owners add column if not exists bank_name text;
alter table public.shop_owners add column if not exists bank_account_name text;
alter table public.shop_owners add column if not exists bank_account_number text;
alter table public.shop_owners add column if not exists bank_branch text;

alter table public.shop_owners add column if not exists payout_method text;
alter table public.shop_owners add column if not exists mobile_money_provider text;
alter table public.shop_owners add column if not exists mobile_money_phone text;
alter table public.shop_owners add column if not exists mobile_money_account_name text;

comment on column public.shop_owners.payout_method is
  'Payout destination: bank | mobile_money';
comment on column public.shop_owners.mobile_money_provider is
  'When payout_method = mobile_money: ecocash | onemoney | innbucks';
comment on column public.shop_owners.mobile_money_phone is
  'Registered mobile money wallet phone number';
comment on column public.shop_owners.mobile_money_account_name is
  'Name as it appears on the mobile money account';

-- Existing rows with bank details default to bank payout.
update public.shop_owners
set payout_method = 'bank'
where payout_method is null
  and (
    coalesce(bank_name, '') <> ''
    or coalesce(bank_account_number, '') <> ''
    or coalesce(bank_account_name, '') <> ''
  );
