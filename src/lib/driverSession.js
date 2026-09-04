const SIGNED_KEY = 'ingo_driver_signed_in';
const PROFILE_KEY = 'ingo_driver_profile';
const ONLINE_KEY = 'ingo_driver_online';
const REMEMBER_EMAIL_KEY = 'ingo_driver_remember_email';

function clearDriverKeysFrom(storage) {
  try {
    storage.removeItem(SIGNED_KEY);
    storage.removeItem(PROFILE_KEY);
  } catch {
    // ignore
  }
}

function getActiveDriverStorage() {
  try {
    if (sessionStorage.getItem(SIGNED_KEY) === '1') return sessionStorage;
    if (localStorage.getItem(SIGNED_KEY) === '1') return localStorage;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   id: string,
 *   full_name: string,
 *   email?: string | null,
 *   phone?: string | null,
 *   phone_country_code?: string | null,
 *   vehicle_type?: string | null,
 *   vehicle_make?: string | null,
 *   vehicle_model?: string | null,
 *   vehicle_plate?: string | null,
 *   vehicle_color?: string | null,
 *   status?: string | null,
 *   created_at?: string | null,
 *   account_mode?: string | null,
 *   company_id?: string | null,
 * }} profile
 * @param {{ rememberMe?: boolean }} [options] - `true`: persist until logout (localStorage).
 *   `false`: this browser tab only (sessionStorage). Omit: keep active store, else localStorage.
 */
export function saveDriverSession(profile, options = {}) {
  const { rememberMe } = options;
  let targetStorage;
  if (rememberMe === true) {
    targetStorage = localStorage;
    clearDriverKeysFrom(sessionStorage);
  } else if (rememberMe === false) {
    targetStorage = sessionStorage;
    clearDriverKeysFrom(localStorage);
  } else {
    targetStorage = getActiveDriverStorage() || localStorage;
    const other = targetStorage === localStorage ? sessionStorage : localStorage;
    clearDriverKeysFrom(other);
  }

  try {
    targetStorage.setItem(SIGNED_KEY, '1');
    targetStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email ?? '',
        phone: profile.phone ?? '',
        phone_country_code: profile.phone_country_code ?? '+44',
        vehicle_type: profile.vehicle_type ?? '',
        vehicle_make: profile.vehicle_make ?? '',
        vehicle_model: profile.vehicle_model ?? '',
        vehicle_plate: profile.vehicle_plate ?? '',
        vehicle_color: profile.vehicle_color ?? '',
        status: profile.status ?? 'approved',
        created_at: profile.created_at ?? null,
        account_mode: profile.account_mode ?? 'solo',
        company_id: profile.company_id ?? null,
      }),
    );
  } catch {
    // ignore
  }

  // Claim a push token for this device as soon as a driver is signed in.
  // Before this call existed, nothing in the app ever reached
  // registerDriverPushToken, so driver_push_tokens stayed empty and every
  // dispatched offer was pushed to nobody. See docs/adr/0001.
  // Dynamic import for the same reason as clearDriverSession below: driverPush
  // imports getDriverSession from this module.
  if (profile?.id) {
    try {
      void import('./driverPushBootstrap')
        .then((m) => m.ensureDriverPushRegistered(profile.id))
        .catch(() => {});
    } catch {
      // ignore
    }
  }
}

export function getDriverSession() {
  try {
    for (const storage of [sessionStorage, localStorage]) {
      if (storage.getItem(SIGNED_KEY) !== '1') continue;
      const raw = storage.getItem(PROFILE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.id) continue;
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearDriverSession() {
  try {
    const prev = getDriverSession();
    clearDriverKeysFrom(localStorage);
    clearDriverKeysFrom(sessionStorage);
    // Best-effort: drop this device's FCM token so offline rings stop after logout.
    if (prev?.id) {
      try {
        // Dynamic import avoids circular deps at module load.
        void import('./driverPush').then((m) => m.clearDriverPushToken(prev.id)).catch(() => {});
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

export function isDriverSignedIn() {
  try {
    return Boolean(getDriverSession()?.id);
  } catch {
    return false;
  }
}

/** Last email used with Remember me (for login form prefill). */
export function getRememberedDriverEmail() {
  try {
    return String(localStorage.getItem(REMEMBER_EMAIL_KEY) || '').trim();
  } catch {
    return '';
  }
}

/** @param {string | null | undefined} email */
export function setRememberedDriverEmail(email) {
  try {
    const v = String(email || '').trim().toLowerCase();
    if (v) localStorage.setItem(REMEMBER_EMAIL_KEY, v);
    else localStorage.removeItem(REMEMBER_EMAIL_KEY);
  } catch {
    // ignore
  }
}

/** Whether the driver wants to receive live offers (persists across app reopens). */
export function getDriverOnlinePreference() {
  try {
    const raw = localStorage.getItem(ONLINE_KEY);
    if (raw === null) {
      // Migrate legacy tab-only preference once.
      const legacy = sessionStorage.getItem(ONLINE_KEY);
      if (legacy !== null) {
        localStorage.setItem(ONLINE_KEY, legacy);
        return legacy === '1';
      }
      return true;
    }
    return raw === '1';
  } catch {
    return true;
  }
}

/** @param {boolean} online */
export function setDriverOnlinePreference(online) {
  try {
    localStorage.setItem(ONLINE_KEY, online ? '1' : '0');
  } catch {
    // ignore
  }
}
