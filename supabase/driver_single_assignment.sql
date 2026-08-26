-- Only the first driver can claim a booking. Later accepts fail with ORDER_ALREADY_ACCEPTED.
-- Run in the Supabase SQL editor after driver_booking_assignment.sql
-- and shop_customer_orders_driver_assignment.sql.

set lock_timeout = '5s';

alter table public.customer_delivery_orders add column if not exists assigned_at timestamptz;
alter table public.taxi_bookings add column if not exists assigned_at timestamptz;
alter table public.tuk_tuk_bookings add column if not exists assigned_at timestamptz;
alter table public.shop_customer_orders add column if not exists assigned_at timestamptz;

alter table public.customer_delivery_orders add column if not exists agreed_fare_amount numeric;
alter table public.customer_delivery_orders add column if not exists customer_offer_amount numeric;
alter table public.customer_delivery_orders add column if not exists bid_status text;
alter table public.taxi_bookings add column if not exists agreed_fare_amount numeric;
alter table public.taxi_bookings add column if not exists customer_offer_amount numeric;
alter table public.taxi_bookings add column if not exists bid_status text;
alter table public.tuk_tuk_bookings add column if not exists agreed_fare_amount numeric;
alter table public.tuk_tuk_bookings add column if not exists customer_offer_amount numeric;
alter table public.tuk_tuk_bookings add column if not exists bid_status text;

-- Block A → B steals. null → driver (claim) and driver → null (cancel) stay allowed.
create or replace function public.prevent_driver_assignment_steal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.assigned_driver_id is not null
     and new.assigned_driver_id is not null
     and new.assigned_driver_id is distinct from old.assigned_driver_id then
    raise exception 'ORDER_ALREADY_ACCEPTED'
      using errcode = 'P0001',
            hint = 'This order has already been accepted by another driver.';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_delivery_orders_single_driver on public.customer_delivery_orders;
create trigger customer_delivery_orders_single_driver
  before update on public.customer_delivery_orders
  for each row execute function public.prevent_driver_assignment_steal();

drop trigger if exists taxi_bookings_single_driver on public.taxi_bookings;
create trigger taxi_bookings_single_driver
  before update on public.taxi_bookings
  for each row execute function public.prevent_driver_assignment_steal();

drop trigger if exists tuk_tuk_bookings_single_driver on public.tuk_tuk_bookings;
create trigger tuk_tuk_bookings_single_driver
  before update on public.tuk_tuk_bookings
  for each row execute function public.prevent_driver_assignment_steal();

drop trigger if exists shop_customer_orders_single_driver on public.shop_customer_orders;
create trigger shop_customer_orders_single_driver
  before update on public.shop_customer_orders
  for each row execute function public.prevent_driver_assignment_steal();

-- Atomic claim: SELECT FOR UPDATE so two drivers cannot both win.
create or replace function public.claim_open_booking(
  p_table text,
  p_booking_id uuid,
  p_driver_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assigned uuid;
  v_status text;
  v_fare numeric;
begin
  if p_table not in (
    'customer_delivery_orders',
    'shop_customer_orders',
    'taxi_bookings',
    'tuk_tuk_bookings'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Invalid booking type.');
  end if;

  if p_booking_id is null or p_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'Missing data.');
  end if;

  if not exists (
    select 1 from public.driver_registrations d where d.id = p_driver_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'Driver not found.');
  end if;

  if p_table = 'customer_delivery_orders' then
    select assigned_driver_id, status,
           coalesce(agreed_fare_amount, customer_offer_amount, total_amount)
      into v_assigned, v_status, v_fare
    from public.customer_delivery_orders
    where id = p_booking_id
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'Booking not found.');
    end if;
    if v_assigned is not null then
      if v_assigned = p_driver_id then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;
    if lower(coalesce(v_status, '')) not in ('placed', 'paid') then
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;

    update public.customer_delivery_orders
    set assigned_driver_id = p_driver_id,
        assigned_at = coalesce(assigned_at, now()),
        status = 'assigned',
        bid_status = 'matched',
        agreed_fare_amount = coalesce(agreed_fare_amount, v_fare)
    where id = p_booking_id
      and assigned_driver_id is null;

    if not found then
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;
    return jsonb_build_object('ok', true);

  elsif p_table = 'shop_customer_orders' then
    select assigned_driver_id, status
      into v_assigned, v_status
    from public.shop_customer_orders
    where id = p_booking_id
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'Booking not found.');
    end if;
    if v_assigned is not null then
      if v_assigned = p_driver_id then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;
    if lower(coalesce(v_status, '')) <> 'ready for delivery' then
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;

    update public.shop_customer_orders
    set assigned_driver_id = p_driver_id,
        assigned_at = coalesce(assigned_at, now())
    where id = p_booking_id
      and assigned_driver_id is null;

    if not found then
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;
    return jsonb_build_object('ok', true);

  elsif p_table = 'taxi_bookings' then
    select assigned_driver_id, status,
           coalesce(agreed_fare_amount, customer_offer_amount, quoted_price)
      into v_assigned, v_status, v_fare
    from public.taxi_bookings
    where id = p_booking_id
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'Booking not found.');
    end if;
    if v_assigned is not null then
      if v_assigned = p_driver_id then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;
    if lower(coalesce(v_status, '')) <> 'requested' then
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;

    update public.taxi_bookings
    set assigned_driver_id = p_driver_id,
        assigned_at = coalesce(assigned_at, now()),
        status = 'confirmed',
        bid_status = 'matched',
        agreed_fare_amount = coalesce(agreed_fare_amount, v_fare)
    where id = p_booking_id
      and assigned_driver_id is null;

    if not found then
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;
    return jsonb_build_object('ok', true);

  else
    select assigned_driver_id, status,
           coalesce(agreed_fare_amount, customer_offer_amount, quoted_price)
      into v_assigned, v_status, v_fare
    from public.tuk_tuk_bookings
    where id = p_booking_id
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'Booking not found.');
    end if;
    if v_assigned is not null then
      if v_assigned = p_driver_id then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;
    if lower(coalesce(v_status, '')) <> 'requested' then
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;

    update public.tuk_tuk_bookings
    set assigned_driver_id = p_driver_id,
        assigned_at = coalesce(assigned_at, now()),
        status = 'confirmed',
        bid_status = 'matched',
        agreed_fare_amount = coalesce(agreed_fare_amount, v_fare)
    where id = p_booking_id
      and assigned_driver_id is null;

    if not found then
      return jsonb_build_object(
        'ok', false,
        'taken', true,
        'error', 'This order has already been accepted by another driver.'
      );
    end if;
    return jsonb_build_object('ok', true);
  end if;
end;
$$;

revoke all on function public.claim_open_booking(text, uuid, uuid) from public;
grant execute on function public.claim_open_booking(text, uuid, uuid)
  to anon, authenticated, service_role;

comment on function public.claim_open_booking(text, uuid, uuid) is
  'First driver to call this wins the booking; others get taken=true.';
