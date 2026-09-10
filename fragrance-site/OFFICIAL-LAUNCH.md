# FABREVOIE official fragrance launch

Prepared 10 September 2026. The user authorized replacing the sneaker storefront with the Iris perfume website and collecting a free release waitlist for 1 October 2026.

## Domain switch

Both `fabrevoie.com` and `www.fabrevoie.com` are attached and ownership-verified in the Vercel `fabrevoie` project. `www` is configured to redirect to the apex with HTTP 308. Ownership verification does not mean DNS is routed correctly: at preparation time GoDaddy still points to GitHub Pages.

In GoDaddy DNS, replace the four existing apex A records (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) with the two A records below. Replace the existing `www` CNAME to `boogz666.github.io` with the CNAME below. These values came from Vercel's project-specific verification response on 10 September 2026.

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 216.150.1.1 |
| A | @ | 216.150.16.1 |
| CNAME | www | 03492ae8628c877c.vercel-dns-016.com |

Keep the existing GoDaddy nameservers and all mail MX/TXT/DKIM records. In particular, the current ImprovMX mail routing must remain intact. A read-only DNS snapshot is saved outside the application in `backups/fabrevoie-dns-before-official-2026-09-10.json`.

After saving DNS, verify both domains in Vercel and check HTTPS, www redirection, canonical metadata and the waitlist. The project can already be reached at https://fabrevoie.vercel.app while the domain switch is pending.

## Collection and operator access

The inline form and lavender popup write to the same consented release list. Signing up is free and does not place an order or reserve stock. Both require unchecked-by-default consent. Automatic invitations wait 15 seconds, defer during other dialogs/form entry, and respect seven-day dismissal and successful signup.

Cloud storage is `fabrevoie-signups`, Neon project `spring-moon-63118209`, Vercel resource `store_GkkUEEDu7Zs5M6C2`, Free plan in Frankfurt (`fra1`). Production and preview have a database connection and rate-limit secret. Never expose the connection string or withdrawal keys in public files, logs or Git.

Owner dashboard: https://vercel.com/puppetmaster666s-projects/~/stores/integration/store_GkkUEEDu7Zs5M6C2 . Production and preview currently share this database. For a private CSV export, use `scripts/export-signups.mjs --cloud` with Vercel production environment variables; the README gives the command. Only consented email/time/version/source fields are exported; withdrawal hashes are excluded.

The Neon table `public.fabrevoie_signups` stores the email, consent time/version, source and a hash of the private withdrawal secret. Only emails still in this table belong to the active list. The companion rate-limit table contains temporary keyed client hashes. No confirmation or launch emails are sent automatically; sending the campaign is a separate operation.

Deployment `dpl_6fY81SsQncu7PkjzrCbPCzoBm6qj` is live at https://fabrevoie.vercel.app. On 10 September 2026, all 29 live deployment checks passed: a disposable `@example.test` entry was written successfully to cloud storage and then withdrawn successfully. No email was sent. The styled popup, temporary sneaker redirects, image/font loading and official canonical metadata also passed. DNS still points the official domain to the old storefront until the GoDaddy update above.

## Sneaker retirement and rollback

The perfume navigation no longer links to sneakers. Vercel temporarily redirects all 14 original root HTML page routes to `/`, including the old shop, products and checkout URLs. It does not host the sneaker source or Shopify checkout links.

Original sneaker revision: `e8652905984dcb8fe8a4033d4fd72d1fb983f89c`. Local branch `backup/pre-fragrance-2026-09-10` and tag `pre-fragrance-2026-09-10` preserve it, alongside the original root files in `brand-site-review`. The new app is packaged under `fragrance-site/` on `feat/official-waitlist-2026`. GitHub write access is still required to publish that branch; the connected account currently has read-only access to `boogz666/fabrevoie.github.io`.

To restore the sneaker storefront, restore the previous apex A records and `www` CNAME above at GoDaddy. The original GitHub Pages source and CNAME have not been deleted. To undo only the new perfume popup, roll Vercel back to `dpl_5UJMrsfasANkmDUQqf4PKjY5xAUV`. Preserve database records during either rollback.

## Stripe

The free waitlist does not require Stripe. When paid sales or preorders open, use the real business operating FABREVOIE. If the existing Stripe account already represents the same FABREVOIE operation, adding perfume does not itself require a separate account. If the current account serves another business, add a separate FABREVOIE Stripe account under the same login/email. A Stripe account is not a newly incorporated legal company.

Stripe documentation: https://docs.stripe.com/get-started/account/multiple-accounts
