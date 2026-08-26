import { notifyDriversOfOfferStop } from './driverOfferPushNotify';

/** Tables a driver can claim as the sole assigned rider. */
export const CLAIMABLE_BOOKING_TABLES = new Set([
  'customer_delivery_orders',
  'shop_customer_orders',
  'taxi_bookings',
  'tuk_tuk_bookings',
]);

export const ORDER_ALREADY_ACCEPTED_MSG = 'This order has already been accepted by another driver.';

/** @param {string} table @param {string} bookingId */
function signalOfferRingStop(table, bookingId) {
  try {
    notifyDriversOfOfferStop(table, bookingId);
  } catch {
    /* ignore */
  }
}

/**
 * @param {unknown} error
 */
export function isBookingTakenError(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || error || '');
  const details = String(error?.details || '');
  const hint = String(error?.hint || '');
  const blob = `${code} ${msg} ${details} ${hint}`;
  if (/ORDER_ALREADY_ACCEPTED/i.test(blob)) return true;
  if (code === 'P0001' && /already accepted/i.test(blob)) return true;
  if (code === 'PGRST116') return true;
  if (/0 rows|no rows|already accepted|already assigned|no longer available/i.test(blob)) return true;
  return false;
}

/**
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string} table
 * @param {string} bookingId
 * @param {string} driverId
 */
export async function verifyDriverOwnsBooking(supabase, table, bookingId, driverId) {
  if (!supabase || !table || !bookingId || !driverId) return false;
  const { data, error } = await supabase
    .from(table)
    .select('assigned_driver_id')
    .eq('id', bookingId)
    .maybeSingle();
  if (error || !data) return false;
  return String(data.assigned_driver_id || '') === String(driverId);
}

/**
 * @param {{ status?: string | string[] }} [opts]
 */
function applyStatusFilter(query, opts) {
  const st = opts?.status;
  if (Array.isArray(st) && st.length) return query.in('status', st);
  if (typeof st === 'string' && st) return query.eq('status', st);
  return query;
}

/**
 * Client fallback when claim_open_booking RPC is not installed yet.
 * Uses UPDATE … WHERE assigned_driver_id IS NULL so Postgres only lets one driver win.
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string} table
 * @param {string} bookingId
 * @param {string} driverId
 * @param {Record<string, unknown>} patch
 * @param {{ status?: string | string[] }} [opts]
 */
async function claimWithFilteredUpdate(supabase, table, bookingId, driverId, patch, opts) {
  const run = async (body) => {
    let q = supabase.from(table).update(body).eq('id', bookingId).is('assigned_driver_id', null);
    q = applyStatusFilter(q, opts);
    return q.select('id, assigned_driver_id').maybeSingle();
  };

  let { data, error } = await run(patch);
  if (error && /assigned_at|agreed_fare_amount|bid_status|column/i.test(error.message || '')) {
    const slim = { assigned_driver_id: driverId };
    if (patch.status) slim.status = patch.status;
    ({ data, error } = await run(slim));
  }

  if (error) {
    if (isBookingTakenError(error)) {
      return { ok: false, taken: true, error: ORDER_ALREADY_ACCEPTED_MSG };
    }
    return { ok: false, error: error.message };
  }

  if (!data?.id || String(data.assigned_driver_id || '') !== String(driverId)) {
    const owns = await verifyDriverOwnsBooking(supabase, table, bookingId, driverId);
    if (owns) {
      signalOfferRingStop(table, bookingId);
      return { ok: true };
    }
    return { ok: false, taken: true, error: ORDER_ALREADY_ACCEPTED_MSG };
  }
  signalOfferRingStop(table, bookingId);
  return { ok: true };
}

/**
 * First driver to claim wins. Same driver tapping twice is treated as success.
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string} table
 * @param {string} bookingId
 * @param {string} driverId
 * @param {Record<string, unknown>} [fallbackPatch]
 * @param {{ status?: string | string[] }} [fallbackOpts]
 * @returns {Promise<{ ok: boolean, taken?: boolean, error?: string, already?: boolean }>}
 */
export async function claimOpenBooking(supabase, table, bookingId, driverId, fallbackPatch, fallbackOpts) {
  if (!supabase || !table || !bookingId || !driverId) {
    return { ok: false, error: 'Missing data.' };
  }
  if (!CLAIMABLE_BOOKING_TABLES.has(table)) {
    return { ok: false, error: 'Unknown booking type.' };
  }

  const rpc = await supabase.rpc('claim_open_booking', {
    p_table: table,
    p_booking_id: bookingId,
    p_driver_id: driverId,
  });

  if (!rpc.error) {
    let out = rpc.data;
    if (typeof out === 'string') {
      try {
        out = JSON.parse(out);
      } catch {
        out = null;
      }
    }
    out = out && typeof out === 'object' ? out : null;
    if (out?.ok) {
      const { data: check } = await supabase
        .from(table)
        .select('assigned_driver_id')
        .eq('id', bookingId)
        .maybeSingle();
      if (check?.assigned_driver_id && String(check.assigned_driver_id) !== String(driverId)) {
        return { ok: false, taken: true, error: ORDER_ALREADY_ACCEPTED_MSG };
      }
      signalOfferRingStop(table, bookingId);
      return { ok: true, already: Boolean(out.already) };
    }
    if (out?.taken) {
      return { ok: false, taken: true, error: out.error || ORDER_ALREADY_ACCEPTED_MSG };
    }
    return { ok: false, error: out?.error || 'Could not accept this order.' };
  }

  if (isBookingTakenError(rpc.error)) {
    return { ok: false, taken: true, error: ORDER_ALREADY_ACCEPTED_MSG };
  }

  const patch = {
    assigned_driver_id: driverId,
    assigned_at: new Date().toISOString(),
    ...(fallbackPatch || {}),
  };
  return claimWithFilteredUpdate(supabase, table, bookingId, driverId, patch, fallbackOpts);
}
