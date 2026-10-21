# WyBuild

WyBuild focuses on **Web → Android** builds for web apps and PWAs using a GitHub Actions **Capacitor + Android Gradle workflow** for buildable web source repositories, with the existing native-shell/Bubblewrap path retained for URL-only and non-buildable projects.

## Pricing: one-time AI credits (no recurring subscription)
- No monthly or yearly WyBuild subscription is required; new recurring checkout is disabled and automatic renewals are retired.
- Every account receives 10 one-time starter AI credits.
- Starter: 100 credits for $4.99 (display equivalent ₦7,500); Builder: 250 credits for $9.99 (₦15,000); Studio: 700 credits for $24.99 (₦37,500). NGN values are display equivalents; Flutterwave charges USD.
- Gemini Build Doctor meters provider token usage using the configured Gemini rates, with minimum operation charges of 2 credits for log diagnosis and 6 credits for a code-repair attempt. Higher measured costs can require additional credits.
- Each Web → Android build reserves 3 credits before dispatch. Successful builds keep the 3-credit charge; failed/cancelled builds refund it when the completed run is next reconciled. Dispatch failures are refunded immediately.
- Builds run in the connected user's GitHub Actions account. There is no monthly build quota; concurrency is limited to the account's configured concurrent-build limit.
- Existing subscriptions are marked non-renewing by the legacy cron endpoint; verify old customer billing status in Flutterwave before removing old credentials.

## AI Build Doctor
A failed pipeline shows a Gemini diagnosis button. WyBuild fetches the selected GitHub Actions run's logs server-side, redacts common secret formats, and asks Gemini for root-cause evidence and actionable suggestions. If a safe code repair is possible, **Apply AI Fix** can commit up to two existing text files to the failed build's branch; the user can then rebuild. It will not invent Firebase config, signing keys, credentials or GitHub permissions, and does not edit workflow files, lockfiles, secrets, `.env` files or `google-services.json`. Every completed AI request consumes wallet credits.

Set `GEMINI_API_KEY` in Vercel. `GEMINI_MODEL` determines the active Gemini model used for every diagnosis and repair request, and defaults to `gemini-2.5-flash` when omitted. Set `GEMINI_INPUT_USD_PER_MILLION` and `GEMINI_OUTPUT_USD_PER_MILLION` to the rates on your actual Google AI billing tier so credit metering follows your real model costs. Keep the API key server-side only.

## Storage: Firestore only
Set `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel (raw service-account JSON or base64-encoded JSON). WyBuild reads the Firebase project ID directly from `project_id` inside that JSON; no separate `FIREBASE_PROJECT_ID` is required. The server uses the Admin SDK and the `wb_kv` / `wb_set` collections. Firestore does not pause projects due to inactivity, although quotas, billing and limits still apply. In Firebase Console, enable Firestore TTL on the `expiresAt` field in `wb_kv` to clean up expired records automatically; the adapter also checks expiry on reads. The deployed app has no Supabase fallback. If migrating existing data, run `npm run migrate:supabase:firestore` from a trusted machine with the old Supabase URL/service-role key and `FIREBASE_SERVICE_ACCOUNT_JSON` configured; those legacy Supabase credentials are only for the one-time migration script and are not required at runtime. Test login/build/payment workflows after migration. Never commit or expose service credentials.

## Workflows
WyBuild installs one Web → Android workflow. It detects a buildable local web project and uses Capacitor + Android Gradle with a bundled native-plugin bridge; URL-only sites and explicit TWA configurations use the existing native-shell/Bubblewrap fallback. The former standalone Flutter build/export workflow is no longer supported. See `WYBUILD-CAPACITOR-NATIVE-FEATURES.md` for the native bridge API, Firebase login, FCM push, permissions and security setup.


### Capacitor source builds (workflow v34)

When a connected repository contains a `package.json` build script and produces a static `index.html` in `dist/`, `build/`, `www/`, `out/` or `public/`, WyBuild uses Capacitor and Gradle. The CI runner installs the Android plugins, bundles `window.WyBuildNative`, configures selected manifest permissions, applies the existing release signing key, and emits APK/AAB artifacts. Generated Android files and temporary npm dependency changes are not committed to the user's repository.

The native bridge includes camera/photo selection, geolocation, local and remote notification APIs, Firebase sign-in entry points, biometrics, filesystem operations, sharing, clipboard, haptics, device/network state, status bar, orientation, keyboard, browser, preferences and dialogs. Provider/server configuration is still required for authentication and remote push; see `WYBUILD-CAPACITOR-NATIVE-FEATURES.md`. A remote URL alone cannot acquire arbitrary Capacitor JavaScript APIs, so URL-only projects retain the existing native shell rather than being excluded.

## Free tools
JSON formatter, Base64 encoder/decoder, URL encoder, regex tester and text analyzer run entirely in the browser and do not consume WyBuild API/storage resources.

## Link handling (native features)
In **Web to Android → Link handling** every link rule is a domain (or `tel:`-style link type) set to one of:
- **Internal** – stays in the app. The domain becomes a trusted origin and a verified app link, so links to it open the app from anywhere on the phone. Publish the build's `assetlinks.json` on each internal domain.
- **External** – opens in the phone's browser.
- **Other** – handed to Android (dialer, mail, WhatsApp, Maps, UPI...).

Internal rules are baked into the APK/AAB manifest by `workflow/wybuild/twa-native.py`. External and Other rules are enforced by `wybuild-links.js`, generated into the build artifact (`dist/native/`) for the site to include, because a Trusted Web Activity cannot intercept those taps natively. Links on the app's own site always stay internal; the first matching rule wins. Changing rules needs the TWA workflow v13 or newer (WyBuild offers the update automatically).

### App shell (workflow v15)

- **Standalone app** (default): `workflow/wybuild/WyBuildActivity.java` is injected as the launcher activity. The site runs in the app's own WebView, so no address bar or Chrome toolbar can appear and no `assetlinks.json` is required. Fullscreen hides the status and navigation bars, link rules (internal / external / other) are enforced natively, and uploads, downloads, camera/microphone/location prompts, JS dialogs, fullscreen video, an offline screen, the back button and local notifications (`WyBuildNative.notify`) are handled in the app.
- **Trusted Web Activity**: the previous behaviour. Needs `assetlinks.json` to hide Chrome's address bar; required for Web Push delegation and Play Billing.

## PWA
WyBuild itself is installable: `public/manifest.webmanifest`, icons (192, 512, maskable 512, monochrome 512, Apple touch 180), `public/sw.js` and `public/offline.html`. The service worker is network-first for pages (a new deploy is never hidden behind a stale cache), cache-first only for content-hashed `/assets/*`, and never touches `/api/*`. Bump `VERSION` in `sw.js` to drop all caches. `vercel.json` serves `sw.js` uncached and the manifest with the right content type.

## Automatic PWA discovery

Web → Android now performs a two-source PWA discovery pass:

1. **Live site is authoritative** when the repository has a published HTTPS address. WyBuild reads the Web App Manifest, stable app ID, name/short name, start URL, scope, display mode, orientation, primary/maskable/monochrome icons, service worker and existing Digital Asset Links.
2. **Repository metadata is the fallback** when the live site is missing a value. WyBuild checks common manifest locations plus conventional service-worker files and uses the repository data only to fill blanks.
3. WyBuild reports **PWA READY** only when the manifest, usable identity, start URL/scope and install icon are present. A missing service worker is reported separately instead of being incorrectly treated as a manifest failure.
4. The generated package ID is still a free Android identity derived from the HTTPS hostname unless the developer supplies one.

### WyBuild's own PWA/TWA readiness

WyBuild ships its own manifest, install icons, service worker and offline page. It also exposes a guarded `/.well-known/assetlinks.json` endpoint. To make the deployed WyBuild site a verified TWA, configure the exact production Android signing identity in Vercel:

- `WYBUILD_ANDROID_PACKAGE_ID`
- `WYBUILD_ANDROID_SHA256`
- optional `WYBUILD_PLAY_SIGNING_SHA256`

The endpoint returns HTTP 503 until a real package ID and valid SHA-256 certificate fingerprint are configured; WyBuild never generates a placeholder fingerprint.

The Capacitor workflow installs the Firebase JavaScript SDK required by the Firebase Authentication and Messaging bridge modules (workflow v34).

## Credit pricing (v6)

- Each successful Web-to-Android APK/AAB build costs **5 credits**. Credits are reserved before dispatch and refunded if dispatch fails or the build fails.
- Package ID edits cost **2 credits**; version-name edits cost **2 credits**. These are charged when an existing saved project field is changed and blurred, not on every keystroke.
- Paid native capabilities and gestures show a credit side-label in the UI. Costs are enforced by the server-side `POST /api/credits/action` endpoint; the browser cannot choose its own price. Duplicate operation IDs are idempotent.
- One-time credit packs continue to be paid through server-verified Flutterwave v4. Never trust a client-side balance or a payment redirect alone.

## Build completion notifications

The Capacitor bridge includes native notification permission, token registration, receipt, and tap hooks. A root `google-services.json` is the **Android client configuration** used by the Android build; it is not a server credential and by itself does not enable remote build-completion delivery. To send notifications while WyBuild is closed, the deployment must also register each signed-in user's FCM device token with the backend and send an FCM message when the GitHub Actions run completes. Configure a Firebase service-account credential as a protected server environment variable (for example `FIREBASE_SERVICE_ACCOUNT_JSON`) or through the deployment's secret-file mechanism—never commit a service-account JSON file to the repository. The notification payload should include the repository and run ID; tapping it should deep-link to the build detail screen, where the user can open logs or artifacts. TWA mode cannot use the Capacitor native push plugin and needs a separately configured Web Push subscription/service worker.

**Deployment note:** the project contains native client hooks, but remote build-completion push delivery still requires the server token-registration/send path and a GitHub Actions completion callback to be configured and verified in the target deployment. Do not treat `google-services.json` alone as proof that this works.

## Build-completion push notifications

The Vercel API now supports Firebase Cloud Messaging build notifications for authenticated Capacitor Android installs.

1. Keep `FIREBASE_SERVICE_ACCOUNT_JSON` configured in Vercel (raw JSON or base64 JSON). This is server-only; never put the service-account key in the APK or frontend.
2. Add `WYBUILD_PUSH_WEBHOOK_SECRET` in Vercel. Use a random secret of at least 32 characters.
3. In GitHub, configure a repository webhook pointing to `https://wybuild-black.vercel.app/api/build-notify-webhook`, content type `application/json`, the exact same secret, and subscribe to **Workflow runs**. The endpoint verifies `X-Hub-Signature-256`, ignores non-WyBuild workflows, and deduplicates retried completion events.
4. Build the Capacitor APK/AAB with the correct `google-services.json` at the source repository root and the Firebase Android app registered for the exact package ID. Enable Firebase Cloud Messaging in the Firebase project.
5. Install the new build, sign into WyBuild, and grant Android notification permission. The app registers its FCM token to the signed-in WyBuild account. Opening Build History associates the repositories with that account for notification delivery.

Successful notifications open the matching build and scroll to artifacts; failed notifications open the matching build and scroll to logs. Users must be signed in to view private build data. GitHub workflow webhooks are configured per repository; use the same webhook secret consistently. Do not use the Firebase service-account key as the GitHub webhook secret.

**TWA limitation:** this FCM token registration path is for Capacitor/native Android. Pure Trusted Web Activity push requires browser Web Push subscriptions and VAPID public/private keys; the Firebase service account alone does not provide those. The webhook currently includes a Web Push link payload, but TWA Web Push subscription delivery is not configured by this code alone.
