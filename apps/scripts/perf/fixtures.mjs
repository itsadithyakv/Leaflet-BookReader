// What the performance check serves besides the build: covers for a seeded library and one made-up book.
// Nothing here is anyone's real data. The book's text is generated from a word list, and the covers are
// flat shapes in generated colours, written once into node_modules/.perf/fixtures (git-ignored).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const VERSION = "1";

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A small deterministic random source, so every run serves the same pictures and the same book. */
const prng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pngChunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A cover: a background, some blocks and rings, in colours from `seed`. */
const cover = (seed, width, height) => {
  const rnd = prng(seed * 7919 + width);
  const hue = () => [Math.floor(rnd() * 200) + 40, Math.floor(rnd() * 200) + 40, Math.floor(rnd() * 200) + 40];
  const back = hue();
  const shapes = Array.from({ length: 9 }, () => ({
    ring: rnd() < 0.4,
    x: rnd() * width,
    y: rnd() * height,
    w: (0.1 + rnd() * 0.35) * width,
    h: (0.05 + rnd() * 0.2) * height,
    colour: hue()
  }));
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      let colour = back;
      for (const s of shapes) {
        if (s.ring) {
          const d = Math.hypot(x - s.x, y - s.y);
          if (Math.abs(d - s.w / 2) < 2) colour = s.colour;
        } else if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) {
          colour = s.colour;
        }
      }
      const at = row + 1 + x * 3;
      raw[at] = colour[0];
      raw[at + 1] = colour[1];
      raw[at + 2] = colour[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
};

/** A zip with every entry stored (EPUB allows it, and it needs no library). */
const zip = (entries) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
};

const WORDS = (
  "the a of and to in was that he she it with his her for on as at by from they had which but not be were this all one " +
  "lantern harbour orchard morning river window quiet stone garden letter evening north winter meadow ember distant " +
  "walked carried listened remembered opened waited turned followed answered gathered noticed wondered crossed " +
  "slowly carefully softly again almost already never always perhaps suddenly together beyond beneath across " +
  "small old bright cold warm long narrow heavy gentle silver green grey golden empty crowded familiar"
).split(" ");

/** An EPUB 3 of `chapters` chapters of made-up prose, about `words` words each. */
const book = (chapters = 14, words = 2600) => {
  const rnd = prng(42);
  const pick = () => WORDS[Math.floor(rnd() * WORDS.length)];
  const sentence = () => {
    const n = 8 + Math.floor(rnd() * 14);
    const text = Array.from({ length: n }, pick).join(" ");
    return text[0].toUpperCase() + text.slice(1) + (rnd() < 0.15 ? "?" : ".");
  };
  const paragraph = () => Array.from({ length: 3 + Math.floor(rnd() * 5) }, sentence).join(" ");
  const files = [];
  for (let c = 1; c <= chapters; c += 1) {
    const paras = [];
    let count = 0;
    while (count < words) {
      const p = paragraph();
      count += p.split(" ").length;
      paras.push(`<p>${p}</p>`);
    }
    files.push([
      `OEBPS/chapter${c}.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${c}</title></head><body><h1>Chapter ${c}</h1>\n${paras.join("\n")}\n</body></html>`
    ]);
  }
  const manifest = files.map((_, i) => `<item id="c${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = files.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("");
  const nav = files.map((_, i) => `<li><a href="chapter${i + 1}.xhtml">Chapter ${i + 1}</a></li>`).join("");
  const ncx = files
    .map((_, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>Chapter ${i + 1}</text></navLabel><content src="chapter${i + 1}.xhtml"/></navPoint>`)
    .join("");
  return zip([
    ["mimetype", "application/epub+zip"],
    [
      "META-INF/container.xml",
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    ],
    [
      "OEBPS/content.opf",
      `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">leaflet-perf-book</dc:identifier><dc:title>A Made-Up Book</dc:title><dc:creator>Nobody In Particular</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${manifest}</manifest><spine toc="ncx">${spine}</spine></package>`
    ],
    [
      "OEBPS/nav.xhtml",
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${nav}</ol></nav></body></html>`
    ],
    [
      "OEBPS/toc.ncx",
      `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="leaflet-perf-book"/></head><docTitle><text>A Made-Up Book</text></docTitle><navMap>${ncx}</navMap></ncx>`
    ],
    ...files
  ]);
};

/** The fixtures' folder, made once (and again when this file's VERSION changes). */
export const ensureFixtures = (root) => {
  const dir = path.join(root, `v${VERSION}`);
  if (existsSync(path.join(dir, "done"))) return dir;
  const sizes = { t240: [240, 360], t480: [480, 720], full: [600, 900] };
  for (const [name, [w, h]] of Object.entries(sizes)) {
    mkdirSync(path.join(dir, "covers", name), { recursive: true });
    for (let i = 0; i < 60; i += 1) writeFileSync(path.join(dir, "covers", name, `${i}.png`), cover(i, w, h));
  }
  writeFileSync(path.join(dir, "book.epub"), book());
  writeFileSync(path.join(dir, "done"), new Date().toISOString());
  return dir;
};
