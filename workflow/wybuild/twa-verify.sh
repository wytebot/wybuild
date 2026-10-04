#!/usr/bin/env bash
set -euo pipefail
ARTIFACT="${1:?APK or AAB path required}"
DIST="${2:?dist path required}"
STORE_READY="${3:-true}"
mkdir -p "$DIST"
command -v apksigner >/dev/null 2>&1 || true
cat > "$DIST/store-readiness.md" <<REPORT
# WyBuild TWA readiness

- Artifact: \`$(basename "$ARTIFACT")\`
- TWA build path: Bubblewrap Trusted Web Activity
- WebView wrapper: **not used**
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
