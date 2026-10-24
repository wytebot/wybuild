# Auto-wired native features (workflow v49)

Before v49, ticking a native feature only made the plugin available as `window.WyBuildNative`; the site still had to call it. From v49 the build also installs `wybuild-autowire.js` (appended to the native bridge bundle) which connects the **standard web APIs your site already uses** to the Android feature — only for features you ticked, only inside the native app, and with the original browser behaviour as fallback.

| Ticked in WyBuild | Existing site code that now works natively |
|---|---|
| Native Share Sheet | `navigator.share()` / `navigator.canShare()` (text, links, files) → Android share sheet |
| Native Downloads (or File Access) | `<a download>`, `blob:` / `data:` links and `a.click()` downloads → saved, then Android save/share sheet. Cross-origin links use the native downloader. Failure opens the link externally |
| Scheduled Local Notifications / Local reminders | `Notification.requestPermission()`, `new Notification()`, `registration.showNotification()` → Android notifications |
| Haptic Feedback | `navigator.vibrate()` |
| Network Status Events | `navigator.onLine`, `online` / `offline` events follow validated Android connectivity |
| Device Information | `navigator.getBattery()` |
| Deep Link Handling | links to your site's address open that page inside the app (once per session, so refresh does not re-navigate) |
| Edge swipe to go back | enabled with default history-back; a later `swipeBack.enable({ onBack })` from your site overrides it |
| Pull to refresh | already auto-enabled (v48) |

## Still needs code in your site (cannot be guessed by the build)
Native Firebase sign-in, remote push, Biometric unlock, Incoming Share Target handling, app-file read/write (`WyBuildNative.files`). Camera, microphone and location use the standard web prompts once the permission is ticked.

## How it is wired
- `workflow/wybuild-twa.yml` (both copies): adds `nativeFeatures` to `wybuild-runtime-config.js`, appends `.github/wybuild/wybuild-autowire.js` to `wybuild-native-bridge.js` before the existing `node --check`.
- `api/index.js`: ships `wybuild-autowire.js` to user repos; workflow version 49 so older repos are flagged for **Update workflow**.
- Diagnostics in the running app: `window.__WYBUILD_AUTOWIRED__` → `{ applied, skipped }` and a `wybuild-autowire-ready` event. Set `window.__WYBUILD_DISABLE_AUTOWIRE__ = true` before the bridge loads to opt out.
- Capacitor source builds only. Trusted Web Activity and the URL-only shell do not run this layer.
