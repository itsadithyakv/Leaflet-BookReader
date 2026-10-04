"""Renders Leaflet's Windows icons: Pip with a book, on nothing, drawn afresh
at every size Windows asks for.

    node apps/scripts/pip-logo.mjs                  (draws the logo itself)
    python apps/src-tauri/msix/windows-icons.py

Needs Pillow. Writes into src-tauri/icons:

- Square44x44Logo.targetsize-*.png (plain, altform-unplated and
  altform-lightunplated): the taskbar, Start, the app list and Explorer. makepri
  in build-msix.ps1 indexes them; without the index Windows ignores them.
- Square44x44Logo.png, Square150x150Logo.png, Square310x310Logo.png,
  Wide310x150Logo.png, StoreLogo.png: the manifest's logos.
- icon.ico: the .exe and its windows (title bar, Alt+Tab).
- 32x32.png, 128x128.png, 128x128@2x.png, icon.png: the rest of Tauri's set.
and into brand/store-logos: the 300, 150 and 71 px logos the Store listing asks for.

There is no tile behind Pip. The icon used to be Pip standing on a cream
rounded square, which on the taskbar read as a small figure in a box and gave
a fifth of the icon to the box. The logo has a thin light edge of its own, so
it sits on a dark taskbar and a light one alike, and it fills the icon.

Why not scale one image: Pip is 32-pixel art. Stretched 1.5x to the 48 px icon
Start uses at 150% scaling, some of its pixels became one screen pixel and some
two, so the eyes and outline went ragged. Here each size puts Pip at a
whole-number scale where one nearly fills the icon, so every pixel of Pip stays
square. Where none does, Pip is scaled by exact area averaging: soft at the
seams, never lopsided.
"""

from pathlib import Path

from PIL import Image

apps = Path(__file__).resolve().parents[2]
icons = apps / "src-tauri" / "icons"
store = apps.parent / "brand" / "store-logos"
sprite = Image.open(apps / "src" / "assets" / "pip" / "pip-32.png").convert("RGBA")
pip = sprite.crop(sprite.getbbox())  # 24 x 31, with its light edge

# How much of the icon's height Pip takes when no whole-number scale suits.
FILL = 0.94
# A whole-number scale is used when it puts Pip within this share of the
# icon's height: a crisp Pip a little smaller reads better than a softened one
# that fills it.
CRISP_SHARE = (0.75, 1.0)
SUPERSAMPLE = 8


def pip_at(size: int) -> Image.Image:
    """Pip sized for an icon `size` pixels tall: crisp when it can be."""
    crisp = [k for k in range(1, 64) if CRISP_SHARE[0] <= k * pip.height / size <= CRISP_SHARE[1]]
    if crisp:
        k = max(crisp)
        return pip.resize((pip.width * k, pip.height * k), Image.NEAREST)
    height = FILL * size
    width = height * pip.width / pip.height
    big = pip.resize((pip.width * SUPERSAMPLE, pip.height * SUPERSAMPLE), Image.NEAREST)
    return big.resize((max(1, round(width)), max(1, round(height))), Image.BOX)


def icon(width: int, height: int | None = None) -> Image.Image:
    height = height or width
    art = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    figure = pip_at(min(width, height))
    art.alpha_composite(figure, ((width - figure.width) // 2, (height - figure.height) // 2))
    return art


def save(image: Image.Image, name: str, folder: Path = icons) -> None:
    image.save(folder / name, optimize=True)


# Every target size Windows picks from, at every display scale.
for size in (16, 20, 24, 30, 32, 36, 40, 44, 48, 60, 64, 72, 80, 96, 256):
    image = icon(size)
    # The logo carries its own light edge, so plated and unplated (dark or
    # light taskbar) are the same picture.
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

# The Store listing's own logos (Partner Center, uploaded by hand).
store.mkdir(parents=True, exist_ok=True)
for size in (300, 150, 71):
    save(icon(size), f"leaflet-store-{size}x{size}.png", store)
print(f"Wrote the Windows icons to {icons} and the Store logos to {store}")
