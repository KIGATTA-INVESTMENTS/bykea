import { assertDriverCanWork } from './driverApproval';
import { driverAcceptCustomerOffer, getAgreedFare, getCustomerOfferAmount, getMinimumFare } from './bookingBids';
import { claimOpenBooking, ORDER_ALREADY_ACCEPTED_MSG, verifyDriverOwnsBooking } from './claimOpenBooking';
import {
  DELIVERY_PIN_INCOMPLETE_ERROR,
  DELIVERY_PIN_MISMATCH_ERROR,
  deliveryPinsMatch,
  isCompleteDeliveryPin,
  normalizeDeliveryCodeInput,
} from './deliveryConfirmationCode';
import { normalizeParcelVehicleKey as normalizeVehicleKey } from './deliveryVehicleTypes';
import { deductDriverDepositAfterJob } from './driverDepositGate';

/**
 * @typedef {object} NormalizedDriverOffer
 * @property {'customer_delivery_orders' | 'shop_customer_orders' | 'taxi_bookings' | 'tuk_tuk_bookings'} table
 * @property {'parcel' | 'shop' | 'taxi' | 'tuktuk'} kind
 * @property {string} id
 * @property {string} ref
 * @property {string} from
 * @property {string} to
 * @property {string} dist
 * @property {string} eta
 * @property {string} pkg
 * @property {number} amount
 * @property {number} [minimumAmount]
 * @property {string} [created_at]
 * @property {string} [customerPayment] — how customer pays (Cash / Card / …), when known
 * @property {Record<string, unknown>} raw
 */

/**
 * @param {string | null | undefined} id
 * @returns {string}
 */
export function shortBookingRef(id) {
  if (!id) return 'ING-—';
  const s = String(id).replace(/-/g, '');
  return `ING-${s.slice(0, 8).toUpperCase()}`;
}

/** Short label for drivers: customer payment on delivery orders (`customer_delivery_orders.payment_method`). */
export function customerPaymentLabelFromRow(row) {
  const m = String(row?.payment_method ?? '')
    .toLowerCase()
    .trim();
  if (m === 'wallet') return 'Wallet Payment';
  if (m === 'cod') return 'Cash Payment';
  if (m === 'card') return 'Card';
  if (m === 'stripe') return 'Card';
  if (m === 'ecocash') return 'EcoCash';
  if (m === 'paynow') return 'Card';
  return '—';
}

/** @param {string | null | undefined} labelOrMethod */
export function isWalletCustomerPayment(labelOrMethod) {
  const s = String(labelOrMethod || '')
    .toLowerCase()
    .trim();
  return s === 'wallet' || s === 'wallet payment' || s.includes('wallet');
}

/** @param {string | null | undefined} labelOrMethod */
export function isCashCustomerPayment(labelOrMethod) {
  const s = String(labelOrMethod || '')
    .toLowerCase()
    .trim();
  return s === 'cod' || s === 'cash payment' || s === 'cash on delivery' || s === 'cash';
}

function wasRejected(row, driverId) {
  const arr = row?.rejected_driver_ids;
  if (!Array.isArray(arr) || !driverId) return false;
  return arr.some((x) => String(x) === String(driverId));
}

/** Assumed max parcel weight (kg) per vehicle for matching offers (conservative). */
const VEHICLE_PARCEL_MAX_KG = {
  bicycle: 8,
  motorbike: 40,
  tuktuk: 200,
  car: 500,
  van: 800,
  minibus: 800,
};

/**
 * When `package_weight` is empty, infer load from size so drivers still get sensible offers.
 * @type {Record<string, number>}
 */
const PACKAGE_SIZE_FALLBACK_KG = {
  small: 5,
  medium: 15,
  large: 85,
  xlarge: 280,
};

/**
 * Parse numeric weight from customer input (Package Details uses kg; lb accepted if labeled).
 * @param {string | null | undefined} text
 * @returns {number | null} kilograms, or null if unknown
 */
export function parsePackageWeightKg(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const m = raw.replace(/,/g, '.').match(/([\d.]+)\s*(kg|kgs|lb|lbs|pound|pounds)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = String(m[2] || 'kg').toLowerCase();
  if (unit === 'lb' || unit === 'lbs' || unit === 'pound' || unit === 'pounds') return n * 0.45359237;
  return n;
}

/**
 * Effective parcel weight (kg) for vehicle matching: explicit weight, else size fallback, else 0 (any vehicle).
 * @param {Record<string, unknown>} row customer_delivery_orders or delivery_requests row
 */
export function effectiveParcelLoadKg(row) {
  const fromField = parsePackageWeightKg(row?.package_weight);
  if (fromField != null && fromField > 0) return fromField;
  const size = String(row?.package_size || '')
    .trim()
    .toLowerCase();
  if (size && Object.prototype.hasOwnProperty.call(PACKAGE_SIZE_FALLBACK_KG, size)) {
    return PACKAGE_SIZE_FALLBACK_KG[size];
  }
  return 0;
}

/**
 * Canonical requested vehicle for matching drivers (Motorbike | Tuk-Tuk | Car pool only).
 * Empty / unknown → Motorbike (matches checkout default). Legacy bicycle → motorbike; van/minibus → car.
 * @param {Record<string, unknown>} row
 * @returns {'motorbike' | 'tuktuk' | 'car'}
 */
function parcelRequestedVehicleKeyForMatch(row) {
  let req = normalizeVehicleKey(row?.requested_vehicle_type);
  if (req === 'bicycle') req = 'motorbike';
  if (req === 'van' || req === 'minibus') req = 'car';
  if (!req) req = 'motorbike';
  return req;
}

/**
 * Customer-chosen vehicle size: only drivers with that same vehicle type see the offer (not larger vehicles).
 * @param {Record<string, unknown>} row
 * @param {string} driverV normalized driver vehicle key
 */
function driverVehicleMatchesParcelRequest(row, driverV) {
  return Boolean(driverV) && driverV === parcelRequestedVehicleKeyForMatch(row);
}

/**
 * Whether this driver's vehicle can carry the parcel (exact vehicle type + weight capacity).
 * Drivers without a recognized vehicle type see no parcel offers.
 * Unknown weight/size uses a conservative default so light vehicles are not flooded.
 * @param {Record<string, unknown>} row
 * @param {string | null | undefined} driverVehicleType
 */
export function canDriverTakeParcelDelivery(row, driverVehicleType) {
  const driverV = normalizeVehicleKey(driverVehicleType);
  if (!driverV) return false;
  if (!driverVehicleMatchesParcelRequest(row, driverV)) return false;
  let kg = effectiveParcelLoadKg(row);
  if (!(kg > 0)) kg = PACKAGE_SIZE_FALLBACK_KG.medium;
  const cap = VEHICLE_PARCEL_MAX_KG[driverV];
  if (cap == null || !(cap > 0)) return false;
  return kg <= cap;
}

/**
 * Whether a driver can see/accept this taxi booking by vehicle type.
 * @param {Record<string, unknown>} row
 * @param {string | null | undefined} driverVehicleType
 */
function canDriverTakeTaxiBooking(row, driverVehicleType) {
  const driverV = normalizeVehicleKey(driverVehicleType);
  const bookingV = normalizeVehicleKey(row?.vehicle_type);
  if (!driverV) return true; // fail-open for legacy/incomplete profiles
  if (!bookingV) return true; // fail-open for legacy rows without vehicle type
  // Business rule: Bike and Motorbike are treated as the same pool.
  const bikePool = new Set(['bicycle', 'motorbike']);
  if (bikePool.has(driverV) && bikePool.has(bookingV)) return true;
  return driverV === bookingV;
}

/**
 * Card / Paynow rides: hide from drivers until online payment is confirmed (`payment_status === 'paid'`).
 * @param {Record<string, unknown>} row taxi_bookings or tuk_tuk_bookings row
 */
export function rideCardPaymentPending(row) {
  const pm = String(row?.payment_method || '')
    .toLowerCase()
    .trim();
  if (pm !== 'card') return false;
  const ps = String(row?.payment_status || '')
    .toLowerCase()
    .trim();
  return ps !== 'paid';
}

/** Shop→customer: drivers with any registered vehicle type may accept. */
function canDriverTakeShopDelivery(driverVehicleType) {
  return Boolean(normalizeVehicleKey(driverVehicleType));
}

/**
 * Total time an unassigned job keeps being offered to drivers: it is re-offered in
 * repeating cycles (see `OFFER_RING_CYCLE_MS`) until a driver accepts or 30 minutes pass.
 * Once a job is accepted (`assigned_driver_id` set) it is no longer offered.
 */
export const OPEN_OFFER_MAX_AGE_MS = 30 * 60_000;

/** Each re-offer cycle shows for this long (the home UI countdown ring), then repeats. */
export const OFFER_RING_CYCLE_MS = 120_000;

function openOfferCutoffIso(driverRegisteredAt) {
  let cutoffMs = Date.now() - OPEN_OFFER_MAX_AGE_MS;
  if (driverRegisteredAt) {
    const regMs = new Date(driverRegisteredAt).getTime();
    if (Number.isFinite(regMs) && regMs > 0) cutoffMs = Math.max(cutoffMs, regMs);
  }
  return new Date(cutoffMs).toISOString();
}

function offerPlacedAtIso(row) {
  return row?.created_at || row?.placed_at || null;
}

/**
 * Open booking rows must be fresh, unassigned, bid-open, and not older than the driver account.
 * @param {Record<string, unknown> | null | undefined} row
 * @param {string | null | undefined} driverRegisteredAt
 */
export function isOpenBookingRowFresh(row, driverRegisteredAt) {
  if (!row || row.assigned_driver_id) return false;
  const placedAt = offerPlacedAtIso(row);
  if (!isOpenOfferStillFresh(placedAt)) return false;
  if (driverRegisteredAt) {
    const placedMs = new Date(placedAt || 0).getTime();
    const regMs = new Date(driverRegisteredAt).getTime();
    if (Number.isFinite(regMs) && Number.isFinite(placedMs) && placedMs < regMs) return false;
  }
  const bidStatus = String(row.bid_status || 'open').toLowerCase();
  if (bidStatus === 'matched' || bidStatus === 'cancelled') return false;
  return true;
}

/** @param {string | null | undefined} iso */
export function isOpenOfferStillFresh(iso) {
  const placed = new Date(iso || 0).getTime();
  if (!Number.isFinite(placed) || placed <= 0) return false;
  return Date.now() - placed < OPEN_OFFER_MAX_AGE_MS;
}

/**
 * Seconds left in the current re-offer cycle (counts down from `OFFER_RING_CYCLE_MS`,
 * then restarts), returning 0 once the overall 30-minute window has elapsed.
 * @param {string | null | undefined} iso
 */
export function openOfferSecondsLeft(iso) {
  const placed = new Date(iso || 0).getTime();
  if (!Number.isFinite(placed) || placed <= 0) return 0;
  const elapsed = Date.now() - placed;
  if (elapsed >= OPEN_OFFER_MAX_AGE_MS) return 0;
  const intoCycle = elapsed % OFFER_RING_CYCLE_MS;
  return Math.max(0, Math.ceil((OFFER_RING_CYCLE_MS - intoCycle) / 1000));
}

/**
 * Shop orders ready for driver: single-shop checkout, pickup at `shop_owners.business_address`, drop at customer address.
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string} driverId
 * @param {string | null | undefined} [driverVehicleType]
 */
async function fetchShopDeliveryOpenOffers(supabase, driverId, driverVehicleType, driverRegisteredAt) {
  if (!supabase || !driverId || !canDriverTakeShopDelivery(driverVehicleType)) return [];
  const { data: orders, error } = await supabase
    .from('shop_customer_orders')
    .select('*')
    .eq('status', 'ready for delivery')
    .is('assigned_driver_id', null)
    .gte('placed_at', openOfferCutoffIso(driverRegisteredAt))
    .order('placed_at', { ascending: false })
    .limit(40);
  if (error || !Array.isArray(orders) || !orders.length) return [];
  const oids = orders.map((o) => o.id).filter(Boolean);
  const { data: lineRows, error: lne } = await supabase
    .from('shop_customer_order_lines')
    .select('order_id, shop_owner_id, product_name, quantity')
    .in('order_id', oids);
  if (lne || !Array.isArray(lineRows)) return [];
  const lineByOrder = {};
  for (const ln of lineRows) {
    if (!lineByOrder[ln.order_id]) lineByOrder[ln.order_id] = [];
    lineByOrder[ln.order_id].push(ln);
  }
  const ownerByOrder = {};
  const ownerIds = new Set();
  for (const oid of oids) {
    const L = lineByOrder[oid] || [];
    const shops = [...new Set(L.map((x) => x.shop_owner_id).filter(Boolean))];
    if (shops.length !== 1) continue;
    ownerByOrder[oid] = shops[0];
    ownerIds.add(shops[0]);
  }
  if (!ownerIds.size) return [];
  const { data: shops, error: se } = await supabase
    .from('shop_owners')
    .select('id, business_address, business_name')
    .in('id', [...ownerIds]);
  if (se || !Array.isArray(shops)) return [];
  const shopMap = Object.fromEntries(shops.map((sh) => [sh.id, sh]));
  /** @type {NormalizedDriverOffer[]} */
  const out = [];
  for (const row of orders) {
    if (!isOpenBookingRowFresh({ ...row, created_at: row.placed_at }, driverRegisteredAt)) continue;
    if (wasRejected(row, driverId)) continue;
    const sid = ownerByOrder[row.id];
    if (!sid) continue;
    const shop = shopMap[sid];
    const pickupAddr = String(shop?.business_address || '').trim();
    if (!pickupAddr || !shop) continue;
    const dropAddr = String(row.customer_address || '').trim() || '—';
    const L = lineByOrder[row.id] || [];
    const pkgBits = L.map((x) => `${x.product_name}×${x.quantity}`).join(', ');
    const pkg = [String(shop.business_name || '').trim() || 'Shop', pkgBits].filter(Boolean).join(' · ').slice(0, 200);
    const raw = {
      ...row,
      _shop_pickup_address: pickupAddr,
      _shop_business_name: shop.business_name,
      requested_vehicle_type: 'Motorbike',
      package_size: 'medium',
      package_weight: '',
      package_category: 'Shop order',
    };
    out.push({
      table: 'shop_customer_orders',
      kind: 'shop',
      id: row.id,
      ref: String(row.order_number || shortBookingRef(row.id)),
      from: pickupAddr + (shop.business_name ? ` (${shop.business_name})` : ''),
      to: dropAddr,
      dist: '—',
      eta: '—',
      pkg: pkg || 'Shop order',
      amount: Number(row.subtotal) || 0,
      created_at: row.placed_at,
      customerPayment: customerPaymentLabelFromRow(row),
      raw,
    });
  }
  return out;
}

/**
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string} driverId
 * @param {string | null | undefined} [driverVehicleType]
 * @param {string | null | undefined} [driverRegisteredAt]
 */
export async function fetchOpenOffersForDriver(supabase, driverId, driverVehicleType, driverRegisteredAt) {
  if (!supabase || !driverId) return [];

  const offerCutoff = openOfferCutoffIso(driverRegisteredAt);

  // Try with bid_status, fall back without if column missing
  let [pRes, tRes, uRes] = await Promise.all([
    supabase
      .from('customer_delivery_orders')
      .select('*')
      .in('status', ['placed', 'paid'])
      .is('assigned_driver_id', null)
      .in('bid_status', ['open'])
      .gte('created_at', offerCutoff)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('taxi_bookings')
      .select('*')
      .eq('status', 'requested')
      .is('assigned_driver_id', null)
      .in('bid_status', ['open'])
      .gte('created_at', offerCutoff)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('tuk_tuk_bookings')
      .select('*')
      .eq('status', 'requested')
      .is('assigned_driver_id', null)
      .in('bid_status', ['open'])
      .gte('created_at', offerCutoff)
      .order('created_at', { ascending: false })
      .limit(40),
  ]);

  const bidColMissing = [pRes.error, tRes.error, uRes.error].some((e) =>
    e && /bid_status/i.test(e.message || ''),
  );
  if (bidColMissing) {
    [pRes, tRes, uRes] = await Promise.all([
      supabase
        .from('customer_delivery_orders')
        .select('*')
        .in('status', ['placed', 'paid'])
        .is('assigned_driver_id', null)
        .gte('created_at', offerCutoff)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('taxi_bookings')
        .select('*')
        .eq('status', 'requested')
        .is('assigned_driver_id', null)
        .gte('created_at', offerCutoff)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('tuk_tuk_bookings')
        .select('*')
        .eq('status', 'requested')
        .is('assigned_driver_id', null)
        .gte('created_at', offerCutoff)
        .order('created_at', { ascending: false })
        .limit(40),
    ]);
  }

  const errs = [pRes.error, tRes.error, uRes.error].filter(Boolean);
  if (errs.length) {
    const msg = errs.map((e) => e.message).join(' ');
    const missingCol = /assigned_driver_id|rejected_driver_ids/i.test(msg);
    const err = new Error(
      missingCol
        ? `${msg} — Run supabase/driver_booking_assignment.sql in the Supabase SQL editor.`
        : msg,
    );
    throw err;
  }

  /** @type {NormalizedDriverOffer[]} */
  const out = [];

  const parcelSummaryLabel = (row) => {
    const reqV = String(row.requested_vehicle_type || '').trim();
    const parts = [
      reqV ? `Min vehicle: ${reqV}` : null,
      row.package_category,
      row.package_size,
      row.package_weight,
    ]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    const base = parts.join(' · ') || 'Delivery';
    const notes = String(row.package_notes || '').trim();
    const tail = notes.length > 48 ? `${notes.slice(0, 48)}…` : notes;
    return tail ? `${base} · ${tail}` : base;
  };

  for (const row of pRes.data || []) {
    if (!isOpenBookingRowFresh(row, driverRegisteredAt)) continue;
    if (wasRejected(row, driverId)) continue;
    if (!canDriverTakeParcelDelivery(row, driverVehicleType)) continue;
    const total = getCustomerOfferAmount(row);
    const dist = [row.distance_estimate, row.eta_text].map((x) => String(x || '').trim()).filter(Boolean).join(' · ') || '—';
    out.push({
      table: 'customer_delivery_orders',
      kind: 'parcel',
      id: row.id,
      ref: shortBookingRef(row.id),
      from: row.pickup_location || '—',
      to: row.dropoff_location || '—',
      dist,
      eta: row.eta_text || row.distance_estimate || '—',
      pkg: parcelSummaryLabel(row),
      amount: total,
      minimumAmount: getMinimumFare(row),
      created_at: row.created_at,
      customerPayment: customerPaymentLabelFromRow(row),
      raw: row,
    });
  }

  const taxiPkgLabel = (row) => {
    const rt = String(row?.ride_type || '');
    if (rt === 'prem') return 'Premium taxi';
    const vt = String(row?.vehicle_type || '').toLowerCase();
    if (vt === 'bicycle') return 'Bike';
    if (vt === 'tuktuk') return 'Tuk-Tuk';
    if (vt === 'car') return 'Car';
    if (vt === 'minibus') return 'Mini Bus';
    if (rt === 'tuk') return 'Tuk-Tuk';
    if (rt === 'std') return 'Standard taxi';
    return 'Taxi';
  };

  for (const row of tRes.data || []) {
    if (!isOpenBookingRowFresh(row, driverRegisteredAt)) continue;
    if (wasRejected(row, driverId)) continue;
    if (rideCardPaymentPending(row)) continue;
    if (!canDriverTakeTaxiBooking(row, driverVehicleType)) continue;
    const price = getCustomerOfferAmount(row);
    out.push({
      table: 'taxi_bookings',
      kind: 'taxi',
      id: row.id,
      ref: shortBookingRef(row.id),
      from: row.pickup_location || '—',
      to: row.destination_location || '—',
      dist: row.estimated_distance_label || '—',
      eta: row.estimated_duration_label || '—',
      pkg: taxiPkgLabel(row),
      amount: price,
      minimumAmount: getMinimumFare(row),
      created_at: row.created_at,
      customerPayment: customerPaymentLabelFromRow(row),
      raw: row,
    });
  }

  for (const row of uRes.data || []) {
    if (!isOpenBookingRowFresh(row, driverRegisteredAt)) continue;
    if (wasRejected(row, driverId)) continue;
    if (rideCardPaymentPending(row)) continue;
    const price = getCustomerOfferAmount(row);
    out.push({
      table: 'tuk_tuk_bookings',
      kind: 'tuktuk',
      id: row.id,
      ref: shortBookingRef(row.id),
      from: row.pickup_location || '—',
      to: row.destination_location || '—',
      dist: row.estimated_distance_label || '—',
      eta: row.estimated_duration_label || '—',
      pkg: 'Tuk-Tuk',
      amount: price,
      minimumAmount: getMinimumFare(row),
      created_at: row.created_at,
      customerPayment: customerPaymentLabelFromRow(row),
      raw: row,
    });
  }

  let shopOffers = [];
  try {
    shopOffers = await fetchShopDeliveryOpenOffers(supabase, driverId, driverVehicleType, driverRegisteredAt);
  } catch {
    shopOffers = [];
  }
  for (const so of shopOffers) out.push(so);

  out.sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });

  return out;
}

/**
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string} driverId
 */
/** Driver home: show parcels accepted within this long; rides use `RECENT_RIDE_MAX_MS`. */
const RECENT_PARCEL_MAX_MS = 48 * 60 * 60 * 1000;
/** Taxi / Tuk-Tuk: short window so a ride accepted hours ago does not stay in "recent" (uses assigned_at). */
const RECENT_RIDE_MAX_MS = 6 * 60 * 60 * 1000;

function recentJobAcceptanceMs(row) {
  const iso = row?.assignedAt || row?.t;
  const n = new Date(iso || 0).getTime();
  return Number.isFinite(n) ? n : 0;
}

function recentJobMaxAgeMs(kind) {
  return kind === 'parcel' || kind === 'shop' ? RECENT_PARCEL_MAX_MS : RECENT_RIDE_MAX_MS;
}

/**
 * Assigned jobs for the driver home "recent" strip — sorted by accept time, capped by age per kind.
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string} driverId
 */
export async function fetchRecentForDriver(supabase, driverId) {
  if (!supabase || !driverId) return [];

  const [pRes, tRes, uRes, shRes] = await Promise.all([
    supabase
      .from('customer_delivery_orders')
      .select('id, pickup_location, dropoff_location, total_amount, status, created_at, assigned_at')
      .eq('assigned_driver_id', driverId)
      .in('status', ['assigned'])
      .order('created_at', { ascending: false })
      .limit(24),
    supabase
      .from('taxi_bookings')
      .select('id, pickup_location, destination_location, quoted_price, status, created_at, assigned_at')
      .eq('assigned_driver_id', driverId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(24),
    supabase
      .from('tuk_tuk_bookings')
      .select('id, pickup_location, destination_location, quoted_price, status, created_at, assigned_at')
      .eq('assigned_driver_id', driverId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(24),
    supabase
      .from('shop_customer_orders')
      .select('id, customer_address, subtotal, status, placed_at, assigned_at, order_number')
      .eq('assigned_driver_id', driverId)
      .order('placed_at', { ascending: false })
      .limit(24),
  ]);

  if (pRes.error || tRes.error || uRes.error || shRes.error) return [];

  const now = Date.now();
  const rows = [];
  for (const r of pRes.data || []) {
    const assignedAt = r.assigned_at || r.created_at;
    const row = {
      id: r.id,
      ref: shortBookingRef(r.id),
      to: r.dropoff_location || '—',
      amt: Number(r.total_amount) || 0,
      st: String(r.status || '').replace(/_/g, ' '),
      t: assignedAt,
      assignedAt,
      kind: 'parcel',
    };
    if (now - recentJobAcceptanceMs(row) <= recentJobMaxAgeMs('parcel')) rows.push(row);
  }
  for (const r of shRes.data || []) {
    const st = String(r.status || '').toLowerCase();
    if (st === 'delivered' || st === 'cancelled') continue;
    const assignedAt = r.assigned_at || r.placed_at;
    const row = {
      id: r.id,
      ref: String(r.order_number || shortBookingRef(r.id)),
      to: r.customer_address || '—',
      amt: Number(r.subtotal) || 0,
      st: String(r.status || '').replace(/_/g, ' '),
      t: assignedAt,
      assignedAt,
      kind: 'shop',
    };
    if (now - recentJobAcceptanceMs(row) <= recentJobMaxAgeMs('shop')) rows.push(row);
  }
  for (const r of tRes.data || []) {
    const assignedAt = r.assigned_at || r.created_at;
    const row = {
      id: r.id,
      ref: shortBookingRef(r.id),
      to: r.destination_location || '—',
      amt: Number(r.quoted_price) || 0,
      st: String(r.status || ''),
      t: assignedAt,
      assignedAt,
      kind: 'taxi',
    };
    if (now - recentJobAcceptanceMs(row) <= recentJobMaxAgeMs('taxi')) rows.push(row);
  }
  for (const r of uRes.data || []) {
    const assignedAt = r.assigned_at || r.created_at;
    const row = {
      id: r.id,
      ref: shortBookingRef(r.id),
      to: r.destination_location || '—',
      amt: Number(r.quoted_price) || 0,
      st: String(r.status || ''),
      t: assignedAt,
      assignedAt,
      kind: 'tuktuk',
    };
    if (now - recentJobAcceptanceMs(row) <= recentJobMaxAgeMs('tuktuk')) rows.push(row);
  }

  rows.sort((a, b) => recentJobAcceptanceMs(b) - recentJobAcceptanceMs(a));
  return rows.slice(0, 15);
}

function activeJobLineStatus(row, kind) {
  const nav = String(row?.driver_nav_leg || '').toLowerCase();
  if (nav === 'to_dropoff') return kind === 'shop' ? 'Delivering to customer' : 'En route to drop-off';
  if (nav === 'to_pickup') return 'Heading to pickup';
  const st = String(row?.status || '').toLowerCase();
  if (kind === 'shop' && st === 'picked up') return 'Order picked up';
  if (kind === 'shop' && st === 'in transit') return 'In transit';
  return 'Assigned';
}

/**
 * In-progress jobs assigned to this driver (for Orders → Active tab).
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string} driverId
 */
export async function fetchActiveOrdersForDriver(supabase, driverId) {
  if (!supabase || !driverId) return [];

  const [pRes, tRes, uRes, shRes] = await Promise.all([
    supabase
      .from('customer_delivery_orders')
      .select('*')
      .eq('assigned_driver_id', driverId)
      .eq('status', 'assigned')
      .order('assigned_at', { ascending: false })
      .limit(30),
    supabase
      .from('taxi_bookings')
      .select('*')
      .eq('assigned_driver_id', driverId)
      .eq('status', 'confirmed')
      .order('assigned_at', { ascending: false })
      .limit(30),
    supabase
      .from('tuk_tuk_bookings')
      .select('*')
      .eq('assigned_driver_id', driverId)
      .eq('status', 'confirmed')
      .order('assigned_at', { ascending: false })
      .limit(30),
    supabase
      .from('shop_customer_orders')
      .select('*')
      .eq('assigned_driver_id', driverId)
      .in('status', ['ready for delivery', 'picked up', 'in transit'])
      .order('assigned_at', { ascending: false })
      .limit(30),
  ]);

  if (pRes.error || tRes.error || uRes.error || shRes.error) return [];

  /** @type {NormalizedDriverOffer[]} */
  const offers = [];

  for (const row of pRes.data || []) {
    offers.push({
      table: 'customer_delivery_orders',
      kind: 'parcel',
      id: row.id,
      ref: shortBookingRef(row.id),
      from: row.pickup_location || '—',
      to: row.dropoff_location || '—',
      dist: [row.distance_estimate, row.eta_text].map((x) => String(x || '').trim()).filter(Boolean).join(' · ') || '—',
      eta: row.eta_text || row.distance_estimate || '—',
      pkg: [row.package_category, row.package_size].filter(Boolean).join(' · ') || 'Delivery',
      amount: getAgreedFare(row) ?? getCustomerOfferAmount(row),
      created_at: row.created_at,
      customerPayment: customerPaymentLabelFromRow(row),
      raw: row,
    });
  }

  for (const [rows, table, kind] of [
    [tRes.data, 'taxi_bookings', 'taxi'],
    [uRes.data, 'tuk_tuk_bookings', 'tuktuk'],
  ]) {
    for (const row of rows || []) {
      offers.push({
        table,
        kind,
        id: row.id,
        ref: shortBookingRef(row.id),
        from: row.pickup_location || '—',
        to: row.destination_location || '—',
        dist: row.estimated_distance_label || '—',
        eta: row.estimated_duration_label || '—',
        pkg: kind === 'tuktuk' ? 'Tuk-Tuk' : 'Taxi',
        amount: getAgreedFare(row) ?? getCustomerOfferAmount(row),
        created_at: row.created_at,
        customerPayment: customerPaymentLabelFromRow(row),
        raw: row,
      });
    }
  }

  for (const row of shRes.data || []) {
    offers.push({
      table: 'shop_customer_orders',
      kind: 'shop',
      id: row.id,
      ref: String(row.order_number || shortBookingRef(row.id)),
      from: row.shop_pickup_address || row.pickup_address || 'Shop pickup',
      to: row.customer_address || '—',
      dist: '—',
      eta: '—',
      pkg: 'Shop order',
      amount: Number(row.subtotal) || 0,
      created_at: row.placed_at,
      customerPayment: '—',
      raw: row,
    });
  }

  offers.sort((a, b) => {
    const ta = new Date(a.raw?.assigned_at || a.created_at || 0).getTime();
    const tb = new Date(b.raw?.assigned_at || b.created_at || 0).getTime();
    return tb - ta;
  });

  return offers.map((offer) => {
    const assignedAt = offer.raw?.assigned_at || offer.created_at;
    return {
      id: offer.ref,
      from: offer.from,
      to: offer.to,
      pkg: offer.pkg,
      amount: offer.amount,
      lineStatus: activeJobLineStatus(offer.raw, offer.kind),
      lineTime: formatOfferTime(assignedAt),
      order: offerToActiveDeliveryOrder(offer),
    };
  });
}

export function formatOfferTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

/** Jobs where the customer accepted THIS driver's bid but the driver hasn't started navigating yet. */
const BID_ACCEPTED_MAX_AGE_MS = 30 * 60 * 1000;

const DRIVER_LEFT_ACCEPTED_DELIVERY_KEY = 'driver_left_accepted_delivery';
const DRIVER_AUTO_OPENED_ACCEPTED_KEY = 'driver_auto_opened_accepted';

function acceptedDeliverySessionKey(table, id) {
  return `${String(table || '')}:${String(id || '')}`;
}

/** Driver tapped Back from the accepted-bid delivery screen — do not auto-open it again. */
export function markDriverLeftAcceptedDelivery(table, id) {
  const k = acceptedDeliverySessionKey(table, id);
  if (!k || k === ':') return;
  try {
    sessionStorage.setItem(`${DRIVER_LEFT_ACCEPTED_DELIVERY_KEY}:${k}`, '1');
  } catch {
    /* ignore */
  }
}

export function driverHasLeftAcceptedDelivery(table, id) {
  const k = acceptedDeliverySessionKey(table, id);
  if (!k || k === ':') return false;
  try {
    return sessionStorage.getItem(`${DRIVER_LEFT_ACCEPTED_DELIVERY_KEY}:${k}`) === '1';
  } catch {
    return false;
  }
}

export function markDriverAutoOpenedAcceptedDelivery(table, id) {
  const k = acceptedDeliverySessionKey(table, id);
  if (!k || k === ':') return;
  try {
    sessionStorage.setItem(`${DRIVER_AUTO_OPENED_ACCEPTED_KEY}:${k}`, '1');
  } catch {
    /* ignore */
  }
}

export function driverHasAutoOpenedAcceptedDelivery(table, id) {
  const k = acceptedDeliverySessionKey(table, id);
  if (!k || k === ':') return false;
  try {
    return sessionStorage.getItem(`${DRIVER_AUTO_OPENED_ACCEPTED_KEY}:${k}`) === '1';
  } catch {
    return false;
  }
}

/**
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string} driverId
 * @returns {Promise<NormalizedDriverOffer[]>}
 */
export async function fetchBidAcceptedJobsForDriver(supabase, driverId) {
  if (!supabase || !driverId) return [];

  const [pRes, tRes, uRes] = await Promise.all([
    supabase
      .from('customer_delivery_orders')
      .select('*')
      .eq('assigned_driver_id', driverId)
      .eq('bid_status', 'matched')
      .eq('status', 'assigned')
      .order('assigned_at', { ascending: false })
      .limit(10),
    supabase
      .from('taxi_bookings')
      .select('*')
      .eq('assigned_driver_id', driverId)
      .eq('bid_status', 'matched')
      .eq('status', 'confirmed')
      .order('assigned_at', { ascending: false })
      .limit(10),
    supabase
      .from('tuk_tuk_bookings')
      .select('*')
      .eq('assigned_driver_id', driverId)
      .eq('bid_status', 'matched')
      .eq('status', 'confirmed')
      .order('assigned_at', { ascending: false })
      .limit(10),
  ]);

  const now = Date.now();
  const fresh = (r) => {
    if (r.driver_nav_leg) return false;
    const t = new Date(r.assigned_at || 0).getTime();
    return Number.isFinite(t) && now - t <= BID_ACCEPTED_MAX_AGE_MS;
  };

  const out = [];

  for (const row of (pRes.data || []).filter(fresh)) {
    out.push({
      table: 'customer_delivery_orders',
      kind: 'parcel',
      id: row.id,
      ref: shortBookingRef(row.id),
      from: row.pickup_location || '—',
      to: row.dropoff_location || '—',
      dist: [row.distance_estimate, row.eta_text].map((x) => String(x || '').trim()).filter(Boolean).join(' · ') || '—',
      eta: row.eta_text || row.distance_estimate || '—',
      pkg: [row.package_category, row.package_size].filter(Boolean).join(' · ') || 'Delivery',
      amount: getAgreedFare(row) ?? getCustomerOfferAmount(row),
      created_at: row.created_at,
      customerPayment: customerPaymentLabelFromRow(row),
      raw: row,
    });
  }

  for (const [rows, table, kind] of [
    [tRes.data, 'taxi_bookings', 'taxi'],
    [uRes.data, 'tuk_tuk_bookings', 'tuktuk'],
  ]) {
    for (const row of (rows || []).filter(fresh)) {
      out.push({
        table,
        kind,
        id: row.id,
        ref: shortBookingRef(row.id),
        from: row.pickup_location || '—',
        to: row.destination_location || '—',
        dist: row.estimated_distance_label || '—',
        eta: row.estimated_duration_label || '—',
        pkg: kind === 'tuktuk' ? 'Tuk-Tuk' : 'Taxi',
        amount: getAgreedFare(row) ?? getCustomerOfferAmount(row),
        created_at: row.created_at,
        customerPayment: customerPaymentLabelFromRow(row),
        raw: row,
      });
    }
  }

  out.sort((a, b) => {
    const ta = new Date(a.raw?.assigned_at || 0).getTime();
    const tb = new Date(b.raw?.assigned_at || 0).getTime();
    return tb - ta;
  });

  return out;
}

const TABLES_WITH_PASSENGER = new Set([
  'customer_delivery_orders',
  'shop_customer_orders',
  'taxi_bookings',
  'tuk_tuk_bookings',
]);

/**
 * Load customer / rider name and phone from `app_users` via booking `app_user_id`.
 * @param {import('./supabaseClient').SupabaseClient | null} supabase
 * @param {string} table
 * @param {string} bookingId
 * @returns {Promise<{ full_name: string | null, phone: string | null }>}
 */
export async function fetchBookingCustomerContact(supabase, table, bookingId) {
  if (!supabase || !TABLES_WITH_PASSENGER.has(String(table)) || !bookingId) {
    return { full_name: null, phone: null };
  }
  if (String(table) === 'shop_customer_orders') {
    const { data: row, error } = await supabase
      .from('shop_customer_orders')
      .select('customer_full_name, customer_phone')
      .eq('id', bookingId)
      .maybeSingle();
    if (error || !row) return { full_name: null, phone: null };
    return {
      full_name: row.customer_full_name != null ? String(row.customer_full_name).trim() || null : null,
      phone: row.customer_phone != null ? String(row.customer_phone).trim() || null : null,
    };
  }
  const { data: row, error } = await supabase.from(table).select('app_user_id').eq('id', bookingId).maybeSingle();
  if (error || !row?.app_user_id) return { full_name: null, phone: null };
  const { data: u, error: uErr } = await supabase
    .from('app_users')
    .select('full_name, phone')
    .eq('id', row.app_user_id)
    .maybeSingle();
  if (uErr) return { full_name: null, phone: null };
  return { full_name: u?.full_name || null, phone: u?.phone || null };
}

/**
 * Mark a ride booking completed after the driver ends the journey (parcel has no matching status yet).
 * @param {import('./supabaseClient').SupabaseClient | null} supabase
 * @param {string} table
 * @param {string} bookingId
 * @param {string | null | undefined} [deliveryCode] Required for parcel deliveries when a code exists on the order.
 */
export async function markDriverBookingCompleted(supabase, table, bookingId, deliveryCode) {
  if (!supabase || !table || !bookingId) return { ok: false, error: 'Missing data.' };
  const now = new Date().toISOString();
  let driverId = null;
  let grossFare = 0;

  if (table === 'customer_delivery_orders') {
    const { data: row, error: selErr } = await supabase
      .from(table)
      .select('assigned_driver_id, total_amount, delivery_confirmation_code')
      .eq('id', bookingId)
      .maybeSingle();
    if (selErr) return { ok: false, error: selErr.message };
    driverId = row?.assigned_driver_id ? String(row.assigned_driver_id) : null;
    grossFare = Number(row?.total_amount) || 0;
    const expectedCode = normalizeDeliveryCodeInput(row?.delivery_confirmation_code);
    if (expectedCode) {
      const entered = normalizeDeliveryCodeInput(deliveryCode);
      if (!isCompleteDeliveryPin(entered, expectedCode)) {
        return { ok: false, error: DELIVERY_PIN_INCOMPLETE_ERROR };
      }
      if (!deliveryPinsMatch(entered, expectedCode)) {
        return { ok: false, error: DELIVERY_PIN_MISMATCH_ERROR };
      }
    }
    const { error } = await supabase
      .from(table)
      .update({ status: 'delivered', completed_at: now, delivery_confirmed_at: now })
      .eq('id', bookingId);
    if (error) return { ok: false, error: error.message };
  } else if (table === 'shop_customer_orders') {
    const { data: row, error: selErr } = await supabase
      .from(table)
      .select('assigned_driver_id, subtotal, delivery_confirmation_code')
      .eq('id', bookingId)
      .maybeSingle();
    if (selErr) return { ok: false, error: selErr.message };
    driverId = row?.assigned_driver_id ? String(row.assigned_driver_id) : null;
    grossFare = Number(row?.subtotal) || 0;
    const expectedCode = normalizeDeliveryCodeInput(row?.delivery_confirmation_code);
    if (expectedCode) {
      const entered = normalizeDeliveryCodeInput(deliveryCode);
      if (!isCompleteDeliveryPin(entered, expectedCode)) {
        return { ok: false, error: DELIVERY_PIN_INCOMPLETE_ERROR };
      }
      if (!deliveryPinsMatch(entered, expectedCode)) {
        return { ok: false, error: DELIVERY_PIN_MISMATCH_ERROR };
      }
    }
    const patch = { status: 'delivered', completed_at: now };
    if (expectedCode) patch.delivery_confirmed_at = now;
    const { error } = await supabase.from(table).update(patch).eq('id', bookingId);
    if (error) return { ok: false, error: error.message };
  } else if (table === 'taxi_bookings' || table === 'tuk_tuk_bookings') {
    const { data: row, error: selErr } = await supabase
      .from(table)
      .select('assigned_driver_id, quoted_price')
      .eq('id', bookingId)
      .maybeSingle();
    if (selErr) return { ok: false, error: selErr.message };
    driverId = row?.assigned_driver_id ? String(row.assigned_driver_id) : null;
    grossFare = Number(row?.quoted_price) || 0;
    const { error } = await supabase.from(table).update({ status: 'completed', completed_at: now }).eq('id', bookingId);
    if (error) return { ok: false, error: error.message };
  } else {
    return { ok: true };
  }

  if (driverId) {
    await deductDriverDepositAfterJob(supabase, driverId, grossFare);
  }
  return { ok: true };
}

/**
 * Whether a completed job row is cash-on-delivery / pay-driver-in-cash (`payment_method === 'cod'`).
 * @param {{ payment_method?: string | null }} row
 */
export function isCodDriverCompletedJob(row) {
  return String(row?.payment_method ?? '')
    .toLowerCase()
    .trim() === 'cod';
}

/**
 * Completed jobs for driver earnings / history (parcel `delivered`, rides `completed`).
 * @param {import('./supabaseClient').SupabaseClient | null} supabase
 * @param {string} driverId
 * @returns {Promise<Array<{ id: string, ref: string, to: string, amount: number, kind: string, at: string, payment_method?: string }>>}
 */
export async function fetchCompletedDeliveriesForDriver(supabase, driverId) {
  if (!supabase || !driverId) return [];

  const [pRes, tRes, uRes, shRes] = await Promise.all([
    supabase
      .from('customer_delivery_orders')
      .select('id, dropoff_location, total_amount, status, created_at, completed_at, payment_method')
      .eq('assigned_driver_id', driverId)
      .eq('status', 'delivered')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('taxi_bookings')
      .select('*')
      .eq('assigned_driver_id', driverId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('tuk_tuk_bookings')
      .select('*')
      .eq('assigned_driver_id', driverId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('shop_customer_orders')
      .select('id, customer_address, subtotal, status, placed_at, completed_at, order_number')
      .eq('assigned_driver_id', driverId)
      .eq('status', 'delivered')
      .order('placed_at', { ascending: false })
      .limit(200),
  ]);

  if (pRes.error || tRes.error || uRes.error || shRes.error) return [];

  const rows = [];
  for (const r of pRes.data || []) {
    const at = r.completed_at || r.created_at;
    rows.push({
      id: r.id,
      ref: shortBookingRef(r.id),
      to: r.dropoff_location || '—',
      amount: Number(r.total_amount) || 0,
      kind: 'parcel',
      at,
      payment_method: r.payment_method != null ? String(r.payment_method) : '',
    });
  }
  for (const r of tRes.data || []) {
    const at = r.completed_at || r.created_at;
    rows.push({
      id: r.id,
      ref: shortBookingRef(r.id),
      to: r.destination_location || '—',
      amount: Number(r.quoted_price) || 0,
      kind: 'taxi',
      at,
      payment_method: r.payment_method != null ? String(r.payment_method) : '',
    });
  }
  for (const r of uRes.data || []) {
    const at = r.completed_at || r.created_at;
    rows.push({
      id: r.id,
      ref: shortBookingRef(r.id),
      to: r.destination_location || '—',
      amount: Number(r.quoted_price) || 0,
      kind: 'tuktuk',
      at,
      payment_method: r.payment_method != null ? String(r.payment_method) : '',
    });
  }
  for (const r of shRes.data || []) {
    const at = r.completed_at || r.placed_at;
    rows.push({
      id: r.id,
      ref: String(r.order_number || shortBookingRef(r.id)),
      to: r.customer_address || '—',
      amount: Number(r.subtotal) || 0,
      kind: 'shop',
      at,
      payment_method: '',
    });
  }

  rows.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
  return rows;
}

/**
 * Map a normalized driver offer to the active-delivery screen shape (parcel, taxi, or tuk-tuk).
 * @param {NormalizedDriverOffer} offer
 */
function shopOrderSpecialInstructions(r) {
  const notes = String(r.customer_notes || '').trim();
  const shop = String(r._shop_business_name || '').trim();
  const head = shop ? `Collect order from: ${shop}` : 'Collect order from shop.';
  return [head, notes].filter(Boolean).join('\n\n');
}

function parcelSpecialInstructions(r) {
  const notes = String(r.package_notes || '').trim();
  const stops = Array.isArray(r.extra_stops) ? r.extra_stops : [];
  const lines = stops
    .map((s) => String(s?.address ?? s?.value ?? '').trim())
    .filter(Boolean);
  const extra = lines.length ? `Extra stops (in order): ${lines.join(' → ')}` : '';
  return [notes, extra].filter(Boolean).join('\n\n');
}

export function offerToActiveDeliveryOrder(offer) {
  const r = offer.raw || {};
  const isShop = offer.table === 'shop_customer_orders';
  const pkgDefault = isShop ? offer.pkg || 'Shop order' : offer.kind === 'parcel' ? (r.package_size || '—') : offer.pkg;
  const typeDefault = isShop ? 'Shop delivery' : offer.kind === 'parcel' ? (r.package_category || 'Delivery') : offer.pkg;
  return {
    id: offer.ref,
    supabaseOrderId: offer.id,
    bookingTable: offer.table,
    bookingKind: isShop ? 'shop' : offer.kind,
    from: offer.from,
    to: offer.to,
    dist: offer.dist,
    eta: offer.eta,
    distDrop: offer.dist,
    etaDrop: offer.eta,
    pkg: isShop ? offer.pkg || 'Shop order' : offer.kind === 'parcel' ? pkgDefault : offer.pkg,
    type: typeDefault,
    size: isShop ? 'Shop' : offer.kind === 'parcel' ? r.package_size || '' : undefined,
    packageWeight: !isShop && offer.kind === 'parcel' ? r.package_weight || '' : undefined,
    amount: offer.amount,
    customerName: 'Customer',
    customerPhone: '',
    customerPayment: offer.customerPayment ?? customerPaymentLabelFromRow(r),
    payment_method: r.payment_method != null ? String(r.payment_method) : '',
    specialInstructions: isShop ? shopOrderSpecialInstructions(r) : offer.kind === 'parcel' ? parcelSpecialInstructions(r) : String(r.package_notes || ''),
    packagePhotoDataUrl:
      !isShop && offer.kind === 'parcel' && typeof r.package_photo_data_url === 'string'
        ? r.package_photo_data_url
        : null,
    driverPackagePhotoDataUrl:
      !isShop && offer.kind === 'parcel' && typeof r.driver_package_photo_data_url === 'string'
        ? r.driver_package_photo_data_url
        : null,
  };
}

/**
 * After drop-off / end journey, show collect-cash step before rating (COD on parcel, taxi, or Tuk-Tuk).
 * @param {Record<string, unknown>} order active delivery / navigation order state
 */
export function driverOrderNeedsCashCollectionScreen(order) {
  if (!order || typeof order !== 'object') return false;
  const table = String(order.bookingTable || '');
  const kind = String(order.bookingKind || '');
  const isParcelCod = table === 'customer_delivery_orders';
  const isRide =
    table === 'taxi_bookings' || table === 'tuk_tuk_bookings' || kind === 'taxi' || kind === 'tuktuk';
  if (!isParcelCod && !isRide) return false;
  const pm = String(order.payment_method || '')
    .toLowerCase()
    .trim();
  if (pm === 'cod') return true;
  if (isCashCustomerPayment(order.customerPayment)) return true;
  return false;
}

/**
 * @param {NormalizedDriverOffer} offer
 * @deprecated Prefer `offerToActiveDeliveryOrder` (same behaviour, all booking kinds).
 */
export function parcelOfferToActiveOrder(offer) {
  return offerToActiveDeliveryOrder(offer);
}

/**
 * @param {import('./supabaseClient').SupabaseClient | null} supabase
 * @param {NormalizedDriverOffer} offer
 * @param {string} driverId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function recordDriverViewedOffer(supabase, offer, driverId) {
  if (!supabase || !driverId || !offer?.id || !offer.table) return { ok: false, error: 'Missing data.' };
  const t = supabase.from(offer.table);
  const { data: cur, error: rErr } = await t.select('viewed_driver_ids').eq('id', offer.id).maybeSingle();
  if (rErr) {
    if (/viewed_driver_ids/i.test(rErr.message || '') || /column/i.test(rErr.message || '')) {
      console.warn(
        '[driversSeen] viewed_driver_ids column missing — run supabase/booking_viewed_driver_ids.sql in the Supabase SQL editor.',
        rErr.message,
      );
    } else {
      console.warn('[driversSeen] could not read viewed_driver_ids', rErr.message);
    }
    return { ok: false, error: rErr.message };
  }
  const prev = Array.isArray(cur?.viewed_driver_ids) ? cur.viewed_driver_ids : [];
  if (prev.some((x) => String(x) === String(driverId))) return { ok: true };
  const next = [...prev, driverId];
  const { error } = await t.update({ viewed_driver_ids: next }).eq('id', offer.id);
  if (error) {
    console.warn('[driversSeen] could not save view', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * @param {import('./supabaseClient').SupabaseClient | null} supabase
 * @param {NormalizedDriverOffer} offer
 * @param {string} driverId
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function driverRejectOffer(supabase, offer, driverId) {
  if (!supabase || !driverId || !offer?.id || !offer.table) return { ok: false, error: 'Missing data.' };
  const t = supabase.from(offer.table);
  const { data: cur, error: rErr } = await t.select('rejected_driver_ids').eq('id', offer.id).maybeSingle();
  if (rErr) return { ok: false, error: rErr.message };
  const prev = Array.isArray(cur?.rejected_driver_ids) ? cur.rejected_driver_ids : [];
  if (prev.some((x) => String(x) === String(driverId))) return { ok: true };
  const next = [...prev, driverId];
  const { error } = await t.update({ rejected_driver_ids: next }).eq('id', offer.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * @param {import('./supabaseClient').SupabaseClient | null} supabase
 * @param {NormalizedDriverOffer} offer
 * @param {string} driverId
 * @param {string | null | undefined} [driverVehicleType]
 * @returns {Promise<{ ok: boolean, error?: string, taken?: boolean, pending?: boolean, fare?: number, bidId?: string, already?: boolean }>}
 */
export async function driverAcceptOffer(supabase, offer, driverId, driverVehicleType) {
  if (!supabase || !driverId || !offer?.id || !offer.table) return { ok: false, error: 'Missing data.' };

  const approval = await assertDriverCanWork(supabase, driverId);
  if (!approval.ok) return { ok: false, error: approval.error };

  if (offer.table === 'customer_delivery_orders') {
    if (!canDriverTakeParcelDelivery(offer.raw || {}, driverVehicleType)) {
      return { ok: false, error: 'This parcel does not match your vehicle type or capacity.', taken: true };
    }
    return driverAcceptCustomerOffer(supabase, 'customer_delivery_orders', offer.id, driverId);
  }

  if (offer.table === 'shop_customer_orders') {
    if (!canDriverTakeShopDelivery(driverVehicleType)) {
      return {
        ok: false,
        error: 'Set your vehicle type on your driver profile to accept deliveries.',
        taken: true,
      };
    }
    const claimed = await claimOpenBooking(
      supabase,
      'shop_customer_orders',
      offer.id,
      driverId,
      {},
      { status: 'ready for delivery' },
    );
    if (!claimed.ok) {
      return {
        ok: false,
        taken: claimed.taken,
        error: claimed.taken ? ORDER_ALREADY_ACCEPTED_MSG : claimed.error || 'Could not accept this order.',
      };
    }
    return { ok: true };
  }

  if (offer.table === 'taxi_bookings' || offer.table === 'tuk_tuk_bookings') {
    if (rideCardPaymentPending(offer.raw || {})) {
      return { ok: false, error: 'This ride is still awaiting online payment.', taken: true };
    }
    if (offer.table === 'taxi_bookings') {
      const { data: row, error: fetchErr } = await supabase
        .from('taxi_bookings')
        .select('vehicle_type')
        .eq('id', offer.id)
        .maybeSingle();
      if (fetchErr) return { ok: false, error: fetchErr.message };
      if (!canDriverTakeTaxiBooking(row || {}, driverVehicleType)) {
        return { ok: false, error: 'This request requires a different vehicle type.', taken: true };
      }
    }
    return driverAcceptCustomerOffer(supabase, offer.table, offer.id, driverId);
  }

  return { ok: false, error: 'Unknown booking type.' };
}

export { ORDER_ALREADY_ACCEPTED_MSG, verifyDriverOwnsBooking };
