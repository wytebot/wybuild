# WyBuild AI Integration Reliability Update

## What this update changes

- Integration edits are written as one Git data-tree commit. WyBuild no longer commits generated files one at a time, so a later file failure cannot leave an intentionally partial set of source edits.
- The target branch is pinned before analysis and checked again before the update. A concurrent branch change aborts the operation.
- `package.json` may be changed only to add the small allowlist of packages associated with the selected integration. Existing dependencies, scripts, metadata, lockfiles, and arbitrary package additions are rejected.
- Automatic Capacitor plugin installation is limited to projects declaring Capacitor 7. Plugin dependencies are added to `package.json`; the WyBuild build workflow installs dependencies and runs Capacitor sync. Other Capacitor major versions receive a clear error instead of an unsafe edit.
- The integration response shows validation notes and explicitly states that a source commit is not proof of a successful build or working runtime feature.
- Credit adjustment is recorded only after the additional debit succeeds, preventing an over-refund if a top-up debit is rejected.
- Credits are not refunded after WyBuild knows the GitHub branch update succeeded.

## Scope and honest limitations

This automation does not create provider accounts, Firebase projects, backend services, API keys, or notification credentials. It does not claim an integration is verified until a separate build and device test is completed. A repository may still need app-specific UI wiring, platform permissions, or provider configuration. Push notifications in particular require a configured Firebase/FCM delivery path; installing the Capacitor package alone is insufficient.

## Verification performed for this archive

- `node --check api/index.js` passed.
- TypeScript transpile/syntax checks passed for 32 `.ts`/`.tsx` files.
- A full Vite/TypeScript dependency-aware build was not run because dependencies could not be installed in this environment. Deploy to a test branch and run a complete WyBuild build before production rollout.
