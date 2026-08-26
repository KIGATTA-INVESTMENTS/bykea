import { getShopUserBehavior } from './shopUserBehavior';

/** @typedef {{ productId: string, salesQty?: number, orderCount?: number }} WeeklyStat */

function createdAtMs(p) {
  const t = p?.createdAt ? Date.parse(p.createdAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function weeklyStatMap(stats) {
  /** @type {Record<string, WeeklyStat>} */
  const map = {};
  for (const row of stats || []) {
    const id = String(row.product_id || row.productId || '');
    if (!id) continue;
    map[id] = {
      productId: id,
      salesQty: Number(row.sales_qty ?? row.salesQty) || 0,
      orderCount: Number(row.order_count ?? row.orderCount) || 0,
    };
  }
  return map;
}

function globalWeeklyScore(product, statMap) {
  const stat = statMap[String(product.id)];
  const sales = stat?.salesQty || 0;
  const orders = stat?.orderCount || 0;
  const engagement = (product.imageUrl ? 1 : 0) + (product.inStock ? 1 : 0);
  return sales * 3 + orders * 2 + engagement;
}

function userAffinityScore(product, behavior) {
  if (!behavior) return 0;
  const pid = String(product.id);
  let score = 0;

  const views = Number(behavior.productViews?.[pid]) || 0;
  score += Math.min(views, 12) * 2.5;

  const dwellSec = (Number(behavior.productDwellMs?.[pid]) || 0) / 1000;
  score += Math.min(dwellSec, 120) * 0.08;

  if (behavior.cartProductIds?.includes(pid)) score += 8;
  if (behavior.purchasedProductIds?.includes(pid)) score += 14;

  const cat = String(product.category || '').trim();
  if (cat) {
    score += (Number(behavior.categoryViews?.[cat]) || 0) * 1.5;
    score += (Number(behavior.purchasedCategories?.[cat]) || 0) * 3;
  }

  const shopKey = product.shopId ? `shop:${product.shopId}` : '';
  if (shopKey) score += (Number(behavior.categoryViews?.[shopKey]) || 0) * 1.2;

  const searches = behavior.searchHistory || [];
  const hay = `${product.name} ${product.brandName} ${product.category} ${product.shopName}`.toLowerCase();
  for (const q of searches.slice(0, 8)) {
    if (q && hay.includes(q)) score += 4;
  }

  if (product.onSale) score += 1.5;
  if (product.offersFreeDelivery) score += 0.5;

  return score;
}

function combinedScore(product, behavior, statMap, personalWeight = 0.55) {
  const global = globalWeeklyScore(product, statMap);
  const personal = userAffinityScore(product, behavior);
  return global * (1 - personalWeight) + personal * personalWeight * 4;
}

/**
 * Weekly popular items — blends platform sales with user preferences.
 * @param {object[]} products
 * @param {WeeklyStat[] | Record<string, WeeklyStat>} [weeklyStats]
 * @param {object} [behavior]
 */
export function rankPopularThisWeek(products, weeklyStats = [], behavior = null) {
  const b = behavior || getShopUserBehavior();
  const statMap = Array.isArray(weeklyStats) ? weeklyStatMap(weeklyStats) : weeklyStats;
  return [...(products || [])].sort((a, bProd) => {
    const d = combinedScore(bProd, b, statMap, 0.5) - combinedScore(a, b, statMap, 0.5);
    if (d !== 0) return d;
    return createdAtMs(bProd) - createdAtMs(a);
  });
}

/**
 * Personalized recommendations for the signed-in / anonymous user.
 * @param {object[]} products
 * @param {WeeklyStat[] | Record<string, WeeklyStat>} [weeklyStats]
 * @param {object} [behavior]
 * @param {number} [limit]
 */
export function getPersonalizedRecommendations(products, weeklyStats = [], behavior = null, limit = 12) {
  const b = behavior || getShopUserBehavior();
  const statMap = Array.isArray(weeklyStats) ? weeklyStatMap(weeklyStats) : weeklyStats;
  const ranked = [...(products || [])].sort((a, bProd) => {
    const d = combinedScore(bProd, b, statMap, 0.72) - combinedScore(a, b, statMap, 0.72);
    if (d !== 0) return d;
    return createdAtMs(bProd) - createdAtMs(a);
  });
  return ranked.slice(0, limit);
}

/**
 * Trending products — stronger weight on recent global activity.
 * @param {object[]} products
 * @param {WeeklyStat[] | Record<string, WeeklyStat>} [weeklyStats]
 * @param {object} [behavior]
 * @param {number} [limit]
 */
export function getTrendingProducts(products, weeklyStats = [], behavior = null, limit = 8) {
  const b = behavior || getShopUserBehavior();
  const statMap = Array.isArray(weeklyStats) ? weeklyStatMap(weeklyStats) : weeklyStats;
  const ranked = [...(products || [])]
    .filter((p) => p.inStock)
    .sort((a, bProd) => {
      const globalA = globalWeeklyScore(a, statMap);
      const globalB = globalWeeklyScore(b, statMap);
      const d = globalB + userAffinityScore(bProd, b) * 0.3 - (globalA + userAffinityScore(a, b) * 0.3);
      if (d !== 0) return d;
      return createdAtMs(bProd) - createdAtMs(a);
    });
  return ranked.slice(0, limit);
}

/** Fetch weekly product sales stats from Supabase RPC (returns [] on failure). */
export async function fetchWeeklyProductStats(supabase) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('customer_shop_weekly_product_stats');
    if (!error && Array.isArray(data)) return data;
  } catch {
    // RPC may not exist yet
  }
  return [];
}
