/* eslint-disable no-undef */
/**
 * Firebase Cloud Messaging service worker — handles push when the app is backgrounded/closed.
 * Served from /firebase-messaging-sw.js (copied from public/ on build).
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBaqtOtt4ER1qXWiEQRfKU49c9dk3Md3lw',
  authDomain: 'ingo-92d5f.firebaseapp.com',
  projectId: 'ingo-92d5f',
  storageBucket: 'ingo-92d5f.firebasestorage.app',
  messagingSenderId: '6247948440',
  appId: '1:6247948440:web:1a81d52d74052cfe81f0ed',
});

const messaging = firebase.messaging();

async function closeNotificationsByTag(tag) {
  try {
    const existing = await self.registration.getNotifications(
      tag ? { tag: String(tag) } : undefined,
    );
    for (const n of existing) {
      if (!tag || n.tag === tag || String(n.tag || '').startsWith('ingo-offer-')) {
        n.close();
      }
    }
  } catch {
    /* ignore */
  }
}

messaging.onBackgroundMessage((payload) => {
  const data = (payload && payload.data) || {};
  const type = String(data.type || '').toLowerCase();
  const tag = data.tag || payload?.collapseKey || 'ingo-offer';

  if (type === 'offer_stop' || type === 'stop') {
    eventWaitClose(tag);
    return;
  }

  const title = payload?.notification?.title || data.title || 'New InGo booking';
  const body = payload?.notification?.body || data.body || 'Open the app to accept or reject.';
  const link = data.link || '/driver/home';

  self.registration.showNotification(title, {
    body,
    tag,
    requireInteraction: true,
    silent: false,
    data: { link, ...data },
    vibrate: [500, 120, 500, 120, 500, 280, 500, 120, 500],
  });
});

function eventWaitClose(tag) {
  // onBackgroundMessage is not an extendable event; close notifications immediately.
  void closeNotificationsByTag(tag);
  // Also clear any older offer notifications when tag missing.
  if (!tag) void closeNotificationsByTag();
}

self.addEventListener('message', (event) => {
  const data = event?.data || {};
  if (data.type === 'ingo-offer-stop') {
    void closeNotificationsByTag(data.tag);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/driver/home';
  const targetUrl = new URL(link, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
