# Google Drive credentials for WyBuild

WyBuild's browser-side Drive integration needs an **OAuth 2.0 Client ID**. It does not need a service-account JSON key. Do not put a service-account private key in `VITE_*` variables or ship it to the browser.

## Create the OAuth client

1. Open https://console.cloud.google.com/ and select or create a Google Cloud project owned by you.
2. Open **APIs & Services → Library**, search for **Google Drive API**, and enable it.
3. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**, depending on the Console UI). Configure the app name, support email, and developer contact email.
4. Choose the audience appropriate to your rollout. While the app is in **Testing**, add every tester's Google account under **Test users**. A public production app may need Google's OAuth verification, especially because the current implementation requests the broad Drive scope.
5. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**. Choose **Web application**.
6. Under **Authorized JavaScript origins**, add the exact origins where the app runs, for example:
   - `https://wybuild-black.vercel.app`
   - `http://localhost:3000` (local development only)
   Do not add a path or trailing route. Add any custom production domain separately.
7. Create the client and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). A browser OAuth client ID is public configuration, not a client secret. Never expose a client secret.
8. In Vercel, open the WyBuild project → **Settings → Environment Variables**. Add `VITE_GOOGLE_DRIVE_CLIENT_ID` with that Client ID for Production (and Preview/Development only if needed). Redeploy after changing it.
9. Test on the deployed origin: connect Drive, choose a folder, validate read/write access, read history, and sync a small test history. Check denied consent, expired token, revoked access, quota errors, and a full Drive.

## Permissions / privacy note

The current code requests `https://www.googleapis.com/auth/drive`, which grants broad access to the user's Drive and may require OAuth verification. Before a public launch, consider changing to the narrower `drive.file` scope and adding Google Picker so users explicitly select files/folders; this requires implementing and testing that flow. Do not silently change scopes without implementing the matching file-selection behavior.

The OAuth access token is short-lived and kept in browser memory by the current implementation. Users may need to reconnect after a reload or expiry. Do not store access tokens in Drive files, localStorage, logs, or server-side history.

## Troubleshooting

- `origin_mismatch`: add the exact browser origin to Authorized JavaScript origins.
- `access_denied` / app not verified: check OAuth audience, test-user list, consent configuration, and verification requirements.
- Drive API disabled: enable Google Drive API in the same Cloud project as the OAuth client.
- `401`: reconnect to obtain a new access token.
- `403` or `429`: inspect the response details; it can mean insufficient permission, a quota/rate limit, or storage full. Wait/back off for rate limits; do not repeatedly retry immediately.
