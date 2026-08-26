import { isSupabaseConfigured, supabase } from './supabaseClient';

export function isPackagePhotoSrc(v) {
  return typeof v === 'string' && /^data:image\//i.test(v.trim());
}

/**
 * @param {'customer' | 'driver'} role
 * @param {string} orderId
 * @param {string | null} dataUrl
 * @param {string} [fileName]
 */
export async function persistParcelPackagePhoto(role, orderId, dataUrl, fileName) {
  if (!isSupabaseConfigured || !supabase || !orderId) {
    return { ok: false, error: 'Could not save photo.' };
  }
  const url = isPackagePhotoSrc(dataUrl) ? dataUrl : null;
  const customerPatch = {
    package_photo_data_url: url,
    package_photo_filename: url ? String(fileName || 'package.jpg').slice(0, 180) : null,
  };
  const driverPatch = { driver_package_photo_data_url: url };
  const primary = role === 'driver' ? driverPatch : customerPatch;

  const { error } = await supabase.from('customer_delivery_orders').update(primary).eq('id', orderId);
  if (!error) return { ok: true };

  if (role === 'driver' && /driver_package_photo_data_url/i.test(error.message || '')) {
    return {
      ok: false,
      error: 'Could not save the driver photo. Ask admin to run the package photo database update.',
    };
  }

  return { ok: false, error: error.message || 'Could not save photo.' };
}
