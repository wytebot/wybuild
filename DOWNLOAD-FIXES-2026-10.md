# Download fixes (2026-10)

- Build logs are exported with real newline characters and include the complete log list, independent of the visible search/filter.
- Browser log downloads use a hidden temporary anchor and defer cleanup for mobile WebViews.
- Artifact downloads in browser/TWA use a temporary anchor for the signed GitHub URL without navigating away from WyBuild.
- Standalone Capacitor APK artifact ZIPs are streamed directly into the app's persistent Documents directory instead of temporary Cache, then offered through Android's share/save sheet.
- The existing authenticated API link request and proxy fallback are preserved.

Device-level verification is still required for the installed APK and target browsers.
