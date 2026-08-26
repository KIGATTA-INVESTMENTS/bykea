import { getCustomerSession } from './customerSession';

const STORAGE_PREFIX = 'bykea.shopBehavior.v1';

function storageKey() {
  const session = getCustomerSession();
  const uid = session?.id ? String(session.id) : 'anon';
  return `${STORAGE_PREFIX}.${uid}`;
}

function readStore() {
  if (typeof localStorage === 'undefined') return defaultStore();
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch {
    return defaultStore();
  }
}

function writeStore(store) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(store));
  } catch {
    // quota / private mode
  }
}

function defaultStore() {
  return {
    productViews: {},
    categoryViews: {},
    searchHistory: [],
    cartProductIds: [],
    purchasedProductIds: [],
    purchasedCategories: {},
    productDwellMs: {},
    updatedAt: null,
  };
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object') return defaultStore();
  return {
    productViews: raw.productViews && typeof raw.productViews === 'object' ? raw.productViews : {},
    categoryViews: raw.categoryViews && typeof raw.categoryViews === 'object' ? raw.categoryViews : {},
    searchHistory: Array.isArray(raw.searchHistory) ? raw.searchHistory.slice(0, 40) : [],
    cartProductIds: Array.isArray(raw.cartProductIds) ? raw.cartProductIds.slice(0, 80) : [],
    purchasedProductIds: Array.isArray(raw.purchasedProductIds) ? raw.purchasedProductIds.slice(0, 120) : [],
    purchasedCategories: raw.purchasedCategories && typeof raw.purchasedCategories === 'object' ? raw.purchasedCategories : {},
    productDwellMs: raw.productDwellMs && typeof raw.productDwellMs === 'object' ? raw.productDwellMs : {},
    updatedAt: raw.updatedAt || null,
  };
}

function bumpCount(map, key, amount = 1) {
  if (!key) return;
  map[key] = (Number(map[key]) || 0) + amount;
}

function pushUnique(list, id, max = 80) {
  const sid = String(id || '');
  if (!sid) return list;
  const next = [sid, ...list.filter((x) => x !== sid)];
  return next.slice(0, max);
}

/** @returns {ReturnType<typeof defaultStore>} */
export function getShopUserBehavior() {
  return readStore();
}

export function recordProductView(product) {
  if (!product?.id) return;
  const store = readStore();
  bumpCount(store.productViews, String(product.id));
  if (product.category) bumpCount(store.categoryViews, String(product.category).trim());
  if (product.shopId) bumpCount(store.categoryViews, `shop:${product.shopId}`);
  store.updatedAt = new Date().toISOString();
  writeStore(store);
}

export function recordProductDwell(productId, ms) {
  const id = String(productId || '');
  const delta = Math.max(0, Math.floor(Number(ms) || 0));
  if (!id || delta < 500) return;
  const store = readStore();
  store.productDwellMs[id] = (Number(store.productDwellMs[id]) || 0) + delta;
  store.updatedAt = new Date().toISOString();
  writeStore(store);
}

export function recordShopSearch(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || q.length < 2) return;
  const store = readStore();
  store.searchHistory = [q, ...store.searchHistory.filter((s) => s !== q)].slice(0, 40);
  store.updatedAt = new Date().toISOString();
  writeStore(store);
}

export function recordCartAdd(product) {
  if (!product?.id) return;
  const store = readStore();
  store.cartProductIds = pushUnique(store.cartProductIds, product.id);
  if (product.category) bumpCount(store.categoryViews, String(product.category).trim(), 2);
  store.updatedAt = new Date().toISOString();
  writeStore(store);
}

/** Merge purchased product ids from completed shop orders. */
export function syncPurchasedProducts(orderLines) {
  if (!Array.isArray(orderLines) || !orderLines.length) return;
  const store = readStore();
  for (const line of orderLines) {
    const pid = line?.productId || line?.product_id;
    const cat = line?.category || line?.productCategory;
    if (pid) store.purchasedProductIds = pushUnique(store.purchasedProductIds, pid, 120);
    if (cat) bumpCount(store.purchasedCategories, String(cat).trim(), Number(line?.quantity) || 1);
  }
  store.updatedAt = new Date().toISOString();
  writeStore(store);
}
