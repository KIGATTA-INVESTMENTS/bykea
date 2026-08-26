/**
 * Supabase Edge: **ecocash-notify** — EcoCash Instant Payments completion webhook.
 *
 * Deploy:
 *   supabase functions deploy ecocash-notify --no-verify-jwt
 *
 * Register this URL as EcoCash notifyUrl (also set automatically by ecocash-payment):
 *   https://YOUR_PROJECT.supabase.co/functions/v1/ecocash-notify
 *
 * Secrets: same ECOCASH_* as ecocash-payment (merchant not required here).
 * `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.
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

function mapEcocashStatus(status: string): 'pending' | 'paid' | 'failed' {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'COMPLETED' || s === 'SUCCESS' || s === 'SUCCESSFUL') return 'paid';
  if (s === 'FAILED' || s === 'REJECTED' || s === 'CANCELLED' || s === 'CANCELED') return 'failed';
  return 'pending';
}

function extractStatusFromPayload(payload: Record<string, unknown>): string {
  const pa = payload.paymentAmount as Record<string, unknown> | undefined;
  return String(
    payload.transactionOperationStatus ||
      payload.transactionStatus ||
      payload.status ||
      pa?.transactionOperationStatus ||
      '',
  );
}

function extractServerRef(payload: Record<string, unknown>): string {
  const pa = payload.paymentAmount as Record<string, unknown> | undefined;
  return String(
    payload.serverReferenceCode ||
      payload.ecocashReference ||
      pa?.ecocashReference ||
      pa?.originalEcocashReference ||
      '',
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) {
    console.warn('[ecocash-notify] Missing Supabase service env');
    return json({ ok: true });
  }

  try {
    const ct = String(req.headers.get('content-type') || '').toLowerCase();
    let payload: Record<string, unknown> = {};
    if (ct.includes('application/json')) {
      payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    } else {
      const raw = await req.text();
      try {
        payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        // form-urlencoded fallback
        const params = new URLSearchParams(raw);
        payload = Object.fromEntries(params.entries());
      }
    }

    const clientCorrelation = String(
      payload.clientCorrelation || payload.clientCorrelator || payload.referenceCode || payload.reference || '',
    ).trim();
    if (!clientCorrelation) return json({ ok: false, reason: 'missing_client_correlation' }, 400);

    const statusRaw = extractStatusFromPayload(payload);
    const serverReference = extractServerRef(payload);
    const paymentStatus = mapEcocashStatus(statusRaw);

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const update: Record<string, unknown> = {
      payment_gateway: 'ecocash',
      payment_status: paymentStatus,
    };
    if (paymentStatus === 'paid') update.payment_completed_at = new Date().toISOString();
    if (serverReference) update.paynow_poll_url = serverReference;

    const tables = [
      'shop_customer_orders',
      'customer_delivery_orders',
      'taxi_bookings',
      'tuk_tuk_bookings',
      'customer_wallet_topups',
      'driver_wallet_topups',
    ];

    let updated: string | null = null;
    let updatedId: string | null = null;
    for (const table of tables) {
      const { data: rows, error: selErr } = await supabase
        .from(table)
        .select('id')
        .eq('paynow_reference', clientCorrelation)
        .limit(2);
      if (selErr || !rows?.length) continue;
      updatedId = String(rows[0].id || '');
      const { error: updErr } = await supabase
        .from(table)
        .update(update)
        .eq('paynow_reference', clientCorrelation);
      if (updErr) return json({ ok: false, reason: updErr.message }, 500);
      updated = table;

      if (paymentStatus === 'paid' && updatedId) {
        if (table === 'customer_wallet_topups') {
          await supabase.rpc('credit_customer_wallet_from_topup', { p_topup_id: updatedId }).catch(() => {});
        } else if (table === 'driver_wallet_topups') {
          const { data: top } = await supabase
            .from('driver_wallet_topups')
            .select('driver_id, amount_gbp')
            .eq('id', updatedId)
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
        }
      }
      break;
    }

    console.info(
      `[ecocash-notify] ${updated || 'no_match'} ref=${clientCorrelation} → ${paymentStatus}`,
    );
    return json({ ok: true, updated, updatedId, paymentStatus });
  } catch (e) {
    console.error('[ecocash-notify]', e instanceof Error ? e.message : e);
    return json({ ok: false }, 500);
  }
});
