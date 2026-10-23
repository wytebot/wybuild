# Artifact download proxy fix

The `/api/artifact` route now streams GitHub's temporary artifact ZIP through WyBuild and sets `Content-Disposition: attachment`. This avoids relying on a cross-origin redirect in Android WebView, where the download manager may not start. The proxy does not persist artifact bytes; it streams them and sets `Cache-Control: private, no-store`.

## Google Drive folder IDs are not credentials

A Drive folder ID alone cannot authorize reading/writing a private folder. Removing OAuth requires a server-side service account (for example `DRIVE_SERVICE_ACCOUNT_JSON`) and the user must share the chosen folder with that service account email. Do not silently remove the current authorization flow until that backend mode is implemented and configured, otherwise read/sync/rotation will fail or become insecure. Never put service-account credentials in `VITE_` variables or client code.

## v40: APK download failure + speed

Cause: in the Capacitor APK the artifact was fetched into JS memory, converted to base64 and passed through the WebView bridge to `Filesystem.writeFile`. Large ZIPs exhaust memory or time out there, and the data also took an extra hop through the Vercel function (60 s limit).

Fix:
- `GET /api/artifact?repo=…&id=…&mode=link` (session protected, same access checks) returns GitHub's short-lived signed storage URL as JSON.
- Android APK: the app downloads that URL natively with `Filesystem.downloadFile` (streamed to app cache, live percent on the button), then opens the Android save/share sheet. If that fails it opens the URL in the system browser.
- Browser/TWA: navigates to the signed URL (normal attachment download). If the link request fails it falls back to the old streaming proxy.
- The proxy now stops pulling from GitHub when the client disconnects.

Not tested on a device or against live GitHub in this environment (no network); the edited files pass a syntax/type check only.
