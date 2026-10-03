# WyBuild

Cloud Android builds on GitHub Actions, for two kinds of project:

1. **Flutter** repos: signed APK / AAB builds.
2. **Web apps (TWA)**: wrap any HTTPS site or PWA as an Android *Trusted Web Activity* with Google's
   [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) CLI, and get a store-ready, correctly signed APK/AAB.

**How it works:** sign in with GitHub, add a project (pick a repo), and WyBuild commits its workflow to it
(after you confirm), dispatches it with your build settings, then shows live status, step logs and artifacts from the
GitHub API. Builds run on the repository owner's GitHub Actions minutes. Signing keystores are stored in the repo as
encrypted Actions secrets (`WB_KEYSTORE_BASE64`, `WB_KEYSTORE_PASSWORD`, `WB_KEY_ALIAS`, `WB_KEY_PASSWORD`).

## Setup
1. Create a GitHub OAuth App. Callback URL: `{APP_URL}/api/auth/callback`. The OAuth state is signed with `SESSION_SECRET`, so sign-in no longer depends on a state cookie surviving the GitHub redirect.
2. Create a Vercel KV / Upstash Redis store and link it to the project (provides `KV_REST_API_*`).
3. Flutterwave v4: create the v4 Client ID, Client Secret and Encryption Key, set a webhook secret hash, and point the webhook at `{APP_URL}/api/billing/webhook`. v4 authenticates server calls with OAuth2 access tokens; the server refreshes them automatically.
4. Set the env vars in `.env.example` on Vercel (or in `.env.local` for `vercel dev`). Keep `FLW_CLIENT_SECRET` and `FLW_ENCRYPTION_KEY` server-side. The encryption key is returned only to an authenticated WyBuild session so card fields can be encrypted in the browser before submission.
5. Deploy to Vercel (Production env vars must be set before the first deploy; changing them later needs a redeploy). The billing renewal job runs daily through the Vercel Cron entry in `vercel.json`. Set `CRON_SECRET` so only the cron job can invoke `/api/billing/renew`.
6. For local development run `vercel dev` (the `/api` routes need the Vercel runtime; `npm run dev` serves only the UI).

## Web app to Android (TWA)

Open **Web → Android (TWA)** in the sidebar.

1. **Inspect & auto-fill.** The server fetches your site (HTTPS only, public hosts only), reads its Web App Manifest and fills
   name, colours, icons, start URL, display mode, orientation and a package id suggestion. It also reports whether
   `/.well-known/assetlinks.json` already exists.
2. **Automatic vs manual.** Anything left blank is detected again inside the workflow. Manual control, in increasing power:
   - the form (permissions, shortcuts, trusted origins, notification / location delegation, fallback type, min SDK);
   - `wybuild/twa.json` in your repo: any form field, applied last, wins over the form;
   - `wybuild/android-overrides/`: files copied over the generated Android project (`res/`, `AndroidManifest.xml`, `build.gradle`, ProGuard rules);
   - `wybuild/twa-patch.sh`: a shell hook that runs inside the generated project before the build.
3. **Build.** The workflow `.github/workflows/wybuild-twa.yml` (helper scripts in `.github/wybuild/`):
   installs the Bubblewrap CLI and a JDK/Android SDK config non-interactively, generates the Android project with
   `@bubblewrap/core` (so nothing prompts), builds and signs with `bubblewrap build` (falling back to Gradle + `apksigner`
   if that fails), then writes to the artifact:
   - `<package>_<versionName>_<versionCode>.apk` / `.aab`
   - `assetlinks.json` with your signing certificate's SHA-256 (publish at `https://<site>/.well-known/assetlinks.json`)
   - `store-readiness.json` / `.md`, `twa-manifest.json`, `twa-config.json`
4. **Verify.** After a build, the Builds screen shows the fingerprint and a *Check live site* button that confirms the
   site authorises the app. Without matching Digital Asset Links the app shows a browser address bar.

### Store-ready mode (APKMirror, Uptodown)
These sites host APK files and review each upload by hand. They accept apps signed consistently with the developer's
own key and may decline new or little-known apps; **no tool can guarantee acceptance**. Store-ready mode (on by default) fails the
build unless the APK:
- is signed with your release keystore (never the debug certificate or a throw-away key) using APK Signature Scheme v2/v3;
- is zip-aligned, not debuggable, not `testOnly`, with a launcher icon and label;
- uses a real package id (not `com.example.*`, `com.android.*`, `com.google.*`);
- matches your *expected signing fingerprint*, if set (the key must never change between releases).

`versionCode` defaults to the CI run number, so it always increases; set it manually only if you need to. The report additionally warns when `targetSdk` is low or Digital Asset Links are not live yet.

Keep your keystore safe and reuse it for every release of the same package: a different key makes Android and the
mirrors treat the next version as a different app.

## Signing (Flutter)
The Flutter workflow writes `android/key.properties` (standard Flutter format). Your `android/app/build.gradle(.kts)` must read it
for release signing, as described in the Flutter docs ("Sign the app").

## Limits (server-enforced)
Free: 5 successful builds/month, 1 concurrent. Pro ($10/mo or $100/yr): no monthly successful-build cap, 5 concurrent, with server-enforced 60-minute workflow timeout.
Flutter and TWA builds share the same quota. Only successful runs consume the 5-build monthly allowance; failed or cancelled runs do not count.

## Upgrading from FlutterForge
- Workflow file is now `wybuild.yml` (Flutter) and `wybuild-twa.yml`; reinstall it from the UI on each repo. Old `flutterforge.yml` runs are no longer listed.
- Signing secrets were renamed `FF_*` to `WB_*`; re-upload keystores once. Paid subscriptions stored under the old KV prefix are still honoured.
- Browser-local data (projects list) uses new storage keys, so saved projects must be re-added once.

## Cancelling Pro
`POST /api/billing/cancel` stops auto-renewal (removes the user from the renewal list). Pro stays active until the already-paid period ends.

## Not backed by a server yet
Team members, audit log, error-telemetry seed data and the Webhooks settings panel are still local browser state.


## Billing and Pro entitlement

WyBuild Pro is activated only after the server retrieves the Flutterwave v4 charge and confirms the expected reference, amount, currency and `succeeded` status. A browser success page, redirect, or webhook payload alone cannot grant Pro.

The initial card flow is:

1. Authenticated user selects monthly ($10) or yearly ($100).
2. The browser obtains the v4 encryption key and encrypts card number, expiry and CVV with AES-256-GCM before sending them.
3. The backend creates the Flutterwave customer/payment method and a unique charge reference.
4. If Flutterwave requires PIN or OTP, the browser submits the authorization data; PIN is encrypted before transmission.
5. If Flutterwave returns a 3DS/redirect action, the browser follows the supplied redirect and the callback reconciles the charge.
6. Webhooks and the authenticated status endpoint both reconcile the charge server-side.
7. Only a verified successful charge activates the Pro subscription.
8. The server stores the tokenized customer/payment-method IDs, not the raw card number or CVV.
9. A daily server cron charges the tokenized payment method for renewal. Failed renewals enter a short grace period instead of silently claiming an active subscription.

Pro entitlements enforced by the server are 5 concurrent build slots and no monthly successful-build cap (represented internally as 9999 to avoid a client-side infinity value). Free remains 5 successful builds/month and 1 concurrent build. Flutter and TWA builds use the same server quota.

Team members, audit logs and webhook configuration are still browser-local in this release; they should not be advertised as server-backed collaboration/RBAC until persistent workspace APIs are added.


## Browser-only developer utilities

The Free Developer Utilities Suite is designed to keep usage cost at $0 to WyBuild. The utilities execute in the user's browser and do not call an AI API or upload files to the WyBuild backend.

Included utilities:
- Android icon generator
- pubspec.yaml linter and optimization suggestions
- AndroidManifest permission/security audit
- keystore command and signing configuration helper
- ProGuard/R8 rule generator
- GitHub Actions workflow exporter
- JSON formatter/validator
- SHA-256 checksum generator
- APK/AAB ZIP/package structure inspector
- Gradle/Android release configuration audit

The APK/AAB inspector and checksum generator process the selected files locally in the browser.
