# Worklog

Append-only record of work in this repository. Newest at the bottom.

Read it before touching anything. Add your entry **before** you write code.

## The rules

1. Claim your files before you edit them.
2. Re-read the tree before you write; `git status` from an hour ago is stale.
3. Never re-implement a shared module. Extend it.
4. Say what you did not build.

## Entries

### 2026-09-02 — Android background push for driver offers (pieces 1-5, 7)

**Status:** complete for pieces 1-5 and 7. Local test rig ready; delivery test awaits a throwaway Firebase project (ours, ~15 min)
**Owns:**
- `docs/worklog.md` (new)
- `docs/adr/0001-driver-offer-push-delivery.md` (new)
- `src/lib/driverPushBootstrap.js` (new)

**Shares:**
- `src/lib/driverPush.js` — exact edit: add channel creation, Android 13 permission request, logging before each early return, export a bootstrap entry point. No rewrite of the existing FCM logic; it is correct.
- `src/index.js` — exact edit: one import, above the React mount, so push listeners exist before the UI framework.
- `src/components/driver/DriverOffersProvider.js` — exact edit: consume a cold-start offer handed over by the bootstrap.
- `android/app/src/main/AndroidManifest.xml` — exact edit: add `POST_NOTIFICATIONS`.
- `supabase/functions/driver-offer-push/index.ts` — **written, not deployed.** See sign-off list below.

**What this is:** make an offer reach a driver whose app is backgrounded, and let
them act on it. Scope is the blueprint's pieces 1-5 and 7. **Piece 6 (ringing,
answerable, over-the-lock-screen) is explicitly out of scope** — see below.

## The root cause, which was not what the audit said

Our earlier audit recorded "the code is not the
problem, the configuration is", and calls web push "the best-engineered
subsystem in the codebase… it works when the browser is closed."

**Both halves are wrong, and the correction matters more than the config.**

`registerDriverPushToken()` is exported from `src/lib/driverPush.js:281` and
**never imported or called by any application code.** Verified by exhaustive grep
across `src/` and `public/`: the only external reference to the module anywhere
is `driverSession.js:111`, which calls `clearDriverPushToken` on sign-out.

So no token is ever obtained, on web or native, and `driver_push_tokens` is
never written to by any code path. `startDriverPushForegroundListener()` is
likewise only reachable from inside the function nobody calls.

**This is a failure pattern seen before on another dispatch product**: the
dispatcher pushes, the token table is empty, nothing logs, nothing throws. The
web path has never worked either. It is correct code that is not wired in.

## Four further defects found while reading, not previously recorded

1. **The ring message is not data-only** (`supabase/functions/driver-offer-push/index.ts:161`).
   It carries a top-level `notification` block, so on a backgrounded Android app
   the OS renders the banner and **no application code runs**. Blueprint rule 1.
   The `stop` message *is* data-only — the asymmetry is the wrong way round.
2. **No TTL and no collapse key** on the ring message. A phone that regains
   signal an hour later is offered a job that closed long ago. Blueprint piece 4.
3. **The channel `ingo_driver_offers` is named by the server but created by
   nobody.** No `createChannel` call exists in the repo. Blueprint rule 5: a push
   naming a channel that does not exist is delivered on the default channel,
   quietly, at ordinary importance.
4. **No `POST_NOTIFICATIONS` permission and no runtime request**, so Android 13+
   shows nothing regardless of token.

## Needs sign-off before it can be finished

This is a live client system with no staging. These three steps are client-console or production
writes and are **not** being done unilaterally:

- **Register `com.kigatta.ingo` in Firebase project `ingo-92d5f`** and add
  `android/app/google-services.json`. Client console action.
- **Deploy the edited `driver-offer-push` edge function.** Production deploy.
- **End-to-end test with a real driver login**, which writes a row to
  `driver_push_tokens` in the live database. There is no seeded test driver:
  `supabase/seed_test_driver.sql` was never run against production (verified
  2026-08-30 — login returns "No driver account found").

**Deliberately not built:**
- **Piece 6, the answerable lock-screen offer** — full-screen intent, looped
  sound, Accept/Decline on the notification itself. On a prior dispatch product this cost three ADRs, a hand-written config plugin
  and several rounds of field failure.
  It is its own project. This pass raises a normal notification that opens the
  app to the offer.
- **A foreground service to hold the process alive** (blueprint rule 2). InGo
  needs one anyway for driver location; it should be built once and shared, not
  bolted onto push. Without it, an OEM battery manager will kill delivery on
  some handsets and the fallback poll is what those drivers get.
- **iOS push.** No APNs key, no `ios/` project in this repo.

## Verified on a device (Android 15, API 35 emulator, debug build)

1. **Web build compiles clean.** No new warnings in any file touched.
2. **APK builds and installs.** Gradle exit 0. Capacitor only applies the
   google-services plugin when the JSON exists, so a missing `google-services.json`
   does **not** fail the build. It logs "Push Notifications won't work" at
   `logger.info` — invisible at default log level. Another silent failure.
3. **The app starts with no `google-services.json` and does not crash.** Push
   degrades; nothing else is affected.
4. **The evidence is readable in logcat and the three states are distinct:**
   ```
   [driverPushBootstrap] loaded, installing push listeners
   [driverPushBootstrap] listeners installed
   [driverPushBootstrap] no driver session, not registering a token
   [driverPush] channel ready ingo_driver_offers
   ```
5. **The channel is registered by Android**, confirmed independently of our own
   logs via `dumpsys notification --noredact`: `mId='ingo_driver_offers'` (exactly
   matching the server string), `mImportance=5`, `mBypassDnd=false` (rule 9),
   `mSound=content://settings/system/notification_sound`.
6. **`POST_NOTIFICATIONS` works.** Present in the merged manifest; app-level
   importance moves `NONE` → `DEFAULT` when granted. Before this change the
   permission was not declared at all, so the runtime request auto-denied.

## Two defects found *by* running it, not by reading it

- **My own logging was unreadable on device.** `console.info('msg', {obj})` reaches
  logcat as `[object Object]`, losing the message and the greppable prefix. All log
  calls now serialise into the message string.
- **The channel was created with an unresolvable sound URI.** Capacitor turns
  `sound: 'default'` into `android.resource://com.kigatta.ingo/raw/default`, and
  `res/raw/` does not exist in this app. A time-critical offer alert would have
  arrived **silent**, with nothing warning anyone. Fixed by omitting the key.
  Caught only because the channel was dumped and read.

I also caught myself writing `if (getDriverSession()?.id) ensureDriverPushRegistered()`
— guarding the call so the "no session" log could never fire. That is the exact
rule being implemented, broken while implementing it. The call is now unconditional
and the function decides and logs.

## Second pass, same day — three more found by running it

**1. Native token registration threw before reaching FCM.**
`t.addListener(...).then is not a function`. `getCapacitorPushPlugin()` prefers
the bridge-injected `window.Capacitor.Plugins.PushNotifications`, and on
Capacitor 8 that object's `addListener` returns a plain handle, not a Promise —
only the ESM import returns a Promise. The `.then()` threw, the registration was
caught as a failure, and no token was ever obtained. **This would have blocked
push even with `google-services.json` present.** Fixed with `Promise.resolve()`
around both `addListener` calls and both `remove()` calls. Only visible because
the new logging printed the error; before, it was swallowed.

**2. Fixing (1) unmasked a process crash behind it.** With the JS bug gone,
execution reached `Push.register()`, which without `google-services.json`
throws natively — `IllegalStateException: Default FirebaseApp is not
initialized` at `PushNotificationsPlugin.register:103` — on the CapacitorPlugins
thread, inside the reflective call. **JS cannot catch it; the process dies.**
Observed: driver sign-in killed the app. There is no runtime guard. So
`android/app/build.gradle` now throws a `GradleException` on any *release* task
when the file is missing, and `warn`s (not `info`) on debug. **Verified both
ways:** `assembleRelease` fails with the message, exit 1; `assembleDebug`
succeeds, exit 0, APK produced.

**3. The tap-routing path cannot be tested with a fake session.**
`DriverLayout` wraps `DriverOffersProvider` inside `DriverApprovalGate`, which
looks the driver up in the database and bounces unknown ids to `/driver/login`.
So the provider — and my routing effect — never mounts for a seeded session.
Token registration *does* run, because the bootstrap fires before the gate. The
tap test therefore needs a real approved driver, i.e. the local Supabase rig in
`docs/push-local-testing.md` (Part 2).

## The sign-off list, revised

Confirmed verbally on 2026-09-02: we have the access and are deliberately not
going live: build locally, test locally, then hand to KIGATTA's developer to
deploy. So the three items above are no longer "blocked on the client" — they
are steps in `docs/push-local-testing.md`, against throwaway projects we own.
`scripts/send-test-offer.js` sends the byte-identical FCM v1 message from a
laptop, so delivery is testable with nothing deployed.

## Sender half verified — 2026-09-02, later

`scripts/send-test-offer.js` run against a deliberately bogus device token:
the service-account JWT was accepted by Google's token endpoint, the request
reached FCM, and FCM answered `400 INVALID_ARGUMENT: The registration token is
not a valid FCM registration token`. That is the correct response and it proves
authentication, project id, and the request shape end to end. **The sender works.
The remaining unknown is entirely on the device side**, which needs
`google-services.json` for the same project.

Note: the key used was for the client's production Firebase project, not a
throwaway. That is a contained choice for this test (a push targets one token),
but the key was shared in plain text and should be rotated after testing.

## VERIFIED end to end on a device — 2026-09-02, Android 15 (API 35)

Firebase project `ingo-92d5f`, package `com.kigatta.ingo`, a real FCM token from
the device, real messages accepted by FCM, sent with `scripts/send-test-offer.js`.

| Case | Result | Evidence |
|---|---|---|
| Token registration | **works** | Reached the DB upsert; rejected only by the FK on the fake driver id, which is correct |
| App **foreground**, ring | **works** | `[driverPush] payload received {"type":"offer_ring",…}` |
| App **backgrounded**, ring | **works, OS-rendered** | `NotificationRecord … channel=ingo_driver_offers tag=ingo-offer-local-test-0001 importance=5`; **0** lines of app code, exactly as ADR 0001 predicts |
| Heads-up banner | **seen** | Screenshot at t+2 s: "New InGo delivery • now 🔔 / Harare CBD to Avondale…" |
| **Tap** | **works** | App to foreground; `[driverPush] offer tapped {"link":"/driver/home",…}` |
| App **killed** (`am kill`, the swipe-away equivalent) | **works** | FCM spawned the process and posted; 0 app code |
| App **force-stopped** | **nothing, by design** | Android's *stopped state* drops FCM broadcasts. `force-stop` is not what a driver does; `am kill` is the honest proxy |
| **Stop** signal | **works, after a fix** | See below. Now `posted: 1 → 0`, log `withdraw … delivered:1, matching:1` |

**Not exercised:** the router hop in `DriverOffersProvider` (`[DriverOffers]
routing to tapped offer`). `DriverApprovalGate` checks the driver in the database
and bounces the fake id before the provider mounts, so it needs a real approved
driver — Part 2 of `docs/push-local-testing.md`. The tap *handler* and the
parked-tap mechanism are verified; only that last hop into the router is not.

**Not audible:** channel sound, on an emulator. The channel resolves to
`content://settings/system/notification_sound` and the banner showed the bell.

**Still true:** `visibility: 1` is ignored by Capacitor (`mLockscreenVisibility=-1000`),
harmless until piece 6; the fallback poll only runs while the app is open; the
edge-function edits (TTL, collapse key) are written, not deployed.

**Inference worth confirming with the client's developer:** the Android app in
`ingo-92d5f` appears to have been registered today (fresh app id, download named
`(4)`), which would mean the store build was never wired to this Firebase project.

## Withdraw defect, found by the stop test

The stop branch of `handleIncomingOfferPayload` called
`handleDriverOfferStopSignal` (in-app ring) and dispatched an event, but on native
nothing cancelled the *system* notification. The web service worker does that with
`closeNotificationsByTag`; native had no equivalent, so a driver whose offer was
taken by someone else kept a stale "New InGo delivery" in the shade. Measured:
the data-only stop woke the backgrounded app and the handler ran, notification
stayed. Fixed with `removeDeliveredOfferNotification(tag)` —
`getDeliveredNotifications` → filter by tag → `removeDeliveredNotifications`,
logged before the guard so "no plugin" and "nothing matched" leave different traces.

## Schema bundle for throwaway projects — and a currency fingerprint

`scripts/build-migration-bundle.js` concatenates the 69 schema files (plus the
seed as a marked optional block) into `supabase/bundle/all-in-order.sql` in
dependency order: topological sort over "creates table X" → "references / alters /
policies / indexes X", alphabetical tie-break, cycles reported. 0 cycles. Every
source file is present verbatim and every `create table / policy / function /
index` and `alter table` count matches the sources exactly. **Order is derived,
not executed** — no Postgres here — so a miss surfaces in the SQL editor as
`relation "x" does not exist`, and the manifest at the top says which file to move.

Two files are not valid UTF-8: `driver_registrations.sql` and
`driver_registrations_driver_deposit_balance.sql` each carry a lone `0xC2` byte
directly before `$10`. That is the orphaned lead byte of `£` (`C2 A3`) left
behind when `£10` was hand-edited to `$10`. It sits in a comment and a
`comment on column` string, so the schema is unaffected — but it is a byte-level
fingerprint of the cosmetic GBP→USD relabel already recorded as a finding
(the column is still `driver_deposit_balance_gbp`). Node's `'utf8'` read would
have turned it into U+FFFD and pasted that into the target database; the
generator now decodes strictly, drops the orphaned byte, and says so.

**For whoever is next:** the `android/` folder and `capacitor.config.json` are a
spike scaffold created 2026-08-30, not the source of the published apps. The
shipped Android and iOS apps were built elsewhere and their source is not in this
repository. Anything here must be re-applied to whatever
project actually produces the store builds.

The channel has never shipped to a real user, so its id did not need bumping when
the sound was fixed. If it had shipped, it would have: a channel is immutable and
an edit to a live one changes nothing on any handset that has already run the app.
