/**
 * EcoCash Instant Payments — CRA → Supabase Edge Functions.
 */
import { isSupabaseConfigured, supabase } from './supabaseClient';

/**
 * Supabase FunctionsHttpError often only says "non-2xx"; pull `{ error }` from the response body.
 * @param {{ data?: Record<string, unknown> | null, error?: { message?: string, context?: Response } | null }} result
 * @param {string} fallback
 */
async function readEcocashEdgeFailure(result, fallback) {
  const { data, error } = result || {};
  if (data && typeof data === 'object' && data.error) {
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
    // ignore
  }

  const msg = serverError || error.message || fallback;
  const lower = String(msg).toLowerCase();
  if (lower.includes('non-2xx') || lower.includes('edge function returned')) {
    return {
      ok: false,
      error:
        'EcoCash failed on the server. Deploy ecocash-payment / ecocash-notify and set ECOCASH_* secrets in Supabase.',
      details,
    };
  }
  return { ok: false, error: msg, details };
}

/**
 * @param {{
 *   orderId: string,
 *   orderNumber: string,
 *   amount: number,
 *   phone: string,
 *   orderKind?: 'shop' | 'delivery' | 'taxi' | 'tuk' | 'customer_wallet' | 'driver_deposit',
 *   customerName?: string,
 *   remarks?: string,
 * }} params
 */
export async function postEcocashCharge(params) {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: 'Supabase is not configured.' };
  }

  const result = await supabase.functions.invoke('ecocash-payment', {
    body: { action: 'charge', ...params },
  });

  if (result.error || (result.data && result.data.ok === false)) {
    if (result.data && typeof result.data === 'object' && result.data.ok === false) {
      return result.data;
    }
    return readEcocashEdgeFailure(result, 'EcoCash charge invoke failed.');
  }
  if (result.data && typeof result.data === 'object') return result.data;
  return { ok: false, error: 'Invalid EcoCash response' };
}

/**
 * @param {{ clientCorrelation: string, phone: string }} params
 */
export async function getEcocashStatus({ clientCorrelation, phone }) {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: 'Supabase is not configured.' };
  }

  const result = await supabase.functions.invoke('ecocash-payment', {
    body: {
      action: 'status',
      clientCorrelation: String(clientCorrelation || ''),
      phone: String(phone || ''),
    },
  });

  if (result.error || (result.data && result.data.ok === false)) {
    if (result.data && typeof result.data === 'object' && result.data.ok === false) {
      return result.data;
    }
    return readEcocashEdgeFailure(result, 'EcoCash status invoke failed.');
  }
  if (result.data && typeof result.data === 'object') return result.data;
  return { ok: false, error: 'Invalid status response' };
}
