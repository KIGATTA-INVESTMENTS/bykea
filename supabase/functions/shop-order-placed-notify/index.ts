/**
 * Supabase Edge: **shop-order-placed-notify** ??? after checkout, email the customer (if email set)
 * and each shop owner with lines for their shop.
 *
 * Deploy: supabase functions deploy shop-order-placed-notify --no-verify-jwt
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 * Optional: RESEND_FROM_EMAIL
 *
 * Body (JSON): { "orderId": "<uuid>" }
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

function fmtUsd(n: unknown): string {
  const x = Number(n);
  const v = Number.isFinite(x) ? x : 0;
  return `$${v.toFixed(2)}`;
}

type OrderRow = {
  id: string;
  order_number: string;
  customer_full_name: string;
  customer_phone: string;
  customer_email: string | null;
  customer_address: string;
  customer_notes: string | null;
  subtotal: unknown;
  delivery_fee?: unknown;
  currency: string | null;
  status: string | null;
  placed_at: string | null;
};

type LineRow = {
  shop_owner_id: string;
  product_name: string;
  quantity: number;
  unit_price: unknown;
  line_total: unknown;
  shop_name: string | null;
};

type OwnerRow = {
  id: string;
  email: string;
  business_name: string | null;
};

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
      'id, order_number, customer_full_name, customer_phone, customer_email, customer_address, customer_notes, subtotal, delivery_fee, currency, status, placed_at',
    )
    .eq('id', orderId)
    .maybeSingle();

  if (oErr) {
    return json({ ok: false, error: oErr.message || 'Order lookup failed.' }, 500);
  }
  if (!order) {
    return json({ ok: false, error: 'Order not found.' }, 404);
  }

  const o = order as OrderRow;
  const df = Number(o.delivery_fee) || 0;
  const sub = Number(o.subtotal) || 0;
  const grand = sub + df;

  const { data: linesRaw, error: lErr } = await supabase
    .from('shop_customer_order_lines')
    .select('shop_owner_id, product_name, quantity, unit_price, line_total, shop_name')
    .eq('order_id', orderId);

  if (lErr) {
    return json({ ok: false, error: lErr.message || 'Lines lookup failed.' }, 500);
  }

  const lines = (linesRaw || []) as LineRow[];
  const ownerIds = [...new Set(lines.map((l) => l.shop_owner_id).filter(Boolean))];

  const ownersById = new Map<string, OwnerRow>();
  if (ownerIds.length) {
    const { data: owners, error: ownErr } = await supabase
      .from('shop_owners')
      .select('id, email, business_name')
      .in('id', ownerIds);
    if (ownErr) {
      return json({ ok: false, error: ownErr.message || 'Shop owner lookup failed.' }, 500);
    }
    for (const row of owners || []) {
      const r = row as OwnerRow;
      if (r?.id && r.email) ownersById.set(r.id, r);
    }
  }

  const fromRaw = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'admin@ingo.co.zw';
  const from = fromRaw.includes('<') ? fromRaw : `InGo <${fromRaw}>`;

  const linesTableAll = lines.length
    ? `<table style="border-collapse:collapse;width:100%;max-width:520px"><thead><tr><th align="left" style="padding:6px;border-bottom:1px solid #ddd">Item</th><th align="right" style="padding:6px;border-bottom:1px solid #ddd">Qty</th><th align="right" style="padding:6px;border-bottom:1px solid #ddd">Total</th></tr></thead><tbody>${lines
        .map(
          (l) =>
            `<tr><td style="padding:6px;border-bottom:1px solid #eee">${escapeHtml(l.shop_name || 'Shop')} ??? ${escapeHtml(l.product_name)}</td><td align="right" style="padding:6px;border-bottom:1px solid #eee">${l.quantity}</td><td align="right" style="padding:6px;border-bottom:1px solid #eee">${fmtUsd(l.line_total)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p>(No line items)</p>';

  const commonFooter = `
<p style="margin-top:1rem;color:#666;font-size:0.9rem">Order reference: <strong>${escapeHtml(o.order_number)}</strong><br/>
Placed: ${escapeHtml(o.placed_at || '')}</p>
<p>??? InGo</p>`.trim();

  const customerTo = String(o.customer_email || '').trim().toLowerCase();
  let attempted = 0;
  let failed = 0;

  if (customerTo) {
    attempted += 1;
    const html = `
<p>Hi ${escapeHtml(o.customer_full_name)},</p>
<p>Thanks for your order. Here is a summary:</p>
${linesTableAll}
<p><strong>Subtotal:</strong> ${fmtUsd(sub)}<br/>
<strong>Delivery:</strong> ${fmtUsd(df)}<br/>
<strong>Total:</strong> ${fmtUsd(grand)}</p>
<p><strong>Delivery address</strong><br/>${escapeHtml(o.customer_address).replace(/\n/g, '<br/>')}</p>
${o.customer_notes ? `<p><strong>Notes</strong><br/>${escapeHtml(o.customer_notes).replace(/\n/g, '<br/>')}</p>` : ''}
${commonFooter}`.trim();

    const sent = await postResend(resendKey, from, customerTo, `InGo order confirmation ??? ${o.order_number}`, html);
    if (!sent.ok) failed += 1;
  }

  const byOwner = new Map<string, LineRow[]>();
  for (const l of lines) {
    const sid = l.shop_owner_id;
    if (!sid) continue;
    if (!byOwner.has(sid)) byOwner.set(sid, []);
    byOwner.get(sid)!.push(l);
  }

  for (const [shopOwnerId, ownerLines] of byOwner) {
    const owner = ownersById.get(shopOwnerId);
    if (!owner?.email) continue;

    const table = `<table style="border-collapse:collapse;width:100%;max-width:520px"><thead><tr><th align="left" style="padding:6px;border-bottom:1px solid #ddd">Item</th><th align="right" style="padding:6px;border-bottom:1px solid #ddd">Qty</th><th align="right" style="padding:6px;border-bottom:1px solid #ddd">Total</th></tr></thead><tbody>${ownerLines
      .map(
        (l) =>
          `<tr><td style="padding:6px;border-bottom:1px solid #eee">${escapeHtml(l.product_name)}</td><td align="right" style="padding:6px;border-bottom:1px solid #eee">${l.quantity}</td><td align="right" style="padding:6px;border-bottom:1px solid #eee">${fmtUsd(l.line_total)}</td></tr>`,
      )
      .join('')}</tbody></table>`;

    const ownerSub = ownerLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
    const shareNote =
      ownerIds.length > 1
        ? `<p style="color:#666;font-size:0.9rem">This order includes items from multiple shops. The amounts above are the lines for <strong>${escapeHtml(owner.business_name || 'your shop')}</strong> only. Full order subtotal: ${fmtUsd(sub)} (plus delivery ${fmtUsd(df)}).</p>`
        : `<p><strong>Order subtotal:</strong> ${fmtUsd(sub)}<br/><strong>Delivery:</strong> ${fmtUsd(df)}<br/><strong>Customer total:</strong> ${fmtUsd(grand)}</p>`;

    const html = `
<p>You have a new InGo shop order.</p>
<p><strong>Shop:</strong> ${escapeHtml(owner.business_name || 'Your shop')}<br/>
<strong>Order:</strong> ${escapeHtml(o.order_number)}</p>
${table}
<p><strong>Lines total (your shop):</strong> ${fmtUsd(ownerSub)}</p>
${shareNote}
<p><strong>Customer</strong><br/>
${escapeHtml(o.customer_full_name)}<br/>
${escapeHtml(o.customer_phone)}${customerTo ? `<br/>${escapeHtml(customerTo)}` : ''}</p>
<p><strong>Delivery address</strong><br/>${escapeHtml(o.customer_address).replace(/\n/g, '<br/>')}</p>
${o.customer_notes ? `<p><strong>Customer notes</strong><br/>${escapeHtml(o.customer_notes).replace(/\n/g, '<br/>')}</p>` : ''}
${commonFooter}`.trim();

    attempted += 1;
    const sent = await postResend(
      resendKey,
      from,
      owner.email.trim().toLowerCase(),
      `New InGo order ??? ${o.order_number}`,
      html,
    );
    if (!sent.ok) failed += 1;
  }

  if (attempted > 0 && failed === attempted) {
    return json({ ok: false, error: 'Could not send notification emails (Resend).' }, 502);
  }

  return json({ ok: true });
});
