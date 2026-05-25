-- Platform commission (singleton). Run in Supabase SQL Editor after `register_login.sql` (or any baseline).
-- Admin UI: /admin/platform-commission — driver % applies to driver-side payouts; shop % to shop order GMV.

create table if not exists public.platform_commission_settings (
  id smallint primary key default 1,
  constraint platform_commission_settings_singleton_chk check (id = 1),

  driver_commission_percent numeric(6, 3) not null default 10
    constraint platform_commission_driver_pct_chk check (
      driver_commission_percent >= 0 and driver_commission_percent <= 100
    ),

  shop_commission_percent numeric(6, 3) not null default 10
    constraint platform_commission_shop_pct_chk check (
      shop_commission_percent >= 0 and shop_commission_percent <= 100
    ),

  currency text not null default 'USD',
  updated_at timestamptz not null default now(),

  constraint platform_commission_currency_chk check (char_length(trim(currency)) > 0)
);

comment on table public.platform_commission_settings is 'Single row (id=1): admin-set commission % for drivers vs shops';
comment on column public.platform_commission_settings.driver_commission_percent is 'Platform take from driver-facing order totals (e.g. rides, parcels)';
comment on column public.platform_commission_settings.shop_commission_percent is 'Platform take from shop order totals';

alter table public.platform_commission_settings enable row level security;

drop policy if exists "platform_commission_settings_select_anon" on public.platform_commission_settings;
create policy "platform_commission_settings_select_anon"
on public.platform_commission_settings for select to anon using (true);

drop policy if exists "platform_commission_settings_insert_anon" on public.platform_commission_settings;
create policy "platform_commission_settings_insert_anon"
on public.platform_commission_settings for insert to anon with check (true);

drop policy if exists "platform_commission_settings_update_anon" on public.platform_commission_settings;
create policy "platform_commission_settings_update_anon"
on public.platform_commission_settings for update to anon using (true) with check (true);

insert into public.platform_commission_settings (id, driver_commission_percent, shop_commission_percent, currency)
values (1, 10, 12, 'USD')
on conflict (id) do nothing;
