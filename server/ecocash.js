const { createClient } = require('@supabase/supabase-js');

function ecocashConfig() {
  const base =
    String(process.env.ECOCASH_API_BASE || '').trim() ||
    'https://payonline.ecocash.co.zw/ecocashGateway-preprod/payment/v1';
  return {
    base: base.replace(/\/$/, ''),
    username: String(process.env.ECOCASH_API_USERNAME || 'ecocash').trim(),
    password: String(process.env.ECOCASH_API_PASSWORD || 'mobiquity').trim(),
    merchantCode: String(process.env.ECOCASH_MERCHANT_CODE || '8003').trim(),
    merchantPin: String(process.env.ECOCASH_MERCHANT_PIN || '1234').trim(),
    merchantNumber: String(process.env.ECOCASH_MERCHANT_NUMBER || '789111401').trim(),
    merchantName: String(process.env.ECOCASH_MERCHANT_NAME || 'InGo').trim(),
    superMerchantName: String(process.env.ECOCASH_SUPER_MERCHANT_NAME || 'InGo').trim(),
    terminalId: String(process.env.ECOCASH_TERMINAL_ID || 'INGOWEB001').trim(),
    location: String(process.env.ECOCASH_LOCATION || 'Harare, Zimbabwe').trim(),
    currency: String(process.env.ECOCASH_CURRENCY || 'USD').trim().toUpperCase() || 'USD',
    countryCode: String(process.env.ECOCASH_COUNTRY_CODE || 'ZW').trim() || 'ZW',
  };
}

function basicAuthHeader(username, password) {
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

/**
 * Normalize Zimbabwe MSISDN to 2637XXXXXXXX.
 * @param {string} raw
 * @returns {string | null}
 */
function normalizeZwMsisdn(raw) {
  let s = String(raw || '').replace(/[^\d+]/g, '').trim();
  if (!s) return null;
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0') && s.length >= 9) s = `263${s.slice(1)}`;
  if (s.startsWith('7') && s.length === 9) s = `263${s}`;
  if (!/^2637\d{8}$/.test(s)) return null;
  return s;
}

function mapEcocashStatus(status) {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'COMPLETED' || s === 'SUCCESS' || s === 'SUCCESSFUL') return 'paid';
  if (s === 'FAILED' || s === 'REJECTED' || s === 'CANCELLED' || s === 'CANCELED') return 'failed';
  if (s === 'CHARGED' || s === 'PENDING' || s === 'PROCESSING') return 'pending';
  return 'pending';
}

function orderTableForKind(orderKind) {
  if (orderKind === 'delivery') return 'customer_delivery_orders';
  if (orderKind === 'taxi') return 'taxi_bookings';
  if (orderKind === 'tuk') return 'tuk_tuk_bookings';
  if (orderKind === 'driver_deposit') return 'driver_wallet_topups';
  if (orderKind === 'customer_wallet') return 'customer_wallet_topups';
  return 'shop_customer_orders';
}

function buildChargeBody({
  cfg,
  clientCorrelation,
  referenceCode,
  endUserId,
  amount,
  remarks,
  notifyUrl,
}) {
  const amt = Number(Number(amount).toFixed(2));
  return {
    clientCorrelation,
    notifyUrl,
    referenceCode,
    tranType: 'MER',
    endUserId,
    remarks: remarks || 'InGo payment',
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
        onBeHalfOf: 'InGo',
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
}

/**
 * @param {{
 *   amount: number,
 *   endUserId: string,
 *   referenceCode: string,
 *   clientCorrelation: string,
 *   notifyUrl: string,
 *   remarks?: string,
 * }} params
 */
async function chargeEcocash(params) {
  const cfg = ecocashConfig();
  const url = `${cfg.base}/transactions/amount`;
  const body = buildChargeBody({ cfg, ...params });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(cfg.username, cfg.password),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { httpStatus: res.status, ok: res.ok, body: json, raw: text };
}

/**
 * @param {{ clientCorrelation: string, endUserId: string }} params
 */
async function queryEcocashTransaction({ clientCorrelation, endUserId }) {
  const cfg = ecocashConfig();
  const corr = encodeURIComponent(String(clientCorrelation || '').trim());
  const msisdn = encodeURIComponent(String(endUserId || '').trim());
  // Prefer path with endUserId (test script); fall back to correlator-only path from API doc.
  const urls = [
    `${cfg.base}/${msisdn}/transactions/amount/${corr}`,
    `${cfg.base}/endUserId/transactions/amount/${corr}`,
    `${cfg.base}/transactions/amount/${corr}`,
  ];

  let last = { httpStatus: 0, ok: false, body: null, raw: '' };
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
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      last = { httpStatus: res.status, ok: res.ok, body: json, raw: text, url };
      if (res.ok) return last;
    } catch (e) {
      last = { httpStatus: 0, ok: false, body: null, raw: e instanceof Error ? e.message : String(e) };
    }
  }
  return last;
}

function extractStatusFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return (
    payload.transactionOperationStatus ||
    payload.transactionStatus ||
    payload.status ||
    payload?.paymentAmount?.transactionOperationStatus ||
    ''
  );
}

function extractServerRef(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return (
    payload.serverReferenceCode ||
    payload.ecocashReference ||
    payload?.paymentAmount?.ecocashReference ||
    payload?.paymentAmount?.originalEcocashReference ||
    ''
  );
}

/**
 * Apply EcoCash notify or poll result to order rows keyed by our clientCorrelation (stored in paynow_reference).
 */
async function applyEcocashPaymentUpdate({
  clientCorrelation,
  statusRaw,
  serverReference,
  supabaseUrl,
  serviceKey,
  endUserId,
}) {
  if (!supabaseUrl || !serviceKey || !clientCorrelation) {
    return { ok: false, reason: 'misconfigured' };
  }
  const paymentStatus = mapEcocashStatus(statusRaw);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const update = {
    payment_gateway: 'ecocash',
    payment_status: paymentStatus,
  };
  if (paymentStatus === 'paid') {
    update.payment_completed_at = new Date().toISOString();
  }
  // Reuse poll URL column to store EcoCash server reference for refunds/support.
  if (serverReference) {
    update.paynow_poll_url = String(serverReference);
  }

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
      .eq('paynow_reference', clientCorrelation)
      .limit(2);
    if (selErr) {
      // Column/table may not exist on older schemas — continue.
      continue;
    }
    if (!rows?.length) continue;
    const { error: updErr } = await supabase.from(table).update(update).eq('paynow_reference', clientCorrelation);
    if (updErr) return { ok: false, reason: updErr.message, table };
    return {
      ok: true,
      kind: table,
      reference: clientCorrelation,
      paymentStatus,
      statusRaw: String(statusRaw || ''),
      serverReference: serverReference || null,
      endUserId: endUserId || null,
    };
  }

  return { ok: true, reason: 'no_matching_order', reference: clientCorrelation, paymentStatus };
}

/**
 * Process EcoCash notify webhook JSON (or form).
 * @param {unknown} payload
 */
async function processEcocashNotify(payload, { supabaseUrl, serviceKey }) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const clientCorrelation = String(
    body.clientCorrelation || body.clientCorrelator || body.referenceCode || body.reference || '',
  ).trim();
  if (!clientCorrelation) return { ok: false, reason: 'missing_client_correlation' };

  const statusRaw = extractStatusFromPayload(body);
  const serverReference = extractServerRef(body);
  const endUserId = String(body.endUserId || '').trim();

  return applyEcocashPaymentUpdate({
    clientCorrelation,
    statusRaw,
    serverReference,
    supabaseUrl,
    serviceKey,
    endUserId,
  });
}

module.exports = {
  ecocashConfig,
  normalizeZwMsisdn,
  mapEcocashStatus,
  orderTableForKind,
  chargeEcocash,
  queryEcocashTransaction,
  processEcocashNotify,
  applyEcocashPaymentUpdate,
  extractStatusFromPayload,
  extractServerRef,
  basicAuthHeader,
};
