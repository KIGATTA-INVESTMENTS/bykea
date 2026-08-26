/**
 * Shop order picked up → email customer that delivery is on the way.
 *
 * Deploy: supabase functions deploy shop-order-picked-up-notify --no-verify-jwt
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 * Optional: RESEND_FROM_EMAIL, PUBLIC_APP_URL (e.g. https://app.ingo.co.zw)
 *
 * Body: { "orderId": "<uuid>" }
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function postResend(
  resendKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const resBody = (await res.json().catch(() => ({}))) as { message?: string; name?: string };
  if (!res.ok) {
    const msg = [resBody?.name, resBody?.message].filter(Boolean).join(': ') || `Resend HTTP ${res.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const orderId = String(body.orderId ?? '').trim();
  if (!UUID_RE.test(orderId)) {
    return json({ ok: false, error: 'Invalid orderId' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'Server is missing Supabase configuration.' }, 500);
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')?.trim();
  if (!resendKey) {
    return json({ ok: false, error: 'RESEND_API_KEY is not set on the server.' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: order, error: oErr } = await supabase
    .from('shop_customer_orders')
    .select(
      'id, order_number, customer_full_name, customer_email, customer_address, status, assigned_driver_id',
    )
    .eq('id', orderId)
    .maybeSingle();

  if (oErr) {
    return json({ ok: false, error: oErr.message || 'Order lookup failed.' }, 500);
  }
  if (!order) {
    return json({ ok: false, error: 'Order not found.' }, 404);
  }

  const status = String(order.status || '').toLowerCase().trim();
  if (status !== 'picked up' && status !== 'in transit') {
    return json({ ok: true, skipped: 'status_not_en_route' });
  }

  const customerTo = String(order.customer_email || '').trim().toLowerCase();
  if (!customerTo) {
    return json({ ok: true, skipped: 'no_customer_email' });
  }

  let driverLine = '';
  if (order.assigned_driver_id) {
    const { data: drv } = await supabase
      .from('driver_registrations')
      .select('full_name, phone, phone_country_code, vehicle_plate')
      .eq('id', order.assigned_driver_id)
      .maybeSingle();
    if (drv) {
      const phone = [drv.phone_country_code, drv.phone].filter(Boolean).join(' ').trim();
      driverLine = `<p><strong>Your driver</strong><br/>${escapeHtml(String(drv.full_name || 'Driver'))}${
        phone ? `<br/>${escapeHtml(phone)}` : ''
      }${drv.vehicle_plate ? `<br/>Plate: ${escapeHtml(String(drv.vehicle_plate))}` : ''}</p>`;
    }
  }

  const appBase = (Deno.env.get('PUBLIC_APP_URL') || Deno.env.get('REACT_APP_PUBLIC_URL') || '').trim().replace(
    /\/$/,
    '',
  );
  const trackPath = `/order/${encodeURIComponent(`shop:${order.id}`)}`;
  const trackUrl = appBase ? `${appBase}${trackPath}` : trackPath;

  const fromRaw = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'admin@ingo.co.zw';
  const from = fromRaw.includes('<') ? fromRaw : `InGo <${fromRaw}>`;

  const html = `
<p>Hi ${escapeHtml(order.customer_full_name)},</p>
<p><strong>Your driver has picked up your order and it is on the way to you.</strong></p>
<p>Order <strong>${escapeHtml(order.order_number)}</strong> was collected from the shop and is heading to your address.</p>
<p><strong>Delivery address</strong><br/>${escapeHtml(order.customer_address).replace(/\n/g, '<br/>')}</p>
${driverLine}
<p style="margin-top:1rem"><a href="${escapeHtml(trackUrl)}" style="font-weight:700;color:#07408f">Track your order live</a></p>
<p style="margin-top:1rem;color:#666;font-size:0.9rem">You can also open the InGo app and go to <strong>My Orders</strong> for live updates.</p>
<p>— InGo</p>`.trim();

  const sent = await postResend(
    resendKey,
    from,
    customerTo,
    `Your driver picked up your order — ${order.order_number}`,
    html,
  );

  if (!sent.ok) {
    return json({ ok: false, error: sent.error }, 502);
  }

  return json({ ok: true });
});
