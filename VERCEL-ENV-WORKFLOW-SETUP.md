# WyBuild workflow: Vercel Production environment

The Android workflow now pulls the Vercel **Production** environment before compiling the web app, then exposes the two public configuration values under both Next.js and Vite names:

- `NEXT_PUBLIC_API_BASE_URL` and `VITE_API_BASE_URL`
- `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `VITE_GOOGLE_WEB_CLIENT_ID`

For each setting, precedence is: **non-empty Vercel Production value → GitHub repository Actions secret → GitHub repository variable → project configuration fallback**. If Vercel has no value (or no Vercel token is configured), the matching repository secret is used automatically before repository variables. The API URL must be a public HTTPS URL; it is not a place for service-account credentials or private keys.

## One-time GitHub setup

GitHub Actions cannot read a Vercel project's environment just because the app is deployed on Vercel. Configure these in the GitHub repository that contains the workflow:

1. **Actions secret** `VERCEL_TOKEN`: a Vercel access token with access to the relevant project.
2. **Actions variable** `VERCEL_ORG_ID`: the Vercel team/user organization ID.
3. **Actions variable** `VERCEL_PROJECT_ID`: the Vercel project ID for the app whose Production environment should be read.

The workflow also accepts `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as GitHub secrets. If the repository already contains `.vercel/project.json`, its IDs are used as a fallback. The token is scoped only to the environment-resolution step, and the pulled env file is deleted before the application build script runs.

When `VERCEL_TOKEN` is configured but the IDs are missing or Vercel denies access, the build stops with an actionable error instead of silently building with stale configuration. When no token is configured, it warns and uses the repository secret first, then repository variables and the existing project-config fallback. For API base URL, accepted secret names are `NEXT_PUBLIC_API_BASE_URL`, `VITE_API_BASE_URL`, or `API_BASE_URL`. For the Google web client ID, accepted secret names are `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `VITE_GOOGLE_WEB_CLIENT_ID`, or `GOOGLE_WEB_CLIENT_ID`. Store these as GitHub Actions **Secrets** in the target repository. These are public client configuration values, not private service-account keys.

## Standalone WyBuild authentication

The standalone app remains a locally bundled Capacitor app (no `server.url` pointing at the live website). WyBuild's existing native authentication path is preserved: it calls the deployed API using `API_BASE`, opens the server's GitHub OAuth flow in the system browser, and returns via the `wybuild://auth` deep-link/PKCE handoff. The runtime API base is injected before the app modules load, so native requests do not accidentally target `https://localhost/api`.

## Validation changes

- The generated runtime config is referenced as `/wybuild-runtime-config.js`, not `./wybuild-runtime-config.js`.
- Both the copied Android assets and final APK must contain the runtime config and native bridge.
- The compatibility analyzer now ignores directory names by path segment. It no longer mistakes the runner workspace path `/.../wybuild/wybuild/...` for a directory that should be excluded, and a zero-file scan is reported as inconclusive/amber instead of green.
- Same-origin API guidance points to WyBuild Help's existing **Backend & sign-in survival settings** section. It is informational, not an automatic build blocker.
