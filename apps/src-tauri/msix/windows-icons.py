"""Renders Leaflet's Windows icons: a green book, on nothing, drawn afresh at
every size Windows asks for.

    python apps/src-tauri/msix/windows-icons.py

Needs Pillow. The book is drawn here (`BOOKS`, below), twice. Writes into
src/assets/pip the two drawings (app-icon-16.png, app-icon-18.png), the
smaller one large (app-icon-512.png) and public/favicon.png; and into
src-tauri/icons:

- Square44x44Logo.targetsize-*.png (plain, altform-unplated and
  altform-lightunplated): the taskbar, Start, the app list and Explorer. makepri
  in build-msix.ps1 indexes them; without the index Windows ignores them.
- Square44x44Logo.png, Square150x150Logo.png, Square310x310Logo.png,
  Wide310x150Logo.png, StoreLogo.png: the manifest's logos.
- icon.ico: the .exe and its windows (title bar, Alt+Tab).
- 32x32.png, 128x128.png, 128x128@2x.png, icon.png: the rest of Tauri's set.
and into brand/store-logos: the 300, 150 and 71 px logos the Store listing asks for.

The icon is a book: a green one, closed, its pages showing at the side and
the foot, a leaf on its cover and a ribbon hanging out of it. It was Pip
standing on a cream tile (a small figure in a box), then Pip sitting with a
book on nothing (narrow, the book a few pixels of noise on a taskbar), then
Pip's face alone, which filled the square and said nothing of what the app is
for: in the Store, among other icons, a face is a game or a pet. A book is a
reader. It is in the app's own green, and drawn on the same grid as Pip.

Why not scale one image: it is pixel art. Stretched by anything but a whole
number, some of its pixels become one screen pixel and some two, and the
leaf and outline go ragged. So there are two drawings, 16 and 18 pixels
square (18 is exact at 36 px, a taskbar at 150%, and at 72; 16 at 16, 32, 48
and 64), and each size uses whichever fills more of it at a whole-number
scale. Where neither comes to four fifths of the icon (24 and 30 px), the
smaller is scaled to the whole icon by exact area averaging: soft at the
seams, never lopsided.
"""

from pathlib import Path

from PIL import Image

apps = Path(__file__).resolve().parents[2]
icons = apps / "src-tauri" / "icons"
store = apps.parent / "brand" / "store-logos"
assets = apps / "src" / "assets" / "pip"

# What the book is drawn in: the app's own greens (index.css: primary, its
# deep and its container), Pip's outline, and cream for paper.
INK = {
    ".": (0, 0, 0, 0),
    "o": (31, 42, 34, 255),     # the outline
    "G": (114, 171, 68, 255),   # the cover
    "H": (150, 204, 98, 255),   # the cover's top edge, in the light
    "D": (70, 128, 55, 255),    # the cover's foot, in shade
    "S": (46, 97, 54, 255),     # the spine, and the back cover under the pages
    "P": (255, 251, 240, 255),  # the pages
    "p": (224, 216, 190, 255),  # the pages' corner, in shade
    "L": (255, 251, 240, 255),  # the leaf on the cover
    "R": (242, 184, 75, 255),   # the ribbon
}

# The book, 16 and 18 pixels square, each filling its square. The same book
# with a larger leaf, not one stretched: the spine, the pages and the ribbon
# are as many pixels wide in both.
BOOKS = {
    16: """
.ooooooooooooo..
oSSHHHHHHHHHGoo.
oSSGGGGGGGGGGoPo
oSSGGGGGLLLGGoPo
oSSGGGGLLLLLGoPo
oSSGGGLLLGLLGoPo
oSSGGGLLGLLLGoPo
oSSGGGLGLLLGGoPo
oSSGGGLLLLGGGoPo
oSSGGLGGGGGGGoPo
oSSGGGGGGGGGGoPo
oSSDDDDDDDDDDoPo
oSoooooooooooopo
oSPPPPPPPRRPPPPo
oSSSSSSSSRRSSSSo
.ooooooooRRoooo.
""",
    18: """
.ooooooooooooooo..
oSSHHHHHHHHHHHGoo.
oSSGGGGGGGGGGGGoPo
oSSGGGGGGGLLLGGoPo
oSSGGGGGLLLLLLGoPo
oSSGGGGLLLLGLLGoPo
oSSGGGLLLLGLLLGoPo
oSSGGGLLLGLLLLGoPo
oSSGGGLLGLLLLGGoPo
oSSGGGLGLLLLGGGoPo
oSSGGGLLLLGGGGGoPo
oSSGGLGGGGGGGGGoPo
oSSGGGGGGGGGGGGoPo
oSSDDDDDDDDDDDDoPo
oSoooooooooooooopo
oSPPPPPPPPPRRPPPPo
oSSSSSSSSSSRRSSSSo
.ooooooooooRRoooo.
""",
}


def drawn(side: int) -> Image.Image:
    """One of the two drawings, as a picture `side` pixels square."""
    rows = BOOKS[side].strip("\n").split("\n")
    if len(rows) != side or any(len(row) != side for row in rows):
        raise ValueError(f"the {side}-pixel book is not {side} by {side}")
    image = Image.new("RGBA", (side, side))
    for y, row in enumerate(rows):
        for x, mark in enumerate(row):
            image.putpixel((x, y), INK[mark])
    return image


# The two drawings, each a square with no margin, smaller first.
faces = [drawn(side) for side in (16, 18)]
for face in faces:
    face.save(assets / f"app-icon-{face.width}.png", optimize=True)
faces[0].resize((512, 512), Image.NEAREST).save(assets / "app-icon-512.png", optimize=True)
faces[0].resize((64, 64), Image.NEAREST).save(apps / "public" / "favicon.png", optimize=True)

# A whole-number scale is used when it fills at least this share of the icon:
# a crisp face a little smaller reads better than a softened one that fills it.
CRISP_FROM = 0.8
SUPERSAMPLE = 8


def pip_at(size: int) -> Image.Image:
    """The book sized for an icon `size` pixels square: crisp when it can be."""
    # Whichever comes out larger; the larger drawing when they come out the same.
    across, face = max((((size // face.width) * face.width, face) for face in faces), key=lambda pair: (pair[0], pair[1].width))
    if across >= CRISP_FROM * size:
        return face.resize((across, across), Image.NEAREST)
    # The smaller drawing: fewer pixels to soften.
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
    # The book is bright enough for a dark taskbar and outlined for a light
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
