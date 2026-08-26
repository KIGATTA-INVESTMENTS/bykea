/**
 * Supabase Edge: **`places-geocode`** — proxies Google Geocoding JSON (no browser CORS).
 * Same secret as `places-autocomplete`. Deploy: `supabase functions deploy places-geocode`
 * Secret: `supabase secrets set GOOGLE_MAPS_API_KEY=...`
 *
 * Body:
 * - `{ address }` — forward geocode
 * - `{ latlng }` — reverse geocode
 * - `{ latlng, nearby: true }` — Places Nearby Search for nearest named place
 *   (used when reverse returns "Unnamed Road" in gated communities)
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** `places-geocode` — wraps a body into a JSON `Response` with shared CORS headers. */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function isUnnamedLabel(s: string) {
  const t = String(s || '').trim();
  if (!t) return true;
  if (/\bunnamed\b/i.test(t)) return true;
  if (/^[a-z0-9]{4,}\+[a-z0-9]{2,}(\s*,\s*zimbabwe)?$/i.test(t)) return true;
  if (/^(road|street|avenue|drive|lane|close|way)(\s*,\s*zimbabwe)?$/i.test(t)) return true;
  if (/^zimbabwe(\s*,\s*africa)?$/i.test(t)) return true;
  return false;
}

/**
 * `places-geocode` — HTTP handler (Edge entrypoint).
 * Called from the React app: `src/lib/reverseGeocode.js` → `forwardGeocodeAddress` (address → coords)
 * and `reverseGeocodeLatLng` (lat,lng → formatted address) via `supabase.functions.invoke('places-geocode', { body })`.
 * Body: `{ address?, latlng?, language?, country?, nearby? }` — either `address` or `latlng` ("lat,lng") required.
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
    address?: string;
    latlng?: string;
    language?: string;
    country?: string;
    nearby?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const address = String(body.address || '').trim();
  const latlng = String(body.latlng || '').trim();
  const lang = String(body.language || 'en').trim();
  const wantNearby = Boolean(body.nearby);

  // Nearest named place (POI) — inDrive-style fallback for unnamed gated-community roads.
  if (wantNearby && latlng) {
    try {
      const nearbyParams = new URLSearchParams({
        key,
        location: latlng,
        rankby: 'distance',
        type: 'point_of_interest',
      });
      if (lang) nearbyParams.set('language', lang);

      let res = await fetch(
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${nearbyParams.toString()}`,
      );
      let raw = await res.json();

      // Broader fallback if POI returns nothing useful.
      const firstName = String(raw?.results?.[0]?.name || '');
      if (
        !res.ok ||
        String(raw?.status || '') !== 'OK' ||
        !Array.isArray(raw?.results) ||
        !raw.results.length ||
        isUnnamedLabel(firstName)
      ) {
        const retry = new URLSearchParams({
          key,
          location: latlng,
          rankby: 'distance',
          type: 'establishment',
        });
        if (lang) retry.set('language', lang);
        res = await fetch(
          `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${retry.toString()}`,
        );
        raw = await res.json();
      }

      // Pick first named result
      const results = Array.isArray(raw?.results) ? raw.results : [];
      const named = results.filter((r: { name?: string }) => {
        const n = String(r?.name || '').trim();
        return n && !isUnnamedLabel(n);
      });
      const place = named[0] || results[0] || null;
      return json(
        {
          status: String(raw?.status || (place ? 'OK' : 'ZERO_RESULTS')),
          results: named.length ? named.slice(0, 5) : results.slice(0, 5),
          place: place
            ? {
                name: place.name,
                vicinity: place.vicinity,
                formatted_address: place.vicinity || place.name,
                geometry: place.geometry,
                types: place.types,
                place_id: place.place_id,
              }
            : null,
        },
        res.ok ? 200 : 502,
      );
    } catch (e) {
      return json(
        {
          error: 'Nearby search failed',
          message: e instanceof Error ? e.message : String(e),
        },
        502,
      );
    }
  }

  const params = new URLSearchParams({ key });
  if (address) {
    params.set('address', address);
  } else if (latlng) {
    params.set('latlng', latlng);
  } else {
    return json({ error: 'Provide address or latlng' }, 400);
  }

  if (lang) params.set('language', lang);

  // Country bias/filter is for forward geocode only.
  // Applying `components=country:…` on reverse (`latlng`) often returns only the country name (e.g. "Zimbabwe").
  const cc = String(body.country || 'zw')
    .trim()
    .toLowerCase();
  if (address && cc.length === 2 && /^[a-z]{2}$/.test(cc)) {
    params.set('components', `country:${cc}`);
    if (cc === 'zw') params.set('region', 'zw');
  }

  // Prefer street-level results for reverse geocode — include neighbourhood for gated communities.
  if (latlng) {
    params.set(
      'result_type',
      'street_address|premise|subpremise|route|neighborhood|sublocality|sublocality_level_1|locality|point_of_interest|establishment',
    );
    params.set('location_type', 'ROOFTOP|RANGE_INTERPOLATED|GEOMETRIC_CENTER|APPROXIMATE');
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;

  try {
    const res = await fetch(url);
    const raw = await res.json();

    // If strict result_type filtered everything, retry reverse without filters.
    if (
      latlng &&
      raw &&
      typeof raw === 'object' &&
      String((raw as { status?: string }).status || '') === 'ZERO_RESULTS'
    ) {
      const retry = new URLSearchParams({ key, latlng });
      if (lang) retry.set('language', lang);
      const retryRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${retry.toString()}`);
      const retryRaw = await retryRes.json();
      return json(retryRaw, retryRes.ok ? 200 : 502);
    }

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
