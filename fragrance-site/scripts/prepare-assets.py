"""Prepare website delivery assets without modifying any source artwork.

Run with the project's Python interpreter; requires Pillow, fontTools and brotli.
Only crops transparent logo margins, applies the requested black monogram colour,
subsets fonts, and resizes/encodes existing photographs. No scene alterations.
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

from PIL import Image
from fontTools import subset
from fontTools.ttLib import TTFont


WEBSITE = Path(__file__).resolve().parents[1]
PROJECT = WEBSITE.parent
OUT = WEBSITE / "public" / "assets"
FONTS = Path.home() / "AppData/Local/Microsoft/Windows/Fonts"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def asset_record(path: Path, source: Path, **extra: object) -> dict:
    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": digest(path),
        "source": str(source.relative_to(PROJECT)) if source.is_relative_to(PROJECT) else f"user-installed-fonts/{source.name}",
        "source_sha256": digest(source),
        **extra,
    }


def prepare_photographs() -> list[dict]:
    specs = [
        ("hero-stone", "campaign_v11/G01_STONE_PLATE.png", 1086, (59, 48), "Generated campaign photograph; sandstone and distant open landscape."),
        ("campaign-water", "campaign_v11/G04_WATER_PLATE.png", 1086, (50, 47), "Generated campaign photograph; open water and wet stone at sunset."),
        ("bottle-studio", "shoot_v6/01_SILVER_HERO.png", 1600, (52, 50), "Native Blender V6 render; canonical bottle, neutral studio, three-quarter front view."),
        ("bottle-front", "shoot_v6/02_FRONT_PORTRAIT.png", 1600, (50, 51), "Native Blender V6 render; canonical bottle, neutral studio, straight front view."),
        ("bottle-side", "shoot_v6/03_SIDE_SIGNATURE.png", 1280, (50, 49), "Native Blender V6 render; canonical silver-outline side plaque."),
        ("detail-glass", "shoot_v6/05_CAP_DETAIL.png", 1600, (52, 54), "Native Blender V6 render; close view of silver cap, amber liquid and glass shoulder."),
        ("smoked-glass", "campaign_v11/B05_SMOKED_GLASS.png", 1800, (66, 54), "Native Blender V11 render; canonical bottle on smoked bronze glass."),
        ("archive-desk", "campaign_v11/B06_WALNUT.png", 1800, (65, 54), "Native Blender V11 render; canonical bottle, walnut desk, leather journal and brass pen."),
    ]
    records = []
    for name, relative, max_width, focal, provenance in specs:
        source = PROJECT / relative
        with Image.open(source) as original:
            # These rendered PNGs have opaque alpha; flattening keeps RGB unchanged.
            if original.mode == "RGBA" and original.getchannel("A").getextrema() != (255, 255):
                raise ValueError(f"Unexpected transparency in photographic source: {source}")
            rgb = original.convert("RGB")
            for width in dict.fromkeys([min(max_width, rgb.width), 720]):
                suffix = "" if width == min(max_width, rgb.width) else "-720"
                size = (width, round(rgb.height * width / rgb.width))
                image = rgb if size == rgb.size else rgb.resize(size, Image.Resampling.LANCZOS)
                destination = OUT / f"{name}{suffix}.webp"
                image.save(destination, "WEBP", quality=93, method=6, exact=True)
                records.append(asset_record(destination, source, width=size[0], height=size[1], focal_percent=list(focal), provenance=provenance))
    return records


def prepare_logos() -> list[dict]:
    records = []
    for name, filename, force_black, title in [
        ("brand-wordmark", "FNAME.png", False, "FABREVOIE"),
        ("brand-monogram", "FF LETTER LOGO11.png", True, "FABREVOIE double FF monogram"),
    ]:
        source = PROJECT / filename
        original = Image.open(source).convert("RGBA")
        bounds = original.getchannel("A").getbbox()
        cropped = original.crop(bounds)
        if force_black:
            black = Image.new("RGBA", cropped.size, (0, 0, 0, 0))
            black.putalpha(cropped.getchannel("A"))
            cropped = black
        destination = OUT / f"{name}.png"
        cropped.save(destination, optimize=True)
        encoded = base64.b64encode(destination.read_bytes()).decode("ascii")
        svg = OUT / f"{name}.svg"
        width, height = cropped.size
        svg.write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="{title}">'
            f'<title>{title}</title><image width="{width}" height="{height}" href="data:image/png;base64,{encoded}"/></svg>\n',
            encoding="utf-8",
        )
        for output in [destination, svg]:
            records.append(asset_record(output, source, width=width, height=height, transparent_crop=list(bounds), provenance="Original supplied alpha silhouette; transparent margins cropped losslessly." + (" RGB set to requested black; alpha unchanged." if force_black else " Original RGBA pixels unchanged.")))
    return records


def prepare_fonts() -> list[dict]:
    records = []
    choices = [
        ("garamond-display.woff2", "GaramondPremrPro-LtDisp.otf"),
        ("garamond-display-italic.woff2", "GaramondPremrPro-LtItDisp.otf"),
        ("founders-regular.woff2", "FoundersGrotesk-Regular.otf"),
        ("founders-medium.woff2", "FoundersGrotesk-Medium.otf"),
    ]
    codepoints = list(range(0x20, 0x250)) + list(range(0x1E00, 0x1F00)) + list(range(0x2000, 0x2070)) + [0x20AC, 0x2122, 0x2190, 0x2192, 0x2212]
    for filename, original_name in choices:
        source = FONTS / original_name
        font = TTFont(source)
        embedding_flag = font["OS/2"].fsType
        # Respect restricted and no-subsetting flags rather than silently altering.
        if embedding_flag & (0x0002 | 0x0100 | 0x0200):
            raise ValueError(f"Font disallows this embedding/subsetting operation: {source}, fsType={embedding_flag}")
        options = subset.Options()
        options.layout_features = ["*"]
        options.name_IDs = [1, 2, 3, 4, 5, 6, 16, 17]
        options.name_legacy = True
        options.name_languages = [0x409]
        sub = subset.Subsetter(options=options)
        sub.populate(unicodes=codepoints)
        sub.subset(font)
        font.flavor = "woff2"
        destination = OUT / filename
        font.save(destination)
        records.append(asset_record(destination, source, fs_type=embedding_flag, glyphs=len(font.getGlyphOrder()), provenance="User-installed font; Latin/extended Latin, typography punctuation, euro and arrows subset."))
    return records


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    records = prepare_photographs() + prepare_logos() + prepare_fonts()
    (OUT / "asset-manifest.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
    for row in records:
        print(f"{row['file']}: {row['bytes']:,} bytes" + (f"; {row['width']} x {row['height']}" if "width" in row else f"; {row['glyphs']} glyphs"))


if __name__ == "__main__":
    main()
