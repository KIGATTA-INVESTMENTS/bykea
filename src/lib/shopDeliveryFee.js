import { deliveryFeeFromDistanceKm, shopDeliveryPricingFromSettings } from './shopDeliverySettings';

/**
 * @param {number | null | undefined} roadKm Billable road distance (km).
 * @param {import('./shopDeliverySettings').ShopDeliverySettingsRow | null | undefined} settingsRow
 */
export function computeShopDeliveryFee(roadKm, settingsRow) {
  const perKm = shopDeliveryPricingFromSettings(settingsRow);
  return deliveryFeeFromDistanceKm(roadKm, perKm);
}

/**
 * Human-readable fee breakdown for checkout.
 * @param {number | null | undefined} roadKm
 * @param {import('./shopDeliverySettings').ShopDeliverySettingsRow | null | undefined} settingsRow
 */
export function shopDeliveryFeeBreakdown(roadKm, settingsRow) {
  const perKm = shopDeliveryPricingFromSettings(settingsRow);
  const fee = deliveryFeeFromDistanceKm(roadKm, perKm);
  const km = Number.isFinite(roadKm) && roadKm > 0 ? roadKm : null;
  return { fee, perKm, km };
}
