/* Book scenes, part of ./index.js. */
import { drawPip, drawHand } from "../engine.js";
import { def, fx, prop, kit } from "../anims.js";

const { TAU, wave, tri, lerp, clamp, eo, ei, eio, back, hop, rnd, tl, blink, GOLD, RED, WHITE, PINK, BLUE, SKY, INKX } = kit;

// ------------------------------------------------------------ shared bits
const R = Math.round;
const N = 32;

/** Where the leaf's tip ends up, for things that perch on it. */
const leafTip = (A, la, ll = 1) => {
  const a = (la * Math.PI) / 180, bx = A.top.x, by = A.top.y + 1.2;
  const tx = bx + Math.sin(a * 0.35) * 2.6, ty = by - Math.cos(a * 0.35) * 2.6;
  const L = 3.7 * ll * 1.92;
  return [tx + Math.sin(a) * L, ty - Math.cos(a) * L];
};

/** Draw with fn, keeping only the pixels where keep(x, y) holds. */
const clip = (g, fn, keep) =>
  g.xform((gg) => {
    fn(gg);
    const d = gg.L.d;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (d[y * N + x] && !keep(x, y)) d[y * N + x] = null;
  }, {});

const fade = (alpha) => (c) => (c.length > 7 ? c.slice(0, 7) : c) + alpha;

const BRASS = "#D9A441", BRASS_D = "#8A6420", BRASS_L = "#FFE08A";
const WOOD = "#B07A42", WOOD_D = "#7A4E26", WOOD_L = "#D9A566";

// ============================================================ barricade
// Les Misérables: atop a heap of crates, a big red flag and a song.
const crate = (l, x, y, w, h) => {
  l.rect(x, y, w, h, WOOD);
  for (let j = y + 2; j < y + h - 1; j += 2) l.rect(x + 1, j, w - 2, 1, "#9A6636");
  l.line(x + 1, y + h - 2, x + w - 2, y + 1, WOOD_D);
  l.rect(x, y, w, 1, WOOD_L).rect(x, y, 1, h, WOOD_D).rect(x + w - 1, y, 1, h, WOOD_D).rect(x, y + h - 1, w, 1, WOOD_D);
};
const barricadePile = (g) => {
  g.stamp((l) => {
    // A cart wheel and a plank jutting out of the heap, behind everything.
    l.ring(27.5, 21.5, 3.6, WOOD_D).ring(27.5, 21.5, 2.8, WOOD);
    l.line(27, 18, 27, 25, WOOD_D).line(24, 21, 31, 21, WOOD_D);
    l.line(0, 21, 5, 25, WOOD_D).line(0, 20, 5, 24, WOOD);
    // Bottom row: a crate, a bigger crate, a hooped barrel.
    crate(l, 0, 25, 9, 6);
    crate(l, 9, 24, 12, 7);
    l.rect(21, 23, 7, 8, "#9A6232").rect(21, 23, 1, 8, "#6E4222").rect(27, 23, 1, 8, "#6E4222");
    l.rect(21, 25, 7, 1, "#5A5F6A").rect(21, 29, 7, 1, "#5A5F6A").rect(22, 23, 5, 1, "#C08A57");
    // The top crate Pip stands on, set askew.
    crate(l, 6, 18, 11, 6);
  }, "#2E1D10");
};

const bigFlag = (g, hx, hy, a, f) => {
  g.xform((gg) => {
    gg.stamp((l) => {
      l.rect(hx, hy - 12, 1, 16, "#5B4A2E").px(hx, hy - 13, GOLD);
      for (let i = 0; i < 10; i++) {
        const amp = Math.min(1, i / 3);
        const off = R(Math.sin(i * 0.9 - f * 0.8) * amp * 1.2);
        const dark = Math.cos(i * 0.9 - f * 0.8) * amp < -0.35;
        l.rect(hx + 1 + i, hy - 12 + off, 1, 6, dark ? "#A82228" : RED);
        if (i < 9 && !dark) l.px(hx + 1 + i, hy - 12 + off, "#FF6B6B");
      }
    }, "#3A0C10");
  }, { cx: hx + 0.5, cy: hy + 0.5, rot: a });
};

def("barricade", "Man the Barricade", "Books", 48, "Book nod: Les Misérables. Pip sings from the top of the barricade, flag flying.", (g, f) => {
  const s = tl(f, [10, 28, 10]);
  let a = 0, lift = 0, o;
  if (s.k === 0) o = { eyes: "closed", mouth: s.n < 5 ? "o" : "open", sq: -0.05 * eo(s.t), la: 30 };
  if (s.k === 1) {
    a = -0.18 + 0.18 * Math.cos((TAU * s.n) / 14);
    o = { eyes: "closed", mouth: s.n % 7 < 4 ? "open" : "o", la: 20 + wave(s.n, 14, 18), sq: wave(s.n, 7, 0.03) };
  }
  if (s.k === 2) { lift = R(2 * eo(Math.min(1, s.t * 3))); o = { eyes: "determined", brows: "focus", mouth: "shout", la: -10, sq: -0.06 }; }
  barricadePile(g);
  const A = drawPip(g, Object.assign(o, {
    x: 11.5, y: 17.6, w: 5.6, h: 5.1, fdx: -1, look: [-1, 0],
    hands: (A) => [
      s.k === 2 ? { x: A.cx - 7, y: A.cy - 4 } : { x: A.handL[0], y: A.handL[1] + 1 },
      { x: A.handR[0], y: A.handR[1] - lift }
    ]
  }));
  bigFlag(g, R(A.handR[0]), R(A.handR[1] - lift), a, f);
  // Re-draw the gripping hand so it wraps the pole.
  drawHand(g, { x: A.handR[0], y: A.handR[1] - lift });
  // The song, drifting up and away to the left.
  for (let k = 0; k < 2; k++) {
    const t = ((f + k * 12) % 24) / 24;
    if (t < 0.9) fx.note(g, 22 + k * 3 + Math.sin(t * 6) * 0.8, 17 - t * 9, k ? GOLD : PINK);
  }
  if (s.k === 2) fx.star(g, A.cx - 7, A.cy - 9, s.n % 4 < 2 ? 2 : 1, WHITE);
}, 20);

// ============================================================ doorstop
// War and Peace, Infinite Jest, Ulysses: a book taller than Pip.
const TOME = "#B8453A", TOME_D = "#7E2A22", TOME_L = "#E0685A", PAGE = "#FFF3D6", PAGE_D = "#D9C9A0", INKL = "#B3A383";
const tomeClosed = (g, dy, lift) => {
  const x0 = 1, w = 15, y0 = 13 + R(dy), H = 15;
  g.stamp((l) => {
    // Top face: the cover, with a gold title plate.
    for (let j = 0; j < 3; j++) {
      const sx = x0 + (2 - j);
      for (let i = 0; i < w; i++) l.px(sx + i, y0 + j, lift ? (j === 1 && i > 2 && i < w - 2 && i % 3 ? INKL : PAGE) : j === 0 || i === 0 || i === w - 1 ? TOME_L : j === 1 && i > 4 && i < w - 5 ? GOLD : TOME);
    }
    // Front face: a great many pages between the covers, and the spine.
    const yf = y0 + 3;
    for (let j = 0; j < H; j++) for (let i = 0; i < w; i++) {
      let c = j === 0 || j === H - 1 ? TOME_D : j % 2 ? PAGE_D : PAGE;
      if (i < 2) c = j === 4 || j === 10 ? GOLD : TOME;
      l.px(x0 + i, yf + j, c);
    }
    for (let k = 1; k <= 2; k++) for (let j = 0; j < H; j++) l.px(x0 + w - 1 + k, yf + j - k, j === 0 || j === H - 1 ? TOME_D : j % 2 ? "#BDAE88" : PAGE_D);
  }, "#2E1410");
  if (lift) {
    // The cover heaved up on its spine, like a trapdoor.
    const phi = lift * 1.3;
    g.stamp((l) => {
      for (let u = 0; u <= 1.001; u += 1 / (w * 2)) for (let v = 0; v <= 1.001; v += 0.25) {
        const x = x0 + 2 * (1 - v) + u * w * Math.cos(phi) + 0.2, y = y0 + 2 * v - u * w * Math.sin(phi) * 0.8;
        l.px(R(x), R(y), u > 0.92 || v < 0.01 || v > 0.99 ? TOME_L : TOME);
      }
    }, "#2E1410");
  }
};
const tomeOpen = (g, f) => {
  g.stamp((l) => {
    l.rect(0, 29, 32, 2, TOME).rect(0, 30, 32, 1, TOME_D);
    for (let x = 1; x < 31; x++) {
      const d = Math.abs(x + 0.5 - 16) / 15;
      const top = R(21 - 3.4 * Math.pow(d, 0.7));
      for (let y = top; y < 24; y++) {
        let c = x < 16 ? PAGE : "#F6E9C8";
        if (x === 15 || x === 16) c = "#DCC89C";
        else if ((y - top) % 2 === 1 && y < 23 && d > 0.1 && d < 0.9 && (x * 3 + y) % 7) c = INKL;
        l.px(x, y, c);
      }
      // The page block: thick, thick, thick.
      for (let y = 24; y < 29; y++) l.px(x, y, x === 15 || x === 16 ? "#BDAE88" : y % 2 ? PAGE_D : PAGE);
    }
    // A page corner lifting now and then.
    if (f % 24 < 6) l.px(1, 17, WHITE).px(2, 17, WHITE).px(2, 16, WHITE);
  }, "#2E1410");
};
def("doorstop", "Doorstop", "Books", 72, "Book nod: the very long ones. A book taller than Pip thuds down; Pip climbs on and reads it anyway.", (g, f) => {
  const s = tl(f, [10, 5, 7, 12, 10, 6, 22]);
  const P = { w: 5.8, h: 5.2 };
  if (s.k <= 1) {
    const w = s.k === 0 ? Math.max(0, (s.n - 4) * 1.4) : 7 + 3 * s.t;
    if (w > 0) g.shadow(10, w);
  }
  const swap = s.k === 5 && s.n >= 3;
  if (s.k >= 1 && !swap && s.k !== 6) tomeClosed(g, s.k === 1 ? lerp(-34, 0, ei(s.t)) : s.k === 2 && s.n < 2 ? 1 : 0, s.k === 5 ? (s.n + 1) / 3 : 0);
  if (swap || s.k === 6) tomeOpen(g, f);
  if (s.k === 2) {
    const t = s.t;
    for (const [x, d] of [[1, -1], [20, 1], [6, -1], [15, 1]]) fx.puff(g, x + d * t * 4, 29 - t * 2, 1.8 * (1 - t) + 0.6);
  }
  let o = { x: 25, eyes: "happy", mouth: "whistle", la: 20 + wave(f, 12, 8), fdx: -1, look: [-1, 0] };
  if (s.k === 1) o = { x: 25, eyes: "wide", mouth: "o", la: 0, fdx: -1, look: [-1, -1] };
  if (s.k === 2) o = { x: 25, y: 28 + hop(s.t, 3), eyes: "wide", mouth: "o", brows: "up", la: -20, fdx: -1, look: [-1, -1], hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 4 }, { x: A.handR[0] + 1, y: A.cy - 4 }] };
  if (s.k === 3) o = { x: 25, lean: 0.8, eyes: s.n === 7 ? "blink" : "open", mouth: s.n < 6 ? "tiny" : "wavy", la: 50, look: [0, -1] };
  if (s.k === 4) {
    const t = clamp((s.n - 3) / 7);
    o = { x: lerp(25, 9, t), y: lerp(28, 14.2, t) + hop(t, 5), sq: s.n < 3 ? 0.12 : -0.08, eyes: "determined", brows: "focus", mouth: "grit", la: 40, fdx: -1, look: [-1, 0] };
  }
  if (s.k === 5 && !swap) o = { x: 9.5, y: 14.2, eyes: "squeeze", mouth: "grit", la: 50, sq: 0.08, hands: (A) => [{ x: A.cx - 6, y: A.bottom - 1 - s.n * 2 }, { x: A.cx + 6, y: A.bottom - 1 - s.n * 2 }] };
  if (swap || s.k === 6) {
    const read = s.k === 6, sc = 0;
    o = {
      x: 22.5, y: swap ? lerp(16, 22, (s.n - 2) / 3) : 22, eyes: read ? (s.n % 12 === 11 ? "blink" : "determined") : "wide", brows: read ? "focus" : null, mouth: read ? "flat" : "o",
      la: 20 + wave(f, 12, 6), fdx: sc, look: [read && s.n % 12 < 6 ? -1 : 0, 1],
      hands: (A) => [{ x: A.cx - 6, y: A.bottom - 1 - (read && s.n % 12 < 6 ? 1 : 0) }, { x: A.cx + 5, y: A.bottom - 1 }],
    };
  }
  const onBook = s.k >= 5 || (s.k === 4 && s.n > 7);
  if (!onBook) g.shadow(o.x, 5);
  const A = drawPip(g, Object.assign(P, o));
  if (swap) for (const [x, y] of [[4, 20], [27, 20], [9, 18], [22, 18]]) fx.puff(g, x, y, 2.2 - (s.n - 3) * 0.5);
  if (s.k === 2 && s.n % 4 < 3) g.text("!", 27, 5, GOLD);
  if (s.k === 3) fx.drop(g, A.cx + 6, A.cy - 5 + s.n * 0.3, SKY);
  if (s.k === 6 && s.n > 10) fx.drop(g, A.cx + 6, A.cy - 4 + (s.n - 10) * 0.3, SKY);
}, 64);

// ============================================================ curtsy
// Pride and Prejudice: a bonnet, a curtsy, a letter sealed with a heart.
const bonnet = (g, A) => {
  const x = R(A.top.x), y = R(A.top.y);
  g.stamp((l) => {
    l.ell(x + 0.5, y + 0.5, 6.2, 3.6, (nx, ny) => (ny > 0.3 ? null : ny < -0.55 ? "#FFF1C4" : nx > 0.5 ? "#D9B46A" : "#F2D48A"));
    l.rect(x - 5, y + 1, 12, 1, "#FF7FA8");
    // A bow on the right, with its tails trailing.
    l.rect(x + 6, y - 1, 2, 3, "#FF7FA8").px(x + 8, y - 1, "#FF7FA8").px(x + 8, y + 1, "#FF7FA8").px(x + 6, y, "#E0457A");
    l.px(x + 8, y + 2, "#FF7FA8").px(x + 9, y + 3, "#FF7FA8");
  }, "#5A4020");
};
const skirt = (spread) => (g, A) => {
  const y0 = R(A.bottom - 2), w = A.rx + 1 + spread;
  g.stamp((l) => {
    for (let y = y0; y <= R(A.bottom); y++) {
      const t = (y - y0) / 2, hw = w - 1 + t;
      for (let x = R(A.cx - hw); x <= R(A.cx + hw); x++) l.px(x, y, y === R(A.bottom) ? ((x & 1) ? WHITE : "#FFD6E6") : (x + y) % 4 === 0 ? "#FF7FA8" : "#FFB3CF");
    }
    l.rect(R(A.cx - w + 1), y0 - 1, R(2 * w - 1), 1, "#FF7FA8");
  }, "#5A1030");
};
const letter = (g, x, y, a) => {
  g.xform((gg) => {
    const X = R(x), Y = R(y);
    gg.stamp((l) => {
      l.rect(X, Y, 7, 5, WHITE).rect(X, Y + 4, 7, 1, "#E6E0D2");
      l.line(X, Y, X + 3, Y + 2, "#C9C2B0").line(X + 6, Y, X + 3, Y + 2, "#C9C2B0");
      l.px(X + 2, Y + 2, RED).px(X + 4, Y + 2, RED).rect(X + 2, Y + 3, 3, 1, RED).px(X + 3, Y + 4, RED).px(X + 3, Y + 3, "#FF8A8A");
    }, "#3A2A1E");
  }, { cx: x + 3.5, cy: y + 2.5, rot: a });
};

def("curtsy", "A Curtsy", "Books", 60, "Book nod: Jane Austen. A bonnet, a curtsy, and a letter sealed with a heart.", (g, f) => {
  const s = tl(f, [6, 16, 6, 18, 14]);
  let o = { eyes: blink(f, 20) ? "blink" : "open", mouth: "smile", la: 30 }, spread = 0;
  if (s.k === 1) {
    const d = eo(Math.min(1, s.t * 2.5));
    spread = 2 * d;
    o = {
      y: 28 + d, sq: 0.16 * d, eyes: "closed", mouth: "smile", la: 30 + 30 * d, fdy: R(d),
      feet: (A) => [[A.cx - 3.5, A.bottom + 0.6], [A.cx + 1.5, A.bottom - 0.2, 1.8]],
      hands: (A) => [{ x: A.cx - A.rx - 1 - spread, y: A.bottom - 2 }, { x: A.cx + A.rx + 1 + spread, y: A.bottom - 2 }]
    };
  }
  if (s.k === 2) o = { sq: 0.16 * (1 - s.t), y: 29 - s.t, eyes: "happy", mouth: "smile", la: 60 - 30 * s.t };
  let lx = 0, ly = 0, la = 0;
  if (s.k === 3) {
    const t = s.t;
    lx = 21 + Math.sin(t * TAU * 1.5) * 4; ly = lerp(-6, 9, t); la = Math.cos(t * TAU * 1.5) * 0.45;
    o = {
      eyes: "wide", mouth: "o", brows: "up", la: 20, fdx: 1, fdy: -1, look: [1, -1],
      hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: lerp(A.handR[0], lx + 2, eo(t)), y: lerp(A.handR[1], ly + 5, eo(t)) }]
    };
  }
  if (s.k === 4) {
    o = {
      eyes: s.n % 8 < 4 ? "heartBig" : "heart", mouth: "smile", blush: "big", la: 20 + wave(s.n, 14, 10), x: 16 + wave(s.n, 14, 0.7),
      hands: (A) => [{ x: A.cx - 4, y: A.cy + 4 }, { x: A.cx + 4, y: A.cy + 4 }]
    };
  }
  g.shadow(16, 7);
  const A = drawPip(g, Object.assign(o, { under: skirt(spread), over: bonnet }));
  if (s.k === 3) letter(g, lx, ly, la);
  if (s.k === 4) {
    letter(g, A.cx - 3.5, A.cy + 1, 0);
    drawHand(g, { x: A.cx - 4, y: A.cy + 4 });
    drawHand(g, { x: A.cx + 4, y: A.cy + 4 });
    for (let k = 0; k < 2; k++) { const t = ((s.n + k * 7) % 14) / 14; fx.heart(g, (k ? 27 : 4) + Math.sin(t * 6) * 0.8, 12 - t * 10, false); }
  }
  if (s.k === 1 && s.t > 0.5) fx.twinkle(g, 28, 12, (s.n % 8) / 8, WHITE);
}, 30);

// ============================================================ raven
// Poe: a raven on a pale bust. It squawks; Pip is not impressed.
const MARBLE = "#ECE8DE", MARBLE_D = "#BDB6A6";
const bust = (g) => {
  g.stamp((l) => {
    // Pedestal: capital, column, base.
    l.rect(4, 24, 6, 6, MARBLE).rect(8, 24, 2, 6, MARBLE_D).rect(5, 24, 1, 6, WHITE);
    l.rect(2, 22, 10, 2, MARBLE).rect(2, 23, 10, 1, MARBLE_D).rect(2, 30, 10, 1, MARBLE_D).rect(3, 29, 8, 1, MARBLE);
    // Shoulders and chest, cut off square like a proper bust.
    l.rect(2, 19, 10, 3, MARBLE).rect(3, 18, 8, 1, MARBLE).rect(9, 19, 3, 3, MARBLE_D).px(4, 20, MARBLE_D).px(5, 21, MARBLE_D);
    l.rect(6, 16, 3, 2, MARBLE_D);
    // Head in profile, facing right: curls at the back, a straight nose.
    l.ell(7, 12.5, 3, 3.6, (nx, ny) => (nx < -0.35 && (R(nx * 9) + R(ny * 9)) % 2 ? MARBLE_D : nx + ny > 0.7 ? MARBLE_D : nx + ny < -0.9 ? WHITE : MARBLE));
    l.px(10, 12, MARBLE).px(10, 13, MARBLE).px(11, 13, MARBLE_D).px(9, 15, MARBLE);
  }, "#4A463C");
  g.px(8, 11, "#8A8375").px(9, 11, "#A39C8C");
};
const RAVEN = "#2B2D3C", RAVEN_L = "#59628C";
const raven = (g, x, y, pose, f) => {
  x = R(x); y = R(y);
  g.stamp((l) => {
    // Body facing right, tail down-left, head up front.
    l.ell(x, y, 2.9, 1.9, (nx, ny) => (ny < -0.5 && nx < 0.4 ? RAVEN_L : RAVEN));
    l.px(x - 3, y + 1, RAVEN).px(x - 4, y + 1, RAVEN).px(x - 4, y + 2, RAVEN).px(x - 5, y + 2, RAVEN);
    const hx = pose === "squawk" ? x + 3 : x + 2, hy = pose === "squawk" ? y - 1 : y - 2;
    l.ell(hx, hy, 1.7, 1.6, (nx, ny) => (ny < -0.4 ? RAVEN_L : RAVEN));
    if (pose === "squawk") {
      l.px(hx + 2, hy - 1, "#6E7383").px(hx + 3, hy - 1, "#6E7383").px(hx + 4, hy - 2, "#6E7383");
      l.px(hx + 2, hy + 1, "#6E7383").px(hx + 3, hy + 2, "#6E7383").px(hx + 2, hy, "#E0393E");
    } else {
      l.px(hx + 2, hy, "#6E7383").px(hx + 3, hy, "#6E7383").px(hx + 2, hy + 1, "#4A4E5C");
    }
    if (pose === "up") { l.line(x - 1, y - 1, x - 3, y - 5, RAVEN).line(x, y - 1, x - 1, y - 5, RAVEN).line(x + 1, y - 1, x + 1, y - 4, RAVEN_L); }
    if (pose === "down") { l.line(x - 1, y + 1, x - 3, y + 4, RAVEN).line(x, y + 1, x, y + 4, RAVEN).line(x + 1, y, x + 2, y + 3, RAVEN_L); }
    if (pose === "perch" || pose === "squawk" || pose === "sweat") { l.px(x, y + 2, "#6E7383").px(x + 1, y + 2, "#6E7383"); }
  }, "#08080C");
  const hx = pose === "squawk" ? x + 3 : x + 2, hy = pose === "squawk" ? y - 1 : y - 2;
  if (pose === "blink") g.px(hx, hy - 1, RAVEN_L);
  else g.px(hx, hy - 1, "#FFD23F");
};

def("raven", "Nevermore", "Books", 64, "Book nod: Edgar Allan Poe. A raven lands on the bust and squawks; Pip glares.", (g, f) => {
  const s = tl(f, [10, 14, 6, 12, 22]);
  bust(g);
  let rx = 7, ry = 7, pose = "perch";
  if (s.k === 1) {
    const t = s.t;
    rx = lerp(35, 7, eio(t)); ry = lerp(-3, 7, t) - Math.sin(t * Math.PI) * 4;
    pose = s.n % 4 < 2 ? "up" : "down";
    if (t > 0.85) pose = "down";
  }
  if (s.k === 2) { ry = 7 + (s.n < 2 ? 1 : 0); pose = "perch"; }
  if (s.k === 3) pose = s.n % 6 < 4 ? "squawk" : "perch";
  if (s.k === 4) pose = s.n > 12 && s.n < 15 ? "blink" : "perch";
  const glare = s.k === 4 || (s.k === 3 && s.n > 7);
  g.shadow(22, 6);
  let o;
  if (s.k === 0) o = { eyes: blink(s.n, 10, 6) ? "blink" : "open", look: [0, 1], mouth: "smile", la: 28 + wave(f, 20, 6) };
  else if (s.k <= 2) o = { eyes: "open", look: s.k === 1 ? [R(clamp((rx - 22) / 8, -1, 1)), -1] : [-1, -1], fdx: -1, mouth: "o", la: 20 };
  else if (!glare) o = { eyes: "wide", look: [-1, 0], fdx: -1, mouth: "o", brows: "up", la: -10 };
  else o = { eyes: "half", look: [-1, 0], fdx: -1, mouth: "flat", brows: "focus", la: 60 };
  const low = s.k >= 3;
  const A = drawPip(g, Object.assign(o, {
    x: 22, w: 7, h: 6.2,
    hands: (A) => [{ x: A.cx - 7, y: A.cy + (low ? 7 : 5) }, { x: A.cx + 7, y: A.cy + (low ? 7 : 5) }],
    over: (g, A) => prop.openBook(g, A.cx, A.cy + (low ? 3 : 1), { w: 14, h: 6, cover: "#4A2E6B" })
  }));
  drawHand(g, { x: A.cx - 7, y: A.cy + (low ? 7 : 5) });
  drawHand(g, { x: A.cx + 7, y: A.cy + (low ? 7 : 5) });
  if (s.k > 0) raven(g, rx, ry, s.k === 4 && s.n > 15 ? "sweat" : pose, f);
  if (s.k === 3 && pose === "squawk") {
    g.text("!", 14, 0, WHITE);
    g.line(14, 6, 16, 5, WHITE).line(14, 8, 17, 8, WHITE);
  }
  if (s.k === 4 && s.n > 15) fx.drop(g, 4, 2 + (s.n - 15) * 0.4, SKY);
}, 50);

// ============================================================ potion
// Jekyll and Hyde: one sip, and a purple, bushy-browed Pip grins out.
const HYDE = {
  base: "#8A5CC9", shade: "#5A3690", light: "#B48CF0", hi: "#EADCFF", belly: "#B99BE6", foot: "#3E2566",
  leaf: "#5E3A8A", leafShade: "#3E2466", vein: "#C9A8F0", stem: "#3A2150", cheek: "#C06BD0"
};
const flask = (g, x, y, level, a = 0) => {
  g.xform((gg) => {
    const X = R(x), Y = R(y);
    gg.stamp((l) => {
      l.ell(X + 0.5, Y + 4.5, 2.7, 2.6, (nx, ny) => (ny > 0.9 - level * 1.8 ? (nx + ny < -0.2 ? "#FF8AB8" : "#E0306E") : nx < -0.3 && ny < 0 ? WHITE : "#DFF4FF"));
      l.rect(X, Y, 2, 3, "#DFF4FF").px(X, Y, WHITE).rect(X, Y - 1, 2, 1, "#8A5A34");
    }, "#2A1E3A");
  }, { cx: x + 1, cy: y + 3, rot: a });
};
const bushyBrows = (g, A) => {
  const c = A.fc, Y = A.ey, ink = g.S.ink;
  g.rect(c - 7, Y - 4, 3, 2, ink).rect(c - 4, Y - 3, 3, 2, ink);
  g.rect(c + 1, Y - 3, 3, 2, ink).rect(c + 4, Y - 4, 3, 2, ink);
};

def("potion", "Strange Case", "Books", 60, "Book nod: Dr Jekyll and Mr Hyde. One sip turns Pip purple and grumpy, briefly.", (g, f) => {
  const s = tl(f, [8, 10, 4, 8, 20, 4, 6]);
  let o = {}, fl = null;
  if (s.k === 0) { o = { eyes: "open", look: [1, 0], fdx: 1, mouth: "o", la: 30 }; fl = { x: 24, y: 17, lv: 1, a: 0 }; }
  if (s.k === 1) {
    const t = eo(Math.min(1, s.t * 2));
    o = { eyes: "closed", mouth: "o", la: 30 + 20 * s.t, sq: s.n % 4 < 2 ? 0.03 : 0 };
    fl = { x: lerp(24, 19, t), y: lerp(17, 12, t), lv: 1 - s.t, a: -2.1 * t };
  }
  if (s.k === 2) o = { eyes: "wide", mouth: "tiny", brows: "up", la: 60, sq: -0.05 };
  if (s.k === 3) {
    const purple = s.n % 2 === 0;
    o = { x: 16 + (s.n % 2 ? 1 : -1), eyes: "spiral", eyePhase: f, mouth: "wavy", la: 20 + (s.n % 2) * 60, colors: purple ? HYDE : null, sq: purple ? 0.08 : -0.04 };
  }
  if (s.k === 4) {
    const cackle = s.n % 6 < 3;
    o = {
      x: 16 + wave(s.n, 10, 1), y: 28, w: 8.8, h: 6.8, sq: 0.08, lean: wave(s.n, 10, 1), eyes: "determined", mouth: cackle ? "grin" : "smirk", blush: false,
      colors: HYDE, la: 70 + wave(s.n, 10, 8), over: bushyBrows,
      hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 3 + (cackle ? -1 : 0) }, { x: A.handR[0] + 1, y: A.cy - 3 + (cackle ? 0 : -1) }]
    };
  }
  if (s.k === 5) o = { colors: HYDE, eyes: "squeeze", mouth: "flat", la: 40 };
  if (s.k === 6) o = { eyes: s.n === 3 ? "blink" : "open", mouth: "smile", blush: "big", la: 30, look: [0, 0] };
  const hands = o.hands || (fl ? (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: fl.x + 1 + (s.k === 1 ? 1 : 0), y: fl.y + 5 }] : null);
  g.shadow(16, 6);
  const A = drawPip(g, Object.assign(o, { hands }));
  if (fl) {
    flask(g, fl.x, fl.y, fl.lv, fl.a);
    if (s.k === 0) for (let k = 0; k < 2; k++) { const t = ((f + k * 4) % 8) / 8; g.px(R(fl.x + k + Math.sin(t * 5) * 0.6), R(fl.y - 2 - t * 5), k ? "#FF8AB8" : WHITE); }
  }
  if (s.k === 2 && s.n < 3) g.text("!", 26, 3, GOLD);
  if (s.k === 3) {
    // The empty flask spins away; smoke rolls round the feet.
    g.xform((gg) => flask(gg, 24, 14, 0.35, 0), { cx: 25, cy: 17, rot: s.t * 5, dx: s.t * 8, dy: -s.t * 14 });
    for (let i = 0; i < 3; i++) fx.puff(g, 8 + i * 8, 28 - (s.n % 3), 1.4 + (i % 2) * 0.6, "#D6C4F0");
  }
  if (s.k === 4) {
    for (let i = 0; i < 2; i++) { const t = ((s.n + i * 10) % 20) / 20; fx.puff(g, (i ? 27 : 4) + Math.sin(t * 5), 28 - t * 12, 1.2 * (1 - t) + 0.4, "#D6C4F0"); }
  }
  if (s.k === 5) for (let i = 0; i < 4; i++) fx.puff(g, 9 + i * 5, 18 + (i % 2) * 5, 3.2 - s.t * 1.5, "#EDE6F7");
  if (s.k === 6) fx.drop(g, A.cx + 8, A.cy - 5 + s.n * 0.4, SKY);
}, 38);

// ============================================================ timemachine
// The Time Machine: a brass contraption, a whirling clock, a flash, and
// Pip back from some other season.
const AUTUMN = { leaf: "#F08C2E", leafShade: "#B8521C", vein: "#FFD9A8", stem: "#6B3A1E" };
const clockFace = (g, cx, cy, aM, aH) => {
  g.stamp((l) => {
    l.ell(cx, cy, 6.8, 6.8, (nx, ny) => (nx * nx + ny * ny < 0.55 ? "#FFF6DF" : nx + ny < -0.5 ? BRASS_L : nx + ny > 0.6 ? BRASS_D : BRASS));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      l.px(R(cx - 0.5 + Math.cos(a) * 4), R(cy - 0.5 + Math.sin(a) * 4), i % 3 ? "#C9B98C" : INKX);
    }
    l.line(cx - 0.5, cy - 0.5, cx - 0.5 + Math.cos(aM) * 4, cy - 0.5 + Math.sin(aM) * 4, INKX);
    l.line(cx - 0.5, cy - 0.5, cx - 0.5 + Math.cos(aH) * 2.4, cy - 0.5 + Math.sin(aH) * 2.4, RED);
  }, "#3A2A0A");
};
const machine = (g, lever, glow) => {
  g.stamp((l) => {
    l.rect(8, 16, 2, 12, BRASS_D).rect(8, 16, 1, 12, BRASS);
    // Runners, curling up at each end.
    l.rect(3, 28, 25, 2, BRASS).rect(3, 29, 25, 1, BRASS_D).px(2, 27, BRASS).px(28, 27, BRASS).px(1, 26, BRASS_L).px(29, 26, BRASS_L);
    l.rect(13, 24, 2, 4, BRASS_D).rect(21, 24, 2, 4, BRASS_D);
    // Glowing crystal rods under the seat.
    for (let i = 0; i < 3; i++) l.rect(15 + i * 2, 25, 1, 3, glow ? (i % 2 ? WHITE : "#7FE7FF") : "#5FB8CC");
    // Red velvet seat.
    l.rect(11, 22, 14, 2, "#A8323A").rect(11, 22, 14, 1, "#D9515A");
  }, "#2A1A06");
  const [kx, ky] = [27 + Math.sin(lever) * 8, 28 - Math.cos(lever) * 8];
  g.stamp((l) => { l.line(27, 28, kx, ky, BRASS_D); l.rect(R(kx) - 1, R(ky) - 1, 2, 2, RED).px(R(kx) - 1, R(ky) - 1, "#FF8A8A"); }, "#2A1A06");
  return [kx, ky];
};

def("timemachine", "Time Machine", "Books", 60, "Book nod: The Time Machine. A pull of the lever, a flash, and Pip returns with an autumn leaf.", (g, f) => {
  const s = tl(f, [8, 14, 4, 10, 3, 21]);
  // Clock hands: slow, then whirling, then winding down.
  let spin = f * 0.05;
  if (s.k === 1) spin = 0.4 + s.n * s.n * 0.035;
  if (s.k === 2) spin = 0.4 + 14 * 14 * 0.035 + s.n * 1.2;
  if (s.k === 3) spin = 12 + s.n * 0.8 - s.n * s.n * 0.03;
  if (s.k >= 4) spin = 16 + s.n * 0.05;
  clockFace(g, 9, 10, spin * 12 - Math.PI / 2, spin - Math.PI / 2);
  const lever = s.k === 0 ? lerp(0.35, -0.3, eio(s.t)) : s.k <= 2 ? -0.3 : lerp(-0.3, 0.35, clamp(s.t));
  const [kx, ky] = machine(g, s.k === 3 || s.k >= 4 ? 0.35 : lever, s.k >= 1 && s.k <= 3);
  const sit = { x: 18, y: 22.2, w: 6, h: 5.4 };
  if (s.k === 0) drawPip(g, Object.assign({ eyes: "determined", brows: "focus", mouth: "grit", la: 20, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: kx, y: ky + 0.5 }] }, sit));
  if (s.k === 1) {
    const j = s.n % 2 ? 0.6 : -0.6;
    drawPip(g, Object.assign({}, sit, { x: 18 + j * (s.t + 0.2), eyes: "squeeze", mouth: "shout", la: -30 + wave(s.n, 4, 30), sq: 0.05, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: kx, y: ky + 0.5 }] }));
    for (let i = 0; i < 4; i++) {
      const a = spin * 0.7 + (i * TAU) / 4, r = 11 + (s.n % 2);
      g.line(18 + Math.cos(a) * r, 16 + Math.sin(a) * r * 0.8, 18 + Math.cos(a + 0.35) * r, 16 + Math.sin(a + 0.35) * r * 0.8, i % 2 ? WHITE : "#7FE7FF");
    }
  }
  if (s.k === 2 || s.k === 4) {
    const t = s.k === 2 ? s.t : 1 - s.t;
    g.stamp((l) => l.ell(18, 16, 4 + 9 * eo(t), 4 + 8 * eo(t), (nx, ny) => (nx * nx + ny * ny < 0.4 ? WHITE : "#CFF6FF")), "#7FE7FF");
    fx.rays(g, 18, 16, 10, s.n * 0.4, WHITE);
  }
  if (s.k === 3) {
    // Gone. A fading after-image and a few sparks.
    if (s.n < 6) g.xform((gg) => drawPip(gg, Object.assign({}, sit, { eyes: "squeeze", mouth: "shout", la: 0, hands: false })), { tint: fade(s.n < 3 ? "66" : "33") });
    for (let i = 0; i < 4; i++) fx.twinkle(g, 12 + rnd(i) * 14, 8 + rnd(i + 7) * 12, ((s.n + i * 3) % 10) / 10, i % 2 ? WHITE : "#7FE7FF");
  }
  if (s.k === 5) {
    const dazed = s.n < 7, peek = s.n >= 7 && s.n < 15;
    const A = drawPip(g, Object.assign({}, sit, {
      colors: AUTUMN, eyes: dazed ? "spiral" : peek ? "wide" : "happy", eyePhase: f, mouth: dazed ? "wavy" : peek ? "o" : "smile",
      la: dazed ? 30 + wave(s.n, 6, 20) : 10, fdy: peek ? -1 : 0, look: peek ? [0, -1] : [0, 0], blush: !dazed && !peek ? "big" : true,
      hands: (A) => (peek || dazed ? [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0], y: A.handR[1] }] : [{ x: A.handL[0] - 1, y: A.cy - 2 }, { x: A.handR[0] + 1, y: A.cy - 2 }])
    }));
    if (peek) g.text("?", 27, 2, WHITE);
    if (!dazed && !peek) fx.twinkle(g, A.top.x + 6, A.top.y - 7, ((s.n - 15) % 6) / 6, GOLD);
  }
}, 54);

// ============================================================ treasure
// Treasure Island: a parrot on the leaf, a shovel, an X, a chest of gold.
const SAND = "#E8C77A", SAND_L = "#F6DDA0", SAND_D = "#C9A45A";
const parrot = (g, x, y, flap) => {
  x = R(x); y = R(y);
  g.stamp((l) => {
    // Long tail feathers hanging down behind, then the body, wing, head, beak.
    l.line(x - 1, y + 2, x - 4, y + 4, "#3AA0FF").line(x - 1, y + 1, x - 4, y + 3, GOLD);
    l.ell(x + 0.5, y + 0.5, 2, 2.6, (nx, ny) => (ny < -0.3 ? "#FF5A4A" : RED));
    if (flap) l.line(x - 1, y, x - 4, y - 3, "#1FBF6A").line(x, y, x - 3, y - 3, "#1FBF6A").px(x - 4, y - 2, "#3AA0FF");
    else l.rect(x - 1, y, 2, 3, "#1FBF6A").px(x - 1, y + 2, "#3AA0FF");
    l.px(x + 2, y - 1, "#FFF3D6").px(x + 3, y - 1, INKX).px(x + 3, y, INKX).px(x + 2, y + 1, "#4A4E5C");
  }, "#2A1010");
  g.px(x + 1, y - 1, INKX);
};
const chest = (g, x, y, open, f) => {
  x = R(x); y = R(y);
  if (open) {
    fx.rays(g, x + 5, y - 2, 5, f * 0.15, GOLD);
    g.stamp((l) => l.rect(x, y - 5, 10, 3, "#6B3A1E").rect(x + 1, y - 4, 8, 1, "#4A2812"), "#2A1A06");
  }
  g.stamp((l) => {
    if (open) {
      l.ell(x + 5, y, 4.3, 1.8, (nx, ny, px, py) => ((px * 3 + py + (f >> 2)) % 5 === 0 ? WHITE : (px + py) % 2 ? GOLD : "#FFB400"));
    } else {
      l.rect(x, y - 2, 10, 3, "#8A5A34").rect(x, y - 2, 10, 1, "#A8743F").rect(x + 1, y - 3, 8, 1, "#8A5A34");
    }
    l.rect(x, y + 1, 10, 5, "#8A5A34").rect(x, y + 1, 10, 1, "#6B3A1E");
    l.rect(x + 1, y - (open ? 0 : 3), 1, open ? 6 : 9, GOLD).rect(x + 8, y - (open ? 0 : 3), 1, open ? 6 : 9, GOLD);
    l.rect(x + 4, y + 1, 2, 2, GOLD).px(x + 4, y + 2, INKX);
  }, "#2A1A06");
};

def("treasure", "X Marks the Spot", "Books", 60, "Book nod: Treasure Island. With a parrot on its leaf, Pip digs up a chest of gold.", (g, f) => {
  const s = tl(f, [10, 24, 6, 6, 14]);
  // Sand, an X, a hole that deepens and a heap that grows.
  const dug = s.k === 0 ? 0 : s.k === 1 ? Math.floor(s.n / 8) + (s.n % 8 >= 4 ? 1 : 0) : 3;
  g.stamp((l) => {
    for (let x = 0; x < 32; x++) l.rect(x, 29, 1, 3, (x * 7) % 11 === 0 ? SAND_D : SAND).px(x, 29, SAND_L);
    if (dug) l.ell(24, 30, 1.5 + dug * 0.9, 1.3, "#5A3A1E");
    if (dug) l.ell(30.5, 29.5 - dug * 0.4, 1 + dug * 0.8, 0.6 + dug * 0.6, (nx, ny) => (ny < -0.3 ? SAND_L : SAND));
  }, "#5A3A1E");
  if (!dug) g.line(22, 29, 26, 31, RED).line(26, 29, 22, 31, RED);
  const chestY = s.k === 3 ? lerp(33, 26, back(s.t)) : 26;
  if (s.k >= 3) chest(g, 19, chestY, s.k === 4, f);
  if (s.k === 2 && s.n < 4) { fx.star(g, 24, 28, 2, WHITE); fx.impact(g, 24, 27); }
  let o, shovel = null;
  const la = 62;
  if (s.k === 0) o = { eyes: s.n > 5 ? "wide" : "open", look: s.n > 5 ? [1, 1] : [0, 1], fdx: s.n > 5 ? 1 : 0, mouth: s.n > 5 ? "o" : "smile", hands: (A) => [{ x: A.cx - 4.5, y: A.cy + 4 }, { x: A.cx + 4.5, y: A.cy + 4 }] };
  if (s.k === 1 || s.k === 2) {
    const p = s.k === 1 ? s.n % 8 : 3;
    const down = p >= 3 && p < 5;
    const bx = down ? 24 : 23, by = down ? 28 : p < 3 ? 22 + p : 23 - (p - 5);
    shovel = [bx, by];
    o = {
      eyes: "determined", brows: "focus", mouth: down ? "grit" : "flat", look: [1, 1], fdx: 1, lean: down ? 1.5 : 0, sq: down ? 0.06 : 0,
      hands: (A) => [{ x: A.cx + 4, y: A.cy + 1 }, { x: A.cx + 7, y: A.cy - 1 }]
    };
  }
  if (s.k >= 3) o = { eyes: s.k === 4 ? "star" : "wide", mouth: "open", blush: s.k === 4 ? "big" : true, look: [1, 0], fdx: 1, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 4 }, { x: A.handR[0] + 1, y: A.cy - 4 }], y: 28 + (s.k === 4 ? hop((s.n % 7) / 7, 1.5) : 0) };
  g.shadow(12, 6, 28);
  const A = drawPip(g, Object.assign(o, { x: 12, w: 6.8, h: 6, la }));
  if (shovel) {
    const [bx, by] = shovel;
    g.stamp((l) => { l.line(A.cx + 3, A.cy - 3, bx, by - 1, "#8A5A34"); l.rect(bx - 1, by, 3, 3, "#A7B0BE").px(bx - 1, by, WHITE); }, "#2A2A33");
    drawHand(g, { x: A.cx + 4, y: A.cy + 1 });
    drawHand(g, { x: A.cx + 7, y: A.cy - 1 });
    if (s.k === 1 && s.n % 8 >= 5) {
      const t = ((s.n % 8) - 5) / 3;
      g.stamp((l) => l.rect(R(lerp(24, 29, t)), R(27 - Math.sin(t * Math.PI) * 5), 2, 1, SAND_D), "#5A3A1E");
    }
  }
  if (s.k === 0) {
    // The map, held up: a dotted trail and a red X.
    const mx = R(A.cx - 5), my = R(A.cy + 1);
    g.stamp((l) => {
      l.rect(mx, my, 10, 6, "#F4E4BC").rect(mx, my + 5, 10, 1, "#D9C08A");
      l.px(mx + 1, my + 4, "#8A5A34").px(mx + 3, my + 3, "#8A5A34").px(mx + 5, my + 3, "#8A5A34");
      l.px(mx + 7, my + 1, RED).px(mx + 8, my + 2, RED).px(mx + 7, my + 3, RED).px(mx + 6, my + 2, RED).px(mx + 8, my, RED);
    }, "#5A3A1E");
    drawHand(g, { x: A.cx - 4.5, y: A.cy + 4 });
    drawHand(g, { x: A.cx + 4.5, y: A.cy + 4 });
    if (s.n > 5 && s.n % 4 < 3) g.text("!", 27, 12, GOLD);
  }
  const [px, py] = leafTip(A, la);
  const flap = s.k === 4 && f % 4 < 2;
  parrot(g, px - 2, py - 3 + (s.k === 1 && s.n % 8 < 4 ? 0 : s.k === 4 ? 0 : wave(f, 12, 0.6)), flap || (s.k === 2 && s.n % 2 === 0));
  if (s.k === 4) { fx.twinkle(g, 29, 18, (s.n % 7) / 7, WHITE); fx.twinkle(g, 20, 16, ((s.n + 3) % 7) / 7, GOLD); }
}, 54);

// ============================================================ submarine
// Twenty Thousand Leagues: Pip at a porthole, and a tentacle drifts by.
const TENT = "#D9577A", TENT_D = "#9C3456", SUCK = "#FFD1DC";
const tentacle = (g, ox, oy, f) => {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const s = i / 40;
    pts.push([ox + 4 + s * 26, oy + Math.sin(s * 5 + f * 0.25) * 2 + s * 5, 1.1 + s * 2.2]);
  }
  // The leading tip curls up and back into a little spiral.
  for (let i = 1; i <= 16; i++) {
    const u = i / 16, a = Math.PI * 0.5 + u * Math.PI * 1.7 + Math.sin(f * 0.3) * 0.2, r = 3.6 * (1 - u * 0.55);
    pts.unshift([ox + 3.5 + Math.cos(a) * r, oy - 3.6 + 2 + Math.sin(a) * r, 1.1 - u * 0.45]);
  }
  g.stamp((l) => {
    for (let i = pts.length - 1; i >= 0; i--) {
      const [x, y, r] = pts[i];
      l.ell(x, y, r, r, (nx, ny) => (ny > 0.35 ? TENT_D : ny < -0.5 ? "#F28AA6" : TENT));
    }
    for (let i = 20; i < pts.length; i += 4) {
      const [x, y, r] = pts[i];
      l.px(R(x), R(y + r * 0.6), SUCK);
    }
  }, "#3A0E1E");
};

def("submarine", "Porthole", "Books", 60, "Book nod: Twenty Thousand Leagues Under the Seas. Pip peers out; a giant tentacle drifts past.", (g, f) => {
  const s = tl(f, [10, 6, 18, 8, 18]);
  const cx = 16, cy = 15, rin = 10.5, rout = 13.4;
  // Porthole interior: the cabin behind Pip.
  g.stamp((l) => l.ell(cx, cy, rin, rin, (nx, ny) => (ny > 0.55 ? "#0E2A3E" : "#163A52")), "#0A1A26");
  let py = 26, o = {};
  if (s.k === 0) { py = lerp(34, 26, eo(s.t)); o = { eyes: "open", mouth: "smile", la: 30 }; }
  if (s.k === 1) o = { eyes: "open", mouth: "smile", look: [s.n < 3 ? -1 : 1, 0], la: 30 };
  let ox = 40;
  if (s.k === 2) { ox = lerp(28, 9, eio(s.t)); o = { eyes: "wide", mouth: "o", brows: "up", la: -20, look: [clamp(R((ox - 16) / 5), -1, 1), -1], x: 16 + (s.n % 4 < 2 ? 0.4 : -0.4) }; }
  if (s.k === 3) { ox = 9 + (s.n % 4 < 2 ? 1 : 0); o = { eyes: "squeeze", mouth: "wavy", la: -30, sq: 0.08 }; }
  if (s.k === 4) { ox = lerp(9, -34, ei(s.t)); py = lerp(26, 31.5, eo(clamp(s.t * 1.6))); o = { eyes: "wide", mouth: "o", look: [-1, -1], la: 60 }; }
  clip(g, (gg) => drawPip(gg, Object.assign({ x: o.x || 16, y: py, w: 7.4, h: 6.4, hands: (A) => [{ x: A.handL[0] + 1, y: A.cy - 1 }, { x: A.handR[0] - 1, y: A.cy - 1 }] }, o)), (x, y) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 < rin * rin);
  // Glass glints.
  g.line(9, 9, 11, 7, "#FFFFFF88").line(9, 11, 13, 7, "#FFFFFF44");
  // Brass ring with rivets.
  g.stamp((l) => {
    l.ell(cx, cy, rout, rout, (nx, ny) => {
      const d = nx * nx + ny * ny;
      if (d < (rin / rout) ** 2) return null;
      return nx + ny < -0.7 ? BRASS_L : nx + ny > 0.7 ? BRASS_D : BRASS;
    });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.39; l.px(R(cx - 0.5 + Math.cos(a) * 12), R(cy - 0.5 + Math.sin(a) * 12), "#5A3A0A"); }
  }, "#2A1A06");
  // Bubbles, drifting up outside.
  for (let i = 0; i < 3; i++) {
    const t = ((f + i * 9) % 27) / 27, bx = R([29, 3, 27][i] + Math.sin((f + i * 5) * 0.4)), by = R(31 - t * 30);
    g.stamp((l) => l.px(bx, by, "#CFEFFF"), "#2F6F9A");
  }
  if (s.k >= 2 && ox < 36) tentacle(g, ox, 10, f);
  if (s.k === 3 && s.n % 4 < 2) fx.impact(g, 10, 11);
  if (s.k === 2 && s.t > 0.6) fx.drop(g, 25, 16 + s.n * 0.2, SKY);
}, 38);

// ============================================================ tinyplanet
// The Little Prince: a tiny planet, a rose under glass, a watering can.
const PC = [15, 24.5], PR = 7;
const planet = (g) => {
  g.stamp((l) => {
    l.ell(PC[0], PC[1], PR, PR, (nx, ny, x, y) => {
      if ((x - 12) ** 2 + (y - 27) ** 2 < 2.2 || (x - 18) ** 2 + (y - 29) ** 2 < 1.5 || (x - 19) ** 2 + (y - 23) ** 2 < 0.8) return "#C9933F";
      return nx + ny < -0.8 ? "#FFE3A0" : nx + ny > 0.6 ? "#D9A24E" : "#F2C46B";
    });
  }, "#3A2410");
};
const RX = 21.5, RB = 19.4; // the rose's spot, on the planet's right shoulder
const rose = (g, bloom) => {
  g.stamp((l) => {
    l.line(RX - 0.5, RB, RX, RB - 4, "#2E8B3A").px(RX + 1, RB - 2, "#3AAE4A").px(RX - 2, RB - 1, "#3AAE4A");
    const r = bloom ? 2.1 : 1.6;
    l.ell(RX + 0.5, RB - 5.5, r, r * 0.9, (nx, ny) => (ny > 0.3 ? "#A82228" : nx + ny < -0.5 ? "#FF6B6B" : RED));
    l.px(R(RX), R(RB - 6), "#A82228");
  }, "#2A0A0A");
};
const dome = (g, lift) => {
  const y = R(RB - lift);
  g.stamp((l) => {
    for (let i = 0; i <= 28; i++) {
      const a = Math.PI + (i / 28) * Math.PI;
      l.px(R(RX + 0.5 + Math.cos(a) * 3.6 - 0.5), R(y - 3 + Math.sin(a) * 4.4), "#DDF3FF");
    }
    l.rect(R(RX) - 4, y, 9, 1, "#9FD4EE").rect(R(RX) - 4, y - 3, 1, 3, "#DDF3FF").rect(R(RX) + 4, y - 3, 1, 3, "#DDF3FF");
    l.px(R(RX), y - 8, "#DDF3FF").px(R(RX) - 2, y - 5, WHITE).px(R(RX) - 2, y - 4, WHITE);
  }, "#1E4A6B");
};
const can = (g, x, y, tilt) => {
  g.xform((gg) => gg.stamp((l) => {
    const X = R(x), Y = R(y);
    l.rect(X, Y, 4, 3, "#3AA0FF").rect(X, Y, 4, 1, "#7CC8FF").line(X + 4, Y + 1, X + 6, Y - 1, "#3AA0FF").px(X + 7, Y - 1, "#7CC8FF");
    l.px(X - 1, Y, "#2F7FC6").px(X - 1, Y + 1, "#2F7FC6");
  }, "#12304E"), { cx: x + 2, cy: y + 1.5, rot: tilt });
};

def("tinyplanet", "Tiny Planet", "Books", 60, "Book nod: The Little Prince. On a planet barely bigger than Pip, it waters its rose.", (g, f) => {
  const s = tl(f, [14, 8, 4, 18, 8, 8]);
  const stars = [[3, 4], [27, 3], [7, 13], [29, 20], [2, 21], [19, 2]];
  stars.forEach(([x, y], i) => fx.twinkle(g, x, y, ((f + i * 7) % 20) / 20, i % 2 ? WHITE : GOLD));
  planet(g);
  // The dome: lifted, left hovering in the low gravity, then set back down.
  let lift = 0;
  if (s.k === 1) lift = 10.5 * eo(s.t);
  if (s.k === 2 || s.k === 3) lift = 10.5 + wave(f, 12, 0.6);
  if (s.k === 4) lift = 10.5 * (1 - eio(s.t));
  const bloom = s.k === 3 ? s.t > 0.5 : s.k >= 4;
  rose(g, bloom);
  const water = s.k === 3, hold = s.k === 2 || water, reach = s.k === 1 || s.k === 4;
  let o = { eyes: blink(f, 30) ? "blink" : "open", mouth: "smile", la: 20 + wave(f, 24, 8) };
  if (reach) o = { eyes: "open", mouth: "o", fdx: 1, look: [1, -1], la: 10 };
  if (hold) o = { eyes: water ? "happy" : "open", mouth: water ? "smile" : "o", fdx: 1, look: [1, 0], la: 10, blush: water ? "big" : true };
  if (s.k === 5) o = { eyes: "happy", mouth: "smile", blush: "big", la: 30 + wave(f, 12, 10) };
  let hand = null;
  const A = drawPip(g, Object.assign(o, {
    x: 10.5, y: 18.2, w: 5.2, h: 4.8, lean: -0.6,
    hands: (A) => {
      hand = reach ? { x: RX - 3.5, y: RB - 6 - lift } : hold ? { x: A.handR[0] + 1, y: A.cy } : { x: A.handR[0], y: A.handR[1] };
      return [{ x: A.handL[0], y: A.handL[1] }, hand];
    }
  }));
  if (hold) { can(g, hand.x - 1, hand.y - 3, water ? 0.45 : 0); drawHand(g, hand); }
  dome(g, lift);
  if (reach) drawHand(g, hand);
  if (water) {
    for (let k = 0; k < 3; k++) {
      const t = ((s.n + k * 2) % 6) / 6;
      g.px(R(lerp(hand.x + 5, RX + 0.5, t)), R(lerp(hand.y - 2, RB - 7, t)), k % 2 ? SKY : BLUE);
    }
  }
  if (bloom && s.k !== 4) { const t = s.k === 5 ? s.t : (s.t - 0.5) * 2; fx.heart(g, RX + 4, RB - 9 - t * 4, false); }
}, 36);

// ============================================================ caterpillar
// The Very Hungry Caterpillar: munch, munch, munch, cocoon, wings.
const HOLES = [[10.5, 22], [9, 26.5], [6, 21.5], [5.5, 26]];
const apple = (g, holes) => {
  g.stamp((l) => {
    l.ell(7.5, 24.2, 5, 4.8, (nx, ny, x, y) => {
      for (let i = 0; i < holes; i++) if ((x + 0.5 - HOLES[i][0]) ** 2 + (y + 0.5 - HOLES[i][1]) ** 2 < 2.2) return null;
      return nx + ny < -0.8 ? "#FF8A8A" : nx + ny > 0.6 ? "#A82228" : RED;
    });
    l.line(7, 19, 8, 17, "#6B3A1E").px(9, 17, "#3AAE4A").px(10, 17, "#3AAE4A").px(9, 18, "#2E8B3A");
  }, "#3A0A0A");
};
const WING = ["#FF4D9A", "#FFB400", "#3AA0FF", "#8E5CFF"];
const wings = (flap) => (g, A) => {
  const k = 0.35 + 0.65 * Math.abs(Math.cos(flap));
  g.stamp((l) => {
    for (const sd of [-1, 1]) {
      l.ell(A.cx + sd * (3 + 5 * k), A.cy - 5, 5.5 * k + 0.8, 5, (nx, ny) => (nx * nx + ny * ny < 0.15 ? WING[2] : nx * nx + ny * ny < 0.5 ? WING[1] : WING[0]));
      l.ell(A.cx + sd * (3 + 4 * k), A.cy + 2.5, 4 * k + 0.8, 3.4, (nx, ny) => (nx * nx + ny * ny < 0.3 ? WING[1] : WING[3]));
    }
  }, "#2A0A2A");
};

def("caterpillar", "Very Hungry", "Books", 72, "Book nod: The Very Hungry Caterpillar. Pip munches through an apple, cocoons, and comes out with wings.", (g, f) => {
  const s = tl(f, [24, 8, 10, 12, 4, 14]);
  const munch = s.k === 0 ? Math.floor(s.n / 6) : 3, mp = s.k === 0 ? s.n % 6 : 0;
  const eaten = s.k === 0 ? munch + (mp >= 3 ? 1 : 0) : 4;
  apple(g, eaten);
  const grow = s.k === 0 ? eaten / 4 : s.k <= 3 ? 1 : 0;
  const w = 6.8 + grow * 2.6, h = 6 + grow * 1.2;
  if (s.k === 0) {
    const lunge = mp < 3 ? eo(mp / 3) : 1 - (mp - 3) / 3;
    g.shadow(21 - lunge * 2, w * 0.8);
    drawPip(g, { x: 21 - lunge * 2, w, h, fdx: -2, look: [-1, 0], eyes: mp === 2 || mp === 3 ? "squeeze" : "happy", mouth: mp === 2 ? "open" : mp === 3 ? "flat" : "smile", la: 20 + lunge * 20, blush: true });
    if (mp === 3) { g.px(13, 23, "#FF8A8A").px(12, 26, "#FFF3D6"); }
    return;
  }
  if (s.k === 1) {
    g.shadow(21, w * 0.8);
    const A = drawPip(g, { x: 21, w, h, eyes: "happy", mouth: "smile", blush: "big", la: 60 + wave(s.n, 8, 5), sq: 0.04 + wave(s.n, 4, 0.02), hands: (A) => [{ x: A.cx - 3, y: A.cy + 4 }, { x: A.cx + 3, y: A.cy + 4 }] });
    if (s.n > 3) fx.puff(g, A.fc + 1, A.ey + 5 - (s.n - 4) * 0.5, 0.9, WHITE);
    return;
  }
  if (s.k === 2 || s.k === 3) {
    const wrap = s.k === 2 ? s.t : 1;
    const draw = (gg) => {
      const A = drawPip(gg, { x: 21, w, h, eyes: wrap > 0.7 ? "closed" : "happy", mouth: "tiny", la: 0, hands: false, feet: s.k === 2 ? null : false });
      const top = A.top.y - 6, bottom = A.bottom + 1, lvl = bottom - wrap * (bottom - top + 1);
      gg.stamp((l) => {
        l.ell(A.cx, (top + bottom) / 2, A.rx + 1, (bottom - top) / 2 + 0.5, (nx, ny, x, y) => {
          if (y < lvl) return null;
          if (y >= A.ey - 2 && y <= A.ey + 1 && Math.abs(x - A.fc) < 5 && wrap > 0.99) return null;
          return (x + y * 2) % 5 === 0 ? "#C9B98C" : (x - y + 64) % 7 === 0 ? "#DCCFA6" : "#EDE3C4";
        });
      }, "#5A4A2A");
      if (wrap > 0.99) {
        // Snug: only the sleeping face shows through the silk.
        const c = A.fc, Y = A.ey;
        gg.stamp((l) => l.rect(c - 5, Y - 2, 10, 4, g.S.base), g.S.base);
        gg.px(c - 4, Y, g.S.ink).px(c - 3, Y + 1, g.S.ink).px(c - 2, Y, g.S.ink).px(c + 1, Y, g.S.ink).px(c + 2, Y + 1, g.S.ink).px(c + 3, Y, g.S.ink);
      }
    };
    g.shadow(21, w * 0.7);
    if (s.k === 3) g.xform(draw, { cx: 21, cy: 29, rot: wave(s.n, 6, 0.12) });
    else draw(g);
    if (s.k === 3) fx.z(g, 27 + s.t * 2, 8 - s.t * 6, s.t > 0.5);
    return;
  }
  const pop = s.k === 4;
  const flap = pop ? 0 : s.n * 0.9, yy = pop ? 25 : 24 + wave(s.n, 14, 1.5);
  g.shadow(17.5, 4);
  drawPip(g, {
    x: 17.5, y: yy, w: 6.8, h: 6, eyes: "happy", mouth: "open", blush: "big", la: -10 + wave(s.n, 7, 15), behind: wings(flap), feet: (A) => [[A.cx - 2.5, A.bottom + 1.8, 1.8], [A.cx + 2.5, A.bottom + 1.8, 1.8]],
    hands: (A) => [{ x: A.handL[0] + 1, y: A.cy + 2 }, { x: A.handR[0] - 1, y: A.cy + 2 }]
  });
  if (pop) {
    fx.burst(g, 19, 17, s.t, "#EDE3C4");
    for (const d of [-1, 1]) g.stamp((l) => l.ell(19 + d * (4 + s.t * 8), 18 + s.t * 7, 2.5, 4, "#EDE3C4"), "#5A4A2A");
    return;
  }
  fx.twinkle(g, 29, 2, (s.n % 7) / 7, GOLD); fx.twinkle(g, 3, 10, ((s.n + 3) % 7) / 7, WHITE);
}, 64);

// ============================================================ wildcrown
// Where the Wild Things Are: a crown, a moon, and a wild rumpus.
const moon = (g) => {
  // A fat crescent, lit on its right.
  g.stamp((l) => l.ell(25.5, 7, 5.2, 5.2, (nx, ny, x, y) => ((x + 0.5 - 23.2) ** 2 + (y + 0.5 - 5.6) ** 2 < 15 ? null : (x === 29 && y === 8) || (x === 27 && y === 10) ? "#E8D68A" : nx + ny > 0.7 ? "#F2E29A" : "#FFF6C8")), "#5A4A1A");
};
const claws = (g, h) => g.stamp((l) => l.px(R(h.x) - 1, R(h.y) - 2, WHITE).px(R(h.x), R(h.y) - 3, WHITE).px(R(h.x) + 1, R(h.y) - 2, WHITE), INKX);

def("wildcrown", "Wild Rumpus", "Books", 48, "Book nod: Where the Wild Things Are. Crowned king, Pip starts a rumpus and howls at the moon.", (g, f) => {
  const s = tl(f, [8, 24, 16]);
  moon(g);
  let o, crownDy = 0;
  if (s.k === 0) { crownDy = -12 * (1 - eo(s.t)); o = { eyes: s.n > 5 ? "happy" : "wide", mouth: s.n > 5 ? "open" : "o", look: [0, -1], fdy: s.n > 5 ? 0 : -1, la: 20 }; }
  if (s.k === 1) {
    const p = s.n % 8, L = p < 4, up = p % 4 < 2;
    o = {
      x: 13 + (L ? -1 : 1), y: 28 - (up ? 1 : 0), lean: L ? -1.5 : 1.5, eyes: p % 4 === 0 ? "wide" : "angry", mouth: up ? "grin" : "shout", la: L ? 50 : -20,
      feet: (A) => [[A.cx - 3.5, A.bottom + 1.1 - (L && up ? 2 : 0)], [A.cx + 3.5, A.bottom + 1.1 - (!L && up ? 2 : 0)]],
      hands: (A) => [
        { x: A.handL[0] - 1, y: L ? A.top.y - 1 : A.cy + 1, item: claws },
        { x: A.handR[0] + 1, y: L ? A.cy + 1 : A.top.y - 1, item: claws }
      ]
    };
  }
  if (s.k === 2) {
    const b = eo(Math.min(1, s.t * 3));
    o = {
      lean: 2 * b, fdx: 1, fdy: -1, look: [1, -1], eyes: "closed", mouth: s.n % 8 < 6 ? "shout" : "o", la: -40 * b, sq: -0.06 * b,
      hands: (A) => [{ x: A.handL[0] - 1, y: A.cy, item: claws }, { x: A.fc + 5, y: A.ey + 4 }]
    };
  }
  g.shadow(13, 6);
  const A = drawPip(g, Object.assign({ x: 13 }, o, { over: (g, A) => prop.crown(g, A.top.x, A.top.y - 1 + crownDy) }));
  if (s.k === 0 && s.n > 5) fx.star(g, A.top.x + 5, A.top.y - 3, 1, WHITE);
  if (s.k === 1 && s.n % 4 === 2) fx.puff(g, s.n % 8 < 4 ? A.cx - 4 : A.cx + 4, 29, 1.3);
  if (s.k === 2 && s.t > 0.2) {
    // Howl rings, rolling up toward the moon.
    for (let k = 0; k < 2; k++) {
      const r = 5 + ((s.n * 0.5 + k * 4) % 8);
      g.stamp((l) => l.ring(A.fc + 1, A.ey + 3, r, "#FFF6C8", (t) => !(t > 0.8 && t < 0.95)), "#5A4A1A");
    }
  }
}, 38);

// ============================================================ goldenticket
// Charlie and the Chocolate Factory: unwrap the bar... a golden ticket!
const TICKET = "#FFD23F", TICKET_D = "#E0A800";
const ticket = (g, x, y, f) => {
  x = R(x); y = R(y);
  g.stamp((l) => {
    // A wide gold ticket: a darker inset border, lines of "print", notched ends.
    l.rect(x, y, 13, 6, TICKET).rect(x + 1, y + 1, 11, 4, TICKET_D).rect(x + 2, y + 2, 9, 2, "#FFE36B");
    l.rect(x + 3, y + 2, 7, 1, "#E0A800").rect(x + 4, y + 3, 5, 1, "#E0A800");
    l.px(x, y + 2, null).px(x, y + 3, null).px(x + 12, y + 2, null).px(x + 12, y + 3, null);
    const sh = (f >> 1) % 16;
    if (sh < 13) { l.px(x + sh, y, WHITE); if (sh > 0 && sh < 12) l.px(x + sh - 1, y + 1, "#FFF6C8"); }
  }, "#4A3100");
};
const bar = (g, x, y, stage) => {
  x = R(x); y = R(y);
  g.stamp((l) => {
    // Chocolate: segmented squares.
    l.rect(x, y, 11, 5, "#6B3A1E");
    for (let i = 0; i < 11; i += 3) for (let j = 0; j < 5; j += 2) l.px(x + i + 1, y + j, "#8A4F28");
    if (stage >= 1) l.rect(x + 3, y - 1, 5, 2, TICKET).px(x + 4, y - 1, WHITE);
    if (stage === 0) {
      l.rect(x, y, 11, 5, "#8E2F9E").rect(x, y + 1, 11, 1, "#B95ACB").rect(x + 4, y, 3, 5, "#F4E4BC");
      l.rect(x + 5, y + 1, 1, 3, RED);
    }
  }, "#2A1406");
};

def("goldenticket", "Golden Ticket", "Books", 60, "Book nod: Charlie and the Chocolate Factory. Pip unwraps a bar and finds the golden ticket.", (g, f) => {
  const s = tl(f, [10, 8, 6, 8, 28]);
  let o, j = 0, bx, by;
  if (s.k === 0) o = { eyes: "happy", mouth: "open", blush: "big", la: 30 + wave(f, 6, 8), y: 28 + (s.n % 4 < 2 ? 0 : -0.5) };
  if (s.k === 1) o = { eyes: "determined", mouth: "grit", la: 10 };
  if (s.k === 2) o = { eyes: "wide", mouth: "o", brows: "up", la: -20, look: [0, 1] };
  if (s.k === 3) o = { eyes: "wide", mouth: "open", brows: "up", la: -30, look: [0, -1], fdy: -1 };
  if (s.k === 4) {
    const t = (s.n % 14) / 14;
    j = hop(t, 4);
    o = { eyes: "star", mouth: "open", blush: "big", la: wave(s.n, 14, 85), sq: t < 0.1 ? 0.12 : -0.06, y: 28 + j };
  }
  let tk = null;
  if (s.k === 3) tk = eo(s.t);
  if (s.k === 4) tk = 1;
  g.shadow(16, s.k === 4 ? 6 + j * 0.4 : 6);
  const A = drawPip(g, Object.assign(o, {
    hands: (A) => {
      bx = A.cx - 5.5; by = A.cy + 1;
      if (tk !== null) {
        const ty = Math.max(1, lerp(A.cy + 1, A.top.y - 7, tk));
        return [{ x: A.cx - 7.5, y: ty + 3 }, { x: A.cx + 7.5, y: ty + 3 }];
      }
      return [{ x: A.cx - 6.5, y: A.cy + 3 }, { x: A.cx + 6.5, y: A.cy + 3 }];
    }
  }));
  if (tk === null) {
    bar(g, bx, by, s.k === 0 ? 0 : 1);
    drawHand(g, { x: A.cx - 6.5, y: A.cy + 3 });
    drawHand(g, { x: A.cx + 6.5, y: A.cy + 3 });
    if (s.k === 1) {
      // The wrapper, torn off and tumbling away.
      g.xform((gg) => gg.stamp((l) => l.rect(R(bx), R(by), 11, 5, "#8E2F9E").rect(R(bx), R(by) + 1, 11, 1, "#B95ACB").rect(R(bx) + 4, R(by), 3, 5, "#F4E4BC"), "#2A1406"),
        { cx: bx + 5.5, cy: by + 2.5, rot: s.t * 3, dx: s.t * 16, dy: -Math.sin(s.t * Math.PI) * 10 + s.t * 6 });
    }
    if (s.k === 2) fx.twinkle(g, bx + 6, by - 2, s.t, WHITE);
  } else {
    const ty = Math.max(1, lerp(A.cy + 1, A.top.y - 7, tk));
    if (tk > 0.6) fx.rays(g, A.cx, ty + 3, 7, f * 0.12, GOLD);
    ticket(g, A.cx - 6.5, ty, f);
    drawHand(g, { x: A.cx - 7.5, y: ty + 3 });
    drawHand(g, { x: A.cx + 7.5, y: ty + 3 });
  }
  if (s.k === 4) fx.confetti(g, f, 12);
}, 50);
