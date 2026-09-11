# The pleasure is yours. — B2 campaign assets

The approved product is ULTRA MACHO IRIS in the GALA100 bottle, with the B2 clear square glass crown, rounded internal cavity and short smooth silver collar. The body is 56.5 × 41.5 × 95.4 mm, with the cap above it. The collar has no decorative circumferential grooves. Product lettering, iris liquid, glass and side label remain in the native Blender model.

## Delivery media

All paths below are under `public/assets/pleasure/`. Original artwork is preserved in the local `campaign_b2_pleasure_v1` project outside the deployable website.

| Website asset | Final source | Delivery |
| --- | --- | --- |
| `web-hero-wide.webp` | `blender/WEB_HERO_WIDE.png` | 2400 × 1350, WebP 90; 960 px responsive alternative at quality 80 |
| `web-product-front.webp` | `blender/WEB_PRODUCT_FRONT.png` | 1600 × 2000, WebP 90 |
| `web-product-three-quarter.webp` | `blender/WEB_PRODUCT_THREE_QUARTER.png` | 1600 × 2000, WebP 90 |
| `web-cap-detail.webp` | `blender/WEB_CAP_DETAIL.png` | 1600 × 1600, WebP 90 |
| `campaign-01.webp` through `campaign-10.webp` | Numbered final artwork in `design/exports/` | 1600 × 2000, WebP 90; matching `-640.webp` thumbnails at quality 80 |
| `og-pleasure.jpg` | Native wide hero | 1200 × 630 social image, JPEG 92, 4:4:4 chroma |

The ten final ads combine five native Blender editorial sets, three original generated lifestyle photographs and two genuine licensed photographs. Every ad shows the exact native B2 product; lifestyle panels do not regenerate the bottle. Photoshop masters preserve typography, the supplied wordmark/FF artwork, photographic layers and restrained print finishing. Source and layer reports accompany the masters in `design/exports/`; genuine-photo license records are retained in `design/stock/provenance.json`.

`node scripts/prepare-pleasure-assets.mjs` converts only completed final sources using Sharp. `--available` imports finished files while rendering continues and marks its manifest partial. Final import requires all 26 media derivatives. The script rejects pilot dimensions, incomplete producer records and unexpected transparency, preserves source files, tags output sRGB and records source/output SHA-256 hashes, dimensions, byte sizes and operations in `public/assets/pleasure/manifest.json`.

Product and ad compositions are resized without cropping. The social image alone receives a centered crop, checked against native camera bounds to keep the whole bottle visible. The full-size ads open in a keyboard-accessible dialog; the two leading ads have responsive full-size alternatives and all thumbnails load lazily.

## Branding

The original FNAME wordmark and FF monogram remain unchanged. The supporting slogan is **The pleasure is yours.** Wide italic headings use the existing local Helvetica Neue LT Pro Black Extended Oblique, with Founders Grotesk for interface and body text. Website colours are ink `#151516`, ivory `#F2EFE9`, restrained iris `#C1B3D2`, warm mist `#E3DFDA` and silver `#B9B5B3`.

Historical campaigns and the original sneaker source remain in git. The build copies only assets referenced by the current public HTML/CSS/JavaScript; older bottle images, private source records and the conversion script are excluded from the deployment.
