# Archived Iris campaign assets

This document records the previous campaign. Current media, approved B2 packaging, provenance and export instructions are in [PLEASURE-ASSETS.md](PLEASURE-ASSETS.md).

The current website uses the approved original rectangular Iris flask with its new rectangular silver cap. The cap has subtly convex side faces and defined corners. Product text, liquid, glass, silver finish and the black/silver side plaque are native Blender geometry and materials.

## Images

| Website asset | Source | Role |
| --- | --- | --- |
| `iris-hero.webp` | `campaign_iris_v1/01_HERO_WIDE.png` | Wide native editorial hero; bottle right, left space for live headings |
| `iris-campaign-01.webp` | `campaign_iris_v1/artwork/01_MAKE_AN_IMPRESSION.png` | English advertisement over the new stone photograph |
| `iris-campaign-02.webp` | `campaign_iris_v1/artwork/02_A_SIGNATURE_OF_YOUR_OWN.png` | English advertisement over the new sculpted-paper photograph |
| `iris-studio.webp` | `iris_cap_v2/IRIS_RECTANGULAR_CAP_HERO.png` | Exact approved studio bottle, 1200 x 1500 |
| `iris-detail.webp` | `iris_cap_v2/IRIS_RECTANGULAR_CAP_DETAIL.png` | In-focus silver cap and glass close-up, 1000 x 1000 |
| `iris-side.webp` | `campaign_iris_v1/04_SIDE_SIGNATURE.png` | Native view of the side label |

Every image has a whole-frame `-720.webp` version. `scripts/prepare-iris-assets.py` preserves the source composition and RGB colour, resizes using Lanczos and encodes WebP at quality 90. The script does not repaint, crop, recolour or regenerate the bottle. Exact dimensions, bytes, source hashes and output hashes are recorded in `public/assets/iris-asset-manifest.json`.

The two advertisement compositions are editable HTML/CSS in `campaign_iris_v1/artwork/`, exported through Chromium. Their typography is rendered from the actual local fonts, and their logos reuse the supplied artwork. All current photographs are native Blender renders, with no image generation in this campaign.

## Palette and typography

| Colour | Value |
| --- | --- |
| Graphite | `#17161B` |
| Chalk white | `#F5F4F7` |
| Lavender | `#C4B2EC` |
| Lilac mist | `#E5DFF0` |
| Silver grey | `#B8B8C0` |

Headings use `helvetica-black-extended-oblique.woff2`, exported from the user's installed `HelveticaNeueLTPro-BlkExO.otf`, at 900 italic. Founders Grotesk supplies regular, medium and bold text. The broad italic uppercase treatment follows the sneaker site's Druk Wide direction. The actual trial Druk and personal-use SuperRich files are not embedded in this website.

The existing FNAME wordmark and FF monogram are unchanged. The FF artwork appears in graphite/black or reversed for contrast, and remains a small corner signature on the advertisements. NEVER APOLOGIZE remains a secondary slogan.

`prepare-iris-assets.py` exports the added font files as WOFF2 and records their original source hashes. User-installed originals, earlier campaigns, preceding colour studies and the original sneaker site are preserved. The production build includes only assets referenced by the current HTML/CSS/JavaScript; source inventories stay unpublished.
