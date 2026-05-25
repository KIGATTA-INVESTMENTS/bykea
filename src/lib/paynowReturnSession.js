/** After Paynow redirect, React Router state is lost — use sessionStorage for return path. */

export const PAYNOW_RETURN_SESSION_KEY = 'bykea_paynow_return_v1';

/**
 * @param {string} path — e.g. `/driver/wallet`
 */
export function writePaynowReturnPath(path) {
  try {
    sessionStorage.setItem(
      PAYNOW_RETURN_SESSION_KEY,
      JSON.stringify({ path: String(path || '/'), at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

/** @returns {string | null} */
export function takePaynowReturnPath() {
  try {
    const raw = sessionStorage.getItem(PAYNOW_RETURN_SESSION_KEY);
    sessionStorage.removeItem(PAYNOW_RETURN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const path = parsed?.path;
    return typeof path === 'string' && path.startsWith('/') ? path : null;
  } catch {
    return null;
  }
}

/** @returns {string | null} — read without clearing (for redirect checks) */
export function peekPaynowReturnPath() {
  try {
    const raw = sessionStorage.getItem(PAYNOW_RETURN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const path = parsed?.path;
    return typeof path === 'string' && path.startsWith('/') ? path : null;
  } catch {
    return null;
  }
}
