# Stripe delivery verification — 11 September 2026

The Stripe integration is deployed on **https://fabrevoie.com** with new purchases disabled. Production deployment: `dpl_PMNDJej2gwsWBDDy2TUbAZh2RuJn`. The official waitlist is active.

## Verified

- 71 application tests: signup/storage, Checkout configuration, request validation, durable retries, signature verification, delayed payment states, refund reversals, stale-snapshot protection, private exports and secret-safe readiness output.
- 35 general browser checks, 52 waitlist popup checks and 90 commerce/privacy/built-order browser checks. The purchase browser fixtures are explicitly mocked test data, not approved retail pricing.
- Actual Neon transactions: persistent intents, concurrent duplicate events, stale snapshot rejection without consuming the event, refund-total decreases after bank returns, paid-state protection and shared rate limits. Isolated QA order/refund/rate-limit records were removed.
- 18 checks against the deployed commerce API and order page, including disabled checkout, private cloud lookup, invalid signatures, origin restrictions and inaccessible private source/database files.
- 29 checks against the official live site, including a real waitlist signup followed by withdrawal. No email was sent.
- A real Stripe sandbox Checkout Session was created as **webhook transport QA — not for sale**, then immediately expired. Stripe delivered the signed expiry event to the deployed handler, which persisted it in Neon and correctly created no customer order. The €1 inline fixture is not a retail price; its Product/Price are already inactive, and its Session is expired. The latest transport test exited successfully.

Sandbox webhook endpoint: `we_1UEGrZI4Ls0KfpKeib0MvNH9`.

Verified Stripe event: `evt_1UEH5iI4Ls0KfpKeVXYYKcnP`. Stripe reported no pending webhook deliveries; the event was independently verified in the deployed handler's event table. Detailed reports remain in the ignored local `tests/artifacts/` directory.

The private cloud order report returns **zero customer orders** at verification time. Actual supplied keys/signing secrets were checked against source before packaging and are absent from Git/browser assets. GitHub push protection initially flagged an inert long test fixture; it was replaced with a short explicit placeholder and the push passed without bypassing protection.

## Not yet verified or activated

No real payment has been taken. An end-to-end paid sandbox purchase through the application's tax-enabled flow, decline/authentication scenarios and an actual Stripe Tax Calculation remain pending the owner's price, shipping, dispatch and tax setup. No business address, tax registration or retail Price has been invented or configured.

The configured credentials are sandbox keys. Live account activation, production Product/Price/shipping IDs, live webhook credentials and confirmed sale/delivery/return terms are required before changing `COMMERCE_MODE` to `live`. See [STRIPE-OPERATIONS.md](STRIPE-OPERATIONS.md).

The original sneaker source and existing backup branch/tag are retained. The pre-Stripe production deployment `dpl_6fY81SsQncu7PkjzrCbPCzoBm6qj` remains a rollback point.
