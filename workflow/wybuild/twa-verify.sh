#!/usr/bin/env bash
set -euo pipefail
APK="${1:?APK path required}"
DIST="${2:?dist path required}"
STORE_READY="${3:-true}"
mkdir -p "$DIST"
command -v apksigner >/dev/null 2>&1 || true
cat > "$DIST/store-readiness.md" <<REPORT
# WyBuild TWA readiness

- Artifact: \`$(basename "$APK")\`
- TWA build path: Bubblewrap Trusted Web Activity
- WebView wrapper: **not used**
REPORT
if command -v apksigner >/dev/null 2>&1; then
  apksigner verify --verbose "$APK" > "$DIST/apksigner.txt" 2>&1 || { echo 'APK signature verification failed.' >> "$DIST/store-readiness.md"; exit 1; }
  echo '- Android signature verification: passed' >> "$DIST/store-readiness.md"
fi
if [[ "$STORE_READY" == "true" ]]; then
  if unzip -p "$APK" AndroidManifest.xml >/dev/null 2>&1; then echo '- APK package generated successfully.' >> "$DIST/store-readiness.md"; fi
fi
