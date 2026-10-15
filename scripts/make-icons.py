"""Builds every icon and installer image from the logo artwork.

Sources: build/logo-source.png (the hexagon and crystal on a white tile) and
build/logo-source-dark.png (the same on black). The white one is cut out onto
transparency for the app icon and light surfaces; the dark one keeps its
black background as a rounded tile for dark surfaces.
Run: python3 scripts/make-icons.py   (needs Pillow and NumPy)
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "build" / "logo-source.png"
# Square around the hexagon (its bounding box is x 293-960, y 208-1052).
CROP = (156, 160, 1096, 1100)
# The dark artwork (hexagon on black), used wherever the background is dark.
SRC_DARK = ROOT / "build" / "logo-source-dark.png"
CROP_DARK = (122, 70, 1122, 1070)


def cutout() -> Image.Image:
    """The mark on transparency, at source resolution."""
    rgb = np.asarray(Image.open(SRC).convert("RGB").crop(CROP)).astype(np.float32)
    n = rgb.shape[0]
    lum = rgb.mean(axis=2)
    # The stone is dark and the tile is near white; its soft shadow sits in between.
    alpha = np.clip((214.0 - lum) / 12.0, 0.0, 1.0)
    # Keep only the round area around the hexagon, dropping the tile's corners.
    y, x = np.mgrid[0:n, 0:n]
    dist = np.sqrt((x - n / 2) ** 2 + (y - n / 2) ** 2)
    alpha *= np.clip((n * 0.5 - dist) / 20.0, 0.0, 1.0)
    # Remove the white the edges were blended with, so no light fringe shows on dark backgrounds.
    a = np.maximum(alpha, 1e-3)[..., None]
    color = np.clip((rgb - (1.0 - a) * 247.0) / a, 0, 255)
    out = np.dstack([color, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def dark_tile(size: int) -> Image.Image:
    """The dark artwork on its own rounded black tile (the stone's darkest faces
    match the background, so it keeps its background). A fine edge keeps the
    tile visible on dark surfaces."""
    s = size * 4
    art = Image.open(SRC_DARK).convert("RGB").crop(CROP_DARK).resize((s, s), Image.LANCZOS)
    a = np.asarray(art).astype(np.int16)
    a[a.max(axis=2) < 16] = 0  # drop the source's faint tile edge
    t = np.linspace(0, 1, s)[:, None, None]
    tile = (np.array([22, 21, 27]) * (1 - t) + np.array([8, 8, 11]) * t) * np.ones((s, s, 3))
    lit = np.maximum(tile, a).astype(np.uint8)
    out = Image.fromarray(lit, "RGB").convert("RGBA")
    radius = int(s * 0.225)
    edge = Image.new("L", (s, s), 0)
    ImageDraw.Draw(edge).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, outline=255, width=max(4, s // 140))
    out = Image.composite(Image.new("RGBA", (s, s), (60, 58, 70, 255)), out, edge)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
    out.putalpha(mask)
    return out.resize((size, size), Image.LANCZOS)


MARK = None


def icon(size: int) -> Image.Image:
    """The mark at a given size. Small sizes get a faint light rim so they stay
    visible on a dark taskbar."""
    global MARK
    if MARK is None:
        MARK = cutout()
    pad = 0 if size >= 64 else max(1, size // 24)
    inner = size - pad * 2
    mark = MARK.resize((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if size <= 48:
        rim_alpha = mark.getchannel("A").filter(ImageFilter.MaxFilter(3))
        rim = Image.new("RGBA", (inner, inner), (210, 210, 222, 0))
        rim.putalpha(rim_alpha.point(lambda v: v * 70 // 255))
        out.alpha_composite(rim, (pad, pad))
    out.alpha_composite(mark, (pad, pad))
    return out


def font(size: int, bold=True):
    for p in [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf" if bold else "/usr/share/fonts/opentype/inter/Inter-Regular.otf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    build = ROOT / "build"
    assets = ROOT / "assets"
    (assets / "discord").mkdir(parents=True, exist_ok=True)
    (ROOT / "installer" / "assets").mkdir(parents=True, exist_ok=True)

    icon(512).save(build / "icon.png")
    icon(256).save(assets / "icon.png")
    dark_tile(128).save(assets / "logo.png")
    icon(128).save(assets / "logo-light.png")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [icon(s) for s in sizes]
    frames[-1].save(build / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[:-1])

    # Raw RGBA for the custom installer: window icon and the logo it draws.
    (ROOT / "installer" / "assets" / "icon64.rgba").write_bytes(icon(64).tobytes())
    (ROOT / "installer" / "assets" / "logo160.rgba").write_bytes(dark_tile(160).tobytes())

    # Discord art: the mark on a light tile so it reads in Discord's dark UI.
    d = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    ImageDraw.Draw(d).rounded_rectangle([0, 0, 1023, 1023], radius=220, fill=(242, 242, 246, 255))
    d.alpha_composite(icon(800), (112, 112))
    d.save(assets / "discord" / "obsidian.png")

    # NSIS images for the standard full installer.
    side = Image.new("RGBA", (164, 314), (246, 246, 249, 255))
    side.alpha_composite(icon(96), (34, 70))
    draw = ImageDraw.Draw(side)
    draw.text((82, 196), "Obsidian", font=font(20), fill=(20, 18, 26), anchor="mm")
    draw.text((82, 220), "Minecraft launcher", font=font(11, bold=False), fill=(110, 106, 124), anchor="mm")
    side.convert("RGB").save(build / "installerSidebar.bmp", "BMP")

    header = Image.new("RGBA", (150, 57), (255, 255, 255, 255))
    header.alpha_composite(icon(44), (100, 6))
    ImageDraw.Draw(header).text((92, 28), "Obsidian", font=font(13), fill=(24, 22, 30), anchor="rm")
    header.convert("RGB").save(build / "installerHeader.bmp", "BMP")
    print("icons written")


if __name__ == "__main__":
    main()
