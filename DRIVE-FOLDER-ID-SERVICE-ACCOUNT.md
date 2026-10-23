# WyBuild Drive folder-ID storage

The Dev Studio Drive flow now uses the existing server-side service account and no longer requests a user Google OAuth token.

## Existing Vercel credential

The API reads the existing `FIREBASE_SERVICE_ACCOUNT_JSON` first-party service-account environment variable, as well as `DRIVE_SERVICE_ACCOUNT_JSON` and `GOOGLE_SERVICE_ACCOUNT_JSON`. Raw JSON and base64-encoded JSON are supported. No service-account credential is sent to the browser.

## One-time Google Drive setup

1. Ensure Google Drive API is enabled in the Google Cloud project for the configured service account.
2. In Google Drive, share the intended folder with the `serviceEmail` shown in Dev Studio and grant **Editor** permission.
3. Paste the folder ID from that folder's URL and choose **Validate & save folder**.
4. WyBuild validates folder type and write access with a temporary marker that it deletes before saving the folder ID.
5. Build history can then be read and synced through authenticated WyBuild API routes.

A folder ID is not a credential. The folder must be shared with the service account. The folder ID is stored in WyBuild's existing KV store under the authenticated GitHub login. Rotation requires the user to choose the explicit **Rotate folder** action and confirm Yes in the confirmation dialog. The new folder is validated before it replaces the active ID; the previous folder and its contents are not deleted.

## API routes

- `GET /api/drive-storage`: current user's saved folder and service-account email.
- `POST /api/drive-storage/validate`: validates and saves a folder ID; changing an existing ID requires `confirmRotation: true`.
- `GET /api/drive-storage/history`: reads `wybuild-history.json` from the saved folder.
- `POST /api/drive-storage/history`: merges and writes build/project summaries while excluding billing and secrets.

## Limitations / production checks

- This service account can only access folders explicitly shared with it, unless a supported Google Workspace domain-wide delegation setup is configured. A user pasting an arbitrary unshared folder ID cannot grant access by itself.
- Drive history is a backup/sync, not the authoritative billing ledger or live GitHub Actions state.
- Verify service-account Drive API permissions in staging before production rollout.
