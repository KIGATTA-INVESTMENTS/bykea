/** Valid referral / promo codes — keep in sync with supabase/referral_codes.sql */
export const REFERRAL_CODES = [
  'INGO-PROMO01',
  'INGO-PROMO02',
  'INGO-PROMO03',
  'INGO-PROMO04',
  'INGO-PROMO05',
  'INGO-PROMO06',
  'INGO-PROMO07',
  'INGO-PROMO08',
  'INGO-PROMO09',
  'INGO-PROMO10',
  'INGO-PROMO11',
  'INGO-PROMO12',
  'INGO-PROMO13',
  'INGO-PROMO14',
  'INGO-PROMO15',
  'INGO-PROMO16',
  'INGO-PROMO17',
  'INGO-PROMO18',
  'INGO-PROMO19',
  'INGO-PROMO20',
];

const CODE_SET = new Set(REFERRAL_CODES);

/** @param {string} raw */
export function normalizeReferralCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase();
}

/**
 * Optional field: empty is OK; non-empty must match a known code.
 * @param {string} raw
 * @returns {{ ok: true, value: string | null } | { ok: false, error: string }}
 */
export function validateReferralCodeOptional(raw) {
  const value = normalizeReferralCode(raw);
  if (!value) return { ok: true, value: null };
  if (!CODE_SET.has(value)) {
    return { ok: false, error: 'Invalid referral code. Please check the code and try again.' };
  }
  return { ok: true, value };
}
