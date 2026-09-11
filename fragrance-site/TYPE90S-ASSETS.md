# 1990s typography refresh

The first campaign ad uses the approved final image-generated `CAR_90S.png`. Photoshop applies photographic filters before that generation step; final typography comes from image generation. Web encoding adds no typography, overlays, retouching, or crops.

The wide hero uses `HERO_BASE.png`, a filtered version of its existing 2400 × 1350 photograph without embedded site headings. The second ad stays on the approved `analog/campaign-06` assets. The signature gallery, side-label image, mobile hero, two-card campaign layout, and compact footer retain their approved configuration. `PAINTED_90S` remains a separate review artwork.

After both sources are approved and complete, run `node scripts/prepare-type90s-assets.mjs`. Sources are read from `../../website_type_refresh_v2/generated/CAR_90S.png` and `../../website_type_refresh_v2/filtered/HERO_BASE.png`.

The script creates four sRGB WebP files under `public/assets/type90s/`. The main car ad keeps its actual native width up to 1600px; its smaller version is 640px. The hero is encoded at 2400px and 960px. No source is enlarged. The car image's HTML width, height and `srcset` descriptor must match the script's reported full-size output. Original files and hashes are preserved in the private `../../website_type_refresh_v2/web-assets.json` manifest.

Only these four files and the two existing `analog/campaign-06` files enter the campaign/hero portion of the production build. Previous assets remain available for reverting.

Validation: `npm run test:browser`, then `node tests/build-preview.mjs`; restore the normal build with `npm run build` after the preview test intentionally disables unavailable cloud signup storage.
