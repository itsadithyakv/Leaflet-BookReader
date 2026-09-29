# Pip logo files

Rendered from the Pip engine (`src/pip`), so they match the app pixel for pixel.
Every size is a whole-number multiple of the 32-pixel sprite, so none of them blur.

| File | Use it for |
| --- | --- |
| `pip-32.png` … `pip-1024.png` | The logo on a transparent background. It has a thin light edge, so it reads on dark and light backgrounds. |
| `pip.svg` | The same logo as vectors: crisp at any size, for web and print. |
| `pip-tile-40.png` … `pip-tile-1280.png` | Pip on a cream tile, for store listings, social avatars and anywhere that needs a square badge. |
| `pip-tile.svg` | The tile as vectors. |
| `pip-wave.png`, `pip-reading.png`, `pip-boxing.png`, `pip-goal.png`, `pip-trophy.png`, `pip-on-fire.png`, `pip-sleeping.png`, `pip-pointing.png` | 256 px stickers of signature moves, for announcements, the website and empty states. |

When scaling up in CSS, keep the pixels square with `image-rendering: pixelated`.

The Windows app icons in `src-tauri/icons` are Pip on the cream tile, drawn
afresh at every size Windows uses (Start, the taskbar, Explorer, the `.exe`)
so none of them is a stretched 32-pixel sprite. Regenerate them with
`python src-tauri/msix/windows-icons.py`. The other platforms' icons (`icon.icns`,
`ios/`, `android/`) came from `npx tauri icon src/assets/pip/pip-1024.png`;
that command also overwrites the Windows ones, so run `windows-icons.py` after it.
