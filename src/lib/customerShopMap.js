import { mapShopProductRow } from './shopProductMap';
import { resolveShelfImageUrl } from './shopProductImage';

/** Card row for /shops list from `shop_owners`. */
export function mapShopOwnerToCard(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.business_name?.trim() || 'Shop',
    category: row.business_type?.trim() || 'Other',
    rating: null,
    delivery: row.business_address?.trim() ? truncateOneLine(row.business_address, 36) : 'Local shop',
    fee: 'USD',
    imageUrl: row.shop_image_url?.trim() || null,
  };
}

function truncateOneLine(text, max) {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

/** Line item for shop detail + cart from mapped `shop_products` row. */
export function mapToCustomerProduct(mapped, shopId, shopName) {
  if (!mapped) return null;
  const inStock = Boolean(mapped.active && mapped.stock > 0);
  const compareAtNum = mapped.compareAt != null && mapped.compareAt !== '' ? Number(mapped.compareAt) : NaN;
  const onSale = Number.isFinite(compareAtNum) && compareAtNum > mapped.price;
  const pctOff = onSale ? Math.round(((compareAtNum - mapped.price) / compareAtNum) * 100) : 0;
  const gallery = Array.isArray(mapped.galleryImageUrls) ? mapped.galleryImageUrls : [];
  const imageUrl =
    resolveShelfImageUrl(mapped.primaryImageUrl) ||
    gallery.map((u) => resolveShelfImageUrl(u)).find(Boolean) ||
    '';
  return {
    id: mapped.id,
    name: mapped.name,
    price: mapped.price,
    compareAt: onSale ? compareAtNum : null,
    onSale,
    percentOff: pctOff > 0 ? pctOff : null,
    category: mapped.category,
    brandName: mapped.brandName || '',
    shopId,
    shopName,
    imageUrl: imageUrl,
    imageUrls: Array.isArray(mapped.galleryImageUrls) ? mapped.galleryImageUrls.filter(Boolean) : [],
    inStock,
    stock: mapped.stock,
    description: mapped.description || '',
    tags: Array.isArray(mapped.tags) ? mapped.tags : [],
    offersFreeDelivery: Boolean(mapped.offersFreeDelivery),
    createdAt: mapped.createdAt || null,
  };
}

export function mapRowsToCustomerProducts(rows, shopId, shopName) {
  return (rows || [])
    .map((r) => mapToCustomerProduct(mapShopProductRow(r), shopId, shopName))
    .filter(Boolean);
}
