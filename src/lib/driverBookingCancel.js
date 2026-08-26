import { getDriverSession } from './driverSession';
import { notifyDriversOfOfferStop } from './driverOfferPushNotify';
import { isSupabaseConfigured, supabase } from './supabaseClient';

/** Preset reasons shown on the driver cancel form. */
export const DRIVER_CANCEL_REASONS = [
  { id: 'breakdown', label: 'Breakdown' },
  { id: 'client_not_reachable', label: 'Client not reachable' },
  { id: 'wrong_address', label: 'Wrong / unclear address' },
  { id: 'customer_refused', label: 'Customer refused the ride' },
  { id: 'safety', label: 'Safety concern' },
  { id: 'traffic_blocked', label: 'Road blocked / cannot reach' },
  { id: 'other', label: 'Other' },
];

const ACTIVE_STATUSES = {
  customer_delivery_orders: ['placed', 'paid', 'assigned'],
  taxi_bookings: ['requested', 'confirmed'],
  tuk_tuk_bookings: ['requested', 'confirmed'],
  shop_customer_orders: ['ready for delivery', 'picked up', 'in transit', 'assigned'],
};

/**
 * @param {string} reasonId
 * @param {string} [note]
 */
export function formatDriverCancelReason(reasonId, note = '') {
  const preset = DRIVER_CANCEL_REASONS.find((r) => r.id === reasonId);
  const label = preset?.label || 'Other';
  const extra = String(note || '').trim();
  if (reasonId === 'other' || extra) {
    return extra ? `${label}: ${extra}` : label;
  }
  return label;
}

async function patchCancel(table, bookingId, patch) {
  const { error } = await supabase.from(table).update(patch).eq('id', bookingId);
  if (!error) return null;

  const msg = error.message || '';
  if (/cancelled_by|cancelled_at|cancel_reason|column/i.test(msg)) {
    const slim = { status: 'cancelled' };
    if (patch.cancel_reason && !/cancel_reason/i.test(msg)) slim.cancel_reason = patch.cancel_reason;
    if (patch.cancelled_by && !/cancelled_by/i.test(msg)) slim.cancelled_by = patch.cancelled_by;
    if (patch.cancelled_at && !/cancelled_at/i.test(msg)) slim.cancelled_at = patch.cancelled_at;
    if (patch.bid_status && !/bid_status/i.test(msg)) slim.bid_status = patch.bid_status;
    const retry = await supabase.from(table).update(slim).eq('id', bookingId);
    if (!retry.error) return null;
    // Last resort: status only
    const last = await supabase.from(table).update({ status: 'cancelled' }).eq('id', bookingId);
    return last.error;
  }
  return error;
}

/**
 * Driver cancels an assigned active booking and stores a reason in Supabase.
 * @param {{
 *   table: string,
 *   bookingId: string,
 *   reasonId: string,
 *   note?: string,
 *   driverId?: string | null,
 * }} opts
 */
export async function cancelDriverBooking(opts) {
  const { table, bookingId, reasonId, note = '' } = opts;
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: 'Service unavailable.' };
  }
  if (!table || !bookingId) {
    return { ok: false, error: 'Missing booking.' };
  }
  if (!reasonId) {
    return { ok: false, error: 'Please choose a cancel reason.' };
  }

  const driverId = opts.driverId || getDriverSession()?.id || null;
  const { data: row, error: readErr } = await supabase.from(table).select('*').eq('id', bookingId).maybeSingle();
  if (readErr) return { ok: false, error: readErr.message || 'Could not load booking.' };
  if (!row) return { ok: false, error: 'Booking not found.' };

  const st = String(row.status || '').toLowerCase();
  if (st === 'cancelled' || st === 'completed' || st === 'delivered') {
    return { ok: false, error: 'This trip is already finished.' };
  }

  const allowed = ACTIVE_STATUSES[table];
  if (allowed && !allowed.map((s) => s.toLowerCase()).includes(st)) {
    return { ok: false, error: 'This trip can no longer be cancelled.' };
  }

  if (driverId && row.assigned_driver_id && String(row.assigned_driver_id) !== String(driverId)) {
    return { ok: false, error: 'This booking is assigned to another driver.' };
  }

  const reason = formatDriverCancelReason(reasonId, note);
  const now = new Date().toISOString();
  const patch = {
    status: 'cancelled',
    cancel_reason: reason,
    cancelled_by: 'driver',
    cancelled_at: now,
  };
  if (Object.prototype.hasOwnProperty.call(row, 'bid_status') || row.bid_status != null) {
    patch.bid_status = 'cancelled';
  }

  const err = await patchCancel(table, bookingId, patch);
  if (err) return { ok: false, error: err.message || 'Could not cancel ride.' };
  try {
    notifyDriversOfOfferStop(table, bookingId);
  } catch {
    /* ignore */
  }
  return { ok: true, reason };
}
