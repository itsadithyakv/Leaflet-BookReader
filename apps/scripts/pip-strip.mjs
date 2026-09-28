// Dev tool: renders a move to a PNG strip for checking the pixel art.
// node apps/scripts/pip-strip.mjs <move> [skin] [frameStep] [out.png] [accessories]
// <move> may also be a mini-game pose from games-art.js (dash-run, catch-walk, flap-fly, ...).
// accessories: comma-separated ids from ACCESSORIES (e.g. cap,shades,scarf,backpack), worn via dress().
import zlib from "node:zlib";
import fs from "node:fs";
globalThis.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
const root = "file:///D:/Leaflet/apps/src/pip/";
const { renderFrame, SKINS, resolve, LIB, loadBookScenes } = await import(root + "index.js");
await loadBookScenes();
const { dress, ACCESSORIES } = await import(root + "accessories.js");
const [id, skinId = "sprout", step = "2", out = "strip.png", wear = ""] = process.argv.slice(2);
const { GAME_POSES } = await import(root + "games-art.js");
const anim = LIB.find((a) => a.id === id) || GAME_POSES.find((a) => a.id === id);
const base = SKINS.find((s) => s.id === skinId);
if (!anim || !base) { console.error(!anim ? "no move " + id : "no skin " + skinId); process.exit(1); }
const ids = wear ? wear.split(",").map((w) => w.trim()).filter(Boolean) : [];
for (const w of ids) if (!ACCESSORIES.some((a) => a.id === w)) console.warn("unknown accessory", w);
const skin = ids.length ? dress(base, ids) : base;
const S = resolve(skin, 0);
const frames = [];
for (let f = 0; f < anim.loop; f += Number(step)) frames.push(renderFrame(anim, f, resolve(skin, f)));
const scale = 5, N = 32, pad = 2, cols = frames.length;
const W = cols * (N + pad) * scale, H = N * scale;
const px = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  px[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const cell = Math.floor(x / ((N + pad) * scale)), lx = Math.floor((x % ((N + pad) * scale)) / scale), ly = Math.floor(y / scale);
    let c = [236, 230, 214, 255];
    if (lx < N) { const d = frames[cell].data, i = (ly * N + lx) * 4; const a = d[i + 3] / 255; c = [0,1,2].map((k) => Math.round(d[i + k] * a + c[k] * (1 - a))).concat(255); } else c = [255,255,255,255];
    px.set(c, y * (W * 4 + 1) + 1 + x * 4);
  }
}
const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(px)), chunk("IEND", Buffer.alloc(0))]));
console.log("frames", frames.length, "->", out);
