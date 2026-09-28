/* Pip engine: a 32x32 pixel rig. Plain JS, no dependencies, so it ports
 straight into apps/src/pip later. Everything is drawn procedurally per frame,
 and every part is "stamped": drawn to its own layer, given a 1px outline, then
 composited. That per-part outline is what keeps a 32px sprite legible on both
 the parchment and the leather surfaces of the app. */
const N = 32;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- colour
const cache = new Map();
function rgba(c) {
  let v = cache.get(c);
  if (v) return v;
  const h = c.replace("#", "");
  const n = parseInt(h.slice(0, 6), 16);
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255];
  cache.set(c, v);
  return v;
}
function lum(c) {
  const [r, g, b] = rgba(c).map((x) => {
    x /= 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ---------------------------------------------------------------- layer
class Layer {
  constructor() { this.d = new Array(N * N).fill(null); }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (!c || x < 0 || y < 0 || x >= N || y >= N) return;
    this.d[y * N + x] = c;
  }
  get(x, y) { return x < 0 || y < 0 || x >= N || y >= N ? null : this.d[y * N + x]; }
  solid(x, y) { const c = this.get(x, y); return c !== null && (c.length < 9 || c.slice(7) === "ff"); }
  blit(src) { for (let i = 0; i < N * N; i++) if (src.d[i]) this.d[i] = src.d[i]; }
}

function outline(dst, src, col) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (src.get(x, y)) continue;
    if (src.get(x - 1, y) || src.get(x + 1, y) || src.get(x, y - 1) || src.get(x, y + 1)) dst.set(x, y, col);
  }
}

// ---------------------------------------------------------------- font 3x5
const ROWS = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."], C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."], E: ["###", "#..", "##.", "#..", "###"], F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"], H: ["#.#", "#.#", "###", "#.#", "#.#"], I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."], K: ["#.#", "#.#", "##.", "#.#", "#.#"], L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"], N: ["##.", "#.#", "#.#", "#.#", "#.#"], O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."], R: ["##.", "#.#", "##.", "#.#", "#.#"], S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."], U: ["#.#", "#.#", "#.#", "#.#", "###"], V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"], X: ["#.#", "#.#", ".#.", "#.#", "#.#"], Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"], 0: ["###", "#.#", "#.#", "#.#", "###"], 1: [".#.", "##.", ".#.", ".#.", "###"],
  2: ["##.", "..#", ".#.", "#..", "###"], 3: ["##.", "..#", ".#.", "..#", "##."], 4: ["#.#", "#.#", "###", "..#", "..#"],
  5: ["###", "#..", "##.", "..#", "##."], 6: [".##", "#..", "###", "#.#", "###"], 7: ["###", "..#", ".#.", ".#.", ".#."],
  8: ["###", "#.#", "###", "#.#", "###"], 9: ["###", "#.#", "###", "..#", "##."], "+": ["...", ".#.", "###", ".#.", "..."],
  "!": [".#.", ".#.", ".#.", "...", ".#."], "?": ["##.", "..#", ".#.", "...", ".#."], "-": ["...", "...", "###", "...", "..."],
  ".": ["...", "...", "...", "...", ".#."], " ": ["...", "...", "...", "...", "..."]
};
const FONT = {};
for (const k in ROWS) FONT[k] = ROWS[k].join("");

// ---------------------------------------------------------------- drawing api
class G {
  constructor(layer, S, f) { this.L = layer; this.S = S; this.f = f || 0; }
  px(x, y, c) { this.L.set(x, y, c); return this; }
  rect(x, y, w, h, c) {
    x = Math.round(x); y = Math.round(y);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.L.set(x + i, y + j, c);
    return this;
  }
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (let i = 0; i < 80; i++) {
      this.L.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
    return this;
  }
  ell(cx, cy, rx, ry, c) {
    const x0 = Math.floor(cx - rx - 1), x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1), y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) {
        const col = typeof c === "function" ? c(nx, ny, x, y) : c;
        if (col) this.L.set(x, y, col);
      }
    }
    return this;
  }
  ring(cx, cy, r, c, skip) {
    const steps = Math.max(12, Math.round(r * 8));
    for (let i = 0; i < steps; i++) {
      if (skip && skip(i / steps)) continue;
      const a = (i / steps) * TAU;
      this.L.set(Math.floor(cx + Math.cos(a) * r), Math.floor(cy + Math.sin(a) * r), c);
    }
    return this;
  }
  /** Draw with fn on a scratch layer, outline it, then composite. */
  stamp(fn, col) {
    const t = new Layer();
    fn(new G(t, this.S, this.f));
    outline(this.L, t, col || this.S.outline);
    this.L.blit(t);
    return this;
  }
  /** Draw with fn, then copy through a transform (rotate/flip/tint/slice). */
  xform(fn, o) {
    const t = new Layer();
    fn(new G(t, this.S, this.f));
    const cx = o.cx ?? 16, cy = o.cy ?? 20, rot = o.rot || 0;
    const cs = Math.cos(-rot), sn = Math.sin(-rot);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let sx = x + 0.5 - (o.dx || 0), sy = y + 0.5 - (o.dy || 0);
      if (o.slice) sx -= o.slice(y);
      if (o.flip) sx = 2 * cx - sx;
      if (rot) {
        const rx = sx - cx, ry = sy - cy;
        sx = cx + rx * cs - ry * sn;
        sy = cy + rx * sn + ry * cs;
      }
      const c = t.get(Math.floor(sx), Math.floor(sy));
      if (c) this.L.set(x, y, o.tint ? o.tint(c) : c);
    }
    return this;
  }
  /** Text keeps a fixed dark outline: a skin's outline can be light (Midnight Ink). */
  text(str, x, y, c, scale) {
    const s = scale || 1;
    this.stamp((l) => {
      let cx = Math.round(x);
      for (const ch of String(str).toUpperCase()) {
        const gph = FONT[ch] || FONT[" "];
        for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) {
          if (gph[j * 3 + i] === "#") l.rect(cx + i * s, Math.round(y) + j * s, s, s, c);
        }
        cx += 4 * s;
      }
    }, "#1A1A22");
    return this;
  }
  textWidth(str, scale) { return String(str).length * 4 * (scale || 1) - (scale || 1); }
  shadow(x, w, y) {
    w = w == null ? 6 : w;
    const yy = y == null ? 31 : y;
    for (let i = -Math.round(w); i < Math.round(w); i++) {
      const edge = Math.abs(i + 0.5) > w - 1.5;
      this.L.set(x + i, yy, edge ? "#00000022" : "#00000040");
    }
    return this;
  }
}

// ---------------------------------------------------------------- rig
const DEF = {
  x: 16, y: 28, w: 8, h: 7, sq: 0, lean: 0, look: [0, 0], fdx: 0, fdy: 0,
  eyes: "open", mouth: "smile", brows: null, blush: true,
  leaf: "leaf", la: 28, ll: 1, lphase: 0,
  hands: null, feet: null, hold: null, behind: null, over: null, acc: true, colors: null, eyePhase: 0
};

function anchors(p) {
  const rx = p.w * (1 + p.sq), ry = p.h * (1 - p.sq);
  const bottom = p.y, cx = p.x, cy = bottom - ry;
  const sh = (py) => p.lean * Math.min(1, Math.max(0, (bottom - py) / (2 * ry)));
  return {
    cx, cy, rx, ry, bottom, sh,
    top: { x: cx + sh(cy - ry), y: cy - ry },
    fc: Math.round(cx + p.fdx + sh(cy)),
    ey: Math.round(cy - 1 + p.fdy),
    handL: [cx - rx - 0.4 + sh(cy + 2), cy + 2],
    handR: [cx + rx + 0.4 + sh(cy + 2), cy + 2]
  };
}

function bodyColor(S, nx, ny) {
  const hx = nx + 0.42, hy = ny + 0.52;
  if (hx * hx + hy * hy < 0.05) return S.hi;
  const d = nx * 0.55 + ny * 0.85;
  if (d > 0.64) return S.shade;
  if (d < -0.5) return S.light;
  if (S.belly && Math.abs(nx) < 0.52 && ny > 0.3 && (nx * nx) / 0.27 + ((ny - 0.85) * (ny - 0.85)) / 0.25 < 1) return S.belly;
  return S.base;
}

function drawLeaf(g, p, A) {
  const S = g.S;
  let mode = p.leaf;
  if (mode === "leaf" && S.leafMode) mode = S.leafMode;
  if (mode === "none") return;
  const a = (p.la * Math.PI) / 180;
  const bx = A.top.x, by = A.top.y + 1.2;
  const stemLen = mode === "wilt" ? 2 : 2.6;
  const sd = [Math.sin(a * 0.35), -Math.cos(a * 0.35)];
  const tx = bx + sd[0] * stemLen, ty = by + sd[1] * stemLen;
  const leafC = p.leafColor || S.leaf, leafSh = p.leafShade || S.leafShade;
  g.stamp((l) => l.line(bx, by, tx, ty, S.stem));
  if (mode === "leaf" || mode === "wilt") {
    const L = 3.7 * p.ll, B = 2.0 * p.ll;
    const d = [Math.sin(a), -Math.cos(a)];
    const cxl = tx + d[0] * L * 0.92, cyl = ty + d[1] * L * 0.92;
    g.stamp((l) => {
      for (let y = Math.floor(cyl - L - 2); y <= cyl + L + 2; y++) for (let x = Math.floor(cxl - L - 2); x <= cxl + L + 2; x++) {
        const X = x + 0.5 - cxl, Y = y + 0.5 - cyl;
        const u = X * d[0] + Y * d[1], v = -X * d[1] + Y * d[0];
        const taper = 1 - 0.38 * Math.max(0, u / L);
        if ((u / L) ** 2 + (v / (B * taper)) ** 2 > 1) continue;
        let col = v > B * 0.22 ? leafSh : leafC;
        if (Math.abs(v) < 0.55 && u < L * 0.62) col = S.vein;
        l.px(x, y, col);
      }
    });
  } else if (mode === "spin") {
    const c = Math.cos(p.lphase);
    g.stamp((l) => {
      for (const side of [-1, 1]) {
        const r = Math.max(0.7, 3.4 * Math.abs(c));
        l.ell(tx + side * c * 3.3, ty - 0.6, r, 1.3, side * c > 0 ? leafC : leafSh);
      }
    });
  } else if (mode === "flame") {
    const ph = p.lphase;
    g.stamp((l) => {
      for (let y = -7; y <= 1; y++) for (let x = -3; x <= 3; x++) {
        const t = (-y) / 7; // 0 at base, 1 at tip
        const wob = Math.sin(ph * 2 + y * 0.9) * 0.9 * t;
        const half = 2.6 * Math.sin(Math.PI * Math.min(1, (t + 0.18) / 1.1)) * (1 - t * 0.55);
        if (Math.abs(x - wob) > half) continue;
        const core = Math.abs(x - wob) < half * 0.45;
        const col = t > 0.7 ? "#FFE36B" : core ? (t < 0.35 ? "#FFF3B0" : "#FFC53D") : t < 0.3 ? "#F0492F" : "#FF8A2A";
        l.px(tx + x, ty + y - 0.5, col);
      }
    }, "#3A1409");
  } else if (mode === "bulb") {
    const on = p.bulbOn;
    g.stamp((l) => {
      l.ell(tx, ty - 3.2, 2.7, 2.7, (nx, ny) => (on ? (nx + ny < -0.5 ? "#FFFFFF" : "#FFE55C") : nx + ny < -0.5 ? "#F4F4F4" : "#C9CED6"));
      l.rect(tx - 1, ty - 0.6, 3, 1, "#8A93A0");
    });
  } else if (mode === "flower") {
    g.stamp((l) => {
      const petal = S.petal || "#FF9EC4", core = S.petalCore || "#FFD84D";
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * TAU + p.lphase * 0.2 - Math.PI / 2;
        l.ell(tx + Math.cos(ang) * 2, ty - 3 + Math.sin(ang) * 2, 1.4, 1.4, petal);
      }
      l.ell(tx, ty - 3, 1.1, 1.1, core);
    });
  } else if (mode === "snow") {
    g.stamp((l) => {
      const c = S.vein || "#FFFFFF", cx = Math.round(tx), cy = Math.round(ty - 3.5);
      l.line(cx - 3, cy, cx + 3, cy, c).line(cx, cy - 3, cx, cy + 3, c);
      l.line(cx - 2, cy - 2, cx + 2, cy + 2, c).line(cx - 2, cy + 2, cx + 2, cy - 2, c);
    }, S.outline);
  }
}

function eye(g, kind, x0, Y, side, ph) {
  const S = g.S, ink = S.ink;
  switch (kind) {
    case "open": case "sad": case "angry": case "teary":
      g.rect(x0, Y - 2, 2, 4, ink).px(x0 + (side < 0 ? 0 : 0), Y - 2, S.eyeHi);
      if (kind === "angry") g.L.set(side < 0 ? x0 + 1 : x0, Y - 2, S.base);
      if (kind === "teary") g.px(x0 + (side < 0 ? 0 : 1), Y + 2, "#7CC8FF");
      break;
    case "glow":
      g.rect(x0, Y - 2, 2, 4, S.glow || "#FFE066").px(x0, Y - 2, "#FFFFFF");
      break;
    case "dot":
      g.rect(x0, Y - 1, 2, 2, ink);
      break;
    case "blink":
      g.rect(x0, Y, 2, 1, ink);
      break;
    case "half":
      g.rect(x0, Y - 1, 2, 3, ink).rect(x0 - 1, Y - 2, 4, 1, ink);
      break;
    case "determined":
      g.rect(x0, Y - 1, 2, 3, ink).px(x0, Y - 1, S.eyeHi);
      break;
    case "happy":
      g.px(x0 - 1, Y, ink).px(x0, Y - 1, ink).px(x0 + 1, Y - 1, ink).px(x0 + 2, Y, ink);
      break;
    case "closed":
      g.px(x0 - 1, Y, ink).px(x0, Y + 1, ink).px(x0 + 1, Y + 1, ink).px(x0 + 2, Y, ink);
      break;
    case "squeeze":
      if (side < 0) g.px(x0, Y - 2, ink).px(x0 + 1, Y - 1, ink).px(x0, Y, ink);
      else g.px(x0 + 1, Y - 2, ink).px(x0, Y - 1, ink).px(x0 + 1, Y, ink);
      break;
    case "wide":
      g.stamp((l) => l.ell(x0 + 1, Y - 0.5, 2.3, 2.7, "#FFFFFF"), ink);
      g.px(x0 + (side < 0 ? 1 : 0), Y - 1, ink);
      break;
    case "star": {
      const cx = x0 + (side < 0 ? 0 : 1), cy = Y - 1;
      g.stamp((l) => {
        l.px(cx, cy - 2, "#FFD23F").px(cx, cy + 2, "#FFD23F").px(cx - 2, cy, "#FFD23F").px(cx + 2, cy, "#FFD23F");
        l.rect(cx - 1, cy - 1, 3, 3, "#FFD23F").px(cx, cy, "#FFFFFF");
      }, ink);
      break;
    }
    case "heart": case "heartBig": {
      const big = kind === "heartBig";
      const hx = x0 - 1, hy = Y - 2;
      g.stamp((l) => {
        const rows = big ? [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."] : [".#.#.", "#####", ".###.", "..#.."];
        const off = big ? -1 : 0;
        rows.forEach((r, j) => [...r].forEach((ch, i) => ch === "#" && l.px(hx + i + off, hy + j + off, "#FF4D6D")));
        l.px(hx + off + 1, hy + off + 1, "#FFB3C1");
      }, ink);
      break;
    }
    case "x":
      g.px(x0 - 1, Y - 2, ink).px(x0 + 2, Y - 2, ink).px(x0, Y - 1, ink).px(x0 + 1, Y - 1, ink).px(x0, Y, ink).px(x0 + 1, Y, ink).px(x0 - 1, Y + 1, ink).px(x0 + 2, Y + 1, ink);
      break;
    case "spiral": {
      const ring = [[0, -2], [1, -2], [2, -1], [2, 0], [1, 1], [0, 1], [-1, 0], [-1, -1]];
      const skip = Math.floor(ph || 0) % ring.length;
      ring.forEach(([dx, dy], i) => i !== skip && g.px(x0 + dx, Y + dy, ink));
      g.px(x0 + (side < 0 ? 1 : 0), Y - 1, ink);
      break;
    }
    case "robot":
      g.stamp((l) => l.rect(x0 - 1, Y - 1, 3, 2, "#7FE7FF").px(x0 - 1, Y - 1, "#FFFFFF"), ink);
      break;
    case "shades": case "none":
      break;
    default:
      g.rect(x0, Y - 2, 2, 4, ink);
  }
}

function mouth(g, kind, c, my) {
  const S = g.S, ink = S.ink, tg = S.tongue;
  switch (kind) {
    case "smile": g.px(c - 2, my, ink).px(c - 1, my + 1, ink).px(c, my + 1, ink).px(c + 1, my, ink); break;
    case "flat": g.rect(c - 1, my + 1, 2, 1, ink); break;
    case "o": g.rect(c - 1, my, 2, 2, ink); break;
    case "tiny": g.px(c, my + 1, ink); break;
    case "open": g.rect(c - 2, my, 4, 2, ink).px(c - 1, my + 1, tg).px(c, my + 1, tg); break;
    case "shout": g.rect(c - 2, my - 1, 4, 4, ink).rect(c - 1, my + 1, 2, 2, tg).rect(c - 2, my - 1, 4, 1, "#FFFFFF"); break;
    case "frown": g.px(c - 2, my + 1, ink).px(c - 1, my, ink).px(c, my, ink).px(c + 1, my + 1, ink); break;
    case "wavy": g.px(c - 3, my + 1, ink).px(c - 2, my, ink).px(c - 1, my + 1, ink).px(c, my, ink).px(c + 1, my + 1, ink).px(c + 2, my, ink); break;
    case "cat": g.px(c - 3, my, ink).px(c - 2, my + 1, ink).px(c - 1, my, ink).px(c, my, ink).px(c + 1, my + 1, ink).px(c + 2, my, ink); break;
    case "grit": g.stamp((l) => l.rect(c - 2, my, 4, 2, "#FFFFFF").px(c - 1, my, "#DDE3E8"), ink); break;
    case "blep": g.px(c - 2, my, ink).px(c - 1, my + 1, ink).px(c, my + 1, ink).px(c + 1, my, ink).px(c, my + 2, tg).px(c - 1, my + 2, tg); break;
    case "smirk": g.px(c - 1, my + 1, ink).px(c, my + 1, ink).px(c + 1, my, ink).px(c + 2, my - 1, ink); break;
    case "grin": g.rect(c - 3, my, 6, 1, ink).rect(c - 2, my + 1, 4, 1, ink).rect(c - 2, my, 4, 1, "#FFFFFF"); break;
    case "whistle": g.rect(c, my, 2, 2, ink); break;
    default: break;
  }
}

function drawFace(g, p, A) {
  const S = g.S, c = A.fc, ey = A.ey;
  const lx = Math.round(p.look[0]), ly = Math.round(p.look[1]);
  const L0 = c - 4 + lx, R0 = c + 2 + lx, Y = ey + ly;
  let el = p.eyes, er = p.eyes;
  if (p.eyes === "wink") { el = "open"; er = "happy"; }
  if (S.eyes && el === "open") el = S.eyes;
  if (S.eyes && er === "open") er = S.eyes;
  if (p.eyes === "shades") {
    g.stamp((l) => l.rect(c - 5, Y - 1, 4, 2, "#1B1F2A").rect(c + 1, Y - 1, 4, 2, "#1B1F2A").rect(c - 1, Y - 1, 2, 1, "#1B1F2A").px(c - 5, Y - 1, "#7F8CB3").px(c + 1, Y - 1, "#7F8CB3"));
  } else {
    eye(g, el, L0, Y, -1, p.eyePhase);
    eye(g, er, R0, Y, 1, p.eyePhase);
  }
  const ink = S.ink;
  if (p.brows === "angry") g.px(c - 5, Y - 4, ink).px(c - 4, Y - 4, ink).px(c - 3, Y - 3, ink).px(c + 4, Y - 4, ink).px(c + 3, Y - 4, ink).px(c + 2, Y - 3, ink);
  if (p.brows === "sad") g.px(c - 5, Y - 3, ink).px(c - 4, Y - 4, ink).px(c - 3, Y - 4, ink).px(c + 4, Y - 3, ink).px(c + 3, Y - 4, ink).px(c + 2, Y - 4, ink);
  if (p.brows === "up") g.rect(c - 5, Y - 5, 3, 1, ink).rect(c + 2, Y - 5, 3, 1, ink);
  if (p.brows === "focus") g.rect(c - 5, Y - 4, 3, 1, ink).rect(c + 2, Y - 4, 3, 1, ink);
  if (p.blush) {
    const by = ey + 2, big = p.blush === "big";
    g.rect(c - 6 - (big ? 1 : 0), by, big ? 3 : 2, 1, S.cheek).rect(c + 4, by, big ? 3 : 2, 1, S.cheek);
  }
  mouth(g, p.mouth, c + (p.mouthDx || 0), ey + 3 + (p.mouthDy || 0));
}

function drawHand(g, h) {
  const S = g.S;
  if (h.k === "glove") {
    g.stamp((l) => {
      l.ell(h.x, h.y, 2.4, 2.4, (nx, ny) => (nx + ny < -0.6 ? "#FF8A8A" : nx + ny > 0.7 ? "#A61E2A" : "#E0393E"));
      l.rect(h.x - 1.5, h.y + 2, 3, 1, "#FFFFFF");
    });
  } else if (h.k === "white") {
    g.stamp((l) => l.ell(h.x, h.y, 1.8, 1.8, (nx, ny) => (nx + ny > 0.6 ? "#D8DEE6" : "#FFFFFF")));
  } else if (h.k === "pom") {
    g.stamp((l) => {
      l.ell(h.x, h.y, 2.8, 2.8, (nx, ny, x, y) => ((x * 7 + y * 3 + g.f) % 5 === 0 ? "#FFF3A6" : (x + y) % 3 === 0 ? "#FF9F1C" : "#FFD23F"));
    });
  } else {
    g.stamp((l) => l.ell(h.x, h.y, h.r || 1.8, h.r || 1.8, (nx, ny) => (nx + ny > 0.5 ? S.shade : nx + ny < -0.7 ? S.light : S.base)));
  }
  if (h.item) h.item(g, h);
}

function drawPip(g, o) {
  const S = g.S;
  const p = Object.assign({}, DEF, o);
  if (p.colors) g.S = S2(S, p.colors);
  const A = anchors(p);
  const feet = p.feet === false ? [] : typeof p.feet === "function" ? p.feet(A) : p.feet || [[A.cx - 3.5, A.bottom + 1.1], [A.cx + 3.5, A.bottom + 1.1]];
  for (const [fx, fy, fw] of feet) g.stamp((l) => l.ell(fx, fy, fw || 2.3, 1.4, (nx, ny) => (ny < -0.2 && nx < 0.2 ? g.S.shade : g.S.foot)));
  if (p.behind) p.behind(g, A);
  drawLeaf(g, p, A);
  g.stamp((l) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const X = x + 0.5 - A.sh(y + 0.5), Y = y + 0.5;
      const nx = (X - A.cx) / A.rx, ny = (Y - A.cy) / A.ry;
      const k = ny < 0 ? 1 + 0.22 * ny * ny : 1;
      if ((nx * k) ** 2 + ny * ny > 1) continue;
      l.px(x, y, bodyColor(g.S, nx, ny));
    }
  });
  if (p.under) p.under(g, A);
  drawFace(g, p, A);
  if (g.S.acc && p.acc !== false) g.S.acc(g, A, p);
  if (p.hold) p.hold(g, A);
  const restHands = [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0], y: A.handR[1] }];
  const hands = p.hands === false ? [] : typeof p.hands === "function" ? p.hands(A) || restHands : p.hands || restHands;
  for (const h of hands) drawHand(g, h);
  if (p.over) p.over(g, A);
  g.S = S;
  return A;
}

function drawLeafOnly(g, o) {
  const p = Object.assign({}, DEF, o);
  const A = anchors(p);
  drawLeaf(g, p, A);
  return A;
}

function S2(S, over) { return Object.assign({}, S, over); }

// ---------------------------------------------------------------- render
function renderFrame(anim, f, S, opts) {
  const L = new Layer();
  const g = new G(L, S, f);
  anim.draw(g, f % anim.loop, S);
  if (opts && opts.rim) {
    const rim = new Layer();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (L.get(x, y)) continue;
      if (L.solid(x - 1, y) || L.solid(x + 1, y) || L.solid(x, y - 1) || L.solid(x, y + 1)) rim.set(x, y, opts.rim);
    }
    L.blit(rim);
  }
  const img = new ImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const c = L.d[i];
    if (!c) continue;
    const [r, gg, b, a] = rgba(c);
    img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
  }
  return img;
}

export { N, TAU, Layer, G, drawPip, drawHand, drawLeafOnly, anchors, renderFrame, rgba, contrast, lum, FONT };
