import { compressImageToDataUrl } from './compressImageToDataUrl';
import { isSupabaseConfigured, supabase } from './supabaseClient';

const BUCKET = 'shop-media';
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Upload (or inline-fallback) a customer profile photo.
 * @param {string} userId
 * @param {File} file
 * @returns {Promise<string>} URL to store in app_users.profile_photo_url
 */
export async function uploadCustomerProfilePhoto(userId, file) {
  if (!userId || !file) {
    throw new Error('Missing user or image.');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image (JPEG, PNG, WebP, or GIF).');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('Image is too large. Maximum size is 12 MB.');
  }

  const dataUrl = await compressImageToDataUrl(file, 800, 0.85);

  if (!isSupabaseConfigured || !supabase) {
    return dataUrl;
  }

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `customers/${userId}/avatar.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
      cacheControl: '3600',
      upsert: true,
      contentType: 'image/jpeg',
    });
    if (upErr) {
      return dataUrl;
    }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const base = pub?.publicUrl?.trim();
    return base ? `${base}?v=${Date.now()}` : dataUrl;
  } catch {
    return dataUrl;
  }
}
