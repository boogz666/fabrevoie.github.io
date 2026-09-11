# Film campaign selection

The campaign section presents six selected ads in this order: `02_BE_THE_WORST`, `06_ORDINARY`, `12_CATWALK`, `13_FIRST_CLASS`, `14_BAD_COMPANY`, and `15_PLEASURE`. They form three rows on desktop and one column on mobile. The film hero, signature gallery, side-label photograph, and compact footer keep their approved assets and layout.

Run `node scripts/prepare-film-campaign-assets.mjs` only after the six final PNGs in `../../campaign_film_life_v2/final/` are approved and complete. The encoder preserves sources and creates native-resolution main images up to 1600px wide, plus 640px thumbnails, under `public/assets/film-campaign/`. It does not enlarge, crop, retouch or change typography. The private `../../campaign_film_life_v2/web-assets.json` manifest records source/output hashes, dimensions and byte sizes.

The page loads campaign images lazily and offers 640px and native-width sources so larger or high-density displays can show crisp grain and typography. Opening an ad requests its full image and applies its native width and height to the dialog image. Keyboard arrows, Home and End navigate all six selected ads; Escape closes the dialog and returns focus. The full campaign collection remains separate from this website selection.

The production build includes only these twelve campaign derivatives and the existing four film-hero derivatives. Earlier `analog` and `type90s` campaign assets remain in source history for reverting and are omitted from the deployed build.

Validation uses the existing browser and production-preview checks, with desktop/mobile visual review of all six cards and dialog navigation. Restore the normal build with `npm run build` after the preview check intentionally disables unavailable cloud signup storage.
