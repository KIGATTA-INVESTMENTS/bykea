/** Booking tables that store `driver_live_lat` / `driver_live_lng` for customer maps. */
export const LIVE_TRACK_TABLES = new Set([
  'customer_delivery_orders',
  'shop_customer_orders',
  'taxi_bookings',
  'tuk_tuk_bookings',
]);

/**
 * @param {string | null | undefined} table
 * @returns {'customer_delivery_orders' | 'shop_customer_orders' | 'taxi_bookings' | 'tuk_tuk_bookings' | null}
 */
export function resolveLiveTrackTable(table) {
  const t = String(table || '').trim();
  return LIVE_TRACK_TABLES.has(t) ? /** @type {any} */ (t) : null;
}

/** Driver GPS older than this is ignored on customer tracking maps. */
export const DRIVER_LIVE_MAX_AGE_MS = 90 * 1000;

/**
 * @param {{ driver_live_updated_at?: string | null } | null | undefined} row
 * @returns {boolean}
 */
export function isDriverLiveFresh(row) {
  const raw = row?.driver_live_updated_at;
  if (!raw) return false;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= DRIVER_LIVE_MAX_AGE_MS;
}
