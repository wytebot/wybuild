# WyBuild IndexedDB storage

WyBuild now persists account-scoped workspace records (projects, team settings, audit history, webhook configuration/deliveries, and selected repository) in the browser's IndexedDB database `wybuild-local`, object store `workspace`.

- Records are namespaced by the signed-in GitHub login to prevent local workspace data from crossing accounts.
- Existing account-scoped `localStorage` values are migrated into IndexedDB on first read and then removed from `localStorage`.
- Tiny UI/session conveniences (for example the notification deep-link tab and account chooser list) may still use `localStorage`; large or structured workspace records do not.
- IndexedDB is local to the browser/app installation and origin. It does not sync across devices and can be cleared by the user/browser. GitHub remains authoritative for repositories, workflow runs, artifacts, and server-side billing/credits.
- Do not store OAuth access tokens, signing passwords, keystore files, payment secrets, or server credentials in this database.

## v36 hardening

- One shared connection that reopens itself after `close`, `versionchange` or `InvalidStateError`.
- Writes are serialized and coalesced per key, so an older save can never land after a newer one. `idbFlush()` waits for the queue (used on sign-out/account switch and when the page is hidden).
- Every write also goes to a `backup` object store in the same transaction (DB version 2). If the primary record is missing or unreadable, the last good copy is returned.
- Values that fail structured clone fall back to a JSON round-trip instead of losing the save.
- Quota failures raise `StorageQuotaError`; the app shows a specific "out of storage space" message.
- If IndexedDB is unavailable (some private modes / locked-down WebViews), data is kept in memory and mirrored to `localStorage` when small, so the app keeps working.
- `requestPersistentStorage()` is called after an account's data loads so the browser is less likely to evict it.
- `onIdbChange()` exposes cross-tab change events (BroadcastChannel) for future use; it is intentionally not wired to state to avoid write/notify loops.

## Integration helpers update in place

Re-running a WyBuild integration on a repo that already has `src/wybuild-integrations/<id>.ts` now overwrites that managed file in the same atomic commit. If the file already matches the current template byte-for-byte, no commit is made, credits are refunded, and the response has `upToDate: true`. The old `INTEGRATION_TARGET_EXISTS` 409 is gone.

## Native features (workflow v38)

- The installable `workflow/` copy was behind `.github/`: it lacked the launcher-icon step. It now includes it, and `apply-launcher-icon.mjs` is part of the installed file set, so existing repos get it via the normal "update workflow" flow.
- Capacitor builds now add the Android permissions their features need: local notifications and push (POST_NOTIFICATIONS, VIBRATE), haptics (VIBRATE), network status (ACCESS_NETWORK_STATE).
- `deeplinks` previously did nothing. It now adds a verified https App Link intent filter for the site's host, and the bridge exposes `WyBuildNative.deepLinks.getLaunchUrl()` and `.onOpen(cb)`. Hosting `/.well-known/assetlinks.json` is still required for Android to verify the links.
