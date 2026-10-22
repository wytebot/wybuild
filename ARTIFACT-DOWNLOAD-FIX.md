# Artifact download proxy fix

The `/api/artifact` route now streams GitHub's temporary artifact ZIP through WyBuild and sets `Content-Disposition: attachment`. This avoids relying on a cross-origin redirect in Android WebView, where the download manager may not start. The proxy does not persist artifact bytes; it streams them and sets `Cache-Control: private, no-store`.

## Google Drive folder IDs are not credentials

A Drive folder ID alone cannot authorize reading/writing a private folder. Removing OAuth requires a server-side service account (for example `DRIVE_SERVICE_ACCOUNT_JSON`) and the user must share the chosen folder with that service account email. Do not silently remove the current authorization flow until that backend mode is implemented and configured, otherwise read/sync/rotation will fail or become insecure. Never put service-account credentials in `VITE_` variables or client code.
