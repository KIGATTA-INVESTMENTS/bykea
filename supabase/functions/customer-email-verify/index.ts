/**
 * Supabase Edge: **customer-email-verify** — send / verify email codes via Resend
 * (customers `app_users`, drivers `driver_registrations`, shop owners `shop_owners`).
 *
 * Deploy:
 *   supabase functions deploy customer-email-verify --no-verify-jwt
 *
 * Secrets:
 *   RESEND_API_KEY, EMAIL_VERIFY_HMAC_SECRET
 * Optional: RESEND_FROM_EMAIL
 *
 * Body (JSON):
 *   { "action": "send", "realm": "customer"|"driver"|"shop_owner", "email": "...", "password": "..." }
 *   { "action": "verify", "realm": "...", "email": "...", "code": "123456" }
 *
 * `realm` defaults to `customer` when omitted.
 *
 * (Hosted deploy bundles **only** `index.ts` — no sibling imports.)
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

type Realm = 'customer' | 'driver' | 'shop_owner';

function parseRealm(raw: unknown): Realm {
  const r = String(raw ?? 'customer').trim().toLowerCase();
  if (r === 'driver' || r === 'shop_owner' || r === 'customer') return r as Realm;
  return 'customer';
}

function hmacPayload(realm: Realm, email: string, code: string): string {
  return `${realm}:${email}:${code}`;
}

async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function random6Digit(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = 100000 + (Number(buf[0]) % 900000);
  return String(n).padStart(6, '0');
}

function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

function normalizeCode(raw: unknown): string {
  return String(raw ?? '').replace(/\s/g, '').replace(/\D/g, '').slice(0, 6);
}

const RESEND_MIN_INTERVAL_MS = 55_000;
const CODE_TTL_MS = 15 * 60 * 1000;

type SendRow = {
  id: string;
  email: string;
  password: string;
  email_verified_at: string | null;
  email_verification_sent_at: string | null;
};

async function findSendRow(
  supabase: ReturnType<typeof createClient>,
  realm: Realm,
  email: string,
  password: string,
): Promise<{ ok: true; row: SendRow } | { ok: false; error: string }> {
  if (realm === 'customer') {
    const { data: row, error: qErr } = await supabase
      .from('app_users')
      .select('id, email, password, email_verified_at, email_verification_sent_at')
      .eq('email', email)
      .maybeSingle();
    if (qErr) return { ok: false, error: qErr.message || 'Lookup failed.' };
    if (!row || row.password !== password) return { ok: false, error: 'Invalid email or password.' };
    return { ok: true, row: row as SendRow };
  }
  if (realm === 'shop_owner') {
    const { data: row, error: qErr } = await supabase
      .from('shop_owners')
      .select('id, email, password, email_verified_at, email_verification_sent_at')
      .eq('email', email)
      .maybeSingle();
    if (qErr) return { ok: false, error: qErr.message || 'Lookup failed.' };
    if (!row || row.password !== password) return { ok: false, error: 'Invalid email or password.' };
    return { ok: true, row: row as SendRow };
  }
  // driver: latest rows for email, pick first password match
  const { data: rows, error: qErr } = await supabase
    .from('driver_registrations')
    .select('id, email, password, email_verified_at, email_verification_sent_at')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(8);
  if (qErr) return { ok: false, error: qErr.message || 'Lookup failed.' };
  const row = (rows || []).find((r: { password?: string }) => r.password === password) as SendRow | undefined;
  if (!row) return { ok: false, error: 'Invalid email or password.' };
  return { ok: true, row };
}

function tableForRealm(realm: Realm): 'app_users' | 'driver_registrations' | 'shop_owners' {
  if (realm === 'driver') return 'driver_registrations';
  if (realm === 'shop_owner') return 'shop_owners';
  return 'app_users';
}

async function sendResendEmail(
  resendKey: string,
  from: string,
  to: string,
  realm: Realm,
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const label =
    realm === 'driver' ? 'driver account' : realm === 'shop_owner' ? 'shop owner account' : 'customer account';
  const html = `
<p>Hi,</p>
<p>Your InGo verification code (${label}) is:</p>
<p style="font-size:1.5rem;font-weight:700;letter-spacing:0.2em">${code}</p>
<p>This code expires in 15 minutes. If you did not request this, you can ignore this email.</p>
<p>— InGo</p>
`.trim();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your InGo verification code',
      html,
    }),
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
    return json({ ok: false, error: 'Invalid request. Please try again.' });
  }

  const action = String(body.action ?? '').trim();
  const realm = parseRealm(body.realm);
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'Verification is temporarily unavailable. Please try again later.' });
  }

  const hmacSecret = Deno.env.get('EMAIL_VERIFY_HMAC_SECRET')?.trim();
  if (!hmacSecret) {
    return json({ ok: false, error: 'Verification is temporarily unavailable. Please try again later.' });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === 'send') {
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? '');
    if (!email || !password) {
      return json({ ok: false, error: 'Email and password are required.' });
    }

    const found = await findSendRow(supabase, realm, email, password);
    if (!found.ok) return json({ ok: false, error: found.error });
    const row = found.row;

    if (row.email_verified_at) {
      return json({ ok: false, error: 'This email is already verified.' });
    }

    const sentAt = row.email_verification_sent_at ? new Date(row.email_verification_sent_at).getTime() : 0;
    if (sentAt && Date.now() - sentAt < RESEND_MIN_INTERVAL_MS) {
      return json({
        ok: false,
        error: 'Please wait about a minute before requesting another code.',
        retryAfterSec: Math.ceil((RESEND_MIN_INTERVAL_MS - (Date.now() - sentAt)) / 1000),
      });
    }

    const code = random6Digit();
    const codeHash = await hmacSha256Hex(hmacSecret, hmacPayload(realm, email, code));
    const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
    const nowIso = new Date().toISOString();
    const tbl = tableForRealm(realm);

    const { error: uErr } = await supabase
      .from(tbl)
      .update({
        email_verification_code_hash: codeHash,
        email_verification_expires_at: expires,
        email_verification_sent_at: nowIso,
      })
      .eq('id', row.id);

    if (uErr) {
      return json({ ok: false, error: uErr.message || 'Could not save verification code.' });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')?.trim();
    if (!resendKey) {
      return json({ ok: false, error: 'Could not send verification email right now. Please try again later.' });
    }

    const fromRaw = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'admin@ingo.co.zw';
    const from = fromRaw.includes('<') ? fromRaw : `InGo <${fromRaw}>`;

    const mailed = await sendResendEmail(resendKey, from, email, realm, code);
    if (!mailed.ok) return json({ ok: false, error: mailed.error || 'Could not send verification email.' });

    return json({ ok: true });
  }

  if (action === 'verify') {
    const email = normalizeEmail(body.email);
    const code = normalizeCode(body.code);
    if (!email || code.length !== 6) {
      return json({ ok: false, error: 'Email and a 6-digit code are required.' });
    }

    const tbl = tableForRealm(realm);

    let row: {
      id: string;
      email_verified_at: string | null;
      email_verification_code_hash: string | null;
      email_verification_expires_at: string | null;
    } | null = null;

    if (realm === 'driver') {
      const { data: rows, error: qErr } = await supabase
        .from('driver_registrations')
        .select('id, email, email_verified_at, email_verification_code_hash, email_verification_expires_at')
        .eq('email', email)
        .not('email_verification_code_hash', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      if (qErr) return json({ ok: false, error: qErr.message || 'Lookup failed.' });
      row = rows && rows[0] ? (rows[0] as typeof row) : null;
    } else {
      const { data: r, error: qErr } = await supabase
        .from(tbl)
        .select('id, email, email_verified_at, email_verification_code_hash, email_verification_expires_at')
        .eq('email', email)
        .maybeSingle();
      if (qErr) return json({ ok: false, error: qErr.message || 'Lookup failed.' });
      row = r as typeof row | null;
    }

    if (!row) {
      return json({ ok: false, error: 'No account found for this email.' });
    }
    if (row.email_verified_at) {
      return json({ ok: true, alreadyVerified: true });
    }

    const exp = row.email_verification_expires_at ? new Date(row.email_verification_expires_at).getTime() : 0;
    if (!exp || Date.now() > exp) {
      return json({ ok: false, error: 'This code has expired. Request a new one.' });
    }

    const stored = String(row.email_verification_code_hash ?? '');
    const attemptHash = await hmacSha256Hex(hmacSecret, hmacPayload(realm, email, code));
    if (!stored || !timingSafeEqualHex(stored, attemptHash)) {
      return json({ ok: false, error: 'Invalid verification code.' });
    }

    const { error: finErr } = await supabase
      .from(tbl)
      .update({
        email_verified_at: new Date().toISOString(),
        email_verification_code_hash: null,
        email_verification_expires_at: null,
      })
      .eq('id', row.id);

    if (finErr) {
      return json({ ok: false, error: finErr.message || 'Could not complete verification.' });
    }

    return json({ ok: true });
  }

  return json({ ok: false, error: 'Unknown action. Use send or verify.' });
});
