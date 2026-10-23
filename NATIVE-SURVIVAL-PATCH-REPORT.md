# WyBuild native-survival audit and hardening report (workflow v45)

## Scope and honesty

This is a static-source and automated-regression audit of the supplied v49 project, followed by a targeted hardening patch. It is not a claim that the app was installed on a physical Android device or that live GitHub/Flutterwave transactions were completed.

## Additional defects found and fixed during audit

1. **Bearer-origin bypass was based on token shape.** The API previously treated any syntactically shaped `Authorization: Bearer ...` value as sufficient to relax origin checks. It now requires a successfully unsealed native token, a future expiry, an active server-side session record, no revocation record, and no session cookie. `getSession()` also requires the active server-side record, so deleting/revoking the record invalidates the token.
2. **Native OAuth return scheme validation was weaker than saved build configuration validation.** The OAuth entry point now rejects the full reserved-scheme set used by the build configuration cleaner.
3. **Fetch wrapper could corrupt `fetch(new Request(...))`.** When it rewrote a Request object to an absolute backend URL, it passed only the URL to the original fetch and could lose the Request method/body/options. It now constructs a new `Request(rewritten, input)` to preserve semantics.
4. **Native return events were inconsistent.** The bridge now funnels live and cold-start app URLs through a common emitter and emits separate `wybuild-native-auth` and `wybuild-native-billing` events in addition to the general URL event.
5. **Concurrency coverage was missing for one-time OAuth handoff.** Added a concurrent replay regression test and checks for bearer-origin validation and Request-preserving fetch rewriting.
6. **Workflow version advanced.** Bumped both workflow templates and the server-side version marker to v45 so repos can detect this change.

## Earlier v49 implementation retained

- Native GitHub Custom Tab handoff with PKCE verifier/challenge, short-lived single-use handoff code, manual fallback, exchange rate limiting, native bearer sessions and logout revocation.
- Native API base URL and Preferences-backed bearer token.
- Auth `unreachable` state and retry UI rather than silently treating server failure as logout.
- Native payment return via custom scheme and billing status verification; server-side reconciliation remains the authority.
- Shared compatibility analyzer, compatibility findings UI, pre-credit blocker and explicit recorded acknowledgement.
- Runtime bridge API rewrite, external link handling, diagnostics, local fonts, standalone local bundle protection, share-target finalizer fix and optional browser smoke test.

## Verification — ran and passed

- `node --test tests/native-survival.test.mjs`: **9/9 tests passed**.
- `node --check api/index.js`: passed.
- `node --check .github/wybuild/capacitor-bridge.entry.js`: passed.
- `python3 -m py_compile` for both finalizer copies: passed.
- `bash -n` on all **17 `run:` blocks** in each workflow template: passed.
- `.github/wybuild/capacitor-bridge.entry.js` and `workflow/wybuild/capacitor-bridge.entry.js` are identical.
- Both finalizer copies are identical.
- Live workflow and template are identical after replacing the intended live `WB_APP_URL` value with `__WYBUILD_APP_URL__`.
- Both workflow templates carry version 45; API marker is version 45.

## Could not run here

- `npm install --ignore-scripts --no-audit --no-fund` did not finish within the execution window; therefore `tsc --noEmit` and `vite build` are **not verified**.
- No Gradle APK/AAB build, Android emulator, or physical-device test was run.
- No live GitHub OAuth, deployed Vercel KV/CORS, Flutterwave test charge/webhook, Android deep-link resolution, notification tap, or Play policy review was performed.
- The optional Playwright/Chromium smoke test was not run because dependencies could not be installed.

## Manual release checklist

1. Deploy the API with `APP_URL=https://wybuild-black.vercel.app` (or the intended canonical production origin), GitHub OAuth credentials, session secret, and a working KV backend.
2. Ensure GitHub OAuth callback URL exactly matches `https://wybuild-black.vercel.app/api/auth/callback` (or the canonical configured host).
3. Install a fresh APK; verify app shell boots without `server.url` and no blank screen appears.
4. Sign in via Custom Tab, return via deep link, then force-stop during OAuth and confirm cold-start return works.
5. Try manual code fallback; verify one successful exchange, replay rejection, expiry rejection and wrong-verifier rejection.
6. Log out and verify the old bearer is rejected; sign in again.
7. Launch offline/server-down: verify a visible unreachable/retry state rather than false logout, then reconnect and retry.
8. Download an artifact and test push registration/notification tap.
9. Use a Flutterwave test payment; verify app return is only a hint and credit balance changes only after authoritative status/webhook reconciliation.
10. Build a sample Capacitor user app with relative `/api` and no mitigation; verify it is blocked before credit reservation. Configure an HTTPS API base or explicitly acknowledge the risk and inspect the generated report.
11. Confirm SEND share-target intents, legal/external links, app links and custom-scheme links on the actual device.
12. Run `npm ci`, `npm run lint`, `npm run build`, `npm run test:native`, and the full workflow in CI before production release.

## Decisions / known limits

- The custom-scheme OAuth return remains protected by PKCE because another app may register the same scheme.
- The analyzer is heuristic source scanning, not a formal proof that a project is compatible. Findings may include false positives or miss dynamically constructed requests.
- A native bundled shell cannot make server-backed features work offline. The app must show a connectivity state and retry when its backend is unavailable.
- The runtime compatibility bridge cannot automatically make every arbitrary backend's authentication protocol compatible. User apps may still need a server-side handoff integration.
- No claim is made that the APK is production-ready until the build and physical-device checklist above passes.

## v46 blank-screen hardening (debug pass)

Cause class: the bundled WebView (https://localhost) has no backend. Any navigation to a same-origin path such as /api/auth/login is answered with Capacitor index.html at that path; with relative asset URLs every JS/CSS file then resolved under /api/auth/ and the screen stayed blank. The earlier recovery ran only after a resource error and only once per session.

Changes:
1. android-startup-diagnostics.js leaves any /api path for the app root immediately, before app modules load (cannot loop; no session flag).
2. capacitor-bridge.entry.js intercepts clicks on same-origin API-prefix links in the native app and opens them on the live backend instead of navigating the WebView.
3. vite.config.ts base is now / (root-absolute assets) so the bundle no longer depends on the workflow regex rewrite.
4. Workflow/server version marker bumped to 46 so repos with the old bridge and diagnostics are flagged outdated.
5. Removed stale __pycache__ directories (including .pyc files compiled from different paths).
6. Added a regression test that executes the diagnostics script against /api, /apiary and / paths in both copies.

Verified: node --test (10/10), node --check on API, bridge and diagnostics, both copies identical, live workflow matches template. Not verified (no network, no Android toolchain): npm install, tsc, vite build, Gradle, and device testing.
