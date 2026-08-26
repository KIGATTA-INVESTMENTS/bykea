/**
 * Supabase Edge: **stripe-payment** ??? create PaymentIntent + finalize after client confirms (no webhook).
 *
 * Deploy:
 *   supabase functions deploy stripe-payment --no-verify-jwt
 *
 * Secrets:
 *   supabase secrets set STRIPE_SECRET_KEY=sk_test_...   # or sk_live_...
 *
 * Frontend: set `REACT_APP_STRIPE_PUBLISHABLE_KEY` (pk_test_... / pk_live_...) for Stripe.js only.
 * Never put the secret key in the React app.
 *
 * Body (JSON):
 *   { "action": "create_payment_intent", "orderKind": "...", "orderId": "<uuid>" }
 *   { "action": "finalize_payment_intent", "orderKind": "...", "orderId": "<uuid>", "paymentIntentId": "pi_..." }
 *   Hosted Checkout (user pays on stripe.com):
 *   { "action": "create_checkout_session", "orderKind": "...", "orderId": "<uuid>", "returnOrigin": "http://localhost:3000", "cancelPath": "/shop/cart" }
 *   { "action": "finalize_checkout_session", "sessionId": "cs_..." }
 *
 * Production return origins (comma-separated OK):
 *   supabase secrets set STRIPE_PUBLIC_SITE_URL=https://ingo-92d5f.web.app
 * Also accepts `PUBLIC_APP_URL`. Defaults include this project's Firebase Hosting origins.
 *
 * `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are auto-injected on hosted Supabase.
 *
 * (Hosted deploy bundles **only** `index.ts` ??? no sibling imports.)
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type OrderKind = 'shop' | 'delivery' | 'taxi' | 'tuk' | 'driver_deposit' | 'customer_wallet';

type StripeErr = { error?: { message?: string; type?: string } };

type StripePI = {
  id?: string;
  client_secret?: string | null;
  status?: string;
  amount?: number;
  amount_received?: number;
  currency?: string;
  metadata?: Record<string, string>;
};

async function stripeFormPost(secret: string, path: string, form: URLSearchParams): Promise<StripePI & StripeErr> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  return (await res.json()) as StripePI & StripeErr;
}

async function stripeGet(secret: string, path: string): Promise<StripePI & StripeErr> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  return (await res.json()) as StripePI & StripeErr;
}

function gbpToPence(gbp: number): number {
  return Math.round(Number(gbp) * 100);
}

function penceToGbp(pence: number): number {
  return Math.round(pence) / 100;
}

/** Built-in Firebase Hosting origins for this repo (see `.firebaserc` / `server/index.js`). */
const DEFAULT_PUBLIC_ORIGINS = [
  'https://ingo-92d5f.web.app',
  'https://ingo-92d5f.firebaseapp.com',
];

function parseOriginAllowlist(): string[] {
  const fromEnv = [
    Deno.env.get('STRIPE_PUBLIC_SITE_URL') || '',
    Deno.env.get('PUBLIC_APP_URL') || '',
  ]
    .join(',')
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const origins = new Set<string>([...DEFAULT_PUBLIC_ORIGINS, ...fromEnv]);
  const normalized: string[] = [];
  for (const raw of origins) {
    try {
      normalized.push(new URL(raw).origin);
    } catch {
      // skip invalid entries
    }
  }
  return normalized;
}

function isAllowedReturnOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return true;
    const allowed = parseOriginAllowlist();
    return allowed.includes(u.origin);
  } catch {
    return false;
  }
}

function checkoutProductName(orderKind: OrderKind): string {
  if (orderKind === 'shop') return 'Shop order';
  if (orderKind === 'delivery') return 'Delivery';
  if (orderKind === 'taxi') return 'Taxi booking';
  if (orderKind === 'tuk') return 'Tuk-tuk booking';
  if (orderKind === 'customer_wallet') return 'Wallet top-up';
  return 'Driver deposit';
}

async function readExpectedAmountGbp(
  supabase: ReturnType<typeof createClient>,
  orderKind: OrderKind,
  orderId: string,
): Promise<{ ok: true; amountGbp: number } | { ok: false; reason: string }> {
  if (orderKind === 'shop') {
    const { data, error } = await supabase
      .from('shop_customer_orders')
      .select('subtotal, delivery_fee')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: error?.message || 'shop order not found' };
    const sub = Number(data.subtotal) || 0;
    const df = Number(data.delivery_fee) || 0;
    return { ok: true, amountGbp: Math.round((sub + df) * 100) / 100 };
  }
  if (orderKind === 'delivery') {
    const { data, error } = await supabase
      .from('customer_delivery_orders')
      .select('total_amount')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: error?.message || 'delivery order not found' };
    return { ok: true, amountGbp: Math.round(Number(data.total_amount) * 100) / 100 };
  }
  if (orderKind === 'taxi') {
    const { data, error } = await supabase
      .from('taxi_bookings')
      .select('quoted_price')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: error?.message || 'taxi booking not found' };
    return { ok: true, amountGbp: Math.round(Number(data.quoted_price) * 100) / 100 };
  }
  if (orderKind === 'tuk') {
    const { data, error } = await supabase
      .from('tuk_tuk_bookings')
      .select('quoted_price')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: error?.message || 'tuk booking not found' };
    return { ok: true, amountGbp: Math.round(Number(data.quoted_price) * 100) / 100 };
  }
  if (orderKind === 'driver_deposit') {
    const { data, error } = await supabase
      .from('driver_wallet_topups')
      .select('amount_gbp')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: error?.message || 'top-up row not found' };
    return { ok: true, amountGbp: Math.round(Number(data.amount_gbp) * 100) / 100 };
  }
  if (orderKind === 'customer_wallet') {
    const { data, error } = await supabase
      .from('customer_wallet_topups')
      .select('amount_gbp')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: error?.message || 'customer wallet top-up not found' };
    return { ok: true, amountGbp: Math.round(Number(data.amount_gbp) * 100) / 100 };
  }
  return { ok: false, reason: 'unknown orderKind' };
}

async function incrementDriverDepositAfterTopup(
  supabase: ReturnType<typeof createClient>,
  driverId: string,
  addAmt: number,
) {
  if (!Number.isFinite(addAmt) || addAmt <= 0 || !driverId) return;
  const { data: curRow, error: curErr } = await supabase
    .from('driver_registrations')
    .select('driver_deposit_balance_gbp')
    .eq('id', driverId)
    .maybeSingle();
  if (curErr || !curRow) return;
  const cur = Number(curRow.driver_deposit_balance_gbp) || 0;
  const next = Math.round((cur + addAmt) * 100) / 100;
  const depositPaid = next >= 10;
  await supabase
    .from('driver_registrations')
    .update({ driver_deposit_balance_gbp: next, deposit_paid: depositPaid })
    .eq('id', driverId);
}

async function creditCustomerWalletAfterTopup(
  supabase: ReturnType<typeof createClient>,
  topupId: string,
) {
  if (!topupId) return;
  const { error } = await supabase.rpc('credit_customer_wallet_from_topup', { p_topup_id: topupId });
  if (!error) return;

  // Fallback if RPC is missing: credit inline (still idempotent via credited_at).
  const { data: top } = await supabase
    .from('customer_wallet_topups')
    .select('id, user_id, amount_gbp, payment_status, credited_at, package_label, km_credits')
    .eq('id', topupId)
    .maybeSingle();
  if (!top || String(top.payment_status || '').toLowerCase() !== 'paid' || top.credited_at) return;
  const addAmt = Number(top.amount_gbp);
  const userId = String(top.user_id || '');
  if (!Number.isFinite(addAmt) || addAmt <= 0 || !userId) return;

  await supabase.from('customer_wallets').upsert({ user_id: userId, balance_gbp: 0 }, { onConflict: 'user_id', ignoreDuplicates: true });
  const { data: w } = await supabase.from('customer_wallets').select('balance_gbp').eq('user_id', userId).maybeSingle();
  const cur = Number(w?.balance_gbp) || 0;
  const next = Math.round((cur + addAmt) * 100) / 100;
  await supabase.from('customer_wallets').update({ balance_gbp: next, updated_at: new Date().toISOString() }).eq('user_id', userId);
  await supabase.from('customer_wallet_transactions').insert({
    user_id: userId,
    entry_type: 'credit',
    amount_gbp: addAmt,
    balance_after: next,
    label: String(top.package_label || 'Wallet top-up'),
    package_label: top.package_label || null,
    km_credits: top.km_credits ?? null,
    ref_type: 'topup',
    ref_id: top.id,
  });
  await supabase.from('customer_wallet_topups').update({ credited_at: new Date().toISOString() }).eq('id', topupId);
}

const ORDER_KINDS = ['shop', 'delivery', 'taxi', 'tuk', 'driver_deposit', 'customer_wallet'] as const;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('STRIPE_SECRET_KEY')?.trim() || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';

  if (!secret || !supabaseUrl || !serviceKey) {
    return json(
      {
        error:
          'Missing STRIPE_SECRET_KEY or Supabase env. Set secret: supabase secrets set STRIPE_SECRET_KEY=sk_...',
      },
      500,
    );
  }

  let body: {
    action?: string;
    orderKind?: OrderKind;
    orderId?: string;
    paymentIntentId?: string;
    sessionId?: string;
    returnOrigin?: string;
    cancelPath?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const action = String(body.action || '').trim();
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === 'finalize_checkout_session') {
    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId) return json({ error: 'sessionId is required.' }, 400);

    const sessPath = `checkout/sessions/${encodeURIComponent(sessionId)}`;
    const session = (await stripeGet(secret, sessPath)) as unknown as StripePI & {
      payment_status?: string;
      status?: string;
      amount_total?: number;
      metadata?: Record<string, string>;
      payment_intent?: string | { id?: string };
    };
    if (session.error?.message) {
      return json({ error: session.error.message, stripeType: session.error.type || null }, 400);
    }
    const total = typeof session.amount_total === 'number' ? session.amount_total : 0;
    const paidOk =
      String(session.payment_status || '').toLowerCase() === 'paid' ||
      (String(session.status || '').toLowerCase() === 'complete' && total > 0);
    if (!paidOk) {
      return json({ error: `Checkout not completed (payment_status=${session.payment_status}, status=${session.status}).` }, 400);
    }

    const meta = session.metadata || {};
    const orderKind = String(meta.order_kind || '') as OrderKind;
    const orderId = String(meta.order_id || '').trim();
    if (!orderId || !ORDER_KINDS.includes(orderKind as (typeof ORDER_KINDS)[number])) {
      return json({ error: 'Checkout session is missing order metadata.' }, 400);
    }

    const exp = await readExpectedAmountGbp(supabase, orderKind, orderId);
    if (!exp.ok) return json({ error: exp.reason }, 400);
    const expectedPence = gbpToPence(exp.amountGbp);
    if (Math.abs(total - expectedPence) > 2) {
      return json(
        { error: 'Paid amount does not match order total.', expectedPence, received: total },
        400,
      );
    }

    let piId = '';
    const piField = session.payment_intent;
    if (typeof piField === 'string') piId = piField;
    else if (piField && typeof piField === 'object' && typeof piField.id === 'string') piId = piField.id;
    if (!piId) return json({ error: 'No PaymentIntent on checkout session.' }, 400);

    const paidAt = new Date().toISOString();
    const paidPatch = {
      payment_gateway: 'stripe',
      payment_status: 'paid',
      payment_completed_at: paidAt,
      stripe_payment_intent_id: piId,
    };

    if (orderKind === 'shop') {
      const { data: row } = await supabase
        .from('shop_customer_orders')
        .select('payment_status')
        .eq('id', orderId)
        .maybeSingle();
      if (String(row?.payment_status || '').toLowerCase() === 'paid') {
        return json({ ok: true, alreadyPaid: true, orderKind, orderId });
      }
      const { error } = await supabase.from('shop_customer_orders').update(paidPatch).eq('id', orderId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, orderKind, orderId });
    }

    if (orderKind === 'delivery') {
      const { data: row } = await supabase
        .from('customer_delivery_orders')
        .select('payment_status')
        .eq('id', orderId)
        .maybeSingle();
      if (String(row?.payment_status || '').toLowerCase() === 'paid') {
        return json({ ok: true, alreadyPaid: true, orderKind, orderId });
      }
      const { error } = await supabase.from('customer_delivery_orders').update(paidPatch).eq('id', orderId);
      if (error) return json({ error: error.message }, 500);
      void fetch(`${supabaseUrl}/functions/v1/driver-offer-push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ table: 'customer_delivery_orders', orderId }),
      }).catch(() => {});
      return json({ ok: true, orderKind, orderId });
    }

    if (orderKind === 'taxi' || orderKind === 'tuk') {
      const table = orderKind === 'taxi' ? 'taxi_bookings' : 'tuk_tuk_bookings';
      const { data: row } = await supabase.from(table).select('payment_status').eq('id', orderId).maybeSingle();
      if (String(row?.payment_status || '').toLowerCase() === 'paid') {
        return json({ ok: true, alreadyPaid: true, orderKind, orderId });
      }
      const { error } = await supabase.from(table).update(paidPatch).eq('id', orderId);
      if (error) return json({ error: error.message }, 500);
      void fetch(`${supabaseUrl}/functions/v1/driver-offer-push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ table, orderId }),
      }).catch(() => {});
      return json({ ok: true, orderKind, orderId });
    }

    if (orderKind === 'driver_deposit') {
      const { data: top } = await supabase
        .from('driver_wallet_topups')
        .select('id, driver_id, amount_gbp, payment_status')
        .eq('id', orderId)
        .maybeSingle();
      if (!top) return json({ error: 'Top-up row not found.' }, 404);
      if (String(top.payment_status || '').toLowerCase() === 'paid') {
        return json({ ok: true, alreadyPaid: true, orderKind, orderId });
      }
      const { error } = await supabase.from('driver_wallet_topups').update(paidPatch).eq('id', orderId);
      if (error) return json({ error: error.message }, 500);
      const addAmt = penceToGbp(total);
      await incrementDriverDepositAfterTopup(supabase, String(top.driver_id), addAmt);
      return json({ ok: true, orderKind, orderId });
    }

    if (orderKind === 'customer_wallet') {
      const { data: top } = await supabase
        .from('customer_wallet_topups')
        .select('id, payment_status')
        .eq('id', orderId)
        .maybeSingle();
      if (!top) return json({ error: 'Customer wallet top-up not found.' }, 404);
      if (String(top.payment_status || '').toLowerCase() === 'paid') {
        await creditCustomerWalletAfterTopup(supabase, orderId);
        return json({ ok: true, alreadyPaid: true, orderKind, orderId });
      }
      const { error } = await supabase.from('customer_wallet_topups').update(paidPatch).eq('id', orderId);
      if (error) return json({ error: error.message }, 500);
      await creditCustomerWalletAfterTopup(supabase, orderId);
      return json({ ok: true, orderKind, orderId });
    }

    return json({ error: 'Unsupported orderKind in session metadata.' }, 400);
  }

  const orderKind = body.orderKind as OrderKind;
  const orderId = String(body.orderId || '').trim();
  const paymentIntentId = String(body.paymentIntentId || '').trim();

  if (!orderId || !ORDER_KINDS.includes(orderKind as (typeof ORDER_KINDS)[number])) {
    return json({ error: 'orderKind and orderId are required.' }, 400);
  }

  if (action === 'create_checkout_session') {
    const returnOrigin = String(body.returnOrigin || '').trim().replace(/\/$/, '');
    const cancelPathRaw = String(body.cancelPath || '/').trim() || '/';
    if (!returnOrigin || !isAllowedReturnOrigin(returnOrigin)) {
      const allowed = parseOriginAllowlist();
      return json(
        {
          error:
            `Invalid returnOrigin (${returnOrigin || 'missing'}). Localhost is allowed; for production set Supabase secret STRIPE_PUBLIC_SITE_URL (or PUBLIC_APP_URL) to your app origin. Allowed: ${allowed.join(', ') || '(none configured)'}.`,
        },
        400,
      );
    }

    const exp = await readExpectedAmountGbp(supabase, orderKind, orderId);
    if (!exp.ok) return json({ error: exp.reason }, 400);
    const amountPence = gbpToPence(exp.amountGbp);
    if (amountPence < 50) {
      return json({ error: 'Amount too small for Stripe (minimum ~$0.50).' }, 400);
    }

    const successUrl = `${returnOrigin}/stripe-return?session_id={CHECKOUT_SESSION_ID}`;
    const cancelPath = cancelPathRaw.startsWith('/') ? cancelPathRaw : `/${cancelPathRaw}`;
    const cancelUrl = `${returnOrigin}${cancelPath}`;

    const form = new URLSearchParams();
    form.append('mode', 'payment');
    form.append('success_url', successUrl);
    form.append('cancel_url', cancelUrl);
    form.append('metadata[order_kind]', orderKind);
    form.append('metadata[order_id]', orderId);
    form.append('line_items[0][price_data][currency]', 'usd');
    form.append('line_items[0][price_data][unit_amount]', String(amountPence));
    form.append('line_items[0][price_data][product_data][name]', checkoutProductName(orderKind).slice(0, 120));
    form.append('line_items[0][quantity]', '1');

    const sess = (await stripeFormPost(secret, 'checkout/sessions', form)) as StripePI & {
      url?: string | null;
    };
    const sid = String(sess.id || '');
    const url = String(sess.url || '');
    if (sess.error?.message || !sid || !url) {
      return json(
        {
          error: sess.error?.message || 'Stripe did not return a Checkout Session URL.',
          stripeType: sess.error?.type || null,
        },
        400,
      );
    }

    const started = new Date().toISOString();
    const patch = {
      payment_gateway: 'stripe',
      payment_status: 'pending',
      stripe_payment_intent_id: sid,
      payment_started_at: started,
    };

    let updErr: { message?: string } | null = null;
    if (orderKind === 'shop') {
      const { error } = await supabase.from('shop_customer_orders').update(patch).eq('id', orderId);
      updErr = error;
    } else if (orderKind === 'delivery') {
      const { error } = await supabase.from('customer_delivery_orders').update(patch).eq('id', orderId);
      updErr = error;
    } else if (orderKind === 'taxi') {
      const { error } = await supabase.from('taxi_bookings').update(patch).eq('id', orderId);
      updErr = error;
    } else if (orderKind === 'tuk') {
      const { error } = await supabase.from('tuk_tuk_bookings').update(patch).eq('id', orderId);
      updErr = error;
    } else if (orderKind === 'driver_deposit') {
      const { error } = await supabase.from('driver_wallet_topups').update(patch).eq('id', orderId);
      updErr = error;
    } else if (orderKind === 'customer_wallet') {
      const { error } = await supabase.from('customer_wallet_topups').update(patch).eq('id', orderId);
      updErr = error;
    }

    if (updErr) {
      return json({ error: 'Could not link Checkout Session to order.', details: updErr.message }, 500);
    }

    return json({ ok: true, url, sessionId: sid, amountGbp: exp.amountGbp });
  }

  if (action === 'create_payment_intent') {
    const exp = await readExpectedAmountGbp(supabase, orderKind, orderId);
    if (!exp.ok) return json({ error: exp.reason }, 400);
    const amountPence = gbpToPence(exp.amountGbp);
    if (amountPence < 50) {
      return json({ error: 'Amount too small for Stripe (minimum ~$0.50).' }, 400);
    }

    const form = new URLSearchParams();
    form.append('amount', String(amountPence));
    form.append('currency', 'usd');
    form.append('payment_method_types[]', 'card');
    form.append('metadata[order_kind]', orderKind);
    form.append('metadata[order_id]', orderId);

    const pi = await stripeFormPost(secret, 'payment_intents', form);
    if (pi.error?.message || !pi.id || !pi.client_secret) {
      return json(
        {
          error: pi.error?.message || 'Stripe did not return a PaymentIntent.',
          stripeType: pi.error?.type || null,
        },
        400,
      );
    }

    const started = new Date().toISOString();
    const patch = {
      payment_gateway: 'stripe',
      payment_status: 'pending',
      stripe_payment_intent_id: pi.id,
      payment_started_at: started,
    };

    let updErr: { message?: string } | null = null;
    if (orderKind === 'shop') {
      const { error } = await supabase.from('shop_customer_orders').update(patch).eq('id', orderId);
      updErr = error;
    } else if (orderKind === 'delivery') {
      const { error } = await supabase.from('customer_delivery_orders').update(patch).eq('id', orderId);
      updErr = error;
    } else if (orderKind === 'taxi') {
      const { error } = await supabase.from('taxi_bookings').update(patch).eq('id', orderId);
      updErr = error;
    } else if (orderKind === 'tuk') {
      const { error } = await supabase.from('tuk_tuk_bookings').update(patch).eq('id', orderId);
      updErr = error;
    } else if (orderKind === 'driver_deposit') {
      const { error } = await supabase.from('driver_wallet_topups').update(patch).eq('id', orderId);
      updErr = error;
    } else if (orderKind === 'customer_wallet') {
      const { error } = await supabase.from('customer_wallet_topups').update(patch).eq('id', orderId);
      updErr = error;
    }

    if (updErr) {
      return json({ error: 'Could not link PaymentIntent to order.', details: updErr.message }, 500);
    }

    return json({
      ok: true,
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      amountGbp: exp.amountGbp,
    });
  }

  if (action === 'finalize_payment_intent') {
    if (!paymentIntentId) return json({ error: 'paymentIntentId is required.' }, 400);

    const pi = await stripeGet(secret, `payment_intents/${encodeURIComponent(paymentIntentId)}`);
    if (pi.error?.message) {
      return json({ error: pi.error.message, stripeType: pi.error.type || null }, 400);
    }
    if (String(pi.status) !== 'succeeded') {
      return json({ error: `Payment not succeeded (status: ${pi.status || 'unknown'}).` }, 400);
    }

    const meta = pi.metadata || {};
    if (String(meta.order_id || '') !== orderId || String(meta.order_kind || '') !== orderKind) {
      return json({ error: 'PaymentIntent metadata does not match this order.' }, 400);
    }

    const exp = await readExpectedAmountGbp(supabase, orderKind, orderId);
    if (!exp.ok) return json({ error: exp.reason }, 400);
    const expectedPence = gbpToPence(exp.amountGbp);
    const received = typeof pi.amount_received === 'number' ? pi.amount_received : expectedPence;
    if (Math.abs(received - expectedPence) > 2) {
      return json(
        { error: 'Paid amount does not match order total. No database update applied.', expectedPence, received },
        400,
      );
    }

    const paidAt = new Date().toISOString();
    const paidPatch = {
      payment_gateway: 'stripe',
      payment_status: 'paid',
      payment_completed_at: paidAt,
      stripe_payment_intent_id: paymentIntentId,
    };

    if (orderKind === 'shop') {
      const { data: row } = await supabase
        .from('shop_customer_orders')
        .select('payment_status')
        .eq('id', orderId)
        .maybeSingle();
      if (String(row?.payment_status || '').toLowerCase() === 'paid') {
        return json({ ok: true, alreadyPaid: true });
      }
      const { error } = await supabase.from('shop_customer_orders').update(paidPatch).eq('id', orderId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (orderKind === 'delivery') {
      const { data: row } = await supabase
        .from('customer_delivery_orders')
        .select('payment_status')
        .eq('id', orderId)
        .maybeSingle();
      if (String(row?.payment_status || '').toLowerCase() === 'paid') {
        return json({ ok: true, alreadyPaid: true });
      }
      const { error } = await supabase.from('customer_delivery_orders').update(paidPatch).eq('id', orderId);
      if (error) return json({ error: error.message }, 500);
      void fetch(`${supabaseUrl}/functions/v1/driver-offer-push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ table: 'customer_delivery_orders', orderId }),
      }).catch(() => {});
      return json({ ok: true });
    }

    if (orderKind === 'taxi' || orderKind === 'tuk') {
      const table = orderKind === 'taxi' ? 'taxi_bookings' : 'tuk_tuk_bookings';
      const { data: row } = await supabase.from(table).select('payment_status').eq('id', orderId).maybeSingle();
      if (String(row?.payment_status || '').toLowerCase() === 'paid') {
        return json({ ok: true, alreadyPaid: true });
      }
      const { error } = await supabase.from(table).update(paidPatch).eq('id', orderId);
      if (error) return json({ error: error.message }, 500);
      void fetch(`${supabaseUrl}/functions/v1/driver-offer-push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ table, orderId }),
      }).catch(() => {});
      return json({ ok: true });
    }

    if (orderKind === 'driver_deposit') {
      const { data: top } = await supabase
        .from('driver_wallet_topups')
        .select('id, driver_id, amount_gbp, payment_status')
        .eq('id', orderId)
        .maybeSingle();
      if (!top) return json({ error: 'Top-up row not found.' }, 404);
      if (String(top.payment_status || '').toLowerCase() === 'paid') {
        return json({ ok: true, alreadyPaid: true });
      }
      const { error } = await supabase.from('driver_wallet_topups').update(paidPatch).eq('id', orderId);
      if (error) return json({ error: error.message }, 500);
      const addAmt = penceToGbp(received);
      await incrementDriverDepositAfterTopup(supabase, String(top.driver_id), addAmt);
      return json({ ok: true });
    }

    if (orderKind === 'customer_wallet') {
      const { data: top } = await supabase
        .from('customer_wallet_topups')
        .select('id, payment_status')
        .eq('id', orderId)
        .maybeSingle();
      if (!top) return json({ error: 'Customer wallet top-up not found.' }, 404);
      if (String(top.payment_status || '').toLowerCase() === 'paid') {
        await creditCustomerWalletAfterTopup(supabase, orderId);
        return json({ ok: true, alreadyPaid: true });
      }
      const { error } = await supabase.from('customer_wallet_topups').update(paidPatch).eq('id', orderId);
      if (error) return json({ error: error.message }, 500);
      await creditCustomerWalletAfterTopup(supabase, orderId);
      return json({ ok: true });
    }

    return json({ error: 'Unsupported orderKind.' }, 400);
  }

  return json({
    error: 'Unknown action. Use create_checkout_session, finalize_checkout_session, create_payment_intent, or finalize_payment_intent.',
  }, 400);
});
