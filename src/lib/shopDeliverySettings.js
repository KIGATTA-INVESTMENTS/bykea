import { effectiveBillableKm } from './routeEstimate';

/** Singleton row PK for `shop_delivery_settings`. */
export const SHOP_DELIVERY_SETTINGS_ID = 1;

/**
 * Guard against legacy flat fees being mis-copied into per-km columns
 * (e.g. backfill with `coalesce(..., delivery_fee)` producing $50–$100 “per km”).
 */
export const MAX_REASONABLE_SHOP_PER_KM_USD = 15;

/** Sensible default when admin rate is missing or corrupt. */
export const DEFAULT_SHOP_PER_KM_USD = 1;

/**
 * @param {import('./supabaseClient').SupabaseClient | null} supabase
 * @returns {Promise<{ data: ShopDeliverySettingsRow | null, error: Error | null }>}
 */
export async function fetchShopDeliverySettings(supabase) {
  if (!supabase) return { data: null, error: new Error('Supabase client missing') };
  const { data, error } = await supabase
    .from('shop_delivery_settings')
    .select('delivery_fee, delivery_fee_per_km, price_per_km, currency, updated_at')
    .eq('id', SHOP_DELIVERY_SETTINGS_ID)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data, error: null };
}

/**
 * @typedef {{ delivery_fee?: number | null, delivery_fee_per_km?: number | null, price_per_km?: number | null, currency?: string, updated_at?: string }} ShopDeliverySettingsRow
 */

/**
 * Prefer an explicit per-km column; ignore legacy flat `delivery_fee`.
 * If one column is absurd (> MAX) and the other is fine, use the fine one.
 * @param {ShopDeliverySettingsRow | null | undefined} data
 */
export function shopDeliveryPricingFromSettings(data) {
  const a = Number(data?.delivery_fee_per_km);
  const b = Number(data?.price_per_km);
  const aOk = Number.isFinite(a) && a >= 0;
  const bOk = Number.isFinite(b) && b >= 0;
  const aSane = aOk && a <= MAX_REASONABLE_SHOP_PER_KM_USD;
  const bSane = bOk && b <= MAX_REASONABLE_SHOP_PER_KM_USD;

  if (aSane && bSane) {
    // Prefer the dedicated shop column; both are normally kept in sync by admin save.
    return a;
  }
  if (aSane) return a;
  if (bSane) return b;
  // Both missing / absurd — never treat legacy flat delivery_fee as a per-km rate.
  return DEFAULT_SHOP_PER_KM_USD;
}

/**
 * Delivery charge from billable road distance (km).
 * @param {number | null | undefined} roadKm
 * @param {number} perKm
 */
export function deliveryFeeFromDistanceKm(roadKm, perKm) {
  if (!Number.isFinite(perKm) || perKm < 0) return 0;
  const billable = Number.isFinite(roadKm) && roadKm > 0 ? effectiveBillableKm(roadKm, 0.5) : 0;
  if (billable <= 0) return 0;
  const raw = billable * perKm;
  return Math.round(raw * 100) / 100;
}

/** @deprecated Flat fee — use deliveryFeeFromDistanceKm at checkout. */
export function deliveryFeeFromSettings(data) {
  const n = Number(data?.delivery_fee);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Grand total for a shop_customer_orders row (subtotal + recorded delivery). */
export function shopOrderGrandTotal(row) {
  return (Number(row?.subtotal) || 0) + (Number(row?.delivery_fee) || 0);
}
