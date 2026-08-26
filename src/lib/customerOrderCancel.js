import { notifyDriversOfOfferStop } from './driverOfferPushNotify';
import { isSupabaseConfigured, supabase } from './supabaseClient';

/** Auto-cancel open bookings with no driver after this long (1 hour). */
export const CUSTOMER_NO_DRIVER_CANCEL_MS = 60 * 60 * 1000;

/**
 * Same-day / few-hour deliveries: anything still unfinished after this
 * leaves Active Orders and is shown as cancelled (2 days).
 */
export const CUSTOMER_STALE_ACTIVE_CANCEL_MS = 48 * 60 * 60 * 1000;

export const CANCEL_REASON_NO_DRIVER = 'Driver was not found';
export const CANCEL_REASON_CUSTOMER = 'Cancelled by customer';
export const CANCEL_REASON_STALE = 'Automatically cancelled — not completed in time';

const TABLE_BY_KIND = {
  delivery: 'customer_delivery_orders',
  taxi: 'taxi_bookings',
  tuk: 'tuk_tuk_bookings',
};

/**
 * @param {Record<string, unknown> | null | undefined} row
 * @param {'delivery' | 'taxi' | 'tuk'} kind
 */
export function isAwaitingDriverBooking(row, kind) {
  if (!row || row.assigned_driver_id) return false;
  const st = String(row.status || '').toLowerCase();
  if (kind === 'delivery') return st === 'placed' || st === 'paid';
  if (kind === 'taxi' || kind === 'tuk') return st === 'requested';
  return false;
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 * @param {'delivery' | 'taxi' | 'tuk'} kind
 * @param {number} [now]
 */
export function isPastNoDriverCancelWindow(row, kind, now = Date.now()) {
  if (!isAwaitingDriverBooking(row, kind)) return false;
  const iso = row.created_at;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && now - t >= CUSTOMER_NO_DRIVER_CANCEL_MS;
}

/**
 * Unfinished booking older than the active-order window (assigned or not).
 * @param {Record<string, unknown> | null | undefined} row
 * @param {'delivery' | 'taxi' | 'tuk' | 'shop'} kind
 * @param {number} [now]
 */
export function isStaleUnfinishedBooking(row, kind, now = Date.now()) {
  if (!row) return false;
  const st = String(row.status || '').toLowerCase();
  if (st === 'cancelled' || st === 'delivered' || st === 'completed') return false;
  const iso = kind === 'shop' ? row.placed_at || row.created_at : row.created_at;
  const t = new Date(iso || 0).getTime();
  return Number.isFinite(t) && t > 0 && now - t >= CUSTOMER_STALE_ACTIVE_CANCEL_MS;
}

/** @param {Record<string, unknown> | null | undefined} row @param {'delivery' | 'taxi' | 'tuk'} kind */
export function canCustomerCancelBooking(row, kind) {
  if (isStaleUnfinishedBooking(row, kind)) return false;
  return isAwaitingDriverBooking(row, kind);
}

async function patchCancelled(table, filters, reason, cancelledBy = 'customer') {
  const base = {
    status: 'cancelled',
    cancel_reason: reason,
    cancelled_by: cancelledBy,
    cancelled_at: new Date().toISOString(),
  };
  let q = supabase.from(table).update(base);
  for (const [key, val] of Object.entries(filters)) {
    if (val === null) q = q.is(key, null);
    else if (Array.isArray(val)) q = q.in(key, val);
    else if (typeof val === 'object' && val.lt) q = q.lt(key, val.lt);
    else q = q.eq(key, val);
  }
  const { error } = await q;
  if (error && /cancel_reason|cancelled_by|cancelled_at|column/i.test(error.message || '')) {
    let q2 = supabase.from(table).update({ status: 'cancelled', cancel_reason: reason });
    for (const [key, val] of Object.entries(filters)) {
      if (val === null) q2 = q2.is(key, null);
      else if (Array.isArray(val)) q2 = q2.in(key, val);
      else if (typeof val === 'object' && val.lt) q2 = q2.lt(key, val.lt);
      else q2 = q2.eq(key, val);
    }
    let retry = await q2;
    if (retry.error && /cancel_reason|column/i.test(retry.error.message || '')) {
      let q3 = supabase.from(table).update({ status: 'cancelled' });
      for (const [key, val] of Object.entries(filters)) {
        if (val === null) q3 = q3.is(key, null);
        else if (Array.isArray(val)) q3 = q3.in(key, val);
        else if (typeof val === 'object' && val.lt) q3 = q3.lt(key, val.lt);
        else q3 = q3.eq(key, val);
      }
      retry = await q3;
    }
    return retry.error;
  }
  return error;
}

/**
 * Cancel stale parcel / ride / shop bookings for one customer:
 * - no driver after 1 hour
 * - still unfinished after 2 days (clears stuck Active Orders)
 * @param {string} appUserId
 * @param {{ email?: string, phone?: string } | null} [session]
 */
export async function sweepAutoCancelStaleBookings(appUserId, session = null) {
  if (!isSupabaseConfigured || !supabase || !appUserId) return;
  const noDriverCutoff = new Date(Date.now() - CUSTOMER_NO_DRIVER_CANCEL_MS).toISOString();
  const staleCutoff = new Date(Date.now() - CUSTOMER_STALE_ACTIVE_CANCEL_MS).toISOString();

  await patchCancelled(
    'customer_delivery_orders',
    {
      app_user_id: appUserId,
      assigned_driver_id: null,
      status: ['placed', 'paid'],
      created_at: { lt: noDriverCutoff },
    },
    CANCEL_REASON_NO_DRIVER,
    'system',
  );

  await patchCancelled(
    'taxi_bookings',
    {
      app_user_id: appUserId,
      assigned_driver_id: null,
      status: 'requested',
      created_at: { lt: noDriverCutoff },
    },
    CANCEL_REASON_NO_DRIVER,
    'system',
  );

  await patchCancelled(
    'tuk_tuk_bookings',
    {
      app_user_id: appUserId,
      assigned_driver_id: null,
      status: 'requested',
      created_at: { lt: noDriverCutoff },
    },
    CANCEL_REASON_NO_DRIVER,
    'system',
  );

  await patchCancelled(
    'customer_delivery_orders',
    {
      app_user_id: appUserId,
      status: ['placed', 'paid', 'assigned'],
      created_at: { lt: staleCutoff },
    },
    CANCEL_REASON_STALE,
    'system',
  );

  await patchCancelled(
    'taxi_bookings',
    {
      app_user_id: appUserId,
      status: ['requested', 'confirmed'],
      created_at: { lt: staleCutoff },
    },
    CANCEL_REASON_STALE,
    'system',
  );

  await patchCancelled(
    'tuk_tuk_bookings',
    {
      app_user_id: appUserId,
      status: ['requested', 'confirmed'],
      created_at: { lt: staleCutoff },
    },
    CANCEL_REASON_STALE,
    'system',
  );

  const email = session?.email ? String(session.email).trim().toLowerCase() : '';
  const phone = session?.phone ? String(session.phone).trim() : '';
  const shopOpen = ['placed', 'processing', 'ready for delivery', 'picked up', 'in transit'];
  if (email) {
    await patchCancelled(
      'shop_customer_orders',
      {
        customer_email: email,
        status: shopOpen,
        placed_at: { lt: staleCutoff },
      },
      CANCEL_REASON_STALE,
      'system',
    );
  }
  if (phone) {
    await patchCancelled(
      'shop_customer_orders',
      {
        customer_phone: phone,
        status: shopOpen,
        placed_at: { lt: staleCutoff },
      },
      CANCEL_REASON_STALE,
      'system',
    );
  }
}

/**
 * @param {{ kind: 'delivery' | 'taxi' | 'tuk'; id: string; appUserId: string; reason?: string }} opts
 */
export async function cancelCustomerBooking(opts) {
  const { kind, id, appUserId, reason = CANCEL_REASON_CUSTOMER } = opts;
  const table = TABLE_BY_KIND[kind];
  if (!table || !isSupabaseConfigured || !supabase) {
    return { ok: false, error: 'Could not cancel — service unavailable.' };
  }

  const { data: row, error: readErr } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (readErr) return { ok: false, error: readErr.message || 'Could not load order.' };
  if (!row || String(row.app_user_id) !== String(appUserId)) {
    return { ok: false, error: 'Order not found.' };
  }
  if (!canCustomerCancelBooking(row, kind)) {
    return { ok: false, error: 'This order can no longer be cancelled.' };
  }

  const err = await patchCancelled(table, { id }, reason);
  if (err) return { ok: false, error: err.message || 'Could not cancel order.' };
  try {
    notifyDriversOfOfferStop(table, id);
  } catch {
    /* ignore */
  }
  return { ok: true };
}
