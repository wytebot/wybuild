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
