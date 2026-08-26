/**
 * Supabase Edge: **paynow-result** — Paynow `resulturl` webhook (status updates).
 * Verifies SHA-512 hash, updates payment rows by `paynow_reference` (= merchant `reference`):
 * `shop_customer_orders`, else `customer_wallet_topups` (ING-CW-*), else `driver_wallet_topups` (ING-DEP-*).
 *
 * Deploy:
 *   supabase functions deploy paynow-result --no-verify-jwt
 *
 * Secrets (same integration key as initiate — used only to verify inbound hash):
 *   supabase secrets set PAYNOW_INTEGRATION_KEY=...
 *   `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are auto-injected on hosted Supabase.
 *
 * Register this function URL in Paynow as **Result URL**; it must match `PAYNOW_RESULT_URL` in **paynow-initiate**.
 *
 * (Hosted deploy bundles **only** `index.ts` — Paynow helpers are inlined below.)
 *
 * @see https://developers.paynow.co.zw/docs/status_update.html
 * @see https://developers.paynow.co.zw/docs/validating_hash.html
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

/** Inlined: hosted Supabase bundles only `index.ts` (no sibling modules). */
async function sha512UpperHex(plain: string): Promise<string> {
  const bytes = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest('SHA-512', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function decodeFormComponent(enc: string): string {
  return decodeURIComponent(String(enc || '').replace(/\+/g, ' '));
}

type PaynowFormPair = { key: string; value: string };

function parseUrlEncodedOrdered(raw: string): PaynowFormPair[] {
  const out: PaynowFormPair[] = [];
  for (const seg of String(raw || '').trim().split('&')) {
    if (!seg) continue;
    const eq = seg.indexOf('=');
    const keyEnc = eq >= 0 ? seg.slice(0, eq) : seg;
    const valEnc = eq >= 0 ? seg.slice(eq + 1) : '';
    out.push({ key: decodeFormComponent(keyEnc), value: decodeFormComponent(valEnc) });
  }
  return out;
}

async function verifyPaynowInboundBody(
  rawBody: string,
  integrationKey: string,
): Promise<{ ok: true; pairs: Record<string, string> } | { ok: false; pairs: Record<string, string>; reason: string }> {
  const key = integrationKey.trim();
  if (!key) return { ok: false, pairs: {}, reason: 'missing_integration_key' };

  const ordered = parseUrlEncodedOrdered(rawBody);
  const pairs: Record<string, string> = {};
  let valueConcat = '';
  for (const { key: k, value: v } of ordered) {
    pairs[k] = v;
    if (k.toLowerCase() === 'hash') continue;
    valueConcat += v;
  }

  const received = String(pairs.hash || '').trim().toUpperCase();
  if (!received) return { ok: false, pairs, reason: 'missing_hash' };

  const expected = await sha512UpperHex(valueConcat + key.toLowerCase());
  if (received !== expected) return { ok: false, pairs, reason: 'hash_mismatch' };

  return { ok: true, pairs };
}

function mapPaynowStatusToPaymentStatus(
  status: string,
): 'pending' | 'paid' | 'failed' | 'cancelled' {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'paid' || s === 'awaiting delivery' || s === 'delivered') return 'paid';
  if (s === 'cancelled') return 'cancelled';
  if (s === 'refunded') return 'failed';
  if (s === 'disputed') return 'pending';
  return 'pending';
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method === 'GET') {
    return new Response('Paynow result webhook (POST application/x-www-form-urlencoded).', {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const integrationKey = Deno.env.get('PAYNOW_INTEGRATION_KEY')?.trim() || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';

  if (!integrationKey || !supabaseUrl || !serviceKey) {
    console.error('[paynow-result] Missing PAYNOW_INTEGRATION_KEY or Supabase env');
    return new Response('Misconfigured', { status: 500, headers: corsHeaders });
  }

  const rawBody = await req.text();
  if (!rawBody.trim()) {
    return new Response('Empty body', { status: 400, headers: corsHeaders });
  }

  const verified = await verifyPaynowInboundBody(rawBody, integrationKey);
  if (!verified.ok) {
    console.warn('[paynow-result] Rejecting (no DB update):', verified.reason);
    // HTTP 200: Paynow retries on error codes; invalid hash should not trigger endless retries.
    return new Response('OK', { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
  }

  const p = verified.pairs;
  const reference = String(p.reference || '').trim();
  const statusRaw = String(p.status || '').trim();
  const pollurl = String(p.pollurl || '').trim();

  if (!reference) {
    console.warn('[paynow-result] Missing reference in verified payload');
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', ...corsHeaders } });
  }

  const paymentStatus = mapPaynowStatusToPaymentStatus(statusRaw);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const update: Record<string, unknown> = {
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
    console.error('[paynow-result] Select error', selErr.message);
    return new Response('ERR', { status: 500, headers: corsHeaders });
  }

  if (shopRows?.length) {
    const { error: updErr } = await supabase
      .from('shop_customer_orders')
      .update(update)
      .eq('paynow_reference', reference);

    if (updErr) {
      console.error('[paynow-result] Update error', updErr.message);
      return new Response('ERR', { status: 500, headers: corsHeaders });
    }

    console.info('[paynow-result] Updated shop order ref=', reference, 'status=', statusRaw, '→', paymentStatus);
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', ...corsHeaders } });
  }

  for (const table of ['customer_delivery_orders', 'taxi_bookings', 'tuk_tuk_bookings'] as const) {
    const { data: rideRows, error: rideSelErr } = await supabase
      .from(table)
      .select('id')
      .eq('paynow_reference', reference)
      .limit(2);
    if (rideSelErr) {
      if (/does not exist|schema cache|column|paynow_reference/i.test(rideSelErr.message)) continue;
      console.error('[paynow-result] Select error', table, rideSelErr.message);
      return new Response('ERR', { status: 500, headers: corsHeaders });
    }
    if (!rideRows?.length) continue;

    const { error: rideUpdErr } = await supabase.from(table).update(update).eq('paynow_reference', reference);
    if (rideUpdErr) {
      console.error('[paynow-result] Update error', table, rideUpdErr.message);
      return new Response('ERR', { status: 500, headers: corsHeaders });
    }

    if (paymentStatus === 'paid') {
      for (const row of rideRows) {
        const oid = String(row.id || '');
        if (!oid) continue;
        void fetch(`${supabaseUrl}/functions/v1/driver-offer-push`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ table, orderId: oid }),
        }).catch(() => {});
      }
    }

    console.info('[paynow-result] Updated', table, 'ref=', reference, 'status=', statusRaw, '→', paymentStatus);
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', ...corsHeaders } });
  }

  const { data: cwRows, error: cwSelErr } = await supabase
    .from('customer_wallet_topups')
    .select('id, user_id, amount_gbp, package_label, km_credits, credited_at')
    .eq('paynow_reference', reference)
    .limit(2);

  if (cwSelErr) {
    if (!/does not exist|schema cache|Could not find the table/i.test(cwSelErr.message)) {
      console.error('[paynow-result] Customer wallet select error', cwSelErr.message);
      return new Response('ERR', { status: 500, headers: corsHeaders });
    }
  } else if (cwRows?.length) {
    const { error: cwUpdErr } = await supabase
      .from('customer_wallet_topups')
      .update(update)
      .eq('paynow_reference', reference);

    if (cwUpdErr) {
      console.error('[paynow-result] Customer wallet update error', cwUpdErr.message);
      return new Response('ERR', { status: 500, headers: corsHeaders });
    }

    if (paymentStatus === 'paid' && cwRows[0]?.id) {
      const { error: rpcErr } = await supabase.rpc('credit_customer_wallet_from_topup', {
        p_topup_id: cwRows[0].id,
      });
      if (rpcErr) {
        console.warn('[paynow-result] credit RPC failed, using fallback:', rpcErr.message);
        const addAmt = Number(cwRows[0].amount_gbp);
        const userId = String(cwRows[0].user_id || '');
        if (Number.isFinite(addAmt) && addAmt > 0 && userId && !cwRows[0].credited_at) {
          await supabase
            .from('customer_wallets')
            .upsert({ user_id: userId, balance_gbp: 0 }, { onConflict: 'user_id', ignoreDuplicates: true });
          const { data: w } = await supabase
            .from('customer_wallets')
            .select('balance_gbp')
            .eq('user_id', userId)
            .maybeSingle();
          const cur = Number(w?.balance_gbp) || 0;
          const next = Math.round((cur + addAmt) * 100) / 100;
          await supabase
            .from('customer_wallets')
            .update({ balance_gbp: next, updated_at: new Date().toISOString() })
            .eq('user_id', userId);
          await supabase.from('customer_wallet_transactions').insert({
            user_id: userId,
            entry_type: 'credit',
            amount_gbp: addAmt,
            balance_after: next,
            label: String(cwRows[0].package_label || 'Wallet top-up'),
            package_label: cwRows[0].package_label || null,
            km_credits: cwRows[0].km_credits ?? null,
            ref_type: 'topup',
            ref_id: cwRows[0].id,
          });
          await supabase
            .from('customer_wallet_topups')
            .update({ credited_at: new Date().toISOString() })
            .eq('id', cwRows[0].id);
        }
      }
    }

    console.info('[paynow-result] Updated customer wallet topup ref=', reference, 'status=', statusRaw, '→', paymentStatus);
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', ...corsHeaders } });
  }

  const { data: depRows, error: depSelErr } = await supabase
    .from('driver_wallet_topups')
    .select('id, driver_id, amount_gbp')
    .eq('paynow_reference', reference)
    .limit(2);

  if (depSelErr) {
    if (/does not exist|schema cache|Could not find the table/i.test(depSelErr.message)) {
      console.warn('[paynow-result] No shop row; driver_wallet_topups unavailable:', depSelErr.message);
      return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', ...corsHeaders } });
    }
    console.error('[paynow-result] Driver topup select error', depSelErr.message);
    return new Response('ERR', { status: 500, headers: corsHeaders });
  }

  if (!depRows?.length) {
    console.warn('[paynow-result] No row for paynow_reference=', reference);
    return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', ...corsHeaders } });
  }

  const { error: depUpdErr } = await supabase
    .from('driver_wallet_topups')
    .update(update)
    .eq('paynow_reference', reference);

  if (depUpdErr) {
    console.error('[paynow-result] Driver topup update error', depUpdErr.message);
    return new Response('ERR', { status: 500, headers: corsHeaders });
  }

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
        const { error: drvErr } = await supabase
          .from('driver_registrations')
          .update({ driver_deposit_balance_gbp: next, deposit_paid: depositPaid })
          .eq('id', drvId);
        if (drvErr) {
          console.warn('[paynow-result] driver balance increment skipped:', drvErr.message);
        }
      } else if (curErr && !/driver_deposit_balance_gbp|column|schema cache/i.test(curErr.message)) {
        console.warn('[paynow-result] driver balance read error:', curErr.message);
      }
    }
  }

  console.info('[paynow-result] Updated driver topup ref=', reference, 'status=', statusRaw, '→', paymentStatus);
  return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain', ...corsHeaders } });
});
