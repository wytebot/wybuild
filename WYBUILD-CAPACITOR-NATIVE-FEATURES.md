# WyBuild Capacitor + Android Gradle workflow

WyBuild now selects **Capacitor + Android Gradle** when the connected GitHub repository contains a buildable web app (`package.json` with a `build` script and an `index.html` in `dist/`, `build/`, `www/`, `out/` or `public/`). URL-only websites, non-buildable repositories, and projects explicitly configured for Trusted Web Activity continue through the existing Bubblewrap native-shell path. This keeps URL conversion available instead of silently excluding it.

## How WyBuild picks the web build script (workflow v34)

For a repository with a `package.json`, WyBuild runs the first script that exists in this order: `wybuild:build`, `build:capacitor-web`, `build:static`, `build`.
Capacitor is used only if that script leaves an `index.html` in `dist/`, `build/`, `www/`, `out/` or `public/`.

A Next.js app with server API routes (like WyCut) does **not** do that with plain `next build` (it writes `.next/`), so it used to fall back to Bubblewrap silently.
Give such a project a script that makes a static export into `out/` (WyCut already has `build:capacitor-web`). WyBuild now also:

- defaults `NEXT_PUBLIC_API_BASE_URL` to the origin of the project's website and `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the web OAuth client in `google-services.json` (GitHub repository *variables* with those names override them);
- warns (instead of a quiet notice) when a Next.js project ends up on the Bubblewrap fallback;
- removes the project's own `@codetrix-studio/capacitor-google-auth` and older `@capacitor/*` packages from the throw-away build checkout so they cannot clash with the Capacitor 7 set;
- runs an optional `wybuild/capacitor-patch.sh` from the repository root after `cap sync` (gets `WB_ANDROID_DIR` and `WB_APP_ID`) for project-specific native code;
- finds `google-services.json` at the repo root, `config/android/`, `android/app/` or `app/`, or from a `GOOGLE_SERVICES_JSON_BASE64` variable;
- prints the signing certificate SHA-1/SHA-256 in the run summary and warns when that SHA-1 is not registered in `google-services.json`.

Native Google login works only when the signing SHA-1 (and, for Google Play installs, the Play app-signing SHA-1) is registered for the exact package ID in Firebase and the refreshed `google-services.json` is committed.

## Native bridge exposed to bundled source builds

Capacitor source builds bundle a small bridge as `window.WyBuildNative`. It is available after the `wybuild-native-ready` event. Examples:

```js
// Wait until the native bridge is ready (web builds can continue without it).
window.addEventListener('wybuild-native-ready', async () => {
  if (!window.WyBuildNative?.isNative()) return;
  const result = await window.WyBuildNative.camera.pickPhoto();
  if (result?.ok === false) console.warn(result.error);
  else console.log('Photo result', result);
});

// Native Google login (requires Firebase setup described below).
const login = await window.WyBuildNative.auth.google();

// Local notification, with runtime permission prompt.
await window.WyBuildNative.notifications.permissions();
await window.WyBuildNative.notifications.schedule('Reminder', 'Your task is due soon');

// Observe Android's native back button and clear horizontal swipes without blocking scroll.
const back = await window.WyBuildNative.app.onBack(() => {
  if (window.history.length > 1) window.history.back();
  else window.WyBuildNative.app.exit();
});
const swipe = await window.WyBuildNative.gestures.onSwipe(({ direction }) => {
  if (direction === 'right' && window.history.length > 1) window.history.back();
});
// When the screen/component is removed, clean up listeners:
// await back.remove(); await swipe.remove();

// Register for FCM push and send the resulting token to your authenticated backend.
window.WyBuildNative.push.onToken(({ value }) => {
  fetch('/your-authenticated-backend/push/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'include', body: JSON.stringify({ token: value }) }); // Example route: implement this on your own backend.
});
await window.WyBuildNative.push.register();
```

### Included plugin capabilities

- Camera/photo picker and camera permission request.
- Geolocation and runtime location permission request.
- Local notifications and Android notification permission.
- Push notification registration/events through Capacitor Push Notifications.
- Firebase native Google/Apple authentication entry points.
- Biometric authentication entry point.
- Filesystem read/write/list/delete and URL-to-file downloads.
- Native share sheet, clipboard, haptics, device/battery information, network state/events.
- Native browser, status bar, orientation lock, keyboard dismissal, app lifecycle/back-button listeners, opt-in horizontal swipe gestures, app information/exit, preferences storage, action sheets and dialogs.
- Capacitor plugins also contribute their required Android manifest declarations; WyBuild adds explicitly selected permissions from the UI and keeps camera/microphone/GPS hardware optional where appropriate.

The bridge is bundled only into the **built local website**. An arbitrary remote URL cannot automatically call Capacitor plugin APIs unless its website code includes a compatible bridge. URL-only builds retain the legacy native shell and its existing feature set; they do not receive the bundled Capacitor JavaScript bridge.

## Native Google / Apple login setup

Native authentication cannot be fully enabled by a generic APK builder without the app owner's identity-provider configuration. To enable it:

1. Create/select a Firebase project and register an Android app with the exact package ID shown in WyBuild.
2. Download the matching `google-services.json` into the repository root (it contains client configuration, not an Admin service-account private key; secure Firebase rules and provider settings are still required).
3. Enable Google and any supported identity providers in Firebase Authentication.
4. Add the release signing certificate SHA-1/SHA-256 fingerprints in Firebase as required by the provider, and download a fresh `google-services.json` if Firebase instructs you to.
5. Rebuild through WyBuild. The workflow detects `google-services.json`, wires the Google Services Gradle plugin, and copies the config into the Android app.
6. Verify the returned Firebase ID token on your backend before granting access. Never trust a client-supplied user ID as proof of authentication.

The bridge exposes `auth.google()`, `auth.apple()`, `auth.current()` and `auth.signOut()`. Provider availability depends on the Android/Firebase provider configuration and provider/platform support.

## Push notification setup

1. Use the same Firebase project and matching Android package ID as the app.
2. Ensure `google-services.json` is present and Firebase Cloud Messaging is enabled.
3. Call `WyBuildNative.push.onToken(...)` before `WyBuildNative.push.register()`.
4. Send the token to your own authenticated backend and store it securely against the signed-in user. Remove/rotate stale tokens as appropriate.
5. Send notifications from a trusted backend using Firebase Admin SDK or FCM HTTP v1. Never place service-account JSON or FCM server credentials in the web app or APK.
6. Android 13+ users must grant notification permission. A token does not itself guarantee delivery; device settings, network availability, FCM configuration and OS restrictions still apply.

Local notifications do not require an FCM server, while remote push does. WyBuild does not invent a push backend or send messages on your behalf.

## Permissions and privacy

The UI-selected Android permissions are added to the manifest when requested. A declaration is not a permission grant: the app must call the relevant plugin permission API at the moment the user invokes the feature and explain why access is needed. Users can deny or revoke permissions. Background location, contacts, health/activity, Bluetooth and other sensitive capabilities require separate plugin implementation and policy review; they are not granted just because an arbitrary permission string is placed in the manifest.

## Build and signing

- APK and AAB are compiled with Android Gradle.
- Release outputs use the existing WyBuild repository keystore secrets so app updates can retain the same signing identity.
- `versionCode` defaults to the GitHub Actions run number; a manually specified version code is respected.
- The workflow checks APK/AAB signing and includes `store-readiness.md` in the build artifact.
- Capacitor plugins are installed on the ephemeral CI runner; this workflow does not commit generated Android project files or npm dependency changes back into the user's source branch.

## Compatibility note

Capacitor plugins work most reliably when the website is bundled locally and its code calls `window.WyBuildNative` or imports Capacitor plugins directly. A remote website URL alone cannot be transformed into a fully native app automatically; it remains supported through WyBuild's existing remote-site shell. Any requested feature requiring an external account, OAuth client, Firebase project, server API or OS permission must be configured and tested by the app owner.


## Engine compatibility checks (v26)

- Capacitor plugins are added to the ephemeral checkout's `package.json` before `cap sync`, so the Android native plugin implementations are registered as well as their JavaScript wrappers.
- A failed `npm run build` now fails the source build; it no longer silently ships a URL wrapper instead of the user's source app. Repositories without a buildable web project can still use the URL-only native shell.
- Firebase sign-in and remote push require a valid root `google-services.json` matching the configured Android package ID.
- Remote push and native Firebase sign-in are Capacitor source-build features. Android share-target receiving is currently URL-shell only; a Capacitor source build refuses that combination instead of pretending it was installed. Outgoing share is available through `WyBuildNative.share`.
- Capacitor bridge file writes use the app's private Documents directory by default, not the public Downloads collection.


## Native value and app-store readiness

WyBuild can compile a real Android application package with Capacitor's Android project, native plugin implementations, a custom launcher activity, system/back handling, local notifications, camera/media picker, filesystem, native share sheet, haptics, device/network information, biometric prompts, and optional Firebase authentication/push. For a bundled-source project these plugins are installed and synchronized during the Gradle build; they are not merely JavaScript stubs. The website must actually invoke these capabilities to provide meaningful native utility. A remote URL-only shell cannot automatically add JavaScript-native integrations to an arbitrary third-party website.

Google Play review is not guaranteed by adding plugins or changing the APK wrapper. The app must provide distinct user value, work reliably, disclose data use, request permissions contextually, comply with target API and policy requirements, and avoid low-value repetitive web wrappers. Test on physical devices and complete the Play Console data-safety, privacy, app-access and content declarations. Push and native Firebase login remain opt-in because each app requires its own matching Firebase configuration and signing fingerprints.


## Pull to refresh and edge swipe back (opt-in, your site implements them)

Select **Pull to refresh** and/or **Edge swipe to go back** in Native app features. They are Capacitor source-build features: the URL-based native shell does not include them. WyBuild only supplies the gesture handling. Nothing is active until your site enables it, because only your app knows what "refresh" and "back" mean.

```js
window.addEventListener('wybuild-native-ready', () => {
  // Pull down at the top of the page. Return a promise to keep the spinner up until the work is done.
  WyBuildNative.pullToRefresh.enable({
    onRefresh: () => queryClient.invalidateQueries(), // default: location.reload()
    threshold: 80,                                      // optional
  });

  // Swipe right from the left edge (left from the right edge in RTL).
  WyBuildNative.swipeBack.enable({
    onBack: () => router.back(),                        // default: history.back()
    exitAtRoot: true,                                   // optional: exit the app when there is no history
  });
});
```

Both return `{ remove() }`, and `WyBuildNative.pullToRefresh.disable()` / `WyBuildNative.swipeBack.disable()` turn them off (for example on a map or canvas screen). Pull to refresh is ignored when the page or an inner scroller is not at the top, and inside inputs. On Android gesture navigation the system back swipe already fires `WyBuildNative.app.onBack(...)`; `swipeBack` covers in-app swipes that start just inside the edge.

## Scroll quality layer (Capacitor + standalone native shell)

WyBuild applies a shared scroll-quality layer to generated builds: smooth programmatic/page scrolling, touch-friendly momentum scrolling, bounded horizontal overscroll, thin scrollbars for intentional scroll rails, and reduced-motion accessibility support. It does not cancel `touchmove`, hijack swipe gestures, or force every element into a scroll container. Apps can mark intentional horizontal/vertical containers with `data-scroll-x` / `data-scroll-y` or `.wy-scroll-x` / `.wy-scroll-y`.

The layer is bundled into Capacitor web assets and injected by WyBuild's URL-based standalone Android WebView shell. A **pure Trusted Web Activity (TWA)** is rendered by Chrome against the website's own origin and does not permit the Android wrapper to inject arbitrary CSS/JavaScript into that remote page. For pure TWA mode, the hosted website must provide its own scroll CSS; choose WyBuild's standalone native shell when wrapper-level injection is required. Both modes still use the same Android build/signing pipeline for the requested APK/AAB outputs.


## v8 — Fullscreen viewport and scrollable drawer correction
- The navigation drawer now has a constrained height and an independently scrollable navigation list, so lower menu items remain reachable on small/tall or landscape screens.
- The app shell uses a viewport height measured from `visualViewport` when available, updating on resize, orientation change, and resume. This avoids stale `100vh`/`100dvh` sizing in some Android WebViews.
- The app shell and drawer respect CSS safe-area insets on devices that expose them, reducing clipping near display cutouts and system gesture areas.
- Android device verification is still required because immersive mode and inset reporting vary by Android/WebView version.
