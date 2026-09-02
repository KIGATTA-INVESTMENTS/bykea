#!/usr/bin/env bash
# Deploy the driver-offer-push edge function to a Supabase project, with the
# Firebase sender credentials it needs, in one step. Non-interactive: it does not
# open a browser, so it works from a script or a CI job.
#
# USAGE
#   SUPABASE_ACCESS_TOKEN=sbp_xxx  ./scripts/deploy-push-sender.sh <project-ref>
#
#   <project-ref>          e.g. gcwrnluyaqarmrovbryj  (throwaway) — NOT the client's
#                          production ref unless that is deliberately intended.
#   SUPABASE_ACCESS_TOKEN  Dashboard → avatar → Account → Access Tokens. Account-wide;
#                          treat as a password and rotate after use.
#
# Reads .secrets/fcm-service-account.json for FIREBASE_PROJECT_ID and
# FIREBASE_SERVICE_ACCOUNT_JSON — the exact names the function reads via Deno.env.
#
# --no-verify-jwt is REQUIRED for projects on new-format API keys (sb_publishable_…):
# the app invokes this function with the public key and no user session, and that
# key is not a JWT, so the gateway's default verification would 401 every call.
# supabase/config.toml says the same; the flag makes it explicit on the CLI too.
set -euo pipefail

REF="${1:-}"
[ -n "$REF" ] || { echo "usage: SUPABASE_ACCESS_TOKEN=... $0 <project-ref>"; exit 1; }
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { echo "SUPABASE_ACCESS_TOKEN is not set"; exit 1; }

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SA="$HERE/.secrets/fcm-service-account.json"
[ -f "$SA" ] || { echo "missing $SA — see scripts/send-test-offer.js SETUP"; exit 1; }

FIREBASE_PROJECT_ID="$(node -e "console.log(require('$SA').project_id)")"

echo "→ deploying driver-offer-push to $REF (JWT verification OFF)"
npx supabase functions deploy driver-offer-push \
  --project-ref "$REF" \
  --no-verify-jwt

echo "→ setting sender secrets on $REF"
npx supabase secrets set --project-ref "$REF" \
  FIREBASE_PROJECT_ID="$FIREBASE_PROJECT_ID" \
  FIREBASE_SERVICE_ACCOUNT_JSON="$(cat "$SA")"

echo "→ done. Smoke test (expects a JSON body, not a 401):"
echo "   curl -s -X POST https://$REF.supabase.co/functions/v1/driver-offer-push \\"
echo "     -H 'apikey: <publishable key>' -H 'Content-Type: application/json' \\"
echo "     -d '{\"table\":\"customer_delivery_orders\",\"orderId\":\"00000000-0000-0000-0000-000000000000\",\"action\":\"ring\"}'"
