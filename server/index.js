require('dotenv').config({ override: false });

const express = require('express');
const cors = require('cors');
const { Paynow } = require('paynow');
const { createClient } = require('@supabase/supabase-js');
const { processPaynowResult } = require('./paynowResult');
const {
  ecocashConfig,
  normalizeZwMsisdn,
  orderTableForKind,
  chargeEcocash,
  queryEcocashTransaction,
  processEcocashNotify,
  applyEcocashPaymentUpdate,
  extractStatusFromPayload,
  extractServerRef,
  mapEcocashStatus,
} = require('./ecocash');

const PORT = Number(process.env.PORT) || 4000;

/** Public origin of this Paynow API (Railway). Override if you deploy under another host. */
const DEFAULT_PUBLIC_PAYNOW_API =
  String(process.env.PUBLIC_PAYNOW_API_ORIGIN || '').trim() || 'https://bykea-production.up.railway.app';

/** Where shoppers return after Paynow (your CRA / Firebase site). Override with PAYNOW_RETURN_URL or CUSTOMER_APP_PUBLIC_URL. */
const DEFAULT_CUSTOMER_APP =
  String(process.env.CUSTOMER_APP_PUBLIC_URL || '').trim() || 'https://ingo-92d5f.web.app';

const PAYNOW_RESULT_URL =
  String(process.env.PAYNOW_RESULT_URL || '').trim() ||
  `${DEFAULT_PUBLIC_PAYNOW_API.replace(/\/$/, '')}/paynow/result`;
const PAYNOW_RETURN_URL =
  String(process.env.PAYNOW_RETURN_URL || '').trim() ||
  `${DEFAULT_CUSTOMER_APP.replace(/\/$/, '')}/order-confirmation`;

const ECOCASH_NOTIFY_URL =
  String(process.env.ECOCASH_NOTIFY_URL || '').trim() ||
  `${DEFAULT_PUBLIC_PAYNOW_API.replace(/\/$/, '')}/ecocash/notify`;

function paynowCredentialFlags() {
  const id = String(process.env.PAYNOW_INTEGRATION_ID || '').trim();
  const key = String(process.env.PAYNOW_INTEGRATION_KEY || '').trim();
  const eco = ecocashConfig();
  return {
    paynowIntegrationIdSet: Boolean(id),
    paynowIntegrationKeySet: Boolean(key),
    paynowCredentialsReady: Boolean(id && key),
    ecocashMerchantCodeSet: Boolean(eco.merchantCode),
    ecocashMerchantNumberSet: Boolean(eco.merchantNumber),
    ecocashReady: Boolean(eco.username && eco.password && eco.merchantCode && eco.merchantPin && eco.merchantNumber),
  };
}

const app = express();
app.use(
  cors({
    origin: true,
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86_400,
  }),
);

/** Confirms this host is the Paynow API (not the React app) when opened in a browser */
app.get('/', (_req, res) => {
  res.status(200).type('application/json').send({
    ok: true,
    service: 'ingo-paynow-local',
    ...paynowCredentialFlags(),
    hint:
      'Shop/taxi Paynow flows POST to /paynow/initiate. Default CRA origin: https://bykea-production.up.railway.app (override with REACT_APP_SHOP_PAYNOW_LOCAL_URL).',
    endpoints: [
      'GET /health',
      'POST /paynow/initiate',
      'POST /paynow/relay-initiate',
      'POST /paynow/result',
      'POST /ecocash/charge',
      'POST /ecocash/notify',
      'GET /ecocash/status',
    ],
  });
});

/** Railway / load balancer health check (no secrets — only whether vars are present) */
app.get('/health', (_req, res) => {
  res.status(200).type('application/json').send({
    ok: true,
    service: 'ingo-paynow-local',
    ...paynowCredentialFlags(),
    hint:
      'If paynowCredentialsReady is false, add PAYNOW_INTEGRATION_ID and PAYNOW_INTEGRATION_KEY to THIS Railway service (Variables tab), save, redeploy. Project-wide variables must be linked to this service.',
  });
});

const PAYNOW_OFFICIAL_INITIATE =
  process.env.PAYNOW_OFFICIAL_INITIATE_URL?.trim() ||
  'https://www.paynow.co.zw/interface/initiatetransaction';

/**
 * HTTPS relay for Supabase Edge: forwards the same x-www-form-urlencoded body to Paynow.
 * Host this on a machine/region where Paynow accepts TLS (VPS, Railway, Fly, etc.), then set
 * Supabase secrets PAYNOW_INITIATE_URL + PAYNOW_RELAY_SECRET (same secret here).
 */
app.post(
  '/paynow/relay-initiate',
  express.raw({
    type: (req) => String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded'),
    limit: '128kb',
  }),
  async (req, res) => {
    const secret = process.env.PAYNOW_RELAY_SECRET?.trim();
    if (!secret) {
      return res.status(503).type('text/plain').send('Relay not configured (set PAYNOW_RELAY_SECRET).');
    }
    const got = String(req.headers['x-paynow-relay-secret'] || '');
    if (got !== secret) {
      return res.status(403).type('text/plain').send('Forbidden');
    }
    const bodyStr = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    if (!bodyStr) {
      return res.status(400).type('text/plain').send('Empty body');
    }
    try {
      const out = await fetch(PAYNOW_OFFICIAL_INITIATE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/plain, */*',
          Connection: 'close',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
        body: bodyStr,
      });
      const text = await out.text();
      const ct = out.headers.get('content-type') || 'text/plain; charset=utf-8';
      res.status(out.status).set('Content-Type', ct).send(text);
    } catch (e) {
      res
        .status(502)
        .type('text/plain')
        .send(e instanceof Error ? e.message : 'Relay fetch failed');
    }
  },
);

app.use(express.json());

/**
 * Paynow test integrations: if `authemail` is sent, it must equal the merchant’s registered email.
 * Set PAYNOW_MERCHANT_AUTH_EMAIL to that full address, or PAYNOW_OMIT_AUTH_EMAIL=true to send empty.
 */
function resolvePaynowAuthEmail(customerEmailRaw) {
  const merchantMail = process.env.PAYNOW_MERCHANT_AUTH_EMAIL?.trim();
  if (merchantMail) return merchantMail;
  if (process.env.PAYNOW_OMIT_AUTH_EMAIL === 'true') return '';
  return String(customerEmailRaw || '').trim();
}

/** Paynow may POST transaction updates here (same shape as Supabase paynow-result edge). */
app.post(
  '/paynow/result',
  express.raw({
    type: (req) => {
      const ct = String(req.headers['content-type'] || '').toLowerCase();
      return ct.includes('application/x-www-form-urlencoded') || ct.includes('text/plain') || !ct;
    },
    limit: '128kb',
  }),
  async (req, res) => {
    const key = String(process.env.PAYNOW_INTEGRATION_KEY || '').trim();
    const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');

    if (!key || !supabaseUrl || !serviceKey) {
      // eslint-disable-next-line no-console
      console.warn(
        '[paynow/result] Missing PAYNOW_INTEGRATION_KEY and/or Supabase service env — payment rows will not update.',
      );
      res.status(200).send('OK');
      return;
    }

    try {
      const result = await processPaynowResult(rawBody, {
        integrationKey: key,
        supabaseUrl,
        serviceKey,
      });
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.error('[paynow/result] Failed:', result.reason);
        res.status(500).send('ERR');
        return;
      }
      if (result.kind) {
        // eslint-disable-next-line no-console
        console.info(
          `[paynow/result] Updated ${result.kind} ref=${result.reference} → ${result.paymentStatus}`,
        );
      }
      res.status(200).send('OK');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[paynow/result] Exception:', e instanceof Error ? e.message : e);
      res.status(500).send('ERR');
    }
  },
);

app.post('/paynow/initiate', async (req, res) => {
  const id = String(process.env.PAYNOW_INTEGRATION_ID || '').trim();
  const key = String(process.env.PAYNOW_INTEGRATION_KEY || '').trim();
  const resultUrl = PAYNOW_RESULT_URL;
  const returnUrl = PAYNOW_RETURN_URL;

  if (!id || !key) {
    return res.status(500).json({
      ok: false,
      error:
        'Missing Paynow credentials: set PAYNOW_INTEGRATION_ID and PAYNOW_INTEGRATION_KEY in Railway (or server/.env). They come from your Paynow merchant dashboard. Optional: PAYNOW_RETURN_URL, PAYNOW_RESULT_URL, CUSTOMER_APP_PUBLIC_URL, PUBLIC_PAYNOW_API_ORIGIN.',
      diagnostics: {
        ...paynowCredentialFlags(),
        checkHealth: 'GET /health on this same host shows paynowIntegrationIdSet / paynowIntegrationKeySet without exposing values.',
        commonFix:
          'In Railway open the service that runs THIS Docker image (bykea Paynow API), Variables → add both keys exactly (no quotes). If you use Project Variables, link them to this service. Redeploy after saving.',
      },
    });
  }

  const {
    orderNumber,
    orderId,
    amount,
    customerEmail,
    customerName: nameIn,
    orderKind: kindIn,
  } = req.body || {};

  const rawKind = String(kindIn || 'shop').toLowerCase();
  let orderKind = 'shop';
  if (rawKind === 'delivery') orderKind = 'delivery';
  else if (rawKind === 'taxi') orderKind = 'taxi';
  else if (rawKind === 'tuk' || rawKind === 'tuktuk' || rawKind === 'tuk_tuk') orderKind = 'tuk';
  else if (rawKind === 'driver_deposit' || rawKind === 'driverdeposit' || rawKind === 'driver_wallet')
    orderKind = 'driver_deposit';
  else if (
    rawKind === 'customer_wallet' ||
    rawKind === 'customerwallet' ||
    rawKind === 'wallet_topup' ||
    rawKind === 'wallet'
  )
    orderKind = 'customer_wallet';

  const orderNum = String(orderNumber || '').trim();
  const orderUuid = String(orderId || '').trim();
  const amt = Number(amount);
  const customerName = String(nameIn || '').trim() || 'Customer';

  if (!orderNum || !orderUuid || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ ok: false, error: 'orderNumber, orderId and amount are required.' });
  }

  const rounded = Number(amt.toFixed(2));

  try {
    const paynow = new Paynow(id, key, resultUrl, returnUrl);
    const resolved = resolvePaynowAuthEmail(customerEmail);
    const authEmail = resolved === '' ? undefined : resolved;
    const payment = paynow.createPayment(orderNum, authEmail);
    const lineLabel =
      orderKind === 'delivery'
        ? `Delivery ${orderNum} (${customerName})`
        : orderKind === 'taxi'
          ? `Taxi ride ${orderNum} (${customerName})`
          : orderKind === 'tuk'
            ? `Tuk-Tuk ${orderNum} (${customerName})`
            : orderKind === 'driver_deposit'
              ? `Driver wallet deposit ${orderNum} (${customerName})`
              : orderKind === 'customer_wallet'
                ? `Wallet top-up ${orderNum} (${customerName})`
            : `Shop order ${orderNum} (${customerName})`;
    payment.add(lineLabel, rounded);

    const response = await paynow.send(payment);

    if (!response || !response.success || !response.redirectUrl) {
      return res.status(200).json({
        ok: false,
        error: 'Paynow initiation failed.',
        details: response || null,
      });
    }

    const updatePayload = {
      payment_gateway: 'paynow',
      payment_status: 'pending',
      paynow_reference: orderNum,
      paynow_poll_url: response.pollUrl || null,
      paynow_redirect_url: response.redirectUrl || null,
      payment_started_at: new Date().toISOString(),
    };

    const supabaseUrl = process.env.SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const table =
        orderKind === 'delivery'
          ? 'customer_delivery_orders'
          : orderKind === 'taxi'
            ? 'taxi_bookings'
            : orderKind === 'tuk'
              ? 'tuk_tuk_bookings'
              : orderKind === 'driver_deposit'
                ? 'driver_wallet_topups'
                : orderKind === 'customer_wallet'
                  ? 'customer_wallet_topups'
              : 'shop_customer_orders';
      const { error: updErr } = await supabase.from(table).update(updatePayload).eq('id', orderUuid);

      if (updErr) {
        return res.status(500).json({
          ok: false,
          error: 'Paynow started but Supabase order update failed.',
          details: updErr.message,
          redirectUrl: response.redirectUrl,
          pollUrl: response.pollUrl || null,
        });
      }
    }

    return res.json({
      ok: true,
      redirectUrl: response.redirectUrl,
      pollUrl: response.pollUrl || null,
      reference: orderNum,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    });
  }
});

/**
 * EcoCash Instant Payments — charge (customer approves on phone).
 * Body: { orderId, orderNumber, amount, phone, orderKind, customerName?, remarks? }
 */
app.post('/ecocash/charge', async (req, res) => {
  const flags = paynowCredentialFlags();
  if (!flags.ecocashReady) {
    return res.status(500).json({
      ok: false,
      error:
        'EcoCash is not configured. Set ECOCASH_MERCHANT_CODE, ECOCASH_MERCHANT_PIN, ECOCASH_MERCHANT_NUMBER (and optional ECOCASH_API_USERNAME / ECOCASH_API_PASSWORD) on this server.',
      diagnostics: flags,
    });
  }

  const {
    orderNumber,
    orderId,
    amount,
    phone,
    customerName: nameIn,
    orderKind: kindIn,
    remarks: remarksIn,
  } = req.body || {};

  const rawKind = String(kindIn || 'shop').toLowerCase();
  let orderKind = 'shop';
  if (rawKind === 'delivery') orderKind = 'delivery';
  else if (rawKind === 'taxi') orderKind = 'taxi';
  else if (rawKind === 'tuk' || rawKind === 'tuktuk' || rawKind === 'tuk_tuk') orderKind = 'tuk';
  else if (rawKind === 'driver_deposit' || rawKind === 'driverdeposit' || rawKind === 'driver_wallet')
    orderKind = 'driver_deposit';
  else if (
    rawKind === 'customer_wallet' ||
    rawKind === 'customerwallet' ||
    rawKind === 'wallet_topup' ||
    rawKind === 'wallet'
  )
    orderKind = 'customer_wallet';

  const orderNum = String(orderNumber || '').trim();
  const orderUuid = String(orderId || '').trim();
  const amt = Number(amount);
  const customerName = String(nameIn || '').trim() || 'Customer';
  const endUserId = normalizeZwMsisdn(phone);

  if (!orderNum || !orderUuid || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ ok: false, error: 'orderNumber, orderId and amount are required.' });
  }
  if (!endUserId) {
    return res.status(400).json({
      ok: false,
      error: 'Enter a valid Zimbabwe EcoCash number (e.g. 0771234567 or 263771234567).',
    });
  }

  const clientCorrelation = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 18);
  const referenceCode = orderNum.slice(0, 40);
  const remarks =
    String(remarksIn || '').trim() ||
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
              : `Shop order ${orderNum} (${customerName})`);

  try {
    const charge = await chargeEcocash({
      amount: amt,
      endUserId,
      referenceCode,
      clientCorrelation,
      notifyUrl: ECOCASH_NOTIFY_URL,
      remarks,
    });

    if (!charge.ok) {
      return res.status(200).json({
        ok: false,
        error: 'EcoCash charge request failed.',
        details: charge.body || charge.raw,
        httpStatus: charge.httpStatus,
      });
    }

    const updatePayload = {
      payment_method: 'ecocash',
      payment_gateway: 'ecocash',
      payment_status: 'pending',
      paynow_reference: clientCorrelation,
      payment_started_at: new Date().toISOString(),
    };

    const supabaseUrl = process.env.SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (supabaseUrl && serviceKey) {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const table = orderTableForKind(orderKind);
      const { error: updErr } = await supabase.from(table).update(updatePayload).eq('id', orderUuid);
      if (updErr) {
        return res.status(500).json({
          ok: false,
          error: 'EcoCash started but Supabase order update failed.',
          details: updErr.message,
          clientCorrelation,
        });
      }
    }

    return res.json({
      ok: true,
      clientCorrelation,
      referenceCode,
      phone: endUserId,
      amount: Number(amt.toFixed(2)),
      message: 'Approve the payment on your EcoCash phone when prompted.',
      ecoCashResponse: charge.body,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : 'Unknown EcoCash error',
    });
  }
});

/** EcoCash completion webhook (COMPLETED / FAILED). */
app.post('/ecocash/notify', express.json({ limit: '256kb' }), async (req, res) => {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceKey) {
    // eslint-disable-next-line no-console
    console.warn('[ecocash/notify] Missing Supabase service env — payment rows will not update.');
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await processEcocashNotify(payload, { supabaseUrl, serviceKey });
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('[ecocash/notify] Failed:', result.reason);
      res.status(500).json({ ok: false, reason: result.reason });
      return;
    }
    // eslint-disable-next-line no-console
    console.info(
      `[ecocash/notify] ${result.kind || result.reason || 'ok'} ref=${result.reference} → ${result.paymentStatus}`,
    );
    res.status(200).json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ecocash/notify] Exception:', e instanceof Error ? e.message : e);
    res.status(500).json({ ok: false });
  }
});

/**
 * Poll EcoCash + sync DB.
 * Query: ?clientCorrelation=&phone=
 */
app.get('/ecocash/status', async (req, res) => {
  const clientCorrelation = String(req.query.clientCorrelation || req.query.clientCorrelator || '').trim();
  const phone = normalizeZwMsisdn(String(req.query.phone || ''));
  if (!clientCorrelation) {
    return res.status(400).json({ ok: false, error: 'clientCorrelation is required.' });
  }
  if (!phone) {
    return res.status(400).json({ ok: false, error: 'Valid phone (MSISDN) is required.' });
  }

  try {
    const q = await queryEcocashTransaction({ clientCorrelation, endUserId: phone });
    const statusRaw = extractStatusFromPayload(q.body) || (q.ok ? 'CHARGED' : 'FAILED');
    const serverReference = extractServerRef(q.body);
    const paymentStatus = mapEcocashStatus(statusRaw);

    const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (supabaseUrl && serviceKey && (paymentStatus === 'paid' || paymentStatus === 'failed')) {
      await applyEcocashPaymentUpdate({
        clientCorrelation,
        statusRaw,
        serverReference,
        supabaseUrl,
        serviceKey,
        endUserId: phone,
      });
    }

    return res.json({
      ok: true,
      clientCorrelation,
      paymentStatus,
      statusRaw,
      serverReference: serverReference || null,
      ecoCash: q.body,
      httpStatus: q.httpStatus,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : 'Status lookup failed',
    });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Payments API listening on port ${PORT}`);
  // eslint-disable-next-line no-console
  console.log(
    'POST /paynow/initiate | /paynow/result | /ecocash/charge | /ecocash/notify | GET /ecocash/status | GET /health',
  );
});
