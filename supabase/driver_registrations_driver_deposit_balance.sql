-- Running security deposit balance (top-ups add; platform commission on completed jobs subtracts).
-- Run after driver_registrations.sql and platform_commission_settings.sql.

alter table public.driver_registrations
  add column if not exists driver_deposit_balance_gbp numeric(12, 2) not null default 0;

comment on column public.driver_registrations.driver_deposit_balance_gbp is
  'Must stay >= Â$10 to go online / accept jobs; Paynow wallet top-ups increase; commission % on completed job gross decreases';

-- One-time: drivers already marked deposit_paid get a starting balance so they are not locked out.
update public.driver_registrations
set driver_deposit_balance_gbp = greatest(coalesce(driver_deposit_balance_gbp, 0), 10)
where coalesce(deposit_paid, false) = true
  and coalesce(driver_deposit_balance_gbp, 0) < 10;
