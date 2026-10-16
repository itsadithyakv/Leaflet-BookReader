"""Renders Leaflet's Android launcher icons from the same green book as the
Windows ones, pixel for pixel.

    python apps/src-tauri/msix/android-icons.py

Needs Pillow. Reads the two drawings windows-icons.py writes
(src/assets/pip/app-icon-16.png and app-icon-18.png), so run that first when
the book changes. Writes into src-tauri/gen/android/app/src/main/res:

- mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png: the book on nothing, as on
  Windows, for launchers older than Android 8 (48 dp).
- mipmap-*/ic_launcher_round.png: the same, for the few of those that ask for
  a round icon.
- mipmap-*/ic_launcher_foreground.png and ic_launcher_monochrome.png, and
  values/ic_launcher_background.xml: the adaptive icon (Android 8 and later;
  mipmap-anydpi-v26/ic_launcher.xml and ic_launcher_round.xml put them
  together). The background is the cover's own deep green, so the icon reads
  as one green mark. Not transparent: Android puts every icon on a plate of the
  launcher's shape, and the Pixel launcher fills an empty one with black. The
  monochrome
  layer, which Android 13 tints for themed icons, is the book with its leaf
  and pages cut out of it.
and brand/store-logos/leaflet-play-512.png, the icon Google Play asks for.

Why not `tauri icon`: it scales one picture smoothly, and this is pixel art.
Every size here is one of the two drawings scaled by a whole number, nearest
neighbour, and centred; where the scale does not fill the canvas the rest is
transparent. Each canvas takes whichever drawing comes out larger at the
largest whole scale that fits (the 18 when they tie: its leaf is bigger).
"""

from pathlib import Path

from PIL import Image

apps = Path(__file__).resolve().parents[2]
res = apps / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"
store = apps.parent / "brand" / "store-logos"
assets = apps / "src" / "assets" / "pip"

DRAWINGS = [Image.open(assets / f"app-icon-{side}.png").convert("RGBA") for side in (16, 18)]

# The paper of the pages (windows-icons.py's "P"), and the outline ("o").
PAPER = DRAWINGS[0].getpixel((14, 3))
OUTLINE = DRAWINGS[0].getpixel((0, 1))
# The cover's deep green, its shadowed spine: the plate behind the adaptive icon.
FOREST = DRAWINGS[0].getpixel((1, 1))
if PAPER[:3] != (255, 251, 240) or OUTLINE[:3] != (31, 42, 34) or FOREST[:3] != (46, 97, 54):
    raise ValueError("the drawings have changed under this script: check PAPER, OUTLINE and FOREST")

# Pixels per dp at each density.
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

LEGACY_DP = 48  # the legacy icon's canvas
LEGACY_ART_DP = 44  # the book at most this wide in it, leaving a 2 dp margin
ADAPTIVE_DP = 108  # the adaptive layers' canvas
ADAPTIVE_ART_DP = 48  # the book at most this wide: inside the 66 dp safe circle


def largest(limit: int) -> tuple[Image.Image, int]:
    """The drawing and whole-number scale that come out largest within `limit` px."""
    return max(((art, limit // art.width) for art in DRAWINGS), key=lambda pair: (pair[0].width * pair[1], pair[0].width))


def scaled(art: Image.Image, scale: int) -> Image.Image:
    return art.resize((art.width * scale, art.height * scale), Image.NEAREST)


def centred(figure: Image.Image, size: int, under: Image.Image | None = None) -> Image.Image:
    canvas = under.copy() if under else Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(figure, ((size - figure.width) // 2, (size - figure.height) // 2))
    return canvas


def book(size: int, limit: int) -> Image.Image:
    art, scale = largest(limit)
    return centred(scaled(art, scale), size)


def monochrome(art: Image.Image) -> Image.Image:
    """The book in one colour with its leaf and pages cut out: Android uses only the alpha."""
    out = Image.new("RGBA", art.size, (0, 0, 0, 0))
    for y in range(art.height):
        for x in range(art.width):
            r, g, b, a = art.getpixel((x, y))
            paper = (r, g, b) in {PAPER[:3], (224, 216, 190)}  # the pages, their shaded corner and the leaf
            if a and not paper:
                out.putpixel((x, y), (255, 255, 255, 255))
    return out


for density, px in DENSITIES.items():
    folder = res / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    legacy = round(LEGACY_DP * px)
    book(legacy, round(LEGACY_ART_DP * px)).save(folder / "ic_launcher.png", optimize=True)
    book(legacy, round(LEGACY_ART_DP * px)).save(folder / "ic_launcher_round.png", optimize=True)

    layer = round(ADAPTIVE_DP * px)
    art, scale = largest(round(ADAPTIVE_ART_DP * px))
    centred(scaled(art, scale), layer).save(folder / "ic_launcher_foreground.png", optimize=True)
    centred(scaled(monochrome(art), scale), layer).save(folder / "ic_launcher_monochrome.png", optimize=True)

background = "#{:02X}{:02X}{:02X}".format(*FOREST[:3])
(res / "values" / "ic_launcher_background.xml").write_text(f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
  <!-- The cover's deep green: made by src-tauri/msix/android-icons.py. -->
  <color name="ic_launcher_background">{background}</color>
</resources>
""", encoding="utf-8")

adaptive = """<?xml version="1.0" encoding="utf-8"?>
<!-- Made by src-tauri/msix/android-icons.py. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
"""
anydpi = res / "mipmap-anydpi-v26"
anydpi.mkdir(parents=True, exist_ok=True)
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    (anydpi / name).write_text(adaptive, encoding="utf-8")

# Google Play's 512 px icon: full bleed (Play rounds its corners), on the same green as the launcher.
store.mkdir(parents=True, exist_ok=True)
art, scale = largest(384)
centred(scaled(art, scale), 512, Image.new("RGBA", (512, 512), FOREST)).save(store / "leaflet-play-512.png", optimize=True)

print(f"Wrote the Android launcher icons to {res} and the Play icon to {store}")
