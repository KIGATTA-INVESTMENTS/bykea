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

**Status:** **complete.** Pieces 1-5 and 7 built; Part 2 proven end to end on a throwaway Supabase project on 2026-09-03 (sign-in → token row → deployed sender `sent:1` → backgrounded notification → tap → router hop; then a fresh customer order rang the backgrounded phone). Not built: piece 6, foreground service, iOS.
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

**First run against a real database (a throwaway Supabase project, 2026-09-02)
failed at `relation "public.delivery_requests" does not exist`.** Cause:
`package_category_free_text.sql` does `comment on column public.delivery_requests…`
and none of the dependency patterns covered `comment on`. Fixed twice over: the
specific pattern (plus `grant`, `trigger`, `view`, `truncate`), and a backstop
that treats *any* bare mention of a created table as a dependency, so the next
unforeseen statement type cannot slip a file above its table. Over-linking only
adds edges; the sort reports the one thing it cannot absorb, a cycle — still 0.
Postgres ran the failed paste as one implicit transaction, so nothing was
committed; the corrected bundle re-runs cleanly on the same empty project.

**Second real run failed at `column "assigned_driver_id" does not exist`.**
A column, not a table: `driver_booking_assigned_at.sql` backfills
`where assigned_driver_id is not null` on `customer_delivery_orders`, and that
column is *added* by `driver_booking_assignment.sql`, which sorted one place later.
Table-level tracking cannot see it. Adding column-level tracking took four
attempts, and the failures are the useful part:

1. "file mentions table T and column C" → **63 files in cycles.** This repo re-adds
   columns defensively (`add column if not exists`) that the table's creator already
   declared inline, so creator and adder pointed at each other. Fix: files that
   *provide* a column (adders, plus the creator if it declares it) never depend on
   each other; only *users* depend on providers.
2. Still 20 in a cycle. Hypothesis: mentions inside `$$…$$` plpgsql bodies are
   resolved at call time, not apply time. True, and worth excluding — but it
   changed nothing, because it was not the cause.
3. Scoped the test to "same statement names T and C". Still 20. Not the cause.
4. Printed the actual loop instead of theorising: exactly one false edge,
   `customer_delivery_orders.sql → driver_vehicle_types_motorbike_tuktuk_car.sql`.
   The creator's `create table` declares its own `requested_vehicle_type` **and**
   contains `references delivery_requests` — one statement naming both — so it
   looked like a user of `delivery_requests.requested_vehicle_type`. **The
   statement must *target* T** (`update T`, `alter table T`, `comment on column
   T.x`, index `on T`…); a mere FK mention is not a use. 0 cycles.

Lesson recorded for next time: two wrong hypotheses in a row is the signal to
print the graph, not to form a third.

Two files are not valid UTF-8: `driver_registrations.sql` and
`driver_registrations_driver_deposit_balance.sql` each carry a lone `0xC2` byte
directly before `$10`. That is the orphaned lead byte of `£` (`C2 A3`) left
behind when `£10` was hand-edited to `$10`. It sits in a comment and a
`comment on column` string, so the schema is unaffected — but it is a byte-level
fingerprint of the cosmetic GBP→USD relabel already recorded as a finding
(the column is still `driver_deposit_balance_gbp`). Node's `'utf8'` read would
have turned it into U+FFFD and pasted that into the target database; the
generator now decodes strictly, drops the orphaned byte, and says so.

## Part 2 on a throwaway Supabase project — 2026-09-03

Project `gcwrnluyaqarmrovbryj` (ours, not the client's), schema from the bundle,
new-format API keys. `.env.local` points the local build at it; verified the ref is
baked into both the web bundle and the APK.

**Customer half proven end to end, in a headless desktop browser (Edge, CDP),
with no emulator:** register → `/home` → delivery request (addresses accepted
despite the "Location is off" banner from the missing Maps key) → package details
→ price estimate ($3.72 / $4.25) → **Pay with Cash → Place Order** → `/live-tracking`
"Finding a driver for you…". Row in `customer_delivery_orders`:
`29b95e10-98d9-4dd9-9b03-73abd00fb5a8`, `status=placed`, `payment_method=cod`,
`total_amount=4.25`, `assigned_driver_id=null`. Registration is a plain insert —
no edge function needed. Cash was chosen deliberately: Paynow points at the
client's **production** Railway API even in local builds, so it must not be used
for tests.

**The push sender on that project returns 404** — not deployed yet, expected.
Placing the order still called it (fire-and-forget, caught), which is exactly the
hop the deploy will close.

**A deploy blocker found before deploying:** the app invokes `driver-offer-push`
with the public API key and no user session. The legacy `anon` key is a JWT and
passed the gateway's default `verify_jwt`; **new-format `sb_publishable_` keys are
not JWTs**, so every call would be 401'd before the function runs. Added
`supabase/config.toml` (`verify_jwt = false` for this function) and
`scripts/deploy-push-sender.sh` (deploy `--no-verify-jwt` + secrets, using a
`SUPABASE_ACCESS_TOKEN` so no browser login). If the client ever moves production
to new-format keys, every browser-invoked function needs the same — and that is
the wrong long-term answer, because the functions authenticate nothing themselves.

**Sender deployed to the throwaway project and proven — 2026-09-03.**
`scripts/deploy-push-sender.sh gcwrnluyaqarmrovbryj` with a Supabase access
token. Two things a first deploy to a fresh project exposed:

1. **`BOOT_ERROR` / 503 "Function failed to start"** with the original imports
   (`deno.land/std@0.224.0` http + encoding, `esm.sh/@supabase/supabase-js`).
   Switched to the runtime's native specifiers — `Deno.serve`,
   `npm:@supabase/supabase-js@2.49.8`, `jsr:@std/encoding@1/base64url` — and it
   boots. The log API for the new project returned "Backend error" throughout,
   so this was diagnosed by elimination, then confirmed by the next error being
   a *different*, specific one.
2. **`FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON`**: the downloaded key
   file is pretty-printed over many lines; `secrets set NAME=VALUE` keeps one
   line, so the stored secret was `{`. The helper now compacts the JSON to one
   line first (the `\n` escapes inside `private_key` survive; the function
   un-escapes them).

Smoke test against the real test order `29b95e10…`:
`{"ok":true,"sent":0,"reason":"no_online_drivers"}` — HTTP 200. The sender
authenticates with Firebase, reads the order, looks for online drivers, finds
none (correct: nobody has signed in), and **says so**. Blueprint rule 3, on the
real server path. The `verify_jwt=false` deploy is confirmed too: the call got
past the gateway with the `sb_publishable_` key.

**Chain status:** customer → order → sender: proven. Sender → driver phone: waits
on the driver sign-in below, which is the emulator.

## Part 2 complete — the whole chain, every link real — 2026-09-03

Emulator back (network restored by the other session), every adb call pinned
`-s emulator-5554`.

1. **Driver sign-in from inside the page** (`testdriver@bykea.test`) → `/driver/home`
   → `[driverPushBootstrap] push token stored {"platform":"android"}` → **a real
   row in `driver_push_tokens`** on the throwaway project, driver `12d82ffc…`.
   The table that had been empty for the life of this product.
2. **Sender → this driver, via the deployed function**, on the real test order:
   `{"ok":true,"sent":1,"drivers":1,"tokens":1,"kind":"parcel"}`.
   - foreground: `[driverPush] payload received {"type":"offer_ring",…}`
   - backgrounded: notification "New delivery request / Harare CBD · → Avondale ·
     $4.25" posted; **0 app-code lines** (OS-rendered, as ADR 0001 says)
   - **tap:** `[driverPush] offer tapped` → **`[DriverOffers] routing to tapped
     offer /driver/home`** — the router hop, the last unexercised piece, now proven.
     The provider mounted because `DriverApprovalGate` found a real approved driver.
3. **Fresh order from the customer side, in the headless browser** (`#ING-B1F73DB303`,
   Harare CBD → Borrowdale, cash) → the app invoked the sender → the **backgrounded
   driver phone** showed "New delivery request / Harare CBD · → Borrowdale · $4.25",
   0 app-code lines. Nothing in the chain touched the client's production.

**What "online" means to the sender, and what blocked it first:** `is_online = true`
AND `driver_live_updated_at` within 5 minutes AND (if the order has pickup
coordinates) within 20 km. The app set `is_online` on sign-in, but published **no
location** even with an emulator GPS fix, because this build's manifest declared
no location permission — the "Retry location" button did nothing (observed
independently on the device at the same time). The order rows carry only `pickup_location` text, no lat/lng,
so the radius filter is skipped by design. For the test I set
`driver_live_lat/lng/updated_at` on the throwaway row directly; the manifest now
declares `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` so the app publishes
it itself — **verified:** after the rebuild, `getCurrentPosition success` where it
had logged `error`, and after moving the emulator's GPS fix the row updated to
`-17.8299727, 31.0529739` (the new fix, with GPS noise — not the hand-written
values) within seconds. The app now satisfies the sender's "online" predicate
unaided.

## Screen off, lock screen, killed — with the real sender, 2026-09-03

All via the deployed `driver-offer-push` on the throwaway project, driver
location refreshed before each ring (see limitation below).

| Case | Result |
|---|---|
| **Screen off** (`KEYCODE_SLEEP`, `mWakefulness=Asleep`) | `sent:1`, posted, **0 app code**. The screen **stayed asleep** — Android does not light the display for an ordinary notification; that is piece 6 |
| **PIN-locked lock screen** (`locksettings set-pin`) | Notification shown **on the keyguard** with full text ("New delivery request · Harare CBD → Borrowdale · $4.25" — fine: no customer identity in the payload). **Tap → PIN prompt → PIN → app to front → `[driverPush] offer tapped` → `[DriverOffers] routing to tapped offer`.** Screenshot at +3 s shows the app's white startup gap (H7), i.e. the app, mid-paint |
| **Killed** (process dead, `stopped=false`) | `sent:1`, posted, **FCM spawned a fresh process** (new pid), 0 app code |

Three things learned on the way:

- **The first test order was auto-cancelled** by the app's stale-offer sweep (30 min),
  and the sender then answered `{"skipped":"status","sent":0}` — correct: an
  offer is TTL'd to its order's window. Rang the newer order instead.
- **`am kill` refuses a process that was foregrounded seconds earlier** (pid
  unchanged) — that run was another backgrounded delivery, not a killed one.
  Waiting 15 s or `run-as <pkg> kill -9` gets a truly dead process without the
  stopped state that `force-stop` sets (which would drop FCM entirely).
- **Chrome opened once after the lock-screen tap-through.** The system log shows
  the app launch `from uid 10213` (the app) and a `VIEW https://www.google.com/…`
  `from uid 10145` = `com.android.chrome`: my typed PIN digits reached the
  launcher's search bar and ENTER submitted a search. Harness artefact, not the app.

**Product limitation made concrete:** the sender counts a driver as online only
with a location updated in the last 5 minutes, and a backgrounded WebView stops
`watchPosition`. So **a driver who backgrounds the app drops out of dispatch
after ~5 minutes** unless something keeps publishing — the foreground service in
blueprint rule 2. For these tests the timestamp was refreshed by hand. This is
the strongest argument yet for building that service.

## Accept / Decline — where they are, and what blocked them — 2026-09-03

**The buttons exist, in-app, after the tap.** `DriverHomePage` renders an offer
card (`dh-offerCard`) for each open offer under 30 minutes old: pickup, drop-off,
package, payment, the customer's offer, a **"Respond in 120s"** bar, and three
buttons — **"Offer $4.25"** (accept at the customer's price), **"Bid higher"**,
**"Reject"**. Verified on screen for order `#ING-AE9F7EAC36`. There are **no
buttons on the system notification itself** — that is blueprint piece 6, scoped
out of this pass.

Three findings on the way to that screenshot:

1. **The sender rings by order *status*; the app shows by order *age*.** The
   earlier test order (placed 23:48) was still `placed/open` at 12:00 the next
   day, so the sender rang it, but `OPEN_OFFER_MAX_AGE_MS` (30 min) hides it in
   the app — tap → home → "0 Open Offers". A driver can be rung for something
   they cannot accept. The sender should apply the same age cutoff (or the sweep
   that cancelled the first order should run server-side, not only in a client).
2. **Pressing Accept hung on "…" forever — the Supabase auth lock.** Logcat, 8×:
   `@supabase/gotrue-js: Lock "lock:sb-<ref>-auth-token" was not released within
   5000ms … Forcefully acquiring the lock`. `createClient(url, key)` with default
   options runs GoTrue's session machinery, which wraps requests in a
   `navigator.locks` lock; inside the Capacitor WebView it contends and stalls
   every call ~5 s. The accept path makes several calls in a row. **This app has
   zero `supabase.auth` usages**, so the fix is to turn the unused auth client
   off: `auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }`.
3. **`claim_open_booking` looked missing (`PGRST202`) and was not.** PostgREST
   resolves RPCs by parameter *names*; a `{}` probe matches nothing and says "not
   found". With `p_table/p_booking_id/p_driver_id` it answered
   `{"ok":false,"error":"Driver not found."}` — present and behaving. Probe RPCs
   with their real argument names or the answer is meaningless.

**The accept landed (piece 7).** Order `ae9f7eac…`: `status=assigned`,
`bid_status=matched`, `assigned_driver_id=12d82ffc…`, `assigned_at 12:04:15Z`,
`agreed_fare_amount=4.50`, `delivery_confirmation_code=864460`. Customer's
`/live-tracking`: "DRIVER TO PICKUP · Driver is heading to the pickup location ·
YOUR DELIVERY PIN 864460". Driver's Orders tab: "ING-AE9F7EAC · ASSIGNED · Payout
$4.50 · Continue Delivery". The stop signal withdrew the notification (0 posted
for that order). **Caveat:** the assignment came from the press on the *pre-fix*
build — the stalled request completed once the lock forcibly recovered. The fixed
build (auth client off) logs **0** lock warnings where the old one logged 8, but
its own accept was not exercised: the driver now holds an active job and
`driver_single_assignment` correctly declines to offer a second. Exercising it
needs the job completed or cancelled first.

Also: an Android **"Process system isn't responding"** dialog appeared on the
emulator mid-test — `system_server`, not the app, from my `dumpsys`/uiautomator
polling every few seconds on top of lock/unlock cycles. Harness load, throttled.

**Driver half not run yet.** ~~The emulator had no network when I tried~~ (superseded
above; kept for the record) The emulator had no network when I tried (every
fetch failed, including google.com) and was then declared in use by another
session running a second device on `emulator-5556`; their stray taps explain the
offline state and the home-screen surprise earlier. **All device commands must be
pinned `adb -s emulator-5554` from now on.** Resume: enable wifi/data → fill the
driver login from inside the page (not `adb input text` + Back, which left the app)
→ token row → offer → tap → the router hop.

**For whoever is next:** the `android/` folder and `capacitor.config.json` are a
spike scaffold created 2026-08-30, not the source of the published apps. The
shipped Android and iOS apps were built elsewhere and their source is not in this
repository. Anything here must be re-applied to whatever
project actually produces the store builds.

The channel has never shipped to a real user, so its id did not need bumping when
the sound was fixed. If it had shipped, it would have: a channel is immutable and
an edit to a live one changes nothing on any handset that has already run the app.
