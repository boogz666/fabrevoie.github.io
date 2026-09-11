# Signature gallery and campaign selection

The product gallery opens with the existing B2 three-quarter Signature photograph, followed by Glass & silver and a dedicated side-label view. The side photograph replaces the former front view and shows the approved clear square glass cap, smooth silver collar and silver-on-black side label.

The campaign contains only FAST LIFE 02, **OVERQUALIFIED.**, and 06, **ZERO INTEREST IN ORDINARY.** Both remain complete 4:5 advertisements, with responsive previews and full-size lightbox images. Earlier artwork remains in source history.

The footer wordmark is 160 px on desktop and 140 px on mobile, with reduced surrounding padding.

## Media sources

- Campaign sources: `campaign_fast_life_v1/design/exports/02_OVERQUALIFIED.png` and `06_ORDINARY.png` in the surrounding artwork workspace. Final image-generated scenes with Photoshop typography and finishing.
- Side photograph: `website_signature_refresh_v1/WEB_PRODUCT_SIDE.png`, created with the built-in image generator using the current B2 product photograph and approved side-label design. Actual prompt and reference paths are retained in the adjacent JSON file.
- `scripts/prepare-signature-assets.mjs` performs only whole-image resize and sRGB WebP encoding. Campaign images are 1600 x 2000 with 640 x 800 previews; the new side image retains its native 1122 x 1402 size. Source images are preserved.

## Validation

- Production build: 17 referenced assets, 1.88 MB.
- Existing browser suite: all 47 checks passed, including gallery navigation, two-ad lightbox wrapping, signup persistence and withdrawal, footer sizing and layouts from 320 to 1920 px.
- No unexpected browser errors or automated desktop/mobile WCAG A/AA violations. Desktop/mobile page screenshots and the side-label photograph were visually reviewed.
