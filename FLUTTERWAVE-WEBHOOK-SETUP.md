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


## Kivora Ad Studio payments

WyBuild's same authenticated Flutterwave v4 webhook also handles Kivora campaign payments. Configure these additional **WyBuild** environment variables:

- `KIVORA_PAYMENT_CONFIRM_URL=https://YOUR-KIVORA-DOMAIN/api/wybuild-payment-confirmation`
- `KIVORA_WEBHOOK_SHARED_SECRET=<long-random-secret>`

Set the exact same secret in Kivora as `WYBUILD_WEBHOOK_SHARED_SECRET`. Keep it server-side in both deployments. When a KIVORA reference arrives, WyBuild verifies the webhook signature, fetches the charge directly from Flutterwave v4, and forwards only the authoritative charge fields to Kivora over HTTPS. Kivora matches the reference and exact NGN amount against its stored campaign before activating it. Do **not** configure Kivora's own `/api/flutterwave-webhook` as a second Flutterwave webhook for this flow; configure Flutterwave to call WyBuild's `/api/billing/webhook` endpoint.


## WyCut recap purchases (same webhook, Flutterwave v4)

Use the same WyBuild webhook URL in Flutterwave:
`https://wybuild-black.vercel.app/api/billing/webhook`

Set these **in WyBuild's Vercel project**:
- `WYCUT_PAYMENT_CONFIRM_URL=https://YOUR-WYCUT-DOMAIN/api/wybuild-payment-confirmation`
- `WYCUT_WEBHOOK_SHARED_SECRET=<long random secret>`

Set the exact same secret in WyCut as `WYBUILD_WEBHOOK_SHARED_SECRET`. WyBuild authenticates with the existing v4 OAuth credentials (`FLW_CLIENT_ID`, `FLW_CLIENT_SECRET`), retrieves the charge directly from Flutterwave, and forwards only a successful authoritative charge. WyCut verifies the shared secret and matches reference, provider transaction ID, NGN amount/currency and customer email to the stored order before granting credits. Keep the direct WyCut Flutterwave webhook disabled if using this single-webhook arrangement; do not configure two competing webhook receivers for the same merchant event.
