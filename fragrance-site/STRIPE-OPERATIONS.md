# FABREVOIE Stripe operations

The website uses Stripe-hosted Checkout for one-time ULTRA MACHO purchases, with automatic tax and signed payment/refund updates. Shopify is not required by this application. The public launch list continues to work independently.

## Current state

- The supplied live key authenticates to **Fabrevoie**, `acct_1UEGS7EdyIZnMwR6`, France/EUR. Stripe reports charges and payouts enabled. This verifies account capability, not a completed website purchase.
- `COMMERCE_MODE=disabled` keeps purchases hidden and refuses new checkout sessions. Turning sales off preserves webhook processing and private order-status reads.
- Live Product `prod_VEljNNJKpZUuBy` and Price `price_1UEICIEdyIZnMwR6BSfHWM8j` are created for **ULTRA MACHO / 100 ml**, **€129.99**, Made in Paris. Price tax behavior remains unspecified pending confirmation of inclusive/exclusive VAT.
- Live webhook `we_1UEICJEdyIZnMwR6us6HQIHH` targets `https://fabrevoie.com/api/stripe-webhook` with the eight supported Checkout/refund event types. Production uses the matching live configuration while preview retains sandbox credentials; [LIVE-STRIPE-SETUP.md](LIVE-STRIPE-SETUP.md) records deployment verification and the old sandbox endpoint transition.
- API keys, webhook signing secrets and the separate order-token secret stay private. Hosted redirects do not use the publishable key. The local `.env.local` remains sandbox-only; the private `.env.stripe-live.local` is loaded explicitly for live operations.
- Live Stripe Tax settings are active. The existing head-office address and default tax code `txcd_30011000` were left unchanged. There are zero active tax registrations; the owner's actual registrations and obligations must determine the next configuration. No registration or stock quantity has been invented.
- Stripe's canonical Tax Codes API lists perfume under **Cosmetics - Beautifying**, `txcd_32050025`. This is the proposed classification for owner confirmation; it has not been assigned.

Implementation and scope are described in [STRIPE-INTEGRATION-PLAN.md](STRIPE-INTEGRATION-PLAN.md).

The earlier [STRIPE-VERIFICATION.md](STRIPE-VERIFICATION.md) remains a historical record of production and real sandbox webhook checks on 11 September 2026. Paid Checkout and Tax calculation are still pending; the live transition record does not replace that evidence.

## Private commands

From this directory, inspect local sandbox configuration without printing credentials or customer data:

```powershell
npm run stripe:status
node --env-file=.env.local scripts/stripe-readiness.mjs --tax-codes
```

For an explicit local live check, use `node --env-file=.env.stripe-live.local scripts/stripe-readiness.mjs`. The readiness command is read-only. Exit code 2 means configuration still needs attention. It does not certify tax obligations, successful tax calculation or completed payment. Local environment files do not automatically contain Vercel's database variables; missing local database configuration is distinct from deployed storage readiness.

To inspect the deployed configuration, use `npx vercel@59.15.1 env run --cwd tests --project fabrevoie --environment production --scope puppetmaster666s-projects -- node --import ../scripts/load-live-env.mjs ../scripts/stripe-readiness.mjs`. Using the `tests` working directory avoids overlaying the sandbox `.env.local` onto production settings. The explicit preload supplies locally retained live credentials because Vercel does not export sensitive values. It preserves cloud configuration and the disabled sales switch, and refuses conflicting catalog IDs. Live inventory/reconciliation commands use the same working directory and preload.

Review the deployed orders from the connected Vercel environment:

```powershell
npx vercel@59.15.1 env run --environment production --scope puppetmaster666s-projects -- node scripts/commerce-orders.mjs --cloud
```

This prints payment state, amount, quantity, order reference and Stripe payment links for the most recent 25 orders. It does not print customer contact or delivery information. Add `--export` to write those fulfillment details to a new JSON file inside the ignored private `data/` directory. Exports refuse public/dist paths and existing files, omit internal access tokens and never report an incomplete export as complete.

Without `--cloud`, the order command reads only local `data/commerce.sqlite`. It refuses to silently substitute an empty local database for unavailable cloud storage. The cloud tables are `fabrevoie_commerce_orders`, `fabrevoie_commerce_events`, `fabrevoie_commerce_refunds` and `fabrevoie_commerce_rate_limits`, separate from waitlist consent.

A paid order still needs fulfillment by the merchant. This integration records payment and refunds, reserves inventory and tracks merchant-confirmed dispatch/returns. [INVENTORY-OPERATIONS.md](INVENTORY-OPERATIONS.md) documents those commands. It does not buy postage, ship a bottle, issue refunds automatically or send marketing emails. Stripe Dashboard remains available for payment review and intentional refunds. A purchase does not subscribe the buyer to the launch list.

## Complete sandbox setup

1. Confirm the inclusive/exclusive VAT treatment of the approved EUR 129.99 price, actual stock, dispatch timing, shipping destinations/rates and sale/delivery/return terms. The earliest configured opening is 1 October 2026 at midnight Europe/Paris; do not treat the launch announcement as a confirmed dispatch date.
2. Confirm the owner's applicable tax registrations and mirror the approved configuration in the sandbox. Preserve the existing live head-office settings unless a correction is supplied. Recording a registration in Stripe does not register a business with an authority.
3. Confirm the proposed perfume tax code and set the sandbox Price's tax behavior. Create the approved shipping rates and configure their IDs/destinations. Apply the confirmed configuration to the existing live catalog after testing.
4. Configure a separate clearly labeled sandbox preview with `COMMERCE_MODE=test`, its correct `PUBLIC_SITE_URL` and a reachable sandbox webhook destination. Production rejects test-mode purchase activation and its live webhook cannot also verify sandbox events. Do not disable preview protection broadly to accommodate webhooks.
5. Run an actual Stripe Tax Calculation for an approved destination and inspect `taxability_reason`. A `not_collecting` result is not successful tax setup. Verify that tax and shipping shown by Checkout match the approved treatment.
6. Complete test-card success, decline, authentication, cancellation and delayed-payment scenarios; verify the real signed Stripe event updates the same persisted order. Verify a test refund. Mocked handler/browser tests alone do not establish this result.

## Open real sales

Live credentials, catalog and webhook have been prepared with new purchases disabled. Complete the approved price tax treatment, product tax classification, shipping rates/countries, dispatch notice, stock allocation and applicable registrations. Existing live and sandbox objects have separate IDs. The handler verifies one signing secret and key mode, so the old sandbox endpoint must be disabled or moved to a dedicated test destination when production changes to live credentials.

Set all runtime values, confirm customer-facing terms and dispatch wording, then change `COMMERCE_MODE` to `live` and deploy together. Never change just the mode while leaving test keys or test Price IDs. Run the live readiness report, and use a deliberate merchant-approved production transaction for any live financial verification.

Keep `ORDER_TOKEN_SECRET`, `RATE_LIMIT_SECRET` and the database stable during the transition. The order-token secret generates the same private order capability when a checkout request retries; the database stores only its hash. Do not expose secrets or database records through a public admin route. Store secrets using Vercel's sensitive environment variables; ordinary configuration such as mode and Price IDs is not secret.

## Verification commands

```powershell
npm test
npm run test:browser
npm run test:popup
npm run test:commerce-browser
npm run build
node tests/build-preview.mjs
```

The browser commerce suite uses mocked APIs. Handler tests use the real Stripe signature verifier with isolated test fixtures. The explicit cloud test below verifies real Neon SQL transactions with synthetic order records and deletes its own records afterward; it does not charge a card or calculate Stripe Tax:

```powershell
npx vercel@59.15.1 env run --environment production --scope puppetmaster666s-projects -- node tests/commerce-cloud.mjs --cloud-write
```

`node tests/commerce-deployment.mjs` checks a deployed site with purchases disabled without creating an order or payment. The older `tests/stripe-transport.mjs` requires a sandbox key and hardcodes `https://fabrevoie.com`; change it to the selected sandbox destination before running future transport tests. Do not use it as a live payment fixture.

See [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe Tax setup](https://docs.stripe.com/tax/set-up) and [Stripe webhooks](https://docs.stripe.com/webhooks) for the underlying Stripe behavior.
