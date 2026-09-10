# ULTRA MACHO stock and dispatch

FABREVOIE keeps its inventory and fulfillment records in the website database. Stripe handles payments and the product/price catalog. There is no Shopify dependency.

The confirmed launch product is **ULTRA MACHO / 100 ml**, Made in Paris, priced at **€129.99**. It is created in the dedicated Stripe sandbox:

- Product: `prod_VEkzAjHaGMlLXd`
- Price: `price_1UEHTKI4Ls0KfpKegErVPsm1`
- Inventory SKU: `ULTRAMACHO-100ML-IRIS`
- Price tax behavior: `unspecified`, pending the owner's VAT-inclusive/exclusive answer. This does not mean VAT-exempt.

Live purchases remain disabled. No launch stock has been invented. The same SKU has separate test and live inventory records, and neither environment changes the other's allocation.

## Stock rules

| Field | Meaning |
| --- | --- |
| Capacity | Total units released into the online selling allocation, including later restocks/adjustments |
| Held | Units reserved for pending or processing checkouts |
| Committed | Units allocated to verified paid orders |
| Available | Capacity minus held and committed units |

This tracks the online selling allocation, not every bottle in a physical warehouse. The merchant confirms which physical units or explicitly disclosed preorder allocation may be offered. An initial stock adjustment must be supplied before the SKU becomes available. Zero confirmed stock displays sold out when the remaining commerce configuration is ready.

A checkout reserves stock in the same database transaction that creates its order. Retrying that request reuses its reservation. Concurrent shoppers cannot both reserve the last available unit. Verified paid webhooks commit the reservation once; verified terminal unpaid failure/expiry releases it once. A completed but unpaid delayed payment retains its reservation.

Opening the cancellation page, closing the browser, passing a local deadline or disabling new sales does not prove a payment failed. These actions do not release reservations. Existing reserved sessions can be resumed even if all remaining public stock is sold out.

Refunds do not restock bottles automatically. A return might be missing, opened or damaged. Record the return, inspect the goods, then explicitly adjust stock if it can be sold again. Stock and fulfillment changes have an audit trail and require a UUID operation ID; repeating the same operation ID with the same parameters does not apply the change twice.

If payment arrives after a reservation was released, record the paid order as requiring review. Once sufficient stock is available, the private allocation command can reserve it for that paid order without charging again. It refuses to allocate unavailable units or change an already shipped/returned order.

## Private management

Run these from the website directory through the authenticated Vercel CLI. The commands print order references and operational status, not buyer email/address data. Test credentials cannot reconcile a live order.

```powershell
npx vercel@59.15.1 env run --environment production --scope puppetmaster666s-projects -- node scripts/inventory.mjs status --cloud --mode test
```

Change the final command as needed:

| Command | Use |
| --- | --- |
| `status --cloud --mode test` | Stock balance and counts of orders awaiting dispatch, shipped, returned or requiring review |
| `audit --cloud --mode test` | Latest stock and fulfillment audit entries |
| `holds --cloud --mode test` | Orders currently holding units |
| `adjust --cloud --mode test --delta 10 --reason initial_stock --operation-id UUID` | Example only: add ten confirmed units; use the actual approved quantity |
| `ship --cloud --mode test --order REFERENCE --carrier CARRIER --tracking-number NUMBER --tracking-url HTTPS_URL --reason dispatch_confirmed --operation-id UUID` | Record actual dispatch with tracking |
| `return --cloud --mode test --order REFERENCE --reason return_received --operation-id UUID` | Record receipt of a returned shipment, without automatically restocking or refunding |
| `review --cloud --mode test --order REFERENCE --reason dispatch_review --operation-id UUID` | Pause fulfillment for merchant review |
| `ready --cloud --mode test --order REFERENCE --reason payment_reviewed --operation-id UUID` | Clear a reviewed, paid and allocated order for dispatch; cannot clear unpaid, refunded or already dispatched orders |
| `allocate --cloud --mode test --order REFERENCE --reason stock_resolved --operation-id UUID` | Allocate available stock to a paid order requiring stock resolution |
| `reconcile --cloud --mode test --order REFERENCE --operation-id UUID` | Read a stored order's current Stripe Session and reconcile payment/expired reservations |

Use `--mode live` only for actual live operations. Keep the generated UUID when retrying a write. A reused UUID with changed parameters is rejected. Reasons are short non-personal codes such as `initial_stock`, `received_stock`, `damaged_stock` or `return_restock`.

Reconciliation does not fabricate Stripe webhook events. It makes authenticated Stripe reads and records a distinct operator reconciliation. An unattached ambiguous checkout remains held for investigation; its potential payment must be resolved before freeing stock.

A definitive Stripe validation rejection before a Session exists releases the same worker's reservation with an audit entry. Network failures, server errors and idempotency contention remain held because a Session may still exist. A failed refund that returns funds to the merchant also requires deliberate fulfillment review; it does not automatically authorize shipping.

`scripts/commerce-orders.mjs --cloud --export` writes delivery details and tracking to a new private JSON file in ignored `data/`. Its default report omits personal data. There is no public admin or inventory-write endpoint.

## Launch and fulfillment

The configured opening instant is **1 October 2026, 00:00 Europe/Paris** (`2026-09-30T22:00:00Z`). This is a prepared earliest opening time, not automatic payment activation: `COMMERCE_MODE`, live credentials, stock, price, shipping and tax checks must also be ready. Sandbox testing can run before that date.

Remaining merchant inputs are the VAT treatment of €129.99, actual selling stock or preorder limit, dispatch timing, shipping countries/cost, and business/tax information. Made in Paris describes manufacture; it does not supply the dispatch address, package dimensions or carrier service.

The software records dispatch and customer tracking links; it does not physically pack goods, purchase shipping labels, schedule collection or send messages. The owner or fulfillment provider performs those actions. Carrier selection and receipt/email delivery can be connected after their service and settings are chosen. Payment refunds remain deliberate Stripe actions, separate from return records and stock.
