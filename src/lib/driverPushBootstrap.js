/**
 * Driver push bootstrap — blueprint piece 5.
 *
 * Imported for its side effects from `src/index.js`, ABOVE the React mount. That
 * position is the whole point of this file, not a style choice:
 *
 *   When a driver taps an offer notification on a cold phone, Android launches the
 *   app *into* `pushNotificationActionPerformed`. A listener that is registered
 *   inside a component effect does not exist yet at the only moment it is needed,
 *   and the tap is lost with no error anywhere.
 *
 * So the tap sink is installed synchronously at import. Whatever arrives before the
 * UI is ready is parked here and collected by the driver shell once it mounts.
 *
 * This module also closes the defect that made every other piece moot: nothing in
 * the application ever called `registerDriverPushToken`, so `driver_push_tokens`
 * was never written to and every dispatched offer went to an empty token list.
 * See `docs/adr/0001-driver-offer-push-delivery.md`.
 */
import {
  setOfferTapHandler,
  startDriverPushForegroundListener,
  registerDriverPushToken,
  ensureOfferChannel,
  DRIVER_OFFER_CHANNEL_ID,
} from './driverPush';
import { getDriverSession } from './driverSession';

const PENDING_KEY = 'ingo_pending_offer_tap';

/** @type {{ link: string, offerKey: string, tag: string } | null} */
let pendingTap = null;

/**
 * Park a tap that arrived before anything could route on it.
 * Mirrored into sessionStorage because a cold start from a notification can still
 * be a full page load, which would drop a module-scope variable.
 * @param {{ link: string, offerKey: string, tag: string }} detail
 */
function parkTap(detail) {
  pendingTap = detail;
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(detail));
  } catch {
    // Private mode or storage disabled. The module-scope copy still serves this session.
  }
}

/**
 * Take the parked offer tap, if there is one. Clears it, so it is delivered once.
 * @returns {{ link: string, offerKey: string, tag: string } | null}
 */
export function consumePendingOfferTap() {
  let detail = pendingTap;
  if (!detail) {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      detail = raw ? JSON.parse(raw) : null;
    } catch {
      detail = null;
    }
  }
  pendingTap = null;
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
  if (detail) console.info(`[driverPushBootstrap] delivering parked tap ${JSON.stringify(detail)}`);
  return detail;
}

// Installed synchronously, before anything below can await. A tap that arrives
// during the async work further down still lands somewhere.
setOfferTapHandler((detail) => {
  parkTap(detail);
  try {
    window.dispatchEvent(new CustomEvent('ingo-driver-offer-tap', { detail }));
  } catch {
    // ignore
  }
});

/**
 * Obtain and store this device's push token for the signed-in driver.
 *
 * Safe to call on every driver sign-in and on every app start with a live session:
 * the upsert is idempotent on the token, and FCM hands back the same token until
 * it rotates.
 *
 * Logs the outcome either way. A driver who is not receiving offers is the single
 * most expensive silent failure in this product, so "we asked and it failed" must
 * never look like "we never asked".
 *
 * @param {string} [driverId]
 * @returns {Promise<boolean>} true only if a token was stored.
 */
export async function ensureDriverPushRegistered(driverId) {
  const id = String(driverId || getDriverSession()?.id || '').trim();
  if (!id) {
    console.info('[driverPushBootstrap] no driver session, not registering a token');
    return false;
  }

  try {
    const res = await registerDriverPushToken(id);
    if (res?.ok) {
      console.info(
        `[driverPushBootstrap] push token stored ${JSON.stringify({
          platform: res.platform,
          driverId: 'present',
        })}`,
      );
      return true;
    }
    // Expected and common: permission denied, no VAPID key on web, no
    // google-services.json in a native build. All of them mean this driver gets
    // offers only from the fallback poll, which is worth saying out loud.
    console.warn(
      `[driverPushBootstrap] push token NOT stored, falling back to polling ${JSON.stringify({
        error: res?.error || '',
        permission: res?.permission || '',
      })}`,
    );
    return false;
  } catch (e) {
    console.warn('[driverPushBootstrap] push registration threw', e?.message || e);
    return false;
  }
}

// One unconditional line proving this module loaded at all. Without it, "push is
// not wired in" and "push is wired in and found nothing to do" are the same
// silence — which is the exact condition this whole file exists to end.
console.info('[driverPushBootstrap] loaded, installing push listeners');

// Create the Android channel now, not at token-registration time. It needs no
// session and no token, an offer push can only be rendered correctly if it already
// exists, and creating it here means `adb shell dumpsys notification_manager` can
// confirm it without anybody signing in.
void ensureOfferChannel()
  .then(() => console.info(`[driverPushBootstrap] channel requested ${DRIVER_OFFER_CHANNEL_ID}`))
  .catch(() => {});

// Start listeners regardless of whether a driver is signed in yet. On a cold start
// from a tap the session is restored from storage a moment later, and the listener
// has to already be there.
void startDriverPushForegroundListener()
  .then(() => console.info('[driverPushBootstrap] listeners installed'))
  .catch((e) => {
    console.warn(`[driverPushBootstrap] listener start failed: ${e?.message || e}`);
  });

// Always call in, never guard the call. ensureDriverPushRegistered decides whether
// there is a session and says so either way. Guarding here would reinstate the
// silence: no session and no log look identical to never having run.
if (typeof window !== 'undefined') {
  window.setTimeout(() => {
    void ensureDriverPushRegistered();
  }, 0);
}
