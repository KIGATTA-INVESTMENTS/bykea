/** Customer wait time before showing “no driver available” (5 minutes). */
export const CUSTOMER_DRIVER_SEARCH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * @param {{ created_at?: string | null; placed_at?: string | null } | null | undefined} liveRow
 * @param {{ placedAt?: string | null } | null | undefined} [order]
 */
export function getDriverSearchWaitStartIso(liveRow, order = {}) {
  return liveRow?.created_at || liveRow?.placed_at || order?.placedAt || null;
}

/**
 * @param {{
 *   liveRow?: { created_at?: string | null; placed_at?: string | null; status?: string | null } | null;
 *   order?: { placedAt?: string | null };
 *   hasDriver?: boolean;
 *   now?: number;
 * }} opts
 */
export function isDriverSearchTimedOut(opts = {}) {
  const { liveRow, order = {}, hasDriver = false, now = Date.now() } = opts;
  if (hasDriver) return false;
  const st = String(liveRow?.status || '').toLowerCase();
  if (st === 'cancelled' || st === 'delivered' || st === 'completed') return false;
  const iso = getDriverSearchWaitStartIso(liveRow, order);
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t >= CUSTOMER_DRIVER_SEARCH_TIMEOUT_MS;
}

export function noDriverAvailableHeadline() {
  return 'No driver is available';
}

/**
 * @param {{ isRide?: boolean; isShop?: boolean }} [opts]
 */
export function noDriverAvailableDetail(opts = {}) {
  const { isRide = false, isShop = false } = opts;
  if (isRide) {
    return 'We could not find a driver for your ride. Please try booking again in a few minutes or contact support.';
  }
  if (isShop) {
    return 'We could not find a driver for your shop delivery. Please try again later or contact support.';
  }
  return 'We could not find a driver for your delivery. Please try again later or contact support.';
}

/**
 * @param {{ viewed_driver_ids?: unknown } | null | undefined} row
 * @returns {number}
 */
export function countBookingDriversSeen(row) {
  const arr = row?.viewed_driver_ids;
  if (!Array.isArray(arr)) return 0;
  return arr.filter(Boolean).length;
}

/**
 * @param {number} count
 * @returns {string}
 */
export function driversSeenRequestLabel(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n === 1) return '1 driver has seen your request';
  return `${n} drivers have seen your request`;
}

/**
 * Customer picks a driver only when more than one has seen the request
 * and more than one has offered — a single option is not a choice.
 */
export function shouldCustomerPickDriver(seenCount, pendingBidCount) {
  return Number(seenCount) >= 2 && Number(pendingBidCount) >= 2;
}

/** First (or only) viewer who offers is assigned immediately. */
export function shouldAutoAssignSoloDriverOffer(seenCount) {
  return Number(seenCount) <= 1;
}

/** Safety net on the customer page if a lone bid was left pending. */
export function shouldAutoAcceptLonePendingBid(seenCount, pendingBidCount) {
  return Number(pendingBidCount) === 1 && Number(seenCount) <= 1;
}
