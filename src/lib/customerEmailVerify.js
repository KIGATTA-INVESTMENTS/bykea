import { supabase } from './supabaseClient';
import { parseEdgeFunctionResult } from './edgeFunctionErrors';

/** @typedef {'customer' | 'driver' | 'shop_owner'} EmailVerifyRealm */

/**
 * Ask Edge to email a 6-digit code (matching password on the realm table; unverified only).
 * @param {{ email: string, password: string, realm?: EmailVerifyRealm }} params
 */
export async function customerEmailVerifySend({ email, password, realm = 'customer' }) {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const { data, error } = await supabase.functions.invoke('customer-email-verify', {
    body: { action: 'send', realm, email: String(email).trim().toLowerCase(), password },
  });
  const parsed = await parseEdgeFunctionResult(
    { data, error },
    { action: 'send', fallback: 'Could not send verification email.' },
  );
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, retryAfterSec: parsed.retryAfterSec };
  }
  return { ok: true };
}

/**
 * @param {{ email: string, code: string, realm?: EmailVerifyRealm }} params
 */
export async function customerEmailVerifySubmit({ email, code, realm = 'customer' }) {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const { data, error } = await supabase.functions.invoke('customer-email-verify', {
    body: { action: 'verify', realm, email: String(email).trim().toLowerCase(), code: String(code).trim() },
  });
  const parsed = await parseEdgeFunctionResult(
    { data, error },
    { action: 'verify', fallback: 'Verification failed.' },
  );
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, alreadyVerified: Boolean(data?.alreadyVerified) };
}
