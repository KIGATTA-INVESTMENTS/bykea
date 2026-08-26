import { haversineKm } from './routeEstimate';
import { isReliableGpsLatLng } from './googleMapsConfig';

/** Driver location is fresh within this window. */
export const NEARBY_DRIVER_FRESH_MS = 5 * 60 * 1000;

/** Default search radius around the customer. */
export const NEARBY_DRIVER_RADIUS_KM = 20;

const BOOKING_LIVE_SOURCES = [
  'customer_delivery_orders',
  'taxi_bookings',
  'tuk_tuk_bookings',
  'shop_customer_orders',
];

/**
 * @typedef {object} NearbyDriver
 * @property {string} id
 * @property {string} name
 * @property {string} vehicleType
 * @property {number} lat
 * @property {number} lng
 * @property {number} distanceKm
 * @property {string} updatedAt
 */

/**
 * @param {Map<string, NearbyDriver>} out
 * @param {{ id: string, full_name?: string, vehicle_type?: string, driver_live_lat?: number, driver_live_lng?: number, driver_live_updated_at?: string }} row
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusKm
 */
function addDriverIfNearby(out, row, lat, lng, radiusKm) {
  const dLat = Number(row.driver_live_lat);
  const dLng = Number(row.driver_live_lng);
  if (!isReliableGpsLatLng(dLat, dLng)) return;
  const dist = haversineKm(lat, lng, dLat, dLng);
  if (dist == null || dist > radiusKm) return;
  const id = String(row.id || '');
  if (!id) return;
  const prev = out.get(id);
  const updatedAt = String(row.driver_live_updated_at || '');
  if (prev && new Date(prev.updatedAt).getTime() >= new Date(updatedAt).getTime()) return;
  out.set(id, {
    id,
    name: String(row.full_name || 'Driver').trim() || 'Driver',
    vehicleType: String(row.vehicle_type || '').trim() || 'Motorbike',
    lat: dLat,
    lng: dLng,
    distanceKm: Math.round(dist * 10) / 10,
    updatedAt,
  });
}

/**
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {number} lat
 * @param {number} lng
 * @param {{ radiusKm?: number, maxAgeMs?: number }} [opts]
 * @returns {Promise<NearbyDriver[]>}
 */
export async function fetchNearbyDrivers(supabase, lat, lng, opts = {}) {
  if (!supabase || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const radiusKm = opts.radiusKm ?? NEARBY_DRIVER_RADIUS_KM;
  const maxAgeMs = opts.maxAgeMs ?? NEARBY_DRIVER_FRESH_MS;
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  /** @type {Map<string, NearbyDriver>} */
  const byId = new Map();

  const { data: regRows, error: regErr } = await supabase
    .from('driver_registrations')
    .select('id, full_name, vehicle_type, driver_live_lat, driver_live_lng, driver_live_updated_at, is_online')
    .eq('status', 'approved')
    .eq('is_online', true)
    .gte('driver_live_updated_at', cutoff)
    .not('driver_live_lat', 'is', null)
    .not('driver_live_lng', 'is', null)
    .limit(120);

  if (!regErr && Array.isArray(regRows)) {
    for (const row of regRows) addDriverIfNearby(byId, row, lat, lng, radiusKm);
  }

  // Supplement with drivers on active jobs broadcasting GPS (if idle pool is empty or columns missing).
  if (byId.size < 8) {
    const driverIds = new Set();
    const liveByDriver = new Map();

    await Promise.all(
      BOOKING_LIVE_SOURCES.map(async (table) => {
        const { data } = await supabase
          .from(table)
          .select('assigned_driver_id, driver_live_lat, driver_live_lng, driver_live_updated_at')
          .not('assigned_driver_id', 'is', null)
          .gte('driver_live_updated_at', cutoff)
          .not('driver_live_lat', 'is', null)
          .not('driver_live_lng', 'is', null)
          .order('driver_live_updated_at', { ascending: false })
          .limit(60);
        for (const row of data || []) {
          const did = String(row.assigned_driver_id || '');
          if (!did) continue;
          const at = new Date(row.driver_live_updated_at || 0).getTime();
          const prev = liveByDriver.get(did);
          if (prev && prev.at >= at) continue;
          liveByDriver.set(did, {
            at,
            lat: Number(row.driver_live_lat),
            lng: Number(row.driver_live_lng),
            updatedAt: row.driver_live_updated_at,
          });
          driverIds.add(did);
        }
      }),
    );

    if (driverIds.size) {
      const { data: drivers } = await supabase
        .from('driver_registrations')
        .select('id, full_name, vehicle_type')
        .in('id', [...driverIds])
        .eq('status', 'approved');
      const driverById = Object.fromEntries((drivers || []).map((d) => [String(d.id), d]));
      for (const [did, live] of liveByDriver) {
        const d = driverById[did];
        if (!d) continue;
        addDriverIfNearby(
          byId,
          {
            id: did,
            full_name: d.full_name,
            vehicle_type: d.vehicle_type,
            driver_live_lat: live.lat,
            driver_live_lng: live.lng,
            driver_live_updated_at: live.updatedAt,
          },
          lat,
          lng,
          radiusKm,
        );
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Heartbeat GPS while driver is online on the home dashboard.
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string} driverId
 * @param {number | null} lat
 * @param {number | null} lng
 * @param {boolean} online
 */
export async function publishDriverOnlineLocation(supabase, driverId, lat, lng, online) {
  if (!supabase || !driverId) return { ok: false };

  if (!online) {
    const { error } = await supabase
      .from('driver_registrations')
      .update({ is_online: false })
      .eq('id', driverId);
    return { ok: !error, error: error?.message };
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isReliableGpsLatLng(lat, lng)) {
    const { error } = await supabase
      .from('driver_registrations')
      .update({ is_online: true })
      .eq('id', driverId);
    return { ok: !error, error: error?.message };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('driver_registrations')
    .update({
      is_online: true,
      driver_live_lat: lat,
      driver_live_lng: lng,
      driver_live_updated_at: now,
    })
    .eq('id', driverId);

  return { ok: !error, error: error?.message };
}
