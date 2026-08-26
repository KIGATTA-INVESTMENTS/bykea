/**
 * Fire-and-forget: ask the edge function to FCM-push online drivers about a new / closed offer.
 */
import { isSupabaseConfigured, supabase } from './supabaseClient';

/**
 * @param {'customer_delivery_orders' | 'taxi_bookings' | 'tuk_tuk_bookings' | 'shop_customer_orders'} table
 * @param {string} orderId
 * @param {'ring' | 'stop'} [action]
 */
function invokeDriverOfferPush(table, orderId, action = 'ring') {
  const t = String(table || '').trim();
  const id = String(orderId || '').trim();
  if (!t || !id || !isSupabaseConfigured || !supabase) return;

  void supabase.functions
    .invoke('driver-offer-push', { body: { table: t, orderId: id, action } })
    .catch((e) => {
      console.warn('[driverOfferPushNotify]', e?.message || e);
    });
}

/**
 * @param {'customer_delivery_orders' | 'taxi_bookings' | 'tuk_tuk_bookings' | 'shop_customer_orders'} table
 * @param {string} orderId
 */
export function notifyDriversOfNewOffer(table, orderId) {
  invokeDriverOfferPush(table, orderId, 'ring');
}

/**
 * Tell all driver devices to stop ringing / dismiss the offer notification.
 * Call when a driver accepts, customer cancels, or the trip is no longer open.
 * @param {'customer_delivery_orders' | 'taxi_bookings' | 'tuk_tuk_bookings' | 'shop_customer_orders'} table
 * @param {string} orderId
 */
export function notifyDriversOfOfferStop(table, orderId) {
  invokeDriverOfferPush(table, orderId, 'stop');
}
