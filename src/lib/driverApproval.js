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
  if (!row.email_verified_at) {
    return { ok: false, error: 'Please verify your email before you can work.' };
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
export async function isCurrentDriverApprovedForWork(driverId) {
  if (!isSupabaseConfigured || !supabase || !driverId) return false;
  const row = await fetchDriverRegistrationStatus(supabase, driverId);
  return Boolean(row?.email_verified_at && isDriverStatusApproved(row.status));
}
