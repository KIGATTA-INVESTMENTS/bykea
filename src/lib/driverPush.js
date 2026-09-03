/**
 * Register / save FCM tokens so drivers get offer alerts (web + native WebView / Capacitor).
 * Native shells often block Web Push / service workers — we register Capacitor Push when available.
 */
import { getApps } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { app, isFirebaseConfigured } from './firebase';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { notifyDriverNewOffer, handleDriverOfferStopSignal } from './driverOfferRing';
import { readCachedDriverNotifPrefs } from './driverNotificationPrefs';
import { getDriverSession } from './driverSession';

const SW_PATH = '/firebase-messaging-sw.js';

/**
 * Android notification channel id for driver offers.
 *
 * This string MUST equal `android.notification.channel_id` in
 * `supabase/functions/driver-offer-push/index.ts`. Nothing can check that the two
 * agree: FCM does not validate the name, and a push naming a channel the app never
 * created is delivered on the default channel — silently, at ordinary importance,
 * with no sound. If you rename it here, rename it there in the same commit.
 *
 * An Android channel is immutable once created. Changing the sound or importance
 * below has no effect on any handset that has already run the app; only a fresh
 * install sees it. To change either, bump the id (…_v2) and retire the old one.
 */
export const DRIVER_OFFER_CHANNEL_ID = 'ingo_driver_offers';

const SILENT = () => {};
/** Set by driverPushBootstrap so a cold-start tap is not lost before React mounts. */
let onOfferTapped = SILENT;

/**
 * Install the sink that receives notification taps.
 * @param {(detail: { link: string, offerKey: string, tag: string }) => void} fn
 */
export function setOfferTapHandler(fn) {
  onOfferTapped = typeof fn === 'function' ? fn : SILENT;
}

let messagingInstance = null;
let foregroundUnsub = null;
let capacitorListenersReady = false;
let channelReady = false;

function vapidKey() {
  return String(process.env.REACT_APP_FIREBASE_VAPID_KEY || '').trim();
}

function isNativeShell() {
  try {
    const cap = typeof window !== 'undefined' ? window.Capacitor : null;
    if (!cap) return false;
    if (typeof cap.isNativePlatform === 'function') return Boolean(cap.isNativePlatform());
    return Boolean(cap.isNative || cap.platform === 'ios' || cap.platform === 'android');
  } catch {
    return false;
  }
}

function nativePlatformLabel() {
  try {
    const cap = window.Capacitor;
    const p = typeof cap?.getPlatform === 'function' ? cap.getPlatform() : cap?.platform;
    if (p === 'ios' || p === 'android') return p;
  } catch {
    /* ignore */
  }
  return 'android';
}

/**
 * @returns {Promise<any | null>} Capacitor PushNotifications plugin, or null
 */
async function getCapacitorPushPlugin() {
  if (typeof window === 'undefined') return null;
  try {
    const injected = window.Capacitor?.Plugins?.PushNotifications;
    if (injected && typeof injected.register === 'function') return injected;
  } catch {
    /* ignore */
  }
  try {
    const mod = await import('@capacitor/push-notifications');
    if (mod?.PushNotifications) return mod.PushNotifications;
  } catch {
    /* package missing or not in Capacitor */
  }
  return null;
}

/**
 * Withdraw a delivered system notification on native. No-op on web (the service
 * worker handles that path) and when the plugin is absent. Never throws.
 *
 * With a tag, removes that one offer. Without one, removes every `ingo-offer-*`
 * notification — the "clear everything" case when the app cannot tell which.
 * @param {string} [tag]
 */
export async function removeDeliveredOfferNotification(tag) {
  const Push = await getCapacitorPushPlugin();
  if (!Push || typeof Push.getDeliveredNotifications !== 'function') return;
  try {
    const { notifications = [] } = (await Push.getDeliveredNotifications()) || {};
    const want = String(tag || '').trim();
    const matching = notifications.filter((n) => {
      const t = String(n?.tag || '');
      return want ? t === want : t.startsWith('ingo-offer-');
    });
    console.info(
      `[driverPush] withdraw offer notification ${JSON.stringify({
        tag: want || '(all ingo-offer-*)',
        delivered: notifications.length,
        matching: matching.length,
      })}`,
    );
    if (!matching.length) return;
    await Push.removeDeliveredNotifications({ notifications: matching });
  } catch (e) {
    console.warn(`[driverPush] withdraw failed: ${e?.message || e}`);
  }
}

/**
 * @returns {Promise<ServiceWorkerRegistration | null>}
 */
async function ensureMessagingSw() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (isNativeShell()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_PATH);
  } catch (e) {
    console.warn('[driverPush] service worker register failed', e);
    return null;
  }
}

/**
 * @returns {Promise<import('firebase/messaging').Messaging | null>}
 */
async function getDriverMessaging() {
  if (!isFirebaseConfigured || !app) return null;
  if (isNativeShell()) return null;
  const ok = await isSupported().catch(() => false);
  if (!ok) return null;
  if (!messagingInstance) {
    try {
      messagingInstance = getMessaging(app);
    } catch (e) {
      console.warn('[driverPush] getMessaging failed', e);
      return null;
    }
  }
  return messagingInstance;
}

/**
 * @param {string} driverId
 * @param {string} token
 * @param {string} platform
 */
async function upsertPushToken(driverId, token, platform) {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: 'Supabase not configured' };
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 280) : '';
  const now = new Date().toISOString();
  const { error } = await supabase.from('driver_push_tokens').upsert(
    {
      driver_id: driverId,
      fcm_token: token,
      platform: platform || 'web',
      user_agent: ua || null,
      updated_at: now,
    },
    { onConflict: 'fcm_token' },
  );
  if (error) {
    console.warn('[driverPush] token upsert failed', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function handleIncomingOfferPayload(payload) {
  const data = payload?.data || {};
  const type = String(data.type || payload?.type || '').toLowerCase();

  // Log BEFORE every guard below. Otherwise "the handler never ran" and "it ran and
  // decided to do nothing" both leave no trace, and they need opposite fixes.
  // Serialised into the message string on purpose: Capacitor's console bridge
  // logs a trailing object argument to logcat as "[object Object]", which loses
  // both the values and the prefix that makes the line greppable on a device.
  console.info(
    `[driverPush] payload received ${JSON.stringify({
      type: type || '(none)',
      tag: data.tag || '',
      offerKey: data.offerKey || data.offer_key || '',
      hasNotificationBlock: Boolean(payload?.notification),
    })}`,
  );
  if (type === 'offer_stop' || type === 'stop') {
    const tag = data.tag || payload?.tag || '';
    const offerKey = data.offerKey || data.offer_key || '';
    handleDriverOfferStopSignal(offerKey, tag);
    // Withdraw the system notification too. The web service worker does this via
    // closeNotificationsByTag; on native nothing did, so a driver whose offer was
    // taken by someone else kept a stale "New InGo delivery" in the shade.
    // Measured 2026-09-02: the stop payload reached the backgrounded app and this
    // handler ran, but the notification stayed posted. One order, one
    // notification — and it must go when the order does.
    void removeDeliveredOfferNotification(tag);
    try {
      window.dispatchEvent(
        new CustomEvent('ingo-driver-offer-stop', {
          detail: { title: '', body: '', tag, offerKey },
        }),
      );
    } catch {
      /* ignore */
    }
    return;
  }

  const driverId = getDriverSession()?.id;
  const prefs = readCachedDriverNotifPrefs(driverId);
  if (!prefs.new_offers) {
    console.info(
      `[driverPush] offer suppressed by driver preference ${JSON.stringify({
        driverId: driverId ? 'present' : 'none',
      })}`,
    );
    return;
  }
  const title = payload?.notification?.title || data.title || payload?.title || 'New InGo booking';
  const body =
    payload?.notification?.body || data.body || payload?.body || 'Open the app to accept or reject.';
  const tag = data.tag || payload?.tag || `ingo-offer-${Date.now()}`;
  const offerKey = String(data.offerKey || data.offer_key || tag.replace(/^ingo-offer-/, '') || '').trim();
  notifyDriverNewOffer({
    title,
    body,
    tag,
    offerKey,
    onClickPath: data.link || payload?.link || '/driver/home',
    sound: prefs.offer_sound,
    banner: true,
    loop: true,
  });
  try {
    window.dispatchEvent(
      new CustomEvent('ingo-driver-push-offer', {
        detail: { title, body, tag, offerKey },
      }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * Play in-app ring when a push arrives while the app is open.
 */
export async function startDriverPushForegroundListener() {
  if (foregroundUnsub) return;
  const messaging = await getDriverMessaging();
  if (messaging) {
    try {
      foregroundUnsub = onMessage(messaging, (payload) => {
        handleIncomingOfferPayload(payload);
      });
    } catch (e) {
      console.warn('[driverPush] onMessage failed', e);
    }
  }

  const Push = await getCapacitorPushPlugin();
  if (Push && !capacitorListenersReady) {
    capacitorListenersReady = true;
    try {
      await Push.addListener('pushNotificationReceived', (notification) => {
        handleIncomingOfferPayload({
          title: notification?.title,
          body: notification?.body,
          data: notification?.data || {},
        });
      });
      await Push.addListener('pushNotificationActionPerformed', (action) => {
        const data = action?.notification?.data || {};
        const link = data.link || '/driver/home';
        const detail = {
          link,
          offerKey: String(data.offerKey || data.offer_key || '').trim(),
          tag: String(data.tag || '').trim(),
          // 'accept' | 'decline' when a notification button was pressed (set by
          // OfferMessagingService on Android); '' for a plain tap on the banner.
          action: String(data.ingoAction || '').trim().toLowerCase(),
        };
        console.info(`[driverPush] offer tapped ${JSON.stringify(detail)}`);

        // Hand to the bootstrap sink first. On a cold start the OS launches the app
        // *into* this event, so the router does not exist yet and assigning
        // window.location would reload the app we are already starting.
        try {
          onOfferTapped(detail);
        } catch (e) {
          console.warn('[driverPush] tap sink threw', e?.message || e);
        }
      });
    } catch (e) {
      console.warn('[driverPush] Capacitor listeners failed', e);
    }
  }
}

/**
 * @param {string} driverId
 * @returns {Promise<{ ok: boolean, token?: string, error?: string, permission?: string, platform?: string }>}
 */
/**
 * Create the Android channel the server's pushes name.
 * No-op on iOS and on web. Safe to call repeatedly; Android ignores a re-create.
 * @param {any} Push
 */
export async function ensureOfferChannel(Push) {
  if (channelReady) return;
  const plugin = Push || (await getCapacitorPushPlugin());
  if (typeof plugin?.createChannel !== 'function') return;
  try {
    await plugin.createChannel({
      id: DRIVER_OFFER_CHANNEL_ID,
      name: 'Ride and delivery offers',
      description: 'New job offers. Time-critical.',
      importance: 5, // IMPORTANCE_HIGH — heads-up banner plus sound.
      visibility: 1, // VISIBILITY_PUBLIC — shows on the lock screen.
      // NO `sound` key on purpose. Capacitor turns a sound string into a raw
      // resource URI (`android.resource://<pkg>/raw/<value>`), so passing 'default'
      // pointed the channel at res/raw/default, which does not exist in this app.
      // Verified on an emulator via `dumpsys notification --noredact`: the channel
      // was created with an unresolvable sound URI. A time-critical offer alert
      // that arrives silent is the worst possible failure here, and nothing warns
      // you. Omitting the key gives the channel the system default sound.
      // To ship a custom sound: add android/app/src/main/res/raw/<name>.mp3, pass
      // `sound: '<name>'`, AND bump the channel id — a channel is immutable.
      vibration: true,
      lights: true,
    });
    channelReady = true;
    console.info('[driverPush] channel ready', DRIVER_OFFER_CHANNEL_ID);
  } catch (e) {
    // Never fatal: without the channel the push still arrives, just on the
    // default channel at ordinary importance. Worth knowing about, not worth failing for.
    console.warn('[driverPush] createChannel failed', e?.message || e);
  }
}

async function registerNativePushToken(driverId) {
  const Push = await getCapacitorPushPlugin();
  if (!Push) return { ok: false, error: 'Native push plugin unavailable', permission: 'unsupported' };

  await ensureOfferChannel(Push);

  try {
    let perm = await Push.checkPermissions();
    if (perm.receive !== 'granted') {
      perm = await Push.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      return { ok: false, permission: perm.receive || 'denied', error: 'Notification permission not granted' };
    }

    const tokenPromise = new Promise((resolve, reject) => {
      let settled = false;
      /** @type {Array<{ remove: () => Promise<void> }>} */
      const handles = [];
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          void Promise.all(handles.map((h) => Promise.resolve(h?.remove?.()).catch(() => {})));
          reject(new Error('Native push registration timed out'));
        }
      }, 15000);

      const finish = (fn) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        void Promise.all(handles.map((h) => Promise.resolve(h?.remove?.()).catch(() => {})));
        fn();
      };

      // Promise.resolve() on purpose. `getCapacitorPushPlugin()` prefers the
      // bridge-injected `window.Capacitor.Plugins.PushNotifications`, and on
      // Capacitor 8 that object's addListener returns a plain handle, not a
      // Promise — only the ESM-imported plugin returns a Promise. Calling
      // `.then()` on the injected one throws
      // "t.addListener(...).then is not a function", the whole registration is
      // caught as a failure, and no token is ever obtained. Observed on device
      // 2026-09-02. This works with either shape.
      void Promise.resolve(
        Push.addListener('registration', (t) => {
          finish(() => resolve(String(t?.value || '').trim()));
        }),
      ).then((h) => h && handles.push(h));

      void Promise.resolve(
        Push.addListener('registrationError', (err) => {
          finish(() => reject(new Error(err?.error || 'Native push registration failed')));
        }),
      ).then((h) => h && handles.push(h));

      void Push.register().catch((e) => finish(() => reject(e)));
    });

    const token = await tokenPromise;
    if (!token) return { ok: false, permission: 'granted', error: 'Empty native push token' };

    const platform = nativePlatformLabel();
    const up = await upsertPushToken(driverId, token, platform);
    if (!up.ok) return { ok: false, permission: 'granted', token, error: up.error, platform };

    void startDriverPushForegroundListener();
    return { ok: true, permission: 'granted', token, platform };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), permission: 'denied' };
  }
}

/**
 * Request notification permission (if needed), get FCM / native token, upsert for this driver.
 * @param {string} driverId
 * @returns {Promise<{ ok: boolean, token?: string, error?: string, permission?: string, platform?: string }>}
 */
export async function registerDriverPushToken(driverId) {
  const id = String(driverId || '').trim();
  if (!id) return { ok: false, error: 'Missing driver id' };

  // Prefer native push inside Capacitor / WebView apps (Web Push usually fails there).
  if (isNativeShell() || (await getCapacitorPushPlugin())) {
    const native = await registerNativePushToken(id);
    if (native.ok) return native;
    // Fall through to web if native failed and web might still work.
    if (isNativeShell()) return native;
  }

  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return { ok: false, error: 'Notifications unsupported', permission: 'unsupported' };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }
  if (permission !== 'granted') {
    return { ok: false, error: 'Notification permission not granted', permission };
  }

  const key = vapidKey();
  if (!key) {
    return {
      ok: false,
      permission,
      error:
        'Missing REACT_APP_FIREBASE_VAPID_KEY — add the Web Push certificate key from Firebase Console.',
    };
  }

  if (!isFirebaseConfigured || !getApps().length) {
    return { ok: false, permission, error: 'Firebase is not configured' };
  }

  const swReg = await ensureMessagingSw();
  const messaging = await getDriverMessaging();
  if (!messaging) {
    return { ok: false, permission, error: 'FCM messaging not supported in this browser/WebView' };
  }

  let token = '';
  try {
    token = await getToken(messaging, {
      vapidKey: key,
      serviceWorkerRegistration: swReg || undefined,
    });
  } catch (e) {
    return { ok: false, permission, error: e?.message || String(e) };
  }

  if (!token) return { ok: false, permission, error: 'Empty FCM token' };

  const up = await upsertPushToken(id, token, 'web');
  if (!up.ok) return { ok: false, permission, token, error: up.error, platform: 'web' };

  void startDriverPushForegroundListener();
  return { ok: true, permission, token, platform: 'web' };
}

/**
 * Remove this device token (best-effort) on logout.
 * @param {string | null | undefined} driverId
 */
export async function clearDriverPushToken(driverId) {
  if (!isSupabaseConfigured || !supabase) return;
  const id = String(driverId || '').trim();
  if (!id) return;

  try {
    const Push = await getCapacitorPushPlugin();
    if (Push && typeof Push.removeAllListeners === 'function') {
      // Keep listeners; just delete stored tokens for this driver on this UA best-effort below.
    }
  } catch {
    /* ignore */
  }

  const key = vapidKey();
  try {
    const messaging = await getDriverMessaging();
    const swReg = await ensureMessagingSw();
    if (messaging && key) {
      const token = await getToken(messaging, {
        vapidKey: key,
        serviceWorkerRegistration: swReg || undefined,
      });
      if (token) {
        await supabase.from('driver_push_tokens').delete().eq('fcm_token', token).eq('driver_id', id);
      }
    }
  } catch {
    /* ignore */
  }
}

export { isNativeShell };
