import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://iaorixerxnqedwgkqxtz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlhb3JpeGVyeG5xZWR3Z2txeHR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDA2NzMsImV4cCI6MjA5MzMxNjY3M30.V1Ttor7zpdKP96KVdJokec9L92u3LMdyvY6UzWRL_0g';

const rawUrl = process.env.REACT_APP_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '');
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Helps catch missing env vars during local development.
  // App still builds, but DB calls will fail until env vars are configured.
  // eslint-disable-next-line no-console
  console.warn('Supabase env vars are missing. Check REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.');
}

// This app does not use Supabase Auth at all (`supabase.auth` has zero call sites;
// sessions are hand-rolled in customerSession.js / driverSession.js). With the
// default options, supabase-js still runs GoTrue's session machinery, which takes a
// `navigator.locks` lock named "lock:sb-<ref>-auth-token" around every request.
// Inside the Capacitor WebView that lock contends and stalls each call by ~5s
// ("Lock … was not released within 5000ms … Forcefully acquiring the lock"), so a
// driver pressing Accept — several requests in a row — sat on "…" indefinitely.
// Observed on device 2026-09-03. Turning the unused auth client off removes the lock.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

