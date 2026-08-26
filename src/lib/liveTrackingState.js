import { deliveryOrderDisplayRef } from './customerDeliveryOrderPayload';
import { isStaleUnfinishedBooking } from './customerOrderCancel';

/**
 * Build React Router state for `/live-tracking` from checkout / confirmation payloads.
 * @param {Record<string, unknown>} order
 */
export function buildLiveTrackingState(order) {
  if (!order || typeof order !== 'object') return null;

  const taxiBookingId = order.taxiBookingId != null ? String(order.taxiBookingId).trim() : '';
  if (taxiBookingId) {
    return {
      mode: order.mode || 'taxi',
      pickup: order.pickup,
      stops: order.stops,
      rideType: order.rideType,
      distanceKm: order.distanceKm,
      quotedPrice: order.quotedPrice,
      taxiBookingId,
      bookingStorageTable: order.bookingStorageTable || 'taxi_bookings',
      payment_method: order.payment_method || 'card',
      eta: order.eta,
      orderId: order.orderId,
      priceNum: order.priceNum,
      priceLabel: order.priceLabel,
      placedAt: order.placedAt,
    };
  }

  const supabaseOrderId = order.supabaseOrderId != null ? String(order.supabaseOrderId).trim() : '';
  if (supabaseOrderId) {
    return {
      supabaseOrderId,
      orderId: order.orderId,
      from: order.from || order.pickup,
      to: order.to || order.dropoff,
      pickup: order.pickup || order.from,
      stops: order.stops,
      eta: order.eta || order.eta_text,
      placedAt: order.placedAt,
      priceNum: order.priceNum,
      priceLabel: order.priceLabel,
      package: order.package,
    };
  }

  return null;
}

/**
 * Build tracking state from a customer order-detail bundle (`fetchCustomerOrderDetail`).
 * @param {{ kind?: string, row?: Record<string, unknown> } | null | undefined} bundle
 */
export function buildLiveTrackingStateFromDetail(bundle) {
  if (!bundle?.row || typeof bundle.row !== 'object') return null;
  const { kind, row } = bundle;

  if (kind === 'delivery') {
    return buildLiveTrackingState({
      supabaseOrderId: row.id,
      orderId: deliveryOrderDisplayRef(row.id),
      from: row.pickup_location,
      to: row.dropoff_location,
      pickup: row.pickup_location,
      placedAt: row.created_at,
      priceNum: row.total_amount,
    });
  }

  if (kind === 'taxi' || kind === 'tuk') {
    const dest = row.destination_location;
    return buildLiveTrackingState({
      taxiBookingId: row.id,
      mode: kind === 'tuk' ? 'tuk' : 'taxi',
      pickup: row.pickup_location,
      stops: dest ? [{ value: dest }] : [],
      bookingStorageTable: kind === 'tuk' ? 'tuk_tuk_bookings' : 'taxi_bookings',
      quotedPrice: row.quoted_price,
      placedAt: row.created_at,
      orderId: deliveryOrderDisplayRef(row.id),
    });
  }

  return null;
}

/** @param {Record<string, unknown>} order */
export function shouldOpenLiveTracking(order) {
  return buildLiveTrackingState(order) != null;
}

/**
 * @param {{ kind?: string, row?: { status?: string } } | null | undefined} bundle
 */
export function isCustomerOrderTrackable(bundle) {
  if (!bundle?.row) return false;
  if (!['delivery', 'taxi', 'tuk'].includes(String(bundle.kind || ''))) return false;
  const st = String(bundle.row.status || '').toLowerCase();
  if (st === 'cancelled' || st === 'delivered' || st === 'completed') return false;
  if (isStaleUnfinishedBooking(bundle.row, bundle.kind)) return false;
  return true;
}