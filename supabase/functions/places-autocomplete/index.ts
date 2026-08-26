/**
 * Supabase Edge: **`places-autocomplete`** — proxies Google Places Autocomplete JSON (no browser CORS).
 * Deploy: `supabase functions deploy places-autocomplete`
 * Secret: `supabase secrets set GOOGLE_MAPS_API_KEY=...`
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** `places-autocomplete` — wraps a body into a JSON `Response` with shared CORS headers. */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * `places-autocomplete` — HTTP handler (Edge entrypoint).
 * Called from the React app: `src/lib/reverseGeocode.js` → `fetchAddressAutocompleteSuggestions`
 * via `supabase.functions.invoke('places-autocomplete', { body })`, used by `AddressSuggestInput`
 * on pages like `/request-delivery`, `/book-ride`.
 * Body: `{ input, language?, country?, typesAddress? }`.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const key = Deno.env.get('GOOGLE_MAPS_API_KEY')?.trim();
  if (!key) {
    return json(
      {
        error: 'Missing GOOGLE_MAPS_API_KEY',
        hint: 'Set with: supabase secrets set GOOGLE_MAPS_API_KEY=your_key',
      },
      500,
    );
  }

  let body: {
    input?: string;
    language?: string;
    country?: string;
    typesAddress?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const input = String(body.input || '').trim();
  if (input.length < 2) {
    return json({ status: 'ZERO_RESULTS', predictions: [] });
  }

  const params = new URLSearchParams({
    input,
    key,
    language: String(body.language || 'en').trim() || 'en',
  });

  const cc = String(body.country || 'zw')
    .trim()
    .toLowerCase();
  if (cc.length === 2 && /^[a-z]{2}$/.test(cc)) {
    params.set('components', `country:${cc}`);
    if (cc === 'gb') params.set('region', 'uk');
    if (cc === 'zw') params.set('region', 'zw');
  }
  if (body.typesAddress) {
    params.set('types', 'address');
  }

  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`;

  try {
    const res = await fetch(url);
    const raw = await res.json();
    return json(raw, res.ok ? 200 : 502);
  } catch (e) {
    return json(
      {
        error: 'Upstream fetch failed',
        message: e instanceof Error ? e.message : String(e),
      },
      502,
    );
  }
});
