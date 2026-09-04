# ADR 0002 — Accept / Decline buttons on the driver offer notification

Date: 2026-09-03. Status: accepted. Supersedes nothing; extends ADR 0001.

## Context

ADR 0001 delivers a driver offer as an FCM message with a `notification` block.
That is the only form Android delivers to a killed app with zero app code, which
is why it was chosen. It is also why the banner cannot carry buttons: Android
renders it and the app never runs.

The client asked for Accept and Decline on the notification itself, working from
a backgrounded, killed or locked phone. The ringing lock-screen takeover and a
looping sound were explicitly kept out of this change; they need a foreground
service first and remain "piece 6" in `docs/worklog.md`.

## Decision

1. **The Android leg of the message is data-only.** The sender
   (`supabase/functions/driver-offer-push`) no longer sets a top-level
   `notification` block or `android.notification`. Web still receives a display
   notification from `webpush.notification`; iOS from `apns.payload.aps.alert`.
   Those platforms are unchanged by this ADR.

2. **The app draws the notification natively.**
   `android/app/src/main/java/com/kigatta/ingo/OfferMessagingService.java`
   subclasses Capacitor's `MessagingService` and is registered in the manifest with
   intent-filter priority 1, so Firebase hands every message to it. For
   `type=offer_ring` it posts a notification on the `ingo_driver_offers` channel
   with two actions; for `type=offer_stop` it cancels by tag. It then calls the
   plugin's implementation, so the JS `pushNotificationReceived` event and token
   refresh work exactly as before. A high-priority data message starts this
   service even when the process is dead, which is what preserves killed-app
   delivery.

3. **Buttons launch the app; the app's existing code does the work.** Each
   action is a `PendingIntent` into `MainActivity` carrying the message's data,
   `google.message_id`, and `ingoAction=accept|decline`. Capacitor's push plugin
   reports any such launch to JS as `pushNotificationActionPerformed`, so the
   piece-7 tap sink (`driverPush.js` → `driverPushBootstrap.js` →
   `DriverOffersProvider.js`) receives it with no new plumbing. The provider parks
   the action, waits for the poll to surface the offer, and calls
   `driverAcceptOffer` / `driverRejectOffer` — the same functions the in-app card
   calls. There is one accept path, not two.

4. **The offer is never trusted from the payload.** The action waits up to 20 s
   for the offer to appear in the app's own fetch. An order somebody else took
   resolves to "already accepted"; an order that has aged out resolves to "no
   longer available". Both are shown in a dialog and logged.

## Consequences

- Pressing a button opens the app briefly. That is deliberate: Android 10+
  restricts background activity starts, the accept needs the WebView's Supabase
  client, and the driver should see the outcome (active delivery, or "waiting
  for the customer to choose you" on parcel/taxi bids).
- The channel id is now in three places: `driverPush.js`,
  `OfferMessagingService.java`, and ADR 0001's warning. Still unchecked by
  anything; still rename in one commit.
- The web service worker and iOS were not re-tested here. The client's developer
  should confirm a web driver still sees a display notification after this
  change (`webpush.notification` alone, no top-level `notification`).
- Anything under `android/` must be re-applied where the store builds are
  produced; that source is not in this repository (see CLAUDE.md).
