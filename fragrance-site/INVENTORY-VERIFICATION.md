# Product and inventory verification - 11 September 2026

ULTRA MACHO / 100 ml is configured in the dedicated Stripe sandbox at EUR 129.99. Product `prod_VEkzAjHaGMlLXd` and default Price `price_1UEHTKI4Ls0KfpKegErVPsm1` are test resources. The owner's confirmed Made in Paris origin is included in the product catalog and website.

Published on https://fabrevoie.com in production deployment `dpl_FGbaCuynYrpHbjvVeGMcWJjv57Rp`. The previous Stripe deployment `dpl_PMNDJej2gwsWBDDy2TUbAZh2RuJn` remains a rollback point.

No live purchase has been enabled. Price tax behavior remains unspecified pending the owner's VAT answer. The actual bottle's cloud stock remains unconfigured, with zero customer orders; QA did not invent saleable units. Live credentials, stock, dispatch/shipping details, tax setup and customer-facing sale terms remain required.

## Completed checks

- 91 application tests pass, including 33 payment/inventory backend tests and seven private inventory-command tests.
- 165 mocked commerce browser checks pass, including sold-out layouts, stock-race responses, interrupted-response/reload recovery with the same request ID, safe tracking links and private order states. The existing 35 browser and 52 waitlist popup checks also pass. Mobile/desktop screenshots were reviewed with no accessibility violations; built application/order files match source byte-for-byte.
- 15 inventory lifecycle scenarios pass against the actual Neon database: concurrent last-unit reservations, retry identity, audited stock adjustments, stale-event protection, terminal releases, late paid orders, explicit allocation resolution, verified-payment dispatch, returns, refund reversals, definite creation failures and operator reconciliation chronology. All run-specific synthetic stock, orders, events, refunds and audit rows were removed.
- The earlier cloud persistence test also passed against Neon: durable orders, concurrent event deduplication, stale snapshot rejection, refund-total reversal and shared rate limits. Its QA records were removed.
- The production build and storage-unavailable preview pass; private source and data files are excluded from the generated public assets.
- 22 checks pass against the deployed commerce APIs, private order route and protected source/data paths. Checkout remains disabled and Made in Paris is present.
- 29 official live-site checks pass, including a test waitlist signup followed by withdrawal. No email was sent.
- A real sandbox transport fixture was created and immediately expired; Stripe delivered signed event `evt_1UEHr3I4Ls0KfpKendwegRh1` with no pending deliveries. The handler's durable event record was verified in Neon and no customer order was created. The inline QA Product/Price are inactive. This proves deployed webhook transport, not a paid application order or tax calculation.

The inventory test creates synthetic database fixtures only. It does not charge cards, send emails, purchase postage or represent a physical shipment. Browser commerce responses are mocked. Actual Stripe Tax Calculation and a fully paid application sandbox Checkout remain pending confirmed shipping and tax inputs.

The private operator commands and launch gates are documented in [INVENTORY-OPERATIONS.md](INVENTORY-OPERATIONS.md). The original sneaker source and its rollback branch/tag are retained.
