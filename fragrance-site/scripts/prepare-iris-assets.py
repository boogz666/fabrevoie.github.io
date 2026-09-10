"""Encode native Iris campaign plates and browser-composed ads for the website.

No image content is edited: source RGB pixels are only resized and WebP encoded.
Run `py scripts/prepare-iris-assets.py --available` while Blender plates render;
run without the flag once all campaign artwork is ready to require every source.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image
from fontTools import subset
from fontTools.ttLib import TTFont


WEBSITE = Path(__file__).resolve().parents[1]
PROJECT = WEBSITE.parent
OUT = WEBSITE / "public/assets"
FONTS = Path.home() / "AppData/Local/Microsoft/Windows/Fonts"
MANIFEST = OUT / "iris-asset-manifest.json"

PHOTOS = [
    ("iris-hero", "campaign_iris_v1/01_HERO_WIDE.png", 1920, "Native Blender Iris campaign; wide composition with left text space and bottle on right."),
    ("iris-campaign-01", "campaign_iris_v1/artwork/01_MAKE_AN_IMPRESSION.png", 1500, "Native Blender portrait on dark stone, original logos and real local-font typography composed in HTML/CSS and exported in Chromium."),
    ("iris-campaign-02", "campaign_iris_v1/artwork/02_A_SIGNATURE_OF_YOUR_OWN.png", 1500, "Native Blender portrait on sculpted paper, original logos and real local-font typography composed in HTML/CSS and exported in Chromium."),
    ("iris-studio", "iris_cap_v2/IRIS_RECTANGULAR_CAP_HERO.png", 1200, "Native Blender studio view of the approved Iris bottle with rectangular silver cap."),
    ("iris-detail", "iris_cap_v2/IRIS_RECTANGULAR_CAP_DETAIL.png", 1000, "Native Blender close-up of the approved rectangular silver cap, clear glass shoulder and Iris liquid."),
    ("iris-side", "campaign_iris_v1/04_SIDE_SIGNATURE.png", 1200, "Native Blender side view of the approved Iris bottle and black side plaque with silver type and contour."),
]
FONT_SPECS = [
    ("helvetica-black-extended-oblique.woff2", "HelveticaNeueLTPro-BlkExO.otf", "Helvetica Extended", 900, "italic"),
    ("founders-bold.woff2", "FoundersGrotesk-Bold.otf", "Founders", 700, "normal"),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(path: Path, source: Path, **extras: object) -> dict:
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": sha256(path),
            "source": source.relative_to(PROJECT).as_posix() if source.is_relative_to(PROJECT) else f"user-installed-fonts/{source.name}",
            "source_sha256": sha256(source), **extras}


def prepare_fonts() -> list[dict]:
    records = []
    codepoints = list(range(0x20, 0x250)) + list(range(0x1E00, 0x1F00)) + list(range(0x2000, 0x2070)) + [0x20AC, 0x2122, 0x2190, 0x2192, 0x2212]
    for filename, source_name, family, weight, style in FONT_SPECS:
        source = FONTS / source_name
        font = TTFont(source, recalcTimestamp=False)
        fs_type = font["OS/2"].fsType
        options = subset.Options()
        options.layout_features = ["*"]
        options.name_IDs = [1, 2, 3, 4, 5, 6, 16, 17]
        options.name_legacy = True
        options.name_languages = [0x409]
        if not (fs_type & 0x0100):
            worker = subset.Subsetter(options=options)
            worker.populate(unicodes=codepoints)
            worker.subset(font)
        font.flavor = "woff2"
        destination = OUT / filename
        font.save(destination)
        records.append(record(destination, source, family=family, weight=weight, style=style, fs_type=fs_type,
                              glyphs=len(font.getGlyphOrder()), provenance="User-authorized installed font, locally exported to WOFF2. Original local font retained unchanged."))
    return records


def prepare_photos(available_only: bool) -> tuple[list[dict], list[str]]:
    records = []
    missing = []
    for name, relative, max_width, provenance in PHOTOS:
        source = PROJECT / relative
        if not source.is_file():
            missing.append(relative)
            if available_only:
                continue
            raise FileNotFoundError(f"Required campaign source not ready: {source}")
        with Image.open(source) as original:
            if original.mode == "RGBA" and original.getchannel("A").getextrema() != (255, 255):
                raise ValueError(f"Unexpected photographic transparency: {source}")
            rgb = original.convert("RGB")
            for width in dict.fromkeys([min(max_width, rgb.width), min(720, rgb.width)]):
                suffix = "" if width == min(max_width, rgb.width) else "-720"
                size = (width, round(rgb.height * width / rgb.width))
                resized = rgb if size == rgb.size else rgb.resize(size, Image.Resampling.LANCZOS)
                destination = OUT / f"{name}{suffix}.webp"
                resized.save(destination, "WEBP", quality=90, method=6, exact=True)
                records.append(record(destination, source, width=size[0], height=size[1], quality=90,
                                      operation="Whole-image resize and WebP encoding; no crop, retouch or scene alteration.", provenance=provenance))
    return records, missing


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--available", action="store_true", help="Encode available sources without failing for pending renders.")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    photo_records, missing = prepare_photos(args.available)
    records = prepare_fonts() + photo_records
    MANIFEST.write_text(json.dumps({"campaign": "FABREVOIE / ULTRA MACHO / Iris", "status": "partial" if missing else "complete",
                                    "pending_sources": missing, "assets": records}, indent=2) + "\n", encoding="utf-8")
    for item in records:
        dimensions = f" {item['width']}x{item['height']}" if "width" in item else ""
        print(f"{item['file']}: {item['bytes']:,} bytes{dimensions}")
    if missing:
        print(f"Pending native plates/artwork: {len(missing)}")


if __name__ == "__main__":
    main()
