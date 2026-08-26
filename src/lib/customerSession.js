const PROFILE_KEY = 'ingo_user_profile';
const SESSION_EMAIL_KEY = 'ingo_session_email';

function clearCustomerKeysFrom(storage) {
  try {
    storage.removeItem('ingo_signed_in');
    storage.removeItem(PROFILE_KEY);
    storage.removeItem(SESSION_EMAIL_KEY);
  } catch {
    // ignore
  }
}

/** Where the active customer session lives (session vs persistent). */
function getActiveCustomerStorage() {
  try {
    if (sessionStorage.getItem('ingo_signed_in') === '1') return sessionStorage;
    if (localStorage.getItem('ingo_signed_in') === '1') return localStorage;
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist table-based customer fields (no Supabase Auth).
 * @param {object} profile - User row fields to cache.
 * @param {{ rememberMe?: boolean }} [options] - If true, persist until logout (localStorage).
 *   If false, only this browser tab session (sessionStorage). If omitted, update whatever store is already active, else localStorage.
 */
export function saveCustomerSession(profile, options = {}) {
  const { rememberMe } = options;
  let targetStorage;
  if (rememberMe === true) {
    targetStorage = localStorage;
    clearCustomerKeysFrom(sessionStorage);
  } else if (rememberMe === false) {
    targetStorage = sessionStorage;
    clearCustomerKeysFrom(localStorage);
  } else {
    targetStorage = getActiveCustomerStorage() || localStorage;
    const other = targetStorage === localStorage ? sessionStorage : localStorage;
    clearCustomerKeysFrom(other);
  }

  try {
    targetStorage.setItem('ingo_signed_in', '1');
    if (profile && typeof profile === 'object') {
      targetStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      if (profile.email) {
        targetStorage.setItem(SESSION_EMAIL_KEY, String(profile.email).trim().toLowerCase());
      }
    }
  } catch {
    // ignore
  }
}

export function getCustomerSession() {
  try {
    for (const storage of [sessionStorage, localStorage]) {
      const raw = storage.getItem(PROFILE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') continue;
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearCustomerSession() {
  clearCustomerKeysFrom(localStorage);
  clearCustomerKeysFrom(sessionStorage);
}

/** Email for re-loading profile from `app_users` when the profile JSON cache is missing. */
export function getSessionEmail() {
  try {
    for (const storage of [sessionStorage, localStorage]) {
      const fromKey = storage.getItem(SESSION_EMAIL_KEY);
      if (fromKey) return fromKey.trim().toLowerCase();
      try {
        const profRaw = storage.getItem(PROFILE_KEY);
        if (profRaw) {
          const prof = JSON.parse(profRaw);
          if (prof?.email) return String(prof.email).trim().toLowerCase();
        }
      } catch {
        // continue with next storage
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function isCustomerMarkedSignedIn() {
  try {
    return (
      sessionStorage.getItem('ingo_signed_in') === '1' || localStorage.getItem('ingo_signed_in') === '1'
    );
  } catch {
    return false;
  }
}

/**
 * User id safe for FK inserts — verifies the cached session still exists in `app_users`.
 * Reloads session by email when the cached id is stale.
 * @param {import('./supabaseClient').SupabaseClient | null | undefined} supabase
 * @param {string | null | undefined} [cachedUserId]
 * @returns {Promise<string | null>}
 */
export async function resolveValidAppUserId(supabase, cachedUserId) {
  if (!supabase) return null;
  const id = String(cachedUserId || '').trim();
  if (id) {
    const { data, error } = await supabase.from('app_users').select('id').eq('id', id).maybeSingle();
    if (!error && data?.id) return String(data.id);
  }

  const email = getSessionEmail();
  if (!email) return null;

  const { data: byEmail, error: emailErr } = await supabase
    .from('app_users')
    .select('id, full_name, phone, email, profile_photo_url')
    .eq('email', email)
    .maybeSingle();
  if (emailErr || !byEmail?.id) return null;

  saveCustomerSession(byEmail);
  return String(byEmail.id);
}

/** @param {string | null | undefined} message */
export function friendlyAppUserFkError(message) {
  const m = String(message || '');
  if (/app_user_id_fkey|foreign key constraint.*app_user/i.test(m)) {
    return 'Your login session is out of date. Log out and sign in again, then place your order.';
  }
  return m || 'Could not save your request.';
}
