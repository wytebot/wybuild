#!/usr/bin/env bash
# Runs from the repository root after `cap sync` (hook supported by the WyBuild workflow).
# Pothub's server finishes native sign-in by redirecting the Custom Tab to ai.pothub.app://auth?...
# WyBuild only registers its own default return scheme, so without this the tab stays blank on the website.
set -euo pipefail
ANDROID_DIR="${WB_ANDROID_DIR:-$PWD/android}"
MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
[ -f "$MANIFEST" ] || { echo "capacitor-patch: AndroidManifest.xml not found at $MANIFEST" >&2; exit 1; }
MANIFEST="$MANIFEST" node --input-type=module <<'NODE'
import fs from 'node:fs';
const file = process.env.MANIFEST;
let xml = fs.readFileSync(file, 'utf8');
if (xml.includes('android:scheme="ai.pothub.app"')) { console.log('capacitor-patch: ai.pothub.app return link already present'); process.exit(0); }
const activity = xml.match(/<activity\b(?=[^>]*android:name="[^"]*MainActivity")[^>]*>/);
if (!activity) throw new Error('capacitor-patch: MainActivity not found in AndroidManifest.xml');
const at = activity.index + activity[0].length;
const filter = `
        <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="ai.pothub.app" android:host="auth" />
        </intent-filter>
`;
fs.writeFileSync(file, xml.slice(0, at) + filter + xml.slice(at));
console.log('capacitor-patch: added ai.pothub.app://auth return link to MainActivity');
NODE
