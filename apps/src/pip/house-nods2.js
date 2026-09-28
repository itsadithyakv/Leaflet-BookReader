/* More book-nod decor for Pip's house (second set). Same shape as house-nods.js:
   { id, name, kind, fits, level, price, w, h, nod, draw(g, f), glow? }
 `nod` names the book for the app's own mapping. Works still in copyright get
 generic names and our own drawings: no logos, sigils, film or cover designs.
 Public-domain works (Malory, Perrault, Proust, Fitzgerald's Gatsby, Homer,
 Burnett, Baum, Carroll, W. C. Williams, The Little Engine That Could) may use
 their real names. Pure functions of the frame, 12 fps. */
import { Painter, rnd, lerpC } from "./room.js";

const TAU = Math.PI * 2;
const wave = (f, per, amp = 1, off = 0) => amp * Math.sin((TAU * f) / per + off);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const it = (id, name, kind, fits, level, price, w, h, nod, draw, extra) => Object.assign({ id, name, kind, fits, level, price, w, h, nod, draw }, extra || {});
/** Paint a pixel map: rows of chars, each looked up in pal (missing = skip). */
const map = (l, rows, pal, x0, y0, flip = false) => rows.forEach((r, j) => [...r].forEach((ch, i) => pal[ch] && l.px(flip ? x0 + r.length - 1 - i : x0 + i, y0 + j, pal[ch])));
const sh = (hi, mid, lo, a = -0.6, b = 0.6) => (nx, ny) => (nx + ny < a ? hi : nx + ny > b ? lo : mid);
const star = (g, x, y, r, c = "#FFFFFF") => { g.px(x, y, c); for (let k = 1; k <= r; k++) g.px(x + k, y, c).px(x - k, y, c).px(x, y + k, c).px(x, y - k, c); };
const plaque = (g, x, y, w, h) => g.stamp((l) => l.rect(x, y, w, h, "#6B4226").rect(x, y, w, 1, "#8E5C36").rect(x + 1, y + h - 1, w - 2, 1, "#4A2C16"), "#1E120A");
/** A glass pane box over what's already drawn: dark rim, pale edge, faint tint, two highlight streaks. */
const glass = (g, x, y, w, h, rim = "#2E4A5A") => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const edge = i === 0 || i === w - 1 || j === 0;
    g.px(x + i, y + j, edge ? "#CFEFFF" : "#E6F8FF26");
  }
  for (let j = 0; j < h; j++) g.px(x - 1, y + j, rim).px(x + w, y + j, rim);
  g.rect(x, y - 1, w, 1, rim);
  for (let k = 0; k < Math.min(w, h) - 4; k++) { if (k < h - 4) g.px(x + 2 + Math.floor(k / 3), y + 2 + k, "#FFFFFF66"); }
  for (let k = 0; k < Math.min(w, h) - 8; k++) g.px(x + 4 + Math.floor(k / 3), y + 2 + k, "#FFFFFF33");
};
// Ordered dither for things that fade in and out of sight.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (g, vis, fn) => {
  const s = new Painter(g.w, g.h, g.f);
  fn(s);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const c = s.get(x, y);
    if (c && (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 < vis(x, y)) g.px(x, y, c);
  }
};
// Side-view shoes, toe to the right: h = top-edge shine, # = body, i = the inside, d = sole/heel.
const SHOE_LOW = [
  "hh............",
  "##h...........",
  "###ii.....hbh.",
  "####iiiihh###h",
  "#############d",
  ".dd....######.",
  ".dd.....dddd..",
];
const SHOE_HIGH = [
  "hh..........",
  "#hh.........",
  "##ii........",
  "###ii.......",
  "d###iii..hh.",
  "d..###iihh#h",
  "d....######d",
  "d......dddd.",
];

// A classic zig-zag bolt.
const BOLT = [
  "....hh#",
  "...hh#.",
  "..hh#..",
  "..h#...",
  ".h#....",
  ".h####d",
  "h####d.",
  "...##d.",
  "..##d..",
  "..#d...",
  ".##....",
  ".#d....",
  "#d.....",
  "#......"
];

export const NOD_ITEMS_2 = [
  // ============================================================ fantasy
  it("boltcase", "Lightning Bolt in a Glass Case", "furniture", ["top", "stand"], "any", 1200, 18, 24, "Percy Jackson", (g, f) => {
    const flash = f % 60 < 3;
    g.stamp((l) => { l.rect(1, 20, 16, 4, "#6B4226").rect(1, 20, 16, 1, "#8E5C36").rect(2, 23, 14, 1, "#4A2C16"); l.rect(6, 21, 6, 1, "#D9A441"); }, "#1E120A");
    const pal = flash ? { "#": "#FFFFFF", h: "#FFFFFF", d: "#BFEFFF" } : { "#": "#FFD23F", h: "#FFF6C2", d: "#E0A800" };
    g.stamp((l) => map(l, BOLT, pal, 6, 5), flash ? "#5AA8E6" : "#6B4A00");
    for (let i = 0; i < 3; i++) {
      const k = (f + i * 11) % 18;
      if (k < 4) { const s = Math.floor(f / 18) * 3 + i, x = 4 + Math.floor(rnd(s) * 10), y = 5 + Math.floor(rnd(s + 7) * 13); star(g, x, y, k < 2 ? 1 : 0, k < 2 ? "#FFFFFF" : "#BFEFFF"); }
    }
    glass(g, 3, 3, 12, 17);
    g.stamp((l) => l.rect(2, 1, 14, 2, "#D9A441").rect(2, 1, 14, 1, "#FFE36B").rect(8, 0, 2, 1, "#D9A441"), "#4A3100");
  }, { glow: (f) => [[9, 11, f % 60 < 3 ? 30 : 18 + Math.round(wave(f, 24, 2)), "#FFE36B"]] }),

  it("elderwand", "Knobbly Elder-Wood Wand", "furniture", ["top"], "library", 900, 22, 14, "Harry Potter", (g, f) => {
    // A pale, knobbly wand resting in a velvet-lined case.
    g.stamp((l) => {
      l.rect(0, 5, 22, 8, "#6B4226").rect(0, 5, 22, 1, "#8E5C36").rect(0, 12, 22, 1, "#4A2C16");
      l.rect(1, 6, 20, 5, "#3A1E4A").rect(1, 6, 20, 1, "#241030");
      l.px(10, 12, "#D9A441").px(11, 12, "#D9A441");
    }, "#1E120A");
    g.stamp((l) => {
      for (let x = 2; x <= 7; x++) l.px(x, 7, "#D8C8AE").px(x, 8, "#A8947A");
      for (let x = 8; x <= 19; x++) l.px(x, 8, "#D0BE9E");
      for (const x of [4]) l.px(x, 6, "#C9B89A");
      for (const x of [11, 16]) l.px(x, 7, "#B8A48A").px(x, 8, "#A8947A");
      l.px(2, 8, "#8A765C").px(8, 7, "#A8947A");
    }, "#2A1E16");
    const t = f % 48;
    if (t < 8) star(g, 20, 5, t < 4 ? 1 : 0, t < 4 ? "#FFFFFF" : "#DDEBFF");
    if (t >= 8 && t < 14) { const x = 19 - (t - 8) * 3; g.px(x, x >= 8 ? 8 : 7, "#FFFFFF"); }
  }),

  it("truthcompass", "Golden Truth-Compass", "furniture", ["top"], "library", 1000, 18, 18, "His Dark Materials", (g, f) => {
    g.stamp((l) => l.ell(8.5, 15.5, 8, 2.5, (nx, ny) => (ny < -0.2 ? "#5A4A6E" : "#3A2E4A")), "#0E0A14");
    g.stamp((l) => {
      l.rect(7, 0, 3, 2, "#D9A441").px(8, 0, "#FFE36B");
      l.ell(8.5, 8.5, 7, 7, (nx, ny) => {
        const d = nx * nx + ny * ny;
        if (d > 0.74) return nx + ny < -0.4 ? "#FFE9A0" : nx + ny > 0.6 ? "#A8761A" : "#D9A441";
        if (d > 0.46) return "#7A5400";
        return nx + ny < -0.5 ? "#FFF6D8" : "#F2DC9A";
      });
    }, "#4A3100");
    const cols = ["#E0393E", "#2F80E6", "#1FBF6A", "#FFFFFF", "#8E5CFF", "#FF8A2A"];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.px(Math.floor(8.5 + Math.cos(a) * 4.6), Math.floor(8.5 + Math.sin(a) * 4.6), cols[i % 6]); }
    // Three set hands, and the long needle that spins, then settles on an answer.
    for (const a of [0.4, 2.3, 4.2]) g.line(8, 8, 8 + Math.round(Math.cos(a) * 2), 8 + Math.round(Math.sin(a) * 2), "#8A6400");
    const t = f % 120, k = Math.floor(f / 120), target = Math.floor(rnd(k * 3 + 1) * 12) / 12 * TAU;
    const a = t < 30 ? t * 0.5 + k : target + Math.sin((t - 30) * 0.6) * Math.exp(-(t - 30) * 0.09) * 1.4;
    g.line(8, 8, 8 + Math.round(Math.cos(a) * 3.6), 8 + Math.round(Math.sin(a) * 3.6), "#1A1A22");
    g.px(8, 8, "#B0203A");
    if (t > 60 && t < 66) star(g, 8 + Math.round(Math.cos(target) * 4.6), 8 + Math.round(Math.sin(target) * 4.6), 1, "#FFFFFF");
  }, { glow: [[8, 8, 12, "#FFE08A"]] }),

  it("pensword", "Pen That Becomes a Sword", "furniture", ["top", "stand"], "any", 700, 22, 22, "Percy Jackson", (g, f) => {
    const t = f % 96;
    g.stamp((l) => { l.rect(2, 15, 6, 6, "#8A5A34").rect(2, 15, 6, 1, "#B07A4A").rect(2, 16, 1, 5, "#A06A40").rect(2, 20, 6, 1, "#5E3A1F"); }, "#1E120A");
    g.stamp((l) => {
      l.rect(4, 5, 2, 10, "#F4F1E8").rect(4, 5, 1, 10, "#FFFFFF");
      l.rect(4, 1, 2, 5, "#2F5AB8").px(4, 1, "#5A86E0").px(4, 2, "#5A86E0");
      l.rect(6, 2, 1, 4, "#C9D1DB").px(4, 0, t > 2 && t < 6 ? "#5A86E0" : null);
    }, "#14161C");
    // The bronze leaf-blade beside it, point up, in a little stand.
    const widths = [1, 1, 3, 3, 3, 3, 5, 5, 5, 3, 3, 3];
    g.stamp((l) => {
      widths.forEach((w, j) => { const x0 = 15 - (w - 1) / 2; for (let i = 0; i < w; i++) l.px(x0 + i, 1 + j, i < (w - 1) / 2 ? "#FFE08A" : i === (w - 1) / 2 ? "#D9A441" : "#A8761A"); });
      l.rect(11, 13, 9, 2, "#B07A1A").rect(11, 13, 9, 1, "#FFD23F");
      l.rect(14, 15, 3, 3, "#6B3A1E").px(14, 16, "#8A5424");
      l.rect(12, 18, 7, 2, "#6B4226").rect(10, 20, 11, 2, "#8A5A34").rect(10, 20, 11, 1, "#B07A4A");
    }, "#2A1A08");
    if (t < 6) star(g, 5, 0, t < 3 ? 1 : 0, "#FFE36B");
    if (t >= 6 && t < 18) { const y = 1 + (t - 6); g.px(14, Math.min(12, y), "#FFFFFF"); if (y < 12) g.px(15, y + 1, "#FFF6C2"); }
  }),

  it("seecloak", "Shimmering See-Through Cloak", "wall", ["wall"], "any", 1400, 26, 38, "Harry Potter", (g, f) => {
    // Hung by its collar from a hook: a hood, sloping shoulders, a front opening
    // showing the lining, uneven hem. It fades out towards the hem, and a shimmer
    // runs down it now and then, showing more of it as it passes.
    const band = ((f * 0.6) % 70) - 12;
    const hw = (y) => (y < 10 ? 2 + (y - 4) * 1.1 : 8.6 + (y - 10) * 0.12);
    const cxAt = (y) => 13 + wave(f, 72, 1.2) * clamp01((y - 12) / 22);
    dither(g, (x, y) => (y < 13 ? 1 : 1 - clamp01((y - 13) / 22) * 0.74 + Math.max(0, 1 - Math.abs(y - band) / 4) * 0.55), (s) => {
      s.stamp((l) => {
        for (let y = 4; y < 37; y++) {
          const w = hw(y), cx = cxAt(y);
          for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
            const hem = 34 + Math.round(Math.sin(x * 0.9) * 1 + (x < cx ? 1 : 0));
            if (y > hem) continue;
            const dx = x - cx, gap = y > 11 ? (y - 11) * 0.09 + 0.4 : -1, lin = Math.abs(dx) < gap;
            const fold = Math.sin(dx * 1.2 + y * 0.12) > 0.55;
            l.px(x, y, lin ? "#4A5A8A" : Math.abs(Math.abs(dx) - gap) < 0.9 && y > 11 ? "#E6EEFF" : fold ? (dx < 0 ? "#DCE6FF" : "#9CAAD0") : dx < -w * 0.5 ? "#D0DCF6" : dx > w * 0.55 ? "#94A2CA" : "#B8C6E6");
          }
        }
        // The hood lies over the shoulders behind the collar.
        l.ell(13, 8.5, 6, 3.6, (nx, ny) => (nx * nx + (ny + 0.35) ** 2 < 0.35 ? "#6C7CA4" : ny < -0.3 ? "#E6EEFF" : nx > 0.35 ? "#94A2CA" : "#C8D4F0"));
        l.rect(11, 11, 5, 1, "#C9D1DB").px(13, 11, "#FFFFFF");
      }, "#34405E");
    });
    g.stamp((l) => l.rect(12, 1, 3, 3, "#D9A441").px(12, 1, "#FFE36B"), "#4A3100");
    for (let i = 0; i < 4; i++) { const y = Math.round(band) + (i % 2 ? 2 : -1), x = Math.round(cxAt(y) + (rnd(i * 5 + Math.floor(f / 6)) - 0.5) * hw(Math.max(4, y)) * 1.6); if (y > 12 && y < 35 && (f + i) % 3) g.px(x, y, "#FFFFFF"); }
  }),

  it("talkinghat", "Patched Talking Hat", "furniture", ["top", "stand"], "library", 900, 22, 24, "Harry Potter", (g, f) => {
    const talk = f % 96 < 48, m = talk ? [0, 1, 2, 1][Math.floor(f / 3) % 4] : 0, wob = talk ? Math.round(wave(f, 12, 1)) : 0;
    g.shadow(11, 9, 23);
    g.stamp((l) => {
      l.ell(11, 20, 10.5, 2.8, (nx, ny) => (ny < -0.1 ? "#8A6A44" : nx > 0.4 ? "#4A3420" : "#634628"));
      for (let y = 2; y < 20; y++) {
        const t = (y - 2) / 17, hw = 0.6 + t * 6.2, cx = 12 + (y < 9 ? -(9 - y) * 0.75 + (y < 6 ? wob : 0) : 0);
        for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) {
          const u = (x - (cx - hw)) / (2 * hw + 0.01), crease = (y === 8 || y === 13) && (x + y) % 3 !== 0;
          l.px(x, y, crease ? "#5A3E24" : u < 0.3 ? "#A8875A" : u > 0.75 ? "#5E4228" : "#7E5E3A");
        }
      }
      l.px(4 + wob, 2, "#7E5E3A").px(5 + wob, 2, "#7E5E3A").px(4 + wob, 3, "#5E4228");
      // Patches with stitches.
      l.rect(13, 10, 3, 3, "#9A7A4A").px(13, 10, "#C8A870").px(16, 11, "#E8D8B0").px(12, 12, "#E8D8B0");
      l.rect(7, 16, 3, 2, "#6E5A3A").px(6, 16, "#E8D8B0").px(10, 17, "#E8D8B0");
    }, "#2A1A0E");
    // Frowning brow-folds and a brim-rip mouth that talks.
    g.line(7, 10, 9, 11, "#2A1A0E").line(14, 11, 16, 10, "#2A1A0E");
    if (m === 0) g.line(8, 15, 15, 15, "#2A1A0E").px(8, 14, "#2A1A0E").px(15, 14, "#2A1A0E");
    else g.rect(9, 14, 6, m + 1, "#1A0E06").rect(8, 14, 8, 1, "#2A1A0E").px(10, 14 + m, "#4A2E16").px(13, 14 + m, "#4A2E16");
  }),

  it("footprintmap", "Map of Walking Footprints", "wall", ["wall"], "any", 900, 44, 30, "Harry Potter", (g, f) => {
    g.stamp((l) => {
      for (let y = 2; y < 28; y++) for (let x = 2; x < 42; x++) {
        if ((y === 2 || y === 27) && rnd(x * 3 + y) > 0.8) continue;
        const fold = x === 15 || x === 29, shade = x > 38 || y > 25;
        l.px(x, y, fold ? "#DCC89C" : shade ? "#E6D2A6" : (x + y * 3) % 17 === 0 ? "#EADAB2" : "#F2E3C2");
      }
      l.px(2, 2, "#FFF6DF").px(3, 2, "#FFF6DF").px(2, 3, "#FFF6DF");
    }, "#5A4A36");
    // Ink rooms and corridors.
    const ink = "#8A6A44", box = (x, y, w, h) => g.rect(x, y, w, 1, ink).rect(x, y + h - 1, w, 1, ink).rect(x, y, 1, h, ink).rect(x + w - 1, y, 1, h, ink);
    box(4, 4, 10, 8); box(30, 4, 10, 8); box(16, 16, 11, 9); box(31, 17, 8, 8);
    g.rect(14, 7, 16, 1, ink).rect(14, 10, 16, 1, ink).rect(20, 11, 1, 5, ink).rect(23, 11, 1, 5, ink).rect(27, 20, 4, 1, ink).rect(27, 22, 4, 1, ink);
    g.rect(14, 8, 1, 2, "#F2E3C2").rect(29, 8, 1, 2, "#F2E3C2").rect(21, 16, 2, 1, "#F2E3C2").rect(21, 10, 2, 1, "#F2E3C2").rect(26, 21, 1, 1, "#F2E3C2").rect(31, 21, 1, 1, "#F2E3C2");
    g.rect(6, 20, 6, 4, "#E6D2A6").rect(6, 20, 6, 1, ink);
    // Two walkers leave footprints that fade behind them.
    const walk = (P, speed, off, c) => {
      const segs = []; let L = 0;
      for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); segs.push([P[i - 1], P[i], L, d]); L += d; }
      const at = (s) => { s = ((s % L) + L) % L; for (const [a, b, s0, d] of segs) if (s <= s0 + d) { const u = (s - s0) / d; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, (b[0] - a[0]) / d, (b[1] - a[1]) / d]; } return [P[0][0], P[0][1], 1, 0]; };
      const head = Math.floor((f * speed + off) / 2.5);
      for (let k = 5; k >= 0; k--) {
        const step = head - k, [x, y, dx, dy] = at(step * 2.5), side = step % 2 ? 1 : -1;
        const px = Math.round(x - dy * side * 0.9), py = Math.round(y + dx * side * 0.9);
        const col = k < 2 ? c : k < 4 ? "#6B5A44" : "#B8A47E";
        g.px(px, py, col).px(px + Math.round(dx), py + Math.round(dy), col);
      }
      // A little name-scroll follows each walker.
      const [x, y] = at(head * 2.5), bx = Math.min(36, Math.max(3, Math.round(x) + 2)), by = Math.max(3, Math.round(y) - 5);
      g.stamp((l) => l.rect(bx, by, 6, 3, "#FFF6DF").rect(bx + 1, by + 1, 4, 1, c === "#2A1A0E" ? "#8A6A44" : "#B0603A"), "#5A4A36");
    };
    walk([[8, 8], [22, 8], [22, 20], [35, 21], [35, 8], [22, 8]], 0.35, 0, "#2A1A0E");
    walk([[21, 20], [9, 21], [9, 8], [21, 9]], 0.3, 20, "#6A2A1A");
  }),

  it("excalibur", "Excalibur in the Stone", "furniture", ["stand"], "any", 1300, 32, 40, "Le Morte d'Arthur", (g, f) => {
    g.shadow(16, 14, 39);
    g.stamp((l) => {
      l.ell(16, 31, 14.5, 8.5, (nx, ny, x, y) => {
        if (ny < -0.72) return null;
        if (ny < -0.45 && rnd(x * 7) > 0.55) return "#6FA35E";
        const k = rnd(x * 13 + y * 7);
        if (k > 0.92) return "#6B665E";
        return nx + ny < -0.5 ? "#BDB7AC" : nx + ny > 0.5 ? "#6E6960" : k > 0.5 ? "#8F8A80" : "#9A958A";
      });
      l.line(6, 30, 10, 33, "#6B665E").line(24, 29, 27, 32, "#6B665E");
    }, "#2A2620");
    g.stamp((l) => {
      for (let y = 10; y < 26; y++) l.px(14, y, "#F4F8FC").px(15, y, "#C9D1DB").px(16, y, "#8C97A6");
      l.rect(9, 8, 13, 2, "#D9A441").rect(9, 8, 13, 1, "#FFE36B").px(9, 10, "#D9A441").px(21, 10, "#D9A441");
      for (let y = 3; y < 8; y++) l.rect(14, y, 3, 1, y % 2 ? "#6B3A1E" : "#B07A1A");
      l.ell(15.5, 1.8, 2, 1.8, (nx, ny) => (nx + ny < -0.4 ? "#FFF3A6" : "#D9A441"));
      l.px(15, 1, "#2F80E6");
    }, "#2A1E08");
    g.px(13, 26, "#3A3630").px(17, 26, "#3A3630");
    const t = f % 72;
    if (t < 16) g.px(14, 10 + t, "#FFFFFF").px(15, 10 + t, "#FFFFFF");
    if (t >= 16 && t < 22) star(g, 15, 1, t < 19 ? 1 : 0, "#FFFFFF");
  }, { glow: [[15, 12, 22, "#FFE9A0"]] }),

  it("elvendagger", "Glowing Elven Dagger", "wall", ["wall"], "any", 800, 34, 14, "The Hobbit", (g, f) => {
    const k = 0.5 + 0.5 * Math.sin((TAU * f) / 48);
    plaque(g, 2, 3, 30, 9);
    if (k > 0.45) for (let x = 5; x < 22; x++) g.px(x, 5, "#7FC6FF55").px(x, 9, "#7FC6FF55");
    g.stamp((l) => {
      // A leaf-shaped blade: a point, swelling past the middle, narrowing to the guard.
      for (let x = 3; x < 22; x++) {
        const half = x < 5 ? 0 : x < 8 ? 1 : x > 11 && x < 17 ? 2 : 1;
        for (let dy = -half; dy <= half; dy++) l.px(x, 7 + dy, dy < 0 ? lerpC("#EEF3F8", "#E8FAFF", k) : dy === 0 ? lerpC("#C9D1DB", "#9FE0FF", k) : lerpC("#8C97A6", "#5AA8E6", k));
      }
      l.rect(22, 5, 2, 5, "#C9D1DB").rect(22, 5, 1, 5, "#EEF3F8").px(21, 4, "#C9D1DB").px(21, 10, "#C9D1DB").px(20, 3, "#C9D1DB").px(20, 11, "#C9D1DB");
      l.rect(24, 6, 6, 3, "#3A2418").px(25, 6, "#6B4226").px(27, 6, "#6B4226").px(29, 6, "#6B4226");
      l.ell(31, 7.5, 1.8, 1.8, (nx, ny) => (nx + ny < -0.3 ? "#EEF3F8" : "#A8B2C4"));
    }, "#14161C");
    if (f % 72 < 10) g.px(4 + (f % 72) * 2, 6, "#FFFFFF");
  }, { glow: (f) => [[13, 7, 10 + Math.round(8 * (0.5 + 0.5 * Math.sin((TAU * f) / 48))), "#5AB8FF"]] }),

  it("birdpin", "Bird-in-a-Ring Pin", "furniture", ["top"], "any", 500, 18, 16, "The Hunger Games", (g, f) => {
    g.stamp((l) => { l.ell(9, 13, 8.3, 2.8, (nx, ny) => (ny < -0.2 ? "#C8303F" : nx > 0.4 ? "#6A0E1E" : "#8A1428")); l.px(0, 14, "#FFD23F").px(17, 14, "#FFD23F"); }, "#2A0408");
    // A gold brooch: a songbird in flight, raised on a darker gold disc inside a bright ring.
    g.stamp((l) => l.ell(9, 6.5, 6.4, 6.4, (nx, ny) => { const d = nx * nx + ny * ny; return d < 0.62 ? "#8A6010" : nx + ny < -0.4 ? "#FFF3A6" : nx + ny > 0.5 ? "#C89A1A" : "#FFD23F"; }), "#4A3000");
    map(g, [
      "h........",
      "hh.......",
      ".hh...##.",
      "..hh.#e#>",
      "..######.",
      ".######..",
      "##..#....",
      "#........",
    ], { h: "#FFF3A6", "#": "#FFD23F", e: "#4A3000", ">": "#FFB400" }, 5, 3);
    const t = f % 60;
    if (t < 12) { const a = (t / 12) * Math.PI + Math.PI; g.px(Math.round(9 + Math.cos(a) * 5.6), Math.round(6.5 + Math.sin(a) * 5.6), "#FFFFFF"); }
  }),

  it("fadingcap", "Invisible Baseball Cap", "furniture", ["top", "stand"], "any", 600, 18, 16, "Percy Jackson", (g, f) => {
    const t = f % 120, v = t < 40 ? 1 : t < 56 ? 1 - (t - 40) / 16 * 0.92 : t < 88 ? 0.08 : t < 104 ? 0.08 + (t - 88) / 16 * 0.92 : 1;
    g.stamp((l) => { l.rect(8, 9, 2, 5, "#8A5A34").px(8, 9, "#B07A4A"); l.rect(4, 14, 10, 1, "#6B4226").rect(5, 13, 8, 1, "#A06A40"); }, "#1E120A");
    dither(g, () => v, (s) => s.stamp((l) => {
      l.ell(8.5, 9, 6, 5.5, (nx, ny) => (ny > 0.05 ? null : nx + ny < -0.6 ? "#4A5AA8" : nx > 0.5 ? "#1E2A5A" : "#2A3A7A"));
      l.rect(3, 9, 12, 1, "#1E2A5A");
      l.rect(12, 9, 6, 2, "#22306A").rect(12, 9, 5, 1, "#3A4A8A");
      l.px(8, 4, "#4A5AA8").px(9, 4, "#4A5AA8");
      l.line(8, 5, 6, 8, "#1E2A5A");
    }, "#0A1030"));
    if (v < 0.6) for (let i = 0; i < 3; i++) { const k = (f + i * 5) % 15; if (k < 3) g.px(4 + Math.floor(rnd(i + Math.floor(f / 15) * 3) * 12), 4 + Math.floor(rnd(i * 7 + Math.floor(f / 15)) * 6), "#BFD8FF"); }
  }),

  it("frostring", "Frost Dragon Ring", "furniture", ["top"], "any", 900, 20, 20, "A Song of Ice and Fire", (g, f) => {
    g.stamp((l) => { l.rect(4, 16, 12, 3, "#CFEFFF").rect(4, 16, 12, 1, "#FFFFFF").rect(14, 17, 2, 2, "#9FCFE8").px(6, 17, "#FFFFFF").px(9, 18, "#A8D8F0"); }, "#2E5A7A");
    g.stamp((l) => l.ell(10, 12.5, 4.4, 4.2, (nx, ny, x, y) => {
      const d = nx * nx + ny * ny;
      if (d < 0.34) return null;
      return nx + ny < -0.4 ? "#DFF6FF" : nx + ny > 0.5 ? "#3A7AB0" : (x + y) % 3 === 0 ? "#5AA8E0" : "#7FC6F0";
    }), "#1E3A5A");
    // A little ice dragon perched on the band: head and neck to the left, a wing up, tail curled round.
    const B = "#BFE8FF", H = "#F0FBFF", S = "#7FB8E0";
    g.stamp((l) => {
      l.ell(11.5, 8, 4.2, 1.9, (nx, ny) => (ny < -0.3 ? H : ny > 0.4 ? S : B));
      l.line(8, 7, 5, 4, B).line(9, 7, 6, 4, S);
      l.rect(2, 3, 4, 1, H).rect(1, 4, 6, 1, B).rect(3, 5, 3, 1, S).rect(1, 6, 3, 1, S).px(6, 2, H).px(7, 1, H);
      for (let y = 1; y <= 6; y++) { const x0 = [0, 13, 12, 12, 11, 11, 11][y], x1 = [0, 17, 16, 15, 15, 14, 13][y]; for (let x = x0; x <= x1; x++) l.px(x, y, y === 1 || x === x0 ? H : (x + y) % 3 === 0 ? S : B); }
      l.px(14, 0, H).px(17, 0, H);
      l.line(15, 9, 16, 10, B).line(16, 10, 16, 13, B).px(15, 14, B).px(14, 14, H);
      l.px(9, 10, S).px(13, 10, S);
    }, "#1E3A5A");
    const blink = f % 60 < 3;
    g.px(3, 4, blink ? B : "#2F80E6");
    if (f % 36 < 12) g.px(0, 5 + ((f >> 2) % 3), "#FFFFFFaa");
    for (let i = 0; i < 3; i++) { const a = f * 0.09 + (i * TAU) / 3, x = 10 + Math.cos(a) * 8.5, y = 12 + Math.sin(a) * 4; star(g, Math.round(x), Math.round(y), (f + i * 4) % 12 < 4 ? 1 : 0, "#FFFFFF"); }
  }, { glow: [[10, 9, 16, "#9FD8FF"]] }),

  it("threerelics", "Three Relics Display", "furniture", ["stand"], "library", 1500, 34, 36, "Harry Potter", (g, f) => {
    g.shadow(17, 15, 35);
    g.stamp((l) => {
      l.rect(1, 22, 32, 3, "#6B4226").rect(1, 22, 32, 1, "#8E5C36");
      l.rect(3, 25, 3, 10, "#5A3820").rect(28, 25, 3, 10, "#5A3820").rect(3, 31, 28, 1, "#5A3820");
    }, "#1E120A");
    g.rect(3, 18, 28, 4, "#3A1E4A").rect(3, 18, 28, 1, "#5A2E6A");
    // A pale wand, a small dark stone, a folded silvery cloak.
    g.stamp((l) => { l.line(5, 17, 13, 13, "#C9B89A").px(5, 16, "#9A8468").px(8, 15, "#9A8468").px(11, 14, "#9A8468"); }, "#2A1E16");
    g.stamp((l) => l.ell(18, 16.5, 2.4, 1.8, (nx, ny) => (nx + ny < -0.5 ? "#8C95A8" : "#3A3F4B")), "#0B0B10");
    g.stamp((l) => {
      for (let y = 12; y < 18; y++) for (let x = 22; x < 30; x++) {
        const shine = ((x - y + Math.floor(f * 0.4)) % 14 + 14) % 14 < 2;
        l.px(x, y, shine ? "#FFFFFF" : y === 12 ? "#E6EEFF" : y === 14 || y === 16 ? "#9CA8C8" : "#C8D4E8");
      }
    }, "#34405E");
    glass(g, 2, 3, 30, 19);
    g.stamp((l) => l.rect(1, 1, 32, 2, "#D9A441").rect(1, 1, 32, 1, "#FFE36B").rect(16, 0, 2, 1, "#D9A441"), "#4A3100");
    const t = f % 96;
    if (t < 20) for (let k = 0; k < 4; k++) g.px(4 + t + k, 19 - t / 1.4 - k * 1.3 * 0 - k, "#FFFFFF99");
  }),

  // ============================================================ dystopian & sci-fi
  it("watchscreen", "Watching Wall-Screen", "wall", ["wall"], "any", 900, 40, 30, "1984", (g, f) => {
    g.stamp((l) => {
      l.rect(1, 1, 38, 27, "#5A606E").rect(1, 1, 38, 1, "#8C97A6").rect(1, 27, 38, 1, "#3A3F4B");
      l.rect(3, 3, 34, 20, "#23262E");
      for (let x = 5; x < 22; x += 2) l.px(x, 25, "#3A3F4B");
      l.rect(28, 24, 3, 3, "#8C97A6").px(28, 24, "#C9D1DB");
    }, "#14161C");
    const scan = Math.floor(f * 0.5) % 24;
    for (let y = 4; y < 22; y++) for (let x = 4; x < 36; x++) g.px(x, y, Math.abs(y - 4 - scan) < 1 ? "#557A6E" : y % 2 ? "#3A5048" : "#40584F");
    const look = [0, -3, 0, 3, 0][Math.floor(f / 30) % 5], bt = f % 84, blink = bt < 3 ? 1 : bt < 5 ? 0.5 : 0;
    const almond = (nx, ny) => Math.abs(ny) < 1 - nx * nx;
    g.ell(20, 13, 10, 5.4, (nx, ny) => (almond(nx, ny) ? (ny < -0.45 ? "#B8C8BC" : "#DCE6DA") : null));
    g.ell(20 + look, 13, 3.4, 3.4, (nx, ny, x, y) => { if (!almond((x + 0.5 - 20) / 10, (y + 0.5 - 13) / 5.4)) return null; const d = nx * nx + ny * ny; return d < 0.18 ? "#0B0D12" : d > 0.7 ? "#1E3440" : "#3A6A7A"; });
    g.px(19 + look, 11, "#FFFFFF");
    // The lid comes down over the eye to blink.
    const lidTo = blink === 1 ? 13 : blink ? 11 : -1;
    g.ell(20, 13, 10, 5.4, (nx, ny, x, y) => (almond(nx, ny) && y <= lidTo ? "#7E9086" : null));
    for (let x = 10; x <= 30; x++) {
      const nx = (x + 0.5 - 20) / 10, top = Math.round(13 - (1 - nx * nx) * 5.4);
      g.px(x, top, "#1A2A26");
      if (blink) g.px(x, Math.max(top, Math.min(lidTo, Math.round(13 + (1 - nx * nx) * 5.4) - 1)), "#1A2A26");
    }
    g.line(12, 6, 17, 5, "#1A2A26").line(23, 5, 28, 6, "#1A2A26");
    g.px(34, 25, f % 24 < 12 ? "#FF4D4D" : "#7A2A2A");
  }, { glow: [[20, 13, 26, "#8FE0C0"]] }),

  it("coralweight", "Glass Paperweight with Coral", "furniture", ["top"], "library", 300, 16, 14, "1984", (g, f) => {
    g.shadow(8, 7, 13);
    // A pink, rose-like knot of coral, curled like a sea anemone.
    g.ell(8, 8.5, 4.2, 3.4, (nx, ny) => { const r = Math.hypot(nx, ny), a = Math.atan2(ny, nx), s = Math.sin(a * 2 + r * 9); return r > 0.85 ? "#C8406A" : s > 0.55 ? "#FFC8D2" : s < -0.35 ? "#D8507A" : "#FF7A95"; });
    g.px(4, 6, "#FF7A95").px(3, 5, "#FFC8D2").px(12, 6, "#FF7A95").px(13, 5, "#FFC8D2").px(7, 4, "#FF7A95").px(9, 5, "#FF7A95").px(6, 3, "#FFC8D2");
    g.rect(3, 11, 10, 1, "#E8C8A0");
    g.stamp((l) => l.ell(8, 10.5, 7, 9, (nx, ny) => (ny > 0.25 ? null : nx * nx + ny * ny > 0.78 ? "#DFF6FFcc" : "#E6F8FF30")), "#2E4A5A");
    g.rect(2, 12, 12, 1, "#9FC8E0");
    g.px(4, 5, "#FFFFFF").px(5, 4, "#FFFFFF").px(6, 3, "#FFFFFFaa");
    if (f % 72 < 5) star(g, 11, 4, f % 72 < 2 ? 1 : 0, "#FFFFFF");
  }),

  it("robohound", "Robo-Hound", "furniture", ["stand"], "workshop", 1400, 52, 24, "Fahrenheit 451", (g, f) => {
    const t = f % 160, walking = (t < 64) || (t >= 80 && t < 144);
    const dir = t < 80 ? 1 : -1, cx = Math.round(t < 64 ? 19 + (t / 64) * 13 : t < 80 ? 32 : t < 144 ? 32 - ((t - 80) / 64) * 13 : 19);
    const X = (lx) => cx + dir * lx, sniff = !walking && (f % 8 < 4) ? 1 : 0, bob = walking && f % 4 < 2 ? -1 : 0;
    g.shadow(cx + dir * 2, 11, 23);
    // Eight thin legs splayed spider-wise under it, stepping in turn (far ones darker).
    for (const far of [1, 0]) for (let i = far; i < 8; i += 2) {
      const root = -6 + i * 1.7, spread = (i - 3.5) * 0.8, ph = f * 0.9 + i * 1.6;
      const step = walking ? Math.round(Math.sin(ph) * 1.4) : 0, lift = walking && Math.sin(ph + 1.2) > 0.6 ? 1 : 0;
      const col = far ? "#4A4F5A" : "#8C97A6", knee = [X(root + spread * 1.3), 18 + bob], foot = [X(root + spread * 2 + step), 22 - lift];
      g.line(X(root), 14 + bob, knee[0], knee[1], col).line(knee[0], knee[1], foot[0], foot[1], col);
      g.px(knee[0], knee[1], far ? "#6B7489" : "#DDE3EC").px(foot[0], 22 - lift, "#2A2E36");
    }
    const hy = 8 + bob + sniff;
    g.stamp((l) => {
      l.line(X(-8), 12 + bob, X(-11), 9 + bob, "#8C97A6").line(X(-11), 9 + bob, X(-12), 6 + bob, "#8C97A6"); l.px(X(-12), 5 + bob, "#FF4D4D");
      l.ell(X(0), 12.5 + bob, 8.5, 3, (nx, ny) => (ny < -0.35 ? "#EEF3F8" : ny > 0.45 ? "#6B7489" : "#A8B2C4"));
      for (const lx of [-4, -1, 2]) l.px(X(lx), 12 + bob, "#7E8898").px(X(lx), 13 + bob, "#7E8898");
      l.line(X(6), 11 + bob, X(8), hy + 1, "#A8B2C4").line(X(7), 12 + bob, X(9), hy + 2, "#8C97A6");
      l.ell(X(10), hy, 3.2, 2.3, (nx, ny) => (ny < -0.3 ? "#EEF3F8" : ny > 0.5 ? "#6B7489" : "#A8B2C4"));
      l.rect(Math.min(X(12), X(15)), hy, 4, 1, "#A8B2C4").rect(Math.min(X(12), X(15)), hy + 1, 4, 1, "#7E8898");
      l.px(X(9), hy - 3, "#C9D1DB").px(X(8), hy - 4, "#C9D1DB").px(X(9), hy - 2, "#A8B2C4");
      l.px(X(16), hy + 1, "#C9D1DB").px(X(17), hy + 1, "#C9D1DB");
    }, "#14161C");
    const pulse = (f % 12 < 6) || sniff;
    g.px(X(11), hy - 1, "#6BFFD8").px(X(18), hy + 1, pulse ? "#DFFFF6" : "#6BFFD8");
    if (pulse) g.px(X(19), hy + 1, "#6BFFD888").px(X(18), hy, "#6BFFD866").px(X(18), hy + 2, "#6BFFD866");
  }, { glow: (f) => { const t = f % 160, dir = t < 80 ? 1 : -1, cx = Math.round(t < 64 ? 19 + (t / 64) * 13 : t < 80 ? 32 : t < 144 ? 32 - ((t - 80) / 64) * 13 : 19); return [[cx + dir * 18, 9, 14, "#6BFFD8"]]; } }),

  it("lastbook", "The Last Book", "furniture", ["stand"], "library", 1000, 24, 42, "Fahrenheit 451", (g, f) => {
    g.shadow(12, 10, 41);
    g.stamp((l) => {
      l.rect(4, 23, 16, 2, "#E6E0D2").rect(4, 23, 16, 1, "#FFFFFF");
      l.rect(7, 25, 10, 12, "#C9C2B2"); for (const x of [9, 12, 15]) l.rect(x, 26, 1, 10, "#A8A090");
      l.rect(4, 37, 16, 2, "#D6D0C2").rect(3, 39, 18, 2, "#B8B2A4");
    }, "#3A3428");
    g.rect(5, 20, 14, 2, "#3A1E1E");
    g.stamp((l) => {
      l.rect(5, 18, 14, 2, "#8A1428").rect(5, 18, 14, 1, "#B0203A");
      l.rect(6, 13, 6, 5, "#FFF6DF").rect(12, 13, 6, 5, "#F2E3C2").px(12, 13, "#DCC89C").px(12, 17, "#DCC89C");
      for (const y of [14, 16]) l.rect(7, y, 4, 1, "#B3A383").rect(13, y, 4, 1, "#B3A383");
    }, "#3A0610");
    if (f % 48 < 24) g.px(9 + (f % 6 < 3 ? 0 : 1), 11, "#FFE36B");
    glass(g, 5, 6, 14, 14, "#1B1E26");
    g.stamp((l) => {
      l.rect(3, 4, 2, 18, "#8C97A6").rect(19, 4, 2, 18, "#8C97A6").rect(3, 3, 18, 2, "#8C97A6").rect(3, 3, 18, 1, "#C9D1DB");
      for (const y of [7, 12, 17]) l.px(3, y, "#DDE3EC").px(20, y, "#DDE3EC");
      l.rect(10, 1, 4, 2, "#5A606E");
    }, "#14161C");
    for (let i = 0; i < 4; i++) {
      const t = ((f * 0.7 + i * 13) % 40) / 40, x = i % 2 ? 22 : 1, y = Math.round(38 - t * 34);
      if (t < 0.85) g.px(x + Math.round(Math.sin(f * 0.3 + i) * 0.8), y, t < 0.4 ? "#FFE36B" : t < 0.7 ? "#FF8A2A" : "#C8402A");
    }
  }, { glow: [[12, 14, 18, "#FFB36B"]] }),

  it("waspjar", "Wasp Nest in a Jar", "furniture", ["top"], "greenhouse", 400, 16, 20, "The Hunger Games", (g, f) => {
    const jit = f % 48 < 8 ? (f % 2 ? 1 : 0) : 0;
    g.line(8 + jit, 4, 8 + jit, 6, "#8A7A5A");
    g.stamp((l) => l.ell(8 + jit, 11, 4, 5.5, (nx, ny, x, y) => (y % 2 ? (nx < -0.3 ? "#E0D8C8" : "#C9C0AE") : nx > 0.4 ? "#9A907E" : "#B0A692")), "#4A4232");
    g.rect(7 + jit, 16, 2, 1, "#2A2418");
    for (let i = 0; i < 3; i++) {
      const a = f * 0.33 + i * 2.1, x = Math.round(8 + jit + Math.cos(a) * 5), y = Math.round(11 + Math.sin(a * 1.3 + i) * 5.5);
      const d = Math.cos(a) < 0 ? 1 : -1;
      g.px(x - d, y, "#FFD23F").px(x, y, "#1A1A22").px(x + d, y, "#FFD23F").px(x + 2 * d, y, "#1A1A22");
      g.px(x, y - 1, f % 2 ? "#FFFFFFdd" : "#DDEBFF99");
    }
    g.stamp((l) => {
      for (let y = 5; y < 19; y++) for (let x = 2; x < 14; x++) {
        if ((y === 18 && (x === 2 || x === 13))) continue;
        l.px(x + jit, y, x === 2 || x === 13 || y === 18 ? "#CFEFFFd0" : "#E6F8FF28");
      }
    }, "#2E4A5A");
    g.rect(4 + jit, 7, 1, 9, "#FFFFFF88");
    g.stamp((l) => { l.rect(3 + jit, 2, 10, 3, "#8C97A6").rect(3 + jit, 2, 10, 1, "#C9D1DB"); for (const x of [5, 8, 11]) l.px(x + jit, 3, "#3A3F4B"); }, "#14161C");
    if (jit) { g.px(0, 9, "#1A1A22").px(0, 11, "#1A1A22").px(15, 8, "#1A1A22").px(15, 12, "#1A1A22"); }
  }),

  it("cornucopia", "Golden Cornucopia", "furniture", ["stand"], "any", 1300, 46, 32, "The Hunger Games", (g, f) => {
    g.shadow(24, 22, 31);
    const P0 = [14, 18], P1 = [36, 28], P2 = [42, 4];
    g.stamp((l) => {
      for (let i = 100; i >= 0; i--) {
        const t = i / 100, u = 1 - t, cx = u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], cy = u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1];
        const r = 9.5 * Math.pow(u, 1.15) + 0.9, band = Math.floor(t * 12) % 2;
        l.ell(cx, cy, r, r, (nx, ny) => (nx + ny < -0.7 ? "#FFF3A6" : nx + ny > 0.5 ? (band ? "#B07A1A" : "#9A6A10") : band ? "#FFD23F" : "#E6B42A"));
      }
      l.ell(13, 18, 4.8, 9.8, (nx, ny) => (nx * nx + ny * ny > 0.62 ? (nx < -0.2 ? "#FFF3A6" : "#FFD23F") : ny > 0.35 ? "#5A3A00" : "#2A1A00"));
    }, "#4A3100");
    // Supplies spilling out of the mouth.
    g.stamp((l) => {
      l.rect(2, 20, 8, 9, "#FF8A2A").rect(2, 20, 8, 3, "#E06A1A").rect(2, 20, 8, 1, "#FFB36B").rect(5, 23, 2, 2, "#FFD23F");
      l.ell(15, 28, 4.5, 2.2, (nx, ny) => (ny < -0.3 ? "#E8B878" : "#C88A45")); l.px(13, 27, "#9A6A32").px(16, 27, "#9A6A32");
      l.ell(21, 28.5, 2, 2, (nx, ny) => (nx + ny < -0.5 ? "#FF7A7A" : "#D8202A")); l.px(21, 26, "#3FA35E");
      l.rect(10, 24, 3, 6, "#5AA8E6").rect(10, 24, 1, 6, "#9FD8FF").rect(11, 23, 1, 1, "#3A3F4B");
      l.ring(26, 29, 2.2, "#C9A06A"); l.px(26, 29, "#8A6A3A");
    }, "#1A1A22");
    const t = f % 72;
    if (t < 24) { const u = 1 - t / 24, s = 1 - u, x = u * u * P0[0] + 2 * u * s * P1[0] + s * s * P2[0], y = u * u * P0[1] + 2 * u * s * P1[1] + s * s * P2[1] - (9.5 * Math.pow(u, 1.15) + 0.9) * 0.75; g.px(x, y, "#FFFFFF"); }
  }, { glow: [[26, 18, 26, "#FFE08A"]] }),

  it("memorychair", "Memory Armchair", "furniture", ["stand"], "library", 800, 34, 34, "The Giver", (g, f) => {
    const p = 0.5 + 0.5 * Math.sin((TAU * f) / 72);
    g.shadow(17, 15, 33);
    g.stamp((l) => {
      l.rect(5, 29, 2, 4, "#4A2C16").rect(27, 29, 2, 4, "#4A2C16");
      l.ell(17, 10, 12, 9, (nx, ny) => (ny > 0.6 ? null : nx + ny < -0.6 ? "#B88E7E" : "#94685C"));
      l.rect(6, 10, 22, 12, "#94685C");
      l.rect(10, 5, 4, 4, "#6A8A8A").px(10, 5, "#8AAAAA").px(9, 6, "#E8D8B0").px(14, 7, "#E8D8B0");
      l.line(20, 6, 24, 12, "#7A5448");
    }, "#2E1612");
    g.stamp((l) => {
      l.rect(7, 20, 20, 5, "#A87868").rect(7, 20, 20, 1, "#C89A88");
      l.rect(3, 24, 28, 6, "#94685C").rect(3, 29, 28, 1, "#6E4A40");
      for (const x of [2, 27]) l.rect(x, 15, 5, 10, "#94685C").rect(x, 15, 5, 1, "#B88E7E");
      l.rect(20, 25, 4, 3, "#C8A060").px(19, 26, "#E8D8B0").px(24, 26, "#E8D8B0");
      l.px(2, 16, "#F4F1E8").px(3, 15, "#F4F1E8").px(2, 15, "#FFFFFF");
    }, "#2E1612");
    // A faint warm glow: a halo just outside the chair and a breath of light on it.
    const halo = Math.round(40 + 90 * p).toString(16).padStart(2, "0"), tint = Math.round(10 + 40 * p).toString(16).padStart(2, "0");
    const solid = [];
    for (let y = 0; y < 34; y++) for (let x = 0; x < 34; x++) { const c = g.get(x, y); solid.push(!!c && c.length === 7); }
    const on = (x, y) => x >= 0 && y >= 0 && x < 34 && y < 34 && solid[y * 34 + x];
    for (let y = 0; y < 33; y++) for (let x = 0; x < 34; x++) {
      if (on(x, y)) g.px(x, y, "#FFE0A0" + tint);
      else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) g.px(x, y, "#FFD27A" + halo);
      else if (on(x - 2, y) || on(x + 2, y) || on(x, y - 2)) g.px(x, y, "#FFD27A" + Math.round(15 + 35 * p).toString(16).padStart(2, "0"));
    }
    for (let i = 0; i < 4; i++) {
      const t = ((f * 0.5 + i * 11) % 44) / 44, x = Math.round(9 + i * 5 + Math.sin(f * 0.1 + i * 2) * 1.5), y = Math.round(21 - t * 21);
      if (t < 0.85) g.px(x, y, i === 2 ? "#FF3040" : t < 0.5 ? "#FFF3C2" : "#FFE9A0aa");
    }
  }, { glow: (f) => [[17, 16, 22 + Math.round(wave(f, 72, 4)), "#FFE0A0"]] }),

  it("empathymachine", "Empathy Test Machine", "furniture", ["top", "stand"], "workshop", 1000, 26, 24, "Do Androids Dream of Electric Sheep?", (g, f) => {
    const hB = 5 + Math.round(wave(f, 36, 1.5)), pr = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin((TAU * f) / 48));
    g.stamp((l) => {
      for (let j = 0; j < hB; j++) l.rect(j % 2 ? 4 : 3, 13 - 1 - j, j % 2 ? 6 : 8, 1, j % 2 ? "#3A2418" : "#6B4226");
      l.rect(3, 12 - hB, 8, 1, "#D9A441");
      l.line(10, 10, 15, 8, "#3A3F4B");
      l.rect(18, 8, 2, 6, "#8C97A6").rect(18, 8, 1, 6, "#C9D1DB");
      l.rect(1, 13, 24, 9, "#4A4F5A").rect(1, 13, 24, 1, "#6B7489").rect(1, 21, 24, 1, "#3A3F4B");
      l.rect(3, 15, 9, 5, "#0E2A1E");
      l.px(15, 17, "#C9D1DB").px(18, 17, "#C9D1DB").px(21, 17, "#C9D1DB").rect(15, 19, 7, 1, "#6B7489");
      l.rect(2, 22, 3, 1, "#3A3F4B").rect(21, 22, 3, 1, "#3A3F4B");
    }, "#14161C");
    for (let x = 3; x < 12; x++) g.px(x, 17 + Math.round(Math.sin(x * 1.3 + f * 0.6) * 1.4 * (x % 3 ? 1 : 0.4)), "#6BFF8A");
    g.stamp((l) => l.ell(19.5, 5, 4.6, 4.6, (nx, ny) => {
      const d = nx * nx + ny * ny;
      if (d > 0.62) return nx + ny < -0.4 ? "#FFE36B" : "#B07A1A";
      if (d < pr * 0.35) return "#0B0D12";
      if (d < 0.36) return "#4A8AC8";
      return "#DDEEFF";
    }), "#2A1E08");
    g.px(18, 3, "#FFFFFF");
    if (f % 48 < 3) g.px(22, 20, "#FF4D4D"); else g.px(22, 20, "#7A2A2A");
  }, { glow: [[19, 5, 12, "#9FD8FF"]] }),

  it("spicejar", "Spice Jar", "furniture", ["top"], "kitchen", 450, 12, 16, "Dune", (g, f) => {
    for (let y = 7; y < 15; y++) for (let x = 3; x < 9; x++) {
      const s = Math.sin(x * 0.9 + y * 0.7 - f * 0.25);
      g.px(x, y, y === 7 ? "#FFB35A" : s > 0.7 ? "#FFD08A" : rnd(x * 7 + y * 13) > 0.5 ? "#FF8A2A" : "#E0701A");
    }
    for (let i = 0; i < 3; i++) { const t = ((f + i * 9) % 27) / 27; if (t < 0.7) g.px(4 + ((i * 2 + (f >> 3)) % 4), Math.round(7 - t * 3), "#FFE36B"); }
    g.stamp((l) => {
      for (let y = 4; y < 16; y++) for (let x = 2; x < 10; x++) {
        if ((y === 15 || y === 4) && (x === 2 || x === 9)) continue;
        l.px(x, y, x === 2 || x === 9 || y === 15 ? "#E6F4FFd0" : "#E6F8FF22");
      }
    }, "#4A2408");
    g.rect(3, 6, 1, 7, "#FFFFFF99");
    g.stamp((l) => l.rect(3, 1, 6, 3, "#C88A45").rect(3, 1, 6, 1, "#E0A860").px(8, 2, "#A86A32"), "#3A1E08");
  }, { glow: (f) => [[6, 10, 16 + Math.round(wave(f, 36, 3)), "#FF9A3D"]] }),

  it("greenribbon", "Green Ribbon on a Hook", "wall", ["wall"], "any", 150, 18, 24, "The Handmaid's Tale", (g, f) => {
    const sw = wave(f, 60, 1);
    // A satin bow hung from a brass hook: two broad loops, a knot, and two notched tails.
    g.stamp((l) => {
      for (const s0 of [-1, 1]) for (let y = 8; y < 22; y++) {
        const u = (y - 8) / 13, x = Math.round(9 + s0 * (1 + u * 3.2) + Math.sin(u * 4 + s0) * 0.8 + sw * u * 1.4) - (s0 < 0 ? 2 : 0);
        const end = y >= 20;
        if (!(end && y === 21)) l.px(x, y, "#6FD08A").px(x + 1, y, "#2FA35E").px(x + 2, y, end ? null : "#1F7040");
        if (y === 21) l.px(x, y, "#2FA35E").px(x + 2, y, "#1F7040");
      }
      for (const s0 of [-1, 1]) l.ell(9 + s0 * 4.5, 6, 4.2, 2.8, (nx, ny) => (((nx * 4.2) ** 2) / 4 + (ny * 2.8) ** 2 / 1.2 < 1 ? null : ny < -0.3 ? "#6FD08A" : ny > 0.4 ? "#1F7040" : "#2FA35E"));
      l.rect(8, 5, 3, 3, "#2FA35E").px(8, 5, "#6FD08A").px(10, 7, "#1F7040");
    }, "#0E2A16");
    g.stamp((l) => l.rect(8, 1, 3, 2, "#D9A441").px(8, 1, "#FFE36B").px(9, 3, "#D9A441"), "#4A3100");
    if (f % 48 < 8) g.px(3 + (f % 48), 5, "#FFFFFF99");
  }),

  it("silvershoes", "The Silver Shoes", "furniture", ["top", "stand"], "bedroom", 1000, 24, 14, "The Wonderful Wizard of Oz", (g, f) => {
    const t = f % 96, clickN = t < 24 ? Math.floor(t / 8) : -1, ph = t % 8, tap = clickN >= 0 && ph < 4 ? (ph < 2 ? 1 : 0) : 0;
    const P = { h: "#FFFFFF", "#": "#D0D7E2", i: "#5A6478", d: "#7E8898", b: "#A8C0FF" };
    g.shadow(12, 10, 13);
    // The back shoe lifts and clicks its heel against the front one, three times.
    g.stamp((l) => map(l, SHOE_LOW, P, 0 + tap, 5 - tap), "#2A303C");
    g.stamp((l) => map(l, SHOE_LOW, P, 10, 6), "#2A303C");
    if (clickN >= 0 && ph === 1) star(g, 11, 4, 2, "#FFFFFF");
    if (clickN >= 0 && ph === 2) star(g, 11, 4, 1, "#DDEBFF");
    const k = f % 40;
    if (k < 4) g.px(20 - k, 9 + (k >> 1), "#FFFFFF");
  }, { glow: [[12, 9, 12, "#DDEBFF"]] }),

  // ============================================================ innocence & romance
  it("glassanimals", "Shelf of Glass Animals", "wall", ["wall"], "any", 700, 46, 22, "The Glass Menagerie", (g, f) => {
    g.stamp((l) => { l.rect(1, 16, 44, 2, "#8A5A34").rect(1, 16, 44, 1, "#B07A4A"); l.rect(5, 18, 2, 3, "#5E3A1F").rect(39, 18, 2, 3, "#5E3A1F"); }, "#2A160A");
    const glassy = (c, s) => ({ "#": c, s, w: "#FFFFFF" });
    g.stamp((l) => {
      map(l, [".##....", "o##....", "..#....", "..#..#.", ".######", "..####."], { ...glassy("#F2F8FF", "#C8DCEB"), o: "#FFD8B8" }, 3, 10);
      map(l, ["#.#..", "###..", "w##..", ".##..", ".###.", ".####", ".sss#"], glassy("#E6DAFF", "#B8A8E0"), 11, 9);
      map(l, [".#######", "########", "w#######", "#.######", "#.##.##.", "..s..s.."], glassy("#D6F4E6", "#A8D8C0"), 34, 10);
    }, "#4A6A7A");
    // The unicorn, a little bigger, horn catching the light.
    g.stamp((l) => map(l, [
      "h.........",
      ".h........",
      ".###......",
      "####......",
      "..w#......",
      "..########",
      "..#######s",
      "..sssssss.",
      "..#.#..#.#",
      "..#.#..#.#",
    ], { h: "#FFE9A0", "#": "#EEF8FF", s: "#BFDCEB", w: "#FFFFFF" }, 20, 6), "#4A6A7A");
    const t = f % 48;
    if (t < 6) star(g, 20, 6, t < 3 ? 1 : 0, "#FFFFFF");
    const rb = ["#FF6B6B", "#FFD23F", "#6BFF8A", "#6BC8FF", "#C89BFF"];
    g.px(24 + (Math.floor(f / 6) % 4), 15, rb[Math.floor(f / 6) % 5] + "cc");
  }),

  it("huntinghat", "Red Hunting Hat on a Peg", "wall", ["wall"], "bedroom", 300, 24, 22, "The Catcher in the Rye", (g, f) => {
    const sw = Math.round(wave(f, 64, 0.8));
    // A red hunting cap: round crown, ear flaps let down, and a very long peak.
    g.stamp((l) => {
      for (const [x, h] of [[4 + sw, 7], [13 + sw, 5]]) { l.rect(x, 11, 4, h, "#C8203A").rect(x, 11, 1, h, "#FF5A6A").rect(x + 1, 11 + h, 2, 1, "#C8203A").rect(x, 13, 4, 1, "#9A1428"); }
      l.ell(11, 11, 7.5, 7, (nx, ny) => (ny > 0 ? null : nx + ny < -0.6 ? "#FF6A7A" : nx > 0.5 ? "#A01830" : "#D8283A"));
      l.px(8, 6, "#FF8A96").px(7, 7, "#FF8A96");
      l.line(11, 4, 11, 10, "#B01E32").line(11, 4, 7, 10, "#B01E32").line(11, 4, 15, 10, "#B01E32");
      l.rect(4, 10, 15, 2, "#B01E32").rect(4, 10, 15, 1, "#E0404E");
      l.rect(16, 11, 7, 2, "#A01830").rect(16, 11, 7, 1, "#E0404E").px(23, 12, "#A01830");
      l.px(11, 3, "#A01830").px(10, 3, "#C8203A");
    }, "#3A0610");
    g.stamp((l) => l.rect(10, 0, 3, 3, "#8A5A34").px(10, 0, "#B07A4A"), "#1E120A");
  }),

  it("minicarousel", "Mini Carousel", "furniture", ["stand"], "any", 1100, 32, 38, "The Catcher in the Rye", (g, f) => {
    g.shadow(16, 14, 37);
    const horse = (l, x, y, dir, back) => {
      map(l, ["....#.", "....##", "#####.", "#s###.", ".#..#."], back ? { "#": "#C9C2B2", s: "#8A2A3A" } : { "#": "#FFFFFF", s: "#E0393E" }, x - 3, y - 4, dir < 0);
    };
    const hs = [0, 1, 2, 3].map((i) => { const a = f * 0.06 + (i * TAU) / 4; return { i, x: Math.round(16 + Math.cos(a) * 10), d: Math.sin(a), dir: -Math.sin(a) > 0 ? 1 : -1, y: 23 + Math.round(Math.sin(f * 0.25 + i * 1.7) * 1.5) }; });
    g.stamp((l) => {
      l.ell(16, 30, 14, 3, (nx, ny) => (ny < 0 ? "#B07A4A" : "#8A5A34"));
      l.rect(2, 30, 28, 4, "#E0393E").rect(2, 30, 28, 1, "#FFD23F");
    }, "#2A160A");
    for (let x = 4; x < 29; x += 4) g.px(x, 32, (f >> 2) % 2 === (x >> 2) % 2 ? "#FFF3A6" : "#B08A2A");
    for (const h of hs.filter((h) => h.d < 0)) { g.line(h.x, 12, h.x, 29, "#B08A2A"); g.stamp((l) => horse(l, h.x, h.y, h.dir, true), "#3A2A1E"); }
    g.stamp((l) => l.rect(15, 12, 2, 18, "#D9A441").rect(15, 12, 1, 18, "#FFE36B"), "#4A3100");
    for (const h of hs.filter((h) => h.d >= 0)) { g.line(h.x, 12, h.x, 29, "#D9A441"); g.stamp((l) => horse(l, h.x, h.y, h.dir, false), "#3A2A1E"); }
    g.stamp((l) => {
      for (let y = 3; y < 11; y++) {
        const hw = 1 + (y - 3) * 1.9;
        for (let x = Math.round(16 - hw); x <= Math.round(15 + hw); x++) l.px(x, y, Math.floor((x - 15.5) / (0.8 + (y - 3) * 0.5) + f * 0.12 + 40) % 2 ? "#E0393E" : "#FFF6DF");
      }
      for (let x = 2; x < 30; x++) l.px(x, 11, "#FFD23F").px(x, 12, x % 3 === 1 ? null : "#E0393E");
      l.rect(15, 0, 1, 3, "#8A5A34"); l.px(16, 0, "#2F80E6").px(17, 0, "#2F80E6").px(16, 1, "#2F80E6").px(17 + (f % 12 < 6 ? 1 : 0), 1, "#2F80E6");
    }, "#4A0E14");
    for (let x = 4; x < 29; x += 3) g.px(x, 11, (f >> 3) % 2 === x % 2 ? "#FFFFFF" : "#FFD23F");
  }, { glow: [[16, 20, 24, "#FFE9A0"]] }),

  it("glassslipper", "The Glass Slipper", "furniture", ["top"], "bedroom", 900, 18, 14, "Cinderella", (g, f) => {
    g.stamp((l) => { l.ell(9, 11, 8.3, 2.8, (nx, ny) => (ny < -0.2 ? "#5A6AE0" : nx > 0.4 ? "#28308A" : "#3A4ABF")); l.px(0, 12, "#FFD23F").px(17, 12, "#FFD23F"); }, "#101A4A");
    g.stamp((l) => map(l, SHOE_HIGH, { h: "#FFFFFF", "#": "#CFF0FF", i: "#6FA8CC", d: "#5AA0D0" }, 3, 1, true), "#2E5A7A");
    g.px(12, 4, "#FFFFFF").px(5, 6, "#FFFFFF");
    const t = f % 60;
    if (t < 6) star(g, 4, 6, t < 3 ? 1 : 0, "#FFFFFF");
    if (t >= 20 && t < 26) g.px(14 - (t - 20), 2 + (t - 20), "#FFFFFF");
  }, { glow: [[9, 7, 12, "#CFEFFF"]] }),

  it("madeleines", "Proust's Madeleines", "furniture", ["top"], "kitchen", 250, 24, 14, "In Search of Lost Time", (g, f) => {
    g.stamp((l) => l.ell(9, 11.5, 8.5, 2.4, (nx, ny) => (nx * nx + ny * ny > 0.55 ? "#DDE3EC" : "#FFFFFF")), "#4A4A58");
    // Scallop-shell sponge cakes: ribbed on top, a golden hump.
    const cake = (cx, cy) => g.stamp((l) => map(l, [
      "..hhhh..",
      ".h#r#rh.",
      "h#r#r#r#",
      ".dr#r#d.",
      "..dddd..",
    ], { h: "#F6D49A", "#": "#E8B86B", r: "#C88A45", d: "#B07A3A" }, cx - 4, cy - 2), "#5A3210");
    cake(5, 10); cake(12, 10); cake(9, 7);
    g.px(15, 12, "#E8B86B").px(3, 13, "#E8B86B");
    g.stamp((l) => {
      l.ell(20, 12.3, 4, 1.3, "#F4F1E8");
      l.ell(20, 8, 3.3, 3.6, (nx, ny) => (ny < -0.1 ? null : nx < -0.3 ? "#FFFFFF" : "#E6E9EE"));
      l.rect(17, 7, 7, 2, "#FFFFFF").rect(17, 9, 7, 1, "#5A86E0").rect(18, 7, 5, 1, "#B0703A");
      l.ring(23.6, 9, 1.4, "#E6E9EE", (t) => t > 0.3 && t < 0.7);
    }, "#4A4A58");
    for (let k = 0; k < 2; k++) { const t = ((f + k * 9) % 18) / 18; if (t < 0.8) g.px(19 + k * 2 + Math.round(Math.sin((f + k * 6) * 0.5)), Math.round(5 - t * 5), "#FFFFFFaa"); }
  }),

  it("silkshirts", "Gatsby's Silk Shirts", "furniture", ["stand"], "bedroom", 600, 32, 32, "The Great Gatsby", (g, f) => {
    const cols = [["#FF7A6A", "#FFB0A4", "#C8504A"], ["#8FD06A", "#C4F0A4", "#5A9A3E"], ["#B8A0E8", "#DCCCFF", "#8A70C0"], ["#FFB36B", "#FFD8A8", "#D08A40"], ["#9FD8FF", "#D6F0FF", "#5A9ACB"]];
    const t = f % 84, fly = t < 44, cyc = Math.floor(f / 84);
    g.shadow(16, 14, 31);
    g.stamp((l) => { l.rect(3, 24, 26, 4, "#2FA89A").rect(3, 24, 26, 1, "#7FE0D2").rect(3, 27, 26, 1, "#1F7F71"); l.rect(4, 28, 2, 3, "#5E3A1F").rect(26, 28, 2, 3, "#5E3A1F"); }, "#0C2A26");
    const folded = (l, x, y, c, top) => { l.rect(x, y, 20, 3, c[0]).rect(x, y, 20, 1, c[1]).rect(x, y + 2, 20, 1, c[2]); if (top) l.px(x + 9, y, "#FFFFFF").px(x + 10, y, "#FFFFFF").px(x + 9, y + 1, c[2]).px(x + 10, y + 1, c[2]); };
    const topC = cols[cyc % 5];
    g.stamp((l) => {
      [[6, 21, 1], [5, 18, 2], [7, 15, 3], [5, 12, 4]].forEach(([x, y, k]) => folded(l, x, y, cols[(cyc + k) % 5], false));
      if (!fly) folded(l, 6, 9, topC, true);
    }, "#2A1A2A");
    if (fly) {
      const u = t / 44, x = Math.round(16 + Math.sin(u * TAU * 0.75) * 7), y = Math.round(10 - Math.sin(u * Math.PI) * 9), flap = Math.floor(f / 3) % 2;
      g.stamp((l) => {
        l.rect(x - 3, y - 2, 7, 7, topC[0]).rect(x - 3, y - 2, 7, 1, topC[1]);
        l.rect(x - 6, y - 2 + flap, 3, 2, topC[0]).rect(x + 4, y - 2 + (1 - flap), 3, 2, topC[0]);
        l.px(x - 1, y - 2, "#FFFFFF").px(x + 1, y - 2, "#FFFFFF").px(x, y - 1, topC[2]).rect(x, y, 1, 4, topC[2]);
      }, "#2A1A2A");
    }
    if (f % 30 < 3) star(g, 22, 12, 1, "#FFFFFF");
  }),

  it("penelopeloom", "Penelope's Loom", "furniture", ["stand"], "any", 1000, 38, 44, "The Odyssey", (g, f) => {
    const t = f % 216, rows = t < 168 ? 2 + Math.floor((t / 168) * 16) : Math.max(2, 18 - Math.floor(((t - 168) / 48) * 17));
    g.shadow(19, 17, 43);
    g.stamp((l) => {
      l.rect(3, 2, 3, 40, "#8A5A34").rect(3, 2, 1, 40, "#B07A4A").rect(32, 2, 3, 40, "#8A5A34").rect(32, 2, 1, 40, "#B07A4A");
      l.rect(1, 4, 36, 3, "#6B4226").rect(1, 4, 36, 1, "#8E5C36");
      l.rect(1, 41, 9, 2, "#5A3820").rect(28, 41, 9, 2, "#5A3820");
      l.rect(4, 24, 30, 2, "#A06A40").rect(4, 24, 30, 1, "#C88A5A");
    }, "#1E120A");
    for (let x = 7; x < 31; x += 2) g.line(x, 7, x, 34, "#E8DCC4");
    for (let x = 7; x < 31; x += 4) { g.line(x, 34, x + 1, 36, "#C9B894").line(x + 2, 34, x + 1, 36, "#C9B894"); g.stamp((l) => l.ell(x + 1.5, 38.5, 1.5, 2, (nx, ny) => (nx < -0.2 ? "#D07A4A" : "#A0502A")), "#3A1E0A"); }
    g.stamp((l) => {
      for (let j = 0; j < rows; j++) for (let x = 6; x < 32; x++) {
        const band = j >= 2 && j <= 5, key = band && ((j === 2 || j === 5) || ((x + (j - 3) * 2) % 6 < 2 && j > 2 && j < 5) || (x % 6 === 0));
        l.px(x, 7 + j, key ? "#FFD23F" : band ? "#8E4AA8" : j % 2 ? "#6A3A8E" : "#74429A");
      }
    }, "#1E0E24");
    const wy = 7 + rows;
    if (t < 168) { const sx = Math.round(18 + Math.sin(f * 0.25) * 11); g.stamp((l) => l.rect(sx - 2, wy, 5, 2, "#C88A45").rect(sx - 2, wy, 5, 1, "#E8B878"), "#3A1E0A"); }
    else { for (let k = 0; k < 8; k++) g.px(12 + k * 2, wy + 1 + Math.round(Math.sin(k + f * 0.4)), "#8E4AA8"); g.px(33, 1, "#FFF3C2").px(34, 1, "#FFF3C2").px(34, 0, "#FFF3C2"); }
  }),

  it("secretrose", "Secret Garden Rose Bush", "furniture", ["stand"], "greenhouse", 600, 34, 34, "The Secret Garden", (g, f) => {
    g.shadow(17, 14, 33);
    g.stamp((l) => { l.rect(4, 26, 26, 6, "#9A9CA3").rect(4, 26, 26, 1, "#B8BAC0").rect(4, 31, 26, 1, "#6E7078"); for (const x of [6, 11, 19, 26]) l.px(x, 27, "#6FA35E").px(x + 1, 27, "#5F9A4E"); l.rect(5, 25, 24, 1, "#5A3A22"); }, "#3A3C42");
    g.stamp((l) => {
      for (const [x, y, rx, ry] of [[10, 20, 6, 5], [23, 19, 6, 5], [16, 14, 7, 6], [8, 13, 4, 4], [26, 12, 4, 4], [17, 22, 8, 4]]) l.ell(x, y, rx, ry, (nx, ny, px, py) => ((px + py * 2) % 5 === 0 ? "#7FCB6A" : nx + ny < -0.5 ? "#4FBF5A" : nx + ny > 0.5 ? "#2E7A38" : "#3FA35E"));
    }, "#123A1E");
    const roses = [[9, 17], [16, 11], [23, 15], [12, 22], [21, 22], [27, 19], [7, 11]];
    g.stamp((l) => roses.forEach(([x, y]) => { l.ell(x, y, 1.9, 1.9, (nx, ny) => (nx + ny < -0.5 ? "#FF6070" : "#D8102A")); l.px(Math.floor(x), Math.floor(y), "#8A0010"); }), "#3A0008");
    const pt = f % 96;
    if (pt < 24) g.px(24 + Math.round(Math.sin(pt * 0.4)), 17 + Math.round(pt / 2.5), "#E0102A");
    // A robin hops between two perches on top.
    const tt = f % 96, A = [11, 9], B = [22, 8];
    let rx, ry, dir;
    if (tt < 40) { rx = A[0]; ry = A[1] - (tt % 20 < 2 ? 0 : 0); dir = 1; }
    else if (tt < 48) { const u = (tt - 40) / 8; rx = A[0] + (B[0] - A[0]) * u; ry = A[1] + (B[1] - A[1]) * u - Math.sin(u * Math.PI) * 5; dir = 1; }
    else if (tt < 88) { rx = B[0]; ry = B[1]; dir = -1; }
    else { const u = (tt - 88) / 8; rx = B[0] + (A[0] - B[0]) * u; ry = B[1] + (A[1] - B[1]) * u - Math.sin(u * Math.PI) * 5; dir = -1; }
    const peck = (tt > 20 && tt < 26) || (tt > 60 && tt < 66) ? 1 : 0;
    g.stamp((l) => map(l, [
      "..bb..",
      ".bbeb>",
      "bbooo.",
      ".bbo..",
      "..l.l.",
    ], { b: "#8A5A34", e: "#1A1A22", o: "#FF6A2A", ">": "#E0A800", l: "#5A3A22" }, Math.round(rx) - 3, Math.round(ry) - 4 + peck, dir < 0), "#2A160A");
  }),

  it("blueengine", "The Little Blue Engine", "furniture", ["stand"], "bedroom", 800, 50, 26, "The Little Engine That Could", (g, f) => {
    const x = TRAIN[f % TRAIN.length];
    g.shadow(25, 23, 25);
    // Hill and tunnels.
    g.stamp((l) => { for (let i = 5; i < 45; i++) { const y = railY(i); for (let yy = y + 2; yy < 25; yy++) l.px(i, yy, yy === y + 2 ? "#7FCB6A" : yy > 22 ? "#3E8A3E" : "#5FB84A"); } }, "#1E4A22");
    for (let i = 0; i < 50; i++) { const y = railY(i); g.px(i, y, "#5A606E"); if (i % 3 === 0) g.px(i, y + 1, "#8A5A34"); }
    const engine = (ex) => {
      const y = railY(ex - 5);
      g.stamp((l) => {
        l.rect(ex - 22, y - 6, 9, 5, "#FFD23F").rect(ex - 22, y - 6, 9, 1, "#FFF3A6");
        l.rect(ex - 21, y - 8, 2, 2, "#E0393E").rect(ex - 18, y - 9, 2, 3, "#8E5CFF").px(ex - 15, y - 7, "#1FBF6A").px(ex - 14, y - 7, "#1FBF6A");
        l.rect(ex - 12, y - 3, 2, 1, "#5A606E");
        l.rect(ex - 9, y - 7, 8, 5, "#2F80E6").rect(ex - 9, y - 7, 8, 1, "#7FB8FF");
        l.rect(ex - 11, y - 10, 4, 8, "#2F6AC8").rect(ex - 11, y - 10, 4, 1, "#5A9AF0").rect(ex - 10, y - 8, 2, 2, "#FFF6DF");
        l.rect(ex - 12, y - 11, 6, 1, "#1B3A7A");
        l.rect(ex - 4, y - 10, 2, 3, "#1B1B22");
        l.px(ex, y - 5, "#FFD23F").px(ex, y - 2, "#E0393E");
      }, "#0A1E3A");
      for (const [wx, c] of [[-20, "#E0393E"], [-15, "#E0393E"], [-9, "#E0393E"], [-5, "#E0393E"], [-2, "#E0393E"]]) g.stamp((l) => l.ell(ex + wx + 0.5, y - 1, 1.5, 1.5, c).px(ex + wx, y - 1, "#FFD23F"), "#1A1A22");
      for (let k = 0; k < 3; k++) { const tt = ((f + k * 6) % 18) / 18; if (tt < 0.9) g.ell(ex - 3 - tt * 8 - k, y - 12 - tt * 5, 1 + tt * 1.2, 1 + tt, "#FFFFFFbb"); }
    };
    engine(x);
    // Tunnel mouths in front.
    for (const tx of [0, 42]) g.stamp((l) => {
      for (let y = 10; y < 24; y++) for (let x = tx; x < tx + 8; x++) {
        const row = (y - 10) >> 1, mortar = (y - 10) % 2 === 1 || (x + (row % 2) * 2) % 4 === 0;
        l.px(x, y, mortar ? "#7E8088" : (x + y) % 5 ? "#A8AAB0" : "#B8BAC0");
      }
      l.ell(tx + 4, 16, 2.6, 3, "#1A1A22"); l.rect(tx + 2, 16, 5, 8, "#1A1A22");
      l.rect(tx, 9, 8, 2, "#5FB84A").rect(tx, 9, 8, 1, "#7FCB6A");
    }, "#2A2C32");
  }),

  it("pearlnecklace", "Pearl Necklace on a Stand", "furniture", ["top"], "bedroom", 1000, 18, 22, "The Great Gatsby", (g, f) => {
    // A velvet jewellery bust: short neck, round shoulders, on a little wooden foot.
    g.stamp((l) => {
      l.rect(5, 20, 8, 2, "#6B4226").rect(5, 20, 8, 1, "#8E5C36").rect(8, 17, 2, 3, "#6B4226");
      l.ell(9, 17, 8.5, 9, (nx, ny) => (ny > -0.02 ? null : nx < -0.45 ? "#7A6A9E" : nx > 0.5 ? "#3A2E56" : "#54467A"));
      l.rect(6, 4, 6, 5, "#54467A").rect(6, 4, 2, 5, "#7A6A9E").rect(11, 4, 1, 5, "#3A2E56");
      l.ell(9, 4, 3, 1.2, "#7A6A9E");
    }, "#0E0A14");
    const strand = (rx, ry, cy, n) => { const pts = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push([Math.round(9 + Math.cos(a) * rx - 0.5), Math.round(cy + Math.sin(a) * ry)]); } return pts; };
    const pts = [...strand(3.6, 3, 8, 9), ...strand(5.4, 5.2, 8, 13)];
    const gl = Math.floor(f / 3) % 34;
    pts.forEach(([x, y], i) => g.px(x, y, i === gl ? "#FFFFFF" : i % 2 ? "#FFFFFF" : "#DCD6EC"));
    g.stamp((l) => l.ell(9, 14.5, 1.3, 1.5, (nx, ny) => (nx + ny < -0.3 ? "#FFFFFF" : "#DCD6EC")), "#2A2238");
    if (f % 60 < 4) star(g, 6, 11, f % 60 < 2 ? 1 : 0, "#FFFFFF");
  }),

  it("redwheelbarrow", "The Red Wheelbarrow", "furniture", ["stand"], "greenhouse", 700, 46, 28, "The Red Wheelbarrow", (g, f) => {
    g.shadow(22, 20, 27);
    g.ell(17, 25.5, 11, 1.6, "#9FD8FF88");
    g.stamp((l) => {
      l.line(7, 12, 0, 16, "#8A5A34").line(7, 13, 0, 17, "#6B4226");
      l.rect(9, 17, 2, 7, "#6B4226").line(22, 16, 27, 20, "#6B4226");
      for (let y = 11; y < 18; y++) { const x0 = Math.round(6 + (y - 11) * 0.8), x1 = Math.round(27 - (y - 11) * 0.6); l.rect(x0, y, x1 - x0, 1, y === 11 ? "#FF6A6A" : y === 17 ? "#9A1428" : "#D8283A"); }
      for (const [x, y] of [[10, 13], [11, 14], [17, 12], [18, 13], [23, 14]]) l.px(x, y, "#FFB0B8");
      l.ell(27.5, 21, 4, 4, (nx, ny) => (nx * nx + ny * ny < 0.2 ? "#C9D1DB" : "#3A3F4B"));
    }, "#2A0408");
    const hen = (x0, dir, off) => {
      const tt = (f + off) % 48, peck = tt > 30 && tt < 40 ? 2 : 0;
      g.stamp((l) => {
        map(l, [
          "....w.",
          "..wwww",
          "wwwwww",
          ".wwwww",
          "..ss..",
        ], { w: "#FFFFFF", s: "#DDE3EC" }, x0, 19, dir < 0);
        const hx = dir > 0 ? x0 - 2 : x0 + 5;
        map(l, [".r.", "ww.", "yew"], { r: "#E0393E", w: "#FFFFFF", y: "#FFB400", e: "#1A1A22" }, hx, 17 + peck, dir < 0);
        l.px(x0 + 2, 24, "#FFB400").px(x0 + 4, 24, "#FFB400");
      }, "#4A4A58");
    };
    hen(35, 1, 0); hen(40, -1, 22);
    for (let i = 0; i < 10; i++) {
      const tt = ((f * 1.3 + i * 17) % 30) / 30, x = Math.round(rnd(i * 3.7) * 48 - tt * 4), y = Math.round(tt * 28) - 2;
      if (y < 25) g.px(x, y, "#7FB8E8cc").px(x, y + 1, "#7FB8E888"); else g.px(x - 1, 25, "#BFE0FF").px(x + 1, 25, "#BFE0FF");
    }
  }),

  it("paintedroses", "The Painted Roses", "furniture", ["stand"], "greenhouse", 800, 36, 34, "Alice's Adventures in Wonderland", (g, f) => {
    const t = f % 168, k = Math.floor(t / 24), p = (t % 24) / 24;
    g.shadow(18, 16, 33);
    g.stamp((l) => { l.rect(2, 27, 22, 5, "#8A5A34").rect(2, 27, 22, 1, "#B07A4A").rect(2, 31, 22, 1, "#5E3A1F"); }, "#1E120A");
    g.stamp((l) => {
      for (const [x, y, rx, ry] of [[8, 21, 6, 5], [18, 20, 6, 5], [13, 14, 7, 6], [6, 13, 4, 4], [20, 12, 4, 4]]) l.ell(x, y, rx, ry, (nx, ny, px, py) => ((px + py * 2) % 5 === 0 ? "#7FCB6A" : nx + ny < -0.5 ? "#4FBF5A" : nx + ny > 0.5 ? "#2E7A38" : "#3FA35E"));
    }, "#123A1E");
    const roses = [[6, 12], [12, 10], [19, 12], [8, 18], [15, 17], [21, 21]];
    g.stamp((l) => roses.forEach(([x, y], i) => l.ell(x, y, 2.1, 2.1, (nx, ny, px) => {
      const red = t >= 144 ? true : i < k || (i === k && px < x - 2 + p * 5);
      return red ? (nx + ny < -0.5 ? "#FF6070" : nx * nx + ny * ny < 0.15 ? "#8A0010" : "#D8102A") : (nx + ny < -0.5 ? "#FFFFFF" : nx * nx + ny * ny < 0.15 ? "#C9D1DB" : "#F4F1E8");
    })), "#3A2A2A");
    roses.forEach(([x, y], i) => { if (i < k && (t - i * 24) < 60 && t < 144) g.px(x, y + 3 + Math.floor((t - i * 24 - 24) / 12), "#D8102A"); });
    g.stamp((l) => { l.rect(27, 26, 7, 6, "#8C97A6").rect(27, 26, 1, 6, "#C9D1DB").rect(27, 31, 7, 1, "#5A606E"); l.ell(30.5, 26, 3.5, 1, "#C8102A"); l.px(33, 27, "#D8102A").px(33, 28, "#D8102A"); l.ring(30.5, 25, 3.2, "#5A606E", (u) => u < 0.5); }, "#1A1A22");
    // The brush: dabbing at the next white rose, or back in the bucket.
    const [bx, by] = t >= 144 ? [30, 24] : [roses[Math.min(k, 5)][0] + 2 + Math.round(p * 2), roses[Math.min(k, 5)][1] - 1 + (f % 4 < 2 ? 0 : 1)];
    g.stamp((l) => { l.line(bx + 1, by - 1, bx + 5, by - 5, "#C88A45"); l.px(bx + 1, by - 1, "#C9D1DB"); l.px(bx, by, "#D8102A").px(bx - 1, by + 1, "#D8102A"); }, "#2A160A");
  })
];

// The toy engine's run: slower uphill, quicker down, tunnel to tunnel.
function railY(x) { const u = Math.max(-1, Math.min(1, (x - 25) / 14)); return 21 - Math.round(6 * (Math.cos(u * Math.PI) * 0.5 + 0.5)); }
const TRAIN = (() => {
  const xs = []; const h = (x) => 6 * (Math.cos(Math.max(-1, Math.min(1, (x - 25) / 14)) * Math.PI) * 0.5 + 0.5);
  for (let x = -2; x < 74;) { xs.push(Math.round(x)); const s = h(x + 1 - 5) - h(x - 1 - 5); x += 0.55 * (s > 0 ? 1 - Math.min(0.7, s * 0.9) : 1 + Math.min(0.6, -s * 0.5)); }
  return xs;
})();
