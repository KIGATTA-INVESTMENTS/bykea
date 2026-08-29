/**
 * Supabase Edge: **ecocash-payment** — EcoCash Instant Payments charge + status poll.
 *
 * Deploy:
 *   supabase functions deploy ecocash-payment --no-verify-jwt
 *   supabase functions deploy ecocash-notify --no-verify-jwt
 *
 * Secrets:
 *   supabase secrets set ECOCASH_API_USERNAME=ecocash
 *   supabase secrets set ECOCASH_API_PASSWORD=mobiquity
 *   supabase secrets set ECOCASH_MERCHANT_CODE=8003
 *   supabase secrets set ECOCASH_MERCHANT_PIN=1234
 *   supabase secrets set ECOCASH_MERCHANT_NUMBER=789111401
 * Optional:
 *   ECOCASH_MERCHANT_NAME, ECOCASH_SUPER_MERCHANT_NAME, ECOCASH_TERMINAL_ID,
 *   ECOCASH_LOCATION, ECOCASH_CURRENCY, ECOCASH_COUNTRY_CODE, ECOCASH_API_BASE,
 *   ECOCASH_NOTIFY_URL (defaults to this project's /functions/v1/ecocash-notify)
 *
 * Body:
 *   { "action": "charge", "orderId", "orderNumber", "amount", "phone", "orderKind", ... }
 *   { "action": "status", "clientCorrelation", "phone" }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type OrderKind = 'shop' | 'delivery' | 'taxi' | 'tuk' | 'driver_deposit' | 'customer_wallet';

function ecocashConfig() {
  const base =
    (Deno.env.get('ECOCASH_API_BASE') || '').trim() ||
    'https://payonline.ecocash.co.zw/ecocashGateway-preprod/payment/v1';
  return {
    base: base.replace(/\/$/, ''),
    username: (Deno.env.get('ECOCASH_API_USERNAME') || 'ecocash').trim(),
    password: (Deno.env.get('ECOCASH_API_PASSWORD') || 'mobiquity').trim(),
    merchantCode: (Deno.env.get('ECOCASH_MERCHANT_CODE') || '8003').trim(),
    merchantPin: (Deno.env.get('ECOCASH_MERCHANT_PIN') || '1234').trim(),
    merchantNumber: (Deno.env.get('ECOCASH_MERCHANT_NUMBER') || '789111401').trim(),
    merchantName: (Deno.env.get('ECOCASH_MERCHANT_NAME') || 'InGo').trim(),
    superMerchantName: (Deno.env.get('ECOCASH_SUPER_MERCHANT_NAME') || 'InGo').trim(),
    terminalId: (Deno.env.get('ECOCASH_TERMINAL_ID') || 'INGOWEB001').trim(),
    location: (Deno.env.get('ECOCASH_LOCATION') || 'Harare, Zimbabwe').trim(),
    currency: ((Deno.env.get('ECOCASH_CURRENCY') || 'USD').trim().toUpperCase() || 'USD'),
    countryCode: ((Deno.env.get('ECOCASH_COUNTRY_CODE') || 'ZW').trim() || 'ZW'),
  };
}

function basicAuthHeader(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

function normalizeZwMsisdn(raw: string): string | null {
  let s = String(raw || '').replace(/[^\d+]/g, '').trim();
  if (!s) return null;
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0') && s.length >= 9) s = `263${s.slice(1)}`;
  if (s.startsWith('7') && s.length === 9) s = `263${s}`;
  if (!/^2637\d{8}$/.test(s)) return null;
  return s;
}

function mapEcocashStatus(status: string): 'pending' | 'paid' | 'failed' {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'COMPLETED' || s === 'SUCCESS' || s === 'SUCCESSFUL') return 'paid';
  if (s === 'FAILED' || s === 'REJECTED' || s === 'CANCELLED' || s === 'CANCELED') return 'failed';
  return 'pending';
}

function orderTableForKind(orderKind: OrderKind): string {
  if (orderKind === 'delivery') return 'customer_delivery_orders';
  if (orderKind === 'taxi') return 'taxi_bookings';
  if (orderKind === 'tuk') return 'tuk_tuk_bookings';
  if (orderKind === 'driver_deposit') return 'driver_wallet_topups';
  if (orderKind === 'customer_wallet') return 'customer_wallet_topups';
  return 'shop_customer_orders';
}

function parseOrderKind(raw: unknown): OrderKind {
  const k = String(raw || 'shop').toLowerCase();
  if (k === 'delivery') return 'delivery';
  if (k === 'taxi') return 'taxi';
  if (k === 'tuk' || k === 'tuktuk' || k === 'tuk_tuk') return 'tuk';
  if (k === 'driver_deposit' || k === 'driverdeposit' || k === 'driver_wallet') return 'driver_deposit';
  if (k === 'customer_wallet' || k === 'customerwallet' || k === 'wallet_topup' || k === 'wallet') {
    return 'customer_wallet';
  }
  return 'shop';
}

function extractStatusFromPayload(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  const pa = payload.paymentAmount as Record<string, unknown> | undefined;
  return String(
    payload.transactionOperationStatus ||
      payload.transactionStatus ||
      payload.status ||
      pa?.transactionOperationStatus ||
      '',
  );
}

function extractServerRef(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  const pa = payload.paymentAmount as Record<string, unknown> | undefined;
  return String(
    payload.serverReferenceCode ||
      payload.ecocashReference ||
      pa?.ecocashReference ||
      pa?.originalEcocashReference ||
      '',
  );
}

function newClientCorrelation(): string {
  return `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 16);
}

function sanitizeRemark(raw: string): string {
  return String(raw || 'InGo payment').replace(/[<>&]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) ||
    'InGo payment';
}

function sanitizeReference(raw: string): string {
  const s = String(raw || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return s || `ING${Date.now()}`.slice(0, 40);
}

function substituteVars(text: string, variables: unknown): string {
  let t = text;
  const vars = Array.isArray(variables) ? variables : variables != null ? [variables] : [];
  vars.forEach((v, i) => {
    t = t.replaceAll(`%${i + 1}`, String(v));
  });
  return t;
}

function summarizeEcocashFailure(charge: {
  httpStatus: number;
  body: Record<string, unknown> | null;
  raw: string;
}): string {
  const body = charge.body && typeof charge.body === 'object' ? charge.body : {};
  const reqErr = (body.requestError || body.requesterror) as Record<string, unknown> | undefined;
  const se = (reqErr?.serviceException ||
    reqErr?.policyException ||
    body.serviceException ||
    body.policyException) as Record<string, unknown> | undefined;
  const bits: string[] = [];
  if (se) {
    const text = substituteVars(String(se.text || se.message || ''), se.variables);
    if (text) bits.push(text);
  }
  for (const key of ['remarks', 'error', 'errorMessage', 'message', 'faultstring', 'description']) {
    const v = String(body[key] || '').trim();
    if (v && !bits.includes(v)) bits.push(v);
  }
  if (!bits.length && charge.raw) {
    const clipped = charge.raw.replace(/\s+/g, ' ').trim().slice(0, 240);
    if (clipped) bits.push(clipped);
  }
  let msg = bits.join(' — ') || 'EcoCash charge request failed.';
  const lower = msg.toLowerCase();
  if (/whitelist|not (registered|allowed|authori[sz]ed)|test (environment|platform|msisdn)/i.test(lower)) {
    msg += ' Ask EcoCash to whitelist this phone on preprod, or set production ECOCASH_* secrets.';
  }
  if (charge.httpStatus === 401 || charge.httpStatus === 403) {
    msg += ' Check ECOCASH_API_USERNAME / password and merchant code, pin, and number.';
  }
  if (charge.httpStatus >= 400) msg += ` (HTTP ${charge.httpStatus})`;
  if (charge.httpStatus === 0) msg += ' Could not reach the EcoCash gateway.';
  return msg.replace(/\s+/g, ' ').trim();
}

function isChargeAccepted(charge: { ok: boolean; body: Record<string, unknown> | null }): boolean {
  if (!charge.ok) return false;
  const status = extractStatusFromPayload(charge.body).toUpperCase();
  if (status === 'FAILED' || status === 'REJECTED' || status === 'CANCELLED' || status === 'CANCELED') {
    return false;
  }
  return true;
}

function notifyUrlDefault(): string {
  const fromEnv = (Deno.env.get('ECOCASH_NOTIFY_URL') || '').trim();
  if (fromEnv) return fromEnv;
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  return base ? `${base}/functions/v1/ecocash-notify` : '';
}

async function chargeEcocash(params: {
  amount: number;
  endUserId: string;
  referenceCode: string;
  clientCorrelation: string;
  notifyUrl: string;
  remarks: string;
}) {
  const cfg = ecocashConfig();
  const amt = Math.round(Number(params.amount) * 100) / 100;
  const remarks = sanitizeRemark(params.remarks);
  const referenceCode = sanitizeReference(params.referenceCode);
  const body = {
    clientCorrelation: params.clientCorrelation,
    clientCorrelator: params.clientCorrelation,
    notifyUrl: params.notifyUrl,
    referenceCode,
    tranType: 'MER',
    endUserId: params.endUserId,
    remarks,
    transactionOperationStatus: 'Charged',
    paymentAmount: {
      charginginformation: {
        amount: amt,
        currency: cfg.currency,
        description: remarks || 'InGo Online Payment',
      },
      chargeMetaData: {
        channel: 'WEB',
        purchaseCategoryCode: 'Online Payment',
        onBeHalfOf: cfg.merchantName || 'InGo',
      },
      merchantCode: cfg.merchantCode,
      merchantPin: cfg.merchantPin,
      merchantNumber: cfg.merchantNumber,
      currencyCode: cfg.currency,
      countryCode: cfg.countryCode,
      terminalID: cfg.terminalId,
      location: cfg.location,
      superMerchantName: cfg.superMerchantName,
      merchantName: cfg.merchantName,
    },
  };

  try {
    const res = await fetch(`${cfg.base}/transactions/amount`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(cfg.username, cfg.password),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'InGo-EcoCash/1.0',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let jsonBody: Record<string, unknown> | null = null;
    try {
      jsonBody = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      jsonBody = { raw: text };
    }
    return { httpStatus: res.status, ok: res.ok, body: jsonBody, raw: text };
  } catch (e) {
    return {
      httpStatus: 0,
      ok: false,
      body: null,
      raw: e instanceof Error ? e.message : String(e),
    };
  }
}

async function queryEcocashTransaction(clientCorrelation: string, endUserId: string) {
  const cfg = ecocashConfig();
  const corr = encodeURIComponent(clientCorrelation);
  const msisdn = encodeURIComponent(endUserId);
  const urls = [
    `${cfg.base}/${msisdn}/transactions/amount/${corr}`,
    `${cfg.base}/endUserId/transactions/amount/${corr}`,
    `${cfg.base}/transactions/amount/${corr}`,
  ];

  let last = { httpStatus: 0, ok: false, body: null as Record<string, unknown> | null, raw: '' };
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: basicAuthHeader(cfg.username, cfg.password),
          Accept: 'application/json',
        },
      });
      const text = await res.text();
      let jsonBody: Record<string, unknown> | null = null;
      try {
        jsonBody = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        jsonBody = { raw: text };
      }
      last = { httpStatus: res.status, ok: res.ok, body: jsonBody, raw: text };
      if (res.ok) return last;
    } catch (e) {
      last = { httpStatus: 0, ok: false, body: null, raw: e instanceof Error ? e.message : String(e) };
    }
  }
  return last;
}

export async function applyEcocashPaymentUpdate(opts: {
  clientCorrelation: string;
  statusRaw: string;
  serverReference?: string;
  endUserId?: string;
}) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey || !opts.clientCorrelation) {
    return { ok: false as const, reason: 'misconfigured' };
  }

  const paymentStatus = mapEcocashStatus(opts.statusRaw);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const update: Record<string, unknown> = {
    payment_gateway: 'ecocash',
    payment_status: paymentStatus,
  };
  if (paymentStatus === 'paid') update.payment_completed_at = new Date().toISOString();
  if (opts.serverReference) update.paynow_poll_url = String(opts.serverReference);

  const tables = [
    'shop_customer_orders',
    'customer_delivery_orders',
    'taxi_bookings',
    'tuk_tuk_bookings',
    'customer_wallet_topups',
    'driver_wallet_topups',
  ];

  for (const table of tables) {
    const { data: rows, error: selErr } = await supabase
      .from(table)
      .select('id')
      .eq('paynow_reference', opts.clientCorrelation)
      .limit(2);
    if (selErr || !rows?.length) continue;
    const rowId = String(rows[0].id || '');
    const { error: updErr } = await supabase
      .from(table)
      .update(update)
      .eq('paynow_reference', opts.clientCorrelation);
    if (updErr) return { ok: false as const, reason: updErr.message, table };

    if (paymentStatus === 'paid' && rowId) {
      if (table === 'customer_wallet_topups') {
        await supabase.rpc('credit_customer_wallet_from_topup', { p_topup_id: rowId }).catch(() => {});
      } else if (table === 'driver_wallet_topups') {
        const { data: top } = await supabase
          .from('driver_wallet_topups')
          .select('driver_id, amount_gbp')
          .eq('id', rowId)
          .maybeSingle();
        const driverId = String(top?.driver_id || '');
        const addAmt = Number(top?.amount_gbp);
        if (driverId && Number.isFinite(addAmt) && addAmt > 0) {
          const { data: curRow } = await supabase
            .from('driver_registrations')
            .select('driver_deposit_balance_gbp')
            .eq('id', driverId)
            .maybeSingle();
          if (curRow) {
            const cur = Number(curRow.driver_deposit_balance_gbp) || 0;
            const next = Math.round((cur + addAmt) * 100) / 100;
            await supabase
              .from('driver_registrations')
              .update({ driver_deposit_balance_gbp: next, deposit_paid: next >= 10 })
              .eq('id', driverId);
          }
        }
      } else if (
        table === 'customer_delivery_orders' ||
        table === 'taxi_bookings' ||
        table === 'tuk_tuk_bookings' ||
        table === 'shop_customer_orders'
      ) {
        // Drivers are notified from the waiting page after paid confirmation.
      }
    }

    return {
      ok: true as const,
      kind: table,
      id: rowId || null,
      reference: opts.clientCorrelation,
      paymentStatus,
      statusRaw: opts.statusRaw,
      serverReference: opts.serverReference || null,
    };
  }

  return {
    ok: true as const,
    reason: 'no_matching_order',
    reference: opts.clientCorrelation,
    paymentStatus,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const cfg = ecocashConfig();
    if (!cfg.merchantCode || !cfg.merchantPin || !cfg.merchantNumber) {
      return json({ ok: false, error: 'EcoCash merchant secrets are not configured.' }, 500);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || 'charge').toLowerCase();

    if (action === 'status') {
      const clientCorrelation = String(body.clientCorrelation || body.clientCorrelator || '').trim();
      const phone = normalizeZwMsisdn(String(body.phone || ''));
      if (!clientCorrelation) return json({ ok: false, error: 'clientCorrelation is required.' }, 400);
      if (!phone) return json({ ok: false, error: 'Valid phone (MSISDN) is required.' }, 400);

      const q = await queryEcocashTransaction(clientCorrelation, phone);
      const statusRaw = extractStatusFromPayload(q.body) || (q.ok ? 'CHARGED' : 'FAILED');
      const serverReference = extractServerRef(q.body);
      const paymentStatus = mapEcocashStatus(statusRaw);

      if (paymentStatus === 'paid' || paymentStatus === 'failed') {
        await applyEcocashPaymentUpdate({
          clientCorrelation,
          statusRaw,
          serverReference,
          endUserId: phone,
        });
      }

      return json({
        ok: true,
        clientCorrelation,
        paymentStatus,
        statusRaw,
        serverReference: serverReference || null,
        ecoCash: q.body,
        httpStatus: q.httpStatus,
      });
    }

    // action === charge
    const orderNum = String(body.orderNumber || '').trim();
    const orderUuid = String(body.orderId || '').trim();
    const amt = Number(body.amount);
    const customerName = String(body.customerName || '').trim() || 'Customer';
    const endUserId = normalizeZwMsisdn(String(body.phone || ''));
    const orderKind = parseOrderKind(body.orderKind);

    if (!orderNum || !orderUuid || !Number.isFinite(amt) || amt <= 0) {
      return json({ ok: false, error: 'orderNumber, orderId and amount are required.' }, 400);
    }
    if (!endUserId) {
      return json({
        ok: false,
        error: 'Enter a valid Zimbabwe EcoCash number (e.g. 0771234567 or 263771234567).',
      }, 400);
    }

    const notifyUrl = notifyUrlDefault();
    if (!notifyUrl) {
      return json({ ok: false, error: 'ECOCASH_NOTIFY_URL / SUPABASE_URL missing for notify callback.' }, 500);
    }

    const clientCorrelation = newClientCorrelation();
    const referenceCode = sanitizeReference(orderNum);
    const remarks = sanitizeRemark(
      String(body.remarks || '').trim() ||
        (orderKind === 'delivery'
          ? `Delivery ${orderNum} (${customerName})`
          : orderKind === 'taxi'
            ? `Taxi ${orderNum} (${customerName})`
            : orderKind === 'tuk'
              ? `Tuk-Tuk ${orderNum} (${customerName})`
              : orderKind === 'customer_wallet'
                ? `Wallet top-up ${orderNum}`
                : orderKind === 'driver_deposit'
                  ? `Driver deposit ${orderNum}`
                  : `Shop order ${orderNum} (${customerName})`),
    );

    const charge = await chargeEcocash({
      amount: amt,
      endUserId,
      referenceCode,
      clientCorrelation,
      notifyUrl,
      remarks,
    });

    if (!isChargeAccepted(charge)) {
      console.error('[ecocash-payment] charge failed', charge.httpStatus, String(charge.raw || '').slice(0, 500));
      return json({
        ok: false,
        error: summarizeEcocashFailure(charge),
        details: charge.body || charge.raw,
        httpStatus: charge.httpStatus,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: updErr } = await supabase
        .from(orderTableForKind(orderKind))
        .update({
          payment_method: 'ecocash',
          payment_gateway: 'ecocash',
          payment_status: 'pending',
          paynow_reference: clientCorrelation,
          payment_started_at: new Date().toISOString(),
        })
        .eq('id', orderUuid);
      if (updErr) {
        return json({
          ok: false,
          error: 'EcoCash started but order update failed.',
          details: updErr.message,
          clientCorrelation,
        }, 500);
      }
    }

    return json({
      ok: true,
      clientCorrelation,
      referenceCode,
      phone: endUserId,
      amount: Number(amt.toFixed(2)),
      message: 'Approve the payment on your EcoCash phone when prompted.',
      ecoCashResponse: charge.body,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown EcoCash error' }, 500);
  }
});
