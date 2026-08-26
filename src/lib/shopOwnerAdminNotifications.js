import { isSupabaseConfigured, supabase } from './supabaseClient';

export const SHOP_OWNER_ADMIN_NOTIF_TYPES = {
  PRODUCT_DELETED: 'admin_product_deleted',
  IMAGE_REMOVED: 'admin_product_image_removed',
};

export function shopOwnerAdminNotifId(rowId) {
  return `owner-notif-${rowId}`;
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

function mapRowToNotificationItem(row, readSet) {
  const at = row.created_at;
  const group = dateGroup(at);
  const id = shopOwnerAdminNotifId(row.id);
  const productName = row.product_name?.trim() || 'Your product';
  const isProductDeleted = row.type === SHOP_OWNER_ADMIN_NOTIF_TYPES.PRODUCT_DELETED;

  return {
    id,
    rowId: row.id,
    at,
    group,
    ago: displayAgo(at, group),
    title: row.title || (isProductDeleted ? 'Product removed by InGo Admin' : 'Product image removed'),
    sub: row.body || (isProductDeleted
      ? `"${productName}" was removed because it was against our policy.`
      : `The image for "${productName}" was removed because of low quality.`),
    type: isProductDeleted ? 'cancel' : 'alert',
    category: 'alerts',
    link: '/shop-owner/products',
    read: readSet.has(id),
    adminAction: row.type,
    productName,
  };
}

async function insertNotification(payload) {
  if (!payload.shopOwnerId || !isSupabaseConfigured || !supabase) {
    return { ok: false, error: 'Not configured.' };
  }
  const { error } = await supabase.from('shop_owner_notifications').insert({
    shop_owner_id: payload.shopOwnerId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    product_id: payload.productId || null,
    product_name: payload.productName || null,
  });
  if (error) {
    console.warn('[shopOwnerAdminNotifications]', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** @param {{ shopOwnerId: string, productId?: string, productName?: string }} args */
export async function notifyShopOwnerProductDeleted({ shopOwnerId, productId, productName }) {
  const name = (productName || 'Your product').trim();
  return insertNotification({
    shopOwnerId,
    productId,
    productName: name,
    type: SHOP_OWNER_ADMIN_NOTIF_TYPES.PRODUCT_DELETED,
    title: 'Product removed by InGo Admin',
    body: `"${name}" was removed because it was against our policy.`,
  });
}

/** @param {{ shopOwnerId: string, productId?: string, productName?: string }} args */
export async function notifyShopOwnerImageRemoved({ shopOwnerId, productId, productName }) {
  const name = (productName || 'Your product').trim();
  return insertNotification({
    shopOwnerId,
    productId,
    productName: name,
    type: SHOP_OWNER_ADMIN_NOTIF_TYPES.IMAGE_REMOVED,
    title: 'Product image removed',
    body: `The image for "${name}" was removed because of low quality. Please upload a clearer photo.`,
  });
}

/**
 * @param {string} shopOwnerId
 * @param {Set<string>} readSet
 * @returns {Promise<{ items: object[], error: string|null }>}
 */
export async function fetchShopOwnerAdminNotificationItems(shopOwnerId, readSet) {
  if (!shopOwnerId || !isSupabaseConfigured || !supabase) {
    return { items: [], error: null };
  }
  const { data, error } = await supabase
    .from('shop_owner_notifications')
    .select('id, type, title, body, product_id, product_name, created_at')
    .eq('shop_owner_id', shopOwnerId)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) {
    if (/shop_owner_notifications|relation|does not exist/i.test(error.message || '')) {
      return { items: [], error: null };
    }
    return { items: [], error: error.message };
  }

  return {
    items: (data || []).map((row) => mapRowToNotificationItem(row, readSet)),
    error: null,
  };
}
