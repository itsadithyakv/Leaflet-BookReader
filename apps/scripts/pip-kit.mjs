// Builds the Pip design kit: the logo, every move as a still (PNG + SVG), an
// animated GIF and a sprite sheet, every skin, and overview sheets, all
// rendered from the Pip engine so they match the app pixel for pixel.
//
//   node apps/scripts/pip-kit.mjs [outDir]      (default: brand/pip-kit)
//
// No dependencies: PNG and GIF are encoded here. Every raster is a whole-number
// multiple of the 32-pixel sprite (nearest neighbour), so nothing is blurred.
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
const repoRoot = path.resolve(appRoot, "..");
const pipRoot = pathToFileURL(path.join(appRoot, "src", "pip") + path.sep).href;
const { renderFrame, SKINS, resolve, LIB } = await import(pipRoot + "index.js");

const OUT = path.resolve(process.argv[2] ?? path.join(repoRoot, "brand", "pip-kit"));
const N = 32;
const FPS = 12;
const STILL = 32; // 32 px * 32 = 1024 px stills
const GIF_SCALE = 16; // 512 px animations
const SHEET_SCALE = 8; // 256 px sprite-sheet cells
const SHEET_COLUMNS = 8;

// The app's own moves. Book nods (loaded separately) are left out on purpose:
// they riff on other people's stories, fine as in-app easter eggs, riskier on
// marketing material.
const MOVES = LIB.filter((move) => move.cat);

const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const mkdir = (dir) => fs.mkdirSync(dir, { recursive: true });

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
/** RGBA pixels (Uint8Array, w*h*4) to a PNG file. */
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

/** A 32x32 frame scaled up by a whole number, into a larger canvas at (ox, oy). */
const blit = (frame, scale, canvas, cw, ox = 0, oy = 0) => {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const a = frame.data[i + 3];
      if (a === 0) continue;
      for (let dy = 0; dy < scale; dy++) {
        let o = ((oy + y * scale + dy) * cw + ox + x * scale) * 4;
        for (let dx = 0; dx < scale; dx++, o += 4) {
          canvas[o] = frame.data[i];
          canvas[o + 1] = frame.data[i + 1];
          canvas[o + 2] = frame.data[i + 2];
          canvas[o + 3] = a;
        }
      }
    }
  }
};
const scaled = (frame, scale) => {
  const size = N * scale;
  const canvas = new Uint8Array(size * size * 4);
  blit(frame, scale, canvas, size);
  return canvas;
};

// ---- SVG ----------------------------------------------------------------------

/** One rect per horizontal run of a colour: crisp at any size, small files. */
const toSvg = (frame, title, px = 1024) => {
  const d = frame.data;
  const rects = [];
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      const i = (y * N + x) * 4;
      if (d[i + 3] === 0) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < N) {
        const j = (y * N + x + run) * 4;
        if (d[j] !== d[i] || d[j + 1] !== d[i + 1] || d[j + 2] !== d[i + 2] || d[j + 3] !== d[i + 3]) break;
        run++;
      }
      const hex = "#" + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
      const opacity = d[i + 3] < 255 ? ` fill-opacity="${(d[i + 3] / 255).toFixed(3)}"` : "";
      rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${hex}"${opacity}/>`);
      x += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${px}" height="${px}" shape-rendering="crispEdges"><title>${title}</title>${rects.join("")}</svg>\n`;
};

// ---- GIF ----------------------------------------------------------------------

/** LZW for GIF image data, with variable code sizes and a clear at 4096 codes. */
const lzw = (indices, minCode) => {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const out = [];
  let cur = 0;
  let bits = 0;
  let size = minCode + 1;
  const emit = (code) => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(cur & 255);
      cur >>>= 8;
      bits -= 8;
    }
  };
  let dict = new Map();
  let next = eoi + 1;
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      size = minCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  // Sub-blocks of at most 255 bytes.
  const blocks = [minCode];
  for (let i = 0; i < out.length; i += 255) {
    const part = out.slice(i, i + 255);
    blocks.push(part.length, ...part);
  }
  blocks.push(0);
  return Buffer.from(blocks);
};

/**
 * An animated GIF from 32x32 frames: one shared palette (index 0 transparent),
 * identical consecutive frames merged into one longer frame, looping forever.
 */
const writeGif = (file, frames, scale) => {
  const size = N * scale;
  const palette = [[0, 0, 0]];
  const lookup = new Map();
  const indexed = frames.map((frame) => {
    const small = new Uint8Array(N * N);
    for (let p = 0; p < N * N; p++) {
      const i = p * 4;
      if (frame.data[i + 3] < 128) continue;
      const key = (frame.data[i] << 16) | (frame.data[i + 1] << 8) | frame.data[i + 2];
      let idx = lookup.get(key);
      if (idx === undefined) {
        idx = palette.length < 256 ? palette.length : nearest(palette, frame.data[i], frame.data[i + 1], frame.data[i + 2]);
        if (palette.length < 256) palette.push([frame.data[i], frame.data[i + 1], frame.data[i + 2]]);
        lookup.set(key, idx);
      }
      small[p] = idx;
    }
    return small;
  });
  const bitsFor = Math.max(2, Math.ceil(Math.log2(palette.length)));
  const tableSize = 1 << bitsFor;

  // Merge runs of identical frames; 12 fps is 8.33 cs a frame.
  const runs = [];
  for (let f = 0; f < indexed.length; f++) {
    const last = runs[runs.length - 1];
    if (last && Buffer.compare(Buffer.from(last.pixels), Buffer.from(indexed[f])) === 0) {
      last.count++;
    } else {
      runs.push({ pixels: indexed[f], count: 1 });
    }
  }
  let elapsed = 0;
  let shown = 0;

  const parts = [];
  const header = Buffer.alloc(13);
  header.write("GIF89a", 0);
  header.writeUInt16LE(size, 6);
  header.writeUInt16LE(size, 8);
  header[10] = 0x80 | ((bitsFor - 1) << 4) | (bitsFor - 1);
  parts.push(header);
  const table = Buffer.alloc(tableSize * 3);
  palette.forEach(([r, g, b], i) => table.set([r, g, b], i * 3));
  parts.push(table);
  parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 0x03, 0x01, 0x00, 0x00, 0x00]));

  for (const run of runs) {
    elapsed += run.count;
    const target = Math.round((elapsed * 100) / FPS);
    const delay = Math.max(2, target - shown);
    shown += delay;
    // Graphic control: restore to background (so transparency never smears), transparent index 0.
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x09, delay & 255, delay >> 8, 0x00, 0x00]));
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(size, 5);
    desc.writeUInt16LE(size, 7);
    parts.push(desc);
    const big = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      const row = Math.floor(y / scale) * N;
      for (let x = 0; x < size; x++) big[y * size + x] = run.pixels[row + Math.floor(x / scale)];
    }
    parts.push(lzw(big, bitsFor));
  }
  parts.push(Buffer.from([0x3b]));
  fs.writeFileSync(file, Buffer.concat(parts));
  return runs.length;
};
const nearest = (palette, r, g, b) => {
  let best = 1;
  let dist = Infinity;
  for (let i = 1; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
};

// ---- the kit --------------------------------------------------------------------

const framesOf = (move, skin) => Array.from({ length: move.loop }, (_, f) => renderFrame(move, f, resolve(skin, f)));

const writeSheet = (file, frames, scale, columns) => {
  const cell = N * scale;
  const cols = Math.min(columns, frames.length);
  const rows = Math.ceil(frames.length / cols);
  const w = cols * cell;
  const h = rows * cell;
  const canvas = new Uint8Array(w * h * 4);
  frames.forEach((frame, i) => blit(frame, scale, canvas, w, (i % cols) * cell, Math.floor(i / cols) * cell));
  writePng(file, canvas, w, h);
  return { columns: cols, rows, cell };
};

fs.rmSync(OUT, { recursive: true, force: true });
mkdir(OUT);
const sprout = SKINS.find((skin) => skin.id === "sprout");
const catalogue = [];
const started = Date.now();

// Logo: the finished files from the app's assets (with their light edge), as they ship.
const logoSrc = path.join(appRoot, "src", "assets", "pip");
mkdir(path.join(OUT, "logo"));
for (const name of fs.readdirSync(logoSrc)) {
  if (/^pip(-\d+|-tile(-\d+)?)?\.(png|svg)$/.test(name)) {
    fs.copyFileSync(path.join(logoSrc, name), path.join(OUT, "logo", name));
  }
}

for (const move of MOVES) {
  const cat = slug(move.cat);
  const frames = framesOf(move, sprout);
  const poster = frames[Math.min(move.poster ?? 0, frames.length - 1)];
  for (const dir of ["stills", "animations", "sprite-sheets"]) mkdir(path.join(OUT, dir, cat));
  writePng(path.join(OUT, "stills", cat, `${move.id}.png`), scaled(poster, STILL), N * STILL, N * STILL);
  fs.writeFileSync(path.join(OUT, "stills", cat, `${move.id}.svg`), toSvg(poster, `Pip: ${move.name}`));
  const gifFrames = writeGif(path.join(OUT, "animations", cat, `${move.id}.gif`), frames, GIF_SCALE);
  const sheet = writeSheet(path.join(OUT, "sprite-sheets", cat, `${move.id}.png`), frames, SHEET_SCALE, SHEET_COLUMNS);
  fs.writeFileSync(
    path.join(OUT, "sprite-sheets", cat, `${move.id}.json`),
    JSON.stringify({ move: move.id, name: move.name, frames: frames.length, fps: FPS, frameSize: sheet.cell, columns: sheet.columns, rows: sheet.rows, loop: true }, null, 2) + "\n"
  );
  catalogue.push({ id: move.id, name: move.name, cat: move.cat, dir: cat, frames: frames.length, seconds: +(frames.length / FPS).toFixed(2), gifFrames });
  process.stdout.write(".");
}
process.stdout.write("\n");

// Every skin, standing idle, and waving.
mkdir(path.join(OUT, "skins"));
const idle = LIB.find((move) => move.id === "idle");
const wave = LIB.find((move) => move.id === "welcome");
const skinRows = [];
for (const skin of SKINS) {
  const pose = renderFrame(idle, idle.poster ?? 0, resolve(skin, 0));
  writePng(path.join(OUT, "skins", `${skin.id}.png`), scaled(pose, STILL), N * STILL, N * STILL);
  fs.writeFileSync(path.join(OUT, "skins", `${skin.id}.svg`), toSvg(pose, `Pip: ${skin.name}`));
  writeGif(path.join(OUT, "skins", `${skin.id}-wave.gif`), framesOf(wave, skin), GIF_SCALE);
  skinRows.push({ id: skin.id, name: skin.name });
}

// Overview sheets: every move's still, and every skin, on a grid.
mkdir(path.join(OUT, "overview"));
const posters = MOVES.map((move) => renderFrame(move, move.poster ?? 0, resolve(sprout, 0)));
writeSheet(path.join(OUT, "overview", "all-moves.png"), posters, 8, 10);
writeSheet(path.join(OUT, "overview", "all-skins.png"), SKINS.map((skin) => renderFrame(idle, idle.poster ?? 0, resolve(skin, 0))), 8, 8);

fs.writeFileSync(path.join(OUT, "catalogue.json"), JSON.stringify({ fps: FPS, moves: catalogue, skins: skinRows }, null, 2) + "\n");

// A page to browse it all: open index.html in any browser.
const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const byCat = new Map();
for (const move of catalogue) byCat.set(move.cat, [...(byCat.get(move.cat) ?? []), move]);
const card = (href, img, label, sub) =>
  `<a class="card" href="${href}"><img src="${img}" alt="${esc(label)}" loading="lazy"><b>${esc(label)}</b><span>${esc(sub)}</span></a>`;
const sections = [...byCat].map(
  ([cat, moves]) =>
    `<h2>${esc(cat)} <small>${moves.length}</small></h2><div class="grid">${moves
      .map((m) => card(`animations/${m.dir}/${m.id}.gif`, `animations/${m.dir}/${m.id}.gif`, m.name, `${m.id} · ${m.seconds}s`))
      .join("")}</div>`
);
const skinCards = skinRows.map((s) => card(`skins/${s.id}.png`, `skins/${s.id}-wave.gif`, s.name, s.id)).join("");
const logoCards = ["pip.svg", "pip-tile.svg"].map((f) => card(`logo/${f}`, `logo/${f}`, f, "vector")).join("");
fs.writeFileSync(
  path.join(OUT, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pip kit</title>
<style>
:root{color-scheme:light dark;--bg:#f4efe3;--card:#fffdf7;--ink:#1f2a1c;--muted:#6b715f;--line:#e2dccb}
@media (prefers-color-scheme:dark){:root{--bg:#161a14;--card:#20261d;--ink:#eef2e6;--muted:#a3ab96;--line:#303829}}
body{margin:0;padding:24px 16px 64px;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
main{max-width:1180px;margin:0 auto}h1{margin:0 0 4px;font-size:32px}p{color:var(--muted);margin:0 0 20px}
h2{margin:36px 0 12px;font-size:20px}h2 small{color:var(--muted);font-weight:400}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.card{display:flex;flex-direction:column;align-items:center;gap:2px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:inherit;text-decoration:none}
.card:hover{border-color:#72ab44}.card img{width:128px;height:128px;image-rendering:pixelated}
.card b{font-size:13px;text-align:center}.card span{font-size:11px;color:var(--muted)}
</style></head><body><main>
<h1>Pip kit</h1><p>${catalogue.length} animations, ${skinRows.length} skins and the logo, rendered from the app's Pip engine. Select any card to open the full-size file. See README.md for what each folder holds.</p>
<h2>Logo</h2><div class="grid">${logoCards}</div>
${sections.join("\n")}
<h2>Skins <small>${skinRows.length}</small></h2><div class="grid">${skinCards}</div>
</main></body></html>
`
);

fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# Pip kit

Pip, Leaflet's mascot, ready for design work. Everything here is rendered from
the app's own Pip engine (\`apps/src/pip\`), so it matches the app pixel for
pixel. Open \`index.html\` in a browser to browse it all.

Regenerate after changing the art: \`node apps/scripts/pip-kit.mjs\`.

## Folders

| Folder | What | Size |
| --- | --- | --- |
| \`logo/\` | The logo (transparent, with a thin light edge so it reads on any background), square tiles on cream, and both as SVG. | 32 to 1280 px, SVG |
| \`stills/<category>/\` | One still of every move (its signature pose), as a transparent PNG and an SVG. | 1024 px, SVG |
| \`animations/<category>/\` | Every move as a looping, transparent GIF at the app's 12 fps. | 512 px |
| \`sprite-sheets/<category>/\` | Every frame of every move in a grid (8 across), with a JSON file giving the frame count, size and fps. For code, After Effects, Lottie and game engines. | 256 px per frame |
| \`skins/\` | All ${skinRows.length} skins (variants like Robo-Pip, Mr. President, Skater): a still (PNG + SVG) and a waving GIF. | 1024 px, 512 px |
| \`overview/\` | Contact sheets: every move and every skin on one image. | 256 px per cell |
| \`catalogue.json\` | Every move's id, name, category, frame count and length. | |

Categories: ${[...byCat.keys()].join(", ")}.

## Using it

- **Keep the pixels square.** Scale by whole numbers only (2x, 3x...). In CSS use
  \`image-rendering: pixelated\`; in Figma, Photoshop or Affinity pick
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
`
);
console.log(`${catalogue.length} moves, ${skinRows.length} skins -> ${OUT} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
