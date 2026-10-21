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
