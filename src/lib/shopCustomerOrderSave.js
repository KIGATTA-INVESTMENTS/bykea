import { isSupabaseConfigured, supabase } from './supabaseClient';
import { generateDeliveryConfirmationCode } from './deliveryConfirmationCode';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

function randomOrderNumber() {
  return `ING-${String(Math.floor(Math.random() * 900000) + 100000)}`;
}

/**
 * Persist a shop checkout: header + line items (multi-shop cart supported).
 * @param {{
 *   items: Array<{ id: string, name: string, price: number, qty: number, shopId: string, shopName?: string, imageUrl?: string }>,
 *   customer: { fullName: string, phone: string, email?: string, address: string, notes?: string },
 *   subtotal: number,
 *   deliveryFee?: number,
 *   paymentMethod?: string,
 *   appUserId?: string | null,
 *   paymentStatus?: string,
 * }} params
 * @returns {Promise<{ data?: { id: string, order_number: string, placed_at: string, delivery_confirmation_code?: string }, error?: Error }>}
 */
export async function saveShopCustomerOrder({
  items,
  customer,
  subtotal,
  deliveryFee = 0,
  paymentMethod = 'cod',
  appUserId = null,
  paymentStatus = 'pending',
}) {
  if (!isSupabaseConfigured || !supabase) {
    return { error: new Error('Supabase is not configured.') };
  }
  if (!items?.length) {
    return { error: new Error('Cart is empty.') };
  }

  let order_number = randomOrderNumber();
  let orderRow;
  let lastErr;
  const delivery_confirmation_code = generateDeliveryConfirmationCode();
  const method = String(paymentMethod || 'cod').toLowerCase();
  const status = String(paymentStatus || 'pending').toLowerCase();

  for (let attempt = 0; attempt < 3; attempt++) {
    const insertRow = {
      order_number,
      customer_full_name: customer.fullName.trim(),
      customer_phone: customer.phone.trim(),
      customer_email: customer.email?.trim() || null,
      customer_address: customer.address.trim(),
      customer_notes: customer.notes?.trim() || null,
      subtotal,
      delivery_fee: Math.max(0, Number(deliveryFee) || 0),
      currency: 'USD',
      status: 'placed',
      delivery_confirmation_code,
      payment_method: method,
      payment_status: status,
      app_user_id: appUserId || null,
    };
    if (status === 'paid') {
      insertRow.payment_completed_at = new Date().toISOString();
      insertRow.payment_gateway = method === 'wallet' ? 'wallet' : insertRow.payment_gateway;
    }

    let { data, error } = await supabase
      .from('shop_customer_orders')
      .insert(insertRow)
      .select('id, order_number, placed_at, delivery_confirmation_code')
      .single();

    // Older schemas without payment_method / app_user_id — retry stripped row once.
    if (
      error &&
      /payment_method|app_user_id|payment_status|payment_completed_at|payment_gateway|schema cache|column/i.test(
        error.message || '',
      )
    ) {
      const slim = {
        order_number,
        customer_full_name: customer.fullName.trim(),
        customer_phone: customer.phone.trim(),
        customer_email: customer.email?.trim() || null,
        customer_address: customer.address.trim(),
        customer_notes: customer.notes?.trim() || null,
        subtotal,
        delivery_fee: Math.max(0, Number(deliveryFee) || 0),
        currency: 'USD',
        status: 'placed',
        delivery_confirmation_code,
      };
      ({ data, error } = await supabase
        .from('shop_customer_orders')
        .insert(slim)
        .select('id, order_number, placed_at, delivery_confirmation_code')
        .single());
      if (!error && data && method === 'wallet') {
        await supabase.from('shop_customer_orders').delete().eq('id', data.id);
        return {
          error: new Error(
            'Run supabase/customer_wallet_checkout.sql in the SQL editor to enable wallet payments for shop orders.',
          ),
        };
      }
    }

    if (!error && data) {
      orderRow = data;
      break;
    }
    lastErr = error;
    if (error?.code === '23505') {
      order_number = randomOrderNumber();
      continue;
    }
    return {
      error: new Error(
        /delivery_confirmation_code/i.test(error?.message || '')
          ? `${error.message} — Run supabase/shop_customer_delivery_confirmation_code.sql in the Supabase SQL editor.`
          : /payment_method|wallet/i.test(error?.message || '')
            ? `${error.message} — Run supabase/customer_wallet_checkout.sql in the SQL editor.`
            : error?.message || 'Could not create order.',
      ),
    };
  }

  if (!orderRow) {
    return { error: new Error(lastErr?.message || 'Could not create order.') };
  }

  const lines = items.map((l) => ({
    order_id: orderRow.id,
    shop_owner_id: l.shopId,
    product_id: isUuid(l.id) ? l.id : null,
    product_name: l.name,
    unit_price: l.price,
    quantity: l.qty,
    line_total: l.price * l.qty,
    shop_name: l.shopName || null,
    image_url: l.imageUrl?.trim() || null,
  }));

  const { error: lineErr } = await supabase.from('shop_customer_order_lines').insert(lines);

  if (lineErr) {
    await supabase.from('shop_customer_orders').delete().eq('id', orderRow.id);
    return {
      error: new Error(
        lineErr.message?.includes('shop_customer_order_lines') || lineErr.message?.includes('foreign key')
          ? `${lineErr.message} — Run supabase/shop_customer_orders.sql and ensure shop_owners / shop_products exist.`
          : lineErr.message || 'Could not save order lines.',
      ),
    };
  }

  try {
    void supabase.functions.invoke('shop-order-placed-notify', { body: { orderId: orderRow.id } }).catch(() => {});
  } catch {
    // ignore — emails are best-effort
  }

  return { data: orderRow };
}
