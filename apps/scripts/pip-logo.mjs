// Draws Leaflet's logo: Pip sitting with an open book, from the Pip engine, so
// it matches the app pixel for pixel.
//
//   node apps/scripts/pip-logo.mjs
//
// Writes into apps/src/assets/pip:
//   pip-32.png ... pip-1024.png   the logo, on nothing, with a thin light edge
//   pip.svg                       the same as vectors
//   pip-tile-40.png ... -1280.png the logo on the cream tile, for places that
//   pip-tile.svg                  need a square badge with a background
//   pip-face-16.png, -18.png      Pip's face alone, drawn twice
//   pip-face-512.png, pip-face.svg  the same, large and as vectors
// The face was the app icon until October 2026. The icon is now a green book, drawn
// in src-tauri/msix/windows-icons.py, which also writes the favicon.
//
// The logo used to be Pip standing, the same sprite the app shows idle, on a
// cream tile. On the taskbar that read as a small figure in a box. This one is
// a pose of its own that says what the app is for (the book), fills the frame,
// and has no background: the light edge lets it sit on a dark taskbar and a
// light one alike. No dependencies: the PNGs are encoded here.
//
// The app icon is not the logo. On the taskbar the logo was a 24 by 31 figure
// in a square: narrow, a third of it leaf, and its book, hands and feet a few
// pixels of noise. The icon is Pip's face and nothing else, as wide and as
// tall as the square, the leaf growing from behind it into the corner the
// head leaves empty.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

globalThis.ImageData = class {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
};

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const pipRoot = pathToFileURL(path.join(appRoot, "src", "pip") + path.sep).href;
const { renderFrame, drawPip, drawLeafOnly } = await import(pipRoot + "engine.js");
const { prop } = await import(pipRoot + "anims.js");
const { SKINS, resolve } = await import(pipRoot + "skins.js");

const N = 32;
const EDGE = "#FFFBF0";
const BOOK = { w: 14, h: 7, below: 6 };

/** Pip sitting, feet out to the sides, looking up from an open book on its lap. */
const logo = {
  loop: 1,
  draw: (g) => {
    drawPip(g, {
      y: 25,
      sq: 0.05,
      look: [0, 0],
      la: 26,
      ll: 1.15,
      mouth: "smile",
      feet: (A) => [[A.cx - 7, A.bottom + 0.2, 2.6], [A.cx + 7, A.bottom + 0.2, 2.6]],
      hold: (g, A) => prop.openBook(g, A.cx, A.cy + BOOK.below, { w: BOOK.w, h: BOOK.h }),
      hands: (A) => [
        { x: A.cx - BOOK.w / 2 - 0.5, y: A.cy + BOOK.below + BOOK.h / 2 },
        { x: A.cx + BOOK.w / 2 + 0.5, y: A.cy + BOOK.below + BOOK.h / 2 }
      ]
    });
  }
};

const sprout = SKINS.find((skin) => skin.id === "sprout") ?? SKINS[0];
const frame = renderFrame(logo, 0, resolve(sprout, 0), { rim: EDGE });

// ---- the app icon -----------------------------------------------------------------

// A lighter leaf than Pip wears in the app: with no light edge round the icon,
// her own dark green was lost on a dark taskbar.
const FACE_LEAF = { leafColor: "#5FCB6B", leafShade: "#2F9E57" };

/**
 * Pip's face: her head `w` by `h` (half sizes, as the engine takes them), no
 * hands, feet or belly, and a leaf whose stem starts `dx`, `dy` from the top of
 * her head, behind it, at `angle` degrees and `length` times its usual size.
 */
const face = ({ w, h, leaf: [dx, dy, angle, length] }) => ({
  loop: 1,
  draw: (g) => {
    drawPip(g, {
      x: 16,
      y: 26,
      w,
      h,
      feet: false,
      hands: false,
      leaf: "none",
      colors: { belly: null },
      mouth: "smile",
      behind: (g, A) => drawLeafOnly(g, { x: A.cx + dx, y: A.top.y + dy + 0.8, w: 1, h: 1, la: angle, ll: length, ...FACE_LEAF })
    });
  }
});

// Two drawings, 18 and 16 pixels square, because Pip is pixel art and only a
// whole-number scale keeps her pixels square: 18 is exact at 36 px (a taskbar
// at 150%) and 72, 16 at 16, 32, 48 and 64. The smaller has a smaller head,
// not a shrunk one: her eyes, cheeks and mouth are the same pixels in both.
const FACES = {
  18: face({ w: 8, h: 6.5, leaf: [2, 2.2, 62, 0.85] }),
  16: face({ w: 7, h: 5.5, leaf: [1.5, 2.2, 60, 0.8] })
};

/** A face cut to its square. Fails if the engine no longer draws it that size. */
const faceArt = (side) => {
  const drawn = renderFrame(FACES[side], 0, resolve(sprout, 0)).data;
  let left = N, top = N, right = -1, bottom = -1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (drawn[(y * N + x) * 4 + 3]) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  if (right - left + 1 !== side || bottom - top + 1 !== side) {
    throw new Error(`the ${side}-pixel face came out ${right - left + 1} by ${bottom - top + 1}: adjust FACES`);
  }
  const out = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) out.set(drawn.subarray(((y + top) * N + left) * 4, ((y + top) * N + left + side) * 4), y * side * 4);
  return out;
};

// ---- PNG ----------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** RGBA pixels (w*h*4) to a PNG file. */
const writePng = (file, rgba, w, h) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0))
    ])
  );
};

/** A picture `side` pixels square, each pixel made `scale` across: never blurred. */
const scaled = (pixels, side, scale) => {
  const size = side * scale;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (Math.floor(y / scale) * side + Math.floor(x / scale)) * 4;
      out.set(pixels.subarray(from, from + 4), (y * size + x) * 4);
    }
  }
  return out;
};

/** One rect per horizontal run of a colour: crisp at any size, small files. */
const toSvg = (pixels, side, title, px) => {
  const rects = [];
  for (let y = 0; y < side; y++) {
    let x = 0;
    while (x < side) {
      const i = (y * side + x) * 4;
      if (pixels[i + 3] === 0) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < side) {
        const j = (y * side + x + run) * 4;
        if (pixels[j] !== pixels[i] || pixels[j + 1] !== pixels[i + 1] || pixels[j + 2] !== pixels[i + 2] || pixels[j + 3] !== pixels[i + 3]) break;
        run++;
      }
      const hex = "#" + [pixels[i], pixels[i + 1], pixels[i + 2]].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("");
      rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${hex}"/>`);
      x += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${px}" height="${px}" shape-rendering="crispEdges"><title>${title}</title>${rects.join("")}</svg>\n`;
};

// ---- the tile -------------------------------------------------------------------

// A 40-pixel rounded badge: dark outline, a light ring inside it, cream above
// and a pale ground below. The logo sits on the ground.
const TILE = 40;
const OUTLINE = [31, 42, 34, 255];
const RING = [255, 251, 240, 255];
const CREAM = [244, 237, 220, 255];
const GROUND = [228, 236, 206, 255];
const corner = [3, 2, 1];
const inset = (v) => {
  const near = Math.min(v, TILE - 1 - v);
  return near < corner.length ? corner[near] : 0;
};
const inTile = (x, y) => x >= 0 && y >= 0 && x < TILE && y < TILE && x >= inset(y) && x < TILE - inset(y);
/** How many pixels in from the tile's edge, up to 2. */
const depth = (x, y) => {
  if (!inTile(x, y)) return -1;
  const around = (r) => [[-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, -r], [-r, r], [r, r]].every(([dx, dy]) => inTile(x + dx, y + dy));
  return !around(1) ? 0 : !around(2) ? 1 : 2;
};
const tile = new Uint8Array(TILE * TILE * 4);
for (let y = 0; y < TILE; y++) {
  for (let x = 0; x < TILE; x++) {
    const d = depth(x, y);
    if (d < 0) continue;
    tile.set(d === 0 ? OUTLINE : d === 1 ? RING : y >= TILE * 0.6 ? GROUND : CREAM, (y * TILE + x) * 4);
  }
}
// The logo, centred, its feet a few pixels above the tile's lower edge.
const bounds = { top: N, bottom: 0 };
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (frame.data[(y * N + x) * 4 + 3]) { bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y); }
const offsetX = (TILE - N) / 2;
const offsetY = TILE - 4 - bounds.bottom;
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const from = (y * N + x) * 4;
    if (!frame.data[from + 3]) continue;
    const ty = y + offsetY;
    if (ty < 0 || ty >= TILE) continue;
    tile.set(frame.data.subarray(from, from + 4), (ty * TILE + x + offsetX) * 4);
  }
}

// ---- files --------------------------------------------------------------------

const assets = path.join(appRoot, "src", "assets", "pip");
const sprite = new Uint8Array(frame.data.buffer);
for (const scale of [1, 2, 4, 8, 16, 32]) {
  writePng(path.join(assets, `pip-${N * scale}.png`), scaled(sprite, N, scale), N * scale, N * scale);
}
fs.writeFileSync(path.join(assets, "pip.svg"), toSvg(sprite, N, "Leaflet: Pip with a book", 1024));
for (const scale of [1, 2, 4, 8, 16, 32]) {
  writePng(path.join(assets, `pip-tile-${TILE * scale}.png`), scaled(tile, TILE, scale), TILE * scale, TILE * scale);
}
fs.writeFileSync(path.join(assets, "pip-tile.svg"), toSvg(tile, TILE, "Leaflet: Pip with a book, on a tile", 320));
for (const side of [16, 18]) {
  writePng(path.join(assets, `pip-face-${side}.png`), faceArt(side), side, side);
}
writePng(path.join(assets, "pip-face-512.png"), scaled(faceArt(16), 16, 32), 512, 512);
fs.writeFileSync(path.join(assets, "pip-face.svg"), toSvg(faceArt(16), 16, "Leaflet: Pip's face", 512));
console.log(`Wrote the logo to ${assets} (art rows ${bounds.top} to ${bounds.bottom} of ${N}).`);
