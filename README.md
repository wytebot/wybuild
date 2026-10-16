# WyBuild

WyBuild focuses on **Web → Android** builds for web apps and PWAs using a GitHub Actions **Capacitor + Android Gradle workflow** for buildable web source repositories, with the existing native-shell/Bubblewrap path retained for URL-only and non-buildable projects.

## Plans
- Free: unlimited project display, 5 cloud build starts/month, 1 concurrent build, 15-minute build timeout.
- Pro: unlimited builds, 5 concurrent builds, 60-minute build timeout, unlimited signing profiles.
- Free Forever: GitHub accounts `wytebot` and `wytzbot` bypass the normal Free build allowance and billing.
- Pro: $9.99/month (displayed as ₦15,000) or $99/year (displayed as ₦150,000). NGN values are fixed display equivalents.

## Workflows
WyBuild installs one Web → Android workflow. It detects a buildable local web project and uses Capacitor + Android Gradle with a bundled native-plugin bridge; URL-only sites and explicit TWA configurations use the existing native-shell/Bubblewrap fallback. The former standalone Flutter build/export workflow is no longer supported. See `WYBUILD-CAPACITOR-NATIVE-FEATURES.md` for the native bridge API, Firebase login, FCM push, permissions and security setup.


### Capacitor source builds (workflow v26)

When a connected repository contains a `package.json` build script and produces a static `index.html` in `dist/`, `build/`, `www/`, `out/` or `public/`, WyBuild uses Capacitor and Gradle. The CI runner installs the Android plugins, bundles `window.WyBuildNative`, configures selected manifest permissions, applies the existing release signing key, and emits APK/AAB artifacts. Generated Android files and temporary npm dependency changes are not committed to the user's repository.

The native bridge includes camera/photo selection, geolocation, local and remote notification APIs, Firebase sign-in entry points, biometrics, filesystem operations, sharing, clipboard, haptics, device/network state, status bar, orientation, keyboard, browser, preferences and dialogs. Provider/server configuration is still required for authentication and remote push; see `WYBUILD-CAPACITOR-NATIVE-FEATURES.md`. A remote URL alone cannot acquire arbitrary Capacitor JavaScript APIs, so URL-only projects retain the existing native shell rather than being excluded.

## Free tools
JSON formatter, Base64 encoder/decoder, URL encoder, regex tester and text analyzer run entirely in the browser and do not consume WyBuild API/storage resources.

## Link handling (native features)
In **Web to Android → Link handling** every link rule is a domain (or `tel:`-style link type) set to one of:
- **Internal** – stays in the app. The domain becomes a trusted origin and a verified app link, so links to it open the app from anywhere on the phone. Publish the build's `assetlinks.json` on each internal domain.
- **External** – opens in the phone's browser.
- **Other** – handed to Android (dialer, mail, WhatsApp, Maps, UPI...).

Internal rules are baked into the APK/AAB manifest by `workflow/wybuild/twa-native.py`. External and Other rules are enforced by `wybuild-links.js`, generated into the build artifact (`dist/native/`) for the site to include, because a Trusted Web Activity cannot intercept those taps natively. Links on the app's own site always stay internal; the first matching rule wins. Changing rules needs the TWA workflow v13 or newer (WyBuild offers the update automatically).

### App shell (workflow v15)

- **Standalone app** (default): `workflow/wybuild/WyBuildActivity.java` is injected as the launcher activity. The site runs in the app's own WebView, so no address bar or Chrome toolbar can appear and no `assetlinks.json` is required. Fullscreen hides the status and navigation bars, link rules (internal / external / other) are enforced natively, and uploads, downloads, camera/microphone/location prompts, JS dialogs, fullscreen video, an offline screen, the back button and local notifications (`WyBuildNative.notify`) are handled in the app.
- **Trusted Web Activity**: the previous behaviour. Needs `assetlinks.json` to hide Chrome's address bar; required for Web Push delegation and Play Billing.

## PWA
WyBuild itself is installable: `public/manifest.webmanifest`, icons (192, 512, maskable 512, monochrome 512, Apple touch 180), `public/sw.js` and `public/offline.html`. The service worker is network-first for pages (a new deploy is never hidden behind a stale cache), cache-first only for content-hashed `/assets/*`, and never touches `/api/*`. Bump `VERSION` in `sw.js` to drop all caches. `vercel.json` serves `sw.js` uncached and the manifest with the right content type.

## Automatic PWA discovery

Web → Android now performs a two-source PWA discovery pass:

1. **Live site is authoritative** when the repository has a published HTTPS address. WyBuild reads the Web App Manifest, stable app ID, name/short name, start URL, scope, display mode, orientation, primary/maskable/monochrome icons, service worker and existing Digital Asset Links.
2. **Repository metadata is the fallback** when the live site is missing a value. WyBuild checks common manifest locations plus conventional service-worker files and uses the repository data only to fill blanks.
3. WyBuild reports **PWA READY** only when the manifest, usable identity, start URL/scope and install icon are present. A missing service worker is reported separately instead of being incorrectly treated as a manifest failure.
4. The generated package ID is still a free Android identity derived from the HTTPS hostname unless the developer supplies one.

### WyBuild's own PWA/TWA readiness

WyBuild ships its own manifest, install icons, service worker and offline page. It also exposes a guarded `/.well-known/assetlinks.json` endpoint. To make the deployed WyBuild site a verified TWA, configure the exact production Android signing identity in Vercel:

- `WYBUILD_ANDROID_PACKAGE_ID`
- `WYBUILD_ANDROID_SHA256`
- optional `WYBUILD_PLAY_SIGNING_SHA256`

The endpoint returns HTTP 503 until a real package ID and valid SHA-256 certificate fingerprint are configured; WyBuild never generates a placeholder fingerprint.
