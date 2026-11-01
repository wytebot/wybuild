# WyBuild webhook integration changes

- Extended the existing `POST /api/billing/webhook` reconciliation to recognize PotHub references (`kh` + 32 hex characters).
- WyBuild retrieves the charge from Flutterwave v4 before forwarding settlement fields.
- Added a strict webhook-reference/charge-reference consistency check.
- Added `POTHUB_PAYMENT_CONFIRM_URL` and `POTHUB_WEBHOOK_SHARED_SECRET` documentation.
- Added `tests/pothub-webhook-forwarding.test.mjs`.
- Flutterwave still uses the existing WyBuild webhook URL; no second merchant webhook is needed.
- Live sandbox settlement and Vercel env configuration still require testing.
