"""Renders Leaflet's Windows icons: Pip's face, on nothing, drawn afresh at
every size Windows asks for.

    node apps/scripts/pip-logo.mjs                  (draws the two faces)
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

The icon is Pip's face and nothing else. It was Pip standing on a cream tile
(a small figure in a box), then Pip sitting with a book on nothing (a figure
24 by 31 in a square: narrow, a third of it leaf, the book a few pixels of
noise on a taskbar). A face is as wide and as tall as the square, and two
eyes and a leaf are what is left of any icon at 24 pixels.

Why not scale one image: Pip is pixel art. Stretched by anything but a whole
number, some of her pixels become one screen pixel and some two, and the eyes
and outline go ragged. So there are two drawings of the face, 16 and 18
pixels square (pip-logo.mjs says why those), and each size uses whichever
fills more of it at a whole-number scale: 16 px is the smaller as it is, 32
and 48 the smaller doubled and tripled, 36 the larger doubled. Where neither
comes to four fifths of the icon (24 and 30 px), the smaller is scaled to the
whole icon by exact area averaging: soft at the seams, never lopsided.
"""

from pathlib import Path

from PIL import Image

apps = Path(__file__).resolve().parents[2]
icons = apps / "src-tauri" / "icons"
store = apps.parent / "brand" / "store-logos"
# The two drawings of the face, each a square with no margin, smaller first.
faces = [Image.open(apps / "src" / "assets" / "pip" / f"pip-face-{side}.png").convert("RGBA") for side in (16, 18)]

# A whole-number scale is used when it fills at least this share of the icon:
# a crisp face a little smaller reads better than a softened one that fills it.
CRISP_FROM = 0.8
SUPERSAMPLE = 8


def pip_at(size: int) -> Image.Image:
    """The face sized for an icon `size` pixels square: crisp when it can be."""
    # Whichever comes out larger; the larger drawing when they come out the same.
    across, face = max((((size // face.width) * face.width, face) for face in faces), key=lambda pair: (pair[0], pair[1].width))
    if across >= CRISP_FROM * size:
        return face.resize((across, across), Image.NEAREST)
    # The smaller drawing: the same eyes on a smaller head, so more face.
    face = faces[0]
    big = face.resize((face.width * SUPERSAMPLE, face.height * SUPERSAMPLE), Image.NEAREST)
    return big.resize((size, size), Image.BOX)


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
    # The face is bright enough for a dark taskbar and outlined for a light
    # one, so plated and unplated are the same picture.
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
