/**
 * Parse Supabase Edge Function invoke results and return friendly copy for the UI.
 * @param {{ data?: Record<string, unknown> | null, error?: { message?: string, context?: Response } | null }} result
 * @param {{ fallback?: string, action?: 'send' | 'verify' | 'generic' }} [opts]
 */
export async function parseEdgeFunctionResult({ data, error }, opts = {}) {
  const { fallback = 'Something went wrong. Please try again.', action = 'generic' } = opts;

  if (data?.error || data?.ok === false) {
    return {
      ok: false,
      error: friendlyEdgeMessage(String(data.error || fallback), action),
      retryAfterSec: data.retryAfterSec,
    };
  }

  if (!error) {
    if (data?.ok) return { ok: true, data };
    return { ok: false, error: fallback };
  }

  let serverError = '';
  try {
    const ctx = error.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      if (body?.error) serverError = String(body.error);
      if (!serverError && body?.message) serverError = String(body.message);
    }
  } catch {
    // ignore parse errors
  }

  const raw = serverError || error.message || '';
  return {
    ok: false,
    error: friendlyEdgeMessage(raw, action),
    retryAfterSec: data?.retryAfterSec,
  };
}

/** @param {string} raw @param {'send' | 'verify' | 'generic'} action */
export function friendlyEdgeMessage(raw, action = 'generic') {
  const msg = String(raw || '').trim();
  const lower = msg.toLowerCase();

  if (
    !msg ||
    lower.includes('non-2xx') ||
    lower.includes('edge function returned') ||
    lower.includes('failed to fetch')
  ) {
    if (action === 'send') {
      return 'We could not send your verification code right now. Please check your email and password, then try again.';
    }
    if (action === 'verify') {
      return 'We could not verify your code right now. Please check your details and try again.';
    }
    return 'Something went wrong. Please try again in a moment.';
  }

  const exact = {
    'Invalid verification code.': 'That verification code is incorrect. Please check the 6 digits in your email and try again.',
    'This code has expired. Request a new one.':
      'This verification code has expired. Tap Resend code below to receive a new one.',
    'No account found for this email.':
      'We could not find an account with that email. Check the spelling or complete registration first.',
    'Email and a 6-digit code are required.': 'Enter your email address and the full 6-digit code from your inbox.',
    'Email and password are required.': 'Enter your email and password to resend the code.',
    'Invalid email or password.': 'That email and password do not match our records. Check your details and try again.',
    'This email is already verified.': 'This email is already verified. You can go back and sign in.',
    'Please wait about a minute before requesting another code.':
      'Please wait about a minute before requesting another code.',
    'Could not send verification email.': 'We could not send the verification email. Please try again shortly.',
    'Verification failed.': 'Verification failed. Please check your code and try again.',
    'Could not verify email.': 'We could not verify your email. Please check your code and try again.',
  };

  if (exact[msg]) return exact[msg];

  if (lower.includes('invalid') && lower.includes('code')) {
    return 'That verification code is incorrect. Please check the 6 digits in your email and try again.';
  }
  if (lower.includes('expired')) {
    return 'This verification code has expired. Tap Resend code below to receive a new one.';
  }
  if (lower.includes('already verified')) {
    return 'This email is already verified. You can go back and sign in.';
  }
  if (lower.includes('wait') && lower.includes('minute')) {
    return msg;
  }

  return msg;
}
