# Analog campaign refresh

The homepage uses two approved Photoshop ads and the existing wide hero with a subtle film-grain finish. The first ad features the chrome car without a bottle, under ULTRA MACHO and the line “Everyone wants to be the best. Be different. Be the worst.” The second keeps “ZERO INTEREST IN ORDINARY.”

Run `node scripts/prepare-analog-assets.mjs` from this directory after the three approved PNG exports are complete in `../../website_grain_refresh_v1/design/exports/`:

- `02_BE_THE_WORST.png` — 2000 × 2500.
- `06_ORDINARY_GRAIN.png` — 2000 × 2500.
- `WEB_HERO_GRAIN.png` — 2400 × 1350, with its original framing preserved.

The script creates six sRGB WebP files under `public/assets/analog/`: 1600px and 640px versions of each ad, plus 2400px and 960px versions of the hero. It only resizes and encodes the complete images; all image editing remains in the Photoshop masters. Source and output SHA-256 hashes, dimensions, and sizes are recorded privately in `../../website_grain_refresh_v1/web-assets.json`.

Only the referenced analog assets enter the production build. Earlier campaign sources remain available for reverting. The signature gallery, dedicated side-label photograph, mobile hero image, and compact footer retain their approved layout. The painted-bottle study remains a separate artwork rather than an additional campaign card.

Validation: `npm run test:browser`, then `node tests/build-preview.mjs`. Restore the normal build afterward with `npm run build`, since the preview check intentionally builds a version without cloud signup storage.
