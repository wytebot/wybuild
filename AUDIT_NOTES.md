# WyBuild v18 audit notes

## Native feature verification

| Feature | Verified implementation | Audit result |
|---|---|---|
| Notifications | TWA uses Bubblewrap notification delegation; standalone shell exposes `window.WyBuildNative.notify()` and requests Android 13+ `POST_NOTIFICATIONS` at runtime. | Implemented. |
| Location | TWA location delegation is emitted through Bubblewrap features; standalone WebView handles geolocation prompts and requests fine/coarse Android permissions only when enabled. | Implemented. |
| Camera | Manifest permission + optional camera hardware declarations; standalone WebView maps video-capture permission requests to Android CAMERA runtime permission. | Implemented. |
| Microphone | Manifest permission + optional microphone hardware declaration; standalone WebView maps audio-capture requests to Android RECORD_AUDIO runtime permission. | Implemented. |
| Vibration | Android VIBRATE permission is now declared only when the developer selects Vibration. Standalone bridge checks the permission before vibrating. | Fixed toggle leak. |
| Fullscreen / sticky fullscreen | TWA emits trusted-display metadata; standalone shell applies immersive/sticky system-bar behavior itself. | Implemented. |
| Orientation | Passed into the Bubblewrap manifest and generated Android project. | Implemented. |
| Link handling / deep links | Rules are validated, emitted to Android intent filters for internal HTTPS domains, and enforced at runtime in the standalone shell. | Implemented. |
| File uploads | Standalone WebChromeClient file chooser forwards site file-input requests to Android's document picker. | Implemented. |
| Downloads | Standalone shell uses Android DownloadManager, preserving cookies and user agent. | Implemented. |
| Predictive back | Android 13+ application callback flag is emitted when selected; standalone shell has platform back callback handling. | Implemented. |
| TWA trust / address-bar removal | Build emits `assetlinks.json`, checks live Digital Asset Links for TWA shell, and includes optional Play signing fingerprint. | Implemented; website publishing is still required for true TWA verification. |

## Billing changes

- Pro activation remains server-owned: the browser cannot grant Pro by itself.
- Successful charge reconciliation checks status, unique reference, amount, currency and customer ID where available.
- Added a server-confirmed Payment successful modal. It appears only after `/api/me` confirms Pro.
- Active billing state now displays `You are now in Pro` with a Cancel subscription button.
- Cancellation disables renewal immediately but preserves Pro for exactly five days; after the server grace expires, `/api/me` returns Free and the billing card returns automatically.
- Failed renewal grace is five days and no longer extends forever on each retry.
- Renewal transactions are recorded for webhook/status reconciliation.
- Webhook signature verification prefers a raw request body when the runtime exposes it and keeps compatibility fallback behavior.

## v23 build-ticket gate (TWA workflow v21)
- Every dispatch from /api/twa-build carries a one-time `wb_ticket` input (kv `wb:ticket:<sha256>`, 3h TTL, bound to repo).
- The workflow's first step POSTs it to `/api/build/authorize` (URL baked into the workflow at install time via `__WYBUILD_APP_URL__`). Missing/used/expired ticket, re-run (attempt > 1) or wrong repo => 403 and the run fails before any build step.
- Runs refused this way are marked `wb:rejected:<repo>:<runId>` so refundIfNeeded never decrements a pending/in-flight slot for them.
- Limit: the workflow file lives in the user's repo, so someone who edits it can delete the step. This stops the Run-workflow button and re-runs, not a determined fork. Stronger option: serve the signing key only from /authorize instead of copying it into repo secrets.

- v26: removed the "Pro automation" teasers (Sidebar, dashboard tile renamed "Pro plan") and the unused mock GitHubWebhooksSection.tsx.

## v27 native bridge upgrade (TWA workflow v23; bump the number whenever workflow files change or repos will not be updated)
- Standalone shell now ships a `window.WyBuildNative` bridge with 13 always-on, permission-free features (clipboard, haptics, device/network info + events, lifecycle events, keep-awake, orientation lock, secure screen, save file to Downloads, speech recognition + TTS, one-shot contact picker, add-to-calendar, launcher shortcuts, rate/app settings) and 3 opt-in features that touch the manifest (biometric unlock = USE_BIOMETRIC, share target = SEND intent filter, local reminders = POST_NOTIFICATIONS + receiver).
- New bridge methods answer only pages served from the app's own hosts (own + additionalTrustedOrigins/internal link hosts), never sign-in pages. Existing methods (notify/share/vibrate/openExternal) are unchanged.
- Every build artifact now includes `native/wybuild-native.js` (promise API with web fallbacks) and policy guidance in NATIVE-FEATURES.md.
- Files: WyBuildActivity.java, WyBuildReminderReceiver.java (new; referenced by class NAME only, so the activity compiles even if the file is absent; manifest-registered only with Reminders), twa-native.py, twa-prepare.mjs, api/index.js (nativeFeatures allowlist, version 21->22), wybuild-twa.yml, TwaView.tsx, types.
- Verified: Java structure/syntax (javac without Android SDK: no syntax errors), Python patcher run against a mock Bubblewrap manifest, JS kit and api syntax. NOT verified: a full Gradle build, on-device behaviour.


## v28 pipeline history, logs, artifacts and release safety

- Run details no longer fail as one unit when GitHub's jobs or artifacts endpoint temporarily fails. The run summary, available pipeline stages, logs and artifacts load independently, with non-fatal issues shown in the Build screen.
- Pipeline rendering now includes steps from every job in a workflow, not only the first job. Job logs are fetched independently and skipped/cancelled steps are not incorrectly marked as failures.
- Build history requests up to 100 recent runs per repository rather than silently limiting history to 15. TWA runs are identified from the authoritative workflow endpoint, not only the commit title GitHub happens to show.
- Release preparation now validates the artifact response and normalizes missing fields before rendering. Incomplete GitHub responses display actionable errors instead of triggering `Cannot read properties...` rendering crashes. The release flow still requires server-side artifact validation before any APK/AAB can be published.


## v29 audit pass (Capacitor workflow v26)

- Fixed a fatal path-resolution error in the Capacitor setup step: generated metadata was being loaded from `../.wybuild-out` while the step was still at the repository root.
- Capacitor plugins are now declared in the ephemeral checkout's `package.json` before `npm install`/`cap sync`, so native plugin registration is not dependent on `--no-save` discovery behaviour.
- A source `npm run build` failure now fails clearly rather than silently packaging the live URL instead of the source app.
- Release signing now resolves the keystore from the Android root project (rather than the app module directory), and Java properties escape special characters in passwords/aliases.
- Firebase setup adds the Google Services Gradle plugin in either plugin-DSL or buildscript-style templates, validates `google-services.json` package IDs, and fails with an actionable message when Firebase sign-in/push is selected without config.
- Engine-specific native selections are guarded: Firebase sign-in/push require Capacitor source builds; share-target receiving is URL-shell-only; TWA builds reject native bridge features instead of silently ignoring them.
- Workflow version is now 26 so existing installed workflows refresh their copies of the updated workflow/helpers.
- Navigation now includes the Projects, Releases, Errors and Team views, which existed in the app but were not all reachable from the sidebar/search. Legacy project cards defensively handle missing `dartDefines`.
- Static checks passed: all 31 TS/TSX files transpile without syntax diagnostics; API/bridge/helper JavaScript syntax checks pass; all 13 workflow shell blocks pass `bash -n`; Python helper syntax passes; mock finalizer tests pass for permissions, versioning/signing, Firebase Gradle wiring and missing Firebase configuration.
- Not run in this audit environment: full `npm run build`, GitHub Actions execution, Gradle `assembleRelease`/`bundleRelease`, real Firebase sign-in/push, or physical-device tests. These require installed dependencies, the Android SDK/runner, Firebase credentials/configuration and device/runtime validation.


## Fix v28 — Java toolchain

The workflow now provisions Temurin Java 21 for the Capacitor/Gradle build. The previous workflow used Java 17 while Capacitor Android requested Java source release 21, causing `invalid source release: 21` at `:capacitor-android:compileReleaseJavaWithJavac`. Both workflow copies and the server-side workflow version marker are updated to v28.


## Fix v30 — prevent incomplete Capacitor web payloads

- Fixed a GitHub Actions environment-scope bug: `GITHUB_ENV` values are not available until a later step, so `WYBUILD_WEB_DIR` is now also exported in the current step before the native bridge is bundled and `capacitor.config.json` is generated.
- Added explicit checks that the built `index.html`, injected native bridge, and copied Android `assets/public` files exist before Gradle packages the APK. This should fail with a useful build error instead of allowing an incomplete local web payload to become an APK.
- Bumped both workflow copies and the server-side workflow marker to v30.
- Static checks performed on this patch: workflow copies and version markers agree; shell blocks are checked separately where possible; ZIP integrity verified. A full Android/Gradle build and on-device launch were not performed in this environment.

## v31 — webhook and payment reliability pass (2026-10-18)

- Webhook reconciliation errors now return HTTP 500 consistently, including network failures and downstream WyCut persistence failures, so Flutterwave can retry rather than receiving a false success acknowledgement.
- WyCut confirmation URLs are required to use HTTPS.
- Reference-only WyCut webhook events use a shared-secret-authenticated, read-only lookup on WyCut to obtain the stored provider charge ID; WyBuild still retrieves and verifies that charge directly from Flutterwave v4 before forwarding settlement. Verified terminal failures update WyCut orders to rejected without granting credits.
- Idempotency keys are stable for the same logical write. WyCut checkout references are used for payment-method/charge keys, and WyBuild payment-method keys include the unique checkout reference. Authorization attempts use unique attempt keys so a previous incorrect OTP response is not replayed for a new code.
- Static syntax and source audits are not a substitute for the Vercel production build or a live Flutterwave sandbox run. Verify webhook signature/raw-body behavior, v4 payloads, and duplicate/failed payment cases before live billing.
