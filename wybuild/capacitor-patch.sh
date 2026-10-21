#!/usr/bin/env bash
# WyBuild's own Capacitor build hook (runs from the repo root after `cap sync`).
# WyBuild is NOT a static site: it needs its Vercel API (/api/*), same-origin
# session cookies and the GitHub OAuth redirect. A bundled copy running on
# https://localhost cannot reach any of that and renders a blank dark screen.
# So the APK stays a Capacitor app, but its WebView loads the live site.
set -euo pipefail

: "${WB_ANDROID_DIR:?}"
CFG="$WB_ANDROID_DIR/app/src/main/assets/capacitor.config.json"
[ -f "$CFG" ] || { echo "::error::capacitor.config.json not found at $CFG"; exit 1; }

node - "$CFG" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const twa = JSON.parse(process.env.TWA_CONFIG || '{}');
const url = new URL(twa.webUrl || process.env.WB_APP_URL).origin;
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.server = {
  ...(cfg.server || {}),
  url,                       // load the deployed WyBuild instead of the bundled copy
  cleartext: false,
  // GitHub OAuth and the Flutterwave checkout must stay inside the app WebView
  allowNavigation: [new URL(url).hostname, 'github.com', '*.github.com', '*.flutterwave.com', '*.flutterwave.cloud'],
};
fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
console.log('capacitor.config.json: server.url ->', url);
NODE
