const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

/** Digits only — used for national phone validation (7–15 digits). */
export function phoneDigitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * @param {string} value
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateEmailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Please enter your email address.' };
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: 'Please enter a complete email address (e.g. you@email.com).' };
  }
  return { ok: true, value: email };
}

/**
 * @param {string} value National number (without country dial code) or full number.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validatePhoneNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, error: 'Please enter your phone number.' };
  const digits = phoneDigitsOnly(raw);
  if (digits.length < 7) {
    return { ok: false, error: 'Phone number is too short. Enter at least 7 digits.' };
  }
  if (digits.length > 15) {
    return { ok: false, error: 'Phone number is too long. Check and try again.' };
  }
  return { ok: true, value: raw };
}

/** Keep phone input to digits, spaces, dashes, and leading + */
export function sanitizePhoneInput(value) {
  return String(value || '')
    .replace(/[^\d+\s-]/g, '')
    .replace(/(?!^)\+/g, '');
}
