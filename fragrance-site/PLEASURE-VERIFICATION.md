# B2 campaign website verification — 11 September 2026

The refresh is prepared on `feat/pleasure-campaign-b2-2026`, based on production main `f90d279`. The website uses the approved GALA100 B2 bottle, the new **The pleasure is yours.** slogan, all ten completed Photoshop ads and four new native Blender photographs.

## Completed checks

| Check | Result |
| --- | --- |
| `npm test` | 91 unit/integration tests passed |
| `npm run build` | 32 referenced assets, 2.53 MB |
| `npm run test:browser` | 43 checks passed, including the ten-ad lightbox, keyboard navigation, restored focus, signup and withdrawal |
| `npm run test:popup` | 52 checks across 12 scenarios passed |
| `npm run test:commerce-browser` | 165 mocked checkout/order checks passed; no live Stripe calls |
| `node tests/build-preview.mjs` | Production build, disabled-signup state and accessibility passed at 1440, 390 and 320 px |
| `git diff --check` | Clean |

Automated browser accessibility checks report zero WCAG A/AA violations on the tested desktop/mobile pages and dialogs. Product and campaign images all decode successfully. Layout checks cover 320, 390, 768, 1024, 1440 and 1920 px. An additional camera-bounds audit checks the full bottle/cap at 14 widths from 320 to 2560 px; the tightest desktop headline-to-bottle clearance is about 40 px. Responsive framing was corrected to prevent right-edge clipping near 1101 px.

## Media verification

All 26 expected media files are complete, totaling 2,477,489 bytes. Every source and output SHA-256 hash matches `public/assets/pleasure/manifest.json`. Full ads are 1600 × 2000 WebP at quality 90, with 640 × 800 thumbnails at quality 80. Native product views remain uncropped. The 1200 × 630 social-image crop was checked against Blender camera bounds to preserve the entire bottle.

The final build contains no retired `iris-*` photography, archive assets or private manifests. Earlier source artwork and website history remain preserved. The regular local build was restored after the disabled-storage build test.

## Visual review artifacts

- `tests/artifacts/desktop-full.png` — complete 1440 × 5225 homepage.
- `tests/artifacts/mobile-full.png` — complete 390 × 5667 homepage.
- `tests/artifacts/desktop-hero.png` and `mobile-hero.png` — final first viewports.
- `tests/artifacts/pleasure-hero-crop-check.json` — all 14 responsive bottle-bound checks.
- `tests/artifacts/browser-report.json`, `waitlist-popup/report.json`, `commerce/report.json`, and `build-preview-report.json` — automated results.

The full desktop/mobile pages and hero compositions were visually reviewed and approved before publication. This record covers local preparation and verification; production deployment and external Stripe catalog-image updates are coordinated separately.
