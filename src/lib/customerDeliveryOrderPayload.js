import { getCustomerSession } from './customerSession';
import { generateDeliveryConfirmationCode } from './deliveryConfirmationCode';

function orderRouteSnapshot(order) {
  const pickup = String(order.pickup || order.from || '').trim();
  const stops = Array.isArray(order.stops) ? order.stops : [];
  const dropTexts = stops.map((s) => String(s?.value ?? '').trim()).filter(Boolean);
  const dropoff = dropTexts[0] || String(order.to || '').trim();
  const extraStops = dropTexts.slice(1).map((address) => ({ address }));
  return {
    pickupLocation: pickup || '—',
    dropoffLocation: dropoff || String(order.to || '').trim() || '—',
    extraStops,
  };
}

/** @param {string | null | undefined} uuid */
export function deliveryOrderDisplayRef(uuid) {
  if (!uuid) return 'ING-00234';
  const short = String(uuid).replace(/-/g, '').slice(0, 10).toUpperCase();
  return `ING-${short}`;
}

/**
 * Row for `customer_delivery_orders` insert (matches Select Payment / checkout snapshot).
 * @param {Record<string, unknown>} order - delivery flow `location.state`
 * @param {'ecocash' | 'card' | 'cod' | 'stripe' | 'wallet'} paymentMethod
 * @param {string | null} [appUserId] Verified user id; omit to use cached session id.
 */
export function buildCustomerDeliveryOrderRow(order, paymentMethod, appUserId) {
  const { pickupLocation, dropoffLocation, extraStops } = orderRouteSnapshot(order);
  const pkg = order.package || {};
  const session = getCustomerSession();
  const linkedUserId = appUserId !== undefined ? appUserId : session?.id ?? null;
  const total = typeof order.priceNum === 'number' ? order.priceNum : 0;
  const minimum =
    typeof order.minimumFareAmount === 'number' && order.minimumFareAmount > 0
      ? order.minimumFareAmount
      : total;
  const customerOffer =
    typeof order.customerOfferAmount === 'number' && order.customerOfferAmount >= minimum
      ? order.customerOfferAmount
      : total;

  const baseFare = Number(order.priceBreakdownBase);
  const distFee = Number(order.priceBreakdownDistance);
  const timeFee = Number(order.priceBreakdownTime);
  const svcFee = Number(order.priceBreakdownService);

  return {
    delivery_request_id: order.deliveryRequestId ?? null,
    app_user_id: linkedUserId,
    pickup_location: pickupLocation,
    dropoff_location: dropoffLocation,
    extra_stops: extraStops,
    delivery_type: String(order.deliveryType || 'standard'),
    distance_estimate:
      order.distanceKm != null ? String(order.distanceKm) : order.distance != null ? String(order.distance) : null,
    package_size: pkg.size ?? null,
    package_weight: typeof pkg.weight === 'string' ? pkg.weight.trim() || null : pkg.weight ?? null,
    package_category: pkg.type ?? null,
    package_notes: typeof pkg.notes === 'string' ? pkg.notes.trim() || null : pkg.notes ?? null,
    package_photo_filename: typeof pkg.fileName === 'string' ? pkg.fileName.trim() || null : pkg.fileName ?? null,
    package_photo_data_url:
      typeof pkg.photoDataUrl === 'string' && pkg.photoDataUrl.startsWith('data:image/')
        ? pkg.photoDataUrl
        : null,
    requested_vehicle_type:
      typeof pkg.requestedVehicleType === 'string' && pkg.requestedVehicleType.trim()
        ? pkg.requestedVehicleType.trim()
        : 'Motorbike',
    base_fare_amount: Number.isFinite(baseFare) ? baseFare : 0,
    distance_fee_amount: Number.isFinite(distFee) ? distFee : 0,
    time_fee_amount: Number.isFinite(timeFee) ? timeFee : 0,
    service_fee_amount: Number.isFinite(svcFee) ? svcFee : 0,
    total_amount: customerOffer,
    minimum_fare_amount: minimum,
    customer_offer_amount: customerOffer,
    bid_status: 'open',
    currency: 'USD',
    payment_method: paymentMethod,
    delivery_title: order.deliveryTitle ?? null,
    eta_text: order.eta ?? null,
    scheduled_for: order.scheduledFor ?? null,
    status: 'placed',
    delivery_confirmation_code: generateDeliveryConfirmationCode(),
  };
}
