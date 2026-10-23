# WyBuild native quality guardrails

- The standalone/Capacitor workflow must bundle a built `index.html` into the APK. It now fails rather than quietly shipping a standalone APK whose main screen is just the configured live URL.
- URL-only projects should explicitly use the Trusted Web Activity (TWA) workflow and meet PWA/asset-links requirements. TWA is Chrome-rendered and is not equivalent to a fully native app; native Capacitor APIs cannot be injected into it.
- The native-feature and permission pickers are under **MORE** to keep the default interface shorter. Permissions remain opt-in and must match real app functionality; blanket permission requests can harm trust and trigger store review issues.
- WyBuild's own PWA service worker precaches the app shell, caches hashed build assets, and falls back to a cached page/offline screen. API calls, authentication and builds are deliberately network-only so stale cache cannot fake a successful operation.
- A successful compile is not a guarantee of store acceptance. Test on real Android devices, handle runtime permission denials, explain sensitive access in context, and verify Google Play policy requirements for each app.

## v40
- The workflow now verifies the packaged `android/app/src/main/assets/capacitor.config.json` and the built APK (`assets/public/index.html` present, no `server.url`), so a project hook such as `wybuild/capacitor-patch.sh` can no longer turn the APK into a live-website WebView.
- `wybuild/capacitor-patch.sh` was removed from this repository. Bundled-asset builds of WyBuild itself need an absolute API base URL, CORS with credentials and cookie/OAuth handling before they work on `https://localhost`.
- Fixed the meta-refresh check regex and allowed an explicitly selected TWA shell.

## Capacitor native survival (workflow v44)

Standalone Capacitor builds package the UI locally and do not set `server.url`. Server-backed features still require a reachable public HTTPS API. Configure `apiBaseUrl`, `apiPrefixes`, `authMode`, `returnScheme`, and `webFallbackUrl` in Web → Android → MORE → Backend & sign-in survival settings. The compatibility report lists findings with source file and line. Blocking findings stop a build before credits are reserved unless the user explicitly checks “I understand, build anyway”; the acknowledgement is recorded.

Native GitHub sign-in uses a Custom Tab and a single-use 120-second PKCE-bound handoff. Native bearer sessions expire after 24 hours and are revocable. Never put provider tokens, handoff codes or PKCE verifiers in URLs, logs, or localStorage. Native billing returns via the custom scheme but the app must poll `billing/status`; the webhook remains authoritative for crediting. Offline mode can show the bundled shell but cannot complete server-backed work. The optional HTTPS/Chromium smoke test runs when `WYBUILD_NATIVE_SMOKE_TEST=true`. Device, live OAuth, Flutterwave and Gradle release verification must still be done before shipping.
