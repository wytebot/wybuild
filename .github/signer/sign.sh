#!/usr/bin/env bash
# WyBuild signing service. Runs ONLY in the private WyBuild repository, where the release keystore lives as Actions
# secrets. It downloads the unsigned build produced in a user's repo, signs it, verifies the result against the
# expected certificate and leaves the signed files in $SIGN_OUT for upload. The user's repository never sees the key.
#
# Treat the downloaded artifact as untrusted DATA: it is unzipped and signed, never executed.
set -euo pipefail

: "${WB_APP_URL:?}" "${WB_SIGNER_SECRET:?}" "${SIGN_REPO:?}" "${SIGN_RUN_ID:?}"
WORK="${RUNNER_TEMP:-/tmp}/wb-sign"; rm -rf "$WORK"; mkdir -p "$WORK/in" "$WORK/work"
SIGN_OUT="${SIGN_OUT:-$WORK/out}"; mkdir -p "$SIGN_OUT"
ERRFILE="${RUNNER_TEMP:-/tmp}/sign-error.txt"; : > "$ERRFILE"

fail() { echo "::error::$*"; printf '%s' "$*" > "$ERRFILE"; exit 1; }

[[ "$SIGN_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "Invalid repository name."
[[ "$SIGN_RUN_ID" =~ ^[0-9]+$ ]] || fail "Invalid run id."

# ---------------------------------------------------------------- 1. ask WyBuild for the unsigned build
jq -n --arg repo "$SIGN_REPO" --arg run "$SIGN_RUN_ID" '{repo:$repo, runId:$run}' > "$WORK/fetch-req.json"
CODE="$(curl -sS --retry 3 --retry-delay 3 --retry-all-errors -m 60 -o "$WORK/fetch-resp.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $WB_SIGNER_SECRET" \
  --data @"$WORK/fetch-req.json" "${WB_APP_URL%/}/api/sign/fetch" || echo 000)"
if [ "$CODE" != "200" ]; then
  MSG="$(jq -r '.error // empty' "$WORK/fetch-resp.json" 2>/dev/null || true)"
  fail "WyBuild refused to release the unsigned build (HTTP $CODE). ${MSG:-}"
fi
DL_URL="$(jq -r '.downloadUrl // empty' "$WORK/fetch-resp.json")"
case "$DL_URL" in https://*) ;; *) fail "WyBuild returned no download URL for the unsigned build." ;; esac
echo "::add-mask::$DL_URL"

# ---------------------------------------------------------------- 2. download + unpack (data only)
curl -fsSL --retry 3 --retry-delay 3 --retry-all-errors -m 600 -o "$WORK/unsigned.zip" "$DL_URL" \
  || fail "Could not download the unsigned build from GitHub."
BYTES="$(wc -c < "$WORK/unsigned.zip" | tr -d ' ')"
[ "$BYTES" -gt 1024 ] || fail "The unsigned build download is only $BYTES bytes."
# zip-bomb guard: refuse anything that expands beyond 700 MB
TOTAL="$(unzip -Z -t "$WORK/unsigned.zip" 2>/dev/null | awk '/files?,/ {print $3}' | head -1 || true)"
if [ -n "${TOTAL:-}" ] && [ "$TOTAL" -gt 734003200 ] 2>/dev/null; then fail "The unsigned build expands to more than 700 MB."; fi
unzip -q -o "$WORK/unsigned.zip" -d "$WORK/in" || fail "The unsigned build is not a readable zip file."
# never follow links an attacker could plant in the archive
find "$WORK/in" -type l -delete

mapfile -t APKS < <(find "$WORK/in" -type f -name '*.apk' | sort)
mapfile -t AABS < <(find "$WORK/in" -type f -name '*.aab' | sort)
[ $(( ${#APKS[@]} + ${#AABS[@]} )) -gt 0 ] || fail "The unsigned build contains no .apk or .aab file."

# ---------------------------------------------------------------- 3. prepare the release key (secrets stay in this job)
: "${WB_KEYSTORE_B64:?The WB_KEYSTORE_BASE64 secret is missing in the WyBuild signing repository.}"
KS="$WORK/release.jks"
B64_CLEAN="$(printf '%s' "$WB_KEYSTORE_B64" | tr -d '[:space:]')"
printf '%s' "$B64_CLEAN" | base64 --decode > "$KS" 2>/dev/null || fail "WB_KEYSTORE_BASE64 is not valid Base64."
if ! LC_ALL=C grep -qavE '^[A-Za-z0-9+/=[:space:]]*$' "$KS"; then   # Base64 text that was Base64-encoded twice
  if tr -d '[:space:]' < "$KS" | base64 --decode > "$KS.inner" 2>/dev/null && [ -s "$KS.inner" ]; then mv "$KS.inner" "$KS"; fi
fi
[ "$(wc -c < "$KS" | tr -d ' ')" -ge 256 ] || fail "The decoded release keystore is too small; it is truncated or the wrong secret."
ALIAS="$WB_KEY_ALIAS"; export SPASS="$WB_KEYSTORE_PASSWORD"; export KPASS="${WB_KEY_PASSWORD:-$WB_KEYSTORE_PASSWORD}"
echo "::add-mask::$SPASS"; echo "::add-mask::$KPASS"
KT="$(keytool -list -v -keystore "$KS" -alias "$ALIAS" -storepass "$SPASS" 2>&1)" \
  || fail "The release keystore cannot be opened with the stored password/alias (keytool: $(printf '%s' "$KT" | head -1))."
EXPECT_FP="$(printf '%s\n' "$KT" | sed -n 's/^[[:space:]]*SHA-\{0,1\}256:[[:space:]]*//p' | head -1 | tr -d '\r')"
[ -n "$EXPECT_FP" ] || fail "Could not read the SHA-256 fingerprint of the release certificate."
EXPECT_HEX="$(printf '%s' "$EXPECT_FP" | tr -d ':' | tr 'A-F' 'a-f')"
KEYALG_RSA=false; printf '%s\n' "$KT" | grep -qiE 'Key Algorithm:.*RSA|Public Key Algorithm:.*RSA' && KEYALG_RSA=true
echo "Release certificate SHA-256: $EXPECT_FP"

# ---------------------------------------------------------------- 4. tools from the runner's Android SDK
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$BT" ] && [ -x "$BT/apksigner" ] && [ -x "$BT/zipalign" ] || fail "Android build-tools (apksigner/zipalign) were not found on this runner."
export PATH="$BT:$PATH"
command -v jarsigner >/dev/null || fail "jarsigner was not found (a full JDK is required)."
ALIGN=(-p); ZA_HELP="$(zipalign 2>&1 || true)"
case "$ZA_HELP" in *" -P "*) ALIGN=(-P 16) ;; esac

# a throw-away signature from the build runner must never survive: remove every old signature entry first
strip_sigs() { zip -q -d "$1" 'META-INF/MANIFEST.MF' 'META-INF/*.SF' 'META-INF/*.RSA' 'META-INF/*.DSA' 'META-INF/*.EC' >/dev/null 2>&1 || true; }

REPORT="$SIGN_OUT/signing-report.md"
{ echo "# WyBuild signing report"; echo; echo "- Signed by: WyBuild signing service (release key kept outside your repository)"; echo "- Certificate SHA-256: \`$EXPECT_FP\`"; } > "$REPORT"
PKG=""

# ---------------------------------------------------------------- 5. sign + verify every APK
for src in "${APKS[@]}"; do
  base="$(basename "$src")"; cp "$src" "$WORK/work/$base"; f="$WORK/work/$base"
  strip_sigs "$f"
  zipalign -f "${ALIGN[@]}" 4 "$f" "$WORK/work/aligned.apk" || fail "zipalign failed for $base."
  apksigner sign --ks "$KS" --ks-key-alias "$ALIAS" --ks-pass env:SPASS --key-pass env:KPASS \
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
    --out "$SIGN_OUT/$base" "$WORK/work/aligned.apk" < /dev/null || fail "apksigner could not sign $base."
  rm -f "$WORK/work/aligned.apk" "$SIGN_OUT/$base.idsig"
  V="$(apksigner verify --verbose --print-certs "$SIGN_OUT/$base" 2>&1)" || fail "apksigner verification failed for $base: $(printf '%s' "$V" | head -2)"
  for s in "v1 scheme (JAR signing)" "v2 scheme (APK Signature Scheme v2)" "v3 scheme (APK Signature Scheme v3)"; do
    printf '%s\n' "$V" | grep -qF "Verified using $s: true" || fail "$base is missing the ${s%% *} signature after signing."
  done
  printf '%s\n' "$V" | grep -q 'Number of signers: 1' || fail "$base does not have exactly one signer."
  GOT="$(printf '%s\n' "$V" | sed -n 's/^Signer #1 certificate SHA-256 digest: *//p' | head -1 | tr -d ':' | tr 'A-F' 'a-f')"
  [ "$GOT" = "$EXPECT_HEX" ] || fail "$base is signed with an unexpected certificate ($GOT). The throw-away build key was not replaced."
  zipalign -c "${ALIGN[@]}" 4 "$SIGN_OUT/$base" || fail "$base is not properly zip-aligned."
  echo "- \`$base\`: APK Signature Scheme v1 + v2 + v3 verified, certificate matches, zip-aligned" >> "$REPORT"
  [[ "$base" =~ ^(.+)_[^_]+_[0-9]+\.apk$ ]] && PKG="${BASH_REMATCH[1]}"
done

# ---------------------------------------------------------------- 6. sign + verify every AAB
for src in "${AABS[@]}"; do
  base="$(basename "$src")"; cp "$src" "$SIGN_OUT/$base"; f="$SIGN_OUT/$base"
  strip_sigs "$f"
  JARARGS=(); [ "$KEYALG_RSA" = true ] && JARARGS=(-sigalg SHA256withRSA -digestalg SHA-256)
  jarsigner -keystore "$KS" -storepass:env SPASS -keypass:env KPASS "${JARARGS[@]}" "$f" "$ALIAS" < /dev/null >/dev/null 2>"$WORK/jarsigner.err" \
    || fail "jarsigner could not sign $base: $(head -2 "$WORK/jarsigner.err")"
  JV="$(jarsigner -verify -certs "$f" 2>&1)" || fail "jarsigner verification failed for $base."
  printf '%s\n' "$JV" | grep -q '^jar verified' || fail "$base did not verify as a signed bundle."
  GOT="$(keytool -printcert -jarfile "$f" 2>/dev/null | sed -n 's/^[[:space:]]*SHA-\{0,1\}256:[[:space:]]*//p' | head -1 | tr -d ':\r' | tr 'A-F' 'a-f')"
  [ "$GOT" = "$EXPECT_HEX" ] || fail "$base is signed with an unexpected certificate ($GOT)."
  echo "- \`$base\`: App Bundle signature verified, certificate matches" >> "$REPORT"
  [[ "$base" =~ ^(.+)_[^_]+_[0-9]+\.aab$ ]] && PKG="${BASH_REMATCH[1]}"
done

# ---------------------------------------------------------------- 7. companion files (nothing key-dependent is copied from the build)
while IFS= read -r -d '' f; do
  n="$(basename "$f")"
  case "$n" in *.apk|*.aab|assetlinks.json|store-readiness.md|apksigner.txt|jarsigner.txt|fullscreen-check.md|signing-report.md|SHA256SUMS.txt) continue ;; esac
  [ -e "$SIGN_OUT/$n" ] || cp "$f" "$SIGN_OUT/$n"
done < <(find "$WORK/in" -type f -print0)
if [[ "$PKG" =~ ^[A-Za-z][A-Za-z0-9_.]*$ ]]; then
  jq -n --arg pkg "$PKG" --arg fp "$EXPECT_FP" \
    '[{relation:["delegate_permission/common.handle_all_urls"], target:{namespace:"android_app", package_name:$pkg, sha256_cert_fingerprints:[$fp]}}]' > "$SIGN_OUT/assetlinks.json"
  echo "- Digital Asset Links for the Trusted Web Activity shell: \`assetlinks.json\` lists this certificate for \`$PKG\`" >> "$REPORT"
fi
( cd "$SIGN_OUT" && sha256sum -- *.apk *.aab 2>/dev/null > SHA256SUMS.txt || true )
echo "SIGN_FINGERPRINT=$EXPECT_FP" >> "${GITHUB_ENV:-/dev/null}"
{ echo "## WyBuild signing"; cat "$REPORT"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "Signing finished: ${#APKS[@]} APK(s), ${#AABS[@]} AAB(s)."
