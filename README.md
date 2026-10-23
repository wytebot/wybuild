# WyBuild

WyBuild is a GitHub-connected build and release tool. Build jobs run through GitHub Actions and Capacitor where supported.

## Automation credits

Credits are one-time purchases and do not expire. Operations use fixed WyBuild credit charges for deterministic repository inspection, build-log diagnosis, repair planning, and integration installation. No AI provider is called; no Gemini key, model, or token-pricing variables are required. Free Forever accounts remain exempt.

## Deterministic Build Doctor

After a failed pipeline, WyBuild reads and redacts build logs, matches known error signatures, shows the exact log evidence, and provides detailed category-specific repair steps. It does not automatically rewrite application logic for unknown errors. Safe repair rules are added only when they can be verified without guessing application intent or weakening security.

## Deterministic integrations

The integration catalog installs version-aware helper modules and compatible Capacitor dependencies where supported, then commits changes atomically to GitHub. Helpers must be imported and used by the app, and provider-dependent features may require real Firebase configuration, a server-side payment endpoint, or push delivery infrastructure. WyBuild does not invent credentials. A successful source commit is not proof of a successful Android build or runtime behavior; rebuild and test the APK/AAB before release.

## Environment

See `.env.example` for server configuration. No AI provider API key is required.

### Native feature compatibility checks

The Web → Android screen now labels feature selections green or red against the chosen TWA/standalone workflow and repository inspection. Incompatible features cannot be newly selected; existing incompatible selections can be removed. The API rejects incompatible native feature selections before reserving build credits, and the GitHub Actions workflow refuses to silently omit Capacitor-only features when it detects a URL-only build. Native integrations also receive server-side compatibility checks before credit debit or repository changes. A source-build candidate still requires a successful build that produces `index.html`; no preflight can guarantee arbitrary build scripts without executing them.

## Native bridge build safeguards (v45)

The Capacitor bridge is plain JavaScript and must not contain TypeScript-only syntax such as `registerPlugin<any>(...)`. The workflow now checks the canonical bridge source, checks that the legacy duplicate is identical, validates the esbuild output with a TypeScript-generic leak scan and `node --check`, validates the bridge copied into Android assets, and revalidates the bridge extracted from the final APK before the artifact can be published. A failed check stops the build instead of shipping an APK likely to fail during startup. Keep both bridge source copies synchronized when changing the native bridge.

## Capacitor native survival (workflow v44)

Standalone Capacitor builds package the UI locally and do not set `server.url`. Server-backed features still require a reachable public HTTPS API. Configure `apiBaseUrl`, `apiPrefixes`, `authMode`, `returnScheme`, and `webFallbackUrl` in Web → Android → MORE → Backend & sign-in survival settings. The compatibility report lists findings with source file and line. Blocking findings stop a build before credits are reserved unless the user explicitly checks “I understand, build anyway”; the acknowledgement is recorded.

Native GitHub sign-in uses a Custom Tab and a single-use 120-second PKCE-bound handoff. Native bearer sessions expire after 24 hours and are revocable. Never put provider tokens, handoff codes or PKCE verifiers in URLs, logs, or localStorage. Native billing returns via the custom scheme but the app must poll `billing/status`; the webhook remains authoritative for crediting. Offline mode can show the bundled shell but cannot complete server-backed work. The optional HTTPS/Chromium smoke test runs when `WYBUILD_NATIVE_SMOKE_TEST=true`. Device, live OAuth, Flutterwave and Gradle release verification must still be done before shipping.
