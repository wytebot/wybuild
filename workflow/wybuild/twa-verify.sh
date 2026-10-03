#!/usr/bin/env bash
# WyBuild TWA - step 5: store-readiness checks for the final APK (APKMirror / Uptodown style hosting).
# Usage: twa-verify.sh <apk> <out-dir> <strict:true|false>
# These are technical hygiene checks. Neither site publishes a guarantee: both review uploads by hand.
set -uo pipefail
APK="$1"; OUT="$2"; STRICT="${3:-false}"
BT="$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V | tail -1)"
[ -n "$BT" ] || { echo "::error::Android build-tools not found"; exit 1; }
errors=0; warns=0; rows=""
add() { # level id message
  local lvl="$1" id="$2" msg="$3"
  case "$lvl" in ok) ;; warn) warns=$((warns+1)); echo "::warning::$id: $msg";; error) errors=$((errors+1)); echo "::error::$id: $msg";; esac
  rows="$rows{\"level\":\"$lvl\",\"id\":\"$id\",\"msg\":\"${msg//\"/\\\"}\"},"
  echo "$lvl  $id  $msg"
}

BADGING="$("$BT/aapt2" dump badging "$APK" 2>/dev/null || "$BT/aapt" dump badging "$APK" 2>/dev/null)"
PKG="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<<"$BADGING" | head -1)"
VCODE="$(sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" <<<"$BADGING" | head -1)"
VNAME="$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<<"$BADGING" | head -1)"
TSDK="$(sed -n "s/^targetSdkVersion:'\([0-9]*\)'.*/\1/p" <<<"$BADGING" | head -1)"
MSDK="$(sed -n "s/^sdkVersion:'\([0-9]*\)'.*/\1/p" <<<"$BADGING" | head -1)"
LABEL="$(sed -n "s/^application-label:'\(.*\)'$/\1/p" <<<"$BADGING" | head -1)"

[ -n "$PKG" ] && add ok package "Package $PKG, version $VNAME ($VCODE)" || add error package "Could not read the package name from the APK"
[ -n "$LABEL" ] && add ok label "App label: $LABEL" || add error label "APK has no application label"
grep -q "application-debuggable" <<<"$BADGING" && add error debuggable "APK is debuggable; hosting sites reject debug builds" || add ok debuggable "Not debuggable"
grep -q "testOnly" <<<"$BADGING" && add error testonly "APK is marked testOnly" || add ok testonly "Not testOnly"
[ "${TSDK:-0}" -ge 34 ] && add ok target-sdk "targetSdkVersion $TSDK" || add warn target-sdk "targetSdkVersion ${TSDK:-?} is low; Android 14+ may show a compatibility warning when installing"
grep -q "application-icon" <<<"$BADGING" && add ok icon "Launcher icon present" || add error icon "No launcher icon in APK"

SIGN="$("$BT/apksigner" verify --verbose --print-certs "$APK" 2>&1)"; SRC=$?
if [ $SRC -eq 0 ]; then add ok signature "apksigner verification passed"; else add error signature "apksigner verify failed: $(head -c 300 <<<"$SIGN")"; fi
grep -q "Verified using v2 scheme (APK Signature Scheme v2): true\|Verified using v3 scheme (APK Signature Scheme v3): true" <<<"$SIGN" \
  && add ok sig-scheme "APK Signature Scheme v2/v3 present" || add error sig-scheme "APK is not signed with v2/v3 (required for Android 11+ installs)"
grep -qi "CN=Android Debug" <<<"$SIGN" && add error debug-cert "Signed with the Android debug certificate; mirrors need your own release key" || add ok debug-cert "Not signed with the debug certificate"
FP="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<<"$SIGN" | head -1)"
[ -n "$FP" ] && add ok fingerprint "Signing certificate SHA-256: $FP" || add warn fingerprint "Could not read the signing fingerprint"
if [ -n "${WB_EXPECTED_FP:-}" ] && [ -n "$FP" ]; then
  norm() { tr -d ':' <<<"$1" | tr 'A-F' 'a-f'; }
  [ "$(norm "$FP")" = "$(norm "$WB_EXPECTED_FP")" ] \
    && add ok key-continuity "Signing key matches the fingerprint of your previous releases" \
    || add error key-continuity "Signing key differs from the expected fingerprint; APKMirror/Uptodown and Android reject updates signed with a different key"
fi
"$BT/zipalign" -c -P 16 4 "$APK" >/dev/null 2>&1 || "$BT/zipalign" -c 4 "$APK" >/dev/null 2>&1 \
  && add ok zipalign "APK is zip-aligned" || add error zipalign "APK is not zip-aligned"
SIZE=$(stat -c%s "$APK"); add ok size "APK size $((SIZE/1024)) KB"

# Digital Asset Links: without it Chrome shows the URL bar inside the app (it falls back to a Custom Tab)
if [ -n "${WB_HOST:-}" ] && [ -n "$PKG" ]; then
  AL="$(curl -fsSL --max-time 15 "https://$WB_HOST/.well-known/assetlinks.json" 2>/dev/null || true)"
  if grep -q "$PKG" <<<"$AL" && { [ -z "$FP" ] || grep -qi "$FP" <<<"$AL"; }; then add ok assetlinks "https://$WB_HOST/.well-known/assetlinks.json lists $PKG with this key"
  else add warn assetlinks "https://$WB_HOST/.well-known/assetlinks.json does not yet contain $PKG and this fingerprint; upload the generated assetlinks.json or the app will show a browser URL bar"; fi
fi

mkdir -p "$OUT"
printf '{"package":"%s","versionName":"%s","versionCode":"%s","fingerprint":"%s","errors":%d,"warnings":%d,"checks":[%s]}\n' \
  "$PKG" "$VNAME" "$VCODE" "$FP" "$errors" "$warns" "${rows%,}" > "$OUT/store-readiness.json"
{
  echo "# Store-readiness report"; echo
  echo "- Package: \`$PKG\`  Version: \`$VNAME ($VCODE)\`  minSdk/targetSdk: \`${MSDK:-?}/${TSDK:-?}\`"
  echo "- Signing certificate SHA-256: \`$FP\`"; echo "- Errors: $errors, warnings: $warns"; echo
  echo "| Result | Check | Detail |"; echo "|---|---|---|"
  echo "[${rows%,}]" | python3 -c 'import sys,json
for c in json.load(sys.stdin): print("| %s | %s | %s |" % ({"ok":"pass","warn":"warn","error":"FAIL"}[c["level"]], c["id"], c["msg"].replace("|","/")))'
  echo; echo "> APKMirror and Uptodown review every upload manually and may decline apps that are new, unpopular or not unique. This report only confirms the file is technically well-formed."
} > "$OUT/store-readiness.md"

echo "WYBUILD_PACKAGE=$PKG"; echo "WYBUILD_VERSION=$VNAME ($VCODE)"; echo "WYBUILD_FINGERPRINT=$FP"
if [ "$errors" -gt 0 ] && [ "$STRICT" = "true" ]; then echo "::error::Store-ready mode: $errors blocking problem(s)"; exit 1; fi
exit 0
