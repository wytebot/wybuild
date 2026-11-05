# WyBuild native and Build Doctor upgrade — November 2026

## User-facing changes
- Added a first-launch animated welcome screen. Start continues into the existing GitHub sign-in flow; the choice is stored locally on the device.
- Android system Back closes the mobile drawer first, returns to the dashboard from other tabs, and exits only from the dashboard.
- Native status bar is shown with light foreground content for the dark application shell.
- Build artifacts are queued through Android DownloadManager and saved to public `Downloads/WyBuild` folders: `Builds/Installers`, `Builds/Archives`, `Builds/Logs`, and `Downloads`.
- Native DownloadManager posts OS completion/progress notifications and continues after the WebView is backgrounded.
- Text exports and small browser-generated blobs use Android MediaStore. Large remote artifacts stream directly through DownloadManager rather than being copied through JS memory.
- Legacy shell fallback remains available through app Documents and the Android share sheet.
- No `MANAGE_EXTERNAL_STORAGE` permission is requested. Permission APIs check/request only camera/photos/location/notifications/push when a feature is invoked.
- Build Doctor now chooses the earliest actionable matching error, returns numbered evidence, failed step, and extracted file:line references, and adds signatures for missing scripts, Vite transforms, lint, Node engine mismatch, Java/Gradle mismatch, and duplicate Android classes.
- Workflow marker bumped to v52 so connected repositories can receive the updated native bridge/finalizer.

## Native bridge additions
- `WyBuildNative.permissions.check(feature)`
- `WyBuildNative.permissions.request(feature)`
- `WyBuildNative.files.download(url, filename)`
- `WyBuildNative.files.downloadStatus(requestId)`
- `WyBuildNative.files.saveText(filename, content, category)`
- `WyBuildNative.files.saveBase64(filename, base64, category, mimeType)`

## Validation
- `node --check` passed for the API and native JavaScript bridge/autowire files.
- Python bytecode compilation passed for both mirrored Capacitor finalizer scripts.
- All 38 repository Node tests passed.
- The finalizer was exercised against a temporary Capacitor Android project and generated/registered `WyBuildDownloadsPlugin` successfully.
- A full Vite/TypeScript project build could not be completed in this environment: dependency installation timed out, leaving `vite/client` and project dependencies unavailable. Run the Vercel build after installing dependencies; test DownloadManager on a physical Android 10+ device.
