import { fetchShopOwnerAdminNotificationItems } from './shopOwnerAdminNotifications';
import { formatGBP } from './currency';
import { getShopOwnerSession } from './shopOwnerAuth';
import { shopOrderStatusLabel } from './shopOrderStatus';
import { ensureShopOwnerSupportConversation, listSupportMessages } from './supportChat';
import { isSupabaseConfigured, supabase } from './supabaseClient';

const READ_STORAGE_KEY = 'ingo_shop_owner_notifications_read';
const LOW_STOCK_THRESHOLD = 5;
const MAX_ITEMS = 80;

function normalizeStatus(raw) {
  return String(raw || 'placed')
    .toLowerCase()
    .trim();
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function dateGroup(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'older';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (d >= startToday) return 'today';
  if (d >= startYesterday) return 'yesterday';
  return 'older';
}

function displayAgo(iso, group) {
  if (group === 'yesterday') {
    try {
      const t = new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return `Yesterday · ${t}`;
    } catch {
      return 'Yesterday';
    }
  }
  return formatRelativeTime(iso);
}

export function getShopOwnerNotificationsReadSet() {
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveShopOwnerNotificationsReadSet(set) {
  try {
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

export function markShopOwnerNotificationsRead(ids) {
  const next = getShopOwnerNotificationsReadSet();
  ids.forEach((id) => next.add(id));
  saveShopOwnerNotificationsReadSet(next);
  return next;
}

function orderNotifType(status) {
  const s = normalizeStatus(status);
  if (s === 'delivered') return 'delivered';
  if (s === 'cancelled') return 'cancel';
  if (s === 'in transit' || s === 'picked up') return 'delivery';
  if (s === 'placed') return 'order';
  return 'delivery';
}

function orderNotifCategory(status) {
  return 'orders';
}

function orderTitle(status) {
  const s = normalizeStatus(status);
  if (s === 'placed') return 'New order — tap to confirm';
  if (s === 'cancelled') return 'Order cancelled';
  if (s === 'delivered') return 'Order delivered';
  if (s === 'processing') return 'Order being prepared';
  if (s === 'ready for delivery') return 'Order ready for pickup';
  return shopOrderStatusLabel(status);
}

function withdrawalNotif(w) {
  const st = String(w.status || 'pending').toLowerCase();
  const amt = formatGBP(Number(w.amount) || 0);
  const at = w.paid_at || w.approved_at || w.requested_at;
  let title = 'Withdrawal update';
  let sub = `${amt} — ${st}`;
  let type = 'payment';

  if (st === 'pending') {
    title = 'Withdrawal request submitted';
    sub = `${amt} is pending admin review`;
  } else if (st === 'approved') {
    title = 'Withdrawal approved';
    sub = `${amt} will be paid out soon`;
  } else if (st === 'paid') {
    title = 'Payout completed';
    sub = `${amt} has been marked as paid`;
    type = 'delivered';
  } else if (st === 'rejected') {
    title = 'Withdrawal rejected';
    sub = w.admin_note?.trim() || `${amt} was not approved`;
    type = 'cancel';
  }

  return {
    id: `withdrawal-${w.id}`,
    at,
    group: dateGroup(at),
    ago: displayAgo(at, dateGroup(at)),
    title,
    sub,
    type,
    category: 'payments',
    link: '/shop-owner/payments',
  };
}

/**
 * @param {object} [session]
 * @returns {Promise<{ items: object[], error: string|null }>}
 */
export async function fetchShopOwnerNotifications(session = getShopOwnerSession()) {
  if (!session?.id) {
    return { items: [], error: 'Sign in as a shop owner to see notifications.' };
  }
  if (!isSupabaseConfigured || !supabase) {
    return { items: [], error: 'Supabase is not configured.' };
  }

  const readSet = getShopOwnerNotificationsReadSet();
  const items = [];

  const { data: lineRows, error: lineErr } = await supabase
    .from('shop_customer_order_lines')
    .select('*')
    .eq('shop_owner_id', session.id);

  if (lineErr) {
    return {
      items: [],
      error: lineErr.message?.includes('shop_customer_order_lines')
        ? `${lineErr.message} — Run supabase/shop_customer_orders.sql.`
        : lineErr.message,
    };
  }

  const lines = Array.isArray(lineRows) ? lineRows : [];
  const orderIds = [...new Set(lines.map((l) => l.order_id).filter(Boolean))];

  if (orderIds.length) {
    const { data: orders, error: orderErr } = await supabase
      .from('shop_customer_orders')
      .select('*')
      .in('id', orderIds);

    if (orderErr) {
      return { items: [], error: orderErr.message };
    }

    const linesByOrder = {};
    lines.forEach((line) => {
      if (!linesByOrder[line.order_id]) linesByOrder[line.order_id] = [];
      linesByOrder[line.order_id].push(line);
    });

    for (const order of orders || []) {
      const myLines = linesByOrder[order.id] || [];
      if (!myLines.length) continue;
      const total = myLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
      const qty = myLines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
      const at = order.placed_at;
      const group = dateGroup(at);
      const id = `order-${order.id}`;
      items.push({
        id,
        at,
        group,
        ago: displayAgo(at, group),
        title: orderTitle(order.status),
        sub: `${order.order_number} — ${qty} item${qty === 1 ? '' : 's'} · ${formatGBP(total)} · ${order.customer_full_name || 'Customer'}`,
        type: orderNotifType(order.status),
        category: orderNotifCategory(order.status),
        link: `/shop-owner/orders/${order.id}`,
        read: readSet.has(id),
      });
    }
  }

  const { data: withdrawals, error: wdErr } = await supabase
    .from('shop_owner_withdrawal_requests')
    .select('*')
    .eq('shop_owner_id', session.id)
    .order('requested_at', { ascending: false })
    .limit(30);

  if (!wdErr && Array.isArray(withdrawals)) {
    withdrawals.forEach((w) => {
      const n = withdrawalNotif(w);
      items.push({ ...n, read: readSet.has(n.id) });
    });
  }

  const { data: lowStock, error: stockErr } = await supabase
    .from('shop_products')
    .select('id, name, stock')
    .eq('shop_owner_id', session.id)
    .eq('is_active', true)
    .lte('stock', LOW_STOCK_THRESHOLD)
    .order('stock', { ascending: true })
    .limit(20);

  if (!stockErr && Array.isArray(lowStock) && lowStock.length) {
    const names = lowStock.map((p) => p.name).filter(Boolean);
    const at = new Date().toISOString();
    const id = `low-stock-${session.id}`;
    const sub =
      lowStock.length === 1
        ? `${names[0]} has ${lowStock[0].stock} left in stock`
        : `${lowStock.length} products low on stock: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`;
    items.push({
      id,
      at,
      group: dateGroup(at),
      ago: displayAgo(at, dateGroup(at)),
      title: 'Low stock alert',
      sub,
      type: 'alert',
      category: 'alerts',
      link: '/shop-owner/products',
      read: readSet.has(id),
    });
  }

  try {
    const { conversation } = await ensureShopOwnerSupportConversation(session);
    if (conversation?.id) {
      const { data: messages } = await listSupportMessages(conversation.id);
      const adminMsgs = (messages || []).filter((m) => m.sender_role === 'admin');
      adminMsgs.slice(-15).forEach((m) => {
        const at = m.created_at;
        const group = dateGroup(at);
        const id = `support-${m.id}`;
        const preview = String(m.body || '').trim();
        items.push({
          id,
          at,
          group,
          ago: displayAgo(at, group),
          title: 'Message from InGo Admin',
          sub: preview.length > 90 ? `${preview.slice(0, 90)}…` : preview || 'Open chat to read',
          type: 'chat',
          category: 'alerts',
          link: '/shop-owner/chat',
          read: readSet.has(id),
        });
      });
    }
  } catch {
    // support optional
  }

  const { items: adminItems, error: adminErr } = await fetchShopOwnerAdminNotificationItems(session.id, readSet);
  if (adminErr) {
    return { items: [], error: adminErr };
  }
  adminItems.forEach((n) => items.push(n));

  items.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());

  return { items: items.slice(0, MAX_ITEMS), error: null };
}
