const SIGNED_KEY = 'ingo_driver_signed_in';
const PROFILE_KEY = 'ingo_driver_profile';

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
 * }} profile
 */
export function saveDriverSession(profile) {
  try {
    localStorage.setItem(SIGNED_KEY, '1');
    localStorage.setItem(
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
      }),
    );
  } catch {
    // ignore
  }
}

export function getDriverSession() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDriverSession() {
  try {
    localStorage.removeItem(SIGNED_KEY);
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    // ignore
  }
}

export function isDriverSignedIn() {
  try {
    return localStorage.getItem(SIGNED_KEY) === '1' && Boolean(getDriverSession()?.id);
  } catch {
    return false;
  }
}
