import { mapShopProductRow } from './shopProductMap';

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
  return {
    id: mapped.id,
    name: mapped.name,
    price: mapped.price,
    category: mapped.category,
    shopId,
    shopName,
    imageUrl: mapped.primaryImageUrl || '',
    inStock,
  };
}

export function mapRowsToCustomerProducts(rows, shopId, shopName) {
  return (rows || [])
    .map((r) => mapToCustomerProduct(mapShopProductRow(r), shopId, shopName))
    .filter(Boolean);
}
