"""Builds every icon and installer image from the logo artwork.

Source: build/logo-source.png (the obsidian hexagon and crystal on black).
Run: python3 scripts/make-icons.py   (needs Pillow and NumPy)
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "build" / "logo-source.png"
SRC_LIGHT = ROOT / "build" / "logo-source-light.png"
# The light artwork already includes its own white tile; this is its bounding square.
LIGHT_TILE = (87, 80, 1169, 1162)

# The hexagon sits at roughly (622, 570) in the source; this square frames it
# with even margins.
CROP = (122, 70, 1122, 1070)


def tile(size: int) -> Image.Image:
    """Rounded dark tile with a soft top light and a fine edge."""
    s = size * 4  # draw large, then downsample for smooth corners
    radius = int(s * 0.225)
    top, bottom = np.array([24, 23, 29]), np.array([9, 9, 12])
    t = np.linspace(0, 1, s)[:, None]
    grad = (top * (1 - t) + bottom * t).astype(np.uint8)
    fill = Image.fromarray(np.repeat(grad[:, None, :], s, axis=1).reshape(s, s, 3), "RGB")
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
    edge = Image.new("L", (s, s), 0)
    w = max(4, s // 160)
    ImageDraw.Draw(edge).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, outline=255, width=w)
    out = fill.convert("RGBA")
    border = Image.new("RGBA", (s, s), (58, 56, 66, 255))
    out = Image.composite(border, out, edge)
    out.putalpha(mask)
    return out.resize((size, size), Image.LANCZOS)


def icon(size: int) -> Image.Image:
    """Full app icon: the artwork blended onto the tile (lighter of the two wins,
    so every stone face survives). Small sizes get a brighter, larger mark."""
    if size >= 128:
        boost, contrast, scale = 1.15, 1.05, 0.9
    elif size >= 48:
        boost, contrast, scale = 1.7, 1.2, 0.96
    else:
        boost, contrast, scale = 2.4, 1.35, 1.0
    base = tile(size)
    art = Image.open(SRC).convert("RGB").crop(CROP)
    # Drop the source's own faint tile edge and background noise.
    a = np.asarray(art).astype(np.int16)
    a[a.max(axis=2) < 18] = 0
    art = Image.fromarray(a.astype(np.uint8), "RGB")
    art = ImageEnhance.Brightness(art).enhance(boost)
    art = ImageEnhance.Contrast(art).enhance(contrast)
    inner = int(size * scale)
    art = art.resize((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    canvas.paste(art, ((size - inner) // 2, (size - inner) // 2))
    lit = np.maximum(np.asarray(base.convert("RGB")), np.asarray(canvas))
    out = Image.fromarray(lit, "RGB").convert("RGBA")
    out.putalpha(base.getchannel("A"))
    return out


def light_icon(size: int) -> Image.Image:
    """The light artwork's own tile, cropped from its drop shadow with clean rounded corners."""
    s = size * 4
    art = Image.open(SRC_LIGHT).convert("RGB").crop(LIGHT_TILE).resize((s, s), Image.LANCZOS)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.2), fill=255)
    out = art.convert("RGBA")
    edge = Image.new("L", (s, s), 0)
    ImageDraw.Draw(edge).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.2), outline=255, width=max(4, s // 160))
    out = Image.composite(Image.new("RGBA", (s, s), (214, 214, 222, 255)), out, edge)
    out.putalpha(mask)
    return out.resize((size, size), Image.LANCZOS)


def to_bmp(img: Image.Image, path: Path):
    img.convert("RGB").save(path, "BMP")


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

    big = icon(1024)
    big.resize((512, 512), Image.LANCZOS).save(build / "icon.png")
    icon(256).save(assets / "icon.png")
    icon(128).save(assets / "logo.png")
    light_icon(128).save(assets / "logo-light.png")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [icon(s) for s in sizes]
    frames[-1].save(build / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[:-1])

    # Raw RGBA for the custom installer: window icon and the logo it draws.
    (ROOT / "installer" / "assets" / "icon64.rgba").write_bytes(icon(64).tobytes())
    (ROOT / "installer" / "assets" / "logo160.rgba").write_bytes(icon(160).tobytes())

    # Discord art: the icon on Discord's dark grey.
    d = Image.new("RGBA", (1024, 1024), (17, 18, 20, 255))
    d.alpha_composite(icon(880), (72, 72))
    d.convert("RGB").save(assets / "discord" / "obsidian.png")

    # NSIS images for the standard full installer.
    side = Image.new("RGBA", (164, 314), (12, 11, 16, 255))
    side.alpha_composite(icon(96), (34, 74))
    draw = ImageDraw.Draw(side)
    draw.text((82, 196), "Obsidian", font=font(20), fill=(240, 238, 246), anchor="mm")
    draw.text((82, 220), "Minecraft launcher", font=font(11, bold=False), fill=(150, 144, 168), anchor="mm")
    to_bmp(side, build / "installerSidebar.bmp")

    header = Image.new("RGBA", (150, 57), (255, 255, 255, 255))
    header.alpha_composite(light_icon(44), (100, 6))
    ImageDraw.Draw(header).text((92, 28), "Obsidian", font=font(13), fill=(24, 22, 30), anchor="rm")
    to_bmp(header, build / "installerHeader.bmp")
    print("icons written")


if __name__ == "__main__":
    main()
