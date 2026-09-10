# Website imagery, identity and typography

Prepared from existing approved project assets. Source files remain untouched.

## Delivery assets

All files are in `public/assets/`. The complete machine-readable source, SHA-256 and dimensions record is `public/assets/asset-manifest.json`.

| Asset | Pixels | Approx. size | Source / role |
| --- | --- | --- | --- |
| `hero-stone.webp` | 1086 × 1448 | 273 KB | `campaign_v11/G01_STONE_PLATE.png`; warm sandstone campaign hero |
| `campaign-water.webp` | 1086 × 1448 | 270 KB | `campaign_v11/G04_WATER_PLATE.png`; sunset water campaign image |
| `bottle-studio.webp` | 1600 × 2000 | 77 KB | `shoot_v6/01_SILVER_HERO.png`; canonical bottle three-quarter studio view |
| `bottle-front.webp` | 1600 × 2000 | 60 KB | `shoot_v6/02_FRONT_PORTRAIT.png`; canonical bottle straight front |
| `bottle-side.webp` | 1280 × 1600 | 44 KB | `shoot_v6/03_SIDE_SIGNATURE.png`; canonical silver-on-black side label |
| `detail-glass.webp` | 1600 × 2000 | 68 KB | `shoot_v6/05_CAP_DETAIL.png`; silver cap and glass shoulder close-up |
| `smoked-glass.webp` | 1800 × 2250 | 166 KB | `campaign_v11/B05_SMOKED_GLASS.png`; native bronze glass set |
| `brand-wordmark.png` | 1994 × 537 | 44 KB | Original `FNAME.png`, lossless transparent margin crop |
| `brand-wordmark.svg` | 1994 × 537 | 59 KB | SVG wrapper embedding the exact cropped PNG; not redrawn vector type |
| `brand-monogram.png` | 1337 × 1568 | 29 KB | Original `FF LETTER LOGO11.png` alpha, recoloured black |
| `brand-monogram.svg` | 1337 × 1568 | 38 KB | SVG wrapper embedding the exact black PNG silhouette; not a trace |

Every photograph also has a `-720.webp` variant, 720 pixels wide, maintaining the full source aspect ratio. Studio/detail variants are 22–30 KB; stone/water are 150–152 KB. The source photograph is resized with Lanczos and encoded as WebP quality 93. No colour grading, retouching, image generation, or composition changes were applied.

### Composition guidance

- **Hero stone:** retain the full 3:4 portrait for the desktop split hero. Bottle centre is approximately 59% horizontal / 48% vertical. Its cap begins at 11% image height and base ends at 83%; avoid aggressive landscape cropping. `object-position: 59% 48%` is a useful fallback for narrower containers.
- **Water:** bottle centre is approximately 50% / 47%. Use the full portrait or a modest centre crop.
- **Studio/front:** centred object, approximately 52% / 50% and 50% / 51%. The native front render is the authoritative readable product view.
- **Cap detail:** focal point approximately 52% / 54%; a tighter portrait macro, not a full bottle view.
- **Smoked glass:** bottle is to the right at approximately 66% / 54%. The upper left is useful negative space for an optional editorial treatment.

The stone and water plates are generated campaign imagery. The V6 studio shots and V11 smoked-glass/desk images are native Blender renders. None should be described as photographs proving physical manufacture. Generated campaign microlettering may vary; use the native studio/front/side images when small packaging copy needs to be authoritative. All imagery depicts the short round silver cap and elongated body, with pale amber liquid.

## Font delivery

| File | CSS weight/style | Installed source |
| --- | --- | --- |
| `garamond-display.woff2` | 300 / normal | `GaramondPremrPro-LtDisp.otf` |
| `garamond-display-italic.woff2` | 300 / italic | `GaramondPremrPro-LtItDisp.otf` |
| `founders-regular.woff2` | 400 / normal | `FoundersGrotesk-Regular.otf` |
| `founders-medium.woff2` | 500 / normal | `FoundersGrotesk-Medium.otf` |

The supplied installed fonts were subset with fontTools to Latin, extended Latin, common typographic punctuation, the euro symbol and arrows. OpenType layout features and relevant naming information are preserved. No trial fonts or Druk font files are embedded. The Druk treatment remains inside existing product imagery and original brand artwork.

Font OS/2 embedding flag is 8 (editable embedding) for all four sources; these metadata flags do not establish a commercial webfont licence. Local preview uses the user's authorized font collection. A public deployment should use the corresponding licensed webfont rights/files.

## Reproduction

`scripts/prepare-assets.py` regenerates these website assets from the unchanged project sources using Pillow, fontTools and brotli. Its output is restricted to the asset names listed here and their manifest. It does not modify other campaign assets. The production build includes only the assets referenced by the current page.

Logo alpha was checked pixel-for-pixel against the original source bounds. The wordmark keeps every original RGBA pixel; the monogram keeps every original alpha value while setting RGB to black. WOFF2 files were reopened successfully and validated for the product heading `ULTRA MACHO`, supporting slogan `NEVER APOLOGIZE.` and website punctuation.
