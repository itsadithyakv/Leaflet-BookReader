/* Book scenes, part of ./index.js. */
import { drawPip, drawHand, FONT } from "../engine.js";
import { def, fx, prop, kit } from "../anims.js";

const { TAU, wave, tri, lerp, clamp, eo, ei, eio, back, hop, rnd, tl, blink, GOLD, RED, WHITE, PINK, BLUE, SKY, INKX } = kit;

// ------------------------------------------------------------ shared bits
const SEA = "#2F8FE6", SEA_L = "#5AB8FF", SEA_D = "#1F5FA8", FOAM = "#E6F6FF";
const WOOD = "#8A5A34", WOOD_L = "#B07A48", WOOD_D = "#5E3A1F", WOOD_O = "#2E1D10";

/** Rolling sea from row `top` down; `front` draws only a thin band (to sit over a hull). */
const sea = (g, f, top, o = {}) => {
  const sp = o.speed ?? 0.5, amp = o.amp ?? 1, ph = o.ph ?? 0;
  for (let x = 0; x < 32; x++) {
    const h = top + Math.round(Math.sin((x + f * sp) * 0.45 + ph) * amp);
    for (let y = h; y < 32; y++) g.px(x, y, y === h ? FOAM : y === h + 1 ? SEA_L : y > h + 3 ? SEA_D : SEA);
  }
};

/** A little rowboat hull, top edge at y, from x0 to x1. */
const hull = (g, x0, x1, y) => {
  x0 = Math.round(x0); x1 = Math.round(x1); y = Math.round(y);
  g.stamp((l) => {
    l.rect(x0, y, x1 - x0 + 1, 1, WOOD_L);
    l.rect(x0, y + 1, x1 - x0 + 1, 1, WOOD);
    l.rect(x0 + 1, y + 2, x1 - x0 - 1, 1, WOOD);
    l.rect(x0 + 2, y + 3, x1 - x0 - 3, 1, WOOD_D);
    l.px(x0 - 1, y - 1, WOOD_L).px(x1 + 1, y - 1, WOOD_L);
    for (let x = x0 + 3; x < x1 - 1; x += 4) l.px(x, y + 2, WOOD_D);
  }, WOOD_O);
};

// ============================================================ 1. whale
const FLUKE = [
  "##...........##",
  "####.......####",
  ".#####...#####.",
  "..###########..",
  "...#########...",
  ".....#####.....",
  "......###......",
];
const whaleTail = (g, x, top, stem) => {
  g.stamp((l) => {
    FLUKE.forEach((r, j) => [...r].forEach((ch, i) => ch === "#" && l.px(x - 7 + i, top + j, j <= 1 || (j === 2 && (i < 3 || i > 11)) ? "#7497BF" : i > 8 ? "#2A4262" : "#44658C")));
    for (let j = 0; j < stem; j++) l.rect(x - 1, top + 7 + j, 3, 1, "#44658C").px(x + 1, top + 7 + j, "#2A4262").px(x - 1, top + 7 + j, j % 5 === 2 ? "#7497BF" : "#44658C");
  }, "#101C2C");
};
const whaleBack = (g, x, y, w) => g.stamp((l) => l.ell(x, y, w, 2.2, (nx, ny) => (ny < -0.3 && nx < 0.2 ? "#7497BF" : "#44658C")), "#101C2C");

def("whale", "Thar She Blows", "Books", 72, "Book nod: Moby-Dick. Rowing along, until a huge tail rises and slaps down; Pip is drenched.", (g, f) => {
  const s = tl(f, [14, 12, 8, 4, 10, 16, 8]);
  const water = 25;
  // The tail: a back breaks the surface, the tail climbs out of the water
  // and hangs there dripping, then slams straight down.
  let tailUp = 0, rot = 0;
  if (s.k === 1) { tailUp = eo(s.t) * 20; rot = 0.05 - 0.1 * s.t; }
  if (s.k === 2) { tailUp = 20 + wave(s.n, 8, 0.6); rot = -0.05 + 0.05 * s.t; }
  if (s.k === 3) { tailUp = lerp(20, 2, ei(s.t)); rot = lerp(0, -0.2, s.t); }
  const bob = s.k >= 3 && s.k <= 4 ? 1 : Math.round(wave(f, 16, 0.7));
  sea(g, f, water);
  if (s.k === 0 && s.n > 6) whaleBack(g, 26, water + 1.5 - (s.n - 6) * 0.15, 4 + (s.n - 6) * 0.3);
  if (tailUp > 1) g.xform((gg) => whaleTail(gg, 24, Math.round(water - tailUp), 26), { cx: 24, cy: water + 2, rot });
  if (s.k === 2) for (let i = 0; i < 2; i++) fx.drop(g, [18, 30][i], lerp(6, 22, ((s.n + i * 4) % 8) / 8));
  // The splash: a wall of water climbs where the tail went in and arcs over the boat.
  if (s.k === 4) {
    const t = s.t, n = Math.round(lerp(3, 10, eo(Math.min(1, t * 2))));
    for (let i = 0; i < n; i++) {
      const u = i / 9, h = Math.sin(Math.PI * Math.min(1, u * 1.25));
      fx.puff(g, lerp(26, 5, u), 25 - h * lerp(8, 21, eo(t)) + (u > 0.7 ? 6 * (u - 0.7) / 0.3 : 0), 3 - u * 0.9, FOAM);
    }
    for (let j = 0; j < 3; j++) fx.puff(g, 23 + j * 3, 23 - (j === 1 ? 4 : 1) * (1 - t * 0.5), 2.6, FOAM);
  }
  const soaked = s.k >= 5;
  const px = 11, py = 26 + bob;
  const row = s.k === 0 ? wave(f, 14, 1.2) : 0;
  const scared = s.k >= 1 && s.k <= 4;
  const recover = s.k === 6;
  const A = drawPip(g, {
    y: py, w: 6.5, h: 6, feet: false,
    look: scared ? [1, -1] : [0, 0], fdx: scared ? 1 : 0,
    eyes: recover ? (s.n < 3 ? "blink" : "open") : soaked ? "closed" : s.k === 4 ? "squeeze" : scared ? "wide" : "happy",
    mouth: recover ? "flat" : soaked ? "wavy" : s.k === 4 ? "shout" : scared ? "o" : "smile",
    brows: s.k === 1 || s.k === 2 ? "up" : soaked ? "sad" : null,
    blush: !scared,
    leaf: s.k === 5 ? "wilt" : "leaf",
    la: s.k === 5 ? 115 : recover ? lerp(115, 30, eo(s.t)) : scared ? -25 : 28 + row * 6,
    sq: s.k === 5 ? 0.14 : recover ? 0.14 * (1 - s.t) : 0,
    x: px + (recover && s.n > 3 ? (s.n % 2 ? 0.6 : -0.6) : 0),
    under: soaked ? (g, A) => {
      for (const [dx, dy] of [[-5, -1], [-3, -3], [4, -3], [5, 0], [0, -4]]) g.px(A.cx + dx, A.cy + dy, "#7CC8FF").px(A.cx + dx, A.cy + dy + 1, "#5AB8FF99");
    } : null,
    hands: (A) => (s.k === 4 ? [{ x: A.handL[0] - 1, y: A.cy - 4 }, { x: A.handR[0] + 1, y: A.cy - 4 }] : [{ x: A.handL[0] - 1 + row, y: A.cy + 2 }, { x: A.handR[0] + 1 + row, y: A.cy + 2 }])
  });
  // Oars from each hand out into the water.
  if (s.k !== 4) g.stamp((l) => {
    l.line(A.handL[0] - 1 + row, A.cy + 2, 2 + row * 1.5, water + 3, WOOD_L);
    l.line(A.handR[0] + 1 + row, A.cy + 2, 21 + row * 1.5, water + 3, WOOD_L);
  }, WOOD_O);
  hull(g, 4, 18, py - 2);
  sea(g, f, water + 3, { amp: 0.6, ph: 2 });
  if (s.k === 4 && s.t > 0.4) for (let i = 0; i < 5; i++) fx.drop(g, 3 + i * 3.5, lerp(4, 11, (s.t - 0.4) / 0.6) + (i % 2) * 2);
  if (s.k === 5) {
    // Drips off the sides; a small fish flops on Pip's head.
    for (let i = 0; i < 2; i++) fx.drop(g, i ? A.cx + A.rx + 1 : A.cx - A.rx - 1, lerp(A.cy - 2, A.cy + 3, ((s.n + i * 5) % 10) / 10));
    const fl = s.n % 4 < 2;
    g.stamp((l) => {
      const x = Math.round(A.top.x) - 2, y = Math.round(A.top.y) - 2 - (fl ? 1 : 0);
      l.rect(x, y, 4, 2, "#FF9F1C").px(x, y, "#FFD23F").px(x + 4, y + (fl ? 0 : 1), "#FF7A1A").px(x + 5, y + (fl ? -1 : 1), "#FF7A1A").px(x + 1, y, INKX);
    }, "#3A1A06");
  }
  if (s.k === 1 && s.n % 6 < 4) g.text("!", 3, 3, GOLD);
}, 30);

// ============================================================ 2. marlin
/** A bendy rod: a quadratic curve from the butt (x0,y0) to the tip, bowed by `bend`. */
const rod = (g, x0, y0, x1, y1, bend) => {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / L) * bend, cy = my + (dx / L) * bend;
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
    pts.push([a * x0 + b * cx + c * x1, a * y0 + b * cy + c * y1]);
  }
  g.stamp((l) => { for (let i = 0; i < pts.length - 1; i++) l.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], i < 4 ? "#6B3A1E" : "#C8A06A"); }, WOOD_O);
};
/** A big leaping fish, drawn facing left around (16,16): long bill, tall sail, forked tail. */
const LINE = "#98A2B4";
const bigFish = (g) => {
  g.stamp((l) => {
    l.ell(16, 16, 5.5, 2.3, (nx, ny) => (ny > 0.25 ? "#CFE8F7" : ny < -0.45 ? "#163E73" : "#2A64A8"));
    for (const x of [14, 16, 18]) l.px(x, 16, "#7CC8FF");
    l.line(10, 16, 6, 15, "#163E73").px(11, 15, "#163E73");
    l.px(12, 15, WHITE);
    // Sail: a tall fan along the back.
    for (let i = 0; i < 6; i++) l.line(13 + i, 14, 13 + i, 14 - Math.round(3.5 * Math.sin(((i + 1) / 7) * Math.PI) + 0.5), "#2A64A8");
    l.line(21, 16, 24, 13, "#163E73").line(21, 16, 24, 19, "#163E73").px(22, 16, "#2A64A8");
  }, "#0B1A30");
};

def("marlin", "The Big One", "Books", 72, "Book nod: The Old Man and the Sea. A bite, a leaping marlin, and Pip hanging on to the rod.", (g, f) => {
  const s = tl(f, [14, 6, 10, 14, 8, 12, 8]);
  const water = 25;
  sea(g, f, water);
  let lift = 0, lean = 0, bend = 0, jig = 0;
  if (s.k === 1) { bend = 1; }
  if (s.k === 2) { lean = 2; bend = 4; jig = s.n % 2 ? 1 : 0; }
  if (s.k === 3) { lift = hop(s.t, 1) * 7; lean = 1; bend = 5; }
  if (s.k === 4) { lift = 0; lean = -1; bend = 3; }
  if (s.k === 5) { lean = -2; bend = 4 + (s.n % 4 < 2 ? 1 : 0); jig = s.n % 2 ? 1 : 0; }
  if (s.k === 6) { lean = lerp(-2, 0, eo(s.t)); bend = 0; }
  const px = 8 + jig * 0.5, py = 26 + Math.round(wave(f, 16, 0.6)) + lift;
  const calm = s.k === 0 || s.k === 6;
  const A = drawPip(g, {
    x: px, y: py, w: 6, h: 5.6, lean,
    feet: lift < -2 ? (A) => [[A.cx - 2.5, A.bottom + 1.3, 1.6], [A.cx + 2.5, A.bottom + 1.8, 1.6]] : false,
    look: calm ? [0, 0] : [1, -1], fdx: calm ? 0 : 1,
    eyes: s.k === 0 ? (blink(f, 14, 10) ? "blink" : "happy") : s.k === 6 ? (s.n < 4 ? "x" : "blink") : s.k === 1 || s.k === 3 ? "wide" : "determined",
    mouth: s.k === 0 ? "whistle" : s.k === 1 || s.k === 3 ? "o" : s.k === 6 ? "wavy" : "grit",
    brows: s.k === 2 || s.k === 5 ? "angry" : null,
    la: calm ? 28 + wave(f, 24, 6) : -40 + jig * 10,
    sq: s.k === 3 ? -0.15 * Math.sin(Math.PI * s.t) : s.k === 4 ? 0.12 : 0,
    hands: (A) => [{ x: A.handR[0] - 0.5, y: A.cy + 3 }, { x: A.handR[0] + 1.5, y: A.cy + 0.5 }]
  });
  hull(g, 1, 15, 24 + Math.round(wave(f, 16, 0.6)));
  // Where the line goes: a bobber, a hooked fish under the water, or the leaping fish.
  const bx = A.handR[0] - 1, by = A.cy + 4;
  let tip, end, fish = null;
  if (s.k === 3) {
    const fxp = lerp(29, 21, s.t), fyp = water + 4 - Math.sin(Math.PI * s.t) * 17;
    const dx = -9, dy = -17 * Math.PI * Math.cos(Math.PI * s.t);
    const rot = 0.6 * Math.atan2(-dy, -dx);
    fish = { x: fxp, y: fyp, rot };
    end = [fxp - Math.cos(rot) * 5, fyp - Math.sin(rot) * 5];
  } else if (calm) {
    end = [26, water - 1 + (s.k === 0 ? Math.round(wave(f, 12, 0.5)) : 0)];
  } else {
    end = [s.k === 1 ? 26 : 24 + (s.n % 6 < 3 ? 2 : 0), water + 2];
  }
  const tipBase = [bx + 8, by - 11];
  const pull = Math.atan2(end[1] - tipBase[1], end[0] - tipBase[0]);
  tip = [tipBase[0] + Math.cos(pull) * bend * 0.8, tipBase[1] + Math.sin(pull) * bend * 0.8];
  if (fish) g.xform((gg) => bigFish(gg), { cx: 16, cy: 16, rot: fish.rot, dx: fish.x - 16, dy: fish.y - 16 });
  // The line: taut when hooked, a lazy droop when calm.
  if (calm) {
    const sag = s.k === 6 ? 3 : 2;
    for (let i = 0; i <= 12; i++) { const t = i / 12; g.px(lerp(tip[0], end[0], t), lerp(tip[1], end[1], t) + Math.sin(Math.PI * t) * sag, LINE); }
  } else g.line(tip[0], tip[1], end[0], end[1], LINE);
  rod(g, bx, by, tip[0], tip[1], -bend);
  sea(g, f, water + 3, { amp: 0.6, ph: 2 });
  if (s.k === 0) g.stamp((l) => l.rect(end[0] - 1, end[1] - 1, 2, 1, RED).rect(end[0] - 1, end[1], 2, 1, WHITE), "#3A1A10");
  if (s.k === 1) { if (s.n < 3) for (let i = 0; i < 3; i++) g.px(24 + i * 2, water - 1 - (i % 2), FOAM); if (s.n % 4 < 3) g.text("!", 28, 12, GOLD); }
  if (s.k === 3 && s.t < 0.25 || s.k === 4) {
    const x = s.k === 3 ? 28 : 20, t = s.k === 3 ? s.t * 4 : s.t;
    for (let i = 0; i < 3; i++) fx.drop(g, x - 3 + i * 3, water - 2 - hop(Math.min(1, t), 1) * (4 + (i % 2) * 2));
  }
  if (s.k === 5) fx.drop(g, A.cx - 7, A.cy - 5 + s.n * 0.3, SKY);
}, 44);

// ============================================================ 3. greenlight
const NIGHT = "#1B2A4A", NIGHT_M = "#2B4170", NIGHT_L = "#5A7BB8";
const GREEN_ON = "#6BFF9A", GREEN_GLOW = "#1FBF6A";

def("greenlight", "The Green Light", "Books", 60, "Book nod: The Great Gatsby. At night on a dock, Pip reaches for the green light across the water.", (g, f) => {
  const s = tl(f, [14, 12, 18, 16]);
  const on = f % 12 < 8;
  // Night: a thin moon and a few twinkling stars.
  g.stamp((l) => l.ell(5, 5, 3, 3, (nx, ny) => ((nx - 0.5) ** 2 + (ny + 0.35) ** 2 < 0.75 ? null : "#FFF3C4")), "#3A3010");
  for (let i = 0; i < 4; i++) fx.twinkle(g, [14, 21, 29, 11][i], [3, 7, 4, 10][i], ((f + i * 13) % 30) / 30, "#FFF3C4");
  // Dark water with a slow shimmer.
  for (let y = 22; y < 32; y++) for (let x = 12; x < 32; x++) {
    const sh = y > 23 && Math.sin(x * 0.9 + y * 2.1 + f * 0.25) > 0.97;
    g.px(x, y, y === 22 ? NIGHT_M : sh ? NIGHT_L : y < 26 ? NIGHT_M : NIGHT);
  }
  // The far shore, and the light on the end of a dock over there.
  g.stamp((l) => { l.rect(20, 20, 12, 2, "#16203A").rect(24, 19, 6, 1, "#16203A").rect(27, 16, 1, 4, "#3A4560"); }, "#0A1020");
  if (on) {
    const big = f % 12 < 4;
    // A soft halo, then a small green star of a lamp.
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.px(27 + Math.round(Math.cos(a) * (big ? 4 : 3)), 14 + Math.round(Math.sin(a) * (big ? 4 : 3)), "#6BFF9A55"); }
    g.stamp((l) => {
      l.px(27, 14, WHITE).px(26, 14, GREEN_ON).px(28, 14, GREEN_ON).px(27, 13, GREEN_ON).px(27, 15, GREEN_ON);
      if (big) l.px(25, 14, GREEN_GLOW).px(29, 14, GREEN_GLOW).px(27, 12, GREEN_GLOW);
    }, "#0E4A2A");
    // Its reflection, a broken green line on the water.
    for (let y = 23; y < 31; y += 2) g.px(27 + Math.round(Math.sin(y + f * 0.4)), y, y < 27 ? GREEN_ON : GREEN_GLOW);
  } else g.stamp((l) => l.px(27, 14, "#2F6A48"), "#0A1020");
  // Pip's dock: planks and posts.
  g.stamp((l) => {
    l.rect(0, 24, 17, 2, WOOD).rect(0, 24, 17, 1, WOOD_L);
    for (let x = 3; x < 17; x += 4) l.px(x, 25, WOOD_D);
    l.rect(2, 26, 2, 6, WOOD_D).rect(13, 26, 2, 6, WOOD_D);
  }, WOOD_O);
  const reach = s.k === 1 ? eio(s.t) : s.k === 2 ? 1 : s.k === 3 ? 1 - eio(Math.min(1, s.t * 1.5)) : 0;
  const shake = s.k === 2 ? (s.n % 4 < 2 ? 0.4 : -0.4) : 0;
  const sigh = s.k === 3 && s.t > 0.3;
  g.shadow(9, 5, 23);
  const A = drawPip(g, {
    x: 9, y: 24, w: 6.5, h: 6, lean: reach * 1.5,
    look: [0, -1], fdx: 1,
    eyes: sigh ? "closed" : s.k === 0 && blink(f, 14, 10) ? "blink" : "open",
    mouth: sigh ? "o" : reach > 0.5 ? "tiny" : "flat",
    brows: "sad", blush: reach > 0.5 ? "big" : true,
    la: lerp(40, 70, reach) + wave(f, 30, 5),
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: lerp(A.handR[0], A.handR[0] + 5, reach) + shake, y: lerp(A.handR[1], A.cy - 6, reach) }]
  });
  if (sigh) fx.puff(g, A.fc + 6 + (s.t - 0.3) * 4, A.ey + 3 - (s.t - 0.3) * 6, 1 + (1 - s.t), "#C9D6F0");
}, 30);

// ============================================================ 4. songbird
/** A point along Pip's leaf: u = -1 at the stem end, 0 mid-leaf, 1 at the tip. */
const leafAt = (A, la, u, ll = 1) => {
  const a = (la * Math.PI) / 180, bx = A.top.x, by = A.top.y + 1.2;
  const tx = bx + Math.sin(a * 0.35) * 2.6, ty = by - Math.cos(a * 0.35) * 2.6, L = 3.7 * ll;
  return [tx + Math.sin(a) * L * (0.92 + u), ty - Math.cos(a) * L * (0.92 + u)];
};
const BIRD = { h: "#9AA2AC", b: "#7A828C", c: "#DDE2E8", w: "#FFFFFF", t: "#3E434B", k: "#F0A020", e: "#10131A" };
/** A small grey songbird, feet at (x,y), facing right (dir 1) or left (-1). */
const songbird = (g, x, y, o = {}) => {
  const dir = o.dir || 1, rows = [
    "....hhh" + (o.sing ? "k." : ".."),
    "...hhhe" + (o.sing ? ".." : "k."),
    "tt.bbbb" + (o.sing ? "k." : ".."),
    "ttbwwwbb.",
    "..ccccc..",
  ];
  if (o.puff) { rows[2] = "tbbbbbb" + (o.sing ? "k." : ".."); rows[4] = ".ccccccc."; }
  const wing = o.flap === 1 ? [[3, -1], [4, -1], [4, -2], [5, -2], [5, -3]] : o.flap === 2 ? [[3, 5], [4, 5], [4, 6], [5, 6]] : [];
  x = Math.round(x); y = Math.round(y);
  const X = (i) => (dir > 0 ? x - 4 + i : x + 4 - i);
  g.stamp((l) => {
    rows.forEach((r, j) => [...r].forEach((ch, i) => ch !== "." && l.px(X(i), y - 5 + j, BIRD[ch])));
    for (const [i, j] of wing) l.px(X(i), y - 5 + j, BIRD.w);
    if (!o.flap) l.px(X(3), y, BIRD.t).px(X(5), y, BIRD.t);
    if (o.wide) l.px(X(6), y - 5, WHITE).px(X(6), y - 4, BIRD.e).px(X(7), y - 4, WHITE);
  }, "#1A1D24");
};

def("songbird", "Songbird", "Books", 72, "Book nod: To Kill a Mockingbird. A songbird lands on Pip's leaf and sings; Pip joins in, off-key.", (g, f) => {
  const s = tl(f, [14, 4, 18, 18, 10, 8]);
  const loud = s.k === 3 || s.k === 4;
  const la = s.k === 0 ? 40 : s.k === 1 ? 50 + 18 * Math.sin(Math.PI * s.t) : s.k <= 3 ? 52 + wave(f, 12, 3) : s.k === 4 ? 30 - 30 * s.t + wave(s.n, 4, 6) : wave(f, 24, 5) + 5;
  g.shadow(11, 6);
  const sway = s.k === 2 ? wave(s.n, 18, 0.8) : loud ? (f % 4 < 2 ? 0.5 : -0.5) : 0;
  const A = drawPip(g, {
    x: 11 + sway, y: 30, w: 7, h: 6, la,
    look: s.k <= 1 ? [0, -1] : loud ? [0, 0] : [0, -1],
    eyes: s.k === 0 || s.k === 1 ? "open" : s.k === 2 ? "happy" : loud ? "closed" : blink(s.n, 8, 3) ? "blink" : "open",
    mouth: s.k === 2 ? "smile" : loud ? (f % 6 < 3 ? "shout" : "open") : s.k === 5 ? "o" : "smile",
    blush: s.k === 2 || loud ? "big" : true,
    brows: s.k === 5 ? "up" : null,
    hands: loud ? (A) => [{ x: A.handL[0] - 1, y: A.cy - 3 - (f % 6 < 3 ? 1 : 0) }, { x: A.handR[0], y: A.handR[1] }] : null
  });
  const tip = leafAt(A, la, 0.75), perch = [tip[0] + 2, tip[1]];
  // The bird: flies in, perches and sings, puffs up in alarm, flies off.
  if (s.k === 0) {
    const t = eo(s.t);
    songbird(g, lerp(29, perch[0], t), lerp(3, perch[1] - 1, t) + hop(s.t, 2), { dir: -1, flap: s.n % 4 < 2 ? 1 : 2 });
  } else if (s.k <= 3) {
    const sing = s.k === 2 && s.n % 6 < 4;
    songbird(g, perch[0], perch[1] - 1 + (s.k === 1 ? 0 : 0), { dir: 1, sing, puff: s.k === 3 && s.t > 0.3, wide: s.k === 3 && s.t > 0.3 });
    if (s.k === 3 && s.t > 0.5 && s.n % 4 < 2) g.text("!", Math.round(perch[0]) + 4, Math.round(perch[1]) - 12, GOLD);
  } else if (s.k === 4) {
    const t = ei(s.t);
    songbird(g, lerp(perch[0], 2, t), lerp(perch[1] - 1, -2, t), { dir: -1, flap: s.n % 2 ? 1 : 2, wide: true });
  }
  // The bird's song: tidy notes floating up in a gentle wave.
  if (s.k === 2) for (let i = 0; i < 2; i++) {
    const age = (s.n + 12 - i * 6) % 12;
    if (age < 9) fx.note(g, perch[0] + [4, 8][i], perch[1] - [6, 9][i] - age * 0.35, "#8E5CFF");
  }
  // Pip's "harmony": crooked, tumbling notes, and a squiggle.
  if (loud) {
    // Notes burst out one after another at odd angles, each hanging about a moment.
    const spots = [[10, 0], [15, -5], [10, -10], [16, 3]];
    for (let i = 0; i < 4; i++) {
      const age = (s.n + (s.k === 4 ? 18 : 0) - i * 5 + 40) % 20;
      if (age > 11) continue;
      const [dx, dy] = spots[i];
      const jx = age % 4 < 2 ? 1 : 0;
      fx.note(g, A.fc + dx + jx, A.ey + dy - age * 0.25, i % 2 ? "#C0662A" : "#E0393E");
    }
  }
  if (s.k === 4 && s.t > 0.5) g.text("?", 22, 8, WHITE);
}, 34);

// ============================================================ 5. bigeye
/** A poster on the wall with one big staring eye. `open` 0..1, look in -1..1. */
const eyePoster = (g, x, y, open, lx, ly) => {
  g.stamp((l) => {
    l.rect(x, y, 10, 12, "#E4DDCB").rect(x, y, 10, 2, "#8E2F28").rect(x, y + 10, 10, 2, "#8E2F28");
    l.rect(x + 2, y + 11, 6, 1, "#E4DDCB");
  }, "#2A1A14");
  const cx = x + 5, cy = y + 6;
  if (open < 0.2) { g.line(cx - 3, cy, cx + 2, cy, "#2A1A14").px(cx - 3, cy + 1, "#2A1A14").px(cx + 2, cy + 1, "#2A1A14").px(cx - 1, cy + 1, "#2A1A14"); return; }
  const ry = 3 * open;
  g.stamp((l) => {
    l.ell(cx, cy, 4.3, ry, WHITE);
    const ix = Math.round(cx - 1.5 + lx), iy = Math.round(cy - 1.5 + ly * 0.8);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      if (Math.abs(iy + j + 0.5 - cy) > ry) continue;
      l.px(ix + i, iy + j, i === 1 && j === 1 ? "#10131A" : (i + j) % 2 ? "#8C3A2E" : "#6E2A22");
    }
    if (open > 0.6) l.px(ix, iy, WHITE);
  }, "#2A1A14");
};

def("bigeye", "Being Watched", "Books", 64, "Book nod: 1984, Brave New World, The Handmaid's Tale. Posters stare; Pip glances about and hides behind its book.", (g, f) => {
  const s = tl(f, [8, 6, 10, 10, 8, 10, 12]);
  const open = s.k === 0 ? 0 : s.k === 1 ? eo(s.t) : 1;
  // Pip is at the bottom middle, so both eyes look down and in.
  const blinkR = s.k === 5 ? 1 - Math.sin(Math.PI * s.t) : 1;
  const hide = s.k === 6 ? eo(Math.min(1, s.t * 3)) : 0;
  eyePoster(g, 0, 1, open, 1, 1);
  eyePoster(g, 22, 1, open * blinkR, -1, 1);
  if (s.k === 1 && s.n < 3) { fx.impact(g, 5, 7); fx.impact(g, 27, 7); }
  const lk = s.k === 2 ? -1 : s.k === 3 ? 1 : s.k === 6 ? (s.n % 8 < 4 ? -1 : 1) : 0;
  const nervous = s.k >= 2;
  g.shadow(16, 6, 30);
  const A = drawPip(g, {
    x: 16 + (s.k === 4 ? (f % 2 ? 0.5 : -0.5) : 0), y: 29, w: 7, h: 6,
    look: [lk, s.k === 0 ? 1 : 0], fdx: lk,
    eyes: s.k === 4 || s.k === 5 ? "wide" : nervous ? "open" : "happy",
    mouth: s.k === 0 ? "smile" : s.k === 4 ? "wavy" : s.k === 5 ? "o" : "flat",
    brows: nervous ? "sad" : null, blush: !nervous,
    la: nervous ? 70 + wave(f, 4, 4) : 28,
    hold: (g, A) => prop.openBook(g, A.cx, Math.round(lerp(A.cy + 4, A.ey + 2, hide)), { cover: "#3A5A8C", h: 5 }),
    hands: (A) => [{ x: A.cx - 5.5, y: lerp(A.cy + 6, A.ey + 4, hide) }, { x: A.cx + 5.5, y: lerp(A.cy + 6, A.ey + 4, hide) }]
  });
  if (s.k >= 4) fx.drop(g, A.cx + A.rx - 1, A.top.y + 2 + ((f % 12) / 12) * 5, SKY);
}, 30);

// ============================================================ 6. spiderweb
const SILK = "#A9B2C2";
const spider = (g, x, y, o = {}) => {
  x = Math.round(x); y = Math.round(y);
  const k = o.wiggle ? 1 : 0;
  g.stamp((l) => {
    for (const s of [-1, 1]) {
      l.px(x + s * 2, y - 1 - k, "#3A3D45").px(x + s * 3, y - 2, "#3A3D45");
      l.px(x + s * 2, y, "#3A3D45").px(x + s * 3, y + k, "#3A3D45");
      l.px(x + s * 2, y + 1, "#3A3D45").px(x + s * 3, y + 2, "#3A3D45");
    }
    l.rect(x - 1, y - 1, 3, 3, "#7A6A8C").px(x - 1, y - 1, "#A898BC").px(x, y + 2, "#7A6A8C");
    l.px(x - 1, y + 2, "#5A4A6C").px(x + 1, y + 2, "#5A4A6C");
    if (o.wave) l.px(x + 3, y - 3, "#3A3D45").px(x + 4, y - 4 + (o.wave > 1 ? 1 : 0), "#3A3D45");
  }, "#15151C");
  g.px(x - 1, y, WHITE).px(x + 1, y, WHITE);
};

/** Letters of the 3x5 font, revealed pixel by pixel (reveal 0..1 per letter). */
const silkText = (g, str, x, y, reveal, sc = 1) => {
  g.stamp((l) => {
    [...str].forEach((ch, n) => {
      const gph = FONT[ch], r = clamp(reveal - n);
      if (!gph || r <= 0) return;
      const cells = [];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (gph[j * 3 + i] === "#") cells.push([i, j]);
      cells.slice(0, Math.ceil(cells.length * r)).forEach(([i, j]) => l.rect(x + (n * 4 + i) * sc, y + j * sc, sc, sc, WHITE));
    });
  }, "#1A1A22");
};

def("spiderweb", "Some Pip", "Books", 72, "Book nod: Charlotte's Web. A spider spins a web that spells PIP; Pip beams.", (g, f) => {
  const s = tl(f, [10, 10, 24, 28]);
  const cx = 16, cy = 8;
  // The web: spokes first, then two rings strung between them.
  const spokes = s.k === 0 ? 0 : s.k === 1 ? Math.floor(s.t * 9) : 8;
  const rings = s.k >= 2 ? 2 : s.k === 1 && s.t > 0.6 ? 1 : 0;
  const R = 13;
  const reveal = s.k < 2 ? 0 : s.k === 2 ? s.t * 3 : 3;
  // Silk is kept clear of each finished letter's box, so the letters read cleanly.
  const ink = new Set();
  [..."PIP"].forEach((ch, n) => {
    if (reveal <= n + 0.3) return;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (FONT[ch][j * 3 + i] === "#") for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) ink.add((10 + n * 4 + i + dx) + "," + (6 + j + dy));
  });
  const clear = (x, y) => ink.has(x + "," + y);
  const silk = (x0, y0, x1, y1) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
    for (let i = 0; i <= n; i++) { const x = Math.round(lerp(x0, x1, i / n)), y = Math.round(lerp(y0, y1, i / n)); if (!clear(x, y)) g.px(x, y, SILK); }
  };
  for (let i = 0; i < spokes; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    silk(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.7);
  }
  for (let r = 0; r < rings; r++) {
    const rr = [6, 11][r];
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * TAU + Math.PI / 8, a1 = ((i + 1) / 8) * TAU + Math.PI / 8;
      silk(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr * 0.7, cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr * 0.7);
    }
  }
  const proud = s.k === 3;
  const glow = proud && s.n % 8 < 4;
  silkText(g, "PIP", 10, 6, reveal);
  // Where the spider is: dropping in on a thread, at the hub, stitching, then resting.
  let sp;
  if (s.k === 0) { sp = [cx, lerp(-3, cy, eo(s.t))]; g.line(cx, 0, cx, sp[1], SILK); }
  else if (s.k === 1) { const a = s.t * TAU; sp = [cx + Math.cos(a) * 3, cy + Math.sin(a) * 2]; }
  else if (s.k === 2) { const n = Math.min(2, Math.floor(s.t * 3)), u = (s.t * 3) % 1; sp = [11 + n * 4 + Math.round(u * 2), 5 + Math.round(u * 6)]; }
  else sp = [29, 15];
  spider(g, sp[0], sp[1], { wiggle: s.k === 2 && f % 2 === 0 || s.k === 1 && f % 3 === 0, wave: proud ? (s.n % 8 < 4 ? 1 : 2) : 0 });
  const lookUp = s.k >= 1;
  g.shadow(16, 6);
  drawPip(g, {
    y: 30 + (proud ? hop(clamp((s.n % 14) / 7), 1.5) : 0), w: 7, h: 5.5,
    look: [0, lookUp ? -1 : 0],
    eyes: proud ? (s.n < 6 ? "wide" : "star") : s.k === 2 ? "open" : blink(f, 10, 6) ? "blink" : "open",
    mouth: proud ? "open" : s.k === 2 ? "o" : "smile",
    blush: proud ? "big" : true, la: proud ? -70 + wave(f, 12, 8) : -65,
    sq: proud ? -0.05 : 0,
    hands: proud ? (A) => [{ x: A.handL[0] - 1, y: A.cy - 4 }, { x: A.handR[0] + 1, y: A.cy - 4 }] : null
  });
  if (proud && s.n > 6) { fx.twinkle(g, 3, 15, ((f % 10) / 10), GOLD); fx.twinkle(g, 29, 3, (((f + 5) % 10) / 10), GOLD); }
}, 58);

// ============================================================ 7. bookrescue
/** A licking flame, base centred at (x, y), h tall. */
const flame = (g, x, y, h, ph) => {
  g.stamp((l) => {
    for (let j = 0; j <= h; j++) {
      const t = j / h, wob = Math.sin(ph * 1.7 + j * 0.8) * 1.1 * t;
      const half = (h * 0.32) * Math.sin(Math.PI * Math.min(1, (t + 0.2) / 1.05)) * (1 - t * 0.5);
      for (let i = -4; i <= 4; i++) {
        const d = Math.abs(i - wob);
        if (d > half + 0.3) continue;
        const core = d < half * 0.45;
        l.px(x + i, y - j, t > 0.75 ? "#FFE36B" : core ? (t < 0.4 ? "#FFF3B0" : "#FFC53D") : t < 0.35 ? "#F0492F" : "#FF8A2A");
      }
    }
  }, "#3A1409");
};
const fireHelmet = (g, A) => {
  const x = Math.round(A.top.x), y = Math.round(A.top.y) - 1;
  g.stamp((l) => {
    l.rect(x - 2, y - 2, 5, 1, "#D8342C").rect(x - 3, y - 1, 7, 1, "#D8342C").rect(x - 4, y, 9, 2, "#D8342C");
    l.px(x - 2, y - 2, "#FF7A6A").rect(x - 3, y - 1, 2, 1, "#FF7A6A");
    l.rect(x - 6, y + 2, 13, 1, "#9A1E18").rect(x + 5, y + 1, 3, 1, "#9A1E18");
    l.rect(x - 1, y - 1, 3, 3, GOLD).px(x, y, "#B07F00");
  }, "#2A0A08");
};

def("bookrescue", "Book Rescue", "Books", 64, "Book nod: Fahrenheit 451. In a fire helmet, Pip dives into the flames and comes out hugging a book.", (g, f) => {
  const s = tl(f, [10, 8, 8, 8, 30]);
  const ph = f * 0.9;
  const hot = s.k === 2 ? 1.25 : s.k === 4 ? 0.8 : 1;
  // The book in the fire, until Pip grabs it.
  if (s.k < 2) prop.closedBook(g, 4, 24, 7, 4, "#3A5A8C");
  flame(g, 3, 29, Math.round(8 * hot + wave(f, 5, 1)), ph);
  flame(g, 11, 29, Math.round(7 * hot + wave(f, 6, 1, 2)), ph + 2);
  flame(g, 7, 29, Math.round(11 * hot + wave(f, 4, 1, 1)), ph + 4);
  for (let i = 0; i < 3; i++) { const t = ((f + i * 7) % 20) / 20; fx.ember(g, 4 + i * 3 + Math.round(wave(f + i * 5, 10, 1)), 18 - t * 14, t); }
  const soot = (g, A) => {
    for (const [dx, dy] of [[-6, -1], [-5, -1], [-6, 0], [5, 0], [6, 0], [5, -1], [-1, 5], [0, 5]]) g.px(A.fc + dx, A.ey + dy, "#4A4440");
  };
  let o = { la: -10, eyes: "determined", brows: "angry", mouth: "flat", look: [-1, 0], fdx: 0, over: fireHelmet };
  let x = 23, y = 30;
  if (s.k === 0) Object.assign(o, { sq: s.t > 0.6 ? 0.12 : 0, mouth: s.t > 0.6 ? "grit" : "flat" });
  if (s.k === 1) { x = lerp(23, 9, eio(s.t)); y = 30 + hop(s.t, 7); Object.assign(o, { lean: -2, sq: -0.1, eyes: "squeeze", mouth: "grit", hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 3 }, { x: A.handR[0], y: A.cy - 2 }] }); }
  if (s.k === 3) { x = lerp(9, 22, eo(s.t)); y = 30 + hop(s.t, 5); Object.assign(o, { lean: 1, eyes: "squeeze", mouth: "grit", look: [1, 0], fdx: 0, under: soot }); }
  if (s.k === 4) {
    x = 22;
    const cough = s.n >= 10 && s.n < 16;
    Object.assign(o, {
      look: [0, 0], fdx: 0, brows: null, under: soot, la: 20 + wave(f, 20, 6), leafShade: "#3A3A30",
      eyes: cough ? "squeeze" : s.n < 10 ? "happy" : blink(s.n, 14, 26) ? "blink" : "happy", mouth: cough ? "o" : "smile", blush: false,
      sq: cough ? (s.n % 2 ? 0.08 : 0) : 0
    });
  }
  const book = s.k >= 3;
  if (book) o.hands = (A) => [{ x: A.cx - 4, y: A.cy + 4 }, { x: A.cx + 4, y: A.cy + 4 }];
  if (s.k === 2) {
    // Pip is somewhere in there: a burst of smoke, a flailing hand.
    for (let i = 0; i < 4; i++) fx.puff(g, 5 + i * 3, 20 - (i % 2) * 3 - s.t * 2, 2.6, "#B9B3A8");
    if (s.n % 4 < 2) g.stamp((l) => l.ell(9 + (s.n % 8 < 4 ? 2 : -1), 15, 1.8, 1.8, g.S.base));
  } else {
    g.shadow(x, 6, 31);
    const A = drawPip(g, Object.assign(o, { x, y, w: 7.5, h: 6.8, acc: false }));
    if (book) prop.closedBook(g, A.cx - 3, A.cy + 2, 7, 5, "#3A5A8C");
    if (s.k === 4) {
      if (s.n >= 10 && s.n < 18) fx.puff(g, A.cx + 7 + (s.n - 10) * 0.4, A.ey + 2 - (s.n - 10) * 0.5, 1.4, "#8C867B");
      if (s.n > 18) fx.heart(g, A.cx + 5, A.top.y - 6 - ((s.n - 18) % 12) * 0.4, s.n % 12 < 6);
      const t = (s.n % 16) / 16;
      g.px(A.top.x - 4 + Math.round(wave(s.n, 8, 1)), A.top.y - 2 - t * 5, "#8C867Bcc");
    }
  }
}, 48);

// ============================================================ 8. monster
const slab = (g) => {
  g.stamp((l) => {
    l.rect(2, 25, 28, 3, "#8C93A0").rect(2, 25, 28, 1, "#B4BAC6").rect(2, 27, 28, 1, "#6A717E");
    l.rect(4, 28, 3, 4, "#6A717E").rect(25, 28, 3, 4, "#6A717E");
  }, "#1E222A");
};
const boltsAndStitches = (g, A) => {
  const y = Math.round(A.ey);
  g.stamp((l) => {
    l.rect(Math.round(A.cx - A.rx) - 2, y, 2, 2, "#9AA3B2").px(Math.round(A.cx - A.rx) - 2, y, "#D8DEE6");
    l.rect(Math.round(A.cx + A.rx) + 1, y, 2, 2, "#9AA3B2").px(Math.round(A.cx + A.rx) + 2, y, "#D8DEE6");
  }, "#1E222A");
  // A stitched seam down the middle of the forehead.
  const sx = Math.round(A.fc) - 1, sy = Math.round(A.ey) - 5;
  g.line(sx, sy, sx, sy + 3, INKX);
  for (const dy of [0, 2]) g.px(sx - 1, sy + dy, INKX).px(sx + 1, sy + dy, INKX);
};

def("monster", "It's Alive", "Books", 60, "Book nod: Frankenstein. Lightning strikes the slab; Pip sits up stiffly, bolts and all, then grins and waves.", (g, f) => {
  const s = tl(f, [12, 6, 12, 10, 20]);
  slab(g);
  // Lying flat with its feet out to the right, then up in three stiff jolts.
  const step = s.k === 2 ? Math.min(3, Math.floor(s.t * 4)) : s.k > 2 ? 3 : 0;
  const rot = -Math.PI / 2 * (1 - step / 3);
  const u = step / 3;
  const w = lerp(6.2, 7, u), h = lerp(7, 6, u);
  const flash = s.k === 1 && s.n % 2 === 0;
  const jolt = s.k === 2 && s.n % 4 === 0 ? -1 : 0;
  const bodyC = [16, lerp(25 - w, 25 - h, u) + jolt];
  let o = { eyes: "closed", mouth: "flat", blush: false, la: 80, over: boltsAndStitches, feet: false, hands: false };
  if (s.k === 1) o = { eyes: "x", mouth: "shout", blush: false, la: s.n % 2 ? 60 : 110, over: boltsAndStitches, sq: -0.05, feet: false };
  if (s.k === 2) o = { eyes: "wide", mouth: "flat", blush: false, la: 0, over: boltsAndStitches };
  if (s.k === 3) o = { eyes: "wide", mouth: "flat", blush: false, la: 0, over: boltsAndStitches, hands: (A) => [{ x: A.cx - A.rx - 3, y: A.cy - 1 }, { x: A.cx + A.rx + 3, y: A.cy - 1 }] };
  if (s.k === 4) {
    const wv = wave(s.n, 6, 1.5);
    o = {
      eyes: s.n < 4 ? "wide" : "happy", mouth: s.n < 4 ? "flat" : "grin", blush: s.n >= 4, la: 20 + wv * 8, over: boltsAndStitches,
      hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + A.rx + 2 + wv, y: A.cy - 7 }]
    };
  }
  g.xform((gg) => drawPip(gg, Object.assign(o, { x: 16, y: 16 + h, w, h })), {
    cx: 16, cy: 16, rot, dx: bodyC[0] - 16, dy: bodyC[1] - 16,
    tint: flash ? (c) => (c === g.S.outline || c === g.S.ink || c === INKX ? "#2A2A33" : "#FFF7C2") : null
  });
  // A sheet over Pip on the slab, which blows away when the bolt hits.
  if (s.k === 0 || s.k === 1) {
    const off = s.k === 1 ? eo(s.t) : 0;
    g.xform((gg) => gg.stamp((l) => {
      l.rect(15, 18, 13, 7, "#F4F1E8").rect(15, 18, 13, 1, WHITE).ell(26, 18, 2.2, 1.6, "#F4F1E8").ell(22.5, 18, 2, 1.4, "#F4F1E8");
      for (const x of [17, 20, 23]) l.px(x, 21, "#D0C9B8").px(x + 1, 22, "#D0C9B8");
      l.rect(15, 24, 13, 1, "#D0C9B8");
    }, "#3A3528"), { cx: 21, cy: 21, rot: off * 0.8, dx: off * 12, dy: -off * 14 });
  }
  // The storm and the strike.
  fx.cloud(g, 22, 2, 6, "#5A6070");
  if (s.k === 1) {
    g.stamp((l) => { l.line(23, 4, 19, 8, GOLD).line(19, 8, 22, 9, GOLD).line(22, 9, 17, 15, GOLD).px(20, 7, WHITE).px(20, 11, WHITE); }, "#4A3100");
    fx.burst(g, 16, 17, s.t, GOLD);
  }
  if (s.k === 2 && s.n % 4 < 2) { fx.star(g, 6, 12, 1, WHITE); fx.star(g, 27, 14, 1, WHITE); }
  if (s.k === 0 && s.n > 6 && s.n % 3 === 0) g.px(24, 5, "#FFE36B");
}, 50);

// ============================================================ 9. vampire
const CAPE = "#1E1A2A", CAPE_L = "#3A3350", LINING = "#B0202A", LINING_D = "#7A1018";
const bat = (g, x, y, ph) => {
  x = Math.round(x); y = Math.round(y);
  const up = ph % 4 < 2;
  g.stamp((l) => {
    l.rect(x, y, 2, 2, "#5A4A70").px(x, y - 1, "#5A4A70").px(x + 1, y - 1, "#5A4A70");
    if (up) l.line(x - 1, y, x - 3, y - 2, "#5A4A70").line(x + 2, y, x + 4, y - 2, "#5A4A70").px(x - 2, y, "#5A4A70").px(x + 3, y, "#5A4A70");
    else l.line(x - 1, y + 1, x - 3, y + 2, "#5A4A70").line(x + 2, y + 1, x + 4, y + 2, "#5A4A70").px(x - 2, y, "#5A4A70").px(x + 3, y, "#5A4A70");
    l.px(x, y, "#FF5A5A").px(x + 1, y, "#FF5A5A");
  }, "#120E18");
};

def("vampire", "Night Owl", "Books", 72, "Book nod: Dracula and vampire novels. A cape swirl, tiny fangs, a bat; then the sun peeks out and Pip hides.", (g, f) => {
  const s = tl(f, [12, 10, 16, 6, 16, 12]);
  const spread = s.k === 1 ? eo(s.t) : s.k === 2 ? 1 : s.k === 3 ? 1 - s.t : 0;
  const hide = s.k === 4 ? 1 : s.k === 5 ? 1 - eo(s.t) : s.k === 3 ? s.t : 0;
  const sun = s.k === 3 ? eo(s.t) : s.k === 4 ? 1 : s.k === 5 ? 1 - ei(s.t) : 0;
  const shiver = s.k === 4 ? (f % 2 ? 0.5 : -0.5) : 0;
  // The sun slides in at the top right and shines down.
  if (sun > 0) {
    const sx = lerp(38, 27, sun), sy = 5;
    fx.rays(g, sx, sy, 5, f * 0.15, "#FFC53D");
    g.stamp((l) => l.ell(sx, sy, 3.6, 3.6, (nx, ny) => (nx + ny < -0.5 ? "#FFF3B0" : "#FFD23F")), "#8A5A00");
  }
  const cape = (g, A) => {
    const x = A.cx, cy = A.cy;
    g.stamp((l) => {
      // Body of the cape: a dark bell behind Pip, a red lining peeking at the hem.
      l.ell(x, cy + 1.5, A.rx + 2, A.ry + 1.5, (nx, ny) => (ny > 0.75 ? LINING_D : nx < -0.6 ? CAPE_L : CAPE));
      // High collar: two red-lined points either side of the head.
      for (const sd of [-1, 1]) {
        const bx = x + sd * (A.rx - 2);
        for (let j = 0; j < 6; j++) l.rect(Math.round(bx + sd * (j * 0.5)) - (sd > 0 ? 0 : 1), Math.round(cy - 2 - j), 2, 1, j > 3 ? CAPE : LINING);
      }
      // The swirl: one side sweeps out like a wing.
      if (spread > 0.05) {
        const tipx = x + A.rx + 2 + spread * 7, tipy = cy - 4 - spread * 3, bot = A.bottom + 1;
        for (let yy = Math.round(tipy); yy <= bot; yy++) {
          const t = (yy - tipy) / (bot - tipy);
          // Outer edge curves from the raised hand down to the hem, with bat-wing scallops.
          const edge = lerp(tipx, x + A.rx + 1, t * t) - (t > 0.3 && Math.round(yy) % 4 === 0 ? 1 : 0);
          for (let xx = Math.round(x + 2); xx <= edge; xx++) l.px(xx, yy, xx > edge - 1.5 || yy === Math.round(tipy) ? CAPE : LINING);
        }
      }
    }, "#0C0A12");
  };
  const fangs = (g, A) => { const c = A.fc, my = A.ey + 3; g.px(c - 2, my + 1, WHITE).px(c + 1, my + 1, WHITE); };
  const smug = s.k <= 2;
  g.shadow(15, 7);
  const A = drawPip(g, {
    x: 15 + shiver, w: 7, h: 6.4, y: 29, behind: cape, acc: false,
    eyes: smug ? (s.k === 1 || s.k === 2 ? "half" : blink(f, 12, 8) ? "blink" : "half") : s.k === 4 && s.n < 6 ? "squeeze" : "wide",
    look: s.k === 4 && s.n >= 6 ? [s.n % 8 < 4 ? 1 : -1, 0] : [0, 0],
    brows: smug ? "angry" : null, mouth: smug ? (s.k === 2 && s.n % 8 < 4 ? "open" : "smile") : "wavy", blush: false,
    la: smug ? -20 + wave(f, 24, 6) : 60,
    over: (g, A) => {
      if (smug) fangs(g, A);
      if (hide > 0) {
        // The cape swept up over the face like a wing; only the eyes peek over.
        const top = lerp(A.bottom + 2, A.ey + 1.5, hide);
        g.stamp((l) => {
          l.ell(A.cx, top + 6, A.rx + 1.5, 6.5, (nx, ny) => (ny < -0.72 ? LINING : nx > 0.5 ? CAPE_L : CAPE));
        }, "#0C0A12");
      }
    },
    hands: (A) => hide > 0.5
      ? [{ x: A.cx - 5, y: A.ey + 2 }, { x: A.cx + 5, y: A.ey + 2 }]
      : spread > 0.05 ? [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + A.rx + 2 + spread * 7, y: A.cy - 4 - spread * 3 }] : null
  });
  // The bat: loops around Pip, then flees from the light.
  if (s.k <= 2) { const a = f * 0.22; bat(g, 15 + Math.cos(a) * 11, 8 + Math.sin(a) * 3, f); }
  else if (s.k === 3 || s.k === 4) { const t = s.k === 3 ? s.t * 0.3 : 0.3 + s.t * 0.7; bat(g, lerp(10, -4, t), lerp(6, -3, t), f); }
  if (s.k === 4) fx.drop(g, A.cx - A.rx - 1, A.top.y - 1 + (s.n % 8) * 0.5, SKY);
  if (s.k === 4 && s.n < 8 && s.n % 4 < 2) g.text("!", 3, 10, GOLD);
}, 28);

// ============================================================ 10. sleuth
const deerstalker = (g, A) => {
  const x = Math.round(A.top.x), y = Math.round(A.top.y);
  g.stamp((l) => {
    // A round checked crown, a short peak front and back, ear flaps tied up on top.
    [[-2, 3], [-3, 4], [-4, 5], [-4, 5]].forEach(([a, b], j) => { for (let i = a; i <= b; i++) l.px(x + i, y - 3 + j, (i + j) % 2 ? "#A67C52" : "#7A5534"); });
    l.rect(x - 4, y + 1, 10, 1, "#5E3A1F");
    l.rect(x - 7, y + 1, 3, 1, "#8A6040").px(x - 7, y + 2, "#8A6040");
    l.rect(x + 6, y + 1, 3, 1, "#8A6040").px(x + 8, y + 2, "#8A6040");
    l.px(x - 1, y - 4, "#C8A06A").px(x + 2, y - 4, "#C8A06A").px(x, y - 4, "#5E3A1F").px(x + 1, y - 4, "#5E3A1F");
  }, "#2A1A0E");
};
const bulb = (g, x, y, on) => {
  g.stamp((l) => {
    l.ell(x, y, 2.8, 2.8, (nx, ny) => (on ? (nx + ny < -0.6 ? WHITE : "#FFE55C") : nx + ny < -0.6 ? "#F4F4F4" : "#C9CED6"));
    l.rect(x - 1, y + 2, 3, 2, "#8A93A0").px(x - 1, y + 3, "#C9CED6");
  }, "#2A2A33");
};
const lens = (g, x, y, zoomPrint) => {
  x = Math.round(x); y = Math.round(y);
  g.px(x, y, "#CFEFFF55");
  g.stamp((l) => {
    l.ring(x + 0.5, y + 0.5, 3, "#C9A13A");
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (i * i + j * j <= 5) l.px(x + i, y + j, i + j < -1 ? "#FFFFFFaa" : "#CFEFFF66");
    if (zoomPrint) l.rect(x - 1, y - 1, 3, 2, "#5A3A20").px(x - 1, y + 1, "#5A3A20").px(x + 2, y - 2, "#5A3A20").px(x, y - 2, "#5A3A20");
    l.line(x + 2, y + 3, x + 4, y + 5, "#5E3A1F");
  }, "#2A1A0E");
};

def("sleuth", "Elementary", "Books", 64, "Book nod: Sherlock Holmes, Agatha Christie. Deerstalker and magnifying glass on a trail of footprints, then a bright idea.", (g, f) => {
  const s = tl(f, [20, 14, 8, 22]);
  // The trail of footprints across the floor.
  for (let i = 0; i < 7; i++) {
    const x = 1 + i * 4, y = 29 + (i % 2);
    g.px(x, y, "#5A3A20").px(x + 1, y, "#5A3A20").px(x + 2, y, "#6B4A2E").px(x + 1, y + 1, "#6B4A2E");
  }
  let x = 16, lean = 0, o = { eyes: "determined", brows: "focus", mouth: "flat", look: [-1, 1], la: 60 };
  let lensAt = null, zoom = false;
  if (s.k === 0) {
    x = lerp(25, 17, s.t);
    const step = f % 8 < 4;
    Object.assign(o, { y: 29 - (step ? 0.5 : 0), feet: (A) => [[A.cx - 3.5, A.bottom + 1.1 - (step ? 1 : 0)], [A.cx + 3.5, A.bottom + 1.1 - (step ? 0 : 1)]] });
    lean = -1;
    lensAt = [x - 11, 25 + (step ? 0 : 1)];
  }
  if (s.k === 1) {
    x = 17; lean = -2;
    Object.assign(o, { eyes: "wide", brows: "up", mouth: "o" });
    lensAt = [x - 11 + Math.round(wave(s.n, 14, 1)), 26];
    zoom = true;
  }
  if (s.k === 2) {
    x = 17;
    Object.assign(o, { eyes: "open", look: [0, -1], mouth: "flat", brows: "focus", la: 60 });
  }
  if (s.k === 3) {
    x = 17;
    Object.assign(o, { eyes: s.n < 4 ? "wide" : "star", look: [0, 0], mouth: "open", brows: null, blush: "big", leaf: "none", la: 0, y: 29 + (s.n < 8 ? hop(s.n / 8, 2) : 0) });
  }
  g.shadow(x, 6);
  const A = drawPip(g, Object.assign(o, {
    x, lean, over: deerstalker, acc: false,
    hands: (A) => lensAt ? [{ x: lensAt[0] + 5, y: lensAt[1] + 5 }, { x: A.handR[0], y: A.handR[1] }]
      : s.k === 2 ? [{ x: A.fc + 1, y: A.ey + 5 }, { x: A.handR[0], y: A.handR[1] }]
      : [{ x: A.handL[0] - 1, y: A.cy - 4 }, { x: A.handR[0] + 1, y: A.cy - 4 }]
  }));
  if (lensAt) lens(g, lensAt[0], lensAt[1], zoom);
  if (s.k === 2 && s.n > 2) g.text("?", 26, 6, WHITE);
  if (s.k === 3) {
    const on = s.n % 10 < 8 || s.n < 4, bx = Math.round(A.top.x) + 1, by = Math.round(A.top.y) - 9;
    if (on && s.n > 1) fx.rays(g, bx, by, 4, 0, "#FFE36B");
    bulb(g, bx, by, s.n > 1 && on);
    if (s.n > 2) g.text("!", 26, 6, GOLD);
    if (s.n > 6) fx.twinkle(g, 5, 10, ((s.n - 6) % 10) / 10, WHITE);
  }
}, 52);

// ============================================================ 11. windmill
const WM = [10, 10, 4, 8, 4, 28];
const WM_HUB = [23, 13], WM_R = 9.5;
/** Spin speed per frame: a lazy turn, whipped up by the lance, then winding down. */
const wmOmega = (f) => {
  const s = tl(f, WM);
  if (s.k <= 2) return 0.04;
  if (s.k === 3) return lerp(0.04, 0.42, s.t);
  if (s.k === 4) return 0.42;
  return lerp(0.42, 0.04, eo(s.t));
};
const wmTable = (() => {
  const loop = WM.reduce((a, b) => a + b, 0), q = Math.PI / 2;
  const raw = [0];
  for (let f = 1; f <= loop; f++) raw.push(raw[f - 1] + wmOmega(f - 1));
  // Top up the wind-down so a whole loop turns a whole quarter (the sails repeat every 90 degrees).
  const k5 = WM.slice(0, 5).reduce((a, b) => a + b, 0), fix = (Math.ceil(raw[loop] / q) * q - raw[loop]) / (loop - k5);
  const a = raw.map((v, f) => v + Math.max(0, f - k5) * fix);
  // And rotate everything so one sail comes round onto Pip's head on the bonk frame.
  const bonk = k5 - 4, want = Math.PI - 0.12;
  const off = want - a[bonk];
  return a.map((v) => v + off);
})();

const windmill = (g, ang) => {
  g.stamp((l) => {
    for (let y = 14; y <= 31; y++) { const hw = lerp(3, 5, (y - 14) / 17); l.rect(Math.round(WM_HUB[0] - hw), y, Math.round(hw * 2) + 1, 1, y % 4 === 0 ? "#C9BC9E" : "#E2D7BD"); }
    for (let j = 0; j < 4; j++) l.rect(WM_HUB[0] - j - 1, 10 + j, j * 2 + 3, 1, j === 0 ? "#B0503E" : "#8A3A2E");
    l.rect(WM_HUB[0] - 1, 27, 3, 4, "#5E3A1F").rect(WM_HUB[0] - 1, 19, 2, 2, "#3A4560");
  }, "#2A1A10");
  g.stamp((l) => {
    for (let k = 0; k < 4; k++) {
      const a = ang + (k * Math.PI) / 2, ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
      for (let r = 1; r <= WM_R; r += 0.5) {
        const x = WM_HUB[0] + ux * r, y = WM_HUB[1] + uy * r;
        l.px(x, y, "#6B4A2E");
        if (r > 3) { l.px(x + px, y + py, (Math.round(r) % 2) ? "#F4F1E8" : "#D8CBB0"); l.px(x + px * 2, y + py * 2, "#F4F1E8"); }
      }
    }
    l.rect(WM_HUB[0] - 1, WM_HUB[1] - 1, 2, 2, "#3A2A1E");
  }, "#2A1A10");
};
const lanceAt = (g, x0, y0, ang, len) => {
  const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
  g.stamp((l) => { l.line(x0, y0, x1, y1, "#B4BAC6"); l.px(x1, y1, WHITE); l.line(x0 - Math.cos(ang) * 2, y0 - Math.sin(ang) * 2, x0, y0, "#6B4A2E"); }, "#1E222A");
};
const potHelmet = (g, A) => {
  const x = Math.round(A.top.x), y = Math.round(A.top.y) - 1;
  g.stamp((l) => { l.rect(x - 2, y - 2, 5, 1, "#E6C35A").rect(x - 3, y - 1, 7, 2, "#C9A13A").rect(x - 5, y + 1, 11, 1, "#E6C35A").px(x - 2, y - 1, "#FFF1A8"); }, "#3A2A08");
};

def("windmill", "Tilting at Windmills", "Books", 64, "Book nod: Don Quixote. Pip charges a windmill with a lance; a sail swings round and bonks it.", (g, f) => {
  const s = tl(f, WM);
  windmill(g, wmTable[f]);
  let x = 8, y = 29, o = { eyes: "determined", brows: "angry", mouth: "grit", la: -30, lean: 0 };
  let lance = { ang: -0.5, len: 13 };
  if (s.k === 0) { x = 8 - (s.n % 4 < 2 ? 0.5 : 0); o.lean = -1; o.feet = (A) => [[A.cx - 3.5, A.bottom + 1.1], [A.cx + 3.5, A.bottom + 1.1 - (s.n % 4 < 2 ? 1 : 0)]]; lance.ang = lerp(-0.8, -0.2, s.t); }
  if (s.k === 1) { x = lerp(8, 11, ei(s.t)); o.lean = 2; o.mouth = "shout"; lance.ang = -0.1; o.y = 29 - (s.n % 2); }
  if (s.k === 2) { x = 11; o.lean = 1; o.eyes = "squeeze"; lance.ang = -0.1; }
  if (s.k === 3) { x = 11; o.eyes = "wide"; o.brows = "up"; o.mouth = "o"; o.look = [1, -1]; lance.ang = lerp(-0.1, -0.9, s.t); }
  if (s.k === 4) { x = 11; o = { eyes: "x", mouth: "shout", sq: 0.28, la: 100 }; lance = { ang: 0.4, len: 12 }; }
  if (s.k === 5) {
    x = 11;
    o = { eyes: "spiral", eyePhase: f, mouth: "wavy", sq: lerp(0.18, 0, eo(s.t)), la: 80 - 50 * s.t, lean: wave(s.n, 14, 1) };
    lance = null;
  }
  if (s.k === 1) for (let i = 0; i < 3; i++) fx.speed(g, x - 10 - i * 2, 19 + i * 4, 4, "#8A93A0");
  if (s.k === 1 || s.k === 2) fx.puff(g, x - 7, 29, 1.4 + (s.n % 3) * 0.3, "#E6DCC6");
  g.shadow(x, 6);
  const A = drawPip(g, Object.assign({ x, y, w: 5.8, h: 5.4, over: potHelmet, acc: false }, o, {
    hands: (A) => (lance ? [{ x: A.handR[0], y: A.handR[1] }, { x: A.handR[0] + 1, y: A.handR[1] - 1 }] : [{ x: A.handL[0] - 1, y: A.handL[1] + 1 }, { x: A.handR[0] + 1, y: A.handR[1] + 1 }])
  }));
  if (lance) lanceAt(g, A.handR[0], A.handR[1], lance.ang, lance.len);
  else g.stamp((l) => l.line(A.cx + 3, 30, A.cx + 14, 29, "#B4BAC6").px(A.cx + 14, 29, WHITE).line(A.cx + 9, 29, A.cx + 11, 27, "#B4BAC6"), "#1E222A");
  if (s.k === 2) fx.star(g, 20, 13, 2, WHITE);
  if (s.k === 4) { fx.impact(g, A.top.x + 1, A.top.y); fx.star(g, A.top.x + 3, A.top.y - 3, 2); }
  if (s.k === 5) for (let i = 0; i < 3; i++) { const a = f * 0.4 + (i * TAU) / 3; fx.star(g, A.top.x + Math.cos(a) * 6, A.top.y - 2 + Math.sin(a) * 1.5, 1); }
}, 38);

// ============================================================ 12. beetle
const SHELL = "#6B3A1E", SHELL_L = "#A0602E", SHELL_D = "#3E200E", LEG = "#9A6A3A";
const beetleBits = (wig, still) => (g, A) => {
  g.stamp((l) => {
    // The shell: a glossy dome behind Pip with a seam down the middle.
    l.ell(A.cx, A.cy - 0.5, A.rx + 1.6, A.ry + 1.4, (nx, ny) => (nx < -0.3 && ny < -0.2 ? SHELL_L : nx > 0.5 ? SHELL_D : SHELL));
    l.line(A.cx, A.cy - A.ry - 1.5, A.cx, A.cy - A.ry + 1, SHELL_D);
  }, "#1A0E06");
  {
    const l = g;
    // Six skinny legs, three a side, sticking out past the shell.
    [-1, 1].forEach((sd) => [-3, 1, 5].forEach((dy, i) => {
      const w = still ? 0 : wig(i, sd);
      const x0 = A.cx + sd * (A.rx + 0.5), y0 = A.cy + dy;
      const kx = A.cx + sd * (A.rx + 3.5), ky = y0 - 1.5 + w;
      l.line(x0, y0, kx, ky, LEG).line(kx, ky, kx + sd, ky + 2.5 - w * 0.5, LEG);
    }));
  }
};

def("beetle", "Rude Awakening", "Books", 64, "Book nod: The Metamorphosis. Pip wakes with a shell and six legs, flails on its back, then rights itself, dazed.", (g, f) => {
  const s = tl(f, [12, 12, 6, 16, 6, 12]);
  let rot = 0, dy = 0, o = { eyes: "closed", mouth: "tiny", la: 90, sq: 0.06 + wave(f, 24, 0.03) };
  let wig = () => 0, still = true;
  if (s.k === 1) {
    const see = s.n >= 5;
    o = { eyes: s.n < 3 ? "half" : see ? "wide" : "open", look: [0, see ? 1 : 0], mouth: see ? "o" : "flat", brows: see ? "up" : null, la: see ? 0 : 60 };
    still = s.n < 5; wig = (i, sd) => ((s.n + i + (sd > 0 ? 1 : 0)) % 2 ? 1 : -1);
  }
  if (s.k === 2) { rot = Math.PI * eio(s.t); dy = hop(s.t, 5); o = { eyes: "wide", mouth: "shout", la: -30, brows: "up" }; still = false; wig = (i) => ((f + i) % 2 ? 1 : -1); }
  if (s.k === 3) {
    rot = Math.PI + wave(s.n, 8, 0.28); dy = 0;
    o = { eyes: s.n % 8 < 4 ? "wide" : "squeeze", mouth: "shout", la: 105 + wave(f, 4, 10), brows: "up" };
    still = false; wig = (i, sd) => ((f + i * 2 + (sd > 0 ? 1 : 0)) % 3) - 1;
  }
  if (s.k === 4) { rot = Math.PI + Math.PI * eio(s.t); dy = hop(s.t, 6); o = { eyes: "squeeze", mouth: "grit", la: 0 }; still = false; wig = (i) => ((f + i) % 2 ? 1 : -1); }
  if (s.k === 5) {
    o = { eyes: "spiral", eyePhase: f, mouth: "wavy", la: 30 + wave(s.n, 12, 20), sq: s.n < 3 ? 0.15 : 0 };
    still = false; wig = (i, sd) => (Math.floor(s.n / 3 + i + sd) % 2 ? 0.5 : -0.5);
  }
  const cy = 22.5;
  g.shadow(16, 8);
  g.xform((gg) => drawPip(gg, Object.assign({ y: 29, w: 7.5, h: 6.5, hands: false, feet: false, blush: true, behind: beetleBits(wig, still) }, o)), { cx: 16, cy, rot, dy });
  if (s.k === 0) { const t = (f % 12) / 12; fx.z(g, 23 + t * 4, 10 - t * 7, t > 0.5); }
  if (s.k === 1 && s.n >= 6 && s.n % 4 < 3) g.text("!", 27, 4, GOLD);
  if (s.k === 3 && s.n % 4 < 2) { g.px(4, 22, WHITE).px(3, 20, WHITE); g.px(28, 22, WHITE).px(29, 20, WHITE); }
  if (s.k === 5) for (let i = 0; i < 3; i++) { const a = f * 0.4 + (i * TAU) / 3; fx.star(g, 16 + Math.cos(a) * 8, 8 + Math.sin(a) * 1.5, 1); }
}, 34);

// ============================================================ 13. tiedown
const ROPE = "#D9B97A", ROPE_D = "#9A7640";
const ropeLine = (l, x0, y0, x1, y1, sag = 0) => {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = Math.round(lerp(x0, x1, t)), y = Math.round(lerp(y0, y1, t) + Math.sin(Math.PI * t) * sag);
    l.px(x, y, (x + y) % 2 ? ROPE : ROPE_D);
  }
};
const stake = (l, x, y) => l.rect(x, y - 3, 1, 4, "#8A5A34").px(x, y - 3, "#C8955A");
/** A very small person with a hammer: 3px wide, 5px tall. */
const tinyFolk = (g, x, y, hammerUp, run) => {
  x = Math.round(x); y = Math.round(y);
  g.stamp((l) => {
    l.px(x, y - 4, "#F2C9A0").rect(x, y - 3, 1, 2, "#2F6FD6").px(x - 1, y - 3, "#F2C9A0");
    l.px(x - (run ? 1 : 0), y - 1, "#3A2A1E").px(x + (run ? 1 : 0), y - 1, "#3A2A1E");
    l.px(x, y - 5, "#5E3A1F");
    if (hammerUp != null) { if (hammerUp) l.px(x + 1, y - 5, "#8A93A0").px(x + 1, y - 4, "#6B4A2E"); else l.px(x + 1, y - 2, "#6B4A2E").px(x + 2, y - 2, "#8A93A0"); }
  }, "#1A140E");
};

def("tiedown", "Tied Down", "Books", 60, "Book nod: Gulliver's Travels. Tiny ropes and stakes pin Pip down; it wriggles free with a pop.", (g, f) => {
  const s = tl(f, [14, 18, 4, 8, 16]);
  const pinned = s.k <= 1;
  const strain = s.k === 1 ? s.t : 0;
  const wr = s.k === 1 ? (f % 4 < 2 ? 1 : -1) * lerp(0.4, 1.4, s.t) : 0;
  let y = 30, o = {};
  if (pinned) o = {
    sq: 0.08 - strain * 0.06, x: 16 + wr, la: 95 - strain * 20 * (f % 4 < 2 ? 1 : 0),
    look: s.k === 0 ? [s.n < 7 ? -1 : 1, 0] : [0, 0], fdx: s.k === 0 ? (s.n < 7 ? -1 : 1) : 0,
    eyes: s.k === 0 ? (s.n % 7 < 1 ? "blink" : "open") : f % 6 < 3 ? "squeeze" : "determined",
    mouth: s.k === 0 ? "o" : "grit", brows: s.k === 0 ? "up" : "angry", blush: s.k === 1 ? "big" : true,
    hands: false, feet: false
  };
  if (s.k === 2) { y = 30 - s.t * 3; o = { sq: -0.2, eyes: "wide", mouth: "shout", la: 0, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 5 }, { x: A.handR[0] + 2, y: A.cy - 5 }] }; }
  if (s.k === 3) { y = 27 + 3 * ei(s.t); o = { sq: s.t > 0.8 ? 0.1 : -0.1, eyes: "happy", mouth: "open", la: 20, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 5 }, { x: A.handR[0] + 2, y: A.cy - 5 }] }; }
  if (s.k === 4) o = { eyes: s.n > 10 ? "happy" : "open", mouth: "smile", la: 28 + wave(f, 16, 8), blush: "big", hands: s.n < 10 ? (A) => [{ x: A.handL[0] - 1, y: A.cy + 3 + (s.n % 4 < 2 ? 1 : 0) }, { x: A.handR[0] + 1, y: A.cy + 3 + (s.n % 4 < 2 ? 0 : 1) }] : null };
  g.shadow(16, 7, 31);
  const A = drawPip(g, Object.assign({ y, w: 8, h: 6.5 }, o));
  const ropes = [[3, 30, -4.4, 29, 30], [6, 31, 4.8, 26, 31]];
  if (pinned) {
    const bulge = s.k === 1 ? -Math.round(strain * 1.5) : 0;
    g.stamp((l) => {
      for (const [x0, y0, off, x1, y1] of ropes) {
        const yy = A.cy + off, xl = A.cx - A.rx * Math.sqrt(Math.max(0.1, 1 - (off / A.ry) ** 2)), xr = 2 * A.cx - xl;
        ropeLine(l, x0, y0 - 1, xl, yy);
        ropeLine(l, xl, yy, xr, yy, bulge);
        ropeLine(l, xr, yy, x1, y1 - 1);
        stake(l, x0, y0); stake(l, x1, y1);
      }
      // One more over the leaf, pegged down on the right.
      const lt = [A.top.x + 6, A.top.y + 1];
      ropeLine(l, lt[0] - 2, lt[1] - 1, 30, 29);
      stake(l, 30, 30);
    }, "#2A1E10");
    // A very small person, busy with a hammer.
    if (s.k === 0) { tinyFolk(g, 2, 31, s.n % 4 < 2); if (s.n % 4 === 2) g.px(5, 25, WHITE).px(6, 24, WHITE); }
    else tinyFolk(g, 2, 31, null);
    if (s.k === 0 && s.n > 8) g.text("?", 26, 8, WHITE);
    if (s.k === 1) fx.drop(g, A.cx + A.rx - 1, A.top.y + (s.n % 9) * 0.6, SKY);
  } else {
    // Snapped ropes and stakes fly off, and the little worker runs for it.
    const t = s.k === 2 ? s.t * 0.3 : s.k === 3 ? 0.3 + s.t * 0.7 : 1;
    if (s.k < 4) {
      fx.burst(g, 16, 22, s.k === 2 ? s.t * 0.5 : 0.5 + s.t * 0.5, ROPE);
      g.stamp((l) => ropes.forEach(([x0, y0, , x1, y1], i) => {
        const h = hop(t, 8 + i * 2);
        stake(l, Math.round(x0 - t * (4 + i)), Math.round(y0 + h));
        stake(l, Math.round(x1 + t * (3 + i)), Math.round(y1 + h));
      }), "#2A1E10");
    } else g.stamp((l) => { ropeLine(l, 3, 31, 9, 30); ropeLine(l, 23, 31, 29, 30); l.rect(1, 30, 1, 1, "#8A5A34").rect(30, 30, 1, 1, "#8A5A34"); }, "#2A1E10");
    if (s.k === 2 || s.k === 3) { const u = s.k === 2 ? s.t * 0.3 : 0.3 + s.t * 0.7; tinyFolk(g, lerp(2, -2, u), 31, null, f % 2); }
    if (s.k === 2) g.text("POP", 10, 2, GOLD);
    if (s.k === 4 && s.n > 10) fx.twinkle(g, 27, 12, ((s.n - 10) % 6) / 6, WHITE);
  }
}, 20);
