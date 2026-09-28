"""Renders the Square44x44Logo.targetsize-* icons that Windows uses on the
taskbar, Start and in Explorer for the MSIX build.

`npx tauri icon` does not produce these, so rerun this after changing Pip:

    python apps/src-tauri/msix/taskbar-icons.py

Needs Pillow. build-msix.ps1 copies the output into the package and indexes it
with makepri; without that index Windows ignores the variants.
"""

from pathlib import Path

from PIL import Image

apps = Path(__file__).resolve().parents[2]
sprite = Image.open(apps / "src" / "assets" / "pip" / "pip-32.png").convert("RGBA")
icons = apps / "src-tauri" / "icons"

for size in (16, 24, 32, 48, 256):
    if size >= sprite.width:
        # Upscaling: nearest neighbour keeps the pixel art hard-edged.
        icon = sprite.resize((size, size), Image.NEAREST)
    else:
        # Downscaling: nearest neighbour would drop whole rows of the sprite
        # (the outline breaks up), so average exact areas instead, from a 3x
        # copy so 24 px is a whole-number reduction too.
        icon = sprite.resize((96, 96), Image.NEAREST).resize((size, size), Image.BOX)
    # The plain variant backs plated surfaces; the pixel art needs no plate,
    # so both are the same transparent image.
    for suffix in ("", "_altform-unplated"):
        icon.save(icons / f"Square44x44Logo.targetsize-{size}{suffix}.png", optimize=True)
