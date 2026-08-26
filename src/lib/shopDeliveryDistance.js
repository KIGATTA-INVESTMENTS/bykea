import { isInServiceArea } from './googleMapsConfig';
import { forwardGeocodeAddress } from './reverseGeocode';
import { estimateRoadKm, haversineKm } from './routeEstimate';

/**
 * Local shop deliveries shouldn't bill cross-city distances from bad geocodes.
 * Beyond this, checkout asks the customer to refine the address.
 */
export const MAX_SHOP_DELIVERY_ROAD_KM = 40;

/**
 * Straight-line km between two points, scaled to approximate road distance.
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 */
export function roadKmBetween(a, b) {
  const straight = haversineKm(a.lat, a.lng, b.lat, b.lng);
  if (straight == null) return null;
  return estimateRoadKm(straight);
}

/**
 * @param {{ lat: number, lng: number } | null | undefined} pt
 * @returns {pt is { lat: number, lng: number }}
 */
function isUsablePoint(pt) {
  return (
    pt != null &&
    Number.isFinite(Number(pt.lat)) &&
    Number.isFinite(Number(pt.lng)) &&
    isInServiceArea(Number(pt.lat), Number(pt.lng))
  );
}

/**
 * Sum of shop → customer legs (one per unique shop in cart).
 * @param {import('./supabaseClient').SupabaseClient} supabase
 * @param {string[]} shopOwnerIds
 * @param {string} customerAddress
 * @param {{ lat: number, lng: number } | null} [customerLatLng] Prefer known coords from address pick.
 */
export async function computeShopCartDeliveryKm(supabase, shopOwnerIds, customerAddress, customerLatLng = null) {
  const ids = [...new Set((shopOwnerIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const addr = String(customerAddress || '').trim();
  if (!ids.length) {
    return { ok: false, km: null, error: 'No shop in cart.' };
  }
  if (!addr || addr.length < 6) {
    return { ok: false, km: null, error: 'Enter your delivery address to calculate delivery.' };
  }

  let dest = isUsablePoint(customerLatLng) ? { lat: Number(customerLatLng.lat), lng: Number(customerLatLng.lng) } : null;
  if (!dest) {
    const geocoded = await forwardGeocodeAddress(addr);
    if (!geocoded) {
      return { ok: false, km: null, error: 'Could not find that delivery address on the map.' };
    }
    if (!isInServiceArea(geocoded.lat, geocoded.lng)) {
      return {
        ok: false,
        km: null,
        error: 'Delivery address must be within our Zimbabwe service area. Pick a more specific address.',
      };
    }
    dest = geocoded;
  }

  const { data: shops, error: qErr } = await supabase
    .from('shop_owners')
    .select('id, business_name, business_address')
    .in('id', ids);

  if (qErr) {
    return { ok: false, km: null, error: qErr.message || 'Could not load shop locations.' };
  }

  const rows = Array.isArray(shops) ? shops : [];
  if (!rows.length) {
    return { ok: false, km: null, error: 'Shop address not found.' };
  }

  let totalKm = 0;
  const missing = [];

  for (const shop of rows) {
    const shopAddr = String(shop.business_address || '').trim();
    if (!shopAddr) {
      missing.push(shop.business_name || shop.id);
      continue;
    }
    const origin = await forwardGeocodeAddress(shopAddr);
    if (!origin || !isInServiceArea(origin.lat, origin.lng)) {
      missing.push(shop.business_name || shop.id);
      continue;
    }
    const leg = roadKmBetween(origin, dest);
    if (leg == null || !Number.isFinite(leg) || leg < 0) {
      missing.push(shop.business_name || shop.id);
      continue;
    }
    totalKm += leg;
  }

  if (missing.length === rows.length) {
    return {
      ok: false,
      km: null,
      error: 'Could not map shop or delivery address. Check addresses and try again.',
    };
  }

  const km = Math.round(totalKm * 100) / 100;

  if (km > MAX_SHOP_DELIVERY_ROAD_KM) {
    return {
      ok: false,
      km: null,
      error: `Delivery is only available within about ${MAX_SHOP_DELIVERY_ROAD_KM} km of the shop (calculated ~${km.toFixed(0)} km). Choose a closer address or contact the shop.`,
    };
  }

  if (missing.length > 0) {
    return {
      ok: true,
      km,
      partial: true,
      warning: `Distance excludes ${missing.length} shop(s) without a mappable address.`,
    };
  }

  return { ok: true, km, partial: false };
}
