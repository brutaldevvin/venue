#!/usr/bin/env python3
"""
Derive the brand assets from the supplied lockup.

    python3 scripts/build-brand.py [logo.PNG]

The source is a rendered lockup: it already carries an alpha channel, but the RGB under
partial alpha is a muddy grey from the mockup's glow, and there is a wide field of very low
alpha bloom around the artwork. Both are fixed here rather than by hand, so re-exporting the
logo is one command away from updated assets.

Outputs, all white-on-transparent unless stated:

    apps/console/public/venue-lockup.png   glyph + wordmark, for the chrome
    apps/console/public/venue-mark.png     glyph alone, square
    apps/console/app/icon.png              favicon, white glyph on indigo, rounded
    brand/venue-icon.png                   512x512 form upload
    brand/venue-lockup.png                 full lockup
    brand/venue-lockup-indigo.png          lockup in indigo, for pale grounds
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
INDIGO = (30, 30, 190)

# Alpha below this is mockup bloom rather than artwork. Chosen from the column profile:
# the glyph and wordmark both sit far above it, and the glow far below.
BLOOM = 40
# The gap between the ladder glyph and the "Venue" wordmark, in source pixels.
GLYPH_END = 648


def load(src: Path) -> Image.Image:
    """Force the artwork to pure white, keeping its alpha so antialiasing survives."""
    im = Image.open(src).convert("RGBA")
    alpha = im.getchannel("A")
    white = Image.new("RGBA", im.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    return white


def trim(im: Image.Image, threshold: int = BLOOM) -> Image.Image:
    """Crop to the artwork, ignoring the bloom that would otherwise span the whole canvas."""
    mask = im.getchannel("A").point(lambda v: 255 if v > threshold else 0)
    box = mask.getbbox()
    return im.crop(box) if box else im


def pad_square(im: Image.Image, margin: float = 0.10) -> Image.Image:
    """Centre on a square canvas with breathing room, so icons are not edge to edge."""
    side = int(max(im.size) * (1 + margin * 2))
    out = Image.new("RGBA", (side, side), (255, 255, 255, 0))
    out.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return out


def rounded_tile(art: Image.Image, size: int, radius: int, bg) -> Image.Image:
    """The form upload: white artwork on an indigo tile with a rounded mask."""
    tile = Image.new("RGBA", (size, size), (*bg, 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    tile.putalpha(mask)

    # Fit the artwork into the flat middle of the tile, clear of the corner radius.
    inner = int(size * 0.62)
    scaled = art.copy()
    scaled.thumbnail((inner, inner), Image.LANCZOS)
    tile.paste(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2), scaled)
    return tile


def recolour(im: Image.Image, rgb) -> Image.Image:
    out = Image.new("RGBA", im.size, (*rgb, 0))
    out.putalpha(im.getchannel("A"))
    return out


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "logo.PNG"
    if not src.exists():
        raise SystemExit(f"no logo at {src}")

    art = load(src)
    lockup = trim(art)
    mark = trim(art.crop((0, 0, GLYPH_END, art.height)))

    public = ROOT / "apps" / "console" / "public"
    brand = ROOT / "brand"
    appdir = ROOT / "apps" / "console" / "app"
    brand.mkdir(exist_ok=True)
    public.mkdir(parents=True, exist_ok=True)

    outputs = []

    # Chrome lockup. Capped in height so the browser is not decoding a 1024px tall PNG for a
    # 26px slot.
    chrome = lockup.copy()
    chrome.thumbnail((2000, 120), Image.LANCZOS)
    chrome.save(public / "venue-lockup.png")
    outputs.append((public / "venue-lockup.png", chrome.size))

    mark_sq = pad_square(mark)
    mark_out = mark_sq.copy()
    mark_out.thumbnail((256, 256), Image.LANCZOS)
    mark_out.save(public / "venue-mark.png")
    outputs.append((public / "venue-mark.png", mark_out.size))

    # Favicon. Next serves app/icon.png automatically at /icon.png with the right headers.
    icon = rounded_tile(mark_sq, 256, 56, INDIGO)
    icon.save(appdir / "icon.png")
    outputs.append((appdir / "icon.png", icon.size))

    # 512x512, radius 112, white on #1E1EBE.
    form = rounded_tile(mark_sq, 512, 112, INDIGO)
    form.save(brand / "venue-icon.png")
    outputs.append((brand / "venue-icon.png", form.size))

    lockup.save(brand / "venue-lockup.png")
    outputs.append((brand / "venue-lockup.png", lockup.size))

    indigo_lockup = recolour(lockup, INDIGO)
    indigo_lockup.save(brand / "venue-lockup-indigo.png")
    outputs.append((brand / "venue-lockup-indigo.png", indigo_lockup.size))

    for path, size in outputs:
        print(f"  {path.relative_to(ROOT)}  {size[0]}x{size[1]}  {path.stat().st_size // 1024}kb")


if __name__ == "__main__":
    main()
