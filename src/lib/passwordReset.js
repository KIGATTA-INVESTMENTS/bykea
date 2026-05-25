import { supabase } from './supabaseClient';

/** @typedef {'customer' | 'driver' | 'shop_owner'} PasswordResetRealm */

const LOG_PREFIX = '[InGo password-reset]';

function maskEmail(email) {
  const normalized = String(email).trim().toLowerCase();
  const at = normalized.indexOf('@');
  if (at < 1) return '***';
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const maskedLocal = local.length <= 2 ? '***' : `${local.slice(0, 2)}***`;
  return `${maskedLocal}@${domain}`;
}

function logPasswordReset(event, details = {}) {
  console.log(LOG_PREFIX, event, details);
}

/**
 * @param {{ email: string, realm?: PasswordResetRealm }} params
 * @returns {Promise<{ ok: boolean, error?: string, retryAfterSec?: number, sent?: boolean }>}
 */
export async function passwordResetSend({ email, realm = 'customer' }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  if (!supabase) {
    logPasswordReset('send — Supabase not configured', { realm, email: maskEmail(normalizedEmail) });
    return { ok: false, error: 'Supabase is not configured.' };
  }

  logPasswordReset('send — requesting code', { realm, email: maskEmail(normalizedEmail) });

  const { data, error } = await supabase.functions.invoke('password-reset', {
    body: { action: 'send', realm, email: normalizedEmail },
  });

  if (error) {
    logPasswordReset('send — invoke failed', {
      realm,
      email: maskEmail(normalizedEmail),
      error: error.message,
    });
    return { ok: false, error: error.message || 'Could not send reset email.' };
  }

  if (data?.error) {
    logPasswordReset('send — server returned error', {
      realm,
      email: maskEmail(normalizedEmail),
      error: String(data.error),
      retryAfterSec: data.retryAfterSec ?? null,
      response: data,
    });
    return { ok: false, error: String(data.error), retryAfterSec: data.retryAfterSec };
  }

  if (!data?.ok) {
    logPasswordReset('send — unexpected response', {
      realm,
      email: maskEmail(normalizedEmail),
      response: data,
    });
    return { ok: false, error: 'Could not send reset email.' };
  }

  const emailSent = data.sent === true;
  logPasswordReset(emailSent ? 'send — email sent' : 'send — no email sent (account not found)', {
    realm,
    email: maskEmail(normalizedEmail),
    emailSent,
    accountFound: emailSent,
    response: data,
  });

  return { ok: true, sent: emailSent };
}

/**
 * @param {{ email: string, code: string, newPassword: string, realm?: PasswordResetRealm }} params
 */
export async function passwordResetConfirm({ email, code, newPassword, realm = 'customer' }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  if (!supabase) {
    logPasswordReset('confirm — Supabase not configured', { realm, email: maskEmail(normalizedEmail) });
    return { ok: false, error: 'Supabase is not configured.' };
  }

  logPasswordReset('confirm — submitting new password', { realm, email: maskEmail(normalizedEmail) });

  const { data, error } = await supabase.functions.invoke('password-reset', {
    body: {
      action: 'confirm',
      realm,
      email: normalizedEmail,
      code: String(code).trim(),
      newPassword: String(newPassword),
    },
  });

  if (error) {
    logPasswordReset('confirm — invoke failed', {
      realm,
      email: maskEmail(normalizedEmail),
      error: error.message,
    });
    return { ok: false, error: error.message || 'Could not reset password.' };
  }

  if (data?.error) {
    logPasswordReset('confirm — server returned error', {
      realm,
      email: maskEmail(normalizedEmail),
      error: String(data.error),
      response: data,
    });
    return { ok: false, error: String(data.error) };
  }

  if (!data?.ok) {
    logPasswordReset('confirm — unexpected response', {
      realm,
      email: maskEmail(normalizedEmail),
      response: data,
    });
    return { ok: false, error: 'Password reset failed.' };
  }

  logPasswordReset('confirm — password updated', { realm, email: maskEmail(normalizedEmail) });
  return { ok: true };
}
