# WyBuild Flutterwave v4 webhook

The billing webhook is implemented at:

`https://wybuild-black.vercel.app/api/billing/webhook`

Configure this exact URL in the Flutterwave dashboard for the production account used by WyBuild.

## Required Vercel environment variables

- `FLW_CLIENT_ID`
- `FLW_CLIENT_SECRET`
- `FLW_ENCRYPTION_KEY`
- `FLW_SECRET_HASH`
- `FLW_V4_BASE_URL=https://f4bexperience.flutterwave.com`
- `APP_URL=https://wybuild-black.vercel.app`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`FLW_SECRET_HASH` must exactly match the secret hash configured in Flutterwave. Do not put it in frontend code.

## What happens after Flutterwave calls the webhook

1. The webhook signature is verified with `FLW_SECRET_HASH`.
2. WyBuild does **not** trust the amount/status/customer from the webhook body.
3. WyBuild retrieves the charge directly from Flutterwave v4 using the charge ID.
4. The returned charge must be `succeeded`.
5. Its reference must match a pending WyBuild transaction.
6. The amount and currency must match the pending checkout.
7. Customer/payment-method ownership is checked.
8. The subscription is activated and stored server-side.
9. The operation is idempotent, so duplicate webhook deliveries do not create duplicate subscriptions.

The browser callback and `/api/billing/status` remain as reconciliation fallbacks if a webhook arrives late.

## Important

After deploying, make one small sandbox/test payment and confirm the Vercel function log contains no `Invalid signature` or `Flutterwave webhook reconciliation failed` errors. Do not paste secret keys into the repository.
