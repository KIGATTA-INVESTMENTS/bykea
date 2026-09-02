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

**Status:** complete for pieces 1-5 and 7, blocked on three client actions
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

## NOT verified — be honest about this list

- **Push delivery of any kind.** No `google-services.json`, app not registered in
  Firebase. Nothing about actual arrival has been demonstrated.
- **A token reaching `driver_push_tokens`.** Requires a driver sign-in, which is a
  write to the live database.
- **Backgrounded and killed delivery**, the two cases that matter most.
- **The tap path end-to-end.** The parking and routing code is exercised by no test
  and no device run.
- **The edge function edits** (TTL, collapse key, comments). Written, not deployed.
- **`visibility: 1` is not applied.** The channel reports
  `mLockscreenVisibility=-1000` (NO_OVERRIDE), so Capacitor appears to ignore the
  option. Harmless now; matters for piece 6.
- **The fallback poll on its own.** It is structurally independent of push
  (`DriverOffersProvider`, 2500 ms, guarded only on `driverId` and Supabase) and it
  re-runs on `visibilitychange`/`focus`. Not exercised on device with a real driver.
  **Honest limitation:** the poll only runs while the app is open. For a
  backgrounded app there is no fallback at all — that is what push is for, and
  what rule 2's missing foreground service would otherwise cover.

**For whoever is next:** the `android/` folder and `capacitor.config.json` are a
spike scaffold created 2026-08-30, not the source of the published apps. The
shipped Android and iOS apps were built elsewhere and their source is not in this
repository. Anything here must be re-applied to whatever
project actually produces the store builds.

The channel has never shipped to a real user, so its id did not need bumping when
the sound was fixed. If it had shipped, it would have: a channel is immutable and
an edit to a live one changes nothing on any handset that has already run the app.
