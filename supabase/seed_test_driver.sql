-- Dummy test driver for the driver portal (no Paynow top-up needed).
-- Run in Supabase SQL Editor AFTER:
--   supabase/driver_registrations.sql
--   supabase/driver_registrations_driver_deposit_balance.sql
--
-- Login at /driver/login
--   Email:    testdriver@bykea.test
--   Password: TestDriver123!

delete from public.driver_registrations
where lower(trim(email)) = lower(trim('testdriver@bykea.test'));

insert into public.driver_registrations (
  full_name,
  phone,
  email,
  national_id,
  password,
  phone_country_code,
  vehicle_type,
  vehicle_make,
  vehicle_model,
  vehicle_plate,
  vehicle_color,
  deposit_required_gbp,
  deposit_paid,
  driver_deposit_balance_gbp,
  status,
  email_verified_at,
  admin_notes
) values (
  'Test Driver',
  '7700900001',
  'testdriver@bykea.test',
  'TEST-NID-0001',
  'TestDriver123!',
  '+44',
  'Motorbike',
  'Honda',
  'CB125',
  'TEST01',
  'Blue',
  10.00,
  true,
  100.00,
  'approved',
  now(),
  'Dummy test account — pre-funded deposit; safe to delete anytime.'
);
