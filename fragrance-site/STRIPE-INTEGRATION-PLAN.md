# FABREVOIE — Stripe Payments and Tax

Prepared 11 September 2026 for https://fabrevoie.com, a single-product perfume launch selling ULTRA MACHO, 100 ml, with the approved Iris bottle. The existing site collects a free waitlist for 1 October 2026. It must remain functional while commerce is prepared.

## Planning source and account audit

The requested ChatGPT Stripe app installation could not be completed in this session: no installation/planner tool was exposed, the supplied app URL redirected to the plugin directory, and automatic browser launch was rejected by the tool policy. `stripe_implementation_planner` remained unavailable. The user's specified fallback, `npx skills add https://docs.stripe.com --yes`, succeeded. This plan applies the downloaded `stripe-best-practices` payments, tax and security guidance and `stripe-docs`; it is not represented as planner-tool output.

Read-only account checks confirmed the supplied keys belong to **Fabrevoie sandbox**, France, EUR. Both supplied keys are test keys. There are no existing Stripe Prices or shipping rates. Tax Settings are pending, the head-office address is absent, and there are no active Tax registrations. No account settings or registrations were changed during this audit.

The current fragrance application has no payment integration. It has Node/Vercel functions, Neon Postgres and a local SQLite preview. Historical sneaker source contains Shopify links and an unverified browser-only Stripe confirmation; these are not reused as order verification.

## Recommended flow

Use **Stripe-hosted Checkout Sessions** for one-time bottle purchases. The product page, purchase controls and order-status page remain on FABREVOIE; Stripe hosts the payment form. This avoids handling card details and supports Stripe's dynamically selected payment methods. The publishable key is not required for a hosted Checkout redirect; the secret key remains server-side.

1. The website fetches a minimal public commerce configuration from its own API. When sales are disabled or required configuration is missing, the live waitlist remains the only enabled action.
2. A same-origin checkout request contains quantity and a client request identifier, never a client-selected amount, currency, tax rate or shipping charge. The server validates configuration and the configured Stripe Price, applies quantity limits and shared rate limits, and creates a persistent order intent.
3. The server creates a Checkout Session using that Price, configured shipping destinations/rates, shipping-address collection and automatic tax only after its prerequisites are verified. Session creation is idempotent. A stable integration identifier distinguishes this flow in Stripe.
4. The browser redirects to the verified Stripe Checkout URL. Success returns to a branded FABREVOIE order page; cancellation returns to the product page without claiming payment.
5. A signed webhook records verified payment results and order details durably. The customer return page only reads order status; visiting it never marks an order paid.

No subscriptions, Connect marketplace, Shopify dependency or custom card form are needed for this product.

## Payments and order tracking

- Add separate checkout, order-status and Stripe-webhook endpoints; keep waitlist data and marketing consent independent of purchases.
- Use the official Stripe Node SDK and explicit current API version. Omit `payment_method_types` so eligible methods come from the Stripe Dashboard.
- Verify webhook signatures against the raw request body. Handle `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and expiration. An unpaid completed session must not be treated as paid.
- Persist unique event/session references, request idempotency and order transitions so retries and duplicate deliveries do not create duplicate orders or fulfillment actions. Prevent late failure/expiry events from downgrading an already-paid order. Record refund status without automatically issuing refunds.
- Store the verified order amount, currency, product/quantity, contact and delivery details needed for fulfillment. Expose only a minimal customer-facing status through an unguessable private order token. Never expose email/address lists publicly.
- Provide a private operator export/status command and Stripe Dashboard references. Dispatch remains an explicit merchant operation; payment confirmation does not claim that a bottle has shipped.

## Stripe Tax

Use Stripe Tax on Checkout, with an explicit Product tax code and Price tax behavior. Look up the perfume/cosmetics candidates from Stripe's current canonical Tax Codes API and have the business confirm the classification. Do not guess a tax code or use a digital-services code for perfume.

Before enabling tax collection, confirm the merchant head-office address, existing tax registrations and intended shipping countries. Read settings before changing them. Recording a registration in Stripe does not register the business with a tax authority. Live registrations and tax classification require the business's confirmed facts; this implementation must not invent them.

The runtime readiness check must detect missing/inactive Tax Settings and missing active registrations rather than silently treating zero tax as a completed setup. Automatic tax is enabled only after those checks. Destination-specific treatment still depends on the merchant's actual registrations; no blanket tax percentage is hardcoded.

After the sandbox tax setup is confirmed, run a Stripe Tax Calculation for an agreed destination and inspect `taxability_reason`, then complete a sandbox Checkout payment and verify its tax amounts and signed webhook. Until that is done, describe tax calculation as unverified. Filing/remittance is a separate business process from calculation and collection.

## Configuration and release controls

Use distinct test/live configurations. Default commerce to disabled. A test secret must never activate a live purchase flow. The existing official website stays on the waitlist while product price, shipping, dispatch date and tax setup are unresolved. Use a clearly labeled sandbox preview for development; do not accept real payments with placeholder commercial terms.

Keep secrets and webhook signing secrets in ignored local environment files and sensitive Vercel environment variables, never source, browser responses, logs or Git. A restricted Stripe key with only the integration's required permissions is preferred for the eventual production deployment. The current user-supplied sandbox secret can support development.

Required launch inputs: approved EUR price and VAT-inclusive/exclusive behavior; shipping countries and prices; dispatch timing and sales-opening date; actual merchant/Tax details; applicable customer-facing sale, delivery and return terms; production Stripe readiness and keys. Product quantity/availability and physical fulfillment must be confirmed before opening paid sales.

## Validation

Verify same-origin enforcement, server-controlled prices, quantity validation, repeat requests, rate limits, invalid signatures, raw-body verification, duplicate and out-of-order events, delayed payment success/failure, minimal private status responses, exports and disabled/test/live safeguards. Preserve the existing waitlist, gallery and popup tests. Check the new purchase/status UI on mobile and desktop with keyboard and accessibility checks.

Use the supplied dedicated sandbox for Stripe API verification. Do not fabricate a successful payment from a return URL or a locally signed example event; those prove only the relevant handler behavior. Record actual Stripe test payment, webhook and tax-calculation results separately from mocked tests. No live charge or tax-registration change is implied by this plan.

## Primary references

- Checkout: https://docs.stripe.com/payments/checkout
- Fulfillment and asynchronous payments: https://docs.stripe.com/checkout/fulfillment
- Webhook signatures: https://docs.stripe.com/webhooks
- Tax with Checkout: https://docs.stripe.com/tax/checkout
- Tax setup and registrations: https://docs.stripe.com/tax/set-up
- Product tax codes: https://docs.stripe.com/tax/tax-codes
- Sandbox testing: https://docs.stripe.com/sandboxes
- API key handling: https://docs.stripe.com/keys-best-practices
