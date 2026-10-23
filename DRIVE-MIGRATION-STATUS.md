# Google Drive storage hardening status

This revision hardens the Dev Studio folder selection and history synchronization path:

- Folder selection checks the folder type and available capabilities, performs a temporary create/delete write probe, and asks for confirmation before switching an existing destination.
- History sync reads the current Drive history before writing, validates the JSON schema, merges build/project records by stable `id`, and refuses to overwrite malformed or unsupported history.
- The history export uses an explicit allowlist of non-secret fields. It excludes credentials, payment data, balances, access tokens, signing material, and build step logs.
- Failed reads/writes leave the previous destination selected and report actionable errors.

## Remaining production prerequisites / limitations

- `VITE_GOOGLE_DRIVE_CLIENT_ID` must be configured for the deployed origin and the Google OAuth consent/scope must be approved for the intended distribution.
- This patch does not claim a completed Supabase migration. Existing Firebase integrations must be audited and migrated endpoint-by-endpoint with production credentials and schema validation; removing them blindly could break authentication, notifications, or build operations.
- The current Build Pipeline History screen still relies on the application's existing in-memory/GitHub build list. To make Drive the authoritative source for historical rows across all screens, that UI and its data model must be integrated with Drive history and tested end-to-end; this patch does not falsely mark that migration complete.
- Google Drive cannot replace the authoritative server-side ledger for credits/payments or GitHub's live workflow status.
- Full build/runtime tests were not run in this environment because dependency installation did not complete. Validate in CI before deploying.


## Storage fallback hardening (v26)

- Firestore remains the primary KV store. `lib/kv.js` detects quota/resource-exhaustion errors and transparently retries the operation against Supabase RPC functions; subsequent KV calls on that warm serverless instance use Supabase for a cooldown window (default 120 seconds). The fallback is server-side only and emits server logs rather than a user-facing popup.
- Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel and run `supabase/schema.sql` before deploying. The SQL functions must be available to `service_role`. Do not expose the service-role key as a `VITE_` variable.
- Drive GET requests now retry transient 429/5xx responses with bounded backoff; mutations are not blindly retried to avoid duplicate files or writes. Switching the active Drive folder no longer uses a blocking browser confirm; the old folder is left untouched.
- Important limitation: failover is per warm serverless instance and does not automatically copy existing Firestore-only records into Supabase. To preserve all pre-existing user/payment/credit/build state, perform a one-time verified export/migration into Supabase before relying on failover. Cross-provider atomic transactions are impossible; verify payment/credit idempotency under simulated quota failures before production.
