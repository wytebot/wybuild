# Secure release signing (workflow v31)

The WyBuild release key **never enters a user's repository**. A user's repo only builds the app (with a throw-away key
that exists on the runner for that one job). WyBuild's signing service then signs the finished build and verifies it.

```
user repo (wybuild-twa.yml v31)            WyBuild (Vercel)                     private signer repo
  1. authorize with ticket        ───────▶  validates ticket
  2. build, sign with throw-away key
  3. upload artifact wb-unsigned-<run>
  4. POST /api/build/complete     ───────▶  checks ticket + run (via GitHub, using the
     (ticket + the run's own token)          run's own token) + artifact; stores the token
                                             encrypted for ≤40 min; dispatches ────────▶ wybuild-sign.yml
                                  ◀── POST /api/sign/fetch (signer secret) ◀────────── 5. asks for download URL
                                  ──▶ fresh pre-signed URL (token never leaves WyBuild)
                                                                                        6. strip old signatures,
                                                                                           zipalign, apksigner v1+v2+v3,
                                                                                           jarsigner for AAB, verify
                                                                                           certificate == release key
                                  ◀── POST /api/sign/done  ◀──────────────────────────  7. upload wb-signed-… artifact
  8. runner polls /api/build/sign-status until "signed" (run goes green only when signed)
  Builds page / Release button: signed files are served from the signer repo.
```

A repo that has **its own** `WB_KEYSTORE_*` secrets (uploaded by its owner) is unchanged: it signs with that key itself
(`sign_mode=repo`). Only the WyBuild default key is remote-signed.

## One-time setup

1. **Private signer repo.** Use your WyBuild repo only if it is **private** (public repos expose artifacts and logs).
   Otherwise create a private repo, e.g. `wytzbot/wybuild-signer`. Copy into it:
   `.github/workflows/wybuild-sign.yml` and `.github/signer/sign.sh`.
2. **Signer repo → Settings → Secrets → Actions:**
   `WB_KEYSTORE_BASE64`, `WB_KEYSTORE_PASSWORD`, `WB_KEY_ALIAS`, `WB_KEY_PASSWORD` (the release key),
   `WB_APP_URL` (`https://wybuild-black.vercel.app`), `WB_SIGNER_SECRET` (random, ≥ 24 chars; same value as in Vercel).
3. **Fine-grained GitHub token** (`WB_SIGNER_TOKEN`): only the signer repo, permissions *Actions: Read and write*
   (dispatch + read artifacts) and *Metadata: Read*.
4. **Vercel env:** `WB_SIGNER_REPO` (`owner/name`), `WB_SIGNER_TOKEN`, `WB_SIGNER_SECRET`, optional `WB_SIGNER_REF`
   (default `main`). Keep the existing `WB_KEYSTORE_*` variables (WyBuild validates the key with them). Redeploy.
5. Open WyBuild → each repo → **Update workflow** (v31). Old copies of the default key that earlier versions pushed into
   repos are removed automatically on the next build (best effort; needs the user's admin access to that repo).
6. Rotate the key if you ever put it in a repo you do not fully control.

If `WB_SIGNER_*` is missing, builds that would use the default key **fail with `SIGNER_NOT_CONFIGURED`** instead of
falling back to copying the key into the repo.

## What is verified on every build (signer)

- every old signature entry is stripped, then the file is zip-aligned
- APK: `apksigner sign` with v1 + v2 + v3, then `apksigner verify` must report v1, v2, v3 = true, one signer, and the
  signer certificate SHA-256 must equal the release key's; `zipalign -c` must pass
- AAB: `jarsigner` (SHA256withRSA for RSA keys), `jarsigner -verify`, and the certificate SHA-256 must equal the release key's
- any mismatch fails the run (and the user's build run), nothing unsigned or wrongly signed is offered for download

## Limits you should know

- This protects the **key**. Whoever can edit a repo's workflow/build scripts still controls *what* gets built, and one
  shared key means all apps signed by it share a certificate. Signing is gated by a one-time ticket from the WyBuild app
  (one ticket → one signing), but it is not a review of the app's code.
- Signed files are kept 14 days on the signer repo (GitHub storage quota of that repo applies); the unsigned hand-off is
  kept 3 days in the user's repo and is hidden from WyBuild's download list.
- The TWA "does the live site trust this app" check is skipped in remote mode (it compared the throw-away key). The signed
  artifact contains `assetlinks.json` with the real certificate; `/api/twa/assetlinks` can verify the live site.
- Play App Signing: upload the signed `.aab`; list Google's app-signing SHA-256 in `assetlinks.json` as before.
