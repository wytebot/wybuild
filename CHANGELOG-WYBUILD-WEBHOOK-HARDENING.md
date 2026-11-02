# WyBuild Flutterwave webhook hardening

- Kept WyBuild's existing `/api/billing/webhook` as the single registered Flutterwave webhook; did not create a second merchant webhook.
- Fail closed with HTTP 503 when `FLW_SECRET_HASH` is missing and HTTP 401 for an invalid signature.
- Verify the legacy `verif-hash` with timing-safe comparison, or verify `flutterwave-signature` against the exact raw request bytes. Parsed JSON is never re-serialized and treated as signed bytes.
- Reject webhook payloads that contain neither a charge ID nor a transaction reference.
- Require the direct Flutterwave v4 charge lookup to return an authoritative ID and reference; reject ID/reference mismatches before activating WyBuild plans, credit packs, or forwarding settlements to connected apps.
- Preserve existing server-side amount, currency, customer/payment-method, reference and succeeded-status checks; connected apps receive only fields from the verified v4 charge and must independently reconcile the pending order.
- Keep failed downstream reconciliation retryable with a non-2xx response; existing per-reference idempotency remains the protection against duplicate credit grants.
- Added static regression tests for signature and charge identity checks.

## Verification

- `node --check api/index.js` passed.
- Focused webhook/credit-security tests passed.
- Full build, full test suite, live Flutterwave sandbox, deployed Vercel webhook delivery, and connected-app confirmation endpoints were not run here. Do not consider production payment verification fully certified until those checks pass.
