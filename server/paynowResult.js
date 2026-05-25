const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function sha512UpperHex(plain) {
  return crypto.createHash('sha512').update(String(plain), 'utf8').digest('hex').toUpperCase();
}

function decodeFormComponent(enc) {
  return decodeURIComponent(String(enc || '').replace(/\+/g, ' '));
}

function parseUrlEncodedOrdered(raw) {
  const out = [];
  for (const seg of String(raw || '').trim().split('&')) {
    if (!seg) continue;
    const eq = seg.indexOf('=');
    const keyEnc = eq >= 0 ? seg.slice(0, eq) : seg;
    const valEnc = eq >= 0 ? seg.slice(eq + 1) : '';
    out.push({ key: decodeFormComponent(keyEnc), value: decodeFormComponent(valEnc) });
  }
  return out;
}

async function verifyPaynowInboundBody(rawBody, integrationKey) {
  const key = String(integrationKey || '').trim();
  if (!key) return { ok: false, pairs: {}, reason: 'missing_integration_key' };

  const ordered = parseUrlEncodedOrdered(rawBody);
  const pairs = {};
  let valueConcat = '';
  for (const { key: k, value: v } of ordered) {
    pairs[k] = v;
    if (k.toLowerCase() === 'hash') continue;
    valueConcat += v;
  }

  const received = String(pairs.hash || '').trim().toUpperCase();
  if (!received) return { ok: false, pairs, reason: 'missing_hash' };

  const expected = sha512UpperHex(valueConcat + key.toLowerCase());
  if (received !== expected) return { ok: false, pairs, reason: 'hash_mismatch' };

  return { ok: true, pairs };
}

function mapPaynowStatusToPaymentStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'paid' || s === 'awaiting delivery' || s === 'delivered') return 'paid';
  if (s === 'cancelled') return 'cancelled';
  if (s === 'refunded') return 'failed';
  if (s === 'disputed') return 'pending';
  return 'pending';
}

/**
 * Apply Paynow status webhook to Supabase (shop orders + driver wallet top-ups).
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function processPaynowResult(rawBody, { integrationKey, supabaseUrl, serviceKey }) {
  if (!integrationKey || !supabaseUrl || !serviceKey) {
    return { ok: false, reason: 'misconfigured' };
  }
  if (!String(rawBody || '').trim()) {
    return { ok: false, reason: 'empty_body' };
  }

  const verified = await verifyPaynowInboundBody(rawBody, integrationKey);
  if (!verified.ok) {
    return { ok: true, reason: verified.reason || 'verify_failed' };
  }

  const p = verified.pairs;
  const reference = String(p.reference || '').trim();
  const statusRaw = String(p.status || '').trim();
  const pollurl = String(p.pollurl || '').trim();

  if (!reference) {
    return { ok: true, reason: 'missing_reference' };
  }

  const paymentStatus = mapPaynowStatusToPaymentStatus(statusRaw);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const update = {
    payment_gateway: 'paynow',
    payment_status: paymentStatus,
  };
  if (pollurl) update.paynow_poll_url = pollurl;
  if (paymentStatus === 'paid') {
    update.payment_completed_at = new Date().toISOString();
  }

  const { data: shopRows, error: selErr } = await supabase
    .from('shop_customer_orders')
    .select('id')
    .eq('paynow_reference', reference)
    .limit(2);

  if (selErr) {
    return { ok: false, reason: selErr.message };
  }

  if (shopRows?.length) {
    const { error: updErr } = await supabase
      .from('shop_customer_orders')
      .update(update)
      .eq('paynow_reference', reference);
    if (updErr) return { ok: false, reason: updErr.message };
    return { ok: true, kind: 'shop', reference, paymentStatus, statusRaw };
  }

  const { data: depRows, error: depSelErr } = await supabase
    .from('driver_wallet_topups')
    .select('id, driver_id, amount_gbp')
    .eq('paynow_reference', reference)
    .limit(2);

  if (depSelErr) {
    if (/does not exist|schema cache|Could not find the table/i.test(depSelErr.message)) {
      return { ok: true, reason: 'no_matching_row', reference };
    }
    return { ok: false, reason: depSelErr.message };
  }

  if (!depRows?.length) {
    return { ok: true, reason: 'no_matching_row', reference };
  }

  const { error: depUpdErr } = await supabase
    .from('driver_wallet_topups')
    .update(update)
    .eq('paynow_reference', reference);

  if (depUpdErr) return { ok: false, reason: depUpdErr.message };

  if (paymentStatus === 'paid' && depRows[0]?.driver_id) {
    const addAmt = Number(depRows[0].amount_gbp);
    const drvId = String(depRows[0].driver_id);
    if (Number.isFinite(addAmt) && addAmt > 0 && drvId) {
      const { data: curRow, error: curErr } = await supabase
        .from('driver_registrations')
        .select('driver_deposit_balance_gbp')
        .eq('id', drvId)
        .maybeSingle();
      if (!curErr && curRow) {
        const cur = Number(curRow.driver_deposit_balance_gbp) || 0;
        const next = Math.round((cur + addAmt) * 100) / 100;
        const depositPaid = next >= 10;
        await supabase
          .from('driver_registrations')
          .update({ driver_deposit_balance_gbp: next, deposit_paid: depositPaid })
          .eq('id', drvId);
      }
    }
  }

  return { ok: true, kind: 'driver_deposit', reference, paymentStatus, statusRaw };
}

module.exports = { processPaynowResult };
