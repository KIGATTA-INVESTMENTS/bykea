/** Max length for inline data URLs shown on marketplace shelves (compressed thumbnails). */
const MAX_DATA_URL_CHARS = 280_000;

/**
 * URL safe to use on /shops shelves and cards (http(s) or reasonably sized data URLs).
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function resolveShelfImageUrl(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('data:image/')) {
    return s.length <= MAX_DATA_URL_CHARS ? s : '';
  }
  if (s.length <= 2048 && !s.startsWith('data:')) return s;
  return '';
}

function parseGalleryUrls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Best display image from a `shop_products` row (primary, then gallery).
 * @param {object | null | undefined} row
 * @returns {string}
 */
export function imageFromProductRow(row) {
  if (!row) return '';
  const primary = resolveShelfImageUrl(row.image_primary_url);
  if (primary) return primary;
  for (const url of parseGalleryUrls(row.image_urls)) {
    const resolved = resolveShelfImageUrl(url);
    if (resolved) return resolved;
  }
  return '';
}

/** Prefer products that have a displayable image. */
export function sortProductsWithImagesFirst(list) {
  return [...(list || [])].sort((a, b) => {
    const ai = a?.imageUrl ? 1 : 0;
    const bi = b?.imageUrl ? 1 : 0;
    return bi - ai;
  });
}

/**
 * RPC strips data URLs — re-fetch image fields for rows missing a shelf image.
 * @param {import('./supabaseClient').SupabaseClient | null | undefined} supabase
 * @param {object[]} rows
 */
export async function hydrateShelfProductImages(supabase, rows) {
  if (!supabase || !rows?.length) return rows || [];

  const missingIds = rows
    .filter((r) => r?.id && !resolveShelfImageUrl(r.image_primary_url))
    .map((r) => r.id);

  if (!missingIds.length) return rows;

  const { data, error } = await supabase
    .from('shop_products')
    .select('id, image_primary_url, image_urls')
    .in('id', missingIds.slice(0, 80));

  if (error || !data?.length) return rows;

  const byId = Object.fromEntries(data.map((d) => [d.id, d]));
  return rows.map((row) => {
    const extra = byId[row.id];
    if (!extra) return row;
    const url = imageFromProductRow(extra);
    if (!url) return row;
    return { ...row, image_primary_url: url };
  });
}
