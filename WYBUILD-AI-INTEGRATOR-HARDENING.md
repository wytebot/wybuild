# WyBuild AI Integrator hardening

## Implemented
- API integrations are now staged as Git blobs, assembled into one Git tree, committed once, and applied with a single non-force branch-ref update. This prevents the previous per-file partial-commit behavior.
- The branch head is checked before commit and rechecked before updating the ref; stale branches fail without applying the change set.
- If GitHub's branch-update response is lost, WyBuild checks the ref before deciding whether the commit landed. When the outcome cannot be verified, the endpoint returns `INTEGRATION_COMMIT_UNCERTAIN` and retains the charge to avoid a free/duplicate commit race.
- Failed integrations attempt a bounded credit refund retry and log a critical error if refunding still fails.
- Added allowlisted, Capacitor-major-matched dependency installation for Camera, Share, Filesystem, Geolocation, Local Notifications, Device, Network, Haptics, and Clipboard. Dependencies are only included in the atomic commit when a corresponding source integration was also accepted.
- Integration code cannot introduce imports for undeclared third-party packages unless WyBuild is adding the relevant allowlisted Capacitor package in the same commit.
- Added Device Information, Network Status, Haptics, and Clipboard choices to the UI.
- The result view now displays detected capabilities and verification checks, and explicitly states that a commit is not proof of a successful build/device runtime.

## Safety / compatibility behavior
- Automatic native package addition is limited to detected Capacitor 5, 6, or 7 projects. Unknown or missing manifests get setup instructions instead of guessed package versions.
- Push notifications and provider-backed integrations still require the correct external configuration (for example Firebase project files, credentials, or a backend); WyBuild does not fabricate credentials.
- Existing lockfiles are not rewritten by AI. The current build workflow attempts `npm ci` and falls back to `npm install` if the lockfile is out of sync.
- The AI can only edit existing application source files. Android signing, secrets, workflows, lockfiles, and native project files remain outside the AI's editable file set.

## Checks performed in this environment
- `node --check api/index.js` passed.
- `python -m py_compile workflow/wybuild/capacitor-finalize.py` passed.
- Full Vite/TypeScript and Android Gradle builds were not run because dependencies are not installed in this environment and network access is unavailable. A live GitHub integration test and physical-device verification are still required before production claims.
