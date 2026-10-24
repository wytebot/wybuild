# WyBuild credit security and standalone APK compatibility

## Architecture

The Android APK must not contain a private billing key or treat a local balance as authoritative. `src/services/apiBase.ts` routes native API requests to the deployed HTTPS WyBuild API (`https://wybuild-black.vercel.app` by default, or `VITE_API_BASE_URL` / runtime config). Native sign-in exchanges the short-lived handoff code for a server-issued bearer token, stores it using Capacitor Preferences, and sends it as `Authorization: Bearer ...`. The server validates the sealed token and its active server-side session on every protected request. The web build continues to use the secure session cookie.

Credit balances, pricing, purchase verification, build reservations, and ledger writes stay on the server. The APK is only a client. Do not add a service-account key, Flutterwave secret, or other server credential to the app bundle.

## Build pricing

- Every accepted build reserves 5 build credits on the server.
- The server loads the last accepted configuration for the signed-in user and GitHub repository.
- Newly enabled native integrations and newly added Android permissions are priced from the server-owned price table. Previously enabled features/permissions in that saved configuration are not charged again.
- Package ID and version name edits are charged at 2 credits each when they differ from a previously accepted configuration. Initial configuration is not treated as an edit.
- The server reserves the total under a per-user/repository build billing lock. Client-side labels or `alreadyPaid` values cannot waive charges.
- A failed dispatch/setup refunds the full reservation. After GitHub accepts the dispatch, the configuration baseline is committed. A later failed build refunds the 5 build credits; setup/integration changes remain charged because they were accepted into the requested build configuration.
- The existing authenticated `/api/credits/action` endpoint is retained for compatibility, but the Web-to-Android UI no longer uses it to determine feature pricing. The build endpoint is the authority for configuration differences.

## Offline and failure behaviour

A secure balance cannot be verified offline. The app should display a connection error and must not let a local or cached balance authorize a paid build. If the API is unavailable, no build should be dispatched. A timed-out build request should be checked in Builds before retrying because GitHub may have accepted it.

## Deployment checklist

1. Deploy the updated source to the canonical WyBuild Vercel project.
2. Confirm `FIREBASE_SERVICE_ACCOUNT_JSON` is configured, and configure the documented Supabase fallback if the deployment relies on it for quota failover.
3. Test browser login and standalone APK login separately; verify the APK sends its bearer token to the HTTPS API.
4. On a test account, build once with a new feature, rebuild unchanged, then add one feature, add one permission, and change the version. Confirm only the expected deltas are charged.
5. Test insufficient balance, duplicate taps, GitHub dispatch rejection, GitHub build failure, and app restart after login.
6. Verify the wallet and ledger in server-side storage. Never infer security from the displayed balance alone.

## Important limitation

This change hardens the server-side pricing decision and shares it between web and native clients. It is not a substitute for production integration testing against the configured Firestore/Supabase storage and GitHub Actions workflow. The KV layer uses the repository's configured storage providers; production tests must confirm the provider's `nx` operation and lock semantics under concurrent requests.
