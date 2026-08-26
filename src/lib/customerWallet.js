import { INGO_KM_TOPUP_PACKAGES } from './ingoKilometres';
import { isSupabaseConfigured, supabase } from './supabaseClient';

/** Predefined Ingo Kilometre packages + custom amount on the Top-Up screen. */
export const WALLET_TOPUP_PACKAGES = INGO_KM_TOPUP_PACKAGES;

export const WALLET_TOPUP_MIN = 2;
export const WALLET_TOPUP_MAX = 1000;

/**
 * @param {string} userId
 * @returns {Promise<{ balance: number, error: string | null }>}
 */
export async function fetchCustomerWalletBalance(userId) {
  if (!userId || !isSupabaseConfigured || !supabase) {
    return { balance: 0, error: userId ? 'Supabase is not configured.' : 'Sign in to view your wallet.' };
  }
  const { data, error } = await supabase
    .from('customer_wallets')
    .select('balance_gbp')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (/does not exist|schema cache|Could not find the table/i.test(error.message || '')) {
      return { balance: 0, error: 'Run supabase/customer_wallet.sql in the SQL editor, then refresh.' };
    }
    return { balance: 0, error: error.message || 'Could not load wallet.' };
  }
  return { balance: Math.max(0, Math.round((Number(data?.balance_gbp) || 0) * 100) / 100), error: null };
}

/**
 * @param {string} userId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<{ transactions: object[], error: string | null }>}
 */
export async function fetchCustomerWalletTransactions(userId, opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 40));
  if (!userId || !isSupabaseConfigured || !supabase) {
    return { transactions: [], error: null };
  }
  const { data, error } = await supabase
    .from('customer_wallet_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (/does not exist|schema cache|Could not find the table/i.test(error.message || '')) {
      return { transactions: [], error: 'Run supabase/customer_wallet.sql in the SQL editor, then refresh.' };
    }
    return { transactions: [], error: error.message || 'Could not load transactions.' };
  }
  return { transactions: data || [], error: null };
}

/**
 * Create a pending top-up row before redirecting to Paynow/Stripe.
 * @param {{
 *   userId: string,
 *   amount: number,
 *   packageId?: string | null,
 *   packageLabel?: string | null,
 *   kmCredits?: number | null,
 * }} params
 */
export async function createCustomerWalletTopup({
  userId,
  amount,
  packageId = null,
  packageLabel = null,
  kmCredits = null,
}) {
  if (!userId || !isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Sign in and configure Supabase to top up.') };
  }
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt < WALLET_TOPUP_MIN || amt > WALLET_TOPUP_MAX) {
    return {
      data: null,
      error: new Error(`Enter an amount between $${WALLET_TOPUP_MIN} and $${WALLET_TOPUP_MAX}.`),
    };
  }

  const ref = `ING-CW-${cryptoRandomHex(10)}`;
  const row = {
    user_id: userId,
    amount_gbp: amt,
    currency: 'USD',
    package_id: packageId || null,
    package_label: packageLabel || (kmCredits ? `${kmCredits} km pack` : 'Custom top-up'),
    km_credits: kmCredits != null && Number.isFinite(Number(kmCredits)) ? Number(kmCredits) : null,
    payment_status: 'pending',
    paynow_reference: ref,
  };

  const { data, error } = await supabase.from('customer_wallet_topups').insert(row).select('*').single();
  if (error) {
    if (/does not exist|schema cache|Could not find the table/i.test(error.message || '')) {
      return { data: null, error: new Error('Run supabase/customer_wallet.sql in the SQL editor, then try again.') };
    }
    return { data: null, error: new Error(error.message || 'Could not start top-up.') };
  }
  return { data, error: null };
}

/** Ensure paid top-ups are credited (safe to call after Stripe/Paynow return). */
export async function ensureCustomerWalletTopupCredited(topupId) {
  if (!topupId || !isSupabaseConfigured || !supabase) return { ok: false };
  const { error } = await supabase.rpc('credit_customer_wallet_from_topup', { p_topup_id: topupId });
  if (error) {
    // Fallback if RPC missing: no-op (edge/webhook should credit).
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Debit wallet for a delivery or shop order.
 * @param {{
 *   userId: string,
 *   amount: number,
 *   label?: string,
 *   refType?: string | null,
 *   refId?: string | null,
 * }} params
 * @returns {Promise<{ ok: boolean, balanceAfter?: number, reason?: string, error?: string }>}
 */
export async function debitCustomerWallet({
  userId,
  amount,
  label = 'Order payment',
  refType = null,
  refId = null,
}) {
  if (!userId || !isSupabaseConfigured || !supabase) {
    return { ok: false, reason: 'missing_user', error: 'Sign in to pay with Ingo Kilometres.' };
  }
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, reason: 'invalid_amount', error: 'Invalid payment amount.' };
  }

  const { data, error } = await supabase.rpc('debit_customer_wallet', {
    p_user_id: userId,
    p_amount: amt,
    p_label: label,
    p_ref_type: refType,
    p_ref_id: refId,
  });

  if (error) {
    if (/does not exist|schema cache|Could not find the function|debit_customer_wallet/i.test(error.message || '')) {
      return {
        ok: false,
        reason: 'missing_rpc',
        error: 'Run supabase/customer_wallet_checkout.sql in the SQL editor, then try again.',
      };
    }
    return { ok: false, reason: 'rpc_error', error: error.message || 'Could not debit wallet.' };
  }

  const row = data && typeof data === 'object' ? data : null;
  if (!row?.ok) {
    if (row?.reason === 'insufficient_balance') {
      return {
        ok: false,
        reason: 'insufficient_balance',
        balanceAfter: Number(row.balance) || 0,
        error: 'Insufficient Ingo Kilometres balance. Top up or pay with cash.',
      };
    }
    return {
      ok: false,
      reason: row?.reason || 'debit_failed',
      error: 'Could not pay with Ingo Kilometres.',
    };
  }

  return {
    ok: true,
    balanceAfter: Number(row.balance_after) || 0,
    already: Boolean(row.already),
  };
}

/**
 * Admin credits a customer wallet (bank transfer / cash at office).
 * Appears on the customer Wallet transaction list.
 * @param {{
 *   userId: string,
 *   amount: number,
 *   source?: 'bank_transfer' | 'cash' | 'admin',
 *   label?: string,
 *   note?: string,
 * }} params
 */
export async function adminCreditCustomerWallet({
  userId,
  amount,
  source = 'admin',
  label = '',
  note = '',
}) {
  if (!userId || !isSupabaseConfigured || !supabase) {
    return { ok: false, error: 'Supabase is not configured.' };
  }
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, error: 'Enter a positive amount.' };
  }

  const { data, error } = await supabase.rpc('credit_customer_wallet_admin', {
    p_user_id: userId,
    p_amount: amt,
    p_label: label || null,
    p_source: source,
    p_note: note || null,
  });

  if (error) {
    if (/does not exist|schema cache|Could not find the function|credit_customer_wallet_admin/i.test(error.message || '')) {
      return {
        ok: false,
        error: 'Run supabase/admin_customer_wallet.sql in the SQL editor, then try again.',
      };
    }
    return { ok: false, error: error.message || 'Could not credit wallet.' };
  }

  const row = data && typeof data === 'object' ? data : null;
  if (!row?.ok) {
    return { ok: false, error: row?.reason || 'Could not credit wallet.' };
  }
  return {
    ok: true,
    balanceAfter: Number(row.balance_after) || 0,
    transactionId: row.transaction_id || null,
    label: row.label || null,
  };
}

function cryptoRandomHex(len) {
  const n = Math.max(4, Math.min(32, Number(len) || 10));
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(Math.ceil(n / 2));
      crypto.getRandomValues(bytes);
      return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, n);
    }
  } catch {
    // ignore
  }
  return Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
