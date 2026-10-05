#!/usr/bin/env bash
set -euo pipefail
ARTIFACT="${1:?APK or AAB path required}"
DIST="${2:?dist path required}"
STORE_READY="${3:-true}"
MODE="${4:-write}" # write = start a new report, append = add to it (used when both APK and AAB are built)
mkdir -p "$DIST"
command -v apksigner >/dev/null 2>&1 || true
if [[ "$MODE" == "write" ]]; then echo "# WyBuild TWA readiness" > "$DIST/store-readiness.md"; echo >> "$DIST/store-readiness.md"; fi
SHELL_MODE="${WYBUILD_SHELL:-standalone}"
if [[ "$SHELL_MODE" == "twa" ]]; then SHELL_LINE="Trusted Web Activity (Chrome renders the site; needs Digital Asset Links to hide the address bar)"; else SHELL_LINE="Standalone native shell (the app renders the site itself; no address bar, no Digital Asset Links needed)"; fi
cat >> "$DIST/store-readiness.md" <<REPORT
- Artifact: \`$(basename "$ARTIFACT")\`
- Build path: Bubblewrap project
- App shell: $SHELL_LINE
REPORT
case "$ARTIFACT" in
  *.apk)
    if command -v apksigner >/dev/null 2>&1; then
      apksigner verify --verbose "$ARTIFACT" > "$DIST/apksigner.txt" 2>&1 || { echo 'APK signature verification failed.' >> "$DIST/store-readiness.md"; exit 1; }
      echo '- Android APK signature verification: passed' >> "$DIST/store-readiness.md"
    fi
    if [[ "$STORE_READY" == "true" ]]; then
      unzip -p "$ARTIFACT" AndroidManifest.xml >/dev/null 2>&1 || { echo 'APK manifest could not be read.' >> "$DIST/store-readiness.md"; exit 1; }
      echo '- APK package generated successfully.' >> "$DIST/store-readiness.md"
    fi
    ;;
  *.aab)
    jarsigner -verify "$ARTIFACT" > "$DIST/jarsigner.txt" 2>&1 || { echo 'App Bundle signature verification failed.' >> "$DIST/store-readiness.md"; exit 1; }
    echo '- Android App Bundle signature verification: passed' >> "$DIST/store-readiness.md"
    ;;
  *) echo 'Unsupported verification artifact.' >> "$DIST/store-readiness.md"; exit 1 ;;
esac
