# FABREVOIE live Stripe setup

Prepared on **11 September 2026**. The live account, catalog and webhook exist. **New purchases remain disabled** while the commercial settings and payment testing are completed; the public waitlist remains available.

## Account and catalog

| Setting | Verified value |
| --- | --- |
| Stripe account | Fabrevoie, `acct_1UEGS7EdyIZnMwR6` |
| Country / currency | France / EUR |
| Charges / payouts | Both enabled by Stripe |
| Product | ULTRA MACHO / 100 ml, Made in Paris |
| Live Product | `prod_VEljNNJKpZUuBy` |
| Live Price | `price_1UEICIEdyIZnMwR6BSfHWM8j` |
| Unit amount | EUR 129.99, one-time payment |
| Price tax behavior | `unspecified`, pending VAT-inclusive/exclusive confirmation |
| Inventory SKU | `ULTRAMACHO-100ML-IRIS`; no live stock initialized |

[Open the live product in Stripe](https://dashboard.stripe.com/products/prod_VEljNNJKpZUuBy). Catalog creation does not charge a customer or open website sales.

Live Stripe Tax settings are active. The existing head-office address and default tax code `txcd_30011000` were preserved. There are **zero active tax registrations**. No product tax code was assigned: `txcd_32050025` (Cosmetics - Beautifying, which includes perfume) remains proposed for the owner's confirmation. An unspecified Price tax behavior does not mean VAT-exempt.

## Environments and webhook

Production now uses the live account's secret, Product, Price and webhook signing secret, with `COMMERCE_MODE=disabled`. Preview keeps the existing sandbox credentials and catalog. `DATABASE_URL`, `ORDER_TOKEN_SECRET`, `RATE_LIMIT_SECRET`, SKU and earliest opening timestamp remain unchanged. Test/live inventory allocations are separate even though the database is shared.

The original parent-directory `.env` contains the user-supplied live credentials. Local `.env.local` remains the sandbox configuration. Private `.env.stripe-live.local` is used only when explicitly loaded; these environment files are excluded from Git and deployment uploads. Hosted Checkout does not require the publishable key in the browser.

Live endpoint **`we_1UEICJEdyIZnMwR6us6HQIHH`** targets **`https://fabrevoie.com/api/stripe-webhook`**, using API version `2026-08-26.dahlia` and these events:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
- `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`

The handler verifies the raw signed payload and requires its event mode to match the configured key. It keeps processing verified events and private order-status reads when new purchases are disabled.

The old sandbox endpoint **`we_1UEGrZI4Ls0KfpKeib0MvNH9`** was disabled after verifying the live deployment and zero outstanding sandbox application orders. It remains available for reconfiguration; it was not deleted. Future sandbox testing needs a dedicated reachable test destination because the production handler accepts a single signing secret/mode. Preview credentials, catalog and historical database records remain preserved.

## Verification and remaining launch work

**Production deployment ID:** `dpl_94pXk41HyK4uQNM5Xus3HbPgv7HB`. Previous deployment: `dpl_FGbaCuynYrpHbjvVeGMcWJjv57Rp`. Reverting to the old sandbox deployment also requires restoring its webhook destination/status; changing code alone does not restore external Stripe configuration.

**Live deployment verification:** 22 disabled-commerce checks and 25 read-only site/browser checks pass. The waitlist remains visible. A real Stripe `product.updated` event, `evt_1UEIHqEdyIZnMwR6epg84Ybx`, was delivered with its live signature and durably recorded by the deployed handler; it correctly created no customer order. The endpoint temporarily subscribed to that non-payment event for connection verification and was restored to the eight payment/refund events above. Stripe reported no pending deliveries.

No live payment fixture, Checkout Session or customer charge was created. This proves the live webhook connection, not completed payment or tax calculation. Sensitive Vercel values cannot be read back; private operator checks explicitly supply the retained live credentials while checking cloud catalog IDs and storage separately. Existing database/rate-limit configuration and preview test configuration were preserved. Earlier test results remain in [STRIPE-VERIFICATION.md](STRIPE-VERIFICATION.md) and [INVENTORY-VERIFICATION.md](INVENTORY-VERIFICATION.md).

The documented private live readiness and inventory commands were exercised successfully. Readiness correctly reports the remaining shipping, VAT/tax and product-classification inputs; inventory reports unconfigured live stock and zero orders. The 22 existing readiness/inventory-command tests pass.

Before sales open:

1. Confirm whether EUR 129.99 includes VAT and confirm the perfume tax classification.
2. Supply actual stock or a disclosed preorder limit, dispatch timing, shipping destinations and delivery charges.
3. Confirm applicable tax registrations and configure the approved tax/shipping setup in sandbox and live mode.
4. Verify a real sandbox paid Checkout, refund, and Stripe Tax calculation for an approved destination. A tax result of `not_collecting` is not evidence that collection has been configured successfully.
5. Verify customer-facing terms and runtime readiness, then explicitly enable live sales and deploy. The prepared earliest opening is **1 October 2026, 00:00 Europe/Paris**; that timestamp does not activate sales on its own.

The older `tests/stripe-transport.mjs` hardcodes the official domain and only accepts a sandbox secret. Its destination must be changed before future sandbox transport tests. It must not be repurposed to create a live payment fixture. The deployed disabled-commerce checks can run with `node tests/commerce-deployment.mjs` without creating a payment.

[STRIPE-OPERATIONS.md](STRIPE-OPERATIONS.md) documents account checks and order reports. [INVENTORY-OPERATIONS.md](INVENTORY-OPERATIONS.md) documents stock adjustments, reservations, shipment tracking and returns.
