const CACHE_KEY = 'bykea.customerShops.v2';
const TTL_MS = 5 * 60 * 1000;

/** @returns {{ shops: unknown[], products: unknown[] } | null} */
export function readCustomerShopsCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - Number(parsed.at || 0) > TTL_MS) return null;
    if (!Array.isArray(parsed.shops)) return null;
    return {
      shops: parsed.shops,
      products: Array.isArray(parsed.products) ? parsed.products : [],
    };
  } catch {
    return null;
  }
}

/** @param {unknown[]} shops @param {unknown[]} products */
export function writeCustomerShopsCache(shops, products) {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ at: Date.now(), shops: shops || [], products: products || [] }),
    );
  } catch {
    // ignore quota / private mode
  }
}
