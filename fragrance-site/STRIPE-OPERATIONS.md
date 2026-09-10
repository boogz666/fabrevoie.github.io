# FABREVOIE Stripe operations

The website uses Stripe-hosted Checkout for one-time ULTRA MACHO purchases, with automatic tax and signed payment/refund updates. Shopify is not required by this application. The public launch list continues to work independently.

## Current state

- Supplied credentials: dedicated **Fabrevoie sandbox**, EUR, France. No live key was supplied.
- `COMMERCE_MODE=disabled` keeps purchases hidden and refuses new checkout sessions. Turning sales off preserves webhook processing and private order-status reads.
- The sandbox key, webhook signing secret and separate order-token secret are stored privately. They are not bundled into the website. Hosted redirects do not use the publishable key.
- Sandbox webhook: `https://fabrevoie.com/api/stripe-webhook`, endpoint `we_1UEGrZI4Ls0KfpKeib0MvNH9`. This endpoint accepts only events verified with its signing secret and matching the configured key mode.
- Retail price, shipping rates/countries, dispatch notice, business address and applicable tax registrations await the owner's confirmed details. No placeholder retail price or tax registration has been created.
- Stripe's canonical Tax Codes API lists perfume under **Cosmetics - Beautifying**, `txcd_32050025`. This is the proposed classification for owner confirmation; it has not been assigned.

Implementation and scope are described in [STRIPE-INTEGRATION-PLAN.md](STRIPE-INTEGRATION-PLAN.md).

Production and real sandbox webhook delivery were verified on 11 September 2026. [STRIPE-VERIFICATION.md](STRIPE-VERIFICATION.md) distinguishes the passing checks from paid Checkout and Tax calculation, which are still pending.

## Private commands

From this directory, inspect local sandbox configuration without printing credentials or customer data:

```powershell
npm run stripe:status
node --env-file=.env.local scripts/stripe-readiness.mjs --tax-codes
```

The readiness command is read-only. Exit code 2 means configuration still needs attention. It does not certify tax obligations, successful tax calculation or completed payment. Local `.env.local` does not automatically contain Vercel's database variables; missing local database configuration is distinct from deployed storage readiness.

Review the deployed orders from the connected Vercel environment:

```powershell
npx vercel@59.15.1 env run --environment production --scope puppetmaster666s-projects -- node scripts/commerce-orders.mjs --cloud
```

This prints payment state, amount, quantity, order reference and Stripe payment links for the most recent 25 orders. It does not print customer contact or delivery information. Add `--export` to write those fulfillment details to a new JSON file inside the ignored private `data/` directory. Exports refuse public/dist paths and existing files, omit internal access tokens and never report an incomplete export as complete.

Without `--cloud`, the order command reads only local `data/commerce.sqlite`. It refuses to silently substitute an empty local database for unavailable cloud storage. The cloud tables are `fabrevoie_commerce_orders`, `fabrevoie_commerce_events`, `fabrevoie_commerce_refunds` and `fabrevoie_commerce_rate_limits`, separate from waitlist consent.

A paid order still needs fulfillment by the merchant. This integration records payment and refunds; it does not buy postage, ship a bottle, issue refunds automatically or send marketing emails. Stripe Dashboard remains available for payment review and intentional refunds. A purchase does not subscribe the buyer to the launch list.

## Complete sandbox setup

1. Confirm the 100 ml EUR price, inclusive/exclusive VAT treatment, sales-opening date, dispatch timing, shipping destinations/rates and sale/delivery/return terms. Do not treat the 1 October launch announcement as a confirmed dispatch date.
2. Confirm the actual head-office address and existing tax registrations, then prepare the matching Stripe Tax settings and registrations for review. Recording a registration in Stripe does not register a business with an authority.
3. Confirm the proposed perfume tax code. Create the Product and one-time EUR Price with explicit tax behavior, then the approved shipping rates. Configure the IDs and destination list in the environment.
4. Configure a separate clearly labeled sandbox preview with `COMMERCE_MODE=test` and its correct `PUBLIC_SITE_URL`. Production rejects test-mode purchase activation. Do not disable preview protection broadly to accommodate webhooks; use the verified public webhook endpoint or an explicitly chosen test deployment.
5. Run an actual Stripe Tax Calculation for an approved destination and inspect `taxability_reason`. A `not_collecting` result is not successful tax setup. Verify that tax and shipping shown by Checkout match the approved treatment.
6. Complete test-card success, decline, authentication, cancellation and delayed-payment scenarios; verify the real signed Stripe event updates the same persisted order. Verify a test refund. Mocked handler/browser tests alone do not establish this result.

## Open real sales

Use live account credentials only after account readiness and the confirmed commercial/tax setup are complete. Live and sandbox objects have different IDs. Configure the live Product/Price, shipping rates and applicable tax registrations; create the live webhook endpoint with the same event list and its own signing secret. Keep the test endpoint on a test deployment or disable it when replacing its shared endpoint with live configuration.

Set all runtime values, confirm customer-facing terms and dispatch wording, then change `COMMERCE_MODE` to `live` and deploy together. Never change just the mode while leaving test keys or test Price IDs. Run the live readiness report, and use a deliberate merchant-approved production transaction for any live financial verification.

Keep `ORDER_TOKEN_SECRET` stable: it generates the same private order capability when a checkout request retries. The database stores only its hash. Do not expose the secret or database records through a public admin route. Store secrets using Vercel's sensitive environment variables; ordinary configuration such as mode and Price IDs is not secret.

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

See [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe Tax setup](https://docs.stripe.com/tax/set-up) and [Stripe webhooks](https://docs.stripe.com/webhooks) for the underlying Stripe behavior.
