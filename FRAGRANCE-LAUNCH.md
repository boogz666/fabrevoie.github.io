# FABREVOIE / ULTRA MACHO launch

The perfume application lives in `fragrance-site/`. The existing sneaker website remains at the repository root with its original product pages, Shopify checkout links and `CNAME`.

## Original website and rollback

- Original revision: `e8652905984dcb8fe8a4033d4fd72d1fb983f89c`.
- Preserved branch: `backup/pre-fragrance-2026-09-10`.
- Preserved tag: `pre-fragrance-2026-09-10`.
- Fragrance work: `feat/ultra-macho-launch`.

The fragrance commit only adds the application, this document and its CI workflow. Original website files are not deleted or modified. The backup branch and tag currently exist locally and must be pushed with the feature branch when GitHub write access is available. Never force-push or replace the original history.

If fragrance changes have been merged later, use `git revert` on the integration commit to undo that addition while retaining history. A Vercel deployment can also be rolled back to its previous deployment independently of GitHub Pages. Review the deployment and DNS destination before any root-domain switch.

## Local development

```powershell
cd fragrance-site
npm ci
npm start
```

The local preview runs on `http://127.0.0.1:4173` and stores consented release signups in a private SQLite database outside its public directory. Tests use isolated temporary storage.

```powershell
npm test
npm run test:browser
node tests/build-preview.mjs
```

## Vercel

Set the Vercel project's **Root Directory** to `fragrance-site`. The included `vercel.json` selects the build, static output and server function. Framework is Other; Node is 22; the build command is `npm run build`; output is `dist`.

The current perfume preview is `https://fabrevoie.vercel.app`. Keep the current `fabrevoie.com` sneaker site connected while reviewing the perfume page. A fragrance subdomain can be connected later; this package does not alter DNS, the root `CNAME`, GitHub Pages or the sneaker Shopify store.

Current GitHub CLI authentication is `puppetmaster666`, which has read-only access to this repository. Publishing requires write access to `boogz666/fabrevoie.github.io`. The account owner can authenticate as `boogz666` or grant the connected account access. No credentials belong in this repository.

Vercel's Git integration currently points to the earlier perfume repository and automatic Git deployments are disabled. After the new feature branch is pushed and reviewed, connect this repository in Vercel with the root directory above. Manual deployments can update the existing perfume preview independently.

## Release and commerce

The page announces 1 October 2026 and collects free release-list signups once cloud storage is enabled. Signing up places no order and reserves no stock. It includes no lore, hormonal claims, 3D viewer, fabricated reviews or invented fragrance notes.

The cloud API needs `DATABASE_URL` and `RATE_LIMIT_SECRET`. Production currently has the rate-limit secret but still needs the Neon database connection; until then, the cloud build shows a release-list opening notice instead of the form. The account holder must accept the Neon integration terms before the intended free database can be provisioned. The local SQLite preview already works.

No automatic emails or live payments are enabled. Stripe Checkout is the intended perfume payment service when sales open. A price, shipping setup, inventory/fulfilment process, Stripe credentials and tested payment confirmation are still needed before adding checkout. The existing sneaker store continues using Shopify.

## Asset sources

The included assets are the page's optimized images, original brand graphics and local webfonts. `asset-notes.md` documents provenance. Raw Blender and campaign sources remain in the original authoring workspace; the optional `scripts/prepare-assets.py` needs that workspace to regenerate them. No raw campaign archives, databases, environment credentials or bottle design experiments are published with this application.
