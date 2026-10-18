# Release signing secrets (repository Actions secrets)

WyBuild synchronizes the configured default Android release key from its Vercel environment into each target repository's GitHub Actions secrets before every build and when the workflow is installed. GitHub encrypts each secret with the repository's Actions public key; raw credentials are never sent to the browser and are never committed as repository files. When the default key is configured, it intentionally replaces the target repository's `WB_KEYSTORE_*` secrets so all builds use the same signing identity.

## Required WyBuild Vercel environment variables

Set these four variables in the WyBuild Vercel project and redeploy:

- `WB_KEYSTORE_BASE64` — Base64-encoded `.jks` or `.p12` release keystore (must fit GitHub's 48 KB secret limit).
- `WB_KEYSTORE_PASSWORD` — keystore password.
- `WB_KEY_ALIAS` — case-sensitive alias.
- `WB_KEY_PASSWORD` — key password (may be the same as the keystore password).

WyBuild uses the authenticated GitHub session to write these as repository Actions secrets. The signed build workflow consumes them directly. The user must have sufficient repository permissions to manage Actions secrets, and the repository must allow GitHub Actions.

## Every-build behavior

- Before every build, WyBuild validates the configured default keystore and writes all four secret values to the selected repository.
- Key rotation in Vercel is propagated automatically on the next build.
- If the default key is not configured, WyBuild can use a complete repository-owned signing key; it will not overwrite a repository key when no valid WyBuild default key is configured.
- The shared default key means every app built with it has the same signing certificate. Keep the Vercel variables private and only build repositories you trust.
- A secret write failure is surfaced as an error rather than silently proceeding with stale credentials.

The `WB_SIGNER_REPO`, `WB_SIGNER_TOKEN`, and `WB_SIGNER_SECRET` variables are no longer required for this repository-secret signing flow.
