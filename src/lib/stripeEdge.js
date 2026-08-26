import { isSupabaseConfigured, supabase } from './supabaseClient';

const RETURN_CTX_KEY = 'bykea_stripe_hosted_return_v1';

/** Publishable key only (safe in browser). Secret key lives in Supabase Edge `stripe-payment`. */
export function getStripePublishableKey() {
  return String(process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY || '').trim();
}

export function isStripePaymentsConfigured() {
  return Boolean(isSupabaseConfigured && supabase && getStripePublishableKey());
}

/**
 * Supabase FunctionsHttpError often only says "non-2xx"; pull `{ error }` from the response body.
 * @param {{ data?: Record<string, unknown> | null, error?: { message?: string, context?: Response } | null }} result
 * @param {string} fallback
 */
async function readStripeEdgeFailure(result, fallback) {
  const { data, error } = result || {};
  if (data?.error) {
    return { ok: false, error: String(data.error), details: data.details || null };
  }
  if (!error) {
    return { ok: false, error: fallback };
  }

  let serverError = '';
  let details = null;
  try {
    const ctx = error.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      if (body?.error) serverError = String(body.error);
      else if (body?.message) serverError = String(body.message);
      if (body?.details) details = body.details;
    }
  } catch {
    // ignore parse errors
  }

  const msg = serverError || error.message || fallback;
  const lower = String(msg).toLowerCase();
  if (lower.includes('non-2xx') || lower.includes('edge function returned')) {
    return {
      ok: false,
      error:
        'Card checkout failed on the server. Confirm Supabase secret STRIPE_SECRET_KEY is set (sk_live_… for production) and redeploy stripe-payment. If you use a custom domain, also set STRIPE_PUBLIC_SITE_URL to that origin.',
      details,
    };
  }
  return { ok: false, error: msg, details };
}

/** Call immediately before redirecting to Stripe Checkout (hosted payment page). */
export function setStripeHostedReturnContext(payload) {
  try {
    sessionStorage.setItem(RETURN_CTX_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function takeStripeHostedReturnContext() {
  try {
    const raw = sessionStorage.getItem(RETURN_CTX_KEY);
    sessionStorage.removeItem(RETURN_CTX_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Redirect browser to Stripe-hosted Checkout (user completes payment on stripe.com).
 * @param {{ orderKind: 'shop' | 'delivery' | 'taxi' | 'tuk' | 'driver_deposit' | 'customer_wallet', orderId: string, cancelPath?: string }} params
 */
export async function stripeHostedCheckoutRedirect({ orderKind, orderId, cancelPath = '/' }) {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const returnOrigin =
    typeof window !== 'undefined' && window.location?.origin ? String(window.location.origin).replace(/\/$/, '') : '';
  if (!returnOrigin) return { ok: false, error: 'Missing window origin for payment return URLs.' };

  const result = await supabase.functions.invoke('stripe-payment', {
    body: {
      action: 'create_checkout_session',
      orderKind,
      orderId,
      returnOrigin,
      cancelPath: cancelPath.startsWith('/') ? cancelPath : `/${cancelPath}`,
    },
  });
  const { data, error } = result;
  if (error || data?.error) {
    return readStripeEdgeFailure(result, 'Could not start card checkout.');
  }
  if (!data?.ok || !data?.url) {
    return { ok: false, error: data?.error || 'Checkout did not return a payment link.' };
  }
  window.location.assign(String(data.url));
  return { ok: true };
}

/**
 * @param {{ sessionId: string }} params
 */
export async function stripeEdgeFinalizeCheckoutSession({ sessionId }) {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const result = await supabase.functions.invoke('stripe-payment', {
    body: { action: 'finalize_checkout_session', sessionId },
  });
  const { data, error } = result;
  if (error || data?.error) {
    return readStripeEdgeFailure(result, 'Could not verify payment.');
  }
  if (!data?.ok) {
    return { ok: false, error: 'Payment verification failed.' };
  }
  return {
    ok: true,
    alreadyPaid: Boolean(data.alreadyPaid),
    orderKind: data.orderKind,
    orderId: data.orderId,
  };
}

/**
 * @param {{ orderKind: 'shop' | 'delivery' | 'taxi' | 'tuk' | 'driver_deposit' | 'customer_wallet', orderId: string }} params
 */
export async function stripeEdgeCreateIntent({ orderKind, orderId }) {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const result = await supabase.functions.invoke('stripe-payment', {
    body: { action: 'create_payment_intent', orderKind, orderId },
  });
  const { data, error } = result;
  if (error || data?.error) {
    return readStripeEdgeFailure(result, 'Could not reach the payment service.');
  }
  if (!data?.ok || !data?.clientSecret) {
    return { ok: false, error: data?.error || 'Could not create payment.' };
  }
  return {
    ok: true,
    clientSecret: data.clientSecret,
    paymentIntentId: data.paymentIntentId,
    amountGbp: data.amountGbp,
  };
}

/**
 * @param {{ orderKind: 'shop' | 'delivery' | 'taxi' | 'tuk' | 'driver_deposit' | 'customer_wallet', orderId: string, paymentIntentId: string }} params
 */
export async function stripeEdgeFinalizeIntent({ orderKind, orderId, paymentIntentId }) {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const result = await supabase.functions.invoke('stripe-payment', {
    body: { action: 'finalize_payment_intent', orderKind, orderId, paymentIntentId },
  });
  const { data, error } = result;
  if (error || data?.error) {
    return readStripeEdgeFailure(result, 'Could not verify payment.');
  }
  if (!data?.ok) {
    return { ok: false, error: 'Payment verification failed.' };
  }
  return { ok: true, alreadyPaid: Boolean(data.alreadyPaid) };
}
