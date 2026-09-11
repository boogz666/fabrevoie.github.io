# Film hero photography

The hero uses coordinated wide and mobile photographs inspired by the approved painted-bottle study, with a more photographic finish. Site headings remain HTML text. Campaign ads, the product gallery, the side-label view, and footer branding keep their existing assets and layout.

After source approval, run `node scripts/prepare-film-hero-assets.mjs`. It reads `../../website_film_hero_v1/generated/HERO_WIDE.png` and `HERO_MOBILE.png` and creates four responsive sRGB WebP assets under `public/assets/film-hero/`.

The encoder uses each source's actual native dimensions, never enlarges, and makes no crops or image edits. The wide image is encoded at up to 2400px and 960px; the mobile image at up to 1600px and 640px. HTML width, height and `srcset` descriptors must match the resulting dimensions. A private manifest at `../../website_film_hero_v1/web-assets.json` records source and output hashes, dimensions, and byte sizes.

The approved wide original is 1672 × 941; the portrait is 1122 × 1402. Their main WebP files retain those native dimensions. Smaller versions are 960 × 540 and 640 × 800 respectively.

The desktop hero keeps copy at the left and the bottle toward the right. Tablet framing around 768px must retain the complete cap and base under the hero's cover crop. Mobile uses the coordinated portrait image to preserve the bottle and its label.

The mobile photograph remains fully contained in its existing frame, with deep navy margins and a white FF corner mark. Existing desktop cover positioning and text remain unchanged.

Validate with the existing browser and production-preview checks, inspecting the hero at desktop, 768px and phone widths. Restore the normal build with `npm run build` after the preview check intentionally disables unavailable cloud signup storage.
