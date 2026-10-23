# WyBuild native quality guardrails

- The standalone/Capacitor workflow must bundle a built `index.html` into the APK. It now fails rather than quietly shipping a standalone APK whose main screen is just the configured live URL.
- URL-only projects should explicitly use the Trusted Web Activity (TWA) workflow and meet PWA/asset-links requirements. TWA is Chrome-rendered and is not equivalent to a fully native app; native Capacitor APIs cannot be injected into it.
- The native-feature and permission pickers are under **MORE** to keep the default interface shorter. Permissions remain opt-in and must match real app functionality; blanket permission requests can harm trust and trigger store review issues.
- WyBuild's own PWA service worker precaches the app shell, caches hashed build assets, and falls back to a cached page/offline screen. API calls, authentication and builds are deliberately network-only so stale cache cannot fake a successful operation.
- A successful compile is not a guarantee of store acceptance. Test on real Android devices, handle runtime permission denials, explain sensitive access in context, and verify Google Play policy requirements for each app.
