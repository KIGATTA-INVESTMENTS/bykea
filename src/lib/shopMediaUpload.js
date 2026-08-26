import { compressImageForUpload, compressImageToDataUrl } from './compressImageToDataUrl';
import { isSupabaseConfigured, supabase } from './supabaseClient';

const BUCKET = 'shop-media';
const MAX_BYTES = 12 * 1024 * 1024;

function assertImageFile(file) {
  if (!file || !file.type?.startsWith('image/')) {
    throw new Error('Please choose an image (JPEG, PNG, WebP, or GIF).');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('Image is too large. Maximum size is 12 MB.');
  }
}

/**
 * Upload an image to the shop-media bucket. Falls back to a small data URL if Storage is unavailable.
 * @param {string} path storage object path
 * @param {File} file
 * @param {{ maxEdge?: number, quality?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function uploadShopMedia(path, file, opts = {}) {
  assertImageFile(file);
  const maxEdge = opts.maxEdge ?? 960;
  const quality = opts.quality ?? 0.78;
  const compressed = await compressImageForUpload(file, maxEdge, quality);

  if (!isSupabaseConfigured || !supabase) {
    return compressImageToDataUrl(compressed, Math.min(maxEdge, 640), quality);
  }

  try {
    const contentType = compressed.type || 'image/jpeg';
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, compressed, {
      cacheControl: '86400',
      upsert: true,
      contentType,
    });
    if (upErr) {
      return compressImageToDataUrl(compressed, Math.min(maxEdge, 480), 0.72);
    }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const base = pub?.publicUrl?.trim();
    return base ? `${base}?v=${Date.now()}` : compressImageToDataUrl(compressed, 480, 0.72);
  } catch {
    return compressImageToDataUrl(compressed, Math.min(maxEdge, 480), 0.72);
  }
}

/** @param {string} ownerId @param {File} file */
export function uploadShopOwnerLogo(ownerId, file) {
  return uploadShopMedia(`owners/${ownerId}/logo.jpg`, file, { maxEdge: 720, quality: 0.8 });
}

/**
 * @param {string} ownerId
 * @param {string} productKey temporary or real product id
 * @param {number} slotIndex
 * @param {File} file
 */
export function uploadShopProductImage(ownerId, productKey, slotIndex, file) {
  const safeKey = String(productKey || 'new').replace(/[^a-zA-Z0-9_-]/g, '');
  return uploadShopMedia(`owners/${ownerId}/products/${safeKey}_${slotIndex}.jpg`, file, {
    maxEdge: 960,
    quality: 0.78,
  });
}

/** True when value is already a remote URL (not an inline data URL). */
export function isRemoteMediaUrl(url) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u);
}

/**
 * Resolve a slot/preview string to a storage URL when possible.
 * Remote URLs are kept; data URLs / Files are uploaded.
 */
export async function resolveShopMediaUrl({ ownerId, productKey, slotIndex, file, url }) {
  if (file) {
    return uploadShopProductImage(ownerId, productKey, slotIndex, file);
  }
  const u = String(url || '').trim();
  if (!u) return null;
  if (isRemoteMediaUrl(u)) return u;
  if (!u.startsWith('data:')) return u;
  try {
    const blob = await (await fetch(u)).blob();
    const asFile = new File([blob], `slot-${slotIndex}.jpg`, { type: blob.type || 'image/jpeg' });
    return uploadShopProductImage(ownerId, productKey, slotIndex, asFile);
  } catch {
    return null;
  }
}
