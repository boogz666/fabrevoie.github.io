# FABREVOIE — ULTRA MACHO

A launch website led by **ULTRA MACHO**, with **The pleasure is yours.** as its supporting slogan and a planned **1 October 2026** release. The Iris edition uses the original FNAME wordmark and FF monogram, Helvetica Neue LT Pro Black Extended Oblique and Founders Grotesk from the supplied collection. Wide italic uppercase typography takes its direction from the existing FABREVOIE sneaker site.

The site includes a full-width editorial opening, native Blender bottle photographs with an accessible detail gallery, ten campaign advertisements with a keyboard-accessible full-size archive, an inline release signup and a styled waitlist popup with withdrawal. The perfume is now live at **https://fabrevoie.com**, replacing the sneaker storefront; original sneaker source and history are preserved. Contact is support@fabrevoie.com. The campaign palette pairs ink `#151516`, ivory `#F2EFE9`, restrained iris `#C1B3D2`, warm mist `#E3DFDA` and silver `#B9B5B3`. The approved GALA100 B2 bottle has iris liquid and a taller clear square glass crown above a shortened, smooth silver collar.

## Open the preview

The running preview is **http://127.0.0.1:4173**. It is local to this computer, not a public website.

Double-click/run `start-preview.ps1` to start a hidden local server and open the site in your browser. Alternatively, from this directory:

```powershell
npm start
```

Node 22.16 or newer is required. Run `npm ci` to install the pinned dependencies. Node 22 prints an experimental SQLite notice; it does not prevent the server from running.

## What works

- Desktop, tablet and mobile layouts, including tested widths from 320 to 1920 pixels.
- Local fonts and optimized imagery, with no third-party asset requests or analytics.
- Three bottle photographs, an enlarged image dialog, keyboard navigation and mobile menu.
- Explicit signup consent, email validation, durable SQLite storage, duplicate handling and honest failure states.
- A native, accessible ivory waitlist popup with shared inline/popup API handling. Automatic opening waits 15 seconds and defers during other dialogs or form entry. Dismissal lasts seven days in this browser; a successful signup suppresses automatic invitations. Manual join links remain available.
- A private withdrawal link and browser control that remove the saved entry. The database stores only a hash of each withdrawal secret.

Signups are saved outside the public directory in `data/signups.sqlite`. Automated tests use separate temporary databases and do not seed the real launch list.

Export the consented list locally:

```powershell
node scripts/export-signups.mjs
```

This writes a timestamped CSV in `data/` and prints only the count and destination. No emails are sent. Preserve private withdrawal links when configuring the eventual launch-mail workflow; the CSV intentionally excludes secret token material.

To export the live cloud list, run with the Vercel project's production environment (no credentials need to be pasted into source files):

```powershell
npx vercel@59.15.1 env run --environment production --scope puppetmaster666s-projects -- node scripts/export-signups.mjs --cloud
```

Cloud mode requires `DATABASE_URL` and never falls back to local storage. The CSV stays in the ignored private `data/` directory; exports into `public/` or `dist/` are refused. Alternatively, open the [signup database dashboard](https://vercel.com/puppetmaster666s-projects/~/stores/integration/store_GkkUEEDu7Zs5M6C2) and use Neon's table/SQL view. Production and preview currently share this database, so use isolated local tests for development and withdraw any deliberately created live test entry.

## Edit the website

Stripe Payments and Tax are implemented behind a disabled-by-default commerce switch. The live FABREVOIE Stripe account is verified and its product, price and webhook are created; purchases remain disabled while stock, shipping, VAT treatment and payment testing are completed. The waitlist stays available. [LIVE-STRIPE-SETUP.md](LIVE-STRIPE-SETUP.md) records the live configuration and verification status; [STRIPE-OPERATIONS.md](STRIPE-OPERATIONS.md) covers private order reports and launch steps, and [STRIPE-INTEGRATION-PLAN.md](STRIPE-INTEGRATION-PLAN.md) describes the integration.

The confirmed launch price is €129.99 for ULTRA MACHO / 100 ml, Made in Paris. Separate live and sandbox catalog objects exist; VAT treatment remains pending. [INVENTORY-OPERATIONS.md](INVENTORY-OPERATIONS.md) covers stock reservations, sold-out behavior, shipment tracking, return records and private management commands. No physical stock quantity is assumed.

| File | Purpose |
| --- | --- |
| `public/index.html` | Product and campaign content, release date, gallery, contact and signup |
| `public/styles.css` | Layout, typography, responsive rules and motion |
| `public/app.js` | Gallery, dialogs, mobile navigation, signup and withdrawal |
| `server.mjs` | Static server and durable signup/withdrawal API |
| `public/assets/` | Original brand graphics, optimized campaign images and local fonts |
| `scripts/prepare-iris-assets.py` | Repeatable Iris image conversion and local font export |
| `scripts/export-signups.mjs` | Private CSV export for the operator |

Only the new `website/` directory was created. Existing campaigns, Blender sessions and `geminidesign.html` were preserved.

## Imagery and copy

The Iris hero, stone and paper campaign plates are new native Blender renders from `campaign_iris_v1/`. The studio and silver detail come from `iris_cap_v2/`, and the side photograph shows the same approved cap and black/silver plaque. The two advertisements use real font typography and the original logos composed in HTML/CSS over the Blender photographs. There is no generated or repainted product lettering in these assets.

[asset-notes.md](asset-notes.md) records source images, font files and exact logo preservation. These are digital campaign assets; they are not evidence of physical manufacture. The product sections use confirmed packaging information and do not invent a scent pyramid, formula, longevity test, reviews or endorsements.

## Validation

```powershell
npm install
npm test
npm run test:browser
npm run test:popup
```

Server tests cover persistence across restart, consent, duplicates, email validation, payload bounds, origin/path protections, rate limits, storage errors and token-authorized deletion. Browser testing exercises the actual form against an isolated database, gallery/menu/keyboard interactions, six viewport sizes, image/font loading, product hierarchy, navigation and automated WCAG A/AA checks.

The browser script uses installed Microsoft Edge on Windows, or Playwright Chromium elsewhere. Set `BROWSER_PATH` to another compatible Chromium executable if needed. Browser dev dependencies are pinned by `package-lock.json`; they are not needed to run the site.

Screenshots and the machine-readable browser report are in `tests/artifacts/`.

## GitHub and Vercel

Target repository: **https://github.com/boogz666/fabrevoie.github.io**, branch **`feat/official-waitlist-2026`**. This `website/` directory is the working source. The deployable application is packaged under **`fragrance-site/`** in that repository, preserving the original root sneaker source for rollback. Earlier launch branches preserve the preceding design. The connected `puppetmaster666` account now has write access: the launch branch, original sneaker backup branch and rollback tag have been published to GitHub. The previous `puppetmaster666/fabrevoie` repository is retained as a historical project; it is not the target for this update.

Vercel project: **https://vercel.com/puppetmaster666s-projects/fabrevoie**. Official website: **https://fabrevoie.com**; deployment alias: **https://fabrevoie.vercel.app**. GoDaddy DNS is configured correctly, both official hostnames have a valid HTTPS certificate, and www redirects to the apex. Production canonical metadata uses **https://fabrevoie.com**. All 29 live checks passed on the official domain, including a saved cloud signup and withdrawal. Legacy sneaker HTML routes redirect temporarily to the perfume homepage on Vercel. The current workflow is a manual deployment after verification; [OFFICIAL-LAUNCH.md](OFFICIAL-LAUNCH.md) records DNS and rollback details.

Vercel serves the `dist/` build and runs `api/signup.js` as a Node function in Paris (`cdg1`). The build includes only referenced assets, page files and generated search/social metadata. Local databases, original source images and asset inventories are excluded. Cloud signups use Neon Postgres; the local preview uses SQLite.

Cloud environment variables:

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string; provisioned through the Vercel integration |
| `RATE_LIMIT_SECRET` | Secret used to hash client addresses for shared rate limits |
| `PUBLIC_SITE_URL` | Optional canonical HTTPS origin; defaults to Vercel's production domain |
| `PUBLIC_ORIGIN` | Optional explicit canonical request origin |

Use encrypted Vercel variables. Actual values are never committed. The Postgres schema initializes automatically: `fabrevoie_signups` holds consented emails and withdrawal hashes; `fabrevoie_signup_rate_limits` holds temporary keyed client hashes. Signups and withdrawals finish writing before success is returned. All instances share rate limits.

**Cloud storage:** the `fabrevoie-signups` Neon database is connected in Frankfurt (`fra1`) on the Free plan. `DATABASE_URL` is configured for production and preview; production also has `RATE_LIMIT_SECRET` and the official canonical origin. No paid database plan was selected. The first live signup and withdrawal are verified after deployment; the current outcome is recorded in [OFFICIAL-LAUNCH.md](OFFICIAL-LAUNCH.md).

If a future deployment lacks storage configuration, its production build displays a release-list opening notice, hides both forms and suppresses the popup. The build enables collection when `DATABASE_URL` and `RATE_LIMIT_SECRET` are present. Runtime storage failures return 503 and never report a saved signup.

No confirmation or launch emails are sent automatically. The eventual mailing workflow must honor withdrawals. The public contact is **support@fabrevoie.com**, included in the footer, mobile menu and privacy dialog. The supplied desktop font files were authorized for this design; no trial fonts are embedded, and metadata alone does not establish a webfont licence.

`npm test` runs local server and injected-storage cloud API checks. `npm run test:browser` exercises the local site against isolated temporary storage. `node tests/build-preview.mjs` verifies the production-style build while storage is unavailable. `node tests/deployment.mjs` performs read-only deployment checks. Only the explicit `node tests/deployment.mjs --signup-live` option submits and withdraws a disposable test entry after storage activation; it sends no emails. Reports and screenshots stay locally in `tests/artifacts/`.

[server-notes.md](server-notes.md) documents the separate local preview server. Local signup records remain on this computer and are not uploaded by Git or Vercel.
