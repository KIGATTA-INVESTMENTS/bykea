/** Shared delivery PIN for customer display and driver confirmation. */
export const DELIVERY_PIN_LENGTH = 6;

/** @returns {string} Numeric delivery PIN */
export function generateDeliveryConfirmationCode() {
  const min = 10 ** (DELIVERY_PIN_LENGTH - 1);
  return String(Math.floor(min + Math.random() * 9 * min));
}

/** @param {string | null | undefined} code */
export function formatDeliveryCodeDisplay(code) {
  const s = String(code || '').replace(/\D/g, '');
  if (s.length === DELIVERY_PIN_LENGTH) return `${s.slice(0, 3)} ${s.slice(3)}`;
  if (s.length === 4) return `${s.slice(0, 2)} ${s.slice(2)}`;
  return s || '—';
}

/**
 * @param {string | null | undefined} raw
 * @param {number} [maxLen]
 */
export function normalizeDeliveryCodeInput(raw, maxLen = DELIVERY_PIN_LENGTH) {
  return String(raw || '').replace(/\D/g, '').slice(0, maxLen);
}

/** Stored PINs are 6 digits (current) or 4 (legacy driver OTP screens). */
export function isStoredDeliveryPin(code) {
  const s = String(code || '').replace(/\D/g, '');
  return s.length === DELIVERY_PIN_LENGTH || s.length === 4;
}

/** @param {string | null | undefined} code */
export function storedDeliveryPin(code) {
  const s = String(code || '').replace(/\D/g, '');
  return isStoredDeliveryPin(s) ? s : '';
}

/**
 * @param {string | null | undefined} entered
 * @param {string | null | undefined} expected
 */
export function deliveryPinsMatch(entered, expected) {
  const a = String(entered || '').replace(/\D/g, '');
  const b = String(expected || '').replace(/\D/g, '');
  return Boolean(a) && a === b;
}

/**
 * @param {string | null | undefined} entered
 * @param {string | null | undefined} expected
 */
export function isCompleteDeliveryPin(entered, expected) {
  const a = String(entered || '').replace(/\D/g, '');
  const b = String(expected || '').replace(/\D/g, '');
  const need = b.length === 4 || b.length === DELIVERY_PIN_LENGTH ? b.length : DELIVERY_PIN_LENGTH;
  return a.length === need;
}

export const DELIVERY_PIN_CUSTOMER_HINT =
  'Share this 6-digit PIN with your driver when they arrive. They enter the same PIN to confirm delivery.';

export const DELIVERY_PIN_DRIVER_HINT =
  'Ask the customer for their 6-digit delivery PIN. It is the same PIN shown in their app.';

export const DELIVERY_PIN_INCOMPLETE_ERROR = 'Enter the full 6-digit PIN the customer gives you.';

export const DELIVERY_PIN_MISMATCH_ERROR =
  'Incorrect PIN. Ask the customer for the delivery PIN shown in their app and try again.';
