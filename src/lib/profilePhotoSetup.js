/** @param {string | null | undefined} message */
export function isProfilePhotoColumnError(message) {
  const m = String(message || '').toLowerCase();
  if (!m.includes('profile_photo_url')) return false;
  return (
    m.includes('does not exist') ||
    m.includes('could not find') ||
    m.includes('schema cache') ||
    (m.includes('column') && m.includes('app_users'))
  );
}

/** @param {string | null | undefined} message */
export function profilePhotoSaveErrorMessage(message) {
  if (/schema cache/i.test(String(message || ''))) {
    return 'Photo storage is updating on the server. Wait 30 seconds, refresh this page, and try again. If it still fails, run NOTIFY pgrst, \'reload schema\'; in Supabase SQL Editor.';
  }
  return 'Could not save your photo. Run supabase/app_users_profile_photo.sql once in Supabase → SQL Editor, then refresh and try again.';
}

export const PROFILE_PHOTO_SCHEMA_RELOAD_SQL = "NOTIFY pgrst, 'reload schema';";
