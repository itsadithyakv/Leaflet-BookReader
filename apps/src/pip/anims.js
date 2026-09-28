/* Pip's animation library. Each entry is a pure function of the frame number,
 so a loop always renders identically and frames can be cached. 12 fps. */
import { drawPip, drawHand, drawLeafOnly } from "./engine.js";

const TAU = Math.PI * 2;

// ------------------------------------------------------------ timing
const wave = (f, per, amp = 1, off = 0) => amp * Math.sin((TAU * f) / per + off);
const tri = (f, per) => { const t = (f % per) / per; return t < 0.5 ? t * 2 : 2 - t * 2; };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const eo = (t) => 1 - (1 - t) * (1 - t);
const ei = (t) => t * t;
const eio = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const back = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const hop = (t, h) => -4 * h * t * (1 - t);
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function tl(f, d) {
  let a = 0;
  for (let i = 0; i < d.length; i++) {
    if (f < a + d[i]) return { k: i, t: (f - a) / d[i], n: f - a };
    a += d[i];
  }
  return { k: d.length - 1, t: 1, n: d[d.length - 1] - 1 };
}
const blink = (f, per = 48, at = per - 3) => f % per >= at && f % per < at + 2;

const GOLD = "#FFD23F", RED = "#E0393E", WHITE = "#FFFFFF", PINK = "#FF4D6D", BLUE = "#2F8FE6", SKY = "#7CC8FF", INKX = "#2A2A33";

// ------------------------------------------------------------ fx
const fx = {
  star(g, x, y, s = 1, c = GOLD) {
    x = Math.round(x); y = Math.round(y);
    g.stamp((l) => {
      if (s <= 0) { l.px(x, y, c); return; }
      if (s === 1) { l.px(x, y - 1, c).px(x, y + 1, c).px(x - 1, y, c).px(x + 1, y, c).px(x, y, WHITE); return; }
      l.px(x, y - 2, c).px(x, y + 2, c).px(x - 2, y, c).px(x + 2, y, c).rect(x - 1, y - 1, 3, 3, c).px(x, y, WHITE);
    }, "#4A3100");
  },
  twinkle(g, x, y, ph, c) { const s = ph < 0.2 ? 0 : ph < 0.45 ? 1 : ph < 0.7 ? 2 : ph < 0.9 ? 1 : -1; if (s >= 0) fx.star(g, x, y, s, c); },
  heart(g, x, y, big, c = PINK) {
    const rows = big ? [".##.##.", "#######", ".#####.", "..###..", "...#..."] : ["#.#", "###", ".#."];
    const o = big ? 3 : 1;
    g.stamp((l) => rows.forEach((r, j) => [...r].forEach((ch, i) => ch === "#" && l.px(Math.round(x) + i - o, Math.round(y) + j, c))), "#4A0E1C");
  },
  drop(g, x, y, c = SKY) {
    x = Math.round(x); y = Math.round(y);
    g.stamp((l) => l.px(x, y, c).rect(x - 1, y + 1, 3, 2, c).px(x - 1, y + 1, WHITE), "#123A5C");
  },
  z(g, x, y, big) {
    if (big) g.text("Z", x, y, WHITE);
    else {
    const zx = Math.round(x), zy = Math.round(y);
    g.stamp((l) => l.rect(zx, zy, 3, 1, WHITE).px(zx + 1, zy + 1, WHITE).px(zx, zy + 2, WHITE).rect(zx, zy + 3, 3, 1, WHITE).px(zx + 2, zy + 1, WHITE), "#23304A");
  }
  },
  note(g, x, y, c = "#8E5CFF") {
    x = Math.round(x); y = Math.round(y);
    g.stamp((l) => l.rect(x + 2, y, 1, 4, c).px(x + 3, y, c).px(x + 3, y + 1, c).rect(x, y + 3, 2, 2, c));
  },
  puff(g, x, y, r = 1.8, c = "#F2EFE8") { g.stamp((l) => l.ell(x, y, r, r * 0.85, (nx, ny) => (nx + ny > 0.45 ? "#C9C4B8" : c)), "#6B6558"); },
  ember(g, x, y, t) { g.stamp((l) => l.px(x, y, t < 0.4 ? "#FFE36B" : t < 0.7 ? "#FF8A2A" : "#F0492F"), "#3A1409"); },
  speed(g, x, y, len, c = "#FFFFFFaa") { for (let i = 0; i < len; i++) g.px(Math.round(x) + i, Math.round(y), c); },
  cloud(g, x, y, w, c = "#A9B1BF") {
    if (w < 1) return;
    g.stamp((l) => { l.ell(x, y + 1, w, 2.2, c); l.ell(x - w * 0.35, y + 0.2, w * 0.45, 2.3, c); l.ell(x + w * 0.2, y - 0.8, w * 0.5, 2.7, (nx, ny) => (ny < -0.4 ? "#C9CFDA" : c)); }, "#3D4452");
  },
  rain(g, x0, x1, y0, y1, f) {
    for (let i = 0; i < 7; i++) {
      const x = Math.round(lerp(x0, x1, rnd(i)));
      const y = Math.round(y0 + ((f * 2 + i * 5) % Math.max(1, y1 - y0)));
      g.px(x, y, BLUE).px(x, y + 1, SKY);
    }
  },
  confetti(g, f, n = 16, top = -2) {
    const cols = ["#FF4D6D", "#3AA0FF", "#FFB400", "#8E5CFF", "#1FBF6A", "#FF7A1A"];
    for (let i = 0; i < n; i++) {
      const x = Math.round(rnd(i) * 33 + Math.sin((f + i * 7) * 0.35) * 1.5) - 1;
      const y = Math.round(top + ((f * (0.7 + rnd(i + 9) * 0.7) + rnd(i + 3) * 40) % 36));
      const c = cols[i % cols.length];
      g.px(x, y, c);
      if ((f + i) % 4 < 2) g.px(x + 1, y, c); else g.px(x, y + 1, c);
    }
  },
  burst(g, x, y, t, c) {
    if (t < 0 || t > 1) return;
    const r = 1 + eo(t) * 7;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.9;
      if (t < 0.85) g.px(px, py, t < 0.25 ? WHITE : c);
      if (t < 0.6) g.px(px - Math.cos(a) * 1.4, py - Math.sin(a) * 1.4, c);
    }
    if (t < 0.2) fx.star(g, x, y, 1, WHITE);
  },
  rays(g, x, y, r, ph, c = "#FFC53D") {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + ph;
      g.line(x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2), c);
    }
  },
  impact(g, x, y) {
    for (const [dx, dy] of [[-3, -2], [3, -2], [-3, 2], [3, 2], [0, -3], [0, 3]]) g.line(x + dx * 0.6, y + dy * 0.6, x + dx, y + dy, WHITE);
  },
  exhaust(g, x, y, f) {
    g.stamp((l) => {
      for (let j = 0; j < 7; j++) {
        const half = Math.max(0, 2.6 - j * 0.38) + (rnd(f * 7 + j) - 0.5) * 0.8;
        for (let i = -3; i <= 3; i++) {
          if (Math.abs(i) > half) continue;
          const core = Math.abs(i) < half * 0.45;
          l.px(x + i, y + j, j < 2 ? (core ? "#FFF3B0" : "#FFE36B") : core ? "#FFC53D" : j < 4 ? "#FF8A2A" : "#F0492F");
        }
      }
    }, "#3A1409");
  },
  bolt(g, x, y) {
    g.stamp((l) => l.line(x + 3, y, x, y + 4, GOLD).line(x, y + 4, x + 3, y + 4, GOLD).line(x + 3, y + 4, x, y + 9, GOLD), "#4A3100");
  }
};

// ------------------------------------------------------------ props
const prop = {
  openBook(g, x, y, o = {}) {
    const cover = o.cover || "#C8453B", w = Math.max(4, Math.round(o.w || 10)), h = o.h || 6;
    const x0 = Math.round(x - w / 2), half = Math.floor(w / 2);
    g.stamp((l) => {
      l.rect(x0, y + h - 1, w, 1, cover).rect(x0, y + 1, 1, h - 1, cover).rect(x0 + w - 1, y + 1, 1, h - 1, cover);
      l.rect(x0 + 1, y, half - 1, h - 1, "#FFF6DF").rect(x0 + half, y, w - half - 1, h - 1, "#F6E9C8");
      l.rect(x0 + half - 1, y + 1, 1, h - 2, "#DCC89C");
      for (let r = y + 1; r < y + h - 2; r += 2) {
        for (let i = x0 + 2; i < x0 + half - 1; i += 1) if ((i + r) % 3) l.px(i, r, "#B3A383");
        for (let i = x0 + half + 1; i < x0 + w - 2; i += 1) if ((i + r) % 3) l.px(i, r, "#B3A383");
      }
      if (o.flip != null && o.flip >= 0 && o.flip <= 1) {
        const pw = Math.max(1, Math.round((half - 1) * Math.abs(Math.cos(Math.PI * o.flip))));
        const px = o.flip < 0.5 ? x0 + half : x0 + half - pw;
        l.rect(px, y - 1, pw, h - 1, WHITE);
      }
    });
  },
  closedBook(g, x, y, w, h, cover = "#C8453B") {
    x = Math.round(x); y = Math.round(y);
    g.stamp((l) => {
      l.rect(x, y, w, h, cover).rect(x + w - 1, y + 1, 1, h - 2, "#FFF6DF").rect(x, y, 1, h, "#00000033");
      l.rect(x + 2, y + 1, w - 4, 1, GOLD);
    });
  },
  fedora(g, x, y, tilt = 0) {
    x = Math.round(x); y = Math.round(y);
    g.stamp((l) => {
      l.rect(x - 5, y, 11, 1, "#1B1B22");
      l.rect(x - 3 + tilt, y - 3, 7, 3, "#1B1B22").px(x - 3 + tilt, y - 3, "#3A3A48").px(x + tilt, y - 3, "#0F0F14");
      l.rect(x - 3 + tilt, y - 1, 7, 1, "#F4F1E8");
    }, "#F4F1E8");
  },
  crown(g, x, y) {
    x = Math.round(x); y = Math.round(y);
    g.stamp((l) => {
      l.rect(x - 3, y, 7, 3, GOLD).px(x - 3, y - 1, GOLD).px(x, y - 1, GOLD).px(x + 3, y - 1, GOLD).px(x - 3, y - 2, GOLD).px(x, y - 2, GOLD).px(x + 3, y - 2, GOLD);
      l.px(x, y + 1, RED).px(x - 2, y + 1, "#3AA0FF").px(x + 2, y + 1, "#1FBF6A").rect(x - 3, y, 7, 1, "#FFF1A8");
    }, "#4A3100");
  },
  trophy(g, x, y) {
    x = Math.round(x); y = Math.round(y);
    g.stamp((l) => {
      l.rect(x - 3, y, 7, 4, GOLD).rect(x - 2, y + 4, 5, 1, GOLD).rect(x - 1, y + 5, 3, 1, "#E0A800").rect(x - 2, y + 6, 5, 1, "#B07F00");
      l.px(x - 4, y + 1, GOLD).px(x + 4, y + 1, GOLD).px(x - 4, y + 2, GOLD).px(x + 4, y + 2, GOLD);
      l.px(x - 2, y + 1, WHITE).px(x - 2, y + 2, "#FFF1A8");
    }, "#4A3100");
  },
  glass(g, x, y, level, tilt) {
    x = Math.round(x); y = Math.round(y);
    g.stamp((l) => {
      l.rect(x, y, 3, 5, "#E6F6FF");
      const fill = Math.round(level * 4);
      for (let j = 0; j < fill; j++) l.rect(x, y + 4 - j, 3, 1, "#5AB8FF");
      l.px(x, y, WHITE);
      if (tilt) l.px(x - 1, y, "#5AB8FF");
    }, "#1E4A6B");
  },
  clock(g, x, y, f) {
    const sh = f % 2 ? 1 : -1;
    g.stamp((l) => {
      l.ell(x + sh * 0.5, y, 3.2, 3.2, (nx, ny) => (nx * nx + ny * ny < 0.45 ? "#FFF6DF" : RED));
      l.px(x - 2 + sh, y - 4, GOLD).px(x - 3 + sh, y - 3, GOLD).px(x + 2 + sh, y - 4, GOLD).px(x + 3 + sh, y - 3, GOLD);
      l.px(Math.round(x), Math.round(y) - 1, INKX).px(Math.round(x), Math.round(y), INKX).px(Math.round(x) + 1, Math.round(y), INKX);
      l.px(x - 2, y + 3, INKX).px(x + 2, y + 3, INKX);
    });
    if (f % 4 < 2) { g.line(x - 6, y - 3, x - 5, y - 2, WHITE).line(x + 5, y - 3, x + 6, y - 4, WHITE).line(x - 6, y + 1, x - 5, y + 1, WHITE); }
  },
  whistle(g, x, y) { g.stamp((l) => l.rect(x, y, 3, 2, "#C9D1DB").px(x, y, WHITE).px(x + 3, y, "#C9D1DB"), "#2A3340"); },
  guitar(g, x, y) {
    g.stamp((l) => {
      l.line(x + 2, y - 2, x + 11, y - 9, "#6B3A1E");
      l.line(x + 3, y - 2, x + 12, y - 9, "#8A4F28");
      l.rect(x + 11, y - 11, 2, 2, "#1B1B22");
      l.ell(x, y, 3.2, 2.8, (nx, ny) => (nx * nx + ny * ny < 0.12 ? "#1B1B22" : nx + ny > 0.6 ? "#C0501E" : "#FF7A1A"));
    });
  },
  board(g, x, y, flip) {
    const c = Math.cos(flip || 0);
    g.stamp((l) => {
      l.rect(x - 7, y, 14, Math.abs(c) < 0.35 ? 1 : 2, c > 0 ? "#E8793A" : "#6B3A1E");
      if (c > 0.3) l.px(x - 5, y + 2, INKX).px(x + 4, y + 2, INKX);
      if (c < -0.3) l.px(x - 5, y - 1, INKX).px(x + 4, y - 1, INKX);
    });
  },
  tophat(g, x, y) {
    g.stamp((l) => l.rect(x - 4, y, 9, 1, "#1B1B22").rect(x - 3, y - 5, 7, 5, "#1B1B22").rect(x - 3, y - 2, 7, 1, RED).px(x - 2, y - 5, "#3A3A48"), "#F4F1E8");
  },
  flag(g, x, y, f) {
    g.line(x, y, x, y + 14, "#5B4A2E");
    g.stamp((l) => {
      for (let j = 0; j < 5; j++) {
        const off = Math.round(Math.sin((f + j) * 0.8) * 0.6);
        const len = j === 4 ? 2 : 5;
        l.rect(x + 1, y + j + off * 0, len, 1, j === 4 ? RED : RED);
      }
      l.px(x + 5, y + 4, null);
    }, "#4A0E14");
  },
  bike(g, ph, x = 16) {
    const wy = 27.5, wl = x - 8.5, wr = x + 8.5, r = 3.6, frame = "#E0393E", tire = "#1C2230";
    for (const wx of [wl, wr]) {
      g.ring(wx, wy, r, tire).ring(wx, wy, r - 0.9, "#3A4150");
      for (let k = 0; k < 2; k++) {
        const a = -ph + (k * Math.PI) / 2;
        g.line(wx - Math.cos(a) * 2.4, wy - Math.sin(a) * 2.4, wx + Math.cos(a) * 2.4, wy + Math.sin(a) * 2.4, "#A7B0BE");
      }
      g.px(wx, wy, "#E6EAF0");
    }
    const cx = x, cy = wy;
    g.line(wl, wy, cx, cy, frame).line(wl, wy, x - 3, 21, frame).line(x - 3, 21, cx, cy, frame);
    g.line(x - 3, 21, x + 5, 20, frame).line(x + 5, 20, cx, cy, frame).line(x + 5, 20, wr, wy, "#B02028");
    g.line(x + 5, 20, x + 6, 17, "#B02028").rect(x + 5, 16, 3, 1, tire);
    g.rect(x - 6, 19, 5, 1, tire);
    const p1 = [cx + Math.cos(ph) * 2.3, cy + Math.sin(ph) * 2.3], p2 = [cx - Math.cos(ph) * 2.3, cy - Math.sin(ph) * 2.3];
    g.line(cx, cy, p1[0], p1[1], "#8A93A0").line(cx, cy, p2[0], p2[1], "#8A93A0");
    return { p1, p2, seat: [x - 4, 19], bar: [x + 6.5, 16.5] };
  },
  barbell(g, cx, y, bend) {
    const cols = [["#C8453B", "#3AA0FF", "#FFB400"], ["#8E5CFF", "#1FBF6A", "#FF7A1A"]];
    g.stamp((l) => {
      for (let i = -11; i <= 11; i++) l.px(cx + i, y + Math.round(bend * (1 - (i * i) / 121) * -1), "#8A93A0");
      [-1, 1].forEach((side, si) => cols[si].forEach((c, k) => l.rect(cx + side * (8 + k * 2) - (side < 0 ? 1 : 0), y - 3, 2, 7, c)));
    });
  },
  wand(g, x0, y0, x1, y1) { g.line(x0, y0, x1, y1, "#1B1B22"); g.px(x1, y1, WHITE); }
};

const bookHands = (A) => [{ x: A.cx - 5.5, y: A.cy + 5 }, { x: A.cx + 5.5, y: A.cy + 5 }];

// ------------------------------------------------------------ registry
const LIB = [];
const def = (id, name, cat, loop, when, draw, poster) => LIB.push({ id, name, cat, loop, when, draw, poster: poster ?? 0 });

// ============================================================ EVERYDAY
def("idle", "Idle", "Everyday", 48, "Always. Breathes, blinks, lets the leaf sway.", (g, f) => {
  g.shadow(16, 6);
  drawPip(g, { sq: wave(f, 24, 0.035), la: 28 + wave(f, 48, 7), eyes: blink(f) ? "blink" : "open" });
});

def("look", "Look Around", "Everyday", 60, "Ambient, now and then, in the Nook.", (g, f) => {
  const s = tl(f, [10, 12, 6, 12, 8, 12]);
  const lk = [0, -1, 0, 1, 0, 0][s.k], up = s.k === 5 ? -1 : 0;
  g.shadow(16, 6);
  drawPip(g, { look: [lk, up], fdx: lk, la: 28 + lk * 20 + up * 24, mouth: s.k === 5 ? "o" : "smile", eyes: s.k === 2 && s.n < 2 ? "blink" : "open", sq: wave(f, 30, 0.03) });
  if (s.k === 5) g.text("?", 25, 3, WHITE);
});

def("welcome", "Welcome Back", "Everyday", 36, "You open Leaflet after 3+ days away.", (g, f) => {
  const j = f < 10 ? hop(f / 10, 3) : 0, w = wave(f, 8, 1.6);
  g.shadow(16, j < -1 ? 4 : 6);
  drawPip(g, {
    y: 28 + j, sq: f < 10 ? -0.06 : wave(f, 12, 0.03), eyes: "happy", mouth: "open", la: 10 + w * 6, blush: "big",
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: 25.5 + w, y: A.cy - 8 + Math.abs(w) * 0.4 }]
  });
  if (f % 12 < 6) fx.star(g, 29, 6, 1);
});

def("yawn", "Big Yawn", "Everyday", 48, "Late evening, when the Nook has been idle a while.", (g, f) => {
  const s = tl(f, [12, 14, 10, 12]);
  let o = {};
  if (s.k === 0) o = { sq: -0.14 * eo(s.t), eyes: "half", mouth: "o", la: 40 - 30 * s.t, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy + 2 - 8 * s.t }, { x: A.handR[0] + 1, y: A.cy + 2 - 8 * s.t }] };
  if (s.k === 1) o = { sq: -0.14, eyes: "squeeze", mouth: "shout", la: 10 + wave(s.n, 6, 4), hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 6 }, { x: A.handR[0] + 1, y: A.cy - 6 }] };
  if (s.k === 2) o = { sq: lerp(-0.14, 0.1, eo(s.t)), eyes: "closed", mouth: "o", la: 40 + 20 * s.t };
  if (s.k === 3) o = { sq: 0.1 - 0.1 * s.t, eyes: s.n < 6 ? "half" : "blink", mouth: "flat", la: 60 };
  g.shadow(16, 6);
  const A = drawPip(g, o);
  if (s.k === 1 && s.n > 6) fx.drop(g, A.fc - 6, A.ey - 1 + (s.n - 6) * 0.4, SKY);
});

def("stretch", "Stretch Break", "Everyday", 40, "You've read for 50 minutes without a pause.", (g, f) => {
  const e = eio(tri(f, 40));
  g.shadow(16, 6);
  drawPip(g, {
    sq: -0.2 * e, la: 28 - 28 * e, ll: 1 + 0.15 * e, eyes: e > 0.6 ? "squeeze" : "open", mouth: e > 0.6 ? "o" : "smile",
    hands: (A) => [{ x: lerp(A.handL[0], 12, e), y: lerp(A.handL[1], A.top.y - 3, e) }, { x: lerp(A.handR[0], 20, e), y: lerp(A.handR[1], A.top.y - 3, e) }],
    feet: e > 0.6 ? (A) => [[A.cx - 3.5, A.bottom + 1.1, 1.6], [A.cx + 3.5, A.bottom + 1.1, 1.6]] : null
  });
  if (e > 0.85) fx.star(g, 27, 5, 1);
});

def("sleep", "Sleep", "Everyday", 48, "No reading yet today, or the app has been idle.", (g, f) => {
  g.shadow(16, 7);
  const A = drawPip(g, { sq: 0.12 + wave(f, 24, 0.04), eyes: "closed", mouth: "tiny", la: 100 + wave(f, 48, 5) });
  // A small bubble that grows at the corner of the mouth, clear of the eyes.
  const b = f % 48;
  if (b < 36) {
    const r = 0.8 + (b / 36) * 1.1;
    g.stamp((l) => l.ell(A.fc + 2.5, A.ey + 4.5, r, r, (nx, ny) => (nx + ny < -0.6 ? WHITE : "#CFEFFF")), "#3D7FA8");
  }
  for (let k = 0; k < 2; k++) { const t = ((f + k * 24) % 48) / 48; fx.z(g, 22 + t * 5, 12 - t * 11, k === 0 ? t > 0.4 : false); }
}, 20);

// ------------------------------------------------------------ time of day
// Moments that follow the clock: a bed pulled out of thin air late at night,
// coffee in the morning, a sandwich at lunch, tea under a blanket at dusk.

const WOOD = "#8A5A34", WOOD_D = "#5E3A1F", SHEET = "#EEE9DD", SHEET_D = "#CFC8B8";
const QUILT = "#5B7FD6", QUILT_L = "#8FAAF0", QUILT_D = "#3D5BAA";

const bed = (g, blanketTop, breath = 0) => {
  const b = Math.round(blanketTop + breath);
  return {
    back(g) {
      // Headboard with a round knob, and a low footboard.
      g.stamp((l) => {
        l.rect(2, 14, 3, 15, WOOD).rect(2, 14, 1, 15, WOOD_D).px(3, 13, WOOD).px(3, 12, "#C08A57");
        l.rect(28, 21, 3, 8, WOOD).rect(30, 21, 1, 8, WOOD_D);
        l.rect(5, 19, 6, 4, SHEET).rect(5, 22, 6, 1, SHEET_D); // pillow
      }, "#2E1D10");
    },
    front(g) {
      g.stamp((l) => {
        l.rect(4, b, 25, 27 - b, QUILT).rect(4, b, 25, 1, QUILT_L);
        for (let x = 7; x < 28; x += 6) l.rect(x, b + 1, 1, 26 - b, QUILT_D);
        l.rect(4, 27, 25, 1, SHEET_D).rect(3, 28, 2, 2, WOOD_D).rect(27, 28, 2, 2, WOOD_D);
      }, "#1E2A55");
    }
  };
};

const nightcap = (g, A, flop) => {
  const x = Math.round(A.top.x), y = Math.round(A.top.y);
  g.stamp((l) => {
    // Brim across the crown, then a striped cone flopping to the right.
    l.rect(x - 4, y, 9, 2, "#2F6FD6").rect(x - 4, y + 1, 9, 1, WHITE);
    l.rect(x - 3, y - 1, 6, 1, "#2F6FD6").rect(x - 1, y - 2, 5, 1, WHITE).rect(x + 1, y - 3, 4, 1, "#2F6FD6");
    l.rect(x + 4, y - 2, 2, 1, WHITE).rect(x + 5, y - 1, 2, 1, "#2F6FD6");
    l.rect(x + 6 + flop, y, 2, 2, WHITE);
  }, "#16305E");
};

def("bedsleep", "Tucked In", "Everyday", 48, "Late at night, once you've gone quiet: Pip sleeps in its bed.", (g, f) => {
  const breath = wave(f, 48, 0.5);
  const beds = bed(g, 23, breath);
  beds.back(g);
  const A = drawPip(g, { x: 12, y: 25, w: 7, h: 6.5, eyes: "closed", mouth: "tiny", la: 110, hands: false, feet: false });
  nightcap(g, A, 1);
  beds.front(g);
  for (let k = 0; k < 2; k++) { const t = ((f + k * 24) % 48) / 48; fx.z(g, 19 + t * 6, 11 - t * 9, k === 0 ? t > 0.4 : false); }
}, 20);

def("bedtime", "Bedtime", "Everyday", 48, "Late at night: Pip pulls a bed out of thin air and climbs in.", (g, f) => {
  const s = tl(f, [9, 7, 10, 22]);
  if (s.k === 0) {
    // Poof: a cloud billows where the bed is about to be.
    g.shadow(16, 6);
    drawPip(g, { x: 22, eyes: "wide", mouth: "o", brows: "up", la: -10 });
    for (let i = 0; i < 4; i++) fx.puff(g, 5 + i * 5, 24 - (i % 2) * 3, 1.2 + s.t * 2.4, "#F2EFE8");
    if (s.n % 4 < 2) g.text("!", 26, 2, GOLD);
    return;
  }
  const beds = bed(g, s.k === 1 ? 28 : s.k === 2 ? lerp(28, 23, eo(s.t)) : 23);
  beds.back(g);
  if (s.k === 1) {
    // Hop from beside the bed into it.
    const x = lerp(22, 12, s.t), y = 28 + hop(s.t, 7);
    drawPip(g, { x, y, eyes: "happy", mouth: "smile", la: 20, feet: s.t > 0.8 ? false : undefined });
    for (let i = 0; i < 3; i++) fx.puff(g, 8 + i * 7, 25, Math.max(0, 2 - s.t * 2.5), "#F2EFE8");
  } else {
    const yawn = s.k === 2;
    const A = drawPip(g, { x: 12, y: 25, w: 7, h: 6.5, eyes: yawn ? "squeeze" : "closed", mouth: yawn ? "o" : "tiny", la: yawn ? 60 : 110, hands: false, feet: false });
    if (s.k === 3) {
      nightcap(g, A, 1);
      if (s.n < 3) fx.puff(g, A.top.x, A.top.y - 1, 2, "#F2EFE8");
      const t = s.n / 22;
      fx.z(g, 19 + t * 6, 11 - t * 9, t > 0.4);
    }
  }
  beds.front(g);
}, 30);

const mug = (g, x, y) => {
  x = Math.round(x); y = Math.round(y);
  g.stamp((l) => {
    l.rect(x, y, 4, 5, "#F4F1E8").rect(x, y, 4, 1, "#6B3A1E").px(x, y + 1, "#FFFFFF");
    l.px(x + 4, y + 1, "#F4F1E8").px(x + 5, y + 2, "#F4F1E8").px(x + 4, y + 3, "#F4F1E8");
    l.rect(x + 1, y + 2, 2, 1, "#C8453B");
  }, "#3A2A1E");
};
const steam = (g, x, y, f) => {
  for (let k = 0; k < 2; k++) {
    const t = ((f + k * 6) % 12) / 12;
    const sx = x + k * 2 + Math.round(Math.sin((f + k * 5) * 0.8));
    if (t < 0.8) g.px(sx, Math.round(y - t * 6), "#FFFFFFcc");
  }
};

def("coffee", "Morning Coffee", "Everyday", 48, "In the morning: a slow sip, then eyes wide open.", (g, f) => {
  const s = tl(f, [10, 12, 8, 18]);
  g.shadow(16, 6);
  let mx = 23, my = 21, o;
  if (s.k === 0) o = { eyes: "closed", mouth: "flat", la: 80 + wave(s.n, 10, 6) };
  if (s.k === 1) { mx = lerp(23, 19, eo(Math.min(1, s.t * 2))); my = lerp(21, 17, eo(Math.min(1, s.t * 2))); o = { eyes: "closed", mouth: "tiny", la: lerp(80, 50, s.t) }; }
  if (s.k === 2) o = { eyes: "wide", mouth: "o", brows: "up", la: lerp(50, -20, eo(s.t)), sq: -0.08 * Math.sin(Math.PI * s.t) };
  if (s.k === 3) o = { eyes: "happy", mouth: "smile", la: 20 + wave(s.n, 18, 8), blush: "big" };
  const A = drawPip(g, Object.assign(o, { hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: mx + 1, y: my + 3 }] }));
  mug(g, mx, my);
  if (s.k !== 1) steam(g, mx + 1, my - 1, f);
  if (s.k === 2) { fx.star(g, A.cx - 9, A.top.y + 2, 1, GOLD); fx.star(g, A.cx + 9, A.top.y + 1, 1, GOLD); if (s.n % 4 < 3) g.text("!", 27, 1, GOLD); }
}, 40);

def("sandwich", "Lunch Break", "Everyday", 36, "Around lunchtime: Pip munches a sandwich, crumbs everywhere.", (g, f) => {
  // A sandwich held up at the side of the mouth, a bite gone every few
  // chews, crumbs dropping.
  const bites = Math.min(3, Math.floor(f / 9));
  const chew = f % 6 < 3;
  g.shadow(16, 6);
  let sx = 0, sy = 0;
  const A = drawPip(g, {
    x: 14, eyes: "happy", mouth: chew ? "o" : "flat", mouthDx: 1, blush: "big", la: 24 + wave(f, 12, 6), sq: chew ? 0.03 : 0,
    hands: (A) => {
      sx = A.fc + 4;
      sy = A.ey + 2;
      return [{ x: A.handL[0], y: A.handL[1] }, { x: sx + 3, y: sy + 5 }];
    }
  });
  const w = 7 - bites, x = Math.round(sx + (7 - w)), y = Math.round(sy);
  g.stamp((l) => {
    l.rect(x, y, w, 2, "#E8B86B").px(x + w - 1, y, "#F6D69A");
    l.rect(x, y + 2, w, 1, "#5BBF4A").px(x - 1, y + 2, "#5BBF4A");
    l.rect(x, y + 3, w, 1, "#E0393E");
    l.rect(x, y + 4, w, 2, "#E8B86B");
    // The bitten edge: a notch where the teeth went in.
    if (bites > 0) l.px(x, y, null).px(x, y + 5, null);
  }, "#6B4A1E");
  for (let i = 0; i < 3; i++) {
    const t = ((f + i * 5) % 12) / 12;
    g.px(Math.round(A.fc + 1 + i * 2), Math.round(sy + 7 + t * 5), "#E8B86B");
  }
}, 4);

def("tea", "Evening Tea", "Everyday", 48, "In the evening: tea, a blanket round the shoulders, and a slow sway.", (g, f) => {
  const sway = wave(f, 48, 0.6);
  g.shadow(16, 6);
  // The blanket is drawn behind Pip, a little larger, so it shows as a shawl
  // round the shoulders and sides; its hem wraps across the front.
  const shawl = (g, A) =>
    g.stamp((l) =>
      l.ell(A.cx, A.cy + 1.5, A.rx + 2.2, A.ry + 1.2, (nx, ny, x, y) =>
        (x + y) % 4 === 0 || (x - y + 64) % 4 === 0 ? "#8E2F28" : "#C8453B"
      ),
      "#4A1410"
    );
  const A = drawPip(g, {
    x: 16 + sway, eyes: f % 48 > 44 ? "blink" : "happy", mouth: "smile", blush: true, la: 34 + wave(f, 48, 6), behind: shawl,
    hands: (A) => [{ x: A.fc - 3, y: A.ey + 7 }, { x: A.fc + 3, y: A.ey + 7 }]
  });
  g.stamp((l) => {
    for (let y = Math.round(A.bottom - 3); y <= A.bottom; y++) {
      for (let x = Math.round(A.cx - A.rx - 1); x <= Math.round(A.cx + A.rx + 1); x++) {
        l.px(x, y, (x + y) % 4 === 0 ? "#8E2F28" : "#C8453B");
      }
    }
  }, "#4A1410");
  const cx = Math.round(A.fc - 2), cy = Math.round(A.ey + 5);
  g.stamp((l) => l.rect(cx, cy, 5, 3, WHITE).rect(cx, cy, 5, 1, "#C79A4A").px(cx + 5, cy + 1, WHITE).rect(cx - 1, cy + 3, 7, 1, "#E6E0D2"), "#3A2A1E");
  steam(g, cx + 1, cy - 1, f);
}, 20);

def("floatnap", "Levitating Nap", "Everyday", 48, "Idle for 10+ minutes. Pip naps so hard it floats.", (g, f) => {
  const up = 5 + wave(f, 48, 2);
  g.shadow(16, 4);
  drawPip(g, {
    y: 28 - up, sq: 0.06, eyes: "closed", mouth: "o", la: 90 + wave(f, 24, 12),
    feet: (A) => [[A.cx - 3, A.bottom + 2 + wave(f, 24, 0.6)], [A.cx + 3, A.bottom + 2 - wave(f, 24, 0.6)]],
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] + 2 }, { x: A.handR[0], y: A.handR[1] + 2 }]
  });
  for (let k = 0; k < 2; k++) { const t = ((f + k * 24) % 48) / 48; fx.z(g, 24 + t * 3, 7 - t * 7, k === 0); }
}, 12);

def("tap", "Impatient Tap", "Everyday", 24, "A book is open but the page hasn't moved.", (g, f) => {
  const up = f % 6 < 3;
  g.shadow(16, 6);
  drawPip(g, {
    eyes: "half", mouth: "flat", brows: "focus", la: 28 + (up ? 10 : 0),
    hands: (A) => [{ x: A.cx - 3, y: A.cy + 3 }, { x: A.cx + 3, y: A.cy + 3 }],
    feet: (A) => [[A.cx - 3.5, A.bottom + 1.1], [A.cx + 4.5, A.bottom + 1.1 - (up ? 1.2 : 0)]]
  });
  if (!up) g.px(25, 28, WHITE).px(26, 29, WHITE).px(26, 27, WHITE);
});

def("sneeze", "Dust Sneeze", "Everyday", 60, "You open a book nobody has touched in 30+ days.", (g, f) => {
  const s = tl(f, [14, 6, 6, 20, 14]);
  let o = {}, x = 16;
  if (s.k === 0) o = { lean: -2 * eo(s.t), sq: -0.1 * s.t, eyes: "squeeze", mouth: "o", la: 28 - 30 * s.t };
  if (s.k === 1) o = { lean: -2, sq: -0.12, eyes: "squeeze", mouth: "open", la: -2 };
  if (s.k === 2) { x = 16 - 3 * eo(s.t); o = { lean: 3, sq: 0.16, eyes: "squeeze", mouth: "shout", la: -70 }; }
  if (s.k === 3) { x = 13; o = { eyes: "spiral", eyePhase: s.n, mouth: "wavy", la: -40 + wave(s.n, 10, 10), sq: 0.05 }; }
  if (s.k === 4) { x = lerp(13, 16, eo(s.t)); o = { eyes: s.n < 3 ? "blink" : "open", la: 28 }; }
  g.shadow(x, 6);
  drawPip(g, Object.assign({ x }, o));
  if (s.k === 2 || s.k === 3) {
    const t = s.k === 2 ? s.t * 0.3 : 0.3 + s.t * 0.7;
    for (let i = 0; i < 5; i++) fx.puff(g, 21 + t * 9 + i * 1.6, 21 + (rnd(i) - 0.5) * 9 * t + (i % 2), 1.2 + t * 1.3 * rnd(i + 4));
  }
  if (s.k === 2 || (s.k === 3 && s.n < 10)) g.text("ACHOO", 12, 1, WHITE);
}, 26);

def("peek", "Peekaboo", "Everyday", 52, "How Pip enters the reader: a peek over the progress rail.", (g, f) => {
  const s = tl(f, [8, 9, 5, 9, 9, 12]);
  const rise = s.k === 0 ? eo(s.t) : s.k === 5 ? 1 - ei(s.t) : 1;
  const look = s.k === 1 ? -1 : s.k === 3 ? 1 : 0;
  drawPip(g, { y: 33 + (1 - rise) * 20, feet: false, hands: false, look: [look, 0], fdx: look, la: 20 + look * 18, eyes: s.k === 2 && s.n < 2 ? "blink" : "open", mouth: s.k === 4 ? "open" : "smile" });
  g.stamp((l) => l.rect(0, 30, 32, 2, "#CDBB93"), "#5B4A2E");
  if (rise > 0.6) { drawHand(g, { x: 10, y: 29 }); drawHand(g, { x: 22, y: 29 }); }
  if (s.k === 4) g.text("!", 26, 12, GOLD);
}, 24);

// Moves for living in the app: the world overlay drives these from physics.
// They face right; the overlay mirrors the canvas to face left.
def("walk", "Stroll", "Everyday", 8, "Pip wanders along a card or the bottom of the window.", (g, f) => {
  const a = f % 8 < 4;
  g.shadow(16, 6);
  drawPip(g, {
    y: 28 - (f % 4 < 2 ? 0 : 0.6), fdx: 1, look: [1, 0], la: -18 + wave(f, 8, 8), eyes: blink(f, 48) ? "blink" : "open",
    feet: (A) => [[A.cx - 3 + (a ? 1.6 : -1.6), A.bottom + 1.1 - (a ? 0.8 : 0)], [A.cx + 3 + (a ? -1.6 : 1.6), A.bottom + 1.1 - (a ? 0 : 0.8)]],
    hands: (A) => [{ x: A.handL[0] + (a ? 1 : -1), y: A.handL[1] }, { x: A.handR[0] + (a ? -1 : 1), y: A.handR[1] }]
  });
});

def("held", "Picked Up", "Everyday", 12, "You pick Pip up by the leaf.", (g, f) => {
  const k = f % 12 < 6;
  drawPip(g, {
    y: 27, sq: -0.12, la: 0, ll: 1.15, eyes: "wide", mouth: "o", brows: "up",
    feet: (A) => [[A.cx - 3, A.bottom + 1.6 + (k ? 0.8 : 0), 1.8], [A.cx + 3, A.bottom + 1.6 + (k ? 0 : 0.8), 1.8]],
    hands: (A) => [{ x: A.handL[0] - 1, y: A.cy + (k ? -2 : 0) }, { x: A.handR[0] + 1, y: A.cy + (k ? 0 : -2) }]
  });
}, 3);

def("fall", "Falling", "Everyday", 8, "Pip drops from a card, a door, or your hand.", (g, f) => {
  drawPip(g, {
    sq: -0.06, la: wave(f, 8, 10), ll: 1.1, eyes: "wide", mouth: "o",
    hands: (A) => [{ x: A.handL[0] - 1.5, y: A.cy - 5 + wave(f, 4, 1) }, { x: A.handR[0] + 1.5, y: A.cy - 5 - wave(f, 4, 1) }],
    feet: (A) => [[A.cx - 3, A.bottom + 1.4], [A.cx + 3, A.bottom + 1.4]]
  });
});

def("tumble", "Tumble", "Stunts", 8, "You throw Pip. Hard.", (g, f) => {
  g.xform((gg) => drawPip(gg, { eyes: "squeeze", mouth: "shout", la: -40, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 3 }, { x: A.handR[0] + 2, y: A.cy - 3 }] }), { cx: 16, cy: 21, rot: (f / 8) * TAU });
});

def("land", "Landing", "Everyday", 6, "A soft landing.", (g, f) => {
  const t = f / 5;
  g.shadow(16, 7);
  drawPip(g, { sq: 0.22 * (1 - t), eyes: t < 0.5 ? "squeeze" : "open", mouth: "o", la: 28 + (1 - t) * 30 });
});

def("splat", "Splat", "Drama", 36, "Thrown into the floor. Pip is fine. Mostly.", (g, f) => {
  // Squashed flat enough to read as a pancake, not so flat that the face
  // folds into itself or the arms leave the frame: every part stays inside
  // the 32px canvas.
  const s = tl(f, [3, 19, 14]);
  const hands = (spread) => (A) => [{ x: Math.max(2.5, A.handL[0] - spread), y: A.cy + 1.5 }, { x: Math.min(29.5, A.handR[0] + spread), y: A.cy + 1.5 }];
  if (s.k < 2) {
    const squash = s.k === 0 ? 0.4 * eo(s.t) : 0.4 + wave(s.n, 10, 0.02);
    g.shadow(16, 8);
    const A = drawPip(g, { sq: squash, eyes: "x", mouth: "wavy", la: 105, hands: hands(1) });
    if (s.k === 0 || s.n < 4) {
      const t = s.k === 0 ? s.t * 0.3 : 0.3 + s.n / 8;
      fx.puff(g, A.cx - 11 - t * 3, A.bottom - 1, 1.2 + t, "#F2EFE8");
      fx.puff(g, A.cx + 11 + t * 3, A.bottom - 1, 1.2 + t, "#F2EFE8");
    }
    if (s.k === 1) {
      for (let i = 0; i < 3; i++) {
        const a = s.n * 0.6 + (i * TAU) / 3;
        fx.star(g, A.cx + Math.cos(a) * 7, A.top.y - 3 + Math.sin(a) * 1.6, 1);
      }
    }
    return;
  }
  // Popping back into shape, with a little overshoot, then a relieved smile.
  g.shadow(16, 6);
  drawPip(g, {
    sq: 0.4 * (1 - back(s.t)),
    eyes: s.t > 0.6 ? "happy" : "spiral",
    eyePhase: s.n,
    mouth: s.t > 0.6 ? "smile" : "wavy",
    la: lerp(105, 28, s.t)
  });
}, 10);

def("cling", "Wall Cling", "Stunts", 12, "Thrown at the edge of the window, Pip holds on.", (g, f) => {
  const k = f % 12 < 6;
  drawPip(g, {
    x: 19, fdx: 2, look: [1, 0], sq: -0.05, eyes: "determined", brows: "focus", mouth: "grit", la: -30,
    hands: (A) => [{ x: A.cx + A.rx, y: A.cy - 4 + (k ? 0 : 1) }, { x: A.cx + A.rx + 0.5, y: A.cy + 1 + (k ? 1 : 0) }],
    feet: (A) => [[A.cx + 3, A.bottom + 1.2, 1.8], [A.cx + 5.5, A.bottom - 1, 1.6]]
  });
});

def("point", "Point", "Coach", 16, "Pip shows you around: standing on a thing, pointing at it.", (g, f) => {
  const up = f % 8 < 4;
  g.shadow(16, 6);
  drawPip(g, {
    y: 28 - (up ? 0 : 1), fdx: 1, look: [1, 1], eyes: blink(f, 32) ? "blink" : "open", mouth: "open", la: 20 + wave(f, 16, 8),
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + A.rx + 2.5, y: A.cy + 3 + (up ? 0 : 1) }]
  });
  if (f % 8 < 6) g.stamp((l) => l.rect(27, 28 + (up ? 0 : 1), 3, 1, GOLD).px(28, 29 + (up ? 0 : 1), GOLD), "#4A3100");
});

def("pointup", "Point Up", "Coach", 16, "Pip shows you something above it.", (g, f) => {
  const up = f % 8 < 4;
  g.shadow(16, 6);
  drawPip(g, {
    y: 28 - (up ? 1 : 0), fdx: 1, look: [1, -1], eyes: blink(f, 32) ? "blink" : "open", mouth: "open", la: 10 + wave(f, 16, 8),
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + A.rx + 1, y: A.cy - 8 - (up ? 1 : 0) }]
  });
  if (f % 8 < 6) g.stamp((l) => l.px(27, 4 - (up ? 1 : 0), GOLD).rect(26, 5 - (up ? 1 : 0), 3, 1, GOLD), "#4A3100");
});

// ============================================================ READING
def("read", "Reading", "Reading", 48, "Sits with you in the Nook while a session runs.", (g, f) => {
  const k = f % 48, flip = k >= 38 ? (k - 38) / 10 : null;
  const scan = k < 36 ? Math.round(lerp(-1, 1, (k % 12) / 11)) : 0;
  g.shadow(16, 6);
  drawPip(g, { sq: wave(f, 24, 0.03), look: [scan, 1], la: 28 + wave(f, 48, 5), mouth: "flat", eyes: blink(f, 48, 30) ? "blink" : "open", hold: (g, A) => prop.openBook(g, A.cx, A.cy + 2, { flip }), hands: bookHands });
});

def("speedread", "Speed Reader", "Reading", 24, "Smart Read climbs past 450 words per minute.", (g, f) => {
  for (let i = 0; i < 4; i++) { const y = 5 + i * 6 + (i % 2); const x = (f * 3 + i * 9) % 12; fx.speed(g, x - 3, y, 4); fx.speed(g, 29 - x, y + 2, 3); }
  g.shadow(16, 6);
  drawPip(g, { x: 16 + (rnd(f) - 0.5), sq: wave(f, 4, 0.03), look: [f % 4 < 2 ? -1 : 1, 1], mouth: "o", la: -40 + wave(f, 4, 8), brows: "focus", hold: (g, A) => prop.openBook(g, A.cx, A.cy + 2, { flip: (f % 4) / 4 }), hands: bookHands });
  if (f % 12 < 6) fx.drop(g, 26, 13 - (f % 6), SKY);
});

def("twist", "Plot Twist", "Reading", 64, 'A chapter ends on a cliffhanger (you tap "whoa").', (g, f) => {
  const s = tl(f, [16, 5, 13, 16, 14]);
  let o = { hold: (g, A) => prop.openBook(g, A.cx, A.cy + 2), hands: bookHands, look: [0, 1], mouth: "flat" };
  let bk = null;
  if (s.k === 0) o.look = [Math.round(lerp(-1, 1, (s.n % 8) / 7)), 1];
  if (s.k === 1) Object.assign(o, { eyes: "wide", look: [0, 0], la: 10 });
  if (s.k === 2) {
    o = { y: 28 + hop(s.t, 4), sq: -0.16, eyes: "wide", mouth: "shout", la: 0, ll: 1.25, brows: "up", hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 4 }, { x: A.handR[0] + 2, y: A.cy - 4 }] };
    bk = { x: 16 + s.t * 3, y: 22 - 25 * eo(s.t), r: s.t * TAU };
  }
  if (s.k === 3) {
    const land = eo(clamp(s.t * 1.6));
    o = { sq: 0.08, eyes: "spiral", eyePhase: s.n, mouth: "wavy", la: 60 };
    bk = { x: 16, y: lerp(-4, 9.5, land), r: 0 };
  }
  if (s.k === 4) {
    o = { eyes: s.n < 3 ? "blink" : "open", mouth: "smile", la: 28, lean: wave(s.n, 6, 1) * (1 - s.t) };
    bk = { x: 16 + s.t * 14, y: 9.5 + ei(s.t) * 18, r: s.t * 2 };
  }
  g.shadow(16, 6);
  drawPip(g, o);
  if (s.k === 2) g.text("!", 26, 2, GOLD);
  if (bk) g.xform((gg) => prop.closedBook(gg, 13, 13, 7, 5, "#2F6FD6"), { cx: 16.5, cy: 15.5, rot: bk.r, dx: bk.x - 16, dy: bk.y - 15 });
}, 22);

def("sob", "Sad Chapter", "Reading", 36, 'You mark a chapter as "that one hurt".', (g, f) => {
  g.shadow(16, 6);
  const A = drawPip(g, { x: 16 + wave(f, 6, 0.6), sq: 0.06 + wave(f, 12, 0.03), eyes: "squeeze", mouth: "shout", brows: "sad", la: 130 + wave(f, 12, 6), hold: (g, A) => prop.openBook(g, A.cx, A.cy + 3, { cover: "#4A6FD6" }), hands: (A) => [{ x: A.cx - 5.5, y: A.cy + 6 }, { x: A.cx + 5.5, y: A.cy + 6 }] });
  for (const side of [-1, 1]) {
    const ex = A.fc + (side < 0 ? -4 : 3);
    for (let i = 0; i < 8; i++) {
      const k = (i + f * 0.5) % 8;
      g.px(ex + side * k * 1.3, A.ey - 1 + k * k * 0.26, k < 1.2 ? WHITE : i % 2 ? BLUE : SKY);
    }
  }
});

def("laugh", "Cracking Up", "Reading", 24, 'You react "lol" to a passage.', (g, f) => {
  const b = f % 6 < 3;
  g.shadow(16, 6);
  g.xform((gg) => drawPip(gg, { y: b ? 27 : 28, sq: b ? -0.06 : 0.1, eyes: "squeeze", mouth: "shout", blush: "big", la: 28 + wave(f, 6, 22), hands: (A) => [{ x: A.cx - 6, y: A.cy + 4 }, { x: A.cx + 6, y: A.cy + 4 }] }), { cx: 16, cy: 29, rot: wave(f, 12, 0.16) });
  if (f % 12 < 6) g.text("HA", 1, 5, GOLD); else g.text("HA", 24, 9, GOLD);
});

def("dive", "Deep Dive", "Reading", 60, "A single session passes 25 focused minutes.", (g, f) => {
  const s = tl(f, [10, 10, 6, 34]);
  const book = () => prop.openBook(g, 20, 26, { w: 14, h: 5, cover: "#2F6FD6" });
  if (s.k === 0) {
    book(); g.shadow(8, 5);
    drawPip(g, { x: 8, w: 6.5, h: 5.8, sq: 0.16 * s.t, eyes: "determined", brows: "focus", look: [1, 0], fdx: 1, mouth: "flat", la: -10 });
    return;
  }
  if (s.k === 1) {
    book();
    const x = lerp(8, 19, s.t), y = 28 + hop(s.t, 12);
    g.xform((gg) => drawPip(gg, { w: 6.5, h: 5.8, eyes: "happy", mouth: "open", la: -20, hands: (A) => [{ x: A.cx - 2, y: A.top.y - 1 }, { x: A.cx + 2, y: A.top.y - 1 }] }), { cx: 16, cy: 22, rot: s.t * Math.PI, dx: x - 16, dy: y - 28 });
    return;
  }
  const sink = s.k === 2 ? s.t : 1;
  const kick = s.k === 3 ? (f % 4 < 2 ? 1 : -1) : 0;
  g.xform((gg) => drawPip(gg, { w: 6.5, h: 5.8, eyes: "happy", la: 0, hands: false, feet: (A) => [[A.cx - 3 - kick, A.bottom + 1.4 + kick], [A.cx + 3 - kick, A.bottom + 1.4 - kick]] }), { cx: 16, cy: 22, rot: Math.PI, dx: 19 - 16, dy: lerp(14, 23.5, sink) - 22 });
  book();
  if (s.k === 3) {
    for (let i = 0; i < 3; i++) { const t = ((s.n + i * 11) % 34) / 34; fx.twinkle(g, 12 + i * 8, 24 - t * 16, (t * 3) % 1, "#9FD6FF"); }
  }
}, 36);

def("theend", "The End", "Reading", 48, "You finish a book.", (g, f) => {
  const s = tl(f, [10, 6, 32]);
  g.shadow(16, 6);
  if (s.k < 2) {
    drawPip(g, { mouth: "smile", eyes: s.k === 1 ? "happy" : "open", look: [0, 1], hold: (g, A) => prop.openBook(g, A.cx, A.cy + 2, { w: s.k === 1 ? lerp(10, 4, s.t) : 10 }), hands: bookHands });
    return;
  }
  drawPip(g, {
    lean: wave(s.n, 16, 1), eyes: "happy", mouth: "smile", blush: "big", la: 28 + wave(s.n, 16, 10),
    hold: (g, A) => prop.closedBook(g, A.cx - 3, A.cy, 7, 8, "#C8453B"),
    hands: (A) => [{ x: A.cx - 4, y: A.cy + 4 }, { x: A.cx + 4, y: A.cy + 3 }]
  });
  for (let i = 0; i < 2; i++) { const t = ((s.n + i * 16) % 32) / 32; if (t < 0.9) fx.heart(g, 24 + i * 3 + wave(s.n + i * 5, 10, 1), 13 - t * 12, false); }
  if (s.n < 20) g.text("END", 1, 1, GOLD);
}, 30);

def("booknap", "Book Nap", "Reading", 48, "Still reading at 11:40 pm.", (g, f) => {
  g.shadow(16, 7);
  drawPip(g, {
    sq: 0.1 + wave(f, 24, 0.035), eyes: "closed", mouth: f % 24 < 12 ? "o" : "tiny", la: 110,
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] + 2 }, { x: A.handR[0], y: A.handR[1] + 2 }],
    over: (g, A) => {
      const cx = Math.round(A.cx), y = Math.round(A.cy - A.ry + 2);
      g.stamp((l) => {
        for (let i = 0; i < 8; i++) {
          l.rect(cx - 1 - i, y + i, 1, 2, "#4A6FD6").rect(cx + i, y + i, 1, 2, "#4A6FD6");
          if (i < 7) l.px(cx - 1 - i, y + i + 2, "#FFF6DF").px(cx + i, y + i + 2, "#F6E9C8");
        }
      });
    }
  });
  for (let k = 0; k < 2; k++) { const t = ((f + k * 24) % 48) / 48; fx.z(g, 25 + t * 3, 9 - t * 8, k === 0); }
});

def("bookmark", "Plant the Flag", "Reading", 40, "You add a bookmark.", (g, f) => {
  const s = tl(f, [10, 5, 25]);
  const poleY = s.k === 0 ? 9 - 1 * wave(f, 10, 1) : s.k === 1 ? lerp(9, 15, s.t) : 15;
  g.shadow(16, 6);
  const A = drawPip(g, {
    x: 13, eyes: s.k === 2 ? "happy" : "determined", brows: s.k === 2 ? null : "focus", mouth: s.k === 2 ? "open" : "flat", sq: s.k === 1 ? 0.1 : 0,
    hands: (A) => s.k === 2 ? [{ x: A.handL[0], y: A.handL[1] }, { x: A.fc + 5, y: A.ey - 3 }] : [{ x: A.handL[0], y: A.handL[1] }, { x: 25, y: poleY + 6 }]
  });
  prop.flag(g, 25, Math.round(poleY), f);
  if (s.k === 1 && s.t > 0.6) fx.puff(g, 27, 29, 1.6);
  if (s.k === 2) fx.twinkle(g, 30, 12, (s.n % 12) / 12);
}, 30);

// ============================================================ CELEBRATE
def("xp", "Leaves Earned", "Celebrate", 36, "A session ends and your leaves are counted.", (g, f) => {
  const s = tl(f, [5, 11, 5, 15]);
  let y = 28, sq = 0, hands = null;
  if (s.k === 0) sq = 0.18 * s.t;
  if (s.k === 1) { y = 28 + hop(s.t, 7); sq = -0.14 * (1 - Math.abs(s.t - 0.5) * 2); hands = (A) => [{ x: A.handL[0] - 1, y: A.cy - 5 }, { x: A.handR[0] + 1, y: A.cy - 5 }]; }
  if (s.k === 2) sq = 0.2 * (1 - s.t);
  if (s.k === 3) sq = wave(s.n, 10, 0.04);
  g.shadow(16, y < 25 ? 4 : 6);
  drawPip(g, { y, sq, eyes: "happy", mouth: "open", la: s.k === 1 ? 0 : 28, hands });
  if (s.k === 1 && s.t > 0.35) { const r = 4 + s.t * 8; for (let i = 0; i < 4; i++) fx.star(g, 16 + Math.cos(i * 1.57 + 0.78) * r * 1.3, 15 + Math.sin(i * 1.57 + 0.78) * r, 1); }
  // Leaves rise rather than a number: the count belongs to the UI around Pip,
  // which knows the real figure.
  for (let i = 0; i < 3; i++) {
    const t = clamp((f - 5 - i * 4) / 24);
    if (f >= 5 + i * 4 && t < 1) {
      const x = 9 + i * 7 + wave(f + i * 5, 12, 1), y = 9 - t * 9;
      g.stamp((l) => l.ell(x, y, 1.8, 1.1, (nx, ny) => (ny > 0.2 ? "#1D7646" : "#6CC04A")).px(x - 1, y - 1, "#B9F0B4"), "#15281B");
    }
  }
}, 12);

def("goal", "Goal Met", "Celebrate", 48, "Today's reading goal is reached.", (g, f) => {
  const s = tl(f, [24, 12, 12]);
  if (s.k === 0) {
    const pump = s.n % 8 < 4;
    g.shadow(16, 6);
    const A = drawPip(g, { eyes: "determined", brows: "focus", mouth: "grin", sq: pump ? -0.05 : 0.05, la: pump ? 5 : 30, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0] + 1, y: pump ? A.cy - 9 : A.cy - 3 }] });
    if (pump) { fx.impact(g, A.handR[0] + 1, A.cy - 9); g.text("YES", 1, 2, GOLD); }
    return;
  }
  if (s.k === 1) {
    const y = 28 + hop(s.t, 6);
    g.shadow(16, 4);
    drawPip(g, { y, sq: -0.12, eyes: "happy", mouth: "open", la: 0, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 7 }, { x: A.handR[0] + 2, y: A.cy - 7 }] });
    for (let i = 0; i < 6; i++) fx.star(g, 16 + Math.cos(i * 1.05) * (6 + s.t * 7), 14 + Math.sin(i * 1.05) * (5 + s.t * 6), s.t < 0.5 ? 2 : 1);
    return;
  }
  g.shadow(16, 6);
  drawPip(g, { sq: 0.14 * (1 - s.t), eyes: "happy", mouth: "smile", blush: "big" });
  fx.twinkle(g, 4, 8, s.t); fx.twinkle(g, 28, 12, (s.t + 0.4) % 1);
}, 4);

def("levelup", "League Promotion", "Celebrate", 64, "You finish the week in the promotion zone.", (g, f) => {
  const s = tl(f, [8, 18, 10, 10, 18]);
  if (s.k >= 1) fx.confetti(g, f);
  if (s.k === 0) { g.shadow(16, 6); drawPip(g, { sq: 0.16 * s.t, eyes: "determined", mouth: "flat", la: 0 }); return; }
  if (s.k === 1 || s.k === 2) {
    const y = s.k === 1 ? 28 - 9 * eo(s.t) : 19 + 9 * ei(s.t);
    const n = s.k === 1 ? s.n : 18 + s.n;
    g.shadow(16, 3);
    g.xform((gg) => drawPip(gg, { y, leaf: "spin", lphase: n * 1.3, eyes: "happy", mouth: "open", fdx: n % 6 < 3 ? -1 : 1, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 2 }, { x: A.handR[0] + 1, y: A.cy - 2 }] }), { flip: n % 6 < 3, cx: 16 });
    return;
  }
  const crownY = s.k === 3 ? lerp(-6, 12.5, eo(s.t)) : 12.5;
  g.shadow(16, 6);
  drawPip(g, { sq: s.k === 3 && s.t > 0.8 ? 0.1 : 0, eyes: s.k === 4 ? "star" : "wide", mouth: "open", blush: "big", la: 0, over: (g, A) => prop.crown(g, A.top.x, crownY) });
  if (s.k === 4) { fx.twinkle(g, 5, 7, (s.n % 9) / 9); fx.twinkle(g, 27, 9, ((s.n + 4) % 9) / 9); g.text("UP", 1, 1, GOLD); }
}, 56);

def("onfire", "On Fire", "Celebrate", 24, "Your streak reaches 7 days, and the leaf stays lit.", (g, f) => {
  g.shadow(16, 6);
  for (let i = 0; i < 6; i++) {
    const t = ((f + i * 4) % 24) / 24, side = i % 2 ? 1 : -1;
    fx.ember(g, Math.round(16 + side * (9 + rnd(i) * 2) - side * t * 2), Math.round(28 - t * 18), t);
  }
  drawPip(g, { leaf: "flame", lphase: f * 0.9, eyes: "determined", brows: "angry", mouth: "grin", sq: wave(f, 12, 0.03), la: 0 });
});

def("champ", "Champion", "Celebrate", 48, "You finish first in your weekly league.", (g, f) => {
  const b = wave(f, 12, 1);
  fx.confetti(g, f, 12);
  g.shadow(16, 6);
  drawPip(g, { sq: -0.12, eyes: "happy", mouth: "open", blush: "big", la: 28 + wave(f, 12, 10), hands: (A) => [{ x: A.cx - 4, y: A.top.y - 4 + b }, { x: A.cx + 4, y: A.top.y - 4 + b }], over: (g, A) => prop.trophy(g, A.cx, A.top.y - 11 + b) });
  fx.twinkle(g, 25, 3, (f % 16) / 16); fx.twinkle(g, 6, 5, ((f + 8) % 16) / 16);
});

def("fireworks", "Fireworks", "Celebrate", 60, "A milestone: 100 days, 50 books, 1,000 hours.", (g, f) => {
  if (f < 10) for (let i = 0; i < 3; i++) g.px(25, 28 - f * 2 + i, i ? "#FFB400" : WHITE);
  fx.burst(g, 25, 8, (f - 10) / 22, PINK);
  if (f >= 24 && f < 34) for (let i = 0; i < 3; i++) g.px(7, 28 - (f - 24) * 2.2 + i, i ? "#FFB400" : WHITE);
  fx.burst(g, 7, 6, (f - 34) / 22, "#3AA0FF");
  const pop = (f >= 10 && f < 18) || (f >= 34 && f < 42);
  g.shadow(16, 6);
  drawPip(g, { y: pop ? 27 : 28, look: [f < 24 ? 1 : -1, -1], fdx: f < 24 ? 1 : -1, eyes: pop ? "star" : "open", mouth: pop ? "open" : "o", la: 28 });
}, 16);

def("lap", "Victory Lap", "Celebrate", 32, "Your weekly recap is ready.", (g, f) => {
  const x = -9 + (f / 32) * 50, step = f % 4 < 2;
  g.shadow(x, 5);
  if (step) fx.puff(g, x - 10, 29, 1.2);
  drawPip(g, {
    x, y: 28 - (step ? 1 : 0), lean: 2, fdx: 1, look: [1, 0], eyes: "happy", mouth: "open", la: -65 + wave(f, 4, 6),
    feet: (A) => [[A.cx - 3 + (step ? 2 : -2), A.bottom + 1.1 - (step ? 1 : 0)], [A.cx + 3 + (step ? -2 : 2), A.bottom + 1.1 - (step ? 0 : 1)]],
    hands: (A) => [{ x: A.handL[0] + (step ? 1.5 : -1.5), y: A.handL[1] - 1 }, { x: A.handR[0] + (step ? -1.5 : 1.5), y: A.handR[1] - 1 }]
  });
}, 16);

def("cheer", "Pom-pom Cheer", "Celebrate", 24, "A friend hits their goal and you send a cheer.", (g, f) => {
  const up = f % 12 < 6, j = up ? hop((f % 6) / 6, 2) : 0;
  g.shadow(16, 6);
  drawPip(g, { y: 28 + j, eyes: "happy", mouth: "open", la: 28 + (up ? -18 : 18), hands: (A) => [{ x: A.handL[0] - 1, y: up ? A.cy - 8 : A.cy + 3, k: "pom" }, { x: A.handR[0] + 1, y: up ? A.cy + 3 : A.cy - 8, k: "pom" }] });
  g.text("GO", up ? 1 : 24, 2, GOLD);
});

def("sunbathe", "Photosynthesis", "Celebrate", 48, "Leaves count up after a session. Reading is Pip's sunlight.", (g, f) => {
  g.stamp((l) => l.ell(3, 3, 3.4, 3.4, (nx, ny) => (nx + ny < -0.6 ? "#FFF6B0" : "#FFC53D")), "#7A4A00");
  fx.rays(g, 3, 3, 4.5, f * 0.08);
  for (let i = 0; i < 3; i++) { const t = ((f + i * 16) % 48) / 48; g.stamp((l) => l.px(lerp(7, 18, t), lerp(7, 11, t), "#FFF3A6"), "#7A4A00"); }
  g.shadow(16, 7);
  drawPip(g, { sq: 0.08, eyes: "shades", mouth: "smile", la: 20 + wave(f, 48, 6), ll: 1 + wave(f, 24, 0.08), hands: (A) => [{ x: A.cx - 5, y: A.top.y + 1 }, { x: A.cx + 5, y: A.top.y + 1 }] });
});

// ============================================================ DANCE
def("kick", "Toe Stand Kick", "Dance", 60, "Streak milestones: 10, 20, 30 days.", (g, f) => {
  const s = tl(f, [10, 8, 10, 12, 20]);
  const hat = (tilt, dy = 0) => (g, A) => prop.fedora(g, A.top.x, A.top.y + 2 + dy, tilt);
  let o = { leaf: "none", eyes: "half", mouth: "smirk", over: hat(0) };
  if (s.k === 0) Object.assign(o, { lean: 3 * eo(s.t), hands: (A) => [{ x: A.top.x - 5, y: A.top.y + 2 }, { x: A.handR[0] + 1, y: A.handR[1], k: "white" }] });
  if (s.k === 1) Object.assign(o, { lean: 1, y: 26 - s.t, sq: -0.08, mouth: "o", feet: (A) => [[A.cx - 2.5, A.bottom + 1.6, 1.3], [A.cx + 2.5, A.bottom + 1.6, 1.3]], hands: (A) => [{ x: A.handL[0], y: A.handL[1] - 2 }, { x: A.handR[0], y: A.handR[1] - 2, k: "white" }] });
  if (s.k === 2) Object.assign(o, { lean: -2, eyes: "squeeze", mouth: "o", feet: (A) => [[A.cx - 3, A.bottom + 1.1], [lerp(A.cx + 3.5, A.cx + 10, eo(Math.min(1, s.t * 2))), lerp(A.bottom + 1, A.cy + 2, eo(Math.min(1, s.t * 2)))]], hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 2 }, { x: A.handR[0], y: A.handR[1], k: "white" }] });
  if (s.k === 3) Object.assign(o, { lean: 1, over: hat(1, 0), hands: (A) => [{ x: A.top.x + 4, y: A.top.y }, { x: A.handR[0] + 2, y: A.handR[1] + 3, k: "white" }] });
  if (s.k === 4) Object.assign(o, { lean: 1.5, eyes: blink(s.n, 20, 14) ? "blink" : "half", hands: (A) => [{ x: A.handL[0] + 1, y: A.handL[1] + 1 }, { x: A.handR[0] + 1, y: A.top.y - 6, k: "white" }] });
  g.shadow(16, 6);
  drawPip(g, o);
  if (s.k === 2 && s.t > 0.4) { fx.star(g, 28, 22, 2); g.text("HEE", 19, 1, WHITE); }
  if (s.k === 4) { fx.twinkle(g, 29, 3, (s.n % 10) / 10, WHITE); fx.twinkle(g, 4, 10, ((s.n + 5) % 10) / 10, WHITE); }
}, 26);

def("moonwalk", "Moonwalk", "Dance", 48, "You finish a book faster than its estimate.", (g, f) => {
  const x = 42 - (f / 48) * 52, ph = f % 12 < 6;
  g.shadow(x, 5);
  for (let i = 1; i < 4; i++) g.px(x + 8 + i * 3, 30, "#FFFFFF" + (i === 1 ? "cc" : i === 2 ? "88" : "44"));
  drawPip(g, {
    x, fdx: 1, look: [1, 0], eyes: "half", mouth: "smirk", leaf: "none", lean: -1,
    over: (g, A) => prop.fedora(g, A.top.x, A.top.y + 2, 0),
    feet: (A) => (ph ? [[A.cx - 2, A.bottom + 1.1, 2.6], [A.cx + 3, A.bottom + 0.3, 1.5]] : [[A.cx - 2, A.bottom + 0.3, 1.5], [A.cx + 3, A.bottom + 1.1, 2.6]]),
    hands: (A) => [{ x: A.handL[0] + (ph ? 1 : 0), y: A.handL[1] }, { x: A.handR[0], y: A.handR[1] - 1, k: "white" }]
  });
}, 20);

def("robot", "The Robot", "Dance", 32, "Speed-reading mode switches on.", (g, f) => {
  const poses = [[0, 0, 0, 0], [0, -6, 0, 0], [0, -6, 0, -6], [3, 0, 0, -6], [3, 0, -3, 0], [0, 0, -3, 0], [0, -8, 0, 0], [0, 0, 0, -8]];
  const k = Math.floor(f / 4) % 8, [a, b, c, d] = poses[k];
  g.shadow(16, 6);
  drawPip(g, { x: 16 + (k % 2 ? 1 : 0), eyes: "robot", mouth: "flat", blush: false, la: [0, 45, -45, 0, 45, 0, -45, 0][k], hands: (A) => [{ x: A.handL[0] + a, y: A.handL[1] + b }, { x: A.handR[0] + c, y: A.handR[1] + d }] });
  if (k === 7) g.text("BEEP", 8, 1, "#7FE7FF");
});

def("floss", "Floss", "Dance", 12, "Any celebration that lands on a Friday.", (g, f) => {
  const t = f % 12, side = t < 6 ? lerp(-1, 1, t / 5) : lerp(1, -1, (t - 6) / 5), front = t < 6;
  const hs = (A) => [{ x: 16 + side * 8 - 2, y: A.cy + 4 }, { x: 16 + side * 8 + 2, y: A.cy + 3 }];
  g.shadow(16, 6);
  drawPip(g, {
    x: 16 - side * 1.5, eyes: "squeeze", mouth: "blep", la: -side * 35,
    behind: front ? null : (g, A) => hs(A).forEach((h) => drawHand(g, h)),
    hands: front ? hs : false
  });
});

def("disco", "Disco Point", "Dance", 32, "Your league week ends and you stayed in.", (g, f) => {
  const up = f % 16 < 8;
  for (let x = 0; x < 32; x += 4) g.rect(x, 30, 4, 2, ((x / 4 + Math.floor(f / 4)) % 3 === 0) ? "#FF4D6D" : ((x / 4 + Math.floor(f / 4)) % 3 === 1) ? "#3AA0FF" : "#FFB400");
  drawPip(g, {
    y: 28, lean: up ? 2 : -2, eyes: "happy", mouth: "open", la: up ? 15 : 60,
    hands: (A) => (up ? [{ x: A.handL[0] + 1, y: A.handL[1] + 1 }, { x: 27, y: 5 }] : [{ x: 4, y: 28 }, { x: A.handR[0] - 1, y: A.handR[1] + 1 }])
  });
  for (let i = 0; i < 4; i++) { const k = Math.floor(f / 3) + i * 5; fx.star(g, 2 + rnd(k) * 28, 2 + rnd(k + 1) * 14, 1, ["#FF4D6D", "#7FE7FF", GOLD, "#C79BFF"][i]); }
});

def("headspin", "Leaf Spin", "Stunts", 24, "You beat last week's total.", (g, f) => {
  for (let i = 0; i < 3; i++) { const a = f * 0.9 + i * 2.1; g.px(16 + Math.cos(a) * 12, 10 + Math.sin(a) * 3, "#FFFFFFbb"); g.px(16 + Math.cos(a + 0.2) * 12, 10 + Math.sin(a + 0.2) * 3, "#FFFFFF66"); }
  const kick = f % 6 < 3;
  g.xform((gg) => drawPip(gg, { la: 0, ll: 0.9, eyes: "happy", mouth: "open", fdx: kick ? -1 : 1, feet: (A) => [[A.cx - 4 - (kick ? 2 : 0), A.bottom + 1.5 + (kick ? 1 : 0)], [A.cx + 4 + (kick ? 0 : 2), A.bottom + 1.5 + (kick ? 0 : 1)]], hands: (A) => [{ x: A.handL[0] - 1, y: A.handL[1] + 3 }, { x: A.handR[0] + 1, y: A.handR[1] + 3 }] }), { rot: Math.PI, cx: 16, cy: 17.5, flip: kick });
  if (f % 4 < 2) fx.puff(g, 12, 30, 1.2); else fx.puff(g, 20, 30, 1.2);
});

def("airguitar", "Air Guitar", "Dance", 24, "You finish a book with a soundtrack in its bones.", (g, f) => {
  const bang = f % 8 < 4;
  g.shadow(16, 6);
  drawPip(g, {
    lean: bang ? 2 : -1, eyes: "squeeze", mouth: "shout", la: bang ? -40 : 50,
    hold: (g, A) => prop.guitar(g, A.cx - 4, A.cy + 4),
    hands: (A) => [{ x: A.cx + 5, y: A.cy - 2 }, { x: A.cx - 3, y: A.cy + 3 + (bang ? 1 : -1) }]
  });
  if (bang) fx.bolt(g, 3, 1);
  fx.note(g, 25 + (f % 8) * 0.3, 8 - (f % 12) * 0.5);
});

def("tapdance", "Happy Feet", "Dance", 16, "You hit your goal before lunch.", (g, f) => {
  const a = f % 4 < 2;
  g.shadow(16, 6);
  drawPip(g, { y: 28 - (f % 8 < 4 ? 0.5 : 0), eyes: "happy", mouth: "smile", la: a ? 10 : 45, feet: (A) => [[A.cx - 3.5, A.bottom + 1.1 - (a ? 1.2 : 0)], [A.cx + 3.5, A.bottom + 1.1 - (a ? 0 : 1.2)]], hands: (A) => [{ x: A.handL[0] - 1, y: A.handL[1] - (a ? 1 : 0) }, { x: A.handR[0] + 1, y: A.handR[1] - (a ? 0 : 1) }] });
  g.px(a ? 11 : 20, 31, WHITE).px(a ? 10 : 21, 30, WHITE);
  fx.note(g, 25, 5 + (f % 8) * 0.4, "#FF4D6D");
  fx.note(g, 3, 9 - (f % 8) * 0.4);
});

// ============================================================ SPORTS
def("cycling", "Tour de Page", "Sports", 24, "Your weekly page count crosses a new distance.", (g, f) => {
  for (let i = 0; i < 4; i++) { const x = 31 - ((f * 3 + i * 9) % 36); g.rect(x, 31, 4, 1, "#8A8F99"); }
  for (let i = 0; i < 3; i++) fx.speed(g, (f * 2 + i * 7) % 8 - 2, 12 + i * 4, 3);
  const b = prop.bike(g, f * 0.52, 17);
  drawPip(g, {
    x: 13.5, y: 20.5, w: 6.4, h: 5.5, lean: 1.8, fdx: 1, look: [1, 0], eyes: "determined", brows: "focus", mouth: "open", la: -75 + wave(f, 6, 8),
    feet: () => [[b.p1[0], b.p1[1], 1.8], [b.p2[0], b.p2[1], 1.8]],
    hands: () => [{ x: b.bar[0] - 1.5, y: b.bar[1] + 0.5 }, { x: b.bar[0] + 0.5, y: b.bar[1] + 0.5 }]
  });
  if (f % 12 < 6) fx.drop(g, 9, 10 - (f % 6) * 0.5, SKY);
});

def("boxing", "Heavyweight", "Sports", 48, 'A friend passes you on the board. Pip asks for a rematch.', (g, f) => {
  const s = tl(f, [10, 4, 4, 4, 4, 6, 8, 8]);
  const guard = (A) => [{ x: A.cx - 8, y: A.cy + 2, k: "glove" }, { x: A.cx + 8, y: A.cy + 1, k: "glove" }];
  let hands = guard, x = 16 + wave(f, 10, 1.3), sq = wave(f, 5, 0.04), lean = wave(f, 10, 1);
  if (s.k === 1 || s.k === 3) hands = (A) => [{ x: A.cx - 8, y: A.cy + 2, k: "glove" }, { x: A.cx + 8 + 5 * eo(s.t), y: A.cy + 1, k: "glove" }];
  if (s.k === 5) { sq = -0.15 * eo(s.t); lean = 1; hands = (A) => [{ x: lerp(A.cx - 8, A.cx - 7, eo(s.t)), y: lerp(A.cy + 3, A.top.y - 3, eo(s.t)), k: "glove" }, { x: A.cx + 8, y: A.cy + 1, k: "glove" }]; }
  if (s.k === 6) { sq = -0.12; lean = 1; hands = (A) => [{ x: A.cx - 7, y: A.top.y - 3, k: "glove" }, { x: A.cx + 8, y: A.cy + 1, k: "glove" }]; }
  g.shadow(16, 6);
  drawPip(g, { x, sq, lean, eyes: "determined", brows: "angry", mouth: "grit", la: -20 + wave(f, 10, 15), hands });
  if ((s.k === 1 || s.k === 3) && s.t > 0.5) fx.star(g, 30, 20, 2);
  if (s.k === 6) g.text("POW", 1, 1, GOLD);
  if (s.k === 2 || s.k === 4) fx.drop(g, 6, 14 - s.n, SKY);
}, 28);

def("press", "Book Press", "Sports", 48, "You finish a book over 500 pages.", (g, f) => {
  const s = tl(f, [8, 16, 10, 6, 8]);
  let barY = 27, bend = 0, o = { eyes: "determined", brows: "focus", mouth: "grit" };
  if (s.k === 0) { o.sq = 0.14 * s.t; barY = 27; }
  if (s.k === 1) { barY = lerp(27, 9, eio(s.t)); bend = 2; o = { sq: 0.12 - 0.2 * s.t, x: 16 + (rnd(f) - 0.5) * 1.2, eyes: "squeeze", mouth: "grit", blush: "big", la: 0 }; }
  if (s.k === 2) { barY = 9; bend = 1; o = { sq: -0.08, eyes: "happy", mouth: "open", la: 0, ll: 1.1 }; }
  if (s.k === 3) { barY = lerp(9, 27, ei(s.t)); bend = -1; o = { sq: 0.1, eyes: "wide", mouth: "o" }; }
  if (s.k === 4) { barY = 27; o = { eyes: "happy", mouth: "smile", la: 28 }; }
  g.shadow(16, 6);
  const lift = s.k === 1 || s.k === 2;
  drawPip(g, Object.assign(o, { hands: s.k === 4 ? null : () => [{ x: 11, y: barY + 1 }, { x: 21, y: barY + 1 }] }));
  prop.barbell(g, 16, barY, bend);
  if (s.k === 1) fx.drop(g, 5, 14 + (s.n % 6), SKY);
  if (s.k === 3 && s.t > 0.8) { fx.puff(g, 4, 29, 1.6); fx.puff(g, 28, 29, 1.6); }
  if (lift && s.k === 2) g.text("!", 28, 2, GOLD);
}, 30);

def("jog", "Warm-up Jog", "Sports", 16, "A focus session starts.", (g, f) => {
  const a = f % 8 < 4;
  g.shadow(16, 6);
  drawPip(g, {
    y: 28 - (f % 4 < 2 ? 1 : 0), eyes: "determined", mouth: "o", la: 28 + wave(f, 8, 14),
    feet: (A) => [[A.cx - 3, A.bottom + 1.1 - (a ? 1.4 : 0)], [A.cx + 3, A.bottom + 1.1 - (a ? 0 : 1.4)]],
    hands: (A) => [{ x: A.handL[0] + (a ? 1 : 0), y: A.handL[1] - (a ? 2 : 0) }, { x: A.handR[0] - (a ? 0 : 1), y: A.handR[1] - (a ? 0 : 2) }],
    over: (g, A) => g.rect(Math.round(A.cx - A.rx + 1), Math.round(A.top.y + 2), Math.round(A.rx * 2 - 2), 1, "#E0393E")
  });
});

def("tree", "Tree Pose", "Sports", 48, "Break reminder: a slow, calm minute.", (g, f) => {
  for (let i = 0; i < 3; i++) { const t = ((f + i * 16) % 48) / 48; g.stamp((l) => l.px(4 + i * 11 + wave(f + i * 9, 24, 1.5), 28 - t * 26, "#A2E477"), "#2E6B33"); }
  g.shadow(16, 5);
  drawPip(g, {
    lean: wave(f, 48, 0.7), eyes: "closed", mouth: "smile", la: 0, ll: 1.05,
    feet: (A) => [[A.cx, A.bottom + 1.1], [A.cx - A.rx + 1, A.cy + 3, 1.6]],
    hands: (A) => [{ x: A.top.x - 1.5, y: A.top.y - 7 }, { x: A.top.x + 1.5, y: A.top.y - 7 }]
  });
});

def("kickflip", "Kickflip", "Stunts", 36, "Seven days in a row without missing your goal.", (g, f) => {
  const s = tl(f, [10, 4, 12, 4, 6]);
  let y = 28 - 2, bx = 16, by = 29, flip = 0, sq = 0;
  if (s.k === 0) { bx = lerp(4, 16, s.t); }
  if (s.k === 1) sq = 0.14;
  if (s.k === 2) { y = 26 + hop(s.t, 9); by = 29 + hop(s.t, 8); flip = s.t * TAU; sq = -0.08; }
  if (s.k === 3) sq = 0.16;
  if (s.k === 4) bx = 16 + s.t * 3;
  g.shadow(bx, 7);
  drawPip(g, { x: bx, y, sq, eyes: s.k === 2 ? "happy" : "determined", mouth: s.k === 2 ? "open" : "smirk", la: s.k === 2 ? 0 : -30, feet: (A) => [[A.cx - 3.5, A.bottom + 1.1], [A.cx + 3.5, A.bottom + 1.1]] });
  prop.board(g, bx, Math.round(by), flip);
  if (s.k === 4) fx.twinkle(g, 27, 12, s.t);
}, 22);

def("rope", "Skip Rope", "Sports", 16, "Three sessions in one day.", (g, f) => {
  const th = (f / 16) * TAU, below = Math.cos(th) > 0.55, front = Math.sin(th) > 0;
  const y = below ? 26 : 28;
  const rope = (gg, A) => {
    const ry = A.cy + Math.cos(th) * 12;
    for (let i = 0; i <= 20; i++) { const t = i / 20; const x = lerp(A.handL[0], A.handR[0], t); const yy = lerp(A.handL[1], A.handR[1], t) + (ry - A.handL[1]) * Math.sin(Math.PI * t); gg.px(x, yy, "#C8453B"); }
  };
  g.shadow(16, below ? 5 : 6);
  drawPip(g, { y, sq: below ? -0.08 : 0.06, eyes: "happy", mouth: "open", la: 28 + wave(f, 16, 10), behind: front ? null : rope, over: front ? rope : null });
});

def("surf", "Binge Wave", "Sports", 32, "You read more than twice your goal in a day.", (g, f) => {
  for (let x = 0; x < 32; x++) {
    const h = 28 + Math.round(Math.sin((x + f) * 0.35) * 1.3);
    for (let y = h; y < 32; y++) g.px(x, y, y === h ? "#E6F6FF" : y === h + 1 ? "#5AB8FF" : "#2F8FE6");
  }
  const tilt = wave(f, 16, 1.5);
  drawPip(g, { y: 24 + wave(f, 16, 0.8), lean: tilt, eyes: "happy", mouth: "open", la: -50, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 1 + tilt }, { x: A.handR[0] + 2, y: A.cy - 1 - tilt }], feet: (A) => [[A.cx - 3, A.bottom + 0.5], [A.cx + 3, A.bottom + 0.5]] });
  prop.closedBook(g, 8, Math.round(25.5 + wave(f, 16, 0.8)), 16, 2, "#C8453B");
});

// ============================================================ COACH
def("lockin", "Lock In", "Coach", 72, "Mid-session, the page hasn't moved for 3 minutes.", (g, f) => {
  const s = tl(f, [10, 12, 6, 30, 14]);
  const grow = s.k === 0 ? eo(s.t) : s.k === 4 ? 1 - eio(s.t) : 1;
  const w = 8 + 2.2 * grow, h = 7 + 2 * grow, y = 28 + 3 * grow;
  let o = { w, h, y, eyes: "open", mouth: "smile", la: 28 };
  if (s.k === 1) {
    const knock = s.n % 6 < 3;
    Object.assign(o, { eyes: "determined", brows: "focus", mouth: "flat", hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + 4, y: A.cy + (knock ? 0 : 1), r: 2.4 }] });
    g.shadow(16, 8);
    const A = drawPip(g, o);
    if (knock) fx.impact(g, A.cx + 4, A.cy);
    return;
  }
  if (s.k === 2) Object.assign(o, { eyes: "determined", brows: "focus", mouth: "flat" });
  if (s.k === 3) Object.assign(o, { eyes: "determined", brows: "focus", mouth: "smirk", la: 0, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + 2, y: A.cy + 4, r: 2.6 }] });
  if (s.k === 4) Object.assign(o, { eyes: "happy", mouth: "smile", sq: wave(s.n, 7, 0.06) });
  g.shadow(16, 6 + 2 * grow);
  drawPip(g, o);
  if (s.k === 3) g.text(s.n < 15 ? "LOCK" : "IN", s.n < 15 ? 1 : 1, 1, WHITE);
}, 40);

def("hydrate", "Hydrate", "Coach", 48, "Every 50 minutes of reading.", (g, f) => {
  const s = tl(f, [8, 18, 8, 14]);
  const lvl = s.k === 0 ? 1 : s.k === 1 ? lerp(1, 0.2, s.t) : 0.2;
  let o = { eyes: "open", mouth: "smile", la: 40 };
  let gx = 24, gy = 22;
  if (s.k === 0) { gx = lerp(24, 20, s.t); gy = lerp(22, 19, s.t); }
  if (s.k === 1) { gx = 20; gy = 19; o = { eyes: "closed", mouth: "o", la: 40 - s.t * 20 }; }
  if (s.k === 2) { gx = lerp(20, 24, s.t); gy = lerp(19, 22, s.t); o = { eyes: "happy", mouth: "open", la: 10 }; }
  if (s.k === 3) { o = { eyes: "happy", mouth: "smile", la: 0, ll: 1.18, blush: "big" }; }
  g.shadow(16, 6);
  drawPip(g, Object.assign(o, { hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: gx + 1, y: gy + 5 }] }));
  prop.glass(g, gx, gy, lvl, s.k === 1);
  if (s.k === 1 && s.n % 4 < 2) g.px(gx + 1, gy + 3 - (s.n % 3), WHITE);
  if (s.k === 3) { fx.twinkle(g, 25, 5, s.t, "#9FD6FF"); g.text("AHH", 1, 1, SKY); }
}, 40);

def("alarm", "Streak Alarm", "Coach", 24, "Your streak ends at midnight and today is still empty.", (g, f) => {
  prop.clock(g, 5, 25, f);
  const a = f % 4 < 2;
  g.shadow(19, 6);
  const A = drawPip(g, {
    x: 19, y: 28 - (a ? 1 : 0), eyes: "wide", mouth: "shout", brows: "up", la: wave(f, 4, 45),
    feet: (A) => [[A.cx - 3, A.bottom + 1.1 - (a ? 1.2 : 0)], [A.cx + 3, A.bottom + 1.1 - (a ? 0 : 1.2)]],
    hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 5 + (a ? 1 : 0) }, { x: A.handR[0] + 1, y: A.cy - 5 + (a ? 0 : 1) }]
  });
  fx.drop(g, a ? 10 : 29, 12 + (f % 6), SKY);
  if (f % 8 < 4) g.text("!!", 22, 1, RED);
});

def("whistle", "Coach Whistle", "Coach", 36, "A focus session is about to start.", (g, f) => {
  const s = tl(f, [10, 14, 12]);
  const puff = s.k === 1;
  g.shadow(16, 6);
  const A = drawPip(g, {
    w: puff ? 8.6 : 8, sq: s.k === 0 ? -0.1 * s.t : 0, eyes: puff ? "squeeze" : "determined", mouth: "whistle", mouthDx: 1, blush: puff ? "big" : true, la: puff ? -10 : 28,
    hands: (A) => (s.k === 2 ? [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0] + 4, y: A.cy }] : null),
    over: (g, A) => prop.whistle(g, A.fc + 2, A.ey + 3)
  });
  if (puff && s.n % 4 < 3) { g.line(A.fc + 7, A.ey + 1, A.fc + 9, A.ey - 1, WHITE).line(A.fc + 7, A.ey + 4, A.fc + 10, A.ey + 4, WHITE).line(A.fc + 7, A.ey + 6, A.fc + 9, A.ey + 8, WHITE); g.text("!", 28, 12, GOLD); }
}, 18);

def("kudos", "Kudos", "Coach", 36, "A friend sends you kudos on a session.", (g, f) => {
  g.shadow(16, 6);
  drawPip(g, { eyes: "happy", mouth: "smile", blush: "big", la: 28 + wave(f, 18, 8), hands: (A) => [{ x: A.cx - 2.5, y: A.top.y - 2 }, { x: A.cx + 2.5, y: A.top.y - 2 }] });
  for (let i = 0; i < 3; i++) { const t = ((f + i * 12) % 36) / 36; fx.heart(g, 16 + Math.sin(t * 6 + i * 2) * (4 + t * 8), 10 - t * 10, i === 0 && t < 0.5); }
});

def("bringit", "Bring It", "Coach", 36, "You send a friend a weekly challenge.", (g, f) => {
  const c = f % 12 < 6;
  g.shadow(16, 6);
  const A = drawPip(g, { lean: 1, eyes: "determined", brows: "angry", mouth: "smirk", la: 28 + (c ? -8 : 8), hands: (A) => [{ x: A.handL[0] + 1, y: A.handL[1] + 1 }, { x: A.handR[0] + (c ? 2.5 : 1), y: A.cy - (c ? 1 : 0) }] });
  if (f % 18 < 4) fx.star(g, A.fc + 3, A.ey - 2, 1, WHITE);
});

def("idea", "Lightbulb", "Coach", 40, "Pip has a tip: a better reading time, a book to resume.", (g, f) => {
  const s = tl(f, [10, 6, 4, 20]);
  const on = s.k === 3 || (s.k === 2 && s.n % 2 === 0);
  const leaf = s.k === 0 ? "leaf" : "bulb";
  g.shadow(16, 6);
  const A = drawPip(g, {
    leaf, bulbOn: on, la: s.k === 0 ? 20 : 0, look: s.k === 0 ? [1, -1] : [0, -1], eyes: s.k === 3 ? "wide" : "open", mouth: s.k === 3 ? "open" : "flat",
    hands: (A) => (s.k === 0 ? [{ x: A.handL[0], y: A.handL[1] }, { x: A.fc + 3, y: A.ey + 5 }] : s.k === 3 ? [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0] + 1, y: A.top.y - 3 }] : null)
  });
  if (s.k === 0) g.text("?", 25, 4, WHITE);
  if (s.k === 3) fx.rays(g, A.top.x, A.top.y - 6, 4, s.n * 0.15, "#FFE55C");
}, 30);

def("countdown", "3, 2, 1, Go", "Coach", 48, "A focus session begins.", (g, f) => {
  const s = tl(f, [12, 12, 12, 12]);
  const label = ["3", "2", "1", "GO"][s.k];
  const go = s.k === 3;
  g.shadow(16, 6);
  drawPip(g, { y: go ? 28 + hop(s.t, 4) : 28, sq: go ? -0.1 : s.n < 2 ? 0.08 : 0, eyes: go ? "happy" : "determined", mouth: go ? "open" : "flat", la: go ? 0 : 28 });
  const w = g.textWidth(label, 2);
  g.text(label, Math.round(16 - w / 2), 0, go ? GOLD : WHITE, 2);
}, 36);

def("backup", "Backup Beam", "Coach", 48, "Your library finishes backing up to Google Drive.", (g, f) => {
  const s = tl(f, [10, 16, 22]);
  fx.cloud(g, 16, 3, 8, "#DDE7F5");
  if (s.k === 1) for (let y = 6; y < 30; y++) if ((y + s.n) % 3) g.px(12 + (y % 2), y, "#FFF3A6aa").px(20 - (y % 2), y, "#FFF3A6aa");
  const lift = s.k === 1 ? -3 * eio(s.t) : s.k === 2 ? -3 + 3 * eo(Math.min(1, s.t * 2)) : 0;
  g.shadow(16, 6);
  drawPip(g, { y: 28 + lift, eyes: s.k === 1 ? "closed" : s.k === 2 ? "happy" : "open", mouth: s.k === 2 ? "open" : "o", la: s.k === 1 ? 0 : 28, look: [0, s.k === 0 ? -1 : 0] });
  if (s.k === 2) { g.stamp((l) => l.line(22, 11, 24, 13, "#1FBF6A").line(24, 13, 28, 8, "#1FBF6A"), "#0B3B20"); fx.twinkle(g, 5, 12, s.t); }
}, 36);

// ============================================================ DRAMA
def("streaklost", "Comeback Arc", "Drama", 84, "A streak breaks. Pip mourns, briefly, then rallies.", (g, f) => {
  const s = tl(f, [8, 12, 26, 18, 20]);
  let o = {};
  if (s.k === 0) o = { eyes: "wide", mouth: "o", la: 0 };
  if (s.k === 1) o = { eyes: "sad", brows: "sad", mouth: "frown", la: lerp(0, 140, s.t), sq: 0.08 * s.t };
  if (s.k === 2) o = { eyes: "teary", brows: "sad", mouth: "frown", la: 140 + wave(s.n, 8, 5), sq: 0.12 };
  if (s.k === 3) o = { eyes: "open", look: [0, -1], mouth: "o", la: lerp(140, 30, eo(s.t)), sq: lerp(0.12, 0, s.t) };
  if (s.k === 4) o = { y: 28 + hop(clamp(s.t * 2), 3), eyes: "determined", brows: "focus", mouth: "smile", la: 0 };
  const cw = s.k === 1 ? 8 * eo(s.t) : s.k === 2 ? 8 : s.k === 3 ? 8 : 0;
  const cx = s.k === 3 ? lerp(16, 42, ei(s.t)) : 16;
  if (s.k === 3 || s.k === 4) {
    const sun = s.k === 3 ? eo(s.t) : 1;
    g.stamp((l) => l.ell(6, lerp(-4, 4, sun), 3, 3, "#FFC53D"), "#7A4A00");
    fx.rays(g, 6, lerp(-4, 4, sun), 4, f * 0.1);
  }
  g.shadow(16, 6);
  drawPip(g, o);
  if (cw > 0) { fx.cloud(g, cx, 5, cw); if (s.k === 2) fx.rain(g, 10, 22, 9, 26, s.n); }
  if (s.k === 4 && s.n > 8) g.text("DAY 1", 1, 25, GOLD);
}, 40);

def("faint", "Dramatic Faint", "Drama", 84, "A friend overtakes you by a mile. Pip takes it personally.", (g, f) => {
  const s = tl(f, [10, 8, 8, 22, 10, 26]);
  let rot = 0, lie = 0;
  const pose = (o) => g.xform((gg) => drawPip(gg, o), { rot, cx: 16, cy: 30, dx: 9 * lie, dy: -7 * lie });
  if (s.k === 0) { g.shadow(16, 6); drawPip(g, { lean: -1 * s.t, eyes: "closed", mouth: "o", brows: "sad", la: 60, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.top.x + 4, y: A.top.y + 3 }] }); return; }
  if (s.k === 1) { g.shadow(16, 6); drawPip(g, { lean: -1 + wave(s.n, 4, 1), eyes: "closed", mouth: "o", la: 80, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.top.x + 4, y: A.top.y + 3 }] }); return; }
  if (s.k === 2) { lie = eo(s.t); rot = -lie * Math.PI / 2; g.shadow(16 + 4 * lie, 6 + 3 * lie); pose({ eyes: "closed", mouth: "o", la: 80 }); return; }
  if (s.k === 3 || s.k === 4) {
    rot = -Math.PI / 2; lie = 1;
    g.shadow(20, 9);
    pose({ eyes: "x", mouth: "wavy", la: 120 });
    const gy = s.k === 3 ? lerp(0, -12, eo(s.t)) : lerp(-12, 0, ei(s.t));
    g.xform((gg) => drawPip(gg, { w: 6, h: 5.4, eyes: "closed", mouth: "o", la: 0, feet: false, hands: false, blush: false }), { dy: gy - 8, dx: 2, tint: (c) => (c === g.S.ink || c === g.S.outline ? "#3A4460" : "#EAF2FFaa") });
    if (s.k === 3 && s.n > 10) g.text("BYE", 20, 1, WHITE);
    return;
  }
  lie = 1 - back(clamp(s.t * 1.8));
  rot = -Math.PI / 2 * lie;
  g.shadow(16 + 4 * clamp(lie), 6);
  pose({ eyes: s.t < 0.5 ? "spiral" : "open", eyePhase: s.n, mouth: s.t < 0.5 ? "wavy" : "smile", la: 28 });
  if (s.t > 0.6) fx.twinkle(g, 26, 10, s.t);
}, 44);

def("jumpscare", "Out of Its Skin", "Drama", 52, "You jump three places in the league overnight.", (g, f) => {
  const s = tl(f, [10, 2, 10, 16, 14]);
  if (s.k === 0 || s.k === 1) { g.shadow(16, 6); drawPip(g, { eyes: s.k === 1 ? "wide" : "open", mouth: s.k === 1 ? "o" : "smile", la: 28 }); return; }
  if (s.k === 2) {
    g.shadow(16, 6);
    drawLeafOnly(g, { la: 0 });
    drawPip(g, { y: 28 - 40 * ei(s.t), sq: -0.25, eyes: "wide", mouth: "shout", brows: "up", leaf: "none" });
    g.text("!", 15, 1, GOLD);
    return;
  }
  const leafY = s.k === 3 ? 12 + ei(s.t) * 5 : 17;
  const drift = wave(f, 8, 2);
  if (s.k === 3) {
    g.shadow(16, 3);
    drawLeafOnly(g, { x: 16 + drift, y: 28 + (leafY - 12), la: drift * 12 });
    return;
  }
  const land = eo(clamp(s.t * 2));
  g.shadow(16, 6);
  drawPip(g, { y: lerp(-14, 28, land), sq: s.t > 0.45 && s.t < 0.7 ? 0.22 : 0, eyes: s.t > 0.7 ? "happy" : "wide", mouth: s.t > 0.7 ? "smile" : "o", blush: s.t > 0.7 ? "big" : true, la: 28 });
}, 6);

def("steamed", "Steamed", "Drama", 24, "You come back from another app mid-session. Pip is mad at the app.", (g, f) => {
  const a = f % 6 < 3;
  g.shadow(16, 6);
  const A = drawPip(g, {
    colors: { base: "#E26A4A", shade: "#A83A2A", light: "#FF9D7A", belly: "#FFB49A", hi: "#FFE3D6" },
    eyes: "angry", brows: "angry", mouth: "grit", la: wave(f, 3, 6), x: 16 + (a ? 0.5 : -0.5),
    feet: (A) => [[A.cx - 3.5, A.bottom + 1.1 - (a ? 1.2 : 0)], [A.cx + 3.5, A.bottom + 1.1 - (a ? 0 : 1.2)]]
  });
  for (const side of [-1, 1]) { const t = ((f + (side > 0 ? 12 : 0)) % 24) / 24; fx.puff(g, A.cx + side * (8 + t * 3), A.top.y + 2 - t * 10, 1 + t * 1.2, WHITE); }
  if (f % 12 < 6) g.text("GRR", 10, 1, RED);
});

def("swat", "Shoo", "Coach", 30, "You reach for the exit mid focus session. Pip swats the cursor away.", (g, f) => {
  // A rolled-up newspaper, cocked behind Pip's head and swung out to the right,
  // where the cursor was heading. Wind-up, a snap swing, a held follow-through,
  // then a smug lowering of the paper. No lettering, so the reader can mirror
  // it to swing left; the speech bubble says "shoo".
  const s = tl(f, [8, 3, 9, 10]);
  const ang = s.k === 0 ? lerp(-55, -100, eo(s.t)) : s.k === 1 ? lerp(-100, 4, ei(s.t)) : s.k === 2 ? 4 : lerp(4, 70, eio(s.t));
  const rad = (ang * Math.PI) / 180;
  const paper = (g, A) => {
    const px = A.cx + 4, py = A.cy - 1;
    const ux = Math.cos(rad), uy = Math.sin(rad);
    const x0 = px + ux * 3, y0 = py + uy * 3, x1 = px + ux * 14, y1 = py + uy * 14;
    g.stamp((l) => {
      l.line(x0, y0, x1, y1, "#F4F1E8").line(x0 - uy, y0 + ux, x1 - uy, y1 + ux, "#D8D2C2");
      const bx = lerp(x0, x1, 0.6), by = lerp(y0, y1, 0.6);
      l.line(bx, by, bx - uy, by + ux, "#C8453B");
    }, "#3A3528");
  };
  g.shadow(16, 6);
  const A = drawPip(g, {
    lean: s.k === 0 ? -1 : s.k <= 2 ? 1 : 0,
    x: 15 + (s.k === 1 || s.k === 2 ? 1 : 0),
    eyes: s.k === 3 ? "happy" : "determined", brows: s.k === 3 ? undefined : "angry",
    mouth: s.k === 2 ? "shout" : s.k === 3 ? "smirk" : "flat",
    la: s.k === 1 ? -30 : s.k === 2 ? -20 : 20,
    sq: s.k === 0 ? -0.06 * s.t : s.k === 1 ? 0.08 : 0,
    behind: s.k === 0 ? paper : undefined,
    hands: (A) => [
      { x: A.handL[0] + (s.k === 2 ? 1 : 0), y: A.handL[1] },
      { x: A.cx + 4 + Math.cos(rad) * 3, y: A.cy - 1 + Math.sin(rad) * 3 }
    ],
    over: s.k === 0 ? undefined : paper
  });
  if (s.k === 1) {
    for (let i = 1; i <= 3; i++) {
      const a = rad - i * 0.32;
      g.line(A.cx + 4 + Math.cos(a) * 11, A.cy - 1 + Math.sin(a) * 11, A.cx + 4 + Math.cos(a) * 14, A.cy - 1 + Math.sin(a) * 14, WHITE);
    }
  }
  if (s.k === 2) {
    fx.impact(g, 30, A.cy);
    if (s.n < 3) fx.star(g, 30, A.cy - 1, 1, WHITE);
  }
  if (s.k === 3 && s.n % 4 < 2) fx.puff(g, 27, A.cy + 6, 1, WHITE);
}, 12);

def("dizzy", "Dizzy", "Drama", 24, "Smart Read goes past 700 words per minute.", (g, f) => {
  const stars = (front) => (g, A) => {
    for (let i = 0; i < 3; i++) {
      const a = f * 0.5 + (i * TAU) / 3;
      if ((Math.sin(a) > 0) === front) fx.star(g, A.cx + Math.cos(a) * 9, A.top.y - 1 + Math.sin(a) * 2.5, 1);
    }
  };
  g.shadow(16, 6);
  g.xform((gg) => drawPip(gg, { eyes: "spiral", eyePhase: f, mouth: "wavy", la: 60 + wave(f, 12, 30), behind: stars(false), over: stars(true) }), { cx: 16, cy: 30, rot: wave(f, 24, 0.14) });
});

def("dizzywalk", "Dizzy Stagger", "Drama", 24, "You spun or shook Pip too much; it staggers about until the room stops turning.", (g, f) => {
  const a = f % 8 < 4;
  const stars = (front) => (g, A) => {
    for (let i = 0; i < 2; i++) {
      const s = f * 0.5 + i * Math.PI;
      if ((Math.sin(s) > 0) === front) fx.star(g, A.cx + Math.cos(s) * 8, A.top.y - 1 + Math.sin(s) * 2, 1);
    }
  };
  g.shadow(16 + wave(f, 24, 1), 6);
  g.xform(
    (gg) =>
      drawPip(gg, {
        y: 28 - (f % 4 < 2 ? 0 : 0.6), fdx: 1, eyes: "spiral", eyePhase: f, mouth: "wavy", la: 40 + wave(f, 12, 26),
        feet: (A) => [[A.cx - 3 + (a ? 1.8 : -1.2), A.bottom + 1.1 - (a ? 0.9 : 0)], [A.cx + 3 + (a ? -1.2 : 1.8), A.bottom + 1.1 - (a ? 0 : 0.9)]],
        hands: (A) => [{ x: A.handL[0] - 1, y: A.handL[1] - (a ? 2 : 0) }, { x: A.handR[0] + 1, y: A.handR[1] - (a ? 0 : 2) }],
        behind: stars(false), over: stars(true)
      }),
    { cx: 16, cy: 30, rot: wave(f, 24, 0.2) }
  );
});

def("smitten", "Smitten", "Drama", 24, "You rate a book five leaves.", (g, f) => {
  const big = f % 12 < 6;
  g.shadow(16, 6);
  drawPip(g, { lean: wave(f, 24, 1), eyes: big ? "heartBig" : "heart", mouth: "smile", blush: "big", la: 28 + wave(f, 24, 10), leafColor: "#FF7AA2", leafShade: "#D94F7C", hands: (A) => [{ x: A.fc - 7, y: A.ey + 3 }, { x: A.fc + 7, y: A.ey + 3 }] });
  for (let i = 0; i < 2; i++) { const t = ((f + i * 12) % 24) / 24; fx.heart(g, 6 + i * 20 + wave(f + i * 7, 12, 1.5), 16 - t * 16, false); }
});

def("nervous", "Nervous Sweat", "Drama", 24, "Last day of the league week, and you're in the demotion zone.", (g, f) => {
  g.shadow(16, 6);
  const A = drawPip(g, { x: 16 + (rnd(f) - 0.5) * 0.9, eyes: "open", look: [f % 8 < 4 ? -1 : 1, 0], brows: "sad", mouth: "wavy", la: 20 + (rnd(f + 3) - 0.5) * 16, hands: (A) => [{ x: A.fc - 2, y: A.ey + 6 }, { x: A.fc + 2, y: A.ey + 6 }] });
  fx.drop(g, A.cx + 7, A.top.y + 3 + (f % 12) * 0.6, SKY);
  if (f % 12 > 5) fx.drop(g, A.cx - 8, A.top.y + 5 + (f % 6), SKY);
});

def("melt", "Melt", "Drama", 72, "You've been away from reading for a week.", (g, f) => {
  const s = tl(f, [10, 20, 12, 16, 14]);
  let sq = 0, eyes = "open", mouth = "wavy", la = 28, x = 16;
  if (s.k === 0) { sq = wave(s.n, 5, 0.03); eyes = "half"; }
  if (s.k === 1) { sq = 0.65 * eio(s.t); eyes = "half"; la = lerp(28, 100, s.t); }
  if (s.k === 2) { sq = 0.65 + wave(s.n, 12, 0.03); eyes = "half"; la = 100; }
  if (s.k === 3) { sq = 0.65 * (1 - back(s.t)); eyes = s.t > 0.5 ? "wide" : "half"; mouth = "o"; la = lerp(100, 0, s.t); }
  if (s.k === 4) { sq = wave(s.n, 4, 0.05) * (1 - s.t); eyes = "happy"; mouth = "smile"; x = 16 + wave(s.n, 4, 0.7) * (1 - s.t); }
  g.shadow(16, 6 + sq * 6);
  drawPip(g, { x, sq, eyes, mouth, la, hands: sq > 0.4 ? false : null });
  if (s.k === 1 || s.k === 2) for (let i = 0; i < 2; i++) g.px(10 + i * 11, 29 + ((s.n + i * 3) % 3), "#6CC04A");
  if (s.k === 4) for (let i = 0; i < 4; i++) fx.drop(g, 16 + Math.cos(i * 1.6) * (8 + s.t * 6), 18 - s.t * 8 + i, "#A2E477");
}, 40);

def("ghost", "Boo", "Drama", 32, "Private mode on. Nobody can see you reading.", (g, f) => {
  const y = 25 + wave(f, 32, 2);
  g.xform((gg) => drawPip(gg, { y, eyes: "open", mouth: "o", la: 28 + wave(f, 16, 12), feet: false, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 3 + wave(f, 8, 1) }, { x: A.handR[0] + 1, y: A.cy - 3 - wave(f, 8, 1) }] }), {
    tint: (c) => (c === g.S.ink || c === g.S.outline ? c : "#F4F6FFdd"),
    slice: (row) => (row > y - 2 ? Math.sin((row + f) * 1.1) * 0.9 : 0)
  });
  if (f % 16 < 8) g.text("BOO", 1, 1, WHITE);
});

// ============================================================ STUNTS
def("backflip", "Backflip", "Stunts", 36, "You set a personal record.", (g, f) => {
  const s = tl(f, [6, 16, 6, 8]);
  if (s.k === 0) { g.shadow(16, 6); drawPip(g, { sq: 0.18 * s.t, eyes: "determined", mouth: "flat" }); return; }
  if (s.k === 1) {
    const y = 28 + hop(s.t, 10);
    g.shadow(16, 3);
    g.xform((gg) => drawPip(gg, { y, sq: -0.05, eyes: "squeeze", mouth: "open", la: 0, hands: (A) => [{ x: A.cx - 3, y: A.cy + 4 }, { x: A.cx + 3, y: A.cy + 4 }] }), { cx: 16, cy: y - 7, rot: -s.t * TAU });
    return;
  }
  if (s.k === 2) { g.shadow(16, 6); drawPip(g, { sq: 0.2 * (1 - s.t), eyes: "happy", mouth: "open" }); return; }
  g.shadow(16, 6);
  drawPip(g, { eyes: "happy", mouth: "open", blush: "big", la: 0, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 3 }, { x: A.handR[0] + 2, y: A.cy - 3 }] });
  fx.twinkle(g, 4, 6, s.t); fx.twinkle(g, 28, 8, (s.t + 0.5) % 1);
}, 14);

def("magic", "Magic Trick", "Stunts", 60, "Pip pulls your next book out of a hat.", (g, f) => {
  const s = tl(f, [10, 8, 10, 10, 22]);
  const wandTip = s.k === 1 ? [24 - (s.n % 4 < 2 ? 1 : 0), 23] : [22, 16];
  g.shadow(11, 6);
  drawPip(g, {
    x: 11, w: 7, h: 6.2, eyes: s.k >= 2 ? (s.k === 4 ? "star" : "wide") : "determined", mouth: s.k >= 2 ? "open" : "smirk", la: 20, fdx: 1, look: [1, 0],
    hands: (A) => (s.k === 4 ? [{ x: A.handL[0] - 1, y: A.cy - 6 }, { x: A.handR[0] + 1, y: A.cy - 6 }] : [{ x: A.handL[0], y: A.handL[1] }, { x: 19, y: 21 }]),
    over: s.k === 4 ? (g, A) => prop.closedBook(g, A.cx - 3, A.top.y - 8, 7, 5, "#8E5CFF") : null
  });
  prop.tophat(g, 24, 29);
  if (s.k < 4) prop.wand(g, 19, 21, wandTip[0], wandTip[1]);
  if (s.k === 1) fx.star(g, wandTip[0] + 1, wandTip[1] - 1, 1, WHITE);
  if (s.k === 2) g.xform((gg) => prop.closedBook(gg, 21, 18, 7, 5, "#8E5CFF"), { cx: 24.5, cy: 20.5, rot: s.t * TAU, dy: lerp(6, -4, eo(s.t)) });
  if (s.k === 3) prop.closedBook(g, Math.round(lerp(21, 8, eo(s.t))), Math.round(lerp(10, 7, s.t)), 7, 5, "#8E5CFF");
  if (s.k >= 2) fx.twinkle(g, 27, 16, (f % 10) / 10, WHITE);
}, 44);

def("blastoff", "Blast Off", "Stunts", 72, "Promotion into the top league.", (g, f) => {
  const s = tl(f, [12, 12, 12, 24, 12]);
  if (s.k === 0) { g.shadow(16, 6); drawPip(g, { x: 16 + (rnd(f) - 0.5), sq: 0.12, leaf: "spin", lphase: f * 1.4, eyes: "determined", brows: "focus", mouth: "grit" }); return; }
  if (s.k === 1) {
    const y = 28 - 42 * ei(s.t);
    for (let i = 0; i < 3; i++) fx.puff(g, 10 + i * 6, 29, 1.4 + s.t);
    fx.exhaust(g, 16, Math.round(y + 2), f);
    drawPip(g, { y, sq: -0.2, leaf: "spin", lphase: f * 1.6, eyes: "squeeze", mouth: "shout", feet: false, hands: (A) => [{ x: A.handL[0] + 1, y: A.cy - 6 }, { x: A.handR[0] - 1, y: A.cy - 6 }] });
    return;
  }
  if (s.k === 2) { for (let i = 0; i < 3; i++) fx.puff(g, 10 + i * 6, 29 - s.t * 3, 2.6 * (1 - s.t) + 0.4); fx.twinkle(g, 22, 4, s.t, WHITE); return; }
  if (s.k === 3) {
    const y = lerp(-8, 28, eio(s.t));
    g.shadow(16, 3 + 3 * s.t);
    drawPip(g, { y, x: 16 + wave(s.n, 12, 2), la: 0, ll: 1.7, eyes: "happy", mouth: "smile", feet: (A) => [[A.cx - 3, A.bottom + 2], [A.cx + 3, A.bottom + 2]] });
    return;
  }
  g.shadow(16, 6);
  drawPip(g, { sq: 0.18 * (1 - s.t), eyes: "happy", mouth: "open", blush: "big", hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 4 }, { x: A.handR[0] + 2, y: A.cy - 4 }] });
}, 40);

// A mildly glum idle, for when Pip's mood (the Pip tab's hearts) runs very
// low. Deliberately small: a drooping leaf and a sigh, never tears, because a
// reader who skipped a few days should feel missed, not guilty.
def("mope", "Moping", "Everyday", 48, "Pip's mood is very low: a droopy leaf and a small sigh.", (g, f) => {
  g.shadow(16, 6);
  const sigh = f % 48 >= 30 && f % 48 < 40;
  drawPip(g, {
    sq: 0.06 + wave(f, 48, 0.025),
    la: 104 + wave(f, 48, 6),
    eyes: blink(f) ? "blink" : "sad",
    brows: "sad",
    mouth: sigh ? "o" : "frown",
    blush: false,
    look: [0, 1]
  });
});

/**
 * Everything a move needs, for the move libraries kept in their own files
 * (the book scenes in ./books/). They register through `def` like the moves
 * here, so LIB is one list however many files add to it.
 */
const kit = { TAU, wave, tri, lerp, clamp, eo, ei, eio, back, hop, rnd, tl, blink, GOLD, RED, WHITE, PINK, BLUE, SKY, INKX };

export { LIB, fx, prop, def, kit };
