/* Book scenes, part of ./index.js. */
import { drawPip, drawHand } from "../engine.js";
import { def, fx, prop, kit } from "../anims.js";

const { TAU, wave, tri, lerp, clamp, eo, ei, eio, back, hop, rnd, tl, blink, GOLD, RED, WHITE, PINK, BLUE, SKY, INKX } = kit;

// Nods to what gets read most now: heists, dystopias, thrillers, self-help,
// manga, school stories, space opera and the gentle children's classics. Each
// scene is its own little story with a beginning, a middle and an end, and
// stays inside the 32px frame.

const R = Math.round;
const SMALL = { w: 6, h: 5.5 };

// ------------------------------------------------------------ the vault
const STEEL = "#8A93A0", STEEL_L = "#C9D1DB", STEEL_D = "#5A6270", VAULT_IN = "#1C2230";
const vault = (g, open, spin) => {
  const cx = 22, cy = 17;
  // What is inside: dark, and a small stack of gold.
  g.stamp((l) => {
    l.ell(cx, cy, 9, 9, VAULT_IN);
    if (open > 0.3) { l.rect(cx - 4, cy + 3, 4, 2, GOLD).rect(cx - 1, cy + 3, 4, 2, "#E0A800").rect(cx - 3, cy + 1, 4, 2, GOLD).px(cx - 3, cy + 1, "#FFF1A8").px(cx - 4, cy + 3, "#FFF1A8"); }
  }, "#0F1218");
  // The door: swings on a hinge at the right, so it narrows as it opens.
  const rx = lerp(9, 1.2, open), dx = cx + (9 - rx);
  g.stamp((l) => {
    l.ell(dx, cy, rx, 9, (nx, ny) => (nx * nx + ny * ny > 0.72 ? STEEL_D : nx + ny < -0.5 ? STEEL_L : STEEL));
    if (open < 0.5) {
      for (let k = 0; k < 4; k++) { const a = spin + (k * Math.PI) / 2; l.line(dx, cy, dx + Math.cos(a) * 4, cy + Math.sin(a) * 4, VAULT_IN); }
      l.ell(dx, cy, 1.6, 1.6, GOLD);
    }
  }, "#0F1218");
};

def("heist", "The Vault", "Books", 72, "Book nod: heists. Pip tiptoes up to a vault, listens at the dial, clicks it open, and the gold shines out.", (g, f) => {
  const s = tl(f, [12, 20, 6, 12, 22]);
  const open = s.k < 3 ? 0 : s.k === 3 ? eio(s.t) : 1;
  const spin = s.k === 1 ? Math.floor(s.n / 3) * 0.5 : s.k === 2 ? 3.5 + s.t : 0;
  vault(g, open, spin);
  let x = 8, o;
  if (s.k === 0) {
    x = lerp(-6, 8, s.t);
    const step = s.n % 6 < 3;
    o = { eyes: "open", look: [s.n % 12 < 6 ? 1 : -1, 0], fdx: 1, mouth: "tiny", la: 50, y: 28 - (step ? 1 : 0), feet: (A) => [[A.cx - 3, A.bottom + 1.1 - (step ? 1 : 0)], [A.cx + 3, A.bottom + 1.1 - (step ? 0 : 1)]] };
  }
  if (s.k === 1) o = { eyes: "closed", mouth: "blep", fdx: 1, la: 60, lean: 1.5, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: 14 + (s.n % 6 < 3 ? 0 : 1), y: 18 }] };
  if (s.k === 2) o = { eyes: "wide", brows: "up", mouth: "o", fdx: 1, la: 10, sq: -0.06 };
  if (s.k === 3) o = { eyes: "wide", look: [1, 0], fdx: 1, mouth: "o", la: 20, lean: -1 };
  if (s.k === 4) o = { eyes: "star", mouth: "open", blush: "big", fdx: 1, la: 20 + wave(s.n, 8, 10), y: 28 + (s.n < 8 ? hop(s.n / 8, 2) : 0), hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 3 }, { x: A.handR[0] + 1, y: A.cy - 3 }] };
  g.shadow(x, 6);
  drawPip(g, Object.assign({ x }, SMALL, { w: 6.5, h: 6 }, o));
  if (s.k === 1 && s.n % 6 === 3) g.text("!", 14, 6, WHITE);
  if (s.k === 2) { fx.impact(g, 22, 17); g.text("!", 3, 6, GOLD); }
  if (s.k === 4) { fx.twinkle(g, 19, 20, (s.n % 8) / 8, WHITE); fx.twinkle(g, 24, 22, ((s.n + 4) % 8) / 8, GOLD); fx.rays(g, 20, 21, 5, s.n * 0.2, "#FFE36B"); }
}, 60);

// ------------------------------------------------------------ the choosing
const BANNERS = [{ x: 2, c: "#C8453B", d: "#8A2A22", l: "#F08A7A" }, { x: 13, c: "#2F8FE6", d: "#1E5FA0", l: "#8CC6FF" }, { x: 24, c: "#E0A800", d: "#A07400", l: "#FFE27A" }];
const banner = (g, b, lit, f) => {
  g.stamp((l) => {
    l.rect(b.x - 1, 0, 8, 1, "#6B4A2E");
    for (let y = 1; y < 10; y++) for (let x = 0; x < 6; x++) {
      if (y === 9 && (x === 2 || x === 3)) continue;
      l.px(b.x + x, y, lit ? (x === 0 ? b.l : b.c) : x === 5 ? b.d : y < 2 ? b.c : b.d);
    }
    // Each has its own mark: a flame, a wave, a star.
    l.rect(b.x + 2, 4, 2, 2, lit ? WHITE : b.l).px(b.x + 2 + (b.x % 2), 3, lit ? WHITE : b.l);
  }, "#2A1A10");
  if (lit) fx.rays(g, b.x + 3, 5, 6, f * 0.15, b.l);
};
const badge = (c) => (g, A) => g.stamp((l) => l.ell(A.cx + 3.5, A.cy + 3, 1.6, 1.6, c.c).px(R(A.cx + 3), R(A.cy + 2), WHITE), "#2A1A10");

def("choosing", "The Choosing", "Books", 60, "Book nod: dystopias. Three banners hang overhead; Pip dithers under each, picks one, and gets its badge.", (g, f) => {
  const s = tl(f, [12, 10, 10, 6, 22]);
  const chosen = s.k >= 3 ? 2 : -1;
  BANNERS.forEach((b, i) => banner(g, b, i === chosen && (s.k === 4 || s.t > 0.5), f));
  let x = 16, o;
  if (s.k === 0) o = { eyes: "open", look: [s.n < 4 ? -1 : s.n < 8 ? 1 : 0, s.n < 8 ? -1 : 0], fdy: s.n < 8 ? -1 : 0, mouth: "tiny", la: 60 };
  if (s.k === 1) { x = lerp(16, 6, eio(clamp(s.t * 1.4))); o = { eyes: "open", look: [-1, -1], fdx: -1, mouth: s.t > 0.7 ? "wavy" : "tiny", la: 80, y: 28 - (s.n % 4 < 2 ? 1 : 0) }; }
  if (s.k === 2) { x = lerp(6, 25, eio(s.t)); o = { eyes: "determined", look: [1, 0], fdx: 1, mouth: "flat", la: -40, y: 28 - (s.n % 4 < 2 ? 1 : 0) }; }
  if (s.k === 3) { x = 25; o = { eyes: "squeeze", mouth: "grit", la: 60, y: 28 + hop(s.t, 3) }; }
  if (s.k === 4) { x = 25; o = { eyes: s.n < 6 ? "wide" : "happy", mouth: s.n < 6 ? "o" : "smile", blush: "big", la: 60 + wave(s.n, 10, 6), under: s.n > 3 ? badge(BANNERS[2]) : null, hands: s.n > 8 ? (A) => [{ x: A.handL[0] - 1, y: A.cy - 2 }, { x: A.handR[0], y: A.handR[1] }] : null }; }
  g.shadow(x, 5);
  const A = drawPip(g, Object.assign({ x }, SMALL, o));
  if (s.k === 0 && s.n > 7) g.text("?", 14, 11, WHITE);
  if (s.k === 4 && s.n > 3 && s.n < 12) fx.twinkle(g, A.cx + 4, A.cy + 3, (s.n - 3) / 9, WHITE);
}, 50);

// ------------------------------------------------------------ a torch in the dark
const DARK = "#161B2E", DARK_F = "#0F1322", LIT = "#D9C9A0", LIT_F = "#8A6A44", LIT_FD = "#6B4E30";
const CAT = ["..#...#.", "..#####.", "..#o#o#.", "#.#####.", "#.####..", ".######.", "..#..#.."];

def("torchdark", "Who's There", "Books", 64, "Book nod: thrillers. In the dark, Pip's torch sweeps the room: footprints, a pair of eyes… a cat. Then the torch flickers.", (g, f) => {
  const s = tl(f, [8, 20, 12, 10, 14]);
  const on = s.k === 0 ? s.n > 5 : s.k === 4 ? (s.n < 3 || (s.n > 4 && s.n < 6)) : true;
  // The beam: a cone from the torch, swinging from the floor at Pip's feet up to the far corner.
  const hand = [14, 22];
  const aim = s.k === 1 ? lerp(0.8, 0.2, eio(s.t)) : s.k === 0 ? 0.8 : 0.2;
  const lit = (x, y) => on && x > hand[0] && Math.abs(Math.atan2(y - hand[1], x - hand[0]) - aim) < 0.4;
  for (let y = 3; y < 32; y++) for (let x = 0; x < 32; x++) {
    if ((x === 0 || x === 31) && (y === 3 || y === 31)) continue;
    const floor = y >= 28;
    g.px(x, y, lit(x, y) ? (floor ? ((x + y) % 5 === 0 ? LIT_FD : LIT_F) : LIT) : floor ? DARK_F : DARK);
  }
  // What is in the room shows only where the light falls; the eyes show only where it does not.
  const room = (x, y, c) => lit(x, y) && g.px(x, y, c);
  for (let i = 0; i < 3; i++) { const x = 17 + i * 3, y = 29 + (i % 2); room(x, y, "#3A2A1A"); room(x + 1, y, "#3A2A1A"); }
  CAT.forEach((row, j) => [...row].forEach((ch, i) => ch !== "." && room(23 + i, 21 + j, ch === "o" ? "#9BE36B" : "#2A2A33")));
  if (s.k >= 1 && !lit(26, 23) && (s.k < 4 || f % 8 < 6)) { g.px(25, 23, "#E6D85A").px(27, 23, "#E6D85A"); }
  // And once the torch gives out, a second, bigger pair behind Pip.
  if (s.k === 4 && s.n > 7 && s.n % 6 < 5) g.rect(1, 12, 2, 2, "#FFE36B").rect(5, 12, 2, 2, "#FFE36B").px(2, 13, INKX).px(6, 13, INKX);
  let o;
  if (s.k === 0) o = { eyes: "wide", look: [s.n % 4 < 2 ? -1 : 1, 0], mouth: "wavy", la: 60 };
  if (s.k === 1) o = { eyes: s.t > 0.8 ? "wide" : "open", look: [1, s.t < 0.5 ? 1 : 0], fdx: 1, mouth: s.t > 0.8 ? "o" : "flat", brows: "focus", la: 60, lean: 0.8 };
  if (s.k === 2) o = { eyes: s.n < 5 ? "wide" : "half", look: [1, 0], fdx: 1, mouth: s.n < 5 ? "shout" : "flat", la: s.n < 5 ? 0 : 50, sq: s.n < 5 ? -0.08 : 0 };
  if (s.k === 3) o = { eyes: "closed", mouth: "o", la: 70, sq: 0.06 };
  if (s.k === 4) o = { eyes: s.n > 7 ? "wide" : "open", look: [s.n > 9 ? -1 : 1, 0], fdx: s.n > 9 ? -1 : 1, mouth: s.n > 7 ? "o" : "flat", brows: s.n > 7 ? "up" : null, la: s.n > 7 ? 0 : 60 };
  const A = drawPip(g, Object.assign({ x: 8, y: 29, w: 6.5, h: 6, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: hand[0] - 1, y: hand[1] + 0.5 }] }, o));
  g.stamp((l) => l.rect(hand[0] - 2, hand[1] - 1, 4, 2, "#C8453B").rect(hand[0] + 2, hand[1] - 2, 1, 4, on ? "#FFF3B0" : "#8A93A0"), "#2A0E0A");
  if (s.k === 2 && s.n < 5) g.text("!", 3, 6, GOLD);
  if (s.k === 3) fx.puff(g, A.fc + 7 + s.t * 3, A.ey + 2 - s.t * 4, 1.6, "#C9D6F0");
  if (s.k === 4 && s.n > 9) g.text("!", 14, 6, GOLD);
}, 30);

// ------------------------------------------------------------ have you seen
const poster = (g, x, y, flap) => {
  // A notice on a post: a grey outline of somebody, a red question mark, a pin.
  g.stamp((l) => l.rect(x + 4, y - 3, 3, 31 - y + 3, "#8A5A34").rect(x + 4, y - 3, 1, 31 - y + 3, "#A8744A").rect(x + 2, 30, 7, 1, "#5E3A1F"), "#2E1D10");
  g.stamp((l) => {
    l.rect(x, y, 11, 13, "#FFF6DF").rect(x, y + 12, 11, 1, "#E6DCC0");
    l.rect(x + 2, y + 1, 7, 1, INKX);
    l.ell(x + 5.5, y + 5.5, 2, 2, "#9AA3B0").rect(x + 2, y + 8, 7, 2, "#9AA3B0");
    for (let i = 2; i < 9; i++) if (i % 3) l.px(x + i, y + 11, "#8A7A5A");
    if (flap) l.px(x + 10, y + 12, null).px(x + 9, y + 12, "#E6DCC0").px(x + 10, y + 11, "#E6DCC0");
    l.px(x + 5, y, RED);
  }, "#3A2A1E");
  g.text("?", x + 4, y + 3, RED);
};

def("missingposter", "Have You Seen", "Books", 60, "Book nod: mysteries. Pip pins a notice to a post, steps back to study it, and starts eyeing everyone.", (g, f) => {
  const s = tl(f, [12, 8, 14, 14, 12]);
  const up = s.k > 0;
  if (up) poster(g, 19, 7, s.k === 4 && s.n % 6 < 3);
  else g.stamp((l) => l.rect(23, 4, 3, 27, "#8A5A34").rect(23, 4, 1, 27, "#A8744A").rect(21, 30, 7, 1, "#5E3A1F"), "#2E1D10");
  let x = 9, o;
  if (s.k === 0) {
    x = lerp(-4, 12, eo(s.t));
    o = { eyes: "determined", look: [1, 0], fdx: 1, mouth: "flat", la: 50, y: 28 - (s.n % 4 < 2 ? 1 : 0), hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + 7, y: A.cy - 1, item: (g, h) => g.stamp((l) => l.rect(R(h.x), R(h.y) - 6, 5, 7, "#FFF6DF").rect(R(h.x) + 1, R(h.y) - 5, 3, 1, INKX), "#3A2A1E") }] };
  }
  if (s.k === 1) { x = 12; const tap = s.n % 4 < 2; o = { eyes: "determined", look: [1, -1], fdx: 1, mouth: "grit", la: 40, lean: 1, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: tap ? 19 : 17, y: 12 }] }; }
  if (s.k === 2) { x = lerp(12, 8, eo(clamp(s.t * 2))); o = { eyes: "open", look: [1, -1], fdx: 1, mouth: "flat", brows: "focus", la: 60, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.fc + 2, y: A.ey + 5 }] }; }
  if (s.k === 3) { x = 8; const dir = s.n < 7 ? -1 : 1; o = { eyes: "half", look: [dir, 0], fdx: dir, mouth: "flat", brows: "focus", la: 60 - dir * 20, lean: dir * 0.8 }; }
  if (s.k === 4) { x = 8; o = { eyes: s.n % 6 < 3 ? "half" : "determined", brows: "focus", mouth: "smirk", la: 60, hands: (A) => [{ x: A.handL[0] + 1, y: A.cy + 4 }, { x: A.handR[0] - 1, y: A.cy + 4 }] }; }
  g.shadow(x, 6);
  drawPip(g, Object.assign({ x, w: 6.5, h: 6 }, o));
  if (s.k === 1 && s.n % 4 === 0) fx.impact(g, 21, 10);
  if (s.k === 2 && s.n > 6) g.text("?", 2, 5, WHITE);
  if (s.k === 3) g.text(".", s.n < 7 ? 1 : 14, 8, WHITE).text(".", s.n < 7 ? 4 : 17, 8, WHITE);
}, 30);

// ------------------------------------------------------------ tick, tick, tick
const TICK = "#1FBF6A";
const clipboard = (g, done, star) => {
  const x = 17, y = 5;
  g.stamp((l) => {
    l.rect(x, y, 13, 21, "#A8744A").rect(x, y + 20, 13, 1, "#8A5A34");
    l.rect(x + 1, y + 2, 11, 17, "#FFF6DF");
    l.rect(x + 4, y - 1, 5, 3, "#8A93A0").px(x + 4, y - 1, "#C9D1DB");
    for (let i = 0; i < 3; i++) {
      const ry = y + 5 + i * 5;
      l.rect(x + 2, ry, 3, 3, "#C9C2B0").px(x + 3, ry + 1, "#FFF6DF");
      for (let k = 6; k < 11; k++) if (i < done || k % 4) l.px(x + k, ry + 1, i < done ? "#C9C2B0" : "#8A7A5A");
      if (i < done) l.px(x + 2, ry + 1, TICK).px(x + 3, ry + 2, TICK).px(x + 4, ry + 1, TICK).px(x + 5, ry, TICK);
    }
  }, "#2E1D10");
  if (star) fx.star(g, x + 10, y + 3, 2, GOLD);
};
const pencil = (g, h) => g.stamp((l) => l.line(h.x + 1, h.y, h.x + 4, h.y - 4, GOLD).px(h.x + 5, h.y - 5, PINK).px(h.x, h.y + 1, INKX), "#4A3100");

def("checklist", "Tick, Tick, Tick", "Books", 60, "Book nod: self-help. A clipboard with three boxes; Pip ticks them off one by one and earns a gold star.", (g, f) => {
  const s = tl(f, [8, 10, 10, 10, 22]);
  const step = s.k >= 1 && s.k <= 3 ? s.k - 1 : -1;
  const done = s.k === 0 ? 0 : s.k === 4 ? 3 : step + (s.t > 0.5 ? 1 : 0);
  clipboard(g, done, s.k === 4 && s.n > 3);
  let o;
  if (s.k === 0) o = { eyes: "determined", brows: "focus", look: [1, 0], fdx: 1, mouth: "flat", la: 20, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0] + 1, y: A.cy, item: pencil }] };
  if (step >= 0) {
    const ry = 11 + step * 5, jab = s.t > 0.35 && s.t < 0.6 ? 1 : 0;
    o = { eyes: s.t > 0.5 ? "happy" : "determined", look: [1, step - 1], fdx: 1, mouth: s.t > 0.5 ? "smile" : "blep", la: 20 - step * 10, lean: 1, y: 28 - (s.t > 0.5 && s.t < 0.8 ? 1 : 0), hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: 15 + jab, y: ry + 3, item: pencil }] };
  }
  if (s.k === 4) o = { eyes: s.n < 4 ? "wide" : s.n % 12 < 9 ? "happy" : "wink", mouth: "open", blush: "big", la: 28 + wave(s.n, 8, 10), y: 28 + (s.n < 8 ? hop(s.n / 8, 2) : 0), hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 3 }, { x: A.handR[0] + 1, y: A.cy - 2, item: pencil }] };
  g.shadow(8, 6);
  drawPip(g, Object.assign({ x: 8, w: 6.5, h: 6 }, o));
  if (step >= 0 && s.t > 0.5 && s.t < 0.9) fx.star(g, 23, 12 + step * 5, 0, WHITE);
  if (s.k === 4 && s.n > 3) { fx.twinkle(g, 27, 4, (s.n % 8) / 8, WHITE); fx.twinkle(g, 3, 9, ((s.n + 4) % 8) / 8, GOLD); }
}, 52);

// ------------------------------------------------------------ seed money
const coin = (g, x, y) => g.stamp((l) => l.ell(x, y, 1.6, 1.6, (nx, ny) => (nx + ny < -0.4 ? "#FFF1A8" : GOLD)), "#4A3100");
const jar = (g, level, wobble) => {
  const x = 19 + wobble, y = 18;
  g.stamp((l) => {
    l.rect(x, y, 9, 11, "#E6F6FF").rect(x + 1, y - 2, 7, 2, "#C9E6F5").rect(x, y - 3, 9, 1, "#8A93A0");
    const fill = R(level * 8);
    for (let j = 0; j < fill; j++) for (let i = 1; i < 8; i++) l.px(x + i, y + 9 - j, (i + j) % 3 === 0 ? "#FFF1A8" : (i + j) % 3 === 1 ? GOLD : "#E0A800");
    l.rect(x + 1, y + 1, 1, 6, WHITE);
  }, "#1E4A6B");
};

def("coinjar", "Seed Money", "Books", 60, "Book nod: money and habit books. Pip drops coins in a jar one at a time; the jar sprouts.", (g, f) => {
  const s = tl(f, [8, 21, 7, 12, 12]);
  // Three tosses, seven frames each.
  const toss = s.k === 1 ? Math.floor(s.n / 7) : -1, tt = s.k === 1 ? (s.n % 7) / 7 : 0;
  const level = s.k === 0 ? 0.25 : s.k === 1 ? 0.25 + (toss + (tt > 0.8 ? 1 : 0)) * 0.25 : 1;
  const grow = s.k < 3 ? 0 : s.k === 3 ? back(s.t) : 1;
  if (grow > 0) {
    const h = Math.max(1, R(9 * grow)), sway = s.k === 4 ? R(wave(s.n, 12, 0.6)) : 0;
    g.stamp((l) => {
      l.rect(23, 15 - h, 1, h, "#3E8F3B");
      if (h > 4) l.rect(20 + sway, 16 - h, 3, 2, "#6CC04A").px(20 + sway, 16 - h, "#A2E477").rect(24 + sway, 14 - h, 3, 2, "#6CC04A").px(26 + sway, 14 - h, "#A2E477");
    }, "#15281B");
    if (s.k === 4) coin(g, 23.5 + sway, 15 - h - 1);
  }
  jar(g, level, s.k === 2 ? (s.n % 2 ? 1 : -1) : 0);
  let o;
  if (s.k === 0) o = { eyes: "open", look: [1, -1], fdx: 1, mouth: "smile", la: 20, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0] + 1, y: A.cy - 4, item: (g, h) => coin(g, h.x + 0.5, h.y - 3) }] };
  if (s.k === 1) o = { eyes: tt > 0.8 ? "happy" : "open", look: [1, tt < 0.5 ? -1 : 0], fdx: 1, mouth: "smile", la: 20, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0] + 1, y: A.cy - 2 - Math.sin(Math.PI * clamp(tt * 2.5)) * 3 }] };
  if (s.k === 2) o = { eyes: "wide", look: [1, 0], fdx: 1, mouth: "o", la: 10 };
  if (s.k === 3) o = { eyes: "wide", brows: "up", look: [1, -1], fdx: 1, fdy: -1, mouth: "o", la: 0, lean: -1 };
  if (s.k === 4) o = { eyes: "star", mouth: "open", blush: "big", fdx: 1, la: 20 + wave(s.n, 8, 10), hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 3 }, { x: A.handR[0] + 1, y: A.cy - 3 }] };
  g.shadow(8, 6);
  drawPip(g, Object.assign({ x: 8, w: 6.5, h: 6 }, o));
  if (s.k === 1 && tt < 0.8) { const t = tt / 0.8; coin(g, lerp(15, 23.5, t), lerp(17, 14, t) + hop(t, 8)); }
  if (s.k === 1 && tt >= 0.8) g.px(22, 13, WHITE).px(25, 12, WHITE);
  if (s.k === 4) { fx.twinkle(g, 29, 4, (s.n % 8) / 8, WHITE); fx.twinkle(g, 17, 8, ((s.n + 4) % 8) / 8, GOLD); }
}, 52);

// ------------------------------------------------------------ speed lines
const headband = (g, A) => {
  const y = R(A.ey) - 4, x0 = R(A.cx - A.rx) + 1, w = R(A.rx * 2) - 2, tail = g.f % 4 < 2 ? 0 : 1;
  g.stamp((l) => {
    l.rect(x0, y, w, 1, RED).px(x0 + 1, y, "#FF8A8A");
    l.px(x0 - 1, y, RED).px(x0 - 2, y + tail, RED).px(x0 - 3, y - 1 + tail, RED).px(x0 - 2, y + 2 - tail, RED).px(x0 - 3, y + 2, RED);
  }, "#3A0E12");
};
const streaks = (g, f, n, x0, x1) => {
  for (let i = 0; i < n; i++) {
    const y = 3 + R(rnd(i + Math.floor(f / 2) * 7) * 27), len = 5 + R(rnd(i * 3 + f) * 9), x = x0 + R(rnd(i * 5 + f) * (x1 - x0 - len));
    for (let k = 0; k < len; k++) g.px(x + k, y, i % 2 ? WHITE : INKX);
  }
};

def("speeddash", "Speed Lines", "Books", 48, "Book nod: manga. Pip ties on a headband, crouches, crosses the frame in a blur of speed lines, and lands the pose.", (g, f) => {
  const s = tl(f, [10, 3, 9, 6, 20]);
  let x = 9, o, ghost = 0;
  if (s.k === 0) o = { eyes: "determined", brows: "angry", look: [1, 0], fdx: 1, mouth: "flat", la: -30, sq: 0.14 * eo(s.t), lean: 1.5 * s.t };
  if (s.k === 1) o = { eyes: "determined", brows: "angry", fdx: 1, mouth: "grit", la: -70, lean: 3, sq: 0.1 };
  if (s.k === 2) { x = lerp(9, 25, s.t); ghost = 1; o = { eyes: "determined", brows: "angry", fdx: 1, mouth: "grit", la: -80, lean: 3, sq: 0.08, feet: (A) => [[A.cx - 5, A.bottom + 0.5], [A.cx + 1, A.bottom + 1.1]] }; }
  if (s.k === 3) { x = 25; o = { eyes: "squeeze", mouth: "grit", fdx: -1, la: 60, lean: -2.5 * (1 - s.t), sq: 0.06 }; }
  if (s.k === 4) { x = 25; o = { eyes: s.n % 10 < 7 ? "determined" : "wink", brows: "focus", look: [-1, 0], fdx: -1, mouth: "smirk", la: 40 + wave(s.n, 8, 6), hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 5 }, { x: A.handR[0] - 1, y: A.cy + 4 }] }; }
  if (s.k === 2) streaks(g, f, 9, 0, 32);
  if (s.k === 3) streaks(g, f, 4, 0, 18);
  if (s.k === 4 && s.n < 10) {
    // The pose gets its focus lines: short strokes pointing in from the edges.
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + 0.2, r0 = 15 + (i % 2) * 2, r1 = 21; if (Math.cos(a) > 0.75) continue; g.line(22 + Math.cos(a) * r0, 20 + Math.sin(a) * r0, 22 + Math.cos(a) * r1, 20 + Math.sin(a) * r1, s.n % 4 < 2 ? INKX : WHITE); }
  }
  g.shadow(x, 5);
  if (ghost) for (let i = 2; i >= 1; i--) g.xform((gg) => drawPip(gg, Object.assign({ x: x - i * 5 }, SMALL, o, { hands: false, feet: false, leaf: "none", acc: false })), { tint: () => (i === 1 ? "#6CC04A88" : "#6CC04A44") });
  const A = drawPip(g, Object.assign({ x }, SMALL, { over: headband }, o));
  if (s.k === 1 || (s.k === 2 && s.n < 3)) for (let i = 0; i < 3; i++) fx.puff(g, 2 + i * 3, 29 - i, 1.4 + i * 0.3);
  if (s.k === 3) for (let i = 0; i < 3; i++) fx.puff(g, A.cx + 5 + i * 2 - s.t * 2, 30 - i - s.t * 2, 1.6 - s.t);
  if (s.k === 4 && s.n > 3) fx.twinkle(g, A.fc - 6, A.ey - 5, ((s.n - 3) % 9) / 9, WHITE);
}, 34);

// ------------------------------------------------------------ a hat on the wind
const STRAW = "#F2D16B", STRAW_L = "#FFF1A8", STRAW_D = "#C9A23A";
const strawHat = (g, x, y, tilt = 0) => {
  x = R(x); y = R(y);
  g.stamp((l) => {
    l.rect(x - 6, y, 13, 1, STRAW).rect(x - 5, y + 1, 11, 1, STRAW_D).px(x - 6, y, STRAW_L);
    l.rect(x - 3 + tilt, y - 4, 7, 4, STRAW).rect(x - 2 + tilt, y - 5, 5, 1, STRAW).rect(x - 3 + tilt, y - 4, 2, 1, STRAW_L).px(x + 3 + tilt, y - 3, STRAW_D);
    l.rect(x - 3 + tilt, y - 1, 7, 1, RED);
  }, "#4A3100");
};
const gust = (g, f, y0) => {
  for (let i = 0; i < 3; i++) {
    const x = 31 - ((f * 3 + i * 13) % 44), y = y0 + i * 6;
    g.px(x, y, WHITE).px(x + 1, y, WHITE).px(x + 2, y, "#C9CED6").px(x + 3, y - 1, "#C9CED6").px(x + 5, y - 1, "#C9CED6");
  }
};

def("strawhat", "Hat on the Wind", "Books", 60, "Book nod: a pirate crew's long voyage. A straw hat comes tumbling in on the wind; Pip leaps, catches it, and wears the grin that goes with it.", (g, f) => {
  const s = tl(f, [14, 8, 6, 32]);
  gust(g, f, 5);
  let o, hat = null, worn = false;
  if (s.k === 0) {
    // In from the right, dipping and rising.
    hat = [lerp(40, 18, s.t), 6 + Math.sin(s.t * TAU * 1.25) * 3, s.n % 4 < 2 ? 1 : -1];
    o = { eyes: s.t > 0.3 ? "wide" : "open", look: [1, -1], fdx: 1, fdy: -1, mouth: s.t > 0.3 ? "o" : "smile", la: 50 };
  }
  if (s.k === 1) {
    const up = hop(s.t, 5);
    hat = [lerp(18, 16, s.t), lerp(5, 9, s.t), 0];
    o = { y: 28 + up, eyes: "determined", look: [0, -1], fdy: -1, mouth: "open", la: 70, sq: -0.08, hands: (A) => [{ x: A.cx - 5, y: A.top.y - 1 }, { x: A.cx + 5, y: A.top.y - 1 }] };
  }
  if (s.k === 2) { worn = true; o = { eyes: "squeeze", mouth: "grit", leaf: "none", sq: 0.12 * Math.sin(Math.PI * s.t), hands: (A) => [{ x: A.cx - 6, y: A.top.y + 2 }, { x: A.cx + 6, y: A.top.y + 2 }] }; }
  if (s.k === 3) {
    worn = true;
    const tug = s.n > 14 && s.n < 24;
    o = { eyes: tug ? "wink" : "happy", mouth: "grin", blush: "big", leaf: "none", lean: tug ? -0.8 : wave(s.n, 16, 0.5), hands: (A) => (tug ? [{ x: A.handL[0] + 1, y: A.cy + 4 }, { x: A.cx + 5, y: A.top.y + 1 }] : [{ x: A.handL[0] + 1, y: A.cy + 4 }, { x: A.handR[0] - 1, y: A.cy + 4 }]) };
  }
  g.shadow(16, 6);
  const A = drawPip(g, Object.assign({ acc: !worn, over: worn ? (g, A) => strawHat(g, A.top.x, A.top.y + 2, s.k === 3 && s.n > 14 && s.n < 24 ? -1 : 0) : null }, o));
  if (hat) strawHat(g, hat[0], hat[1], hat[2]);
  if (s.k === 1) { drawHand(g, { x: A.cx - 5, y: A.top.y - 1 }); drawHand(g, { x: A.cx + 5, y: A.top.y - 1 }); }
  if (s.k === 3 && s.n > 14 && s.n < 24) drawHand(g, { x: A.cx + 5, y: A.top.y + 1 });
  if (s.k === 3 && s.n < 12) fx.twinkle(g, 26, 8, s.n / 12, WHITE);
}, 40);

// ------------------------------------------------------------ back row
const board = (g, stuck) => {
  g.stamp((l) => {
    l.rect(17, 1, 15, 10, "#2E5A44").rect(17, 1, 15, 1, "#8A5A34").rect(17, 10, 15, 1, "#8A5A34").rect(17, 1, 1, 10, "#8A5A34").rect(31, 1, 1, 10, "#8A5A34");
    l.rect(20, 11, 5, 1, WHITE);
  }, "#2E1D10");
  g.text("A", 19, 3, "#E6F2EA").text("B", 23, 3, "#E6F2EA").text("C", 27, 3, "#E6F2EA");
  if (stuck) plane(g, 28, 9, 1, false);
};
const plane = (g, x, y, dir, dip) => {
  x = R(x); y = R(y);
  g.stamp((l) => {
    for (let i = 0; i < 5; i++) l.px(x - dir * i, y + (dip ? -1 : 0) + (i > 2 ? 1 : 0), WHITE);
    l.px(x - dir * 2, y - 1, WHITE).px(x - dir * 3, y - 1, "#DCE6F2").px(x - dir * 4, y - 1, "#DCE6F2").px(x - dir * 3, y + 2, "#DCE6F2");
  }, "#3A4A66");
};
const desk = (g) => g.stamp((l) => {
  l.rect(1, 25, 16, 2, "#A8744A").rect(1, 25, 16, 1, "#C99A6A").rect(2, 27, 2, 5, "#8A5A34").rect(14, 27, 2, 5, "#8A5A34");
}, "#2E1D10");

def("schoolday", "Back Row", "Books", 60, "Book nod: school stories. At a desk in the back row, Pip folds its notes into a paper plane, lets it fly, and looks very innocent when it sticks in the blackboard.", (g, f) => {
  const s = tl(f, [12, 8, 6, 12, 22]);
  board(g, s.k === 4);
  let o, fly = null;
  if (s.k === 0) o = { eyes: blink(s.n, 12, 9) ? "blink" : "half", look: [0, 1], mouth: "flat", la: 80, lean: 0.5, hands: (A) => [{ x: A.handL[0] + 1, y: A.cy + 3 }, { x: A.cx + 4 + (s.n % 4 < 2 ? 0 : 1), y: A.cy + 3 }] };
  if (s.k === 1) o = { eyes: "open", look: [s.n < 4 ? -1 : 1, 0], mouth: "smirk", la: 50, hands: (A) => [{ x: A.cx - 2, y: A.cy + 3 }, { x: A.cx + 3, y: A.cy + 3 }] };
  if (s.k === 2) o = { eyes: "determined", look: [1, -1], fdx: 1, mouth: "blep", la: 20, lean: -1 + s.t * 2.5, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: lerp(A.cx + 2, A.cx + 8, eo(s.t)), y: lerp(A.cy + 2, A.cy - 6, eo(s.t)) }] };
  if (s.k === 3) {
    // A loop on the way: up, over, and into the board.
    const t = s.t, a = t * TAU;
    fly = t < 0.7 ? [lerp(16, 22, t / 0.7) - Math.sin(a * 1.4) * 4, 13 - Math.sin(t * Math.PI / 0.7) * 3 + Math.cos(a * 1.4) * 3, Math.cos(a * 1.4) > 0] : [lerp(22, 28, (t - 0.7) / 0.3), lerp(12, 9, (t - 0.7) / 0.3), false];
    o = { eyes: "wide", look: [1, -1], fdx: 1, fdy: -1, mouth: "o", la: 20 };
  }
  if (s.k === 4) o = { eyes: s.n < 4 ? "wide" : "closed", look: [-1, -1], fdx: -1, mouth: s.n < 4 ? "o" : "whistle", blush: s.n < 4 ? true : "big", la: 100 };
  drawPip(g, Object.assign({ x: 9, y: 24 }, SMALL, o, { feet: false }));
  desk(g);
  if (s.k === 0) g.stamp((l) => l.rect(7, 23, 6, 2, "#FFF6DF").px(8 + (s.n % 4), 23, "#8A7A5A"), "#3A2A1E");
  if (s.k === 1) plane(g, 11, 22, 1, s.n % 2 === 0);
  if (s.k === 2) plane(g, lerp(12, 17, eo(s.t)), lerp(20, 13, eo(s.t)), 1, false);
  if (fly) plane(g, fly[0], fly[1], 1, fly[2]);
  if (s.k === 4 && s.n < 4) fx.impact(g, 28, 9);
  if (s.k === 4 && s.n > 5) { const t = ((s.n - 6) % 16) / 16; fx.note(g, 2 + Math.sin(t * 6), 12 - t * 9); }
}, 44);

// ------------------------------------------------------------ full speed
const SPACE = "#141A36", HULL = "#C9D1DB", HULL_D = "#8A93A0", HULL_L = "#F2F5F8";
const ship = (g, x, y, burn, f) => {
  // A stubby little flier: Pip sits in the open cockpit, nose to the right.
  g.stamp((l) => {
    for (let i = 0; i < 2 + burn * 4; i++) l.px(x - 13 - i, y + 2 + (i % 2 ? (f % 2 ? -1 : 1) : 0), i < 2 ? "#FFF3B0" : i < 4 ? "#FFC53D" : "#FF8A2A");
  }, "#3A1409");
  g.stamp((l) => {
    l.ell(x, y + 2, 12, 3.6, (nx, ny) => (ny < -0.2 ? HULL_L : ny > 0.4 ? HULL_D : HULL));
    l.rect(x - 12, y - 2, 3, 4, RED).px(x - 12, y - 3, RED).rect(x + 4, y + 2, 6, 1, RED).px(x + 11, y + 2, "#7CC8FF");
  }, "#1E222A");
};

def("starship", "Full Speed", "Books", 60, "Book nod: space opera. Pip cruises a little ship past the stars, pushes the lever, and the stars stretch into lines.", (g, f) => {
  const s = tl(f, [14, 6, 18, 10, 12]);
  const warp = s.k === 2 ? clamp(s.t * 4) : s.k === 3 ? 1 - eo(s.t) : 0;
  for (let y = 2; y < 30; y++) for (let x = 0; x < 32; x++) {
    if ((x === 0 || x === 31) && (y === 2 || y === 29)) continue;
    g.px(x, y, SPACE);
  }
  // Stars drift left; at speed each one smears into a streak.
  const speed = 0.4 + warp * 5;
  for (let i = 0; i < 12; i++) {
    const y = 3 + R(rnd(i) * 25), x = 31 - (((f * speed * (0.6 + rnd(i + 20))) + rnd(i + 40) * 40) % 36);
    const len = 1 + R(warp * (5 + rnd(i + 7) * 6));
    for (let k = 0; k < len; k++) if (x + k >= 1 && x + k < 31) g.px(x + k, y, k === 0 ? WHITE : i % 3 === 0 ? "#7CC8FF" : "#C9D1DB");
  }
  // A ringed planet slides by once the ship drops out.
  if (s.k >= 3) {
    const px = s.k === 3 ? lerp(40, 25, eo(s.t)) : lerp(25, 22, s.t);
    g.stamp((l) => { l.ell(px, 9, 4, 4, (nx, ny) => (ny < -0.3 ? "#FFC98A" : ny > 0.4 ? "#C0703A" : "#F0934A")); l.line(px - 7, 11, px + 7, 7, "#FFE8B8"); l.ell(px, 8, 3, 2.2, "#F0934A"); }, "#3A1A0A");
  }
  const shake = s.k === 2 ? (s.n % 2 ? 0.5 : -0.5) : 0, bob = s.k === 2 ? 0 : R(wave(f, 16, 0.7));
  const sx = 14 + shake, sy = 22 + bob;
  let o;
  if (s.k === 0) o = { eyes: blink(s.n, 12, 9) ? "blink" : "open", look: [1, 0], fdx: 1, mouth: "smile", la: 60 };
  if (s.k === 1) o = { eyes: "determined", brows: "focus", look: [1, 0], fdx: 1, mouth: "smirk", la: 70, hands: (A) => [{ x: A.handL[0] + 2, y: A.cy + 3 }, { x: A.cx + 5 + s.t * 3, y: A.cy + 2 }] };
  if (s.k === 2) o = { eyes: s.n < 4 ? "wide" : "squeeze", mouth: s.n < 4 ? "o" : "grit", fdx: 1, la: 100, lean: -1.5, sq: 0.06 };
  if (s.k === 3) o = { eyes: "wide", look: [1, -1], fdx: 1, mouth: "o", la: 70 };
  if (s.k === 4) o = { eyes: "star", look: [1, -1], fdx: 1, mouth: "open", blush: "big", la: 50 + wave(s.n, 8, 8), hands: (A) => [{ x: A.handL[0] + 2, y: A.cy + 3 }, { x: A.handR[0], y: A.cy - 4 + (s.n % 6 < 3 ? 0 : 1) }] };
  drawPip(g, Object.assign({ x: sx, y: sy }, SMALL, { feet: false }, o));
  ship(g, sx, sy, s.k === 2 ? 1 : s.k === 1 ? 0.3 : 0.1, f);
  if (s.k === 1 && s.n > 3) g.text("!", 26, 14, GOLD);
}, 30);

// ------------------------------------------------------------ a little something
const butterfly = (g, x, y, open) => {
  x = R(x); y = R(y);
  g.stamp((l) => {
    l.px(x, y, INKX).px(x, y + 1, INKX);
    if (open) l.rect(x - 2, y - 1, 2, 2, "#FF9F1C").rect(x + 1, y - 1, 2, 2, "#FF9F1C").px(x - 2, y + 1, "#FFD23F").px(x + 2, y + 1, "#FFD23F").px(x - 2, y - 1, "#FFE08A");
    else l.px(x - 1, y - 1, "#FF9F1C").px(x + 1, y - 1, "#FF9F1C").px(x - 1, y, "#FFD23F").px(x + 1, y, "#FFD23F");
  }, "#4A2408");
};
const honeyPot = (g, x, y) => g.stamp((l) => {
  l.ell(x + 2.5, y + 3, 3.4, 3, (nx, ny) => (nx + ny < -0.4 ? "#F0B060" : ny > 0.5 ? "#A8642A" : "#D08A3A"));
  l.rect(x, y - 1, 5, 1, "#A8642A").rect(x + 1, y - 2, 3, 1, "#FFC53D").px(x + 4, y, "#FFC53D").px(x + 4, y + 1, "#FFC53D");
}, "#3A1E0A");

def("picnic", "A Little Something", "Books", 60, "Book nod: the gentle children's classics. A checked blanket, a pot of honey, and a butterfly that comes to sit on Pip's leaf.", (g, f) => {
  const s = tl(f, [12, 12, 14, 22]);
  // The blanket, and the pot on it.
  g.stamp((l) => { for (let x = 1; x < 31; x++) for (let y = 29; y < 32; y++) l.px(x, y, (Math.floor(x / 2) + y) % 2 ? "#E0393E" : "#FFF6DF"); }, "#3A0E12");
  honeyPot(g, 22, 22);
  let o, fly = null, landed = false;
  const la = 40;
  if (s.k === 0) {
    // A paw in the pot, then a taste.
    const dip = Math.sin(Math.PI * clamp(s.t * 1.6));
    o = { eyes: "open", look: [1, 1], fdx: 1, mouth: "smile", la, lean: dip, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: lerp(A.handR[0], 23, dip), y: lerp(A.handR[1], 21, dip) }] };
  }
  if (s.k === 1) o = { eyes: "closed", mouth: s.n % 6 < 3 ? "blep" : "smile", blush: "big", la: la + wave(s.n, 12, 5), hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.fc + 4, y: A.ey + 4 }] };
  if (s.k === 2) {
    const t = s.t;
    fly = [lerp(34, 16, eo(t)) + Math.sin(t * TAU * 2) * 3, lerp(4, 9, t) + Math.cos(t * TAU * 2) * 3];
    o = { eyes: "wide", look: [fly[0] > 20 ? 1 : 0, -1], fdy: -1, mouth: "o", la };
  }
  if (s.k === 3) { landed = true; o = { eyes: s.n < 8 ? "open" : "closed", look: [0, -1], fdy: s.n < 8 ? -1 : 0, mouth: "smile", blush: "big", la: la + wave(s.n, 22, 3), sq: wave(s.n, 22, 0.02) }; }
  g.shadow(12, 6, 29);
  const A = drawPip(g, Object.assign({ x: 12, y: 29 }, o));
  if (fly) butterfly(g, fly[0], fly[1], s.n % 4 < 2);
  if (landed) {
    // Sitting on the tip of the leaf, wings slowly opening and closing.
    const a = ((o.la) * Math.PI) / 180, tx = A.top.x + Math.sin(a * 0.35) * 2.6 + Math.sin(a) * 6.5, ty = A.top.y + 1.2 - Math.cos(a * 0.35) * 2.6 - Math.cos(a) * 6.5;
    butterfly(g, tx, ty - 2, s.n % 10 < 6);
    if (s.n > 10) fx.heart(g, 27, 14 - ((s.n - 10) % 12) * 0.6, false);
  }
  if (s.k === 1 && s.n % 6 === 0) g.px(A.fc + 6, A.ey + 6, "#FFC53D");
}, 44);

// ------------------------------------------------------------ a cat on the page
const TABBY = { a: "#E8943A", s: "#B8641E", k: "#2A2A33", w: "#FFF6DF", n: "#FF8FA3" };
const CAT_WALK = [
  ["a.a.......", "aaa......a", "kak.....a.", "wnaasasaa.", ".aaaaaaaa.", ".a.a..a.a."],
  ["a.a.......", "aaa.....a.", "kak.....a.", "wnaasasaa.", ".aaaaaaaa.", "a..a.a..a."]
];
const CAT_SIT = ["a.a...", "aaa...", "kak...", "wnaa.a", "aasaa.a".slice(0, 6), "aaaaaa"];
const cat = (g, x, y, rows) => {
  // Feet at (x, y), facing left.
  x = R(x); y = R(y);
  g.stamp((l) => rows.forEach((row, j) => [...row].forEach((ch, i) => ch !== "." && l.px(x - 4 + i, y - rows.length + 1 + j, TABBY[ch]))), "#3A1E0A");
};

def("catvisit", "A Cat on the Page", "Books", 60, "Book nod: cat stories. Pip is reading; a cat strolls in, sits on the open book, and gets a scratch behind the ears.", (g, f) => {
  const s = tl(f, [8, 14, 6, 10, 22]);
  let o, at = null, rows = CAT_WALK[0];
  const book = (g, A) => prop.openBook(g, A.cx, A.cy + 2, { w: 12 });
  const hold = (A) => [{ x: A.cx - 6.5, y: A.cy + 5 }, { x: A.cx + 6.5, y: A.cy + 5 }];
  if (s.k === 0) o = { eyes: blink(s.n, 10, 7) ? "blink" : "open", look: [0, 1], mouth: "smile", la: 40, hands: hold };
  if (s.k === 1) { at = [lerp(38, 26, s.t), 30]; rows = CAT_WALK[Math.floor(s.n / 3) % 2]; o = { eyes: s.t > 0.4 ? "open" : "open", look: s.t > 0.4 ? [1, 0] : [0, 1], fdx: s.t > 0.4 ? 1 : 0, mouth: s.t > 0.4 ? "o" : "smile", la: 40, hands: hold }; }
  if (s.k === 2) { at = [lerp(26, 18, s.t), lerp(30, 27, s.t) + hop(s.t, 7)]; o = { eyes: "wide", look: [1, 0], fdx: 1, mouth: "o", la: 20, hands: hold }; }
  if (s.k === 3) { at = [18, 27]; rows = CAT_SIT; o = { eyes: "half", mouth: "flat", la: 60, blush: false, hands: hold }; }
  if (s.k === 4) {
    at = [18, 27]; rows = CAT_SIT;
    const stroke = s.n % 8 < 4 ? 0 : 1;
    o = { eyes: s.n < 5 ? "half" : "happy", mouth: s.n < 5 ? "flat" : "smile", blush: s.n < 5 ? false : "big", la: 40 + wave(s.n, 16, 5), hands: (A) => [{ x: A.cx - 6.5, y: A.cy + 5 }, s.n < 5 ? { x: A.cx + 6.5, y: A.cy + 5 } : { x: 20 + stroke, y: 23 + stroke }] };
  }
  g.shadow(13, 6);
  const A = drawPip(g, Object.assign({ x: 13, hold: book }, o));
  if (at) cat(g, at[0], at[1], rows);
  if (s.k === 4 && s.n >= 5) { drawHand(g, { x: 20 + (s.n % 8 < 4 ? 0 : 1), y: 23 + (s.n % 8 < 4 ? 0 : 1) }); fx.heart(g, 26, 14 - ((s.n - 5) % 12) * 0.6, false); }
  if (s.k === 3 && s.n > 3) g.text(".", 23, 8, WHITE).text(".", 26, 8, WHITE).text(".", 29, 8, WHITE);
  if (s.k === 1 && s.t > 0.4 && s.n % 6 < 4) g.text("?", A.cx - 12, 6, WHITE);
}, 44);
