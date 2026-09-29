"""Renders Leaflet's Windows icons: Pip on the cream tile, drawn afresh at
every size Windows asks for.

    python apps/src-tauri/msix/windows-icons.py

Needs Pillow. Writes into src-tauri/icons:

- Square44x44Logo.targetsize-*.png (plain, altform-unplated and
  altform-lightunplated): the taskbar, Start, the app list and Explorer. makepri
  in build-msix.ps1 indexes them; without the index Windows ignores them.
- Square44x44Logo.png, Square150x150Logo.png, Square310x310Logo.png,
  Wide310x150Logo.png, StoreLogo.png: the manifest's logos.
- icon.ico: the .exe and its windows (title bar, Alt+Tab).
- 32x32.png, 128x128.png, 128x128@2x.png, icon.png: the rest of Tauri's set.

Why not scale one image: Pip is 32-pixel art. Stretched 1.5x to the 48 px icon
Start uses at 150% scaling, some of its pixels became one screen pixel and some
two, so the eyes and outline went ragged, and the thin figure read small next
to solid icons. Here each size draws the tile itself (a plain rounded shape,
sharp at any size) and puts Pip on it at a whole-number scale where one fits,
so every pixel of Pip stays square. Where none fits, Pip is scaled by exact
area averaging: soft at the seams, never lopsided.
"""

from pathlib import Path

from PIL import Image, ImageDraw

apps = Path(__file__).resolve().parents[2]
icons = apps / "src-tauri" / "icons"
sprite = Image.open(apps / "src" / "assets" / "pip" / "pip-32.png").convert("RGBA")
pip = sprite.crop(sprite.getbbox())  # 24 x 29, with its light edge

# The brand tile's colours (src/assets/pip/pip-tile-*.png).
OUTLINE = (31, 42, 34, 255)
HIGHLIGHT = (255, 251, 240, 255)
CREAM = (244, 237, 220, 255)
GROUND = (228, 236, 206, 255)

# Pip's height as a share of the tile's: a little more than on the brand tile
# (29 of 40), since an icon is seen small.
PIP_SHARE = 0.8
# A whole-number scale is used when it puts Pip within this share of the tile.
# Up to nearly all of it: at 32 px a crisp Pip filling the tile reads far
# better than a softened smaller one.
CRISP_SHARE = (0.66, 0.92)
SUPERSAMPLE = 8


def pip_at(size: int) -> Image.Image:
    """Pip sized for a tile `size` pixels tall: crisp when it can be."""
    crisp = [k for k in range(1, 64) if CRISP_SHARE[0] <= k * pip.height / size <= CRISP_SHARE[1]]
    if crisp:
        # The whole-number scale nearest the brand tile's proportions.
        k = min(crisp, key=lambda value: abs(value * pip.height / size - PIP_SHARE))
        return pip.resize((pip.width * k, pip.height * k), Image.NEAREST)
    height = PIP_SHARE * size
    width = height * pip.width / pip.height
    big = pip.resize((pip.width * SUPERSAMPLE, pip.height * SUPERSAMPLE), Image.NEAREST)
    return big.resize((max(1, round(width)), max(1, round(height))), Image.BOX)


def tile(width: int, height: int) -> Image.Image:
    """The cream tile: outline, highlight, cream above and a pale ground below."""
    s = 4
    w, h = width * s, height * s
    unit = max(1, round(min(width, height) / 80))  # a hairline, thickening slowly
    radius = round(min(width, height) * 0.16) * s
    art = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(art)
    draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=OUTLINE)
    o = unit * s
    draw.rounded_rectangle((o, o, w - 1 - o, h - 1 - o), radius=max(0, radius - o), fill=HIGHLIGHT)
    face = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    face_draw = ImageDraw.Draw(face)
    inset = 2 * o
    face_draw.rounded_rectangle((inset, inset, w - 1 - inset, h - 1 - inset), radius=max(0, radius - inset), fill=CREAM)
    ground = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(ground).rectangle((0, round(h * 0.6), w, h), fill=GROUND)
    face.alpha_composite(Image.composite(ground, Image.new("RGBA", (w, h), (0, 0, 0, 0)), face.getchannel("A")))
    art.alpha_composite(face)
    return art.resize((width, height), Image.LANCZOS)


def icon(width: int, height: int | None = None) -> Image.Image:
    height = height or width
    art = tile(width, height)
    figure = pip_at(height)
    # Standing on the ground, with the brand tile's spacing: of the room Pip
    # leaves, a little less below than above.
    x = (width - figure.width) // 2
    y = height - figure.height - round((height - figure.height) * 0.45)
    art.alpha_composite(figure, (x, y))
    return art


def save(image: Image.Image, name: str) -> None:
    image.save(icons / name, optimize=True)


# Every target size Windows picks from, at every display scale.
for size in (16, 20, 24, 30, 32, 36, 40, 44, 48, 60, 64, 72, 80, 96, 256):
    image = icon(size)
    # The tile is its own plate, so plated and unplated (dark or light
    # taskbar) are the same picture.
    for suffix in ("", "_altform-unplated", "_altform-lightunplated"):
        save(image, f"Square44x44Logo.targetsize-{size}{suffix}.png")

save(icon(44), "Square44x44Logo.png")
save(icon(150), "Square150x150Logo.png")
save(icon(310), "Square310x310Logo.png")
save(icon(310, 150), "Wide310x150Logo.png")
save(icon(50), "StoreLogo.png")
for size, name in ((30, "Square30x30Logo.png"), (71, "Square71x71Logo.png"), (89, "Square89x89Logo.png"),
                   (107, "Square107x107Logo.png"), (142, "Square142x142Logo.png"), (284, "Square284x284Logo.png")):
    save(icon(size), name)
save(icon(32), "32x32.png")
save(icon(64), "64x64.png")
save(icon(128), "128x128.png")
save(icon(256), "128x128@2x.png")
save(icon(512), "icon.png")

ico_sizes = (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256)
frames = [icon(size) for size in ico_sizes]
frames[-1].save(icons / "icon.ico", format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=frames[:-1])
print(f"Wrote the Windows icons to {icons}")
