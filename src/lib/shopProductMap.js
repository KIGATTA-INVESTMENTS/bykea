import { normalizeProductTags } from './shopProductCategories';

/** Map a `shop_products` row to the shape used by the shop owner products UI. */
export function mapShopProductRow(row) {
  if (!row) return null;
  let variants = [];
  try {
    const v = row.variants;
    if (Array.isArray(v)) variants = v;
    else if (typeof v === 'string') variants = JSON.parse(v);
  } catch {
    variants = [];
  }
  let galleryImageUrls = [];
  try {
    const u = row.image_urls;
    if (Array.isArray(u)) galleryImageUrls = u.filter(Boolean);
    else if (typeof u === 'string') galleryImageUrls = JSON.parse(u);
  } catch {
    galleryImageUrls = [];
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    brandName: String(row.brand_name || '').trim(),
    description: row.description ?? '',
    price: Number(row.price) || 0,
    compareAt: row.compare_at_price != null && row.compare_at_price !== '' ? String(row.compare_at_price) : '',
    stock: Number(row.stock) || 0,
    sku: row.sku ?? '',
    weight: row.weight ?? '',
    active: Boolean(row.is_active),
    offersFreeDelivery: Boolean(row.offers_free_delivery),
    hasVariants: Boolean(row.has_variants),
    variants,
    primaryImageUrl: row.image_primary_url || null,
    galleryImageUrls,
    tags: normalizeProductTags(row.tags),
    createdAt: row.created_at || null,
  };
}
