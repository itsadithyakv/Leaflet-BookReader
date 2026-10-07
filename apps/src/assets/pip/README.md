# Pip logo files

The logo is Pip sitting with an open book on its lap. It is drawn by the Pip
engine (`src/pip`), so it matches the app pixel for pixel: `node
apps/scripts/pip-logo.mjs` writes every file below marked "logo" and the
favicon. Every size is a whole-number multiple of the 32-pixel sprite, so none
of them blur.

| File | Use it for |
| --- | --- |
| `pip-32.png` … `pip-1024.png` | The logo on a transparent background. It has a thin light edge, so it reads on dark and light backgrounds. |
| `pip.svg` | The same logo as vectors: crisp at any size, for web and print. |
| `pip-tile-40.png` … `pip-tile-1280.png` | Pip on a cream tile, for store listings, social avatars and anywhere that needs a square badge. |
| `pip-tile.svg` | The tile as vectors. |
| `pip-face-16.png`, `pip-face-18.png` | The app icon's two drawings: Pip's face alone, 16 and 18 pixels square with no margin. Not for use as they are: `windows-icons.py` makes the icons from them. |
| `pip-face-512.png`, `pip-face.svg` | The face, large and as vectors, for anywhere a small square mark is wanted. |
| `pip-wave.png`, `pip-reading.png`, `pip-boxing.png`, `pip-goal.png`, `pip-trophy.png`, `pip-on-fire.png`, `pip-sleeping.png`, `pip-pointing.png` | 256 px stickers of signature moves, for announcements, the website and empty states. |

When scaling up in CSS, keep the pixels square with `image-rendering: pixelated`.

The Windows app icons in `src-tauri/icons` are not the logo: they are Pip's
face alone, on nothing. The logo on a taskbar was a narrow figure with a book
too small to read; a face fills the square. There are two drawings because
pixel art only stays sharp at a whole-number scale: the 18 is exact at 36 px
(a taskbar at 150%), the 16 at 16, 32, 48 and 64, and each icon uses whichever
fills more of it. Only 24 and 30 px are scaled by a fraction, and are soft.
Regenerate them, and the Store listing's logos in `brand/store-logos`, with
`python src-tauri/msix/windows-icons.py` after `pip-logo.mjs`. The other platforms' icons (`icon.icns`, `ios/`,
`android/`) came from `npx tauri icon src/assets/pip/pip-1024.png` and still
show the first logo (Pip standing); that command also overwrites the Windows
ones, so run `windows-icons.py` after it.
