# FABREVOIE / ULTRA MACHO official launch

The perfume application lives in `fragrance-site/` and is now the official website at https://fabrevoie.com. The GoDaddy DNS switch and HTTPS activation are complete. The original sneaker source remains at the repository root for rollback.

## Current launch

- Official website: https://fabrevoie.com
- Secondary deployment alias: https://fabrevoie.vercel.app
- Production deployment: `dpl_6fY81SsQncu7PkjzrCbPCzoBm6qj`.
- Source merged into `main` through PR #1; `feat/official-waitlist-2026` is preserved.
- First release: 1 October 2026.
- Lavender/graphite Iris design, bold wide italic typography, original brand logos, native Blender campaign photography.
- Styled popup and inline waitlist write consented emails to the connected free Neon database in Frankfurt. A disposable cloud signup and withdrawal passed on the official domain, alongside all 29 live deployment checks.
- Old footwear navigation is removed. Vercel temporarily redirects the 14 original HTML routes, including shop and checkout, to the perfume homepage.

GoDaddy's authoritative nameservers and public resolvers confirm the new routing. The existing nameservers, both MX records and both apex TXT records are unchanged. Both official hostnames have a valid HTTPS certificate, and www redirects to the apex with HTTP 308. Domain activation was verified on 11 September 2026 (Europe/Paris); exact DNS and rollback records are in `fragrance-site/OFFICIAL-LAUNCH.md`.

## Original website and rollback

- Original revision: `e8652905984dcb8fe8a4033d4fd72d1fb983f89c`.
- Preserved branch, local and on GitHub: `backup/pre-fragrance-2026-09-10`.
- Preserved tag, local and on GitHub: `pre-fragrance-2026-09-10`.
- Previous fragrance branches: `feat/ultra-macho-launch`, `feat/iris-editorial-2026`.
- Previous perfume deployment: `dpl_5UJMrsfasANkmDUQqf4PKjY5xAUV`.

Original sneaker files are not deleted or overwritten. Restore the prior GoDaddy apex A and www CNAME records to restore the GitHub Pages storefront; the exact values are in the launch guide. Preserve the waitlist database during any rollback. A perfume design rollback can use Vercel's previous deployment without changing Git history.

## GitHub and Vercel

Current GitHub CLI identity `puppetmaster666` has write access to `boogz666/fabrevoie.github.io`. The launch branch, original sneaker backup branch and rollback tag were pushed successfully on 11 September 2026. PR #1 was merged after both GitHub checks passed, at commit `048270ea6a3617ed6b2e47e49cac6775318e0d4c`. The original history and sneaker files are preserved; no force-push was used.

The Vercel project is https://vercel.com/puppetmaster666s-projects/fabrevoie. Manual deployment from the authoring `website/` directory is currently used. When connecting this repository, set Root Directory to `fragrance-site`, framework Other, Node 22, build `npm run build`, output `dist`. Automatic Git deployments remain disabled until the correct repository is connected.

## Development and validation

```powershell
cd fragrance-site
npm ci
npm start
```

The local preview uses private SQLite storage and runs on http://127.0.0.1:4173. Cloud deployments use Neon through `api/signup.js`. Neither database nor credentials are published as static assets.

```powershell
npm test
npm run test:browser
npm run test:popup
node tests/build-preview.mjs
node tests/deployment.mjs
```

The explicit `node tests/deployment.mjs --signup-live` flag submits and withdraws one disposable live record; it sends no email. See the app README for private CSV export and the launch guide for account/dashboard access.

## Release and commerce

This is a free release waitlist. Signup places no order and reserves no stock. No confirmation or launch email is sent automatically. Stripe is unnecessary for email collection; configure the actual selling business and checkout when paid sales or preorders open. The page includes no lore, hormonal claims, fabricated product reviews or 3D viewer.

## Asset sources

`fragrance-site/asset-notes.md` documents the optimized Iris imagery, original brand graphics and supplied local fonts. Raw Blender and campaign source files remain in the original authoring workspace. They are excluded from the public application, alongside databases, credentials and design experiments.
