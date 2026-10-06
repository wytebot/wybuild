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
