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
// and apps/public/favicon.png. The Windows icons are made from pip-32.png by
// src-tauri/msix/windows-icons.py: run that afterwards.
//
// The logo used to be Pip standing, the same sprite the app shows idle, on a
// cream tile. On the taskbar that read as a small figure in a box. This one is
// a pose of its own that says what the app is for (the book), fills the frame,
// and has no background: the light edge lets it sit on a dark taskbar and a
// light one alike. No dependencies: the PNGs are encoded here.
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
const { renderFrame, drawPip } = await import(pipRoot + "engine.js");
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
writePng(path.join(appRoot, "public", "favicon.png"), scaled(sprite, N, 2), N * 2, N * 2);
console.log(`Wrote the logo to ${assets} (art rows ${bounds.top} to ${bounds.bottom} of ${N}).`);
