# User-selected campaign

The campaign uses only three supplied artworks, in this order: chrome car, blue painted bottle, private airfield. The exact files are copied into the private workspace folder `../../campaign_film_life_v2/site_selection_v3/sources/`. That folder's `web-assets.json` records original paths, source hashes and dimensions, and all six web derivative hashes.

`node scripts/prepare-selected-campaign-assets.mjs` checks the copied source bytes against each requested original and performs uncropped sRGB WebP encoding. Full images retain native resolution up to1600px wide; card sources are640px wide. No typography, filtering or retouching is performed by the encoder. The chosen painted image already omits an external ULTRA MACHO headline.

The wide layout presents three equal columns. Narrow screens use one column. Every image opens in the existing accessible campaign dialog with its actual dimensions; arrow keys, Home and End navigate the three images, and Escape returns focus. The hero, signature gallery and compact footer retain their approved assets.

The build includes only these six campaign derivatives and the four existing film-hero derivatives. Previous campaign sources remain available for reverting, but are excluded from the deployed bundle.
