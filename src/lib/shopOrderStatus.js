/**
 * Shop customer order `status` field (shop_customer_orders) — shared labels for
 * customer app, admin, and shop owner portal.
 */

export function normalizeShopOrderStatus(raw) {
  return String(raw || 'placed')
    .toLowerCase()
    .trim();
}

/** Label shown to customers and admins. */
export function shopOrderStatusLabel(raw) {
  const s = normalizeShopOrderStatus(raw);
  if (s === 'placed') return 'Order placed';
  if (s === 'processing') return 'Processing';
  if (s === 'ready for delivery') return 'Ready for delivery';
  if (s === 'picked up') return 'Picked up';
  if (s === 'in transit') return 'In transit';
  if (s === 'delivered') return 'Delivered';
  if (s === 'cancelled') return 'Cancelled';
  if (!s) return 'Order placed';
  return String(raw).replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Key for customer list/badge + filter (matches mockOrders / OrderHistoryPage).
 * - active: order placed, processing, or picked up
 * - transit: in transit
 * - delivered, cancelled: as named
 */
export function shopOrderCustomerBadgeKey(raw) {
  const s = normalizeShopOrderStatus(raw);
  if (s === 'cancelled') return 'cancelled';
  if (s === 'delivered') return 'delivered';
  if (s === 'in transit') return 'transit';
  return 'active';
}

/** Customer-facing fulfillment steps (aligned with shop owner /shop-owner/orders). */
export const SHOP_ORDER_TRACKING_STEPS = [
  'Order placed',
  'Processing',
  'Ready for delivery',
  'Picked up',
  'In transit',
  'Delivered',
];

/** 0-based index into SHOP_ORDER_TRACKING_STEPS; -1 when cancelled. */
export function shopOrderStepIndex(raw) {
  const s = normalizeShopOrderStatus(raw);
  if (s === 'cancelled') return -1;
  if (s === 'placed') return 0;
  if (s === 'processing') return 1;
  if (s === 'ready for delivery') return 2;
  if (s === 'picked up') return 3;
  if (s === 'in transit') return 4;
  if (s === 'delivered') return 5;
  return 0;
}

/** Short status line for customer order confirmation / detail pages. */
export function shopOrderProgressMessage(raw, { hasDriver = false } = {}) {
  const s = normalizeShopOrderStatus(raw);
  if (s === 'cancelled') return 'This order was cancelled.';
  if (s === 'delivered') return 'Your order has been delivered.';
  if (s === 'in transit') {
    return hasDriver
      ? 'Your order is on the way with your delivery driver.'
      : 'Your order is in transit.';
  }
  if (s === 'picked up') {
    return hasDriver
      ? 'Your driver picked up the order and is heading to you.'
      : 'Your order has been picked up for delivery.';
  }
  if (s === 'ready for delivery') {
    return hasDriver
      ? 'A driver accepted your delivery and will pick up from the shop soon.'
      : 'Your order is ready — waiting for a driver to pick up.';
  }
  if (s === 'processing') return 'The shop is preparing your order.';
  return 'Your order is confirmed. The shop will start preparing it soon.';
}
