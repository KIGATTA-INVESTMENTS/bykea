import { shopOrderGrandTotal } from './shopDeliverySettings';
import { shopOrderCustomerBadgeKey, shopOrderStatusLabel } from './shopOrderStatus';
import { sweepAutoCancelStaleBookings, canCustomerCancelBooking, isAwaitingDriverBooking, isStaleUnfinishedBooking, CANCEL_REASON_STALE } from './customerOrderCancel';
import { storedDeliveryPin } from './deliveryConfirmationCode';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { statusLabel } from '../data/mockOrders';
import { formatVehicleTypeForDisplay } from './vehicleTypeDisplay';

/** @typedef {'delivery' | 'taxi' | 'tuk' | 'shop'} OrderKind */

function taxiOrderSubtitle(row) {
  const rt = String(row?.ride_type || '').toLowerCase();
  if (rt === 'prem') return 'Taxi (Premium)';
  if (rt === 'tuk') return 'Taxi (Tuk-Tuk)';
  const vt = String(row?.vehicle_type || '').toLowerCase();
  if (vt === 'bicycle') return 'Taxi (Bike)';
  if (vt === 'tuktuk') return 'Taxi (Tuk-Tuk)';
  if (vt === 'car') return 'Taxi (Car)';
  if (vt === 'minibus') return 'Taxi (Mini Bus)';
  if (rt === 'std') return 'Taxi (Standard)';
  return 'Taxi';
}

function normPhone(p) {
  if (p == null || p === '') return '';
  return String(p).replace(/\D/g, '');
}

function phonesMatch(sessionPhone, orderPhone) {
  const a = normPhone(sessionPhone);
  const b = normPhone(orderPhone);
  if (!a || !b) return false;
  if (a === b) return true;
  const tail = (s) => s.slice(-10);
  return tail(a) === tail(b);
}

function emailMatch(sessionEmail, orderEmail) {
  if (!sessionEmail || !orderEmail) return false;
  return String(orderEmail).trim().toLowerCase() === String(sessionEmail).trim().toLowerCase();
}

/**
 * Parse `/order/:orderId` param when using unified keys: `delivery:uuid`, `shop:uuid`, etc.
 * @param {string} raw
 * @returns {{ kind: OrderKind, id: string } | null}
 */
export function parseOrderNavKey(raw) {
  if (!raw) return null;
  const dec = decodeURIComponent(raw);
  const i = dec.indexOf(':');
  if (i <= 0) return null;
  const kind = dec.slice(0, i).toLowerCase();
  const id = dec.slice(i + 1);
  if (!id) return null;
  if (kind === 'delivery' || kind === 'taxi' || kind === 'tuk' || kind === 'shop') {
    return { kind, id };
  }
  return null;
}

function formatListDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso);
  }
}

function orderListStatusText(row, kind, uiStatus) {
  if (uiStatus === 'cancelled') return 'Cancelled';
  if (isAwaitingDriverBooking(row, kind)) return 'Finding driver';
  if (uiStatus === 'transit') return 'In transit';
  return statusLabel(uiStatus);
}

function applyStaleListStatus(row, kind, uiStatus) {
  if (isStaleUnfinishedBooking(row, kind)) return 'cancelled';
  return uiStatus;
}

function overlayStaleRow(row, kind) {
  if (!row || !isStaleUnfinishedBooking(row, kind)) return row;
  return {
    ...row,
    status: 'cancelled',
    cancel_reason: row.cancel_reason || CANCEL_REASON_STALE,
    cancelled_by: row.cancelled_by || 'system',
  };
}

/** Map various DB statuses to order-history UI buckets */
function uiStatusDelivery(db) {
  const s = String(db || '').toLowerCase();
  if (s === 'cancelled') return 'cancelled';
  if (s === 'delivered') return 'delivered';
  if (s === 'paid' || s === 'assigned') return 'transit';
  return 'active';
}

/** @param {Record<string, unknown> | null} drv */
export function mapDriverRegistrationRow(drv) {
  if (!drv || typeof drv !== 'object') return null;
  const phone = [drv.phone_country_code, drv.phone].filter(Boolean).join(' ').trim() || '—';
  const vt = formatVehicleTypeForDisplay(drv.vehicle_type) || drv.vehicle_type;
  const vehicle = [vt, drv.vehicle_make, drv.vehicle_model].filter(Boolean).join(' · ') || '—';
  return {
    name: String(drv.full_name || 'Driver'),
    phone,
    vehicle,
    plate: String(drv.vehicle_plate || '—'),
  };
}

async function fetchDriverRowsByIds(supabase, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data, error } = await supabase
    .from('driver_registrations')
    .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_make, vehicle_model, vehicle_plate, vehicle_color')
    .in('id', uniq);
  if (error || !data?.length) return {};
  return Object.fromEntries(data.map((d) => [d.id, d]));
}

function uiStatusRide(db) {
  const s = String(db || '').toLowerCase();
  if (s === 'cancelled') return 'cancelled';
  if (s === 'completed') return 'delivered';
  if (s === 'confirmed') return 'transit';
  return 'active';
}

/**
 * Load all orders for the logged-in customer (app_user_id + shop guest match on email/phone).
 * @param {{ id?: string, email?: string, phone?: string } | null} session
 */
export async function fetchCustomerUnifiedOrders(session) {
  if (!isSupabaseConfigured || !supabase || !session?.id) {
    return { orders: [], error: session?.id ? null : 'Sign in to see your orders.' };
  }

  const uid = session.id;
  const email = session.email ? String(session.email).trim().toLowerCase() : '';
  const phone = session.phone || '';

  await sweepAutoCancelStaleBookings(uid, { email, phone });

  const out = [];
  let firstError = null;

  const [{ data: deliveries, error: dErr }, { data: taxis, error: tErr }, { data: tuks, error: uErr }] = await Promise.all([
    supabase.from('customer_delivery_orders').select('*').eq('app_user_id', uid).order('created_at', { ascending: false }),
    supabase.from('taxi_bookings').select('*').eq('app_user_id', uid).order('created_at', { ascending: false }),
    supabase.from('tuk_tuk_bookings').select('*').eq('app_user_id', uid).order('created_at', { ascending: false }),
  ]);

  if (dErr) firstError = firstError || dErr.message;
  const deliveryRows = deliveries || [];
  const taxiRows = taxis || [];
  const tukRows = tuks || [];
  const assignIds = [...deliveryRows, ...taxiRows, ...tukRows].map((r) => r.assigned_driver_id).filter(Boolean);
  const driverById = await fetchDriverRowsByIds(supabase, assignIds);

  for (const row of deliveryRows) {
    const st = applyStaleListStatus(row, 'delivery', uiStatusDelivery(row.status));
    const drvRow = row.assigned_driver_id ? driverById[row.assigned_driver_id] : null;
    const code = storedDeliveryPin(row.delivery_confirmation_code);
    const stale = st === 'cancelled' && isStaleUnfinishedBooking(row, 'delivery');
    out.push({
      navKey: `delivery:${row.id}`,
      kind: 'delivery',
      id: `Parcel · ${String(row.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      status: st,
      from: row.pickup_location || '—',
      to: row.dropoff_location || '—',
      date: formatListDate(row.created_at),
      price: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(row.total_amount) || 0),
      sortAt: row.created_at,
      subtitle: 'Parcel delivery',
      driver: drvRow ? mapDriverRegistrationRow(drvRow) : null,
      canCancel: !stale && canCustomerCancelBooking(row, 'delivery'),
      awaitingDriver: !stale && isAwaitingDriverBooking(row, 'delivery'),
      statusText: orderListStatusText(row, 'delivery', st),
      deliveryConfirmationCode: code || null,
      cancelReason: row.cancel_reason?.trim() || (stale ? CANCEL_REASON_STALE : null),
      cancelledBy: row.cancelled_by?.trim() || (stale ? 'system' : null),
    });
  }

  if (tErr) firstError = firstError || tErr.message;
  for (const row of taxiRows) {
    const st = applyStaleListStatus(row, 'taxi', uiStatusRide(row.status));
    const price = row.quoted_price != null ? Number(row.quoted_price) : null;
    const drvRow = row.assigned_driver_id ? driverById[row.assigned_driver_id] : null;
    const stale = st === 'cancelled' && isStaleUnfinishedBooking(row, 'taxi');
    out.push({
      navKey: `taxi:${row.id}`,
      kind: 'taxi',
      id: `Taxi · ${String(row.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      status: st,
      from: row.pickup_location || '—',
      to: row.destination_location || '—',
      date: formatListDate(row.created_at),
      price: price != null && !Number.isNaN(price) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price) : '—',
      sortAt: row.created_at,
      subtitle: taxiOrderSubtitle(row),
      driver: drvRow ? mapDriverRegistrationRow(drvRow) : null,
      canCancel: !stale && canCustomerCancelBooking(row, 'taxi'),
      awaitingDriver: !stale && isAwaitingDriverBooking(row, 'taxi'),
      statusText: orderListStatusText(row, 'taxi', st),
      cancelReason: row.cancel_reason?.trim() || (stale ? CANCEL_REASON_STALE : null),
      cancelledBy: row.cancelled_by?.trim() || (stale ? 'system' : null),
    });
  }

  if (uErr) firstError = firstError || uErr.message;
  for (const row of tukRows) {
    const st = applyStaleListStatus(row, 'tuk', uiStatusRide(row.status));
    const price = row.quoted_price != null ? Number(row.quoted_price) : null;
    const drvRow = row.assigned_driver_id ? driverById[row.assigned_driver_id] : null;
    const stale = st === 'cancelled' && isStaleUnfinishedBooking(row, 'tuk');
    out.push({
      navKey: `tuk:${row.id}`,
      kind: 'tuk',
      id: `Tuk-tuk · ${String(row.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      status: st,
      from: row.pickup_location || '—',
      to: row.destination_location || '—',
      date: formatListDate(row.created_at),
      price: price != null && !Number.isNaN(price) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price) : '—',
      sortAt: row.created_at,
      subtitle: 'Tuk-tuk',
      driver: drvRow ? mapDriverRegistrationRow(drvRow) : null,
      canCancel: !stale && canCustomerCancelBooking(row, 'tuk'),
      awaitingDriver: !stale && isAwaitingDriverBooking(row, 'tuk'),
      statusText: orderListStatusText(row, 'tuk', st),
      cancelReason: row.cancel_reason?.trim() || (stale ? CANCEL_REASON_STALE : null),
      cancelledBy: row.cancelled_by?.trim() || (stale ? 'system' : null),
    });
  }

  const shopSeen = new Set();
  const pushShopRow = (row) => {
    if (!row?.id || shopSeen.has(row.id)) return;
    const okEmail = email && row.customer_email && emailMatch(email, row.customer_email);
    const okPhone = phone && phonesMatch(phone, row.customer_phone);
    if (!okEmail && !okPhone) return;
    shopSeen.add(row.id);
    const st = applyStaleListStatus(row, 'shop', shopOrderCustomerBadgeKey(row.status));
    const stale = st === 'cancelled' && isStaleUnfinishedBooking(row, 'shop');
    const code = storedDeliveryPin(row.delivery_confirmation_code);
    out.push({
      navKey: `shop:${row.id}`,
      kind: 'shop',
      id: row.order_number || `Shop · ${String(row.id).slice(0, 8)}`,
      status: st,
      statusText: stale ? 'Cancelled' : shopOrderStatusLabel(row.status),
      from: 'Shop order',
      to: row.customer_address || '—',
      date: formatListDate(row.placed_at),
      price: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shopOrderGrandTotal(row)),
      sortAt: row.placed_at,
      subtitle: 'Shop',
      deliveryConfirmationCode: code || null,
      cancelReason: stale ? CANCEL_REASON_STALE : null,
    });
  };

  if (email) {
    const { data: byEmail, error: se } = await supabase.from('shop_customer_orders').select('*').eq('customer_email', email).order('placed_at', { ascending: false });
    if (se) firstError = firstError || se.message;
    for (const row of byEmail || []) pushShopRow(row);
  }
  if (phone) {
    const { data: byPhone, error: sp } = await supabase.from('shop_customer_orders').select('*').eq('customer_phone', phone).order('placed_at', { ascending: false });
    if (sp) firstError = firstError || sp.message;
    for (const row of byPhone || []) pushShopRow(row);
  }

  out.sort((a, b) => new Date(b.sortAt) - new Date(a.sortAt));
  return { orders: out, error: firstError };
}

/**
 * Load one order for detail page; enforces ownership.
 * @returns {Promise<{ data: object | null, error: string | null }>}
 */
export async function fetchCustomerOrderDetail(navKey, session) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: 'Supabase is not configured.' };
  }
  const p = parseOrderNavKey(navKey);
  if (!p) return { data: null, error: 'Invalid order link.' };
  if (!session?.id) return { data: null, error: 'Sign in to view this order.' };

  const uid = session.id;
  const email = session.email ? String(session.email).trim().toLowerCase() : '';
  const phone = session.phone || '';

  await sweepAutoCancelStaleBookings(uid, { email, phone });

  if (p.kind === 'delivery') {
    const { data, error } = await supabase.from('customer_delivery_orders').select('*').eq('id', p.id).maybeSingle();
    if (error) return { data: null, error: error.message };
    if (!data || data.app_user_id !== uid) return { data: null, error: 'Order not found.' };
    let driverRow = null;
    if (data.assigned_driver_id) {
      const { data: dRow, error: dErr } = await supabase
        .from('driver_registrations')
        .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_make, vehicle_model, vehicle_plate, vehicle_color')
        .eq('id', data.assigned_driver_id)
        .maybeSingle();
      if (!dErr && dRow) driverRow = dRow;
    }
    return { data: { kind: 'delivery', row: overlayStaleRow(data, 'delivery'), driver: driverRow }, error: null };
  }

  if (p.kind === 'taxi') {
    const { data, error } = await supabase.from('taxi_bookings').select('*').eq('id', p.id).maybeSingle();
    if (error) return { data: null, error: error.message };
    if (!data || data.app_user_id !== uid) return { data: null, error: 'Order not found.' };
    let driverRow = null;
    if (data.assigned_driver_id) {
      const { data: dRow, error: dErr } = await supabase
        .from('driver_registrations')
        .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_make, vehicle_model, vehicle_plate, vehicle_color')
        .eq('id', data.assigned_driver_id)
        .maybeSingle();
      if (!dErr && dRow) driverRow = dRow;
    }
    return { data: { kind: 'taxi', row: overlayStaleRow(data, 'taxi'), driver: driverRow }, error: null };
  }

  if (p.kind === 'tuk') {
    const { data, error } = await supabase.from('tuk_tuk_bookings').select('*').eq('id', p.id).maybeSingle();
    if (error) return { data: null, error: error.message };
    if (!data || data.app_user_id !== uid) return { data: null, error: 'Order not found.' };
    let driverRow = null;
    if (data.assigned_driver_id) {
      const { data: dRow, error: dErr } = await supabase
        .from('driver_registrations')
        .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_make, vehicle_model, vehicle_plate, vehicle_color')
        .eq('id', data.assigned_driver_id)
        .maybeSingle();
      if (!dErr && dRow) driverRow = dRow;
    }
    return { data: { kind: 'tuk', row: overlayStaleRow(data, 'tuk'), driver: driverRow }, error: null };
  }

  if (p.kind === 'shop') {
    const { data, error } = await supabase.from('shop_customer_orders').select('*').eq('id', p.id).maybeSingle();
    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: 'Order not found.' };
    const okEmail = email && data.customer_email && emailMatch(email, data.customer_email);
    const okPhone = phone && phonesMatch(phone, data.customer_phone);
    if (!okEmail && !okPhone) return { data: null, error: 'Order not found.' };
    const { data: lines } = await supabase.from('shop_customer_order_lines').select('*').eq('order_id', p.id);
    let driverRow = null;
    if (data.assigned_driver_id) {
      const { data: dRow, error: dErr } = await supabase
        .from('driver_registrations')
        .select('id, full_name, phone, phone_country_code, vehicle_type, vehicle_make, vehicle_model, vehicle_plate, vehicle_color')
        .eq('id', data.assigned_driver_id)
        .maybeSingle();
      if (!dErr && dRow) driverRow = dRow;
    }
    return { data: { kind: 'shop', row: overlayStaleRow(data, 'shop'), lines: lines || [], driver: driverRow }, error: null };
  }

  return { data: null, error: 'Unknown order type.' };
}
