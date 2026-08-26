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

let messagingInstance = null;
let foregroundUnsub = null;
let capacitorListenersReady = false;

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
  if (type === 'offer_stop' || type === 'stop') {
    const tag = data.tag || payload?.tag || '';
    const offerKey = data.offerKey || data.offer_key || '';
    handleDriverOfferStopSignal(offerKey, tag);
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

  const prefs = readCachedDriverNotifPrefs(getDriverSession()?.id);
  if (!prefs.new_offers) return;
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
        const link = action?.notification?.data?.link || '/driver/home';
        try {
          if (window.location.pathname !== link) window.location.assign(link);
        } catch {
          /* ignore */
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
async function registerNativePushToken(driverId) {
  const Push = await getCapacitorPushPlugin();
  if (!Push) return { ok: false, error: 'Native push plugin unavailable', permission: 'unsupported' };

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
          void Promise.all(handles.map((h) => h.remove?.().catch(() => {})));
          reject(new Error('Native push registration timed out'));
        }
      }, 15000);

      const finish = (fn) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        void Promise.all(handles.map((h) => h.remove?.().catch(() => {})));
        fn();
      };

      void Push.addListener('registration', (t) => {
        finish(() => resolve(String(t?.value || '').trim()));
      }).then((h) => handles.push(h));

      void Push.addListener('registrationError', (err) => {
        finish(() => reject(new Error(err?.error || 'Native push registration failed')));
      }).then((h) => handles.push(h));

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
