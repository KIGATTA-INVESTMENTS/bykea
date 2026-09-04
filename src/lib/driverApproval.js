import { isSupabaseConfigured, supabase } from './supabaseClient';

/** @param {string | null | undefined} status */
export function isDriverStatusApproved(status) {
  return String(status || '').toLowerCase() === 'approved';
}

/**
 * @param {import('./supabaseClient').SupabaseClient | null | undefined} client
 * @param {string | null | undefined} driverId
 */
export async function fetchDriverRegistrationStatus(client, driverId) {
  if (!client || !driverId) return null;
  const { data, error } = await client
    .from('driver_registrations')
    .select('id, status, email_verified_at')
    .eq('id', driverId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/**
 * @param {import('./supabaseClient').SupabaseClient | null | undefined} client
 * @param {string | null | undefined} driverId
 */
export async function assertDriverCanWork(client, driverId) {
  const row = await fetchDriverRegistrationStatus(client, driverId);
  if (!row) {
    return { ok: false, error: 'Driver account not found.' };
  }
  if (!isDriverStatusApproved(row.status)) {
    return {
      ok: false,
      error:
        'Your account is under approval. You cannot accept or complete jobs until an admin approves your application.',
    };
  }
  return { ok: true };
}

/** Client-side check using default Supabase client. */
/**
 * Tri-state on purpose. `true`: approved. `false`: the database answered and the
 * driver is not approved (or does not exist). `null`: the check could not be made
 * (network, timeout, Supabase down). Callers must not treat `null` as `false`:
 * doing so signed drivers out on every transient error, and a cold start from a
 * notification tap on a weak connection is exactly such an error (seen 2026-09-03).
 * @returns {Promise<boolean | null>}
 */
export async function isCurrentDriverApprovedForWork(driverId) {
  if (!isSupabaseConfigured || !supabase || !driverId) return false;
  const { data, error } = await supabase
    .from('driver_registrations')
    .select('id, status')
    .eq('id', driverId)
    .maybeSingle();
  if (error) {
    console.warn(`[driverApproval] could not check approval, keeping session: ${error.message}`);
    return null;
  }
  if (!data) return false;
  return isDriverStatusApproved(data.status);
}
