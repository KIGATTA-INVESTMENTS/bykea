# ADR 0001 — How a driver offer reaches a backgrounded phone

**Date:** 2026-09-02
**Status:** Accepted for pieces 1-5 and 7. Supersession expected when the
answerable offer screen (piece 6) is built.
**Context:** internal background-push standard. First ADR in this repository.

## Context

Driver offer push has never worked in this product, on any platform.

The cause was not the missing `google-services.json` recorded in our earlier
audit. It is that
`registerDriverPushToken()` in `src/lib/driverPush.js` was **exported and never
called by any application code**. Verified by exhaustive grep across `src/` and
`public/`: the only external reference to the module was `clearDriverPushToken`
on sign-out. No token was ever obtained, so `driver_push_tokens` was never
written to, so every dispatched offer was pushed to an empty list.

The earlier claim that web push "works when the browser is closed" is therefore
wrong. The web code is correct and unreachable.

This is a failure pattern we have seen before on another dispatch product, and it
is worth naming because it is invisible: the dispatcher sends correctly, the token
table is empty, nothing logs and nothing throws. Offers go to nobody and every
component reports success.

## Decision

### 1. The ring push keeps its `notification` block. It is not data-only.

Blueprint rule 1 says only a headless (data-only) push runs application code,
and that anything you want to *do* on arrival must hang off a data-only message.
That rule is correct and we are choosing not to act on it yet, deliberately.

On Android, Capacitor's `PushNotifications` plugin does **not** display a
data-only message. Going data-only today would mean the app is responsible for
raising the notification itself, which requires a local-notification plugin that
is not installed, and leads directly into the full-screen-intent work that is
explicitly out of scope for this pass.

So the trade is:

| Shape | Backgrounded arrival | Result |
|---|---|---|
| `notification` + `data` (**chosen**) | OS renders the banner. No app code runs. `data` is handed to the app **on tap**. | Driver sees the offer, taps, app opens on it, accepts or declines in-app. |
| data-only, today | App code runs. Nothing is displayed, because nothing displays it. | Driver sees nothing. Strictly worse. |

**The consequence must be stated plainly, because it is invisible:** with this
shape, `handleIncomingOfferPayload` does not run when the app is backgrounded.
The in-app ring (`notifyDriverNewOffer`) is a **foreground-only** behaviour. A
backgrounded driver gets the standard Android notification sound for the
channel, not the app's ring.

Making the ring work on a locked phone is piece 6 and it is its own project.
When that is built, this decision flips to data-only and the app takes over
display. That is the expected supersession.

`stop` remains data-only, which is correct: it has nothing to display and exists
only to cancel a notification.

### 2. Listeners are registered at module import, above the React mount.

`src/lib/driverPushBootstrap.js` is imported for its side effects from
`src/index.js` before `root.render`. A notification tap cold-starts the app
directly into `pushNotificationActionPerformed`; a listener registered in a
component effect does not exist at that moment and the tap is lost silently.

The tap is parked in module scope and mirrored to `sessionStorage`, then
collected by the driver shell once it mounts. It is delivered once.

### 3. The tap no longer navigates by `window.location.assign`.

On a cold start that reloads the app that is already starting. The handler now
hands the offer to a sink the bootstrap installs.

### 4. The channel is created by the app, with the id the server names.

`DRIVER_OFFER_CHANNEL_ID` in `src/lib/driverPush.js` must equal
`android.notification.channel_id` in the edge function. Nothing validates this.
A push naming a channel that was never created is delivered on the default
channel, silently, at ordinary importance. The channel is also immutable once
created, so changing its sound requires a new id, not an edit.

### 5. The ring push is given a TTL and a collapse key.

`ttl: '120s'`, matching `OFFER_RING_CYCLE_MS`, and `collapse_key` per order.
Without a TTL, FCM holds a message for up to four weeks: a phone regaining
signal an hour later rings for a job that closed. Blueprint piece 4.

### 6. Push stays an accelerator. The poll is the transport.

`DriverOffersProvider` already polls every 2500 ms alongside a realtime channel.
That stays, and it is what a driver on a battery-managed handset actually gets.
Blueprint rule 3.

## Consequences

- A backgrounded driver gets a normal Android notification and can act on it in
  two taps. That is the deliverable, and it is honest about what it is not.
- The app's own ring remains foreground-only until piece 6 exists.
- No foreground service is running, so an aggressive OEM battery manager can
  still stop delivery entirely. Those drivers fall back to the poll. InGo needs a
  location foreground service for driver tracking anyway; that is where this
  should be solved once, not bolted onto push.
- Three steps remain that only KIGATTA can authorise: registering
  `com.kigatta.ingo` in Firebase `ingo-92d5f`, adding `google-services.json`, and
  deploying the edited edge function.

## What would tell us this broke

`[driverPushBootstrap] push token NOT stored` in the client log is the single
line that matters. It distinguishes "we asked for a token and were refused" from
"we never asked", which was the previous state and left no evidence at all.

Server-side, `driver-offer-push` already logs an empty token list. That log was
firing correctly the whole time. Nobody was reading it.
