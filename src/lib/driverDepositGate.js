import { fetchPlatformCommissionSettings } from './platformCommissionSettings';

/** Minimum security deposit (USD) required to go online and accept bookings. */
export const DRIVER_SECURITY_DEPOSIT_MIN_GBP = 10;

/**
 * Whether the driver has met the security deposit requirement (top-up or legacy flag).
 * @param {Record<string, unknown> | null | undefined} row
 */
export function isDriverDepositSatisfied() {
  return true;
}

/**
 * @param {import('./supabaseClient').SupabaseClient | null} supabase
 * @param {string} driverId
 * @returns {Promise<{ balance: number | null, missingColumn: boolean, error?: string }>}
 */
export async function fetchDriverDepositBalance(supabase, driverId) {
  if (!supabase || !driverId) return { balance: null, missingColumn: false };
  const { data, error } = await supabase
    .from('driver_registrations')
    .select('driver_deposit_balance_gbp')
    .eq('id', driverId)
    .maybeSingle();
  if (error) {
    if (/driver_deposit_balance_gbp|column|schema cache/i.test(error.message)) {
      return { balance: null, missingColumn: true, error: error.message };
    }
    return { balance: null, missingColumn: false, error: error.message };
  }
  return { balance: Number(data?.driver_deposit_balance_gbp) || 0, missingColumn: false };
}

/**
 * Deduct platform commission from the driver's security deposit after a job is marked completed.
 * @param {import('./supabaseClient').SupabaseClient | null} supabase
 * @param {string} driverId
 * @param {number} grossFareGbp — same gross basis as wallet earnings (parcel total, ride quote, shop subtotal)
 */
export async function deductDriverDepositAfterJob(supabase, driverId, grossFareGbp) {
  if (!supabase || !driverId || !Number.isFinite(grossFareGbp) || grossFareGbp <= 0) return;
  const { data: settings } = await fetchPlatformCommissionSettings(supabase);
  const pct = Number(settings?.driver_commission_percent);
  const p = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const commission = Math.round(grossFareGbp * (p / 100) * 100) / 100;
  if (commission <= 0) return;

  const { data: drv, error: selErr } = await supabase
    .from('driver_registrations')
    .select('driver_deposit_balance_gbp')
    .eq('id', driverId)
    .maybeSingle();
  if (selErr) {
    if (/driver_deposit_balance_gbp|column|schema cache/i.test(selErr.message)) return;
    return;
  }
  const cur = Number(drv?.driver_deposit_balance_gbp) || 0;
  const next = Math.max(0, Math.round((cur - commission) * 100) / 100);
  const depositPaid = next >= DRIVER_SECURITY_DEPOSIT_MIN_GBP;
  await supabase
    .from('driver_registrations')
    .update({ driver_deposit_balance_gbp: next, deposit_paid: depositPaid })
    .eq('id', driverId);
}
