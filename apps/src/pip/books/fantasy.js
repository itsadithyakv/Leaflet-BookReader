/* Book scenes, part of ./index.js. */
import { drawPip, drawHand } from "../engine.js";
import { def, fx, prop, kit } from "../anims.js";

const { TAU, wave, tri, lerp, clamp, eo, ei, eio, back, hop, rnd, tl, blink, GOLD, RED, WHITE, PINK, BLUE, SKY, INKX } = kit;

// ============================================================ helpers
// Fantasy nods: dragons, a watching eye, a ring, an owl with a letter, wands,
// wardrobes, rabbits, tea parties, tornados, runaway shadows, coins, tridents
// and a bird pin. Generic tropes only; no names, no lettering beyond a "!".

/** Draw into a scratch layer, then rewrite its pixels (dither, squash, tint). */
const layered = (g, draw, post) => g.xform((gg) => { draw(gg); post(gg.L.d); }, {});
/** Per-pixel colour map on a scratch layer: map(c, x, y) -> colour or null. */
const remap = (g, draw, map) => layered(g, draw, (d) => {
  for (let i = 0; i < d.length; i++) if (d[i]) d[i] = map(d[i], i % 32, (i / 32) | 0);
});
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)] / 16;

/** Where the leaf's tip sits, for a given leaf angle (degrees) and length. */
const leafTip = (A, la = 28, ll = 1, k = 1.9) => {
  const a = (la * Math.PI) / 180;
  const bx = A.top.x + Math.sin(a * 0.35) * 2.6, by = A.top.y + 1.2 - Math.cos(a * 0.35) * 2.6;
  return [bx + Math.sin(a) * 3.7 * ll * k, by - Math.cos(a) * 3.7 * ll * k];
};

/** A sooty face: a ragged black smudge over the eyes and mouth (drawn under
 the face, which is then inked light so it reads as the classic blinking eyes). */
const soot = (g, A) => {
  g.ell(A.fc + 0.5, A.ey + 1.2, 7, 5.4, (nx, ny, x, y) => {
    const d = nx * nx + ny * ny;
    if (d > 0.55 && rnd(x * 13 + y * 7) > (1 - d) * 2.4) return null;
    return (x * 5 + y * 3) % 7 === 0 ? "#5E5A52" : "#34312C";
  });
};
const SOOTY = { ink: "#F4F1E8", eyeHi: "#34312C", vein: "#77726A" };

const glassesOn = (g, A, askew = 0) => {
  const c = A.fc, y = A.ey - 0.5;
  g.ring(c - 3, y, 2.4, "#1B1B22").ring(c + 3, y + askew, 2.4, "#1B1B22");
  g.px(c - 1, y, "#1B1B22").px(c, y, "#1B1B22");
};

// ============================================================ 1. dragon
const DRG = "#D8483A", DRG_D = "#9A2A22", DRG_B = "#FFC27A", DRG_W = "#7A1E1A", DRG_O = "#3A0E0A";
/** A small red dragon, 20px nose to tail. dir 1 faces right. wing 0 up, 1 level, 2 down. */
function dragon(g, x0, y0, dir, wing, jaw) {
  const X = (x) => Math.round(x0) + dir * x, Y = (y) => Math.round(y0) + y;
  const row = (l, y, a, b, c) => { for (let x = a; x <= b; x++) l.px(X(x), Y(y), c); };
  // Far wing, behind the body.
  g.stamp((l) => {
    if (wing === 0) { row(l, -2, -3, 1, DRG_W); row(l, -3, -4, 0, DRG_W); row(l, -4, -4, -1, DRG_W); row(l, -5, -5, -2, DRG_W); row(l, -6, -5, -3, DRG_W); row(l, -7, -6, -5, DRG_D); }
    if (wing === 1) { row(l, -2, -7, 1, DRG_W); row(l, -3, -8, -3, DRG_W); row(l, -4, -9, -6, DRG_D); }
    if (wing === 2) { row(l, 2, -3, 0, DRG_W); row(l, 3, -4, -1, DRG_W); row(l, 4, -4, -2, DRG_W); row(l, 5, -5, -3, DRG_D); }
  }, DRG_O);
  g.stamp((l) => {
    // tail with a spade tip
    l.px(X(-5), Y(1), DRG).px(X(-6), Y(2), DRG).px(X(-7), Y(2), DRG).px(X(-8), Y(1), DRG).px(X(-9), Y(0), DRG_D);
    l.px(X(-10), Y(-1), DRG_D).px(X(-9), Y(-1), DRG_D).px(X(-10), Y(0), DRG_D).px(X(-11), Y(-1), DRG_D).px(X(-10), Y(-2), DRG_D);
    // body
    row(l, -1, -3, 2, DRG); row(l, 0, -4, 3, DRG); row(l, 1, -4, 3, DRG); row(l, 2, -3, 1, DRG);
    row(l, 1, -2, 2, DRG_B); row(l, 2, -1, 1, DRG_B);
    // legs
    l.px(X(-2), Y(3), DRG_D).px(X(1), Y(3), DRG_D);
    // neck and head
    l.px(X(3), Y(-1), DRG).px(X(3), Y(-2), DRG).px(X(4), Y(-2), DRG);
    row(l, -4, 4, 6, DRG); row(l, -3, 3, 8, DRG);
    if (jaw) { row(l, -2, 4, 5, DRG); row(l, -1, 5, 8, DRG_B); l.px(X(6), Y(-2), "#5A0E0A").px(X(7), Y(-2), "#5A0E0A"); }
    else row(l, -2, 4, 8, DRG_B);
    l.px(X(5), Y(-4), "#FFE36B"); // eye
    l.px(X(4), Y(-5), DRG_D).px(X(3), Y(-6), DRG_D); // horn
    l.px(X(8), Y(-3), DRG_D); // nostril
    // spikes along the back
    l.px(X(-2), Y(-2), DRG_D).px(X(0), Y(-2), DRG_D);
  }, DRG_O);
}

/** A cone of fire from (x, y) along angle a, len long. */
function breath(g, x, y, a, len, f) {
  if (len < 1) return;
  const ux = Math.cos(a), uy = Math.sin(a);
  g.stamp((l) => {
    for (let j = -8; j <= 20; j++) for (let i = -20; i <= 20; i++) {
      const px = x + i, py = y + j;
      const u = i * ux + j * uy, v = -i * uy + j * ux;
      if (u < 0 || u > len) continue;
      const half = 0.7 + Math.min(u, 12) * 0.28 + (rnd(Math.floor(u) * 7 + f) - 0.5) * 1.2;
      if (Math.abs(v) > half) continue;
      const k = Math.abs(v) / half;
      l.px(px, py, k < 0.35 ? (u < 4 ? "#FFF3B0" : "#FFE36B") : k < 0.7 ? "#FF9A2A" : "#F0492F");
    }
  }, "#3A1409");
}

def("dragonchase", "Here Be Dragons", "Books", 72, "Book nod: a dragon story (the lonely mountain, dragon riders, dragon schools).", (g, f) => {
  const s = tl(f, [12, 6, 14, 10, 18, 12]);
  const wing = [0, 1, 2, 1][Math.floor(f / 2) % 4];
  const px = 21;
  // The dragon.
  if (s.k === 0) dragon(g, lerp(-12, 10, eo(s.t)), lerp(-2, 10, eo(s.t)) + Math.sin(s.t * Math.PI) * 4, 1, wing, false);
  if (s.k === 1) dragon(g, 10 - s.t, 10 + (s.n % 4 < 2 ? 0 : 1), 1, 1, false);
  if (s.k === 2) {
    const len = s.n < 4 ? s.n * 4.5 : s.n > 11 ? (14 - s.n) * 5 : 16;
    dragon(g, 9, 10, 1, wing, true);
    breath(g, 18, 8, Math.PI / 4, len, f);
  }
  if (s.k === 3) dragon(g, lerp(10, -14, ei(s.t)), lerp(10, -4, s.t), -1, wing, false);

  // Pip.
  let o = { x: px, la: 28 };
  if (s.k === 0) o = Object.assign(o, { look: [-1, -1], fdx: -1, eyes: s.t > 0.5 ? "wide" : "open", mouth: s.t > 0.5 ? "o" : "smile" });
  if (s.k === 1) {
    const a = s.n % 2 === 0;
    o = Object.assign(o, {
      look: [-1, -1], fdx: -1, eyes: "wide", brows: "up", mouth: "o", sq: -0.06, la: -40, lean: 1,
      feet: (A) => [[A.cx - 3 + (a ? 1.5 : -1.5), A.bottom + 1.1 - (a ? 1 : 0)], [A.cx + 3 + (a ? -1.5 : 1.5), A.bottom + 1.1 - (a ? 0 : 1)]]
    });
  }
  if (s.k === 2) {
    const lit = s.n >= 5;
    o = Object.assign(o, {
      x: px + (s.n % 2 ? 0.5 : -0.5), sq: 0.24, eyes: "squeeze", mouth: "grit", la: lit ? 0 : 10,
      leaf: lit ? "flame" : "leaf", lphase: f * 0.9,
      hands: (A) => [{ x: A.top.x - 4, y: A.top.y + 1 }, { x: A.top.x + 4, y: A.top.y + 1 }]
    });
  }
  if (s.k === 3) o = Object.assign(o, { sq: 0.24 * (1 - eo(s.t)), eyes: s.n === 4 || s.n === 5 ? "blink" : "open", mouth: "o", leaf: "flame", lphase: f * 0.9, under: soot, colors: SOOTY });
  if (s.k === 4) {
    const pat = s.n % 6 < 3, out = s.n >= 10;
    o = Object.assign(o, {
      eyes: "squeeze", mouth: out ? "flat" : "grit", under: soot, colors: SOOTY, la: 20,
      leaf: out ? "leaf" : "flame", lphase: f * 0.9, leafColor: "#4A4640", leafShade: "#2E2B27",
      hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.top.x + 3, y: A.top.y - (pat ? 3 : 6) }]
    });
  }
  if (s.k === 5) o = Object.assign(o, { eyes: s.n < 6 ? "open" : blink(s.n, 12, 9) ? "blink" : "happy", mouth: s.n < 6 ? "o" : "smile", under: soot, colors: SOOTY, la: 20, leafColor: "#4A4640", leafShade: "#2E2B27" });
  g.shadow(o.x, 6);
  const A = drawPip(g, o);

  if (s.k === 1 && s.n % 4 < 3) g.text("!", 27, 2, GOLD);
  if (s.k === 3) for (let i = 0; i < 2; i++) { const t = ((s.n + i * 5) % 10) / 10; fx.puff(g, A.top.x - 3 + i * 7 + t * 2, A.top.y - 8 - t * 6, 0.9 + t, "#9A958A"); }
  if (s.k === 4) {
    const tip = leafTip(A, 20);
    if (s.n % 6 < 3) fx.puff(g, tip[0] + 2, tip[1] - 2 - (s.n % 3), 1.3, "#9A958A");
    if (s.n >= 10) fx.ember(g, Math.round(tip[0]), Math.round(tip[1]), (s.n % 4) / 4);
  }
  if (s.k === 5) {
    const tip = leafTip(A, 20);
    for (let i = 0; i < 3; i++) { const t = ((s.n + i * 4) % 12) / 12; g.px(Math.round(tip[0] + Math.sin(t * 6 + i) * 1.2), Math.round(tip[1] - 1 - t * 6), t < 0.5 ? "#9A958A" : "#9A958A88"); }
    if (s.n < 6 && s.n % 3 === 0) fx.puff(g, A.fc - 1, A.ey + 5, 1, "#9A958A");
  }
}, 28);

// ============================================================ 2. fire eye
const TOWER = "#4B4254", TOWER_D = "#342D3B", TOWER_L = "#6A5E74";
function tower(g) {
  g.stamp((l) => {
    l.rect(4, 13, 6, 19, TOWER).rect(4, 13, 2, 19, TOWER_L).rect(8, 13, 2, 19, TOWER_D);
    l.rect(3, 27, 8, 5, TOWER).rect(9, 27, 2, 5, TOWER_D);
    l.rect(5, 10, 4, 3, TOWER).rect(8, 10, 1, 3, TOWER_D);
    // two horned prongs cradling the eye
    l.px(4, 11, TOWER).px(3, 10, TOWER).px(2, 9, TOWER).px(1, 8, TOWER).px(1, 7, TOWER).px(0, 6, TOWER).px(0, 5, TOWER).px(1, 4, TOWER_L);
    l.px(9, 11, TOWER_D).px(10, 10, TOWER_D).px(11, 9, TOWER_D).px(12, 8, TOWER_D).px(12, 7, TOWER_D).px(13, 6, TOWER_D).px(13, 5, TOWER_D).px(12, 4, TOWER_D);
    l.px(7, 17, "#FFB84D").px(6, 23, "#FFB84D"); // lit slits
  }, "#120E16");
}
function fireEye(g, open, look, f) {
  if (open <= 0) return;
  const cx = 6, cy = 6;
  const H = 0.4 + 2.4 * open;
  // A corona of flame behind the eye.
  g.stamp((l) => {
    for (let i = -6; i <= 6; i++) {
      const edge = 1 - Math.abs(i) / 7.5;
      const h = Math.round((1.5 + rnd(i * 5 + Math.floor(f / 2) * 3) * 2.5) * edge * open + H * edge);
      for (let j = 0; j <= h; j++) l.px(cx + i, cy - j, j > h - 2 ? "#F0492F" : "#FF8A2A");
      if (Math.abs(i) < 5) l.px(cx + i, cy + Math.round(H * edge) + 1, "#F0492F");
    }
  }, "#3A1409");
  // The eye itself: a pointed almond, pale-hot in the middle, with a slit.
  g.stamp((l) => {
    for (let i = -5; i <= 5; i++) {
      const h = Math.round(H * (1 - (i / 5.6) * (i / 5.6)));
      for (let j = -h; j <= h; j++) {
        const r = (i * i) / 30 + (j * j) / (H * H + 0.5);
        l.px(cx + i, cy + j, r > 0.7 ? "#E0492F" : r > 0.3 ? "#FFC53D" : "#FFF3B0");
      }
    }
    if (open > 0.4) {
      const p = Math.round(cx + look), h = Math.round(H);
      l.rect(p, cy - h + 1, 1, Math.max(1, h * 2 - 1), "#1A0A06");
    }
  }, "#2A0A04");
}
const ROCK = "#8C8A84", ROCK_D = "#5E5C58", ROCK_L = "#B5B2AA";
const rock = (g) => g.stamp((l) => l.ell(25, 29, 7.2, 7, (nx, ny) => (ny > 0.62 ? null : nx + ny > 0.5 ? ROCK_D : nx + ny < -0.7 ? ROCK_L : ROCK)).px(22, 25, ROCK_D).px(27, 26, ROCK_D).px(28, 26, ROCK_D), "#26241F");

def("fireeye", "The Watching Eye", "Books", 72, "Book nod: the dark lord's tower and its lidless, burning eye.", (g, f) => {
  const s = tl(f, [10, 8, 8, 16, 20, 10]);
  const open = s.k === 0 ? 0 : s.k === 1 ? eo(s.t) : s.k === 5 ? 1 - eo(s.t) : 1;
  let look = 1.5;
  if (s.k === 3) look = lerp(1, 3, s.t);
  if (s.k === 4) look = 2 * Math.sin(s.n * 0.5);
  tower(g);
  fireEye(g, open, look, f);
  let o;
  if (s.k === 0) {
    const a = f % 8 < 4;
    o = { x: lerp(-6, 16, s.t), fdx: 1, look: [1, 0], la: -10 + wave(f, 8, 8), feet: (A) => [[A.cx - 3 + (a ? 1.6 : -1.6), A.bottom + 1.1 - (a ? 0.8 : 0)], [A.cx + 3 + (a ? -1.6 : 1.6), A.bottom + 1.1 - (a ? 0 : 0.8)]] };
  }
  if (s.k === 1 || s.k === 2) o = { x: 16 + (s.k === 2 && s.n % 2 ? 0.5 : 0), fdx: -1, look: [-1, -1], eyes: "wide", brows: "up", mouth: s.k === 1 ? "o" : "wavy", la: 0, sq: -0.08, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 1 }, { x: A.handR[0] + 1, y: A.cy - 1 }] };
  if (s.k === 3) {
    const step = s.n % 8 < 4;
    o = {
      x: lerp(16, 24, s.t), y: 27 - (step ? 1 : 0), lean: 1, fdx: -1, look: [-1, 0], eyes: "open", brows: "up", mouth: "tiny", la: -20,
      feet: (A) => [[A.cx - 3, A.bottom + 1.3 - (step ? 1 : 0), 1.3], [A.cx + 3, A.bottom + 1.3 - (step ? 0 : 1), 1.3]],
      hands: (A) => [{ x: A.handL[0] - 0.5, y: A.cy - 2 - (step ? 1 : 0) }, { x: A.handR[0] + 0.5, y: A.cy - 2 - (step ? 0 : 1) }]
    };
  }
  if (s.k === 4) {
    const peek = s.n >= 10;
    o = { x: 24, w: 7.5, y: peek ? 29 : 34, look: [-1, 0], fdx: -1, eyes: "wide", mouth: "tiny", la: -10 + (s.n % 2 ? 4 : -4), hands: false, feet: false };
  }
  if (s.k === 5) o = { x: 24, w: 7.5, y: lerp(29, 27, eo(s.t)), eyes: "happy", mouth: "o", la: 28, hands: false, feet: false };
  if (s.k < 4) g.shadow(o.x, 6);
  const A = drawPip(g, o);
  if (s.k >= 3) rock(g);
  if (s.k === 1 && s.n % 4 < 3) g.text("!", 22, 4, GOLD);
  if (s.k === 2) fx.drop(g, A.cx + 8, A.top.y + 3 + s.n * 0.5, SKY);
  if (s.k === 5 && s.n > 2) fx.puff(g, A.cx - 7 - s.t * 2, A.ey + 1, 1.1, WHITE);
}, 48);

// ============================================================ 3. the ring
const ringAt = (g, x, y) => {
  x = Math.round(x); y = Math.round(y);
  g.stamp((l) => l.rect(x, y - 1, 2, 1, GOLD).px(x - 1, y, GOLD).px(x + 2, y, GOLD).px(x - 1, y + 1, "#E0A800").px(x + 2, y + 1, "#E0A800").rect(x, y + 2, 2, 1, "#C08A00").px(x, y - 1, "#FFF6C0"), "#4A3100");
};

def("ring", "Precious", "Books", 72, "Book nod: a plain gold ring that makes its wearer vanish.", (g, f) => {
  const s = tl(f, [10, 8, 10, 10, 6, 14, 14]);
  const ground = [25, 28];
  let rx = ground[0], ry = ground[1], o, fade = 0;
  if (s.k === 0) o = { x: 14, eyes: blink(s.n, 10, 6) ? "blink" : "open", la: 28 + wave(f, 20, 6) };
  if (s.k === 1) o = { x: 14, fdx: 1, look: [1, 1], eyes: "wide", brows: "up", mouth: "o", la: 0 };
  if (s.k === 2) {
    const t = eo(s.t);
    rx = t < 0.5 ? ground[0] : lerp(ground[0], 22, (t - 0.5) * 2); ry = t < 0.5 ? ground[1] : lerp(ground[1], 18, (t - 0.5) * 2);
    o = { x: lerp(14, 16, t), lean: s.t < 0.5 ? 2 : 0, fdx: 1, look: [1, 1], eyes: "wide", mouth: "o", la: 0, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: rx + 1, y: ry + 2 }] };
  }
  if (s.k === 3) {
    const t = eo(s.t);
    rx = lerp(22, 17, t); ry = lerp(18, 22, t);
    o = { x: 16, fdx: 1, look: [1, 0], eyes: s.t < 0.5 ? "star" : "half", mouth: s.t < 0.5 ? "o" : "smirk", la: 10, hands: (A) => [{ x: lerp(A.handL[0], 15, t), y: lerp(A.handL[1], 24, t) }, { x: rx + 2, y: ry + 2 }] };
  }
  if (s.k === 4 || s.k === 5) {
    // Invisible, Pip tiptoes about: only the ring bobs along.
    fade = s.k === 4 ? s.t : 1;
    const x = s.k === 4 ? 16 : 16 + Math.sin(s.t * TAU) * 4;
    const bob = s.k === 5 ? -Math.abs(Math.sin(s.t * TAU * 2)) : 0;
    rx = x + 1; ry = 22 + bob;
    o = { x, y: 28 + bob, eyes: "half", mouth: "smirk", la: 10, hands: (A) => [{ x: x - 1, y: 24 + bob }, { x: rx + 2, y: ry + 2 }] };
  }
  if (s.k === 6) {
    const t = s.t;
    const up = s.n < 8 ? hop(s.n / 8, 5) : 0;
    rx = t < 0.5 ? lerp(20, ground[0], t * 2) : ground[0];
    ry = t < 0.5 ? lerp(18, ground[1], t * 2) + hop(t * 2, 8) : ground[1];
    o = { x: lerp(16, 14, eio(t)), y: 28 + up, eyes: s.n < 11 ? "wide" : "open", brows: "up", mouth: s.n < 8 ? "shout" : "o", la: s.n < 8 ? -10 : 28, hands: s.n < 10 ? (A) => [{ x: A.handL[0] - 2, y: A.cy - 5 }, { x: A.handR[0] + 2, y: A.cy - 5 }] : null };
  }
  if (fade > 0) {
    // Invisible: only a thin shimmer of the outline and the ring remain.
    const olc = g.S.outline;
    remap(g, (gg) => drawPip(gg, o), (c, x, y) => {
      const b = bayer(x, y);
      if (c === olc) return b >= fade * 0.85 ? c : (x + y + (f >> 1)) % 3 === 0 ? "#8FA3BF" : null;
      return b >= fade * 1.3 ? c : null;
    });
    if (s.k === 4 && s.n < 2) fx.star(g, rx + 1, ry, 2, WHITE);
  } else {
    g.shadow(o.x, 6);
    drawPip(g, o);
  }
  if (s.k === 6 && s.n < 3) fx.burst(g, 16, 19, s.n / 3, WHITE);
  ringAt(g, rx, ry);
  if ((s.k === 0 || s.k === 1) && f % 8 < 3) fx.star(g, ground[0] + 3, ground[1] - 2, f % 8 === 1 ? 1 : 0, WHITE);
  if (s.k === 1 && s.n % 4 < 3) g.text("!", 27, 3, GOLD);
  if (s.k === 3 && s.t < 0.6 && s.n % 4 < 2) fx.star(g, rx + 3, ry - 2, 1, WHITE);
  if (s.k === 6 && s.n < 10) g.text("!", 26, 2, GOLD);
}, 30);

// ============================================================ 4. owl post
const OWL = "#9A6A3C", OWL_D = "#6B4424", OWL_F = "#EAD7B8";
function owl(g, x, y, up) {
  x = Math.round(x); y = Math.round(y);
  // Broad wings, three feathers deep, beating up and down.
  g.stamp((l) => {
    for (const d of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const c = j === 2 ? OWL_D : j === 1 ? OWL : "#B5824E";
        if (up) l.line(x + d * 3, y - 1 + j, x + d * (8 - j), y - 5 + j * 2, c);
        else l.line(x + d * 3, y - 1 + j, x + d * (8 - j), y + 2 + j, c);
      }
    }
  }, "#2A180A");
  g.stamp((l) => {
    l.ell(x + 0.5, y + 0.5, 3.4, 3.6, (nx, ny) => (ny > 0.25 && Math.abs(nx) < 0.6 ? ((Math.round(nx * 9) + Math.round(ny * 9)) % 2 ? "#C9A071" : "#B58A5A") : OWL));
    l.px(x - 3, y - 3, OWL_D).px(x + 3, y - 3, OWL_D).px(x - 2, y - 3, OWL).px(x + 2, y - 3, OWL);
    l.rect(x - 3, y - 2, 7, 3, OWL_F);
    l.rect(x - 2, y - 2, 2, 2, "#FFE36B").rect(x + 1, y - 2, 2, 2, "#FFE36B").px(x - 1, y - 1, INKX).px(x + 1, y - 1, INKX);
    l.px(x, y, "#FF9A2A").px(x, y + 1, "#E07A1A");
    l.px(x - 1, y + 4, "#FF9A2A").px(x + 1, y + 4, "#FF9A2A");
  }, "#2A180A");
}
const ENV = "#F6EEDC", ENV_D = "#CDBF9E", SEAL = "#D0302A";
/** A sealed letter, top-left at (x, y), 7x5. open: 0 sealed .. 1 flap up. */
function letter(g, x, y, open = 0) {
  x = Math.round(x); y = Math.round(y);
  g.stamp((l) => {
    if (open > 0.5) { l.rect(x + 1, y - 1, 5, 1, ENV_D).rect(x + 2, y - 2, 3, 1, ENV_D).px(x + 3, y - 3, ENV_D); }
    l.rect(x, y, 7, 5, ENV).rect(x, y + 4, 7, 1, "#E6DCC4");
    if (open <= 0.5) { l.px(x + 1, y + 1, ENV_D).px(x + 2, y + 2, ENV_D).px(x + 5, y + 1, ENV_D).px(x + 4, y + 2, ENV_D); }
    else l.rect(x + 1, y, 5, 1, "#8C7A5A");
    if (open < 0.3) l.rect(x + 3, y + 2, 2, 2, SEAL).px(x + 3, y + 2, "#FF7A6B");
    else if (open <= 0.5) l.px(x + 3, y + 3, SEAL).px(x + 4, y + 2, SEAL);
  }, "#4A3A22");
}

def("owlpost", "Owl Post", "Books", 72, "Book nod: a school of magic, and an owl who delivers the letter.", (g, f) => {
  const s = tl(f, [14, 8, 6, 10, 8, 16, 10]);
  const flap = Math.floor(f / 2) % 2 === 0;
  let ox = null, oy = 6, lx = null, ly = null, lo = 0, o;
  if (s.k === 0) { ox = lerp(-8, 16, s.t); oy = 6 + Math.sin(s.t * TAU) * 1.2; lx = ox - 3; ly = oy + 5; }
  if (s.k === 1) { ox = lerp(16, 42, ei(s.t)); oy = 6 - s.t * 4; }
  if (s.k === 0 || s.k === 1) o = { look: [s.k === 0 ? (s.t < 0.6 ? -1 : 0) : 1, -1], fdx: s.k === 0 && s.t < 0.6 ? -1 : 0, eyes: "open", mouth: s.k === 1 ? "o" : "smile", la: 28 };
  if (s.k === 1) { lx = 12.5; ly = lerp(9, 9, s.t) + ei(s.t) * 0; ly = lerp(9, 11, ei(s.t)); }
  if (s.k === 2) o = { sq: 0.18 * (1 - s.t), eyes: "squeeze", mouth: "o", la: 80 };
  if (s.k === 3) o = { eyes: "wide", mouth: "o", brows: "up", la: 28, hands: (A) => [{ x: A.cx - 5, y: A.cy + 4 }, { x: A.cx + 5, y: A.cy + 4 }] };
  if (s.k === 4) { lo = s.t; o = { eyes: "wide", mouth: "tiny", la: 28, hands: (A) => [{ x: A.cx - 5, y: A.cy + 4 }, { x: A.cx + 5 - (s.n % 4 < 2 ? 0 : 1), y: A.cy + 3 }] }; }
  if (s.k === 5) { lo = 1; o = { eyes: "star", mouth: "open", blush: "big", sq: -0.06, la: 0, hands: (A) => [{ x: A.cx - 5, y: A.cy + 4 }, { x: A.cx + 5, y: A.cy + 4 }] }; }
  if (s.k === 6) { lo = 1; o = { y: 28 + hop(clamp(s.t * 1.6), 3), eyes: "happy", mouth: "smile", blush: "big", la: 20 + wave(s.n, 10, 10), hands: (A) => [{ x: A.cx - 5, y: A.cy + 3 }, { x: A.cx + 5, y: A.cy + 3 }] }; }
  g.shadow(16, 6);
  const A = drawPip(g, o);
  if (s.k === 2) { lx = A.top.x - 3.5; ly = A.top.y - 4; }
  if (s.k >= 3) { lx = A.cx - 3.5; ly = A.cy + 1; }
  if (lx != null) letter(g, lx, ly, lo);
  if (ox != null) owl(g, ox, oy, flap);
  if (s.k === 2) for (let i = 0; i < 3; i++) { const a = s.n * 0.8 + (i * TAU) / 3; fx.star(g, A.cx + Math.cos(a) * 8, A.top.y - 2 + Math.sin(a) * 1.5, 1); }
  if (s.k === 5 || s.k === 6) {
    const n = s.k === 5 ? s.n : 16 + s.n;
    for (let i = 0; i < 6; i++) {
      const t = clamp((n - i * 1.5) / 14, 0, 1);
      if (t <= 0 || t >= 1) continue;
      const a = -Math.PI / 2 + (i % 2 ? 1 : -1) * (0.6 + (i >> 1) * 0.3);
      fx.twinkle(g, A.cx + Math.cos(a) * t * 14, A.cy + 1 + Math.sin(a) * t * 16, (t * 3) % 1, i % 2 ? GOLD : WHITE);
    }
  }
  if (s.k === 4 && s.n > 4) fx.star(g, A.cx, A.cy - 1, 1, WHITE);
}, 52);

// ============================================================ 5. wand spell
const wandAt = (g, hx, hy, ang, len = 9) => {
  const x1 = hx + Math.cos(ang) * len, y1 = hy + Math.sin(ang) * len;
  g.stamp((l) => l.line(hx, hy, x1, y1, "#A8703A").line(hx, hy, hx + Math.cos(ang) * 3, hy + Math.sin(ang) * 3, "#5A3218"), "#1A0E06");
  g.px(x1, y1, WHITE);
  return [x1, y1];
};
const zig = (g, x, y) => {
  x = Math.round(x); y = Math.round(y);
  // a little lightning-bolt spark
  g.stamp((l) => l.rect(x, y - 3, 2, 1, "#FFF3A6").rect(x - 1, y - 2, 2, 1, "#FFF3A6").rect(x - 2, y - 1, 4, 1, "#FFE36B").rect(x, y, 2, 1, "#FFE36B").rect(x - 1, y + 1, 2, 1, "#FFC53D").px(x - 2, y + 2, "#FFC53D"), "#4A3100");
};
const frizz = (f) => (g, A) => {
  const bx = A.top.x, by = A.top.y + 1;
  g.stamp((l) => {
    l.line(bx, by, bx, by - 2, g.S.stem);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.5, len = 6 + (i % 2) * 1.5;
      for (let k = 0; k <= len; k++) {
        const w = ((k + i + (f >> 2)) % 2 ? 0.8 : -0.8);
        l.px(bx + Math.cos(a) * k - Math.sin(a) * w, by - 2 + Math.sin(a) * k + Math.cos(a) * w, k % 3 === 2 ? g.S.leafShade : g.S.leaf);
      }
    }
  });
};

def("wandspell", "Wrong Spell", "Books", 60, "Book nod: wand-waving at a school of magic.", (g, f) => {
  const s = tl(f, [12, 8, 4, 12, 5, 19]);
  let ang = -1.05, o, tip;
  if (s.k === 1) ang = lerp(-2.2, -0.2, eio(s.t));
  if (s.k === 2) ang = lerp(-0.2, -0.7, eo(s.t));
  if (s.k >= 3) ang = -0.7;
  if (s.k === 5) ang = lerp(-0.7, 0.9, eo(clamp(s.t * 3)));
  const glassy = (askew) => (g, A) => glassesOn(g, A, askew);
  const face = s.k < 4 ? { eyes: s.k === 3 ? "wide" : "determined", brows: s.k === 3 ? "up" : "focus", mouth: s.k === 1 ? "o" : s.k === 3 ? "o" : "smirk" } : s.k === 4 ? { eyes: "squeeze", mouth: "shout", brows: "up" } : { eyes: s.n < 8 ? "half" : blink(s.n, 20, 15) ? "blink" : "half", mouth: s.n < 8 ? "flat" : "wavy" };
  o = Object.assign({
    x: 14, la: 28, over: glassy(s.k === 5 ? 1 : 0),
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0], y: A.handR[1] - 2 }]
  }, face);
  if (s.k === 3) o.look = [s.t < 0.4 ? 1 : 0, -1];
  if (s.k >= 4) { o.leaf = "none"; o.behind = frizz(f); }
  if (s.k === 4) o.colors = { base: "#FFF3A6", light: WHITE, shade: "#E0C050", belly: "#FFF9D6" };
  g.shadow(14, 6);
  const A = drawPip(g, o);
  tip = wandAt(g, A.handR[0], A.handR[1] - 2, ang);
  if (s.k === 0 && s.n % 6 < 3) fx.star(g, tip[0], tip[1], 0, WHITE);
  if (s.k === 1) for (let i = 1; i <= 3; i++) { const a = lerp(-2.2, -0.2, eio(clamp(s.t - i * 0.08))); g.px(A.handR[0] + Math.cos(a) * 9, A.handR[1] - 2 + Math.sin(a) * 9, i === 1 ? "#FFF3A6" : "#FFF3A688"); }
  if (s.k === 2 || s.k === 3) {
    // The spark: out to the right, up and round in a loop, then back at the leaf.
    const t = s.k === 2 ? s.t * 0.15 : 0.15 + s.t * 0.85;
    const path = (t) => {
      const p0 = [tip[0], tip[1]], p1 = [34, 0], p2 = [4, -2], p3 = [A.top.x + 1, A.top.y - 3];
      const u = 1 - t;
      return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
    };
    for (let i = 1; i <= 3; i++) { const q = path(clamp(t - i * 0.06)); g.px(q[0], q[1], i < 3 ? "#FFE36B" : "#FFE36B88"); }
    const p = path(t);
    zig(g, p[0], p[1]);
  }
  if (s.k === 4) { fx.burst(g, A.top.x, A.top.y - 3, s.t, "#FFE36B"); }
  if (s.k === 5) {
    for (let i = 0; i < 2; i++) { const t = ((s.n + i * 6) % 12) / 12; fx.puff(g, A.top.x - 3 + i * 6 + t * 2, A.top.y - 8 - t * 5, 0.9 + t * 0.8, "#B8B4AA"); }
    if (s.n % 5 < 2) g.px(A.top.x + ((s.n * 3) % 9) - 4, A.top.y - 6 - (s.n % 3), "#FFE36B");
  }
}, 30);

// ============================================================ 6. wardrobe
const WD = "#8A5A34", WD_D = "#5E3A1F", WD_L = "#B07A48";
const flakes = (g, f, x0, x1, y0, y1, n, seed, drift = 0) => {
  for (let i = 0; i < n; i++) {
    const span = Math.max(1, y1 - y0);
    const y = y0 + ((f * 0.5 + rnd(i + seed) * span) % span);
    const x = x0 + rnd(i + seed + 50) * (x1 - x0) + Math.sin((f + i * 5) * 0.25) + drift * (y - y0) / span;
    g.px(Math.round(x), Math.round(y), WHITE);
  }
};

def("wardrobe", "Through the Wardrobe", "Books", 72, "Book nod: an old wardrobe that opens onto a snowy wood and a lamppost.", (g, f) => {
  const s = tl(f, [10, 10, 16, 22, 14]);
  const open = s.k === 0 ? 0 : s.k === 1 ? eio(s.t) : 1;
  // Frame and interior.
  g.stamp((l) => {
    l.rect(0, 2, 16, 2, WD_D).rect(1, 4, 14, 26, WD).rect(1, 29, 2, 2, WD_D).rect(13, 29, 2, 2, WD_D);
    l.rect(2, 5, 12, 23, "#1E2C4E");
    for (let y = 5; y < 28; y++) if (y > 14) l.rect(2, y, 12, 1, y > 18 ? "#2B3F6A" : "#243560");
    l.rect(2, 24, 12, 4, "#E8F0FF").rect(2, 24, 12, 1, WHITE);
  }, "#2E1D10");
  // The lamppost inside, glowing, and the snowy wood.
  if (open > 0) {
    g.stamp((l) => l.rect(4, 19, 1, 5, "#1B3322").px(3, 21, "#1B3322").px(5, 21, "#1B3322").px(3, 23, "#1B3322").px(5, 23, "#1B3322").px(4, 18, "#1B3322"), "#0C1A10");
    const glow = 0.5 + 0.5 * Math.sin(f * 0.4);
    g.rect(10, 9, 1, 15, "#1B1B22");
    g.px(9, 9, "#FFF3A6aa").px(11, 9, "#FFF3A6aa").px(10, 7, glow > 0.5 ? "#FFF3A6aa" : "#FFF3A655");
    g.stamp((l) => l.rect(9, 8, 3, 2, "#FFE36B").px(10, 8, WHITE), "#1B1B22");
    flakes(g, f, 2, 14, 5, 24, 5, 3);
  }
  // Door: a single panel hinged on the right. Closed it covers the interior;
  // opening, it narrows, then swings out past the hinge.
  const th = open * 1.95;
  const w = Math.round(12 * Math.cos(th));
  g.stamp((l) => {
    if (w > 0) {
      l.rect(14 - w, 5, w, 23, WD_L).rect(14 - w, 5, 1, 23, WD);
      if (w > 4) { l.rect(14 - w + 2, 7, w - 4, 8, WD).rect(14 - w + 2, 17, w - 4, 8, WD); l.px(14 - w + 1, 16, GOLD); }
    } else {
      const ww = Math.max(1, -w);
      for (let i = 0; i < ww; i++) l.rect(14 + i, 5 - Math.round(i * 0.4), 1, 23 + Math.round(i * 0.8), i === ww - 1 ? WD_D : WD);
    }
  }, "#2E1D10");
  if (s.k === 0 && s.n % 4 < 2) { g.px(14, 12, WHITE); g.text("?", 20, 6, WHITE); }
  // Snow drifting out into the room.
  if (s.k >= 1) {
    const k = s.k === 1 ? s.t : 1;
    for (let i = 0; i < Math.round(10 * k); i++) {
      const t = ((f + i * 7) % 36) / 36;
      const x = 12 + t * 20 + Math.sin(t * 9 + i) * 1.5, y = 6 + rnd(i) * 10 + t * 18;
      if (x < 32 && y < 30) g.stamp((l) => l.px(Math.round(x), Math.round(y), WHITE), "#6A7FA8");
    }
    const snow = Math.round(lerp(14, 32, clamp(s.k === 1 ? 0 : s.k === 2 ? s.t * 0.5 : 0.5 + (s.k === 3 ? s.t : 1) * 0.5)));
    if (s.k >= 2) g.stamp((l) => l.rect(14, 30, snow - 14, 2, WHITE).rect(14, 30, snow - 14, 1, "#E8F0FF"), "#6A7FA8");
  }
  // Pip, in a scarf, stepping out.
  if (s.k >= 2) {
    const t = s.k === 2 ? eio(s.t) : 1;
    const walk = s.k === 2 && s.n % 6 < 3;
    const scarfOn = (g, A) => {
      const y = Math.round(A.ey + 5);
      const x0 = Math.round(A.cx - A.rx * 0.85), x1 = Math.round(A.cx + A.rx * 0.85);
      const fl = s.k >= 3 ? Math.round(wave(f, 8, 1)) : 0;
      g.stamp((l) => {
        for (let x = x0; x <= x1; x++) l.rect(x, y, 1, 2, (x >> 1) % 2 ? RED : "#F2E3C2");
        l.rect(x1 - 2, y + 2, 2, 2, RED).rect(x1 - 2 + fl, y + 4, 2, 1, "#F2E3C2");
      }, "#4A1410");
    };
    let o = {
      x: lerp(8, 21, t), y: lerp(26, 29, t), w: lerp(4.5, 8, t), h: lerp(4, 7, t), over: scarfOn,
      eyes: "open", mouth: "smile", la: 28, feet: t < 0.4 ? false : undefined
    };
    if (s.k === 2) Object.assign(o, { eyes: "wide", mouth: "o", la: 28 + (walk ? 8 : -8), y: o.y - (walk ? 0.6 : 0) });
    if (s.k === 3) Object.assign(o, { eyes: "wide", brows: "up", mouth: "o", look: [s.n < 11 ? -1 : 1, -1], fdx: s.n < 11 ? -1 : 1, la: 0, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 2 }, { x: A.handR[0] + 1, y: A.cy - 2 }] });
    if (s.k === 4) Object.assign(o, { eyes: "happy", mouth: s.n < 7 ? "blep" : "smile", blush: "big", la: 28 + wave(s.n, 14, 8), look: [0, -1] });
    if (t > 0.4) g.shadow(o.x, 5);
    const A = drawPip(g, o);
    if (s.k === 4 && s.n < 7) { const fy = Math.round(lerp(A.ey - 9, A.ey + 3, s.n / 7)); g.stamp((l) => l.px(A.fc, fy, WHITE).px(A.fc - 1, fy, WHITE).px(A.fc + 1, fy, WHITE).px(A.fc, fy - 1, WHITE).px(A.fc, fy + 1, WHITE), "#6A7FA8"); }
    if (s.k === 3) fx.twinkle(g, 27, 6, (s.n % 11) / 11, WHITE);
  }
}, 50);


// ============================================================ 7. white rabbit
const RAB_O = "#3A3440";
/** The rabbit mid-dash, facing right; y is the middle of its body. */
function rabbitRun(g, x, y, ph) {
  x = Math.round(x); y = Math.round(y);
  const a = ph % 2 === 0;
  g.stamp((l) => {
    l.line(x + 2, y - 4, x - 1, y - 8, WHITE).line(x + 3, y - 4, x + 1, y - 8, WHITE).px(x, y - 7, "#FFB3C1");
    l.ell(x - 1, y, 3.4, 2.4, WHITE);
    l.ell(x + 3, y - 3, 2.2, 2, WHITE);
    l.rect(x - 1, y - 1, 3, 2, RED);
    l.px(x + 4, y - 4, INKX).px(x + 5, y - 2, "#FFB3C1");
    l.px(x - 5, y - 1, WHITE);
    if (a) l.line(x - 3, y + 2, x - 6, y + 3, WHITE).line(x + 1, y + 2, x + 4, y + 3, WHITE);
    else l.line(x - 2, y + 2, x - 1, y + 4, WHITE).line(x, y + 2, x + 1, y + 4, WHITE);
  }, RAB_O);
  g.stamp((l) => l.ell(x + 5.5, y + 1.5, 1.6, 1.6, (nx, ny) => (nx * nx + ny * ny < 0.3 ? "#FFF6DF" : GOLD)), "#4A3100");
}
/** The rabbit standing up, staring at its pocket watch; y is the ground. */
function rabbitStand(g, x, y, f) {
  x = Math.round(x); y = Math.round(y);
  const tw = f % 4 < 2 ? 0 : 1;
  g.stamp((l) => {
    l.rect(x - 3, y - 15 + tw, 2, 6, WHITE).rect(x + 1, y - 15, 2, 6, WHITE).rect(x - 2, y - 14 + tw, 1, 4, "#FFB3C1").rect(x + 2, y - 14, 1, 4, "#FFB3C1");
    l.ell(x, y - 7.5, 2.8, 2.4, WHITE);
    l.ell(x, y - 2.5, 3.2, 3.2, WHITE);
    l.rect(x - 2, y - 5, 5, 3, RED).px(x, y - 4, GOLD);
    l.px(x - 1, y - 8, INKX).px(x + 1, y - 8, INKX).px(x, y - 7, "#FFB3C1");
    l.rect(x - 3, y, 3, 1, WHITE).rect(x + 1, y, 3, 1, WHITE);
  }, RAB_O);
  g.stamp((l) => l.ell(x + 4, y - 4, 2, 2, (nx, ny) => (nx * nx + ny * ny < 0.35 ? "#FFF6DF" : GOLD)).px(x + 4, y - 4, INKX).px(x + 4, y - 7, GOLD), "#4A3100");
}

def("rabbitwatch", "Late, Late", "Books", 60, "Book nod: a white rabbit with a pocket watch, and a hole to fall down.", (g, f) => {
  const s = tl(f, [10, 8, 10, 6, 12, 4, 10]);
  const px = 10;
  let o;
  const strut = (A, a) => [[A.cx - 3 + (a ? 1.6 : -1.6), A.bottom + 1.1 - (a ? 0.8 : 0)], [A.cx + 3 + (a ? -1.6 : 1.6), A.bottom + 1.1 - (a ? 0 : 0.8)]];
  if (s.k === 0) { const a = f % 8 < 4; o = { x: lerp(-8, px, eo(s.t)), fdx: 1, look: [1, 0], la: -10 + wave(f, 8, 8), feet: (A) => strut(A, a) }; }
  if (s.k === 1 || s.k === 2 || s.k === 3) o = { x: px, look: [1, 0], fdx: 1, eyes: "wide", brows: s.k === 1 ? "up" : null, mouth: "o", la: s.k === 3 ? -30 : 10 };
  if (s.k === 4) {
    // Checks a watch it doesn't have.
    const tap = s.n > 5 && s.n % 4 < 2;
    o = {
      x: px, look: [-1, 1], fdx: -1, eyes: "open", mouth: "flat", la: 20,
      hands: (A) => [{ x: A.cx - 2, y: A.cy + 4 }, { x: tap ? A.cx + 1 : A.handR[0], y: tap ? A.cy + 3 : A.handR[1] }]
    };
  }
  if (s.k === 5) o = { x: px, y: 27, sq: -0.1, eyes: "wide", brows: "up", mouth: "shout", la: -20, look: [1, 0], fdx: 1 };
  if (s.k === 6) {
    const a = f % 4 < 2;
    const x = lerp(px, 44, ei(s.t));
    o = {
      x, lean: 3, fdx: 2, look: [1, 0], eyes: "determined", brows: "focus", mouth: "open", la: -80,
      feet: (A) => [[A.cx - 3 + (a ? 3 : -3), A.bottom + 1.1 - (a ? 1.2 : 0)], [A.cx + 3 + (a ? -3 : 3), A.bottom + 1.1 - (a ? 0 : 1.2)]],
      hands: (A) => [{ x: A.handL[0] + (a ? 2 : -1), y: A.cy - 1 }, { x: A.handR[0] + (a ? -1 : 2), y: A.cy + 1 }]
    };
  }
  // The rabbit pops out from behind Pip, stops dead to check the time, and bolts.
  if (s.k === 1) rabbitRun(g, lerp(6, 23, eo(s.t)), 25 - (Math.floor(f / 2) % 2), Math.floor(f / 2));
  g.shadow(o.x, 6);
  const A = drawPip(g, o);
  if (s.k === 1) for (let i = 0; i < 2; i++) fx.speed(g, 16 + i * 2, 21 + i * 3, 3, "#FFFFFFbb");
  if (s.k === 2) {
    g.shadow(24, 4);
    rabbitStand(g, 24 + (s.n % 2 ? 0.5 : 0), 29, f);
    fx.drop(g, 29, 15 + (s.n % 5), SKY);
    if (s.n % 4 < 3) g.text("!", 20, 2, GOLD);
  }
  if (s.k === 3) {
    const rx = lerp(23, 44, ei(s.t));
    rabbitRun(g, rx, 25 - (Math.floor(f / 2) % 2), Math.floor(f / 2));
    for (let i = 0; i < 3; i++) fx.speed(g, rx - 12 - i * 2, 20 + i * 3, 4, "#FFFFFFbb");
  }
  if (s.k === 4 && s.n > 6) g.text("?", 20, 5, WHITE);
  if (s.k === 5) g.text("!", 20, 3, GOLD);
  if (s.k === 6) {
    for (let i = 0; i < 3; i++) fx.speed(g, A.cx - 16 - i * 2, A.cy - 3 + i * 3, 5, "#FFFFFFbb");
    for (let i = 0; i < 3; i++) { const x = px + 2 + i * 7, d = A.cx - x; if (d > 4 && d < 20) fx.puff(g, x, 27, 2.1); }
  }
}, 26);

// ============================================================ 8. tea party
const hatTall = (g, A, lift = 0) => {
  const x = Math.round(A.top.x), y = Math.round(A.top.y) + 1 - lift;
  g.xform((gg) => gg.stamp((l) => {
    l.rect(x - 7, y, 15, 2, "#2E5E4A").rect(x - 7, y + 1, 15, 1, "#224838");
    l.rect(x - 5, y - 12, 11, 12, "#2E5E4A").rect(x - 5, y - 12, 2, 12, "#3E7A60").rect(x + 4, y - 12, 2, 12, "#224838");
    l.rect(x - 6, y - 13, 13, 1, "#2E5E4A");
    l.rect(x - 5, y - 4, 11, 2, "#C8453B");
    l.rect(x + 1, y - 7, 3, 3, "#F4F1E8").px(x + 2, y - 6, "#C8453B");
  }, "#10241A"), { cx: x, cy: y, rot: -0.12 });
};
const POT = "#4F7FD0", POT_L = "#9FC0F5", POT_D = "#3558A0";
function teapot(g, x, y, tilt) {
  g.xform((gg) => gg.stamp((l) => {
    l.ell(x, y, 3.6, 2.8, (nx, ny) => (nx + ny < -0.7 ? POT_L : nx + ny > 0.6 ? POT_D : POT));
    l.px(x - 1, y, WHITE).px(x + 1, y + 1, WHITE).px(x + 2, y - 1, WHITE);
    l.rect(x - 2, y - 3, 5, 1, POT_D).px(x, y - 4, GOLD);
    l.line(x + 3, y, x + 6, y - 3, POT).line(x + 3, y + 1, x + 6, y - 2, POT_D);
    l.px(x - 4, y - 1, POT_D).px(x - 5, y, POT_D).px(x - 5, y + 1, POT_D).px(x - 4, y + 2, POT_D);
  }, "#16244A"), { cx: x, cy: y, rot: tilt });
  const a = tilt;
  return [x + 6 * Math.cos(a) + 3 * Math.sin(a), y - 3 * Math.cos(a) + 6 * Math.sin(a)];
}
const TEA = "#8A4A1A", TEA_L = "#B8702E", CUP = "#F28FA8";

def("teaparty", "Mad Tea", "Books", 60, "Book nod: an unending tea party, a hatter, and far too much tea.", (g, f) => {
  const s = tl(f, [10, 16, 14, 8, 12]);
  const tilt = s.k === 0 ? lerp(0, 0.7, eo(s.t)) : s.k <= 2 ? 0.7 : s.k === 3 ? lerp(0.7, 0, eo(s.t)) : 0;
  const pouring = (s.k === 0 && s.t > 0.6) || s.k === 1 || s.k === 2;
  const level = s.k === 0 ? 0 : s.k === 1 ? s.t : 1;
  const spill = s.k === 2 ? s.t : s.k > 2 ? 1 : 0;
  // A table in a white cloth, a pink cup on a saucer.
  g.stamp((l) => {
    l.rect(20, 30, 1, 2, "#5E3A1F").rect(30, 30, 1, 2, "#5E3A1F");
    l.rect(19, 25, 13, 5, "#F4F1E8").rect(19, 25, 13, 1, WHITE);
    for (let x = 19; x < 32; x += 3) l.px(x + 1, 29, "#DDD6C6");
  }, "#4A4438");
  const cx = 24, cy = 20;
  g.stamp((l) => {
    l.rect(cx - 1, cy + 4, 7, 1, WHITE);
    l.rect(cx, cy, 5, 4, CUP).px(cx + 5, cy + 1, CUP).px(cx + 6, cy + 2, CUP).px(cx + 5, cy + 3, CUP);
    l.rect(cx + 1, cy + 2, 3, 1, WHITE);
    const lv = Math.round(level * 2);
    if (lv > 0) l.rect(cx, cy + (lv > 1 ? 0 : 1), 5, 1, TEA);
    if (level >= 1) l.rect(cx, cy - 1, 5, 1, TEA).px(cx + 1, cy - 1, TEA_L);
  }, "#4A2030");
  if (spill > 0) {
    // Overflow: down both sides of the cup, a stain across the cloth, dripping.
    const reach = Math.round(spill * 6);
    g.rect(cx - 1, cy, 1, 4, TEA).rect(cx + 5, cy, 1, 1, TEA);
    g.rect(Math.max(19, cx - 1 - reach), 25, 7 + reach * 2, 1, TEA);
    for (let x = Math.max(19, cx - 1 - reach); x < Math.min(32, cx + 6 + reach); x++) {
      const drip = Math.round(spill * 3 * (0.4 + rnd(x) * 0.6));
      if (drip > 0) g.rect(x, 26, 1, drip, "#C9A078");
    }
    if (spill > 0.5) { const d = f % 6; g.px(19, 29 + (d >> 1), TEA).px(31, 30 + (((d + 3) % 4) >> 1), TEA); }
  }
  // Pip in a hat far too large, pouring, whistling, not looking.
  const o = {
    x: 11, leaf: "none", eyes: blink(f, 20, 16) ? "blink" : "open", look: [-1, 0], fdx: -1, mouth: "whistle", la: 0,
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: 18, y: 16 }]
  };
  if (s.k === 2) Object.assign(o, { eyes: "happy", mouth: "smile", look: [0, 0], fdx: 0 });
  if (s.k === 3) Object.assign(o, { eyes: "wide", brows: "up", mouth: "o", look: [1, 1], fdx: 1 });
  if (s.k === 4) Object.assign(o, { eyes: "happy", mouth: "open", blush: "big", look: [0, 0], fdx: 0, leaf: "leaf", la: wave(s.n, 6, 20), hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.top.x + 6, y: A.top.y - 6 }] });
  g.shadow(11, 7);
  const A = drawPip(g, o);
  const lift = s.k === 4 ? Math.round(6 * Math.sin(Math.PI * clamp(s.t * 1.2))) : 0;
  hatTall(g, A, lift);
  if (s.k !== 4) {
    const sp = teapot(g, 21, 14, tilt);
    if (pouring) g.stamp((l) => l.line(sp[0], sp[1] + 1, cx + 2, cy - 1, TEA), "#3A2410");
  } else teapot(g, 26, 16, 0);
  if (s.k === 1 || s.k === 2) fx.note(g, 1 + (f % 8 < 4 ? 0 : 1), 4 - (f % 12) * 0.2);
  if (s.k === 3 && s.n % 4 < 3) g.text("!", 28, 4, GOLD);
}, 36);

// ============================================================ 9. tornado
function funnel(g, cx, f, top = 0, bottom = 31, reach = 1) {
  g.stamp((l) => {
    for (let y = top; y <= bottom; y++) {
      const k = (31 - y) / 29;
      const hw = (1.2 + k * 11) * reach;
      const c = cx + Math.sin(y * 0.35 + f * 0.5) * 1.6 * k;
      for (let x = Math.floor(c - hw); x <= Math.ceil(c + hw); x++) {
        const v = (x + 0.5 - c) / hw;
        if (Math.abs(v) > 1) continue;
        const cs = Math.cos(Math.asin(clamp(v, -1, 1)) * 2 + f * 0.7 + y * 0.45);
        l.px(x, y, cs > 0.45 ? "#C9CED6" : cs > -0.35 ? "#9AA1AD" : "#737A87");
      }
    }
  }, "#2E3440");
}
const tinyHouse = (g, x, y, rot) => g.xform((gg) => gg.stamp((l) => l.rect(x - 2, y - 1, 4, 3, "#E8D2A6").px(x - 1, y, "#5B7FD6").rect(x - 3, y - 2, 6, 1, RED).rect(x - 2, y - 3, 4, 1, RED).rect(x - 1, y - 4, 2, 1, RED), "#3A2410"), { cx: x, cy: y, rot });
const rubyShoes = (A, apart, glint) => (g) => {
  for (const side of [-1, 1]) {
    const x = A.cx + side * apart, y = A.bottom + 1.1;
    g.stamp((l) => l.ell(x, y, 2.3, 1.4, (nx, ny) => (ny < -0.2 && nx < 0.2 ? "#FF6B7A" : "#C8102E")), "#3A0610");
    g.px(Math.round(x - 1 + ((glint + (side > 0 ? 2 : 0)) % 3)), Math.round(y - 1), WHITE);
  }
};
/** Rotation snapped to quarter turns, so a tumbling Pip stays crisp pixel art. */
const quarter = (r) => Math.round(r / (Math.PI / 2)) * (Math.PI / 2);
const tumble = (g, o, cx, cy, rot) => g.xform((gg) => drawPip(gg, o), { cx: Math.round(cx), cy: Math.round(cy), rot: quarter(rot) });

def("tornado", "Twister", "Books", 72, "Book nod: a farm girl, a twister, and a pair of ruby slippers.", (g, f) => {
  const s = tl(f, [10, 10, 20, 10, 22]);
  const flail = (A) => [{ x: A.handL[0] - 2, y: A.cy - 5 }, { x: A.handR[0] + 2, y: A.cy - 5 }];
  const dangle = (A) => [[A.cx - 3, A.bottom + 1.5], [A.cx + 3, A.bottom + 1.5]];
  if (s.k === 0) {
    funnel(g, lerp(40, 26, eo(s.t)), f, 0, 31, lerp(0.4, 0.8, s.t));
    g.shadow(13, 6);
    drawPip(g, { x: 13, lean: -1.5, look: [1, 0], fdx: 1, eyes: "wide", brows: "up", mouth: "o", la: -70 + wave(f, 3, 10), hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 2 }, { x: A.handR[0] + 1, y: A.cy - 3 }] });
    for (let i = 0; i < 3; i++) fx.speed(g, 32 - ((f * 3 + i * 11) % 34), 8 + i * 6, 4, "#FFFFFFaa");
    return;
  }
  if (s.k === 1) {
    funnel(g, lerp(26, 16, eio(s.t)), f, 0, 31, 0.9);
    const lift = eio(s.t) * 6;
    tumble(g, { x: lerp(13, 15, s.t), y: 28 - lift, eyes: "wide", mouth: "shout", brows: "up", la: -40, feet: dangle, hands: flail }, 15, 21 - lift, s.t > 0.6 ? -Math.PI / 2 : 0);
    return;
  }
  if (s.k === 2) {
    funnel(g, 16, f, 0, 31, 1);
    const ph = s.t * TAU * 2;
    const x = 16 + Math.cos(ph) * 6, y = 24 - Math.sin(s.t * Math.PI) * 10 + Math.sin(ph) * 2;
    tinyHouse(g, 16 - Math.cos(ph) * 8, 8 + Math.sin(ph) * 2, quarter(ph));
    tumble(g, { x, y, eyes: "spiral", eyePhase: f, mouth: "shout", la: -40, feet: dangle, hands: flail }, x, y - 7, f * 0.8);
    for (let i = 0; i < 3; i++) { const a = f * 0.7 + i * 2.1; if (Math.sin(a) > 0) g.line(16 + Math.cos(a) * 9, 10 + i * 7, 16 + Math.cos(a + 0.3) * 9, 10 + i * 7 + 1, "#E6E9EE"); }
    return;
  }
  if (s.k === 3) {
    funnel(g, 16, f, 0, Math.round(lerp(31, -2, eo(s.t))), 1 - s.t * 0.5);
    const y = lerp(10, 28, ei(s.t));
    g.shadow(16, 3 + 3 * s.t);
    tumble(g, { y, eyes: "spiral", eyePhase: f, mouth: "o", la: 60, sq: s.t > 0.9 ? 0.2 : -0.05 }, 16, y - 7, s.t > 0.8 ? 0 : (1 - s.t) * 5);
    return;
  }
  // Landed: dizzy, then notices the red shoes and clicks its heels three times.
  const clicks = [8, 12, 16];
  const click = clicks.some((c) => s.n >= c && s.n < c + 2);
  const apart = click ? 1.8 : 3.5;
  let face = { eyes: "spiral", eyePhase: f, mouth: "wavy", la: 60 };
  if (s.n >= 3) face = { eyes: "wide", mouth: "o", look: [0, 1], la: 20 };
  if (s.n >= 7) face = { eyes: "closed", mouth: "smile", la: 28, blush: "big" };
  if (s.n >= 19) face = { eyes: "happy", mouth: "open", la: 0, blush: "big" };
  g.shadow(16, 6);
  const A = drawPip(g, Object.assign({ sq: s.n < 2 ? 0.2 : 0, feet: false, y: 28 - (click ? 1 : 0), behind: (g, A) => rubyShoes(A, apart, f)(g) }, face));
  if (s.n >= 2 && s.n < 5) fx.burst(g, A.cx, A.bottom, (s.n - 2) / 3, "#FF6B7A");
  if (click) fx.star(g, A.cx, A.bottom + 1, 1, WHITE);
  if (s.n >= 19) { fx.twinkle(g, 5, 8, (s.n % 6) / 6, "#FF6B7A"); fx.twinkle(g, 27, 6, ((s.n + 3) % 6) / 6, GOLD); }
}, 30);

// ============================================================ 10. runaway shadow
const SHD = "#2C2940", SHD_O = "#6A66A0", SHD_E = "#D6D2F4";
/** Pip's shadow: a dark Pip silhouette with pale eyes. stand 0 lies flat on
 the ground; stand 1 has peeled itself up to run about. */
function shadowPip(g, x, stand, legs, f, eyes = "happy") {
  const inkc = g.S.ink, olc = g.S.outline;
  const squash = lerp(2.8, 1, stand);
  const a = f % 4 < 2;
  layered(g, (gg) => drawPip(gg, {
    x, y: 29, eyes, mouth: stand > 0.5 ? "smile" : "tiny", blush: false, la: legs ? -40 : 28,
    hands: stand > 0.5 ? (A) => [{ x: A.handL[0] + (a ? 1 : -1), y: A.handL[1] }, { x: A.handR[0] + (a ? -1 : 1), y: A.handR[1] }] : false,
    feet: legs ? (A) => [[A.cx - 3 + (a ? 2 : -2), A.bottom + 1.1 - (a ? 1 : 0)], [A.cx + 3 + (a ? -2 : 2), A.bottom + 1.1 - (a ? 0 : 1)]] : false
  }), (d) => {
    const src = d.slice();
    d.fill(null);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const sy = Math.round(31 - (31 - y) * squash);
      if (sy < 0 || sy > 31) continue;
      const c = src[sy * 32 + x];
      if (c) d[y * 32 + x] = c === inkc ? SHD_E : c === olc ? SHD_O : SHD;
    }
  });
}

def("flyshadow", "Runaway Shadow", "Books", 72, "Book nod: the boy who never grew up, and the shadow that ran off.", (g, f) => {
  const s = tl(f, [10, 12, 14, 16, 20]);
  const dust = (n) => { for (let i = 0; i < 4; i++) { const t = ((n + i * 3) % 12) / 12; const x = i % 2 ? 1 + i : 30 - i; fx.star(g, x, 6 + t * 14, t < 0.5 ? 1 : 0, GOLD); } };
  const hover = (A) => [[A.cx - 3, A.bottom + 2], [A.cx + 3, A.bottom + 2]];
  if (s.k === 0) {
    shadowPip(g, 16, 0, false, f);
    drawPip(g, { eyes: blink(s.n, 10, 6) ? "blink" : "open", la: 28, look: [0, 1] });
    return;
  }
  if (s.k === 1) {
    const t = eio(s.t);
    shadowPip(g, 16, 0, false, f);
    drawPip(g, { x: lerp(16, 10, t), y: 28 - t * 7, eyes: "happy", mouth: "open", la: lerp(28, 55, t) + wave(s.n, 12, 8), feet: hover, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 3 }, { x: A.handR[0] + 1, y: A.cy - 3 }] });
    dust(s.n);
    return;
  }
  if (s.k === 2) {
    // The shadow stays behind, peels itself off the ground, grins, and legs it.
    const stand = s.n < 3 ? 0 : clamp((s.n - 3) / 4);
    const sx = s.n < 8 ? lerp(16, 22, clamp(s.n / 7)) : lerp(22, -14, ei((s.n - 8) / 6));
    shadowPip(g, sx, stand, s.n >= 8, f, s.n >= 5 && s.n < 8 ? "wide" : "happy");
    drawPip(g, { x: 10, y: 21 + wave(s.n, 14, 0.8), look: [1, 1], fdx: 1, eyes: s.n < 4 ? "happy" : "wide", brows: s.n < 4 ? null : "up", mouth: s.n < 4 ? "smile" : "o", la: 55, feet: hover });
    if (s.n >= 5 && s.n % 4 < 3) g.text("!", 1, 1, GOLD);
    return;
  }
  if (s.k === 3) {
    // Back in from the left, the shadow first, Pip flying flat out behind it.
    const sx = lerp(-8, 26, s.t), px = sx - 14 + s.t * 4;
    shadowPip(g, sx, 1, true, f);
    drawPip(g, { x: px, y: 20, lean: 3, fdx: 2, look: [1, 1], eyes: "determined", brows: "focus", mouth: "open", la: -90, feet: (A) => [[A.cx - 8, A.bottom - 2], [A.cx - 7, A.bottom]], hands: (A) => [{ x: A.cx + 9, y: A.cy - 1 }, { x: A.cx + 9, y: A.cy + 2 }] });
    for (let i = 0; i < 3; i++) fx.speed(g, px - 17 - i, 10 + i * 3, 4, "#FFFFFFbb");
    return;
  }
  // Pounce: Pip drops on the shadow and it flattens back underneath.
  const land = eo(clamp(s.t * 2.5));
  const x = lerp(14, 18, land), y = lerp(20, 28, land);
  const hit = s.t > 0.38;
  const stand = hit ? Math.max(0, 1 - (s.t - 0.38) * 6) : 1;
  if (!hit) shadowPip(g, 22, 1, false, f, "wide");
  else shadowPip(g, 18, stand, false, f);
  drawPip(g, {
    x, y, sq: hit && s.n < 12 ? 0.18 : 0, eyes: hit ? (s.n > 12 ? "happy" : "squeeze") : "determined", mouth: hit ? (s.n > 12 ? "smirk" : "open") : "open", blush: hit ? "big" : true, la: hit ? 28 : -40,
    hands: hit && s.n > 12 ? (A) => [{ x: A.handL[0] + 1, y: A.cy + 3 }, { x: A.handR[0] - 1, y: A.cy + 3 }] : null
  });
  if (hit && s.n < 12) { fx.puff(g, x - 11, 27, 2.2); fx.puff(g, x + 11, 27, 2.2); }
}, 30);

// ============================================================ 11. coin push
const coin = (g, x, y, spin = 0) => {
  x = Math.round(x); y = Math.round(y);
  const edge = spin % 4 === 1 || spin % 4 === 3;
  g.stamp((l) => (edge
    ? l.rect(x, y - 1, 1, 4, "#E0A800")
    : l.rect(x - 1, y - 1, 4, 4, GOLD).px(x - 1, y - 1, null).px(x + 2, y - 1, null).px(x - 1, y + 2, null).px(x + 2, y + 2, null).px(x, y, "#FFF6C0").px(x + 1, y + 1, "#E0A800")), "#4A3100");
};
const blueLines = (g, x0, y0, x1, y1, f) => {
  for (let k = -1; k <= 1; k++) {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      if ((i + f + k) % 3 === 0) continue;
      g.px(lerp(x0 + k * 0.6, x1 + k * 2, i / n), lerp(y0, y1, i / n), k === 0 ? "#BFF0FF" : "#5CC8FF");
    }
  }
};

def("coinpush", "Steel Push", "Books", 60, "Book nod: a thief who burns metals and flies by pushing on coins.", (g, f) => {
  const s = tl(f, [10, 6, 6, 12, 6, 12, 8]);
  const cx = 16, cy = 29;
  let o = null, coinPos = null, px = 16;
  if (s.k === 0) { coinPos = [24, 13]; o = { eyes: "determined", brows: "focus", mouth: "smirk", la: 20, look: [1, -1], hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: 24.5, y: 17 }] }; }
  if (s.k === 1) { const t = ei(s.t); coinPos = [lerp(24, cx, t), lerp(13, cy, t)]; o = { eyes: "determined", brows: "focus", mouth: "flat", la: 20, sq: 0.1 * s.t, look: [0, 1], hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0] + 1, y: A.handR[1] + 2 }] }; }
  if (s.k === 2) { coinPos = [cx, cy]; o = { y: 27, sq: 0.2, eyes: "squeeze", brows: "focus", mouth: "grit", la: 0, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy + 3 }, { x: A.handR[0] + 1, y: A.cy + 3 }] }; }
  if (s.k === 3) { coinPos = [cx, cy]; o = { y: lerp(26, -18, ei(s.t)), sq: -0.2, eyes: "squeeze", mouth: "shout", la: 0, ll: 1.2, feet: (A) => [[A.cx - 2, A.bottom + 1.5, 1.8], [A.cx + 2, A.bottom + 1.5, 1.8]], hands: (A) => [{ x: A.handL[0] + 1, y: A.cy - 6 }, { x: A.handR[0] - 1, y: A.cy - 6 }] }; }
  if (s.k === 4) coinPos = [cx, cy];
  if (s.k === 5) { coinPos = [cx, cy]; px = 11; o = { x: px, y: lerp(-10, 28, eio(s.t)), sq: s.t > 0.9 ? 0.2 : -0.05, eyes: "happy", mouth: "open", la: 0, ll: 1.3, feet: (A) => [[A.cx - 3, A.bottom + 1.3], [A.cx + 3, A.bottom + 1.3]], hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 4 }, { x: A.handR[0] + 2, y: A.cy - 4 }] }; }
  if (s.k === 6) {
    const t = s.t;
    px = lerp(11, 16, eo(t));
    coinPos = t < 0.5 ? [cx, cy] : [lerp(cx, 24, (t - 0.5) * 2), lerp(cy, 13, eo((t - 0.5) * 2))];
    o = { x: px, eyes: "half", mouth: "smirk", la: 20, lean: t < 0.5 ? 2 : 0, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: t < 0.5 ? coinPos[0] + 1 : lerp(A.handR[0], 24.5, (t - 0.5) * 2), y: t < 0.5 ? coinPos[1] - 2 : coinPos[1] + 4 }] };
  }
  if (o && s.k !== 3) g.shadow(o.x ?? 16, 6);
  if (s.k === 3 || s.k === 4) {
    const top = s.k === 3 ? lerp(19, -26, ei(s.t)) : -8;
    blueLines(g, cx + 0.5, cy - 1, 16, top, f);
    if (s.k === 3 && s.t < 0.8) for (let i = 0; i < 2; i++) fx.puff(g, cx - 7 + i * 14 + (i ? s.t : -s.t) * 3, 27 - s.t * 2, 2 + s.t);
  }
  if (s.k === 2) blueLines(g, cx + 0.5, cy - 1, 16, 22, f);
  if (o) drawPip(g, o);
  if (coinPos) coin(g, coinPos[0], coinPos[1], s.k === 1 ? s.n : 0);
  if (s.k === 2) fx.burst(g, cx + 0.5, cy, s.n / 6, "#5CC8FF");
  if (s.k === 4) fx.twinkle(g, 16, 2 + s.n, s.t, "#BFF0FF");
  if (s.k === 5 && s.t > 0.9) { fx.puff(g, 2, 27, 2); fx.puff(g, 20, 27, 2); }
  if (s.k === 0 && s.n % 5 < 2) fx.star(g, 26, 11, 1, WHITE);
}, 28);

// ============================================================ 12. trident
const tridentAt = (g, x, top, len = 20) => {
  x = Math.round(x); top = Math.round(top);
  g.stamp((l) => {
    l.rect(x, top + 3, 1, len - 3, "#B8902A");
    l.rect(x - 2, top + 3, 5, 1, GOLD);
    l.rect(x - 2, top, 1, 3, GOLD).rect(x, top - 1, 1, 4, GOLD).rect(x + 2, top, 1, 3, GOLD);
    l.px(x, top - 1, WHITE);
  }, "#4A3100");
};
const SEA = "#2F8FE6", SEA_L = "#7CC8FF", SEA_D = "#1F6FC0";
const seaPx = (x, y, top, f) => (y === top ? WHITE : y < top + 2 ? SEA_L : (x * 3 + y * 5 + f) % 11 === 0 ? SEA_L : y > top + 8 ? SEA_D : SEA);
/** A breaking wave: a back slope up to a crest at (cx, cy), and a lip that
 curls lip pixels out to the right over a hollow face. */
function breaker(g, cx, cy, lip, f) {
  cx = Math.round(cx); cy = Math.round(cy);
  g.stamp((l) => {
    for (let x = 0; x < 32; x++) {
      let top = x <= cx ? cy + Math.round(Math.pow(cx - x, 1.25) * 0.55) : cy + 4 + Math.round((x - cx) * 2.2);
      top += Math.round(Math.sin((x + f) * 0.7) * 0.5);
      for (let y = Math.max(top, 0); y < 32; y++) l.px(x, y, seaPx(x, y, top, f));
    }
    for (let i = 0; i <= lip; i++) {
      const y = cy + Math.round((i / Math.max(1, lip)) ** 2 * 4);
      l.px(cx + i, y, WHITE).px(cx + i, y + 1, SEA_L);
    }
  }, "#0E2E52");
}

def("trident", "Sea Legs", "Books", 60, "Book nod: a demigod kid with a trident and the sea on its side.", (g, f) => {
  const s = tl(f, [10, 8, 14, 6, 6, 6, 10]);
  const tx = 23;
  const raise = s.k === 0 ? 0 : s.k === 1 ? eo(s.t) : 1;
  const ttop = lerp(11, 1, raise);
  // The wave rises behind Pip.
  if (s.k === 2) breaker(g, lerp(4, 10, s.t), lerp(31, 3, eo(s.t)), Math.round(lerp(0, 7, s.t)), f);
  const wet = s.k >= 5;
  const o = {
    eyes: wet ? (s.k === 5 || s.n < 4 ? "closed" : "happy") : s.k === 2 ? "open" : s.k >= 3 ? "squeeze" : "determined",
    brows: s.k < 2 ? "focus" : s.k === 2 ? "up" : null, look: s.k === 2 ? [-1, -1] : [0, 0],
    mouth: wet ? (s.k === 5 ? "wavy" : "smirk") : s.k === 2 ? "o" : s.k >= 3 ? "grit" : "smirk", la: wet ? -80 : 28, leaf: wet ? "wilt" : "leaf",
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: tx, y: ttop + 11 }],
    colors: wet ? { base: "#5FB05A", light: "#8FD27A" } : null, blush: wet ? "big" : true
  };
  g.shadow(16, 6);
  const A = drawPip(g, o);
  // The crash: the whole scene floods, only the trident sticks out, then it drains.
  const water = s.k === 3 ? lerp(-6, 8, eo(s.t)) : s.k === 4 ? 8 + wave(s.n, 6, 0.8) : s.k === 5 ? lerp(8, 33, ei(s.t)) : null;
  if (water != null) {
    const wy = Math.round(water);
    g.stamp((l) => {
      for (let x = 0; x < 32; x++) {
        const top = wy + Math.round(Math.sin((x + f * 1.5) * 0.6) * 0.8);
        for (let y = Math.max(0, top); y < 32; y++) l.px(x, y, seaPx(x, y, top, f));
      }
    }, "#0E2E52");
    if (s.k === 4) for (let i = 0; i < 3; i++) { const t = ((s.n + i * 2) % 6) / 6; g.px(A.cx - 5 + i * 5, Math.round(26 - t * 16), WHITE); }
  }
  tridentAt(g, tx, ttop);
  if (s.k === 3) for (let i = 0; i < 5; i++) fx.drop(g, 3 + i * 6 + rnd(i) * 2, Math.round(water) - 3 - rnd(i + 5) * 4, SKY);
  if (s.k === 6) {
    for (let i = 0; i < 4; i++) { const t = ((s.n + i * 3) % 8) / 8; g.px(Math.round(A.cx - 7 + i * 4.5), Math.round(A.cy + 3 + t * 6), i % 2 ? SKY : "#5AB8FF"); }
    if (s.n < 5) fx.drop(g, A.top.x + 3, A.top.y - 1 + s.n, SKY);
    g.rect(6, 30, 20, 1, "#5AB8FF").rect(8, 31, 16, 1, SEA);
    if (s.n > 3) fx.twinkle(g, tx + 3, ttop + 1, ((s.n - 3) % 7) / 7, WHITE);
  }
  if (s.k === 1 && s.t > 0.6) fx.star(g, tx, ttop - 2, 1, WHITE);
}, 57);

// ============================================================ 13. mockingjay
/** A little gold bird, wings raised, pinned on the chest. */
const pin = (g, A, shine) => {
  const x = Math.round(A.cx + 4), y = Math.round(A.cy + 4);
  g.stamp((l) => {
    l.rect(x - 1, y - 2, 3, 5, GOLD).rect(x - 2, y - 1, 5, 3, GOLD);
    l.px(x - 1, y - 1, "#7A5200").px(x + 1, y - 1, "#7A5200").px(x, y, "#7A5200").px(x, y + 1, "#7A5200");
  }, "#4A3100");
  if (shine) g.px(x - 1, y - 2, WHITE);
};
function bow(g, x, top, bottom, pull) {
  g.stamp((l) => {
    const mid = (top + bottom) / 2, r = (bottom - top) / 2;
    for (let y = top; y <= bottom; y++) {
      const k = (y - mid) / r;
      l.px(Math.round(x + 2.5 * Math.sqrt(Math.max(0, 1 - k * k))), y, y === Math.round(mid) ? "#3A2410" : "#8A5A34");
    }
  }, "#1A0E06");
  g.line(x, top, pull[0], pull[1], "#E6E0D2").line(pull[0], pull[1], x, bottom, "#E6E0D2");
}
/** A raised hand, three fingers up (the gaps between them take the outline). */
const threeFingers = (g, x, y) => {
  x = Math.round(x); y = Math.round(y);
  const S = g.S;
  g.stamp((l) => {
    l.ell(x + 0.5, y + 0.5, 1.9, 1.7, (nx, ny) => (nx + ny > 0.5 ? S.shade : S.base));
    l.rect(x - 1, y - 5, 1, 4, S.base).rect(x + 1, y - 6, 1, 5, S.base).rect(x + 3, y - 5, 1, 4, S.base);
  });
};

def("mockingjay", "Three Fingers", "Books", 60, "Book nod: a girl on fire, a three-finger salute, and a bird pin.", (g, f) => {
  const s = tl(f, [10, 16, 6, 16, 4, 8]);
  const bowX = 26;
  let o;
  const r1 = s.k === 1 ? eo(clamp(s.t * 3)) : 0;
  if (s.k === 0) o = { eyes: blink(s.n, 10, 6) ? "blink" : "open", mouth: "flat", la: 28 };
  if (s.k === 1) o = { eyes: s.t > 0.3 ? "closed" : "open", brows: "focus", mouth: "flat", la: 28, hands: (A) => (r1 < 1 ? [{ x: A.handL[0], y: A.handL[1] }, { x: lerp(A.handR[0], 24, r1), y: lerp(A.handR[1], 12, r1) }] : [{ x: A.handL[0], y: A.handL[1] }]) };
  if (s.k === 2) o = { eyes: "determined", brows: "focus", mouth: "flat", la: 20, fdx: 1, look: [1, 0] };
  if (s.k === 3 || s.k === 4) {
    const pull = s.k === 3 ? eo(clamp(s.t * 1.6)) : 0;
    o = { fdx: 1, look: [1, 0], eyes: "determined", brows: "focus", mouth: s.k === 4 ? "o" : "grit", la: -10, lean: -0.5 * pull, x: 15 + (s.k === 3 && s.t > 0.7 && s.n % 2 ? 0.5 : 0), hands: (A) => [{ x: lerp(bowX - 2, 18, pull), y: 22 }, { x: bowX, y: 22 }] };
  }
  if (s.k === 5) o = { eyes: "happy", mouth: "smile", la: 28, sq: -0.04, blush: "big" };
  g.shadow(o.x ?? 16, 6);
  const A = drawPip(g, Object.assign(o, { under: (g, A) => pin(g, A, s.k === 5 || f % 12 < 2) }));
  if (s.k === 1 && r1 >= 1) {
    threeFingers(g, 24, 12);
    if (s.t > 0.5) fx.note(g, 2, 8 - (s.n % 8) * 0.4, "#8E5CFF");
  }
  if (s.k >= 2 && s.k <= 4) {
    const pull = s.k === 3 ? eo(clamp(s.t * 1.6)) : 0;
    const px = lerp(bowX - 1, 18, pull);
    bow(g, bowX, 13, 31, [px, 22]);
    if (s.k === 3) g.stamp((l) => l.line(px, 22, px + 12, 22, "#8A5A34").px(px + 12, 22, "#C9D1DB").px(px + 11, 21, "#C9D1DB").px(px + 11, 23, "#C9D1DB").px(px, 21, RED).px(px, 23, RED), "#1A0E06");
  }
  if (s.k === 4) { const ax = 30 + s.n * 6; g.line(ax - 6, 22, ax, 22, "#8A5A34"); for (let i = 0; i < 3; i++) fx.speed(g, 20 + i * 2, 19 + i * 3, 4, "#FFFFFFbb"); }
  if (s.k === 5) { fx.star(g, A.cx + 4, A.cy + 4, s.n < 4 ? 2 : 1, WHITE); fx.twinkle(g, 26, 6, s.t, "#FF8A2A"); fx.twinkle(g, 5, 10, (s.t + 0.5) % 1, GOLD); }
}, 44);
