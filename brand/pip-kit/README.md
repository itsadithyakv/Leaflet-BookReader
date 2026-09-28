# Pip kit

Pip, Leaflet's mascot, ready for design work. Everything here is rendered from
the app's own Pip engine (`apps/src/pip`), so it matches the app pixel for
pixel. Open `index.html` in a browser to browse it all.

Regenerate after changing the art: `node apps/scripts/pip-kit.mjs`.

## Folders

| Folder | What | Size |
| --- | --- | --- |
| `logo/` | The logo (transparent, with a thin light edge so it reads on any background), square tiles on cream, and both as SVG. | 32 to 1280 px, SVG |
| `stills/<category>/` | One still of every move (its signature pose), as a transparent PNG and an SVG. | 1024 px, SVG |
| `animations/<category>/` | Every move as a looping, transparent GIF at the app's 12 fps. | 512 px |
| `sprite-sheets/<category>/` | Every frame of every move in a grid (8 across), with a JSON file giving the frame count, size and fps. For code, After Effects, Lottie and game engines. | 256 px per frame |
| `skins/` | All 38 skins (variants like Robo-Pip, Mr. President, Skater): a still (PNG + SVG) and a waving GIF. | 1024 px, 512 px |
| `overview/` | Contact sheets: every move and every skin on one image. | 256 px per cell |
| `catalogue.json` | Every move's id, name, category, frame count and length. | |

Categories: Everyday, Stunts, Drama, Coach, Reading, Celebrate, Dance, Sports, Treats.

## Using it

- **Keep the pixels square.** Scale by whole numbers only (2x, 3x...). In CSS use
  `image-rendering: pixelated`; in Figma, Photoshop or Affinity pick
  "Nearest neighbour" when resizing. The SVGs scale to any size with no blur.
- **Backgrounds are transparent.** Pip is drawn with dark outlines, so he reads on
  light and mid-tone backgrounds. On very dark ones, use the logo files, which
  carry a light edge.
- **GIF transparency is on or off per pixel** (a GIF limitation), which suits
  pixel art. For true alpha, use the PNG sprite sheets.
- **Timing.** Frames are designed for 12 frames per second; every loop is seamless.

## Not included

Pip's 51 book-nod scenes (dragons, watchful eyes and other nods to famous books)
stay in the app. They riff on other people's stories, which is fine as an
in-app easter egg but riskier on marketing material.
