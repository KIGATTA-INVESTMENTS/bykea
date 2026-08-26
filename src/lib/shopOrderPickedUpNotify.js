/**
 * Best-effort email when a driver marks a shop checkout order as picked up.
 * Requires Edge function `shop-order-picked-up-notify` deployed with Resend secrets.
 *
 * @param {import('./supabaseClient').SupabaseClient | null | undefined} supabase
 * @param {string} orderId shop_customer_orders.id
 */
export function notifyShopOrderPickedUp(supabase, orderId) {
  if (!supabase || !orderId) return;
  void supabase.functions.invoke('shop-order-picked-up-notify', { body: { orderId } }).catch(() => {});
}
