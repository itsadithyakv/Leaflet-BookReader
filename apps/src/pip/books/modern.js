/* Book scenes, part of ./index.js. */
import { drawPip, drawHand } from "../engine.js";
import { def, fx, prop, kit } from "../anims.js";

const { TAU, wave, tri, lerp, clamp, eo, ei, eio, back, hop, rnd, tl, blink, GOLD, RED, WHITE, PINK, BLUE, SKY, INKX } = kit;

// Nods to modern, sci-fi and popular books. Each scene is its own little
// story with a beginning, a middle and an end, and stays inside the 32px frame.

// ------------------------------------------------------------ floating books
// Books lift off a shelf and orbit Pip, who conducts them with one finger.
const FLOAT_BOOKS = [
  { x: 2, h: 7, c: "#C8453B", a: (5 * Math.PI) / 4 },
  { x: 6, h: 6, c: "#2F8FE6", a: (3 * Math.PI) / 4 },
  { x: 23, h: 6, c: "#FFB400", a: -Math.PI / 4 },
  { x: 27, h: 7, c: "#8E5CFF", a: Math.PI / 4 }
];
const uprightBook = (g, x, y, h, c) => {
  x = Math.round(x); y = Math.round(y);
  g.stamp((l) => {
    l.rect(x, y, 3, h, c).rect(x, y + 1, 3, 1, GOLD).rect(x, y + h - 2, 3, 1, GOLD).px(x, y, "#FFFFFF");
  });
};
const flyingBook = (g, x, y, c, flap) => {
  // An open book seen side-on, its covers beating like wings.
  x = Math.round(x); y = Math.round(y);
  const rows = flap ? ["c.....c", "cpp.ppc", ".cpcpc.", "..ccc.."] : ["..ccc..", ".cpcpc.", "cpp.ppc", "c.....c"];
  g.stamp((l) => rows.forEach((r, j) => [...r].forEach((ch, i) => ch !== "." && l.px(x - 3 + i, y - 2 + j, ch === "c" ? c : "#FFF6DF"))));
};
def("floatbooks", "Book Conductor", "Books", 60, "A nod to the girl who moved things with her mind: books lift off the shelf and circle Pip.", (g, f) => {
  const s = tl(f, [10, 10, 28, 12]);
  const orbit = (a) => [16 + Math.cos(a) * 12, 9.5 + Math.sin(a) * 3.2];
  const home = (b) => [b.x + 1.5, 22 - b.h / 2];
  const books = FLOAT_BOOKS.map((b, i) => {
    let p, fly = false, a = b.a;
    if (s.k === 0) p = home(b);
    else if (s.k === 1) { const t = eio(clamp((s.t - i * 0.1) / 0.7)); p = [lerp(home(b)[0], orbit(a)[0], t), lerp(home(b)[1], orbit(a)[1], t)]; fly = t > 0.15; }
    else if (s.k === 2) { a = b.a + TAU * s.t; p = orbit(a); fly = true; }
    else { const t = eio(clamp((s.t - i * 0.08) / 0.7)); p = [lerp(orbit(a)[0], home(b)[0], t), lerp(orbit(a)[1], home(b)[1], t)]; fly = t < 0.9; }
    return { b, p, fly, front: fly && Math.sin(a) > 0 && s.k === 2 };
  });
  const shelf = (g) => g.stamp((l) => {
    l.rect(0, 22, 32, 2, "#8A5A34").rect(0, 23, 32, 1, "#5E3A1F");
    l.rect(3, 24, 1, 2, "#5E3A1F").rect(28, 24, 1, 2, "#5E3A1F");
  }, "#2E1D10");
  const drawBook = (g, o) => {
    const bob = o.fly ? wave(f + o.b.x, 8, 0.6) : 0;
    if (o.fly) flyingBook(g, o.p[0], o.p[1] + bob, o.b.c, (f + o.b.x) % 8 < 4);
    else uprightBook(g, o.p[0] - 1.5, o.p[1] - o.b.h / 2, o.b.h, o.b.c);
  };
  shelf(g);
  for (const o of books) if (!o.front) drawBook(g, o);
  let o;
  const ang = s.k === 2 ? TAU * s.t : 0;
  const finger = (up) => (A) => [
    { x: A.handL[0], y: A.handL[1] },
    {
      x: lerp(A.handR[0], A.cx + 9 + Math.cos(ang) * 1.5, up), y: lerp(A.handR[1], A.top.y + 1 + Math.sin(ang) * 1.5, up),
      item: up > 0.5 ? (g, h) => g.stamp((l) => l.rect(Math.round(h.x), Math.round(h.y - 4.5), 1, 3, g.S.base)) : null
    }
  ];
  if (s.k === 0) o = { eyes: "determined", brows: "focus", mouth: "flat", la: 20, hands: finger(eo(s.t)) };
  if (s.k === 1) o = { eyes: "wide", mouth: "o", la: 10, hands: finger(1) };
  if (s.k === 2) o = { eyes: "closed", mouth: "smile", la: 20 + wave(s.n, 14, 12), lean: wave(s.n, 28, 0.8), hands: finger(1) };
  if (s.k === 3) o = { eyes: "happy", mouth: "open", blush: "big", la: 28, hands: finger(1 - eo(s.t)) };
  g.shadow(16, 6);
  const A = drawPip(g, o);
  for (const b of books) if (b.front) drawBook(g, b);
  if (s.k >= 1 && s.k <= 2) fx.twinkle(g, A.cx + 9 + Math.cos(ang) * 1.5, A.top.y - 4 + Math.sin(ang) * 1.5, (f % 8) / 8, "#C79BFF");
  if (s.k === 0 && s.t > 0.5) for (const b of FLOAT_BOOKS) g.px(b.x + 1, 22 - b.h - 1, "#C79BFF");
}, 34);

// ------------------------------------------------------------ sandworm
const SAND = "#E6BE72", SAND_L = "#F7DFA6", SAND_D = "#C08D45";
const WORM = "#B08A6A", WORM_L = "#D6B996", WORM_D = "#7A5A42", MAW = "#4A1418", MAW_D = "#2A0A0C", FANG = "#FFF6DF";
const sandPuff = (g, x, y, r) => g.stamp((l) => l.ell(x, y, r, r * 0.8, (nx, ny) => (nx + ny < -0.3 ? SAND_L : SAND)), SAND_D);
// A worm the size of a hill, seen mouth-on: a round maw ringed with teeth.
const worm = (g, wx, wy, gape, f) => {
  g.stamp((l) => {
    for (let y = Math.round(wy); y < 30; y++) {
      const bend = Math.round(Math.sin((y - wy) / 7) * 1.5);
      const ring = (y - Math.round(wy) + Math.floor(f / 2)) % 4 === 0;
      for (let x = wx - 7 + bend; x <= wx + 7 + bend; x++) l.px(x, y, ring ? WORM_D : x < wx - 3 + bend ? WORM_L : x > wx + 4 + bend ? WORM_D : WORM);
    }
    const r = 7.5;
    l.ell(wx + 0.5, wy + 0.5, r, r * 0.8, (nx, ny) => (ny < -0.4 ? WORM_L : WORM));
    const ri = 1.2 + gape * 5;
    l.ell(wx + 0.5, wy + 0.8, ri, ri * 0.8, (nx, ny) => (nx * nx + ny * ny < 0.35 ? MAW_D : MAW));
    // Two rings of fangs, all pointing into the throat.
    if (gape > 0.2) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + 0.2;
        const c = Math.cos(a), sn = Math.sin(a) * 0.8;
        l.px(wx + 0.5 + c * (ri - 0.3), wy + 0.8 + sn * (ri - 0.3), FANG);
        if (i % 2 === 0) l.px(wx + 0.5 + c * (ri - 1.3), wy + 0.8 + sn * (ri - 1.3), FANG);
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        l.px(wx + 0.5 + Math.cos(a) * ri * 0.45, wy + 0.8 + Math.sin(a) * ri * 0.36, "#E8D9B8");
      }
    } else {
      // Clamped shut: three lips pinched together.
      l.line(wx - 3, wy - 1, wx, wy + 1, MAW_D).line(wx + 4, wy - 1, wx + 1, wy + 1, MAW_D).line(wx + 0.5, wy + 1, wx + 0.5, wy + 4, MAW_D);
    }
  }, "#2A1A10");
};
def("sandworm", "Sand Surfer", "Books", 60, "A nod to the desert planet: a giant worm bursts from the dunes and Pip surfs away on the ripple.", (g, f) => {
  const s = tl(f, [12, 8, 8, 5, 15, 12]);
  // Pip's spot, and the ripple of sand it rides out and back on (on a book).
  let px = 11, surf = 0;
  if (s.k === 4) { px = lerp(11, -16, eio(s.t)); surf = clamp(s.t * 4); }
  if (s.k === 5) { px = lerp(-14, 11, eo(s.t)); surf = 1 - clamp(s.t * 1.6 - 0.6); }
  const shake = s.k === 1 ? (s.n % 2 ? 1 : -1) : 0;
  // The worm: rises behind, gapes, snaps shut on empty sand, sinks.
  let wy = 44, gape = 0;
  if (s.k === 1) wy = lerp(44, 32, s.t);
  if (s.k === 2) { wy = lerp(32, 9, eo(s.t)); gape = eo(s.t); }
  if (s.k === 3) { wy = 9; gape = 1; }
  if (s.k === 4) { wy = 9 + (s.n > 7 ? 2 : 0) + (s.n > 7 ? 0 : 0); gape = s.n < 7 ? 1 : s.n < 9 ? 0.5 : 0; }
  if (s.k === 5) { wy = lerp(11, 44, ei(s.t)); gape = 0; }
  const wx = 22 - (s.k === 4 ? Math.round(2 * eo(clamp(s.t * 2))) : 0);
  const ground = (x) => 27 + Math.round(Math.sin(x * 0.45 + f * 0.5) * 0.7 - (surf ? 4 * surf * Math.exp(-(((x - px) / 5) ** 2)) : 0));
  if (wy < 32) worm(g, wx, wy, gape, f);
  for (let x = 0; x < 32; x++) {
    const h = ground(x);
    for (let y = h; y < 32; y++) g.px(x, y, y === h ? SAND_L : (x + y * 3 + Math.floor(f / 2)) % 11 === 0 ? SAND_D : SAND);
  }
  if (s.k === 1) for (let i = 0; i < 4; i++) g.px(wx - 6 + i * 4, 26 - ((s.n + i) % 2), SAND_D);
  if (s.k === 2) for (let i = 0; i < 4; i++) sandPuff(g, wx - 9 + i * 6, 27 - s.t * 3 - (i % 2) * 2, 1.2 + s.t * 1.2);
  const onY = ground(Math.round(px));
  let o;
  if (s.k === 0) o = { eyes: blink(s.n, 12, 8) ? "blink" : "happy", mouth: "smile", la: 28 + wave(f, 12, 6) };
  if (s.k === 1) o = { eyes: "wide", mouth: "o", la: 10, look: [0, 1] };
  if (s.k === 2) o = { eyes: "wide", brows: "up", mouth: "o", look: [1, -1], fdx: 1, la: -10 };
  if (s.k === 3) o = { eyes: "wide", brows: "up", mouth: "shout", sq: -0.12, la: 0, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 5 }, { x: A.handR[0] + 1, y: A.cy - 5 }] };
  if (s.k === 4) o = { eyes: "squeeze", mouth: "open", lean: -2, fdx: -1, look: [-1, 0], la: 70, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 2 }, { x: A.handR[0] + 2, y: A.cy - 3 }] };
  if (s.k === 5) o = { eyes: "half", mouth: "smirk", lean: 1.5, fdx: 1, la: -30, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 1 }, { x: A.handR[0] + 2, y: A.cy - 2 }] };
  const board = surf > 0.2;
  if (!board) g.shadow(px, 5, Math.min(31, onY + 1));
  drawPip(g, Object.assign({ x: px + shake * 0.5, y: onY - (board ? 2 : 0) }, o));
  if (board) {
    prop.closedBook(g, px - 6, onY - 1, 12, 2, "#2F8FE6");
    // Sand sprays off the back of the ripple.
    const dir = s.k === 4 ? 1 : -1;
    for (let i = 0; i < 3; i++) { const t = ((f + i * 3) % 9) / 9; sandPuff(g, px + dir * (8 + t * 6), onY - 1 - t * 3 - i, 0.9 + t * 0.6); }
  }
  if (s.k === 1 || s.k === 3) g.text("!", 3, 2, GOLD);
}, 29);

// ------------------------------------------------------------ towel and 42
const TOWEL = "#FF9F1C", TOWEL_D = "#D9731A", TOWEL_S = "#FFF6DF";
const towel = (g, A) => {
  // Folded over the left shoulder: a flap over the top, a long drop down the front.
  const x0 = Math.round(A.cx - A.rx) - 1, y0 = Math.round(A.cy - 4);
  const bottom = Math.round(A.bottom) + 1;
  g.stamp((l) => {
    l.rect(x0 + 1, y0 - 2, 4, 2, TOWEL).rect(x0 + 1, y0 - 2, 4, 1, "#FFC46B");
    for (let y = y0; y <= bottom; y++) {
      const stripe = y === bottom - 3 || y === bottom - 5;
      l.rect(x0, y, 4, 1, stripe ? TOWEL_S : TOWEL).px(x0 + 3, y, stripe ? "#E6DFCF" : TOWEL_D);
    }
    l.px(x0, bottom + 1, TOWEL_S).px(x0 + 2, bottom + 1, TOWEL_S);
  }, "#4A2408");
};
def("towel42", "Always Bring a Towel", "Books", 48, "A nod to the hitchhiking guide: towel on its shoulder, Pip holds up the answer and shrugs.", (g, f) => {
  const s = tl(f, [8, 14, 16, 10]);
  const shrug = s.k === 2 ? Math.sin(Math.PI * clamp(s.t * 1.25)) : 0;
  const py = s.k === 0 ? lerp(16, 2, back(s.t)) : s.k === 3 ? lerp(2, 16, ei(s.t)) : 2 - Math.round(shrug * 2);
  const signHand = { x: 22, y: py + 19 };
  let o;
  if (s.k === 0) o = { eyes: "open", mouth: "smile", la: -30 };
  if (s.k === 1) o = { eyes: s.n > 3 ? "wink" : "open", mouth: "smirk", la: -30 + wave(s.n, 14, 6) };
  if (s.k === 2) o = { eyes: shrug > 0.3 ? "closed" : "half", brows: "up", mouth: "smirk", sq: -0.1 * shrug, la: -40 + shrug * 20, hands: (A) => [{ x: A.handL[0] - 1.5 * shrug, y: A.handL[1] - 6 * shrug }, signHand] };
  if (s.k === 3) o = { eyes: "happy", mouth: "smile", la: -30 };
  g.shadow(11, 6);
  const A = drawPip(g, Object.assign({ x: 11, under: towel, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, signHand] }, o, {
    behind: (g) => {
      g.stamp((l) => l.rect(22, py + 12, 1, 7, "#8A5A34"), "#2E1D10");
      g.stamp((l) => l.rect(14, py, 17, 12, "#FFF6DF").rect(14, py + 11, 17, 1, "#DCC89C").rect(14, py, 17, 1, WHITE), "#3A2A1E");
      g.text("42", 16, py + 1, "#2F8FE6", 2);
    }
  }));
  if (s.k === 1 && s.n > 3) fx.twinkle(g, 27, 17, (s.n - 3) / 11, WHITE);
  if (s.k === 2 && shrug > 0.5) { g.px(A.cx - 12, A.cy - 7, WHITE).px(A.cx - 11, A.cy - 8, WHITE).px(A.cx - 3, A.top.y - 1, WHITE).px(A.cx - 2, A.top.y - 2, WHITE); }
}, 16);

// ------------------------------------------------------------ potatoes on mars
const MARS = "#C1502E", MARS_L = "#E07A4A", MARS_D = "#8A3320";
const POTATO = "#B07D48", POTATO_L = "#D6A56E";
// A glass dome over Pip, sealed by a metal ring low on the body, antenna on top.
const helmet = (g, A) => {
  const cy = A.cy - 1, rx = A.rx + 1.6, ry = A.ry + 5.5;
  const cut = Math.round(A.bottom - 2);
  const half = rx * Math.sqrt(Math.max(0, 1 - ((cut + 0.5 - cy) / ry) ** 2));
  const top = Math.round(cy - ry);
  g.stamp((l) => l.rect(Math.round(A.cx) + 3, top - 3, 1, 3, "#8A93A0").px(Math.round(A.cx) + 3, top - 4, (g.f % 12) < 6 ? RED : "#FF8A8A"), "#2A3340");
  for (let y = top - 1; y < cut; y++) for (let x = Math.floor(A.cx - rx - 1); x <= A.cx + rx + 1; x++) {
    const nx = (x + 0.5 - A.cx) / rx, ny = (y + 0.5 - cy) / ry, d = nx * nx + ny * ny;
    if (d > 1) continue;
    if (d > 0.8) g.px(x, y, "#E6F6FF");
    else if (nx < -0.3 && ny < -0.3 && nx + ny > -1.2 && nx + ny < -1.0) g.px(x, y, WHITE);
  }
  const x0 = Math.round(A.cx - half), w = Math.round(half * 2) + 1;
  g.stamp((l) => l.rect(x0, cut, w, 2, "#C9D1DB").rect(x0, cut + 1, w, 1, "#8A93A0").px(x0 + 2, cut, WHITE), "#2A3340");
};
const thumbsUp = (A) => ({
  x: A.cx + 11, y: A.cy - 6, r: 2,
  item: (g, h) => g.stamp((l) => l.rect(Math.round(h.x) - 1, Math.round(h.y) - 5, 2, 3, g.S.base).px(Math.round(h.x) - 1, Math.round(h.y) - 5, g.S.light))
});
def("potatoes", "Space Farmer", "Books", 60, "A nod to the stranded botanist: on red ground, Pip plants a potato, waters it, and gives the sprout a thumbs up.", (g, f) => {
  const s = tl(f, [12, 6, 14, 6, 6, 16]);
  // Red ground, a far ridge, and a little tilled mound.
  g.stamp((l) => { l.ell(3, 28, 6, 3, MARS_D); l.ell(29, 28, 5, 2.4, MARS_D); }, "#4A1A10");
  for (let x = 0; x < 32; x++) for (let y = 28; y < 32; y++) g.px(x, y, y === 28 ? MARS_L : (x * 7 + y * 3) % 9 === 0 ? MARS_D : MARS);
  g.stamp((l) => l.rect(23, 27, 7, 1, "#6B2616").rect(24, 26, 5, 1, "#6B2616"), "#3A1008");
  let o = {}, hand = null, item = null;
  if (s.k === 0) {
    const t = eo(clamp(s.t * 1.4));
    hand = [lerp(21, 25.5, t), lerp(21, 24, t)];
    o = { eyes: "open", look: [1, 1], fdx: 1, mouth: "tiny", lean: 1.5 * t };
    if (s.t < 0.75) item = (g, h) => g.stamp((l) => l.ell(h.x + 1, h.y - 2.5, 2.4, 1.8, (nx, ny) => (nx + ny < -0.3 ? POTATO_L : POTATO)).px(h.x + 2, h.y - 3, "#6B4A1E").px(h.x, h.y - 2, "#6B4A1E"), "#3A2410");
    else g.stamp((l) => l.ell(26.5, 24.5 + (s.t - 0.75) * 8, 2.4, 1.8, POTATO), "#3A2410");
  }
  if (s.k === 1) { hand = [26.5, 25 + (s.n % 3 === 0 ? -1 : 0)]; o = { eyes: "happy", look: [1, 1], fdx: 1, mouth: "smile", lean: 1.5 }; if (s.n % 3 === 0) { g.px(23, 25, MARS_L).px(30, 25, MARS_L); } }
  if (s.k === 2) {
    hand = [22.5, 19];
    o = { eyes: "happy", fdx: 1, look: [1, 1], mouth: "smile", lean: 1 };
    item = (g, h) => {
      g.stamp((l) => {
        l.rect(h.x + 1, h.y - 2, 5, 4, "#6FA8BA").rect(h.x + 1, h.y - 2, 5, 1, "#B9D6E0");
        l.line(h.x + 6, h.y, h.x + 8, h.y + 2, "#6FA8BA");
      }, "#1E3A44");
      for (let i = 0; i < 3; i++) { const t = ((s.n + i * 3) % 8) / 8; g.px(Math.round(h.x + 8 + (i % 2)), Math.round(h.y + 3 + t * 4), SKY); }
    };
  }
  if (s.k === 3) o = { eyes: s.n < 3 ? "open" : "blink", look: [1, 1], fdx: 1, mouth: "tiny" };
  const sprout = s.k < 4 ? 0 : s.k === 4 ? back(s.t) : 1;
  if (s.k === 4) o = { eyes: "wide", look: [1, 0], fdx: 1, mouth: "o", brows: "up", la: 0 };
  if (s.k === 5) o = { eyes: "happy", mouth: "open", blush: "big", la: 20 + wave(s.n, 12, 8), hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, thumbsUp(A)] };
  if (sprout > 0) {
    const hgt = Math.max(1, Math.round(7 * sprout)), sw = s.k === 5 ? Math.round(wave(s.n, 12, 0.6)) : 0;
    g.stamp((l) => {
      l.rect(26, 27 - hgt, 1, hgt, "#3E8F3B");
      if (hgt > 3) {
        const y = 27 - hgt;
        l.rect(23 + sw, y, 3, 2, "#6CC04A").px(23 + sw, y, "#A2E477").rect(27 + sw, y - 1, 3, 2, "#6CC04A").px(29 + sw, y - 1, "#A2E477");
      }
    }, "#15281B");
  }
  g.shadow(11, 6, 28);
  drawPip(g, Object.assign({
    x: 11, y: 28, ll: 0.7, la: 30,
    hands: hand ? (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: hand[0], y: hand[1], item }] : null,
    over: helmet
  }, o, { la: o.la ?? 30 }));
  if (s.k === 5) { fx.twinkle(g, 30, 10, (s.n % 8) / 8); fx.twinkle(g, 24, 4, ((s.n + 4) % 8) / 8, WHITE); }
  if (s.k === 4 && s.t > 0.4) fx.star(g, 29, 15, 1, "#A2E477");
}, 52);

// ------------------------------------------------------------ rock friend
const ROCK = "#A09383", ROCK_L = "#CFC3B0", ROCK_D = "#6E6257", ROCK_LEG = "#8A7D6E";
const rockAlien = (g, x, f, o = {}) => {
  // A faceless, five-legged rock: a lumpy carapace high on spindly jointed legs.
  const y = 20 + (o.bounce || 0);
  const legs = [-8, -4, 0, 4, 8];
  g.stamp((l) => {
    legs.forEach((dx, i) => {
      if (o.arm && i === 0) return;
      const lift = o.walk && (i + Math.floor(f / 2)) % 2 === 0 ? 1.5 : 0;
      const ax = x + dx * 0.4, kx = x + dx * 0.8, fx0 = x + dx, ky = y - 3 - Math.abs(dx) * 0.15 - lift;
      l.line(ax, y, kx, ky, ROCK_LEG).line(kx, ky, fx0, 28 - lift, ROCK_LEG).px(kx, ky, ROCK_L);
    });
    if (o.arm) l.line(x - 3, y - 1, o.arm[0], o.arm[1], ROCK_LEG);
    l.ell(x, y, 4.6, 3.2, (nx, ny, px, py) => (ny < -0.4 && nx < 0.4 ? ROCK_L : ny > 0.45 ? ROCK_D : rnd(px * 13 + py * 7) > 0.78 ? ROCK_D : ROCK));
    l.ell(x - 1.5, y - 3, 2, 1.3, ROCK_L).ell(x + 2, y - 2.6, 1.5, 1.1, ROCK);
    if (o.arm) l.ell(o.arm[0], o.arm[1], 1.7, 1.7, (nx, ny) => (nx + ny < -0.4 ? ROCK_L : ROCK));
  }, "#241E18");
};
def("rockfriend", "Rock Friend", "Books", 60, "A nod to the lone astronaut and the rocky friend who talks in music: a fist bump across the stars.", (g, f) => {
  const s = tl(f, [16, 6, 6, 18, 14]);
  let ax = 23, walk = false, arm = null, bounce = 0;
  if (s.k === 0) { ax = lerp(42, 23, eo(s.t)); walk = s.t < 0.85; }
  if (s.k === 1) arm = [lerp(20, 21, s.t), lerp(16, 13, eo(s.t))];
  if (s.k === 2) arm = [lerp(21, 19, ei(s.t)), lerp(13, 20, ei(s.t))];
  if (s.k === 3) { arm = s.n < 3 ? [19, 20] : null; bounce = s.n % 4 < 2 ? -1 : 0; }
  if (s.k === 4) { ax = lerp(23, 42, ei(s.t)); walk = true; }
  let o;
  if (s.k === 0) o = { eyes: s.t > 0.6 ? "wide" : "open", look: [1, 0], fdx: 1, mouth: s.t > 0.6 ? "o" : "smile", la: 20 };
  if (s.k === 1) o = { eyes: "determined", fdx: 1, look: [1, 0], mouth: "smirk", la: 10, lean: -1, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + 6, y: A.cy + 1 }] };
  if (s.k === 2) o = { eyes: s.t > 0.6 ? "squeeze" : "determined", fdx: 1, mouth: "grit", la: -20, lean: 1, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: lerp(A.cx + 6, 16.8, ei(s.t)), y: A.cy + 1 }] };
  if (s.k === 3) o = { y: 28 + (s.n < 8 ? hop(s.n / 8, 2) : 0), eyes: "happy", mouth: "open", blush: "big", la: 30 + wave(s.n, 6, 12), hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 3 }, { x: A.handR[0] + 1, y: A.cy - 3 }] };
  if (s.k === 4) o = { eyes: "happy", mouth: "smile", la: 20, fdx: 1, look: [1, 0], hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0] + 1, y: A.cy - 4 + (s.n % 6 < 3 ? 0 : 1) }] };
  g.shadow(8, 6);
  if (ax < 36) g.shadow(ax, 6);
  drawPip(g, Object.assign({ x: 8 }, o));
  rockAlien(g, ax, f, { walk, arm, bounce });
  if (s.k === 2 && s.t > 0.6) { fx.impact(g, 18, 21); fx.star(g, 18, 15, 1, WHITE); }
  if (s.k === 3) {
    const cols = ["#8E5CFF", "#2F8FE6", "#FF4D6D"];
    for (let i = 0; i < 3; i++) { const t = ((s.n + i * 6) % 18) / 18; if (t < 0.85) fx.note(g, ax - 4 + i * 3 + wave(s.n + i * 4, 10, 1), 11 - t * 11, cols[i]); }
  }
  if (s.k === 0 && s.t > 0.6) g.text("?", 3, 3, WHITE);
}, 28);

// ------------------------------------------------------------ zero gravity
const WALL = "#8A93A0", WALL_D = "#5A6270", WALL_L = "#C9D1DB", SPACE = "#141A36";
def("zerog", "Zero-G", "Books", 72, "A nod to the battle school in orbit: Pip floats, tumbling slowly, and pushes off the walls.", (g, f) => {
  const t = f / 72;
  // Two portholes full of stars.
  g.stamp((l) => { for (const wx of [9, 23]) l.ell(wx, 5.5, 4.2, 4.2, (nx, ny) => (nx * nx + ny * ny > 0.6 ? WALL_L : SPACE)); }, "#2A3340");
  for (const wx of [9, 23]) {
    for (let i = 0; i < 3; i++) g.px(Math.round(wx - 2 + rnd(wx + i) * 4), Math.round(3.5 + rnd(wx + i + 9) * 4), (f + i * 7 + wx) % 18 < 13 ? WHITE : "#7F8CB3");
    const tw = ((f + wx * 2) % 24) / 24;
    if (tw > 0.3 && tw < 0.8) g.px(wx, 4, WHITE).px(wx - 1, 5, "#C9D1FF").px(wx + 1, 5, "#C9D1FF").px(wx, 6, "#C9D1FF").px(wx, 5, WHITE);
  }
  for (const x of [0, 29]) {
    g.stamp((l) => {
      l.rect(x, 0, 3, 32, WALL).rect(x === 0 ? 2 : 29, 0, 1, 32, x === 0 ? WALL_L : WALL_D);
      for (let y = 3; y < 32; y += 8) l.px(x + 1, y, WALL_D);
    }, "#2A3340");
  }
  // Wall to wall and back. Pip turns a quarter at a time, holding each pose
  // while it drifts, so it tumbles slowly and lands feet-first on each wall.
  const k = tri(f, 72);
  const cx = lerp(12, 20, eio(k)), cy = 18 + wave(f, 72, 2.5, 1);
  const q = t * 4, qi = Math.floor(q), fr = q - qi;
  const rot = Math.PI / 2 + (Math.PI / 2) * (qi + eio(clamp((fr - 0.7) / 0.3)));
  const dW = Math.min(f, 72 - f, Math.abs(f - 36));
  const push = dW < 5, pushT = push ? 1 - dW / 5 : 0;
  g.xform((gg) => drawPip(gg, {
    y: 28, w: 7, h: 6.2, sq: 0.16 * pushT, la: 40 + wave(f, 24, 20), eyes: push ? "determined" : fr > 0.7 ? "wide" : f % 18 > 15 ? "blink" : "happy", mouth: push ? "grit" : fr > 0.7 ? "o" : "smile",
    feet: (A) => [[A.cx - 3, A.bottom + 1.5 - pushT * 0.5, 1.8], [A.cx + 3, A.bottom + 1.5 - pushT * 0.5, 1.8]],
    hands: (A) => [{ x: A.handL[0] - 1.5, y: A.cy - 3 + wave(f, 12, 1) }, { x: A.handR[0] + 1.5, y: A.cy - 3 - wave(f, 12, 1) }]
  }), { cx: 16, cy: 22, rot, dx: cx - 16, dy: cy - 22 });
  if (pushT > 0.3) { const L = f < 18 || f > 54, wx = L ? 4 : 27, d = L ? 1 : -1; g.px(wx, cy - 4, WHITE).px(wx + d, cy - 5, WHITE).px(wx, cy + 4, WHITE).px(wx + d, cy + 5, WHITE); }
  // A dropped book drifts along on its own slow spin.
  const br = Math.floor(-t * 4) * (Math.PI / 2);
  g.xform((gg) => prop.closedBook(gg, 13, 26, 7, 5, "#C8453B"), { cx: 16.5, cy: 28.5, rot: br, dx: wave(f, 72, 5, 2), dy: wave(f, 36, 0.8) });
}, 18);

// ------------------------------------------------------------ t-rex ripple
const DINO = "#7A8A3E", DINO_D = "#55622A", DINO_L = "#A3B25E", DINO_B = "#C9CD8E";
const dinoHead = (g, x, y, open, eyeOpen = true) => {
  // Facing right: x is the tip of the snout, y the line of the mouth. The
  // neck runs off the left edge of the frame.
  x = Math.round(x); y = Math.round(y);
  const jaw = Math.round(open * 3);
  g.stamp((l) => {
    l.rect(x - 30, y - 5, 16, 20, DINO_D);
    // Lower jaw, with teeth pointing up.
    l.rect(x - 16, y + 1 + jaw, 14, 3, DINO_B).rect(x - 16, y + 3 + jaw, 14, 1, DINO_D).rect(x - 16, y + 1 + jaw, 2, 3, DINO);
    for (let i = x - 13; i < x - 2; i += 2) l.px(i, y + jaw, WHITE);
    if (jaw > 0) l.rect(x - 15, y + 1, 12, jaw, "#6B1E24");
    // Skull and snout.
    l.ell(x - 10, y - 4, 10, 5.4, (nx, ny) => (ny < -0.55 ? DINO_L : ny > 0.55 ? DINO_D : DINO));
    l.ell(x - 3, y - 2, 4, 3.2, (nx, ny) => (ny < -0.4 ? DINO_L : DINO));
    for (let i = x - 14; i < x - 1; i += 2) l.px(i, y + 1, WHITE);
    l.px(x - 2, y - 4, DINO_D).px(x - 3, y - 4, DINO_D);
    // A heavy brow over a yellow slit eye.
    l.rect(x - 15, y - 9, 6, 1, DINO_D).px(x - 9, y - 8, DINO_D);
    if (eyeOpen) l.rect(x - 14, y - 7, 4, 2, "#FFD23F").rect(x - 12, y - 7, 1, 2, INKX);
    else l.rect(x - 14, y - 6, 4, 1, INKX);
    for (let i = 0; i < 4; i++) l.px(x - 20 + i * 2, y - 6 + (i % 2), DINO_D);
  }, "#1E2410");
};
def("trexripple", "Ripple in the Cup", "Books", 72, "A nod to the dinosaur park: the water in a cup ripples, thud by thud, then a huge head peeks in.", (g, f) => {
  const s = tl(f, [6, 8, 8, 10, 12, 6, 8, 6, 8]);
  const thud = (s.k === 1 || s.k === 2) && s.n < 2;
  const jolt = thud ? 1 : 0;
  // The head slides in from the left, looks, snaps at the empty air, withdraws.
  let hx = -14, open = 0, blinkEye = false;
  if (s.k === 3) hx = lerp(-14, 17, eo(s.t));
  if (s.k === 4) { hx = 17 + (s.n > 7 ? 1 : 0); blinkEye = s.n === 5 || s.n === 6; }
  if (s.k === 5) hx = 17;
  if (s.k === 6) { hx = 19; open = s.n % 4 < 2 ? 1 : 0; }
  if (s.k === 7) hx = lerp(19, -14, ei(s.t));
  // The cup of water, and its rings.
  const ringP = (s.k === 1 || s.k === 2) && s.n < 7 ? (s.n + 1) / 7 : -1;
  const y0 = 20 + jolt;
  g.stamp((l) => {
    for (let y = y0; y < 30 + jolt; y++) { const inset = y > y0 + 6 ? 1 : 0; l.rect(4 + inset, y, 10 - inset * 2, 1, "#CDEBFF"); }
    l.rect(5, y0 + 3, 8, 6, "#8FCBF2").rect(5, y0 + 3, 1, 4, WHITE);
    l.ell(9, y0 + 1.5, 4.6, 2.4, (nx, ny) => (nx * nx + ny * ny > 0.62 ? "#E6F6FF" : "#2F8FE6"));
    for (const p of [ringP]) {
      if (p <= 0 || p > 1) continue;
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; l.px(9 + Math.cos(a) * (0.5 + p * 2.6), y0 + 1.5 + Math.sin(a) * (0.2 + p * 1.1), WHITE); }
    }
  }, "#1E4A6B");
  if (thud) { fx.puff(g, 2, 30, 1.2, "#E8E2D2"); fx.puff(g, 16, 30, 1.2, "#E8E2D2"); g.line(2, 26, 1, 24, WHITE).line(16, 26, 17, 24, WHITE); }
  if ((s.k === 1 || s.k === 2) && s.n > 0 && s.n < 5) { const h = hop(s.n / 5, 4); g.px(7, Math.round(y0 + h), SKY).px(11, Math.round(y0 + h * 0.7), SKY); }
  if (hx > -12) dinoHead(g, hx, 12, open, !blinkEye);
  // Pip: idle, startled by the thuds, frozen stiff, gone, then tiptoes back.
  let px = 24, o = { eyes: blink(f, 72, 3) ? "blink" : "happy", mouth: "smile", la: 28 };
  if (s.k === 1 || s.k === 2) o = { eyes: "wide", mouth: "o", look: [-1, 1], fdx: -1, la: 10 };
  if (s.k === 3) o = { eyes: "wide", brows: "up", mouth: "flat", look: [-1, 0], fdx: -1, la: 0 };
  if (s.k === 4) o = { eyes: "wide", brows: "sad", mouth: "wavy", look: [-1, 0], fdx: -1, la: 0, sq: 0.04, hands: (A) => [{ x: A.handL[0] + 1, y: A.cy + 1 }, { x: A.handR[0] - 1, y: A.cy + 1 }] };
  if (s.k === 5) { px = lerp(24, 46, ei(s.t)); const a = s.n % 2; o = { eyes: "squeeze", mouth: "shout", fdx: 1, look: [1, 0], lean: 2, la: -60, feet: (A) => [[A.cx - 3 + (a ? 2 : -2), A.bottom + 1 - a], [A.cx + 3 + (a ? -2 : 2), A.bottom + 1 - (1 - a)]] }; }
  if (s.k === 6 || s.k === 7) px = 50;
  if (s.k === 8) { px = lerp(38, 24, eo(s.t)); o = { eyes: "open", look: [-1, 0], fdx: -1, mouth: "tiny", la: 40, feet: (A) => [[A.cx - 3.5, A.bottom + 1.1 - (s.n % 4 < 2 ? 1 : 0), 1.8], [A.cx + 3.5, A.bottom + 1.1 - (s.n % 4 < 2 ? 0 : 1), 1.8]] }; }
  if (px < 42) { g.shadow(px, 6, 31); drawPip(g, Object.assign({ x: px, y: 28 + jolt }, o)); }
  if (s.k === 4) fx.drop(g, px + 8, 14 + s.n * 0.4, SKY);
  if (s.k === 5) for (let i = 0; i < 3; i++) fx.speed(g, px - 16 - i * 2, 17 + i * 4, 4);
  if (s.k === 5 && s.n < 3) fx.puff(g, 22, 29, 1.5);
  if (s.k === 4 && s.n > 7) for (let i = 0; i < 2; i++) fx.puff(g, hx + 1 + i * 2, 7 - i, 0.9, "#F2EFE8");
  if (s.k === 6 && s.n % 4 < 2) fx.impact(g, hx + 3, 13);
  if (s.k === 8 && s.t > 0.6) g.text("?", 27, 2, WHITE);
}, 40);

// ------------------------------------------------------------ shark fin
const SEA = "#2F8FE6", SEA_D = "#1F6BB8", SEA_L = "#7CC8FF";
const FIN = [1, 1, 2, 2, 3, 4, 5];
const sharkFin = (g, x, y, h, dir) => {
  // x, y: where the trailing edge meets the water. dir: travel direction.
  if (h < 1) return;
  x = Math.round(x); y = Math.round(y);
  const rows = FIN.slice(FIN.length - h);
  g.stamp((l) => rows.forEach((w, j) => {
    for (let i = 0; i < w; i++) {
      const edge = i === w - 1;
      l.px(x + dir * i, y - h + 1 + j, edge ? "#B7C4D1" : j > h - 3 ? "#5B6B7A" : "#72849A");
    }
  }), "#141C26");
  g.px(x - dir, y + 1, WHITE).px(x - dir * 2, y + 1, "#FFFFFFaa").px(x + dir * rows[rows.length - 1], y + 1, WHITE);
};
def("sharkfin", "Circling Fin", "Books", 60, "A nod to the summer beach scare: a fin circles Pip's little raft, and the feet come up.", (g, f) => {
  const s = tl(f, [14, 8, 26, 12]);
  // The fin circles once; its angle runs across the whole loop.
  const th = lerp(-0.5, TAU - 0.2, clamp((f - 8) / 46));
  const rise = clamp((f - 8) / 5) * clamp((56 - f) / 5);
  const front = Math.sin(th) > 0;
  const finX = 16 + Math.cos(th) * 12.5, finY = 25 + Math.sin(th) * 5;
  const dir = -Math.sin(th) >= 0 ? 1 : -1;
  const finH = Math.round((front ? 7 : 5) * rise);
  for (let y = 19; y < 32; y++) for (let x = 0; x < 32; x++) {
    const crest = 19 + Math.round(Math.sin((x + f * 0.5) * 0.5) * 0.6);
    if (y < crest) continue;
    g.px(x, y, y === crest || (y > 21 && (x + y * 3 + Math.floor(f / 3)) % 13 === 0) ? SEA_L : y < 24 ? SEA : SEA_D);
  }
  if (!front) sharkFin(g, finX, finY, finH, dir);
  // The raft.
  g.stamp((l) => { l.rect(7, 23, 18, 3, "#A0703E"); for (let x = 7; x < 25; x += 4) l.rect(x, 23, 1, 3, "#6B4A28"); l.rect(7, 23, 18, 1, "#C9955A"); }, "#3A2410");
  let o, feetUp = 0;
  const lookFin = [finX < 13 ? -1 : finX > 19 ? 1 : 0, front ? 1 : 0];
  if (s.k === 0) o = { eyes: "closed", mouth: "smile", la: 40 + wave(f, 14, 8) };
  if (s.k === 1) { feetUp = eo(s.t); o = { eyes: "wide", brows: "up", mouth: "o", la: 0, look: lookFin, fdx: lookFin[0] }; }
  if (s.k === 2) { feetUp = 1; o = { eyes: "wide", brows: "sad", mouth: "wavy", x: 16 + (s.n % 4 < 2 ? 0.4 : -0.4), look: lookFin, fdx: lookFin[0], la: 0, sq: 0.05 }; }
  if (s.k === 3) { feetUp = 1 - eo(clamp(s.t * 1.5 - 0.5)); o = { eyes: s.t > 0.3 ? "happy" : "open", mouth: s.t > 0.3 ? "smile" : "flat", la: lerp(0, 40, s.t) }; }
  const kick = s.k === 0 && f % 8 < 4;
  drawPip(g, Object.assign({
    x: 16, y: 23.5, w: 6.8, h: 6,
    feet: (A) => [[A.cx - 3, lerp(A.bottom + 4 - (kick ? 1 : 0), A.bottom - 0.5, feetUp), 1.9], [A.cx + 3, lerp(A.bottom + 4 - (kick ? 0 : 1), A.bottom - 0.5, feetUp), 1.9]],
    hands: (A) => (feetUp > 0.5 ? [{ x: A.cx - 5, y: A.bottom - 1.5 }, { x: A.cx + 5, y: A.bottom - 1.5 }] : [{ x: A.handL[0], y: A.handL[1] + 1 }, { x: A.handR[0], y: A.handR[1] + 1 }])
  }, o));
  // Water laps over the front edge (and over dangling feet).
  for (let x = 0; x < 32; x++) { const y = 28 + Math.round(Math.sin((x - f * 0.6) * 0.45) * 0.6); g.px(x, y, SEA_L); for (let yy = y + 1; yy < 32; yy++) g.px(x, yy, SEA_D); }
  if (s.k === 0 && kick) g.px(12, 27, WHITE).px(20, 26, WHITE);
  if (front) sharkFin(g, finX, finY, finH, dir);
  if (s.k === 2) fx.drop(g, 24, 9 + (s.n % 10) * 0.6, SKY);
  if (s.k === 1) g.text("!", 26, 2, GOLD);
}, 36);

// ------------------------------------------------------------ red balloon
def("redballoon", "Red Balloon", "Books", 60, "A nod to the clown in the storm drain: a lone red balloon floats up. Pip wants no part of it.", (g, f) => {
  const s = tl(f, [14, 10, 12, 4, 10, 10]);
  let bx = 24, by = 44, popped = false;
  if (s.k === 0) by = lerp(46, 12, eo(s.t));
  if (s.k === 1) by = 12 + wave(s.n, 10, 0.8);
  if (s.k === 2) { bx = lerp(24, 19, eio(s.t)); by = 12 + wave(s.n, 10, 0.8); }
  if (s.k >= 3) { bx = 19; by = 12; popped = true; }
  let px = 12, o;
  if (s.k === 0) o = { eyes: blink(s.n, 14, 4) ? "blink" : "open", mouth: "smile", la: 28, look: [s.t > 0.5 ? 1 : 0, 0], fdx: s.t > 0.5 ? 1 : 0 };
  if (s.k === 1) o = { eyes: "half", brows: "focus", mouth: "flat", look: [1, -1], fdx: 1, la: 10 };
  if (s.k === 2) { px = lerp(12, 8, eo(s.t)); const a = s.n % 4 < 2; o = { eyes: "half", brows: "sad", mouth: "wavy", look: [1, -1], fdx: 1, la: 20, feet: (A) => [[A.cx - 3.5, A.bottom + 1.1 - (a ? 1 : 0)], [A.cx + 3.5, A.bottom + 1.1 - (a ? 0 : 1)]], hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0] + 1, y: A.cy - 1 }] }; }
  if (s.k === 3) { px = 8; o = { y: 28 + hop(s.t, 5), eyes: "wide", brows: "up", mouth: "shout", sq: -0.15, la: -10, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 5 }, { x: A.handR[0] + 2, y: A.cy - 5 }] }; }
  if (s.k === 4) { px = 8; o = { y: 28 + (s.n < 4 ? hop(0.5 + s.n / 8, 5) : 0), eyes: s.n < 5 ? "wide" : "x", brows: "up", mouth: "o", la: 60 }; }
  if (s.k === 5) { px = lerp(8, 12, eio(s.t)); o = { eyes: "closed", mouth: "smile", la: 28, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.fc + 5 - s.t * 2, y: A.ey - 4 }] }; }
  g.shadow(px, 6);
  drawPip(g, Object.assign({ x: px }, o));
  if (!popped) {
    for (let i = 0; i < 12; i++) g.px(Math.round(bx + Math.sin((f + i) * 0.5) * 1.2 * (i / 12)), Math.round(by + 6 + i), "#F4F1E8");
    g.stamp((l) => {
      l.ell(bx + 0.5, by, 4.2, 5, (nx, ny) => (nx < -0.1 && ny < -0.1 && nx + ny > -1.0 ? "#FF7A7A" : nx + ny > 0.65 ? "#A61E2A" : RED));
      l.rect(Math.round(bx) - 1, Math.round(by) + 5, 3, 1, "#A61E2A").px(Math.round(bx), Math.round(by) + 6, "#A61E2A");
    }, "#3A0A0E");
    g.px(Math.round(bx) - 2, Math.round(by) - 3, WHITE).px(Math.round(bx) - 2, Math.round(by) - 2, WHITE).px(Math.round(bx) - 1, Math.round(by) - 3, WHITE);
  }
  if (s.k === 3) { fx.burst(g, bx, by, s.t * 0.9 + 0.1, RED); g.text("POP", 18, 1, WHITE); }
  if (s.k === 4) {
    fx.burst(g, bx, by, 0.5 + s.t * 0.5, RED);
    for (let i = 0; i < 3; i++) g.stamp((l) => l.px(bx - 3 + i * 3, by + s.n * 1.2 + (i % 2) * 2, RED), "#3A0A0E");
  }
  if (s.k === 1 && s.n > 4) g.text("?", 4, 3, WHITE);
  if (s.k === 5 && s.t > 0.3) fx.drop(g, 4 + s.t * 0, 12 + s.t * 6, SKY);
}, 22);

// ------------------------------------------------------------ hedge maze
const HEDGE = "#2F6A2C", HEDGE_L = "#4F9142", HEDGE_D = "#1C4A20", HEDGE_T = "#3E7D36", PATH = "#D9C79A", PATH_D = "#BFA877";
// Rows of the maze seen from above, beyond the wall: "#" hedge, "." path.
const MAZE_TOP = [
  "################################",
  "#.....#.......#.........#......#",
  "#.###.#.#####.#.#######.#.####.#",
  "#.#...#.#.....#.#.......#....#.#",
  "#.#.###.#.#####.#.#####.####.#.#",
  "#.#.....#.......#.....#......#.#",
  "#.#######.###########.########.#",
  "#............#.........#.......#",
  "###..........###################"
];
const hedgeBack = (g) => {
  g.stamp((l) => {
    MAZE_TOP.forEach((row, y) => [...row].forEach((c, x) => l.px(x, y, c === "#" ? ((x * 5 + y * 3) % 7 ? HEDGE_T : HEDGE_L) : PATH_D)));
    // The wall's front face, with the gap Pip escapes through.
    for (let y = 9; y < 20; y++) for (let x = 0; x < 32; x++) {
      if (x >= 3 && x <= 12) { l.px(x, y, y < 12 ? PATH_D : PATH); continue; }
      l.px(x, y, (x * 3 + y * 5) % 7 === 0 ? HEDGE_L : y > 17 ? HEDGE_D : HEDGE);
    }
  }, "#0E2A12");
};
const hedgeFront = (g) => g.stamp((l) => {
  // The dead end: a hedge block on the right, its top seen from above.
  l.rect(25, 9, 7, 3, HEDGE_T).rect(25, 12, 7, 20, HEDGE);
  for (let y = 12; y < 32; y++) for (let x = 25; x < 32; x++) if ((x * 3 + y * 5) % 7 === 0) l.px(x, y, HEDGE_L);
  l.rect(25, 30, 7, 2, HEDGE_D);
}, "#0E2A12");
def("hedgemaze", "Lost in the Hedges", "Books", 72, "A nod to the hedge-maze chase and the boys in the glade: Pip hits a dead end, scratches its head, finds the way out.", (g, f) => {
  const s = tl(f, [16, 6, 16, 8, 12, 10, 4]);
  g.rect(0, 20, 32, 12, PATH);
  for (let i = 0; i < 10; i++) g.px(Math.round(rnd(i) * 31), Math.round(21 + rnd(i + 20) * 10), PATH_D);
  hedgeBack(g);
  const a = f % 6 < 3;
  const walkFeet = (A) => [[A.cx - 3 + (a ? 1.4 : -1.4), A.bottom + 1.1 - (a ? 0.8 : 0)], [A.cx + 3 + (a ? -1.4 : 1.4), A.bottom + 1.1 - (a ? 0 : 0.8)]];
  let x = 18, y = 28, w = 7, h = 6.2, o = {};
  if (s.k === 0) { x = lerp(-9, 17, s.t); o = { fdx: 1, look: [1, 0], eyes: "happy", mouth: "smile", la: -10 + wave(f, 6, 8), feet: walkFeet }; }
  if (s.k === 1) { x = 17 - Math.sin(Math.PI * s.t) * 2; o = { sq: 0.14 * (1 - s.t), eyes: s.t < 0.5 ? "x" : "squeeze", mouth: "o", la: 70, lean: -1 }; }
  if (s.k === 2) {
    x = 17;
    const scr = s.n % 4 < 2 ? -1 : 1;
    o = { eyes: "open", look: [0, -1], brows: "sad", mouth: "flat", la: 40 + scr * 8, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.top.x + 3 + scr, y: A.top.y + 1 }] };
  }
  if (s.k === 3) { x = 17; o = { eyes: "wide", look: [-1, -1], fdx: -1, mouth: "open", brows: "up", la: -20 }; }
  if (s.k === 4) { x = lerp(17, 8, s.t); o = { fdx: -1, look: [-1, 0], eyes: "determined", mouth: "smile", la: 30 + wave(f, 6, 8), feet: walkFeet }; }
  if (s.k === 5) {
    // Into the gap: up the path and smaller with distance, round the corner.
    const t = eo(clamp(s.t / 0.8)); x = 8; y = lerp(28, 15, t); w = lerp(7, 3.8, t); h = lerp(6.2, 3.4, t);
    o = { eyes: "happy", mouth: "open", la: 0, ll: lerp(1, 0.6, t), blush: t < 0.5, feet: walkFeet };
  }
  const on = s.k !== 6 && !(s.k === 5 && s.t > 0.85);
  if (on) {
    if (s.k !== 5) g.shadow(x, 6, 31);
    drawPip(g, Object.assign({ x, y, w, h }, o));
  }
  // Deeper in than the wall's face, Pip is framed by the sides of the gap.
  if (s.k === 5 && y < 26) g.stamp((l) => { for (let yy = 9; yy < 20; yy++) for (const xx of [0, 1, 2, 13, 14, 15, 16]) l.px(xx, yy, (xx * 3 + yy * 5) % 7 === 0 ? HEDGE_L : yy > 17 ? HEDGE_D : HEDGE); }, "#0E2A12");
  hedgeFront(g);
  if (s.k === 1) { fx.impact(g, 24, 20); fx.star(g, 22, 12, 1); }
  if (s.k === 2 && s.n > 3) g.text("?", 20, 1 + (s.n % 8 < 4 ? 0 : 1), WHITE);
  if (s.k === 3) g.text("!", 20, 1, GOLD);
  if (s.k >= 5 && (s.k === 6 || s.t > 0.6)) fx.twinkle(g, 8, 4, s.k === 6 ? 0.5 + s.t * 0.5 : (s.t - 0.6) * 1.2, WHITE);
}, 36);

// ------------------------------------------------------------ tiger in the boat
const TIGER = "#F08A24", TIGER_L = "#FFB45C", TIGER_D = "#B85E12", STRIPE = "#2A1A10", MUZZLE = "#FFF6DF";
const tiger = (g, y, o = {}) => {
  // Dozing in the stern, chin on its paws on the gunwale, facing Pip.
  y = Math.round(y);
  const hx = 24, hy = y + 16;
  g.stamp((l) => {
    // Back and haunch behind the head, a tail flicking over them.
    l.ell(29.5, y + 16, 4.5, 5, (nx, ny) => (ny < -0.5 ? TIGER_L : TIGER));
    for (const x of [28, 30]) l.line(x, y + 11, x + 1, y + 14, STRIPE);
    const tf = o.tail || 0;
    l.line(31, y + 13, 31, y + 8 - tf, TIGER).px(31, y + 7 - tf, STRIPE).px(31, y + 8 - tf, STRIPE);
    // Ears.
    l.rect(hx - 4, hy - 5, 2, 2, TIGER).px(hx - 4, hy - 5, STRIPE).px(hx - 3, hy - 4, "#FFB3C1");
    l.rect(hx + 2, hy - 5, 2, 2, TIGER).px(hx + 3, hy - 5, STRIPE).px(hx + 2, hy - 4, "#FFB3C1");
    // Head.
    l.ell(hx, hy, 4.8, 3.8, (nx, ny) => (ny < -0.55 ? TIGER_L : TIGER));
    l.ell(hx, hy + 2, 3.2, 1.8, MUZZLE);
    l.px(hx - 1, hy - 3, STRIPE).px(hx, hy - 3, STRIPE).px(hx + 1, hy - 3, STRIPE).px(hx, hy - 2, STRIPE);
    l.px(hx - 4, hy, STRIPE).px(hx - 4, hy + 1, STRIPE).px(hx + 4, hy, STRIPE).px(hx + 4, hy + 1, STRIPE);
    l.rect(hx - 1, hy + 1, 2, 1, "#FF7A8A");
    // Eyes: shut, or one lazily open.
    if (o.eye) l.rect(hx - 3, hy - 1, 2, 1, "#FFE36B").px(hx - 3, hy - 1, STRIPE);
    else l.rect(hx - 3, hy - 1, 2, 1, STRIPE);
    l.rect(hx + 1, hy - 1, 2, 1, STRIPE);
    if (o.yawn) l.rect(hx - 1, hy + 2, 2, 2, "#8A1E2A").px(hx - 1, hy + 2, WHITE).px(hx, hy + 2, WHITE);
    // Paws over the side.
    l.ell(hx - 3, hy + 5, 1.8, 1.2, TIGER_L).ell(hx + 2, hy + 5, 1.8, 1.2, TIGER_L);
  }, "#2A1406");
};
def("tigerboat", "Shipmate", "Books", 60, "A nod to the boy adrift with a tiger: Pip scoots, very carefully, to the far end of the lifeboat.", (g, f) => {
  const s = tl(f, [10, 22, 10, 8, 10]);
  const bob = Math.round(wave(f, 24, 0.7));
  for (let y = 23; y < 32; y++) for (let x = 0; x < 32; x++) { const c = 23 + Math.round(Math.sin((x + f * 0.4) * 0.5) * 0.6); if (y >= c) g.px(x, y, y === c || (y > 25 && (x * 3 + y * 7 + Math.floor(f / 3)) % 17 === 0) ? SEA_L : y < 25 ? SEA : SEA_D); }
  // Scooting in three careful shuffles.
  let px = 11, o;
  if (s.k === 0) o = { eyes: "open", look: [1, 0], fdx: 1, mouth: "wavy", la: 10 };
  if (s.k === 1) {
    const step = Math.min(2, Math.floor(s.t * 3)), st = (s.t * 3) % 1;
    px = 11 - step * 1.4 - 1.4 * eio(clamp(st * 1.6));
    o = { eyes: "open", look: [1, 0], fdx: 1, mouth: "flat", la: 10, sq: st < 0.6 ? 0.06 : 0 };
  }
  if (s.k >= 2) px = 7;
  if (s.k === 2) o = { eyes: "wide", brows: "up", look: [1, 0], fdx: 1, mouth: "flat", la: 0, sq: 0.04 };
  if (s.k === 3) o = { eyes: "wide", brows: "up", look: [1, 0], fdx: 1, mouth: "tiny", la: 0 };
  if (s.k === 4) o = { eyes: "closed", mouth: "smile", la: 30, hands: (A) => [{ x: A.handL[0] + 1, y: A.handL[1] - 1 }, { x: A.fc + 4 - s.t * 3, y: A.ey - 4 }] };
  drawPip(g, Object.assign({ x: px, y: 24 + bob, feet: false, hands: (A) => [{ x: A.handL[0] + 1, y: A.handL[1] - 1 }, { x: A.handR[0] - 1, y: A.handR[1] - 1 }] }, o));
  tiger(g, bob, { eye: s.k === 2 || (s.k === 3 && s.n < 4), yawn: s.k === 3 && s.n >= 3, tail: s.k === 2 ? 1 : f % 16 < 8 ? 0 : 1 });
  // The lifeboat hull, in front of both of them.
  g.stamp((l) => {
    const y = 21 + bob;
    const rows = [["#FFB45C", 0], ["#FF7A1A", 0], [WHITE, 1], ["#FF7A1A", 1], ["#FF7A1A", 2], ["#C0501E", 3]];
    rows.forEach(([c, inset], j) => l.rect(inset, y + j, 32 - inset * 2, 1, c));
  }, "#3A1A08");
  if (s.k === 0 || s.k === 1) for (let k = 0; k < 2; k++) { const t = ((f + k * 12) % 24) / 24; fx.z(g, 25 + t * 3, 6 - t * 6, false); }
  if (s.k === 1) fx.drop(g, px + 7, 7 + (s.n % 8) * 0.5, SKY);
  if (s.k === 2) g.text("!", 1, 2, GOLD);
  if (s.k === 4) for (let i = 0; i < 2; i++) g.px(Math.round(px + 7 + i + s.t * 4), Math.round(9 + s.t * 3 + i), SKY);
}, 40);

// ------------------------------------------------------------ kite
const STRING = "#8C8274", WIND = "#9FD8FF";
// A diamond kite, top at (x, y). Tilt leans it by sliding rows sideways,
// which keeps the pixels crisp where a rotation would chew them up.
const kiteShape = (g, x, y, tilt) => {
  const rows = [1, 3, 5, 7, 9, 7, 6, 5, 4, 3, 2, 1];
  const mid = 4;
  g.stamp((l) => {
    rows.forEach((w, j) => {
      const off = Math.round((j - mid) * tilt);
      for (let i = 0; i < w; i++) {
        const dx = i - Math.floor(w / 2);
        const col = (dx < 0) !== (j < mid) ? GOLD : RED;
        l.px(x + dx + off, y + j, dx === 0 || j === mid ? "#6B3A1E" : col);
      }
    });
  }, "#4A0E14");
  return [x + Math.round((rows.length - 1 - mid) * tilt), y + rows.length - 1];
};
def("kite", "Kite Flyer", "Books", 48, "A nod to the kite fighters of Kabul: Pip keeps a kite high, running when the wind drops.", (g, f) => {
  const s = tl(f, [14, 8, 18, 8]);
  let kx = 24 + wave(f, 16, 1.2), ky = 2 + wave(f, 12, 0.8), tilt = wave(f, 16, 0.15), px = 8, sag = 1, run = false;
  if (s.k === 1) { ky = lerp(2, 10, eo(s.t)); kx = lerp(24, 26, s.t); tilt = 0.5 * s.t; sag = lerp(1, 6, s.t); }
  if (s.k === 2) { ky = lerp(10, 1, eio(s.t)); kx = lerp(26, 24, s.t); tilt = lerp(0.5, -0.15, s.t); sag = lerp(6, 0, eo(clamp(s.t * 2))); run = true; px = 8 - Math.sin(Math.PI * s.t) * 2; }
  if (s.k === 3) { ky = lerp(1, 2, s.t); sag = lerp(0, 1, s.t); }
  // Wind streaks, and the ground rushing by while Pip runs.
  for (let i = 0; i < 3; i++) fx.speed(g, ((f * 2 + i * 13) % 44) - 10, 5 + i * 7, 3, WIND);
  if (run) for (let i = 0; i < 4; i++) { const x = ((f * 3 + i * 9) % 36) - 4; g.rect(x, 31, 3, 1, "#8A8F99"); }
  let o;
  if (s.k === 0) o = { eyes: "happy", mouth: "smile", look: [1, -1], fdx: 1, la: -30 + wave(f, 8, 8) };
  if (s.k === 1) o = { eyes: "wide", brows: "up", mouth: "o", look: [1, -1], fdx: 1, la: 0 };
  if (s.k === 2) { const a = f % 4 < 2; o = { y: 28 - (a ? 1 : 0), eyes: "determined", brows: "focus", mouth: "grit", look: [1, -1], fdx: 1, lean: -1.5, la: 40, feet: (A) => [[A.cx - 3 + (a ? 2 : -2), A.bottom + 1 - (a ? 1 : 0)], [A.cx + 3 + (a ? -2 : 2), A.bottom + 1 - (a ? 0 : 1)]] }; }
  if (s.k === 3) o = { eyes: "happy", mouth: "open", blush: "big", look: [1, -1], fdx: 1, la: -30 };
  let hand = [0, 0];
  const tug = s.k === 2 && f % 6 < 3 ? 1 : 0;
  g.shadow(px, 6);
  drawPip(g, Object.assign({ x: px, hands: (A) => { hand = [A.cx + 8, A.cy - 5 + tug]; return [{ x: A.handL[0], y: A.handL[1] }, { x: hand[0], y: hand[1] }]; } }, o));
  // The string, sagging when the wind drops.
  const kb = [Math.round(kx) + Math.round(7 * tilt), Math.round(ky) + 11];
  for (let i = 0; i <= 30; i++) { const t = i / 30; g.px(lerp(hand[0] + 1, kb[0], t), lerp(hand[1] - 1, kb[1], t) + Math.sin(Math.PI * t) * sag, STRING); }
  // The tail streams off downwind, bows fluttering.
  for (let i = 1; i <= 9; i++) {
    const tx = kb[0] + i * 0.6, ty = kb[1] + i * 1.1 + Math.sin(f * 0.8 + i * 0.9) * 0.9;
    g.px(tx, ty, STRING);
    if (i % 3 === 0) g.stamp((l) => l.px(tx - 1, ty, i === 6 ? "#1FBF6A" : "#3AA0FF").px(tx + 1, ty, i === 6 ? "#1FBF6A" : "#3AA0FF"), "#15281B");
  }
  kiteShape(g, Math.round(kx), Math.round(ky), tilt);
  if (s.k === 1) g.text("!", 1, 2, GOLD);
  if (run && f % 4 < 2) fx.puff(g, px + 7, 29, 1.2);
}, 6);

// ------------------------------------------------------------ skull
const BONE = "#F4F1E8", BONE_L = "#FFFFFF", BONE_D = "#C9C1AE", SOCKET = "#2A2A33";
const skullAt = (g, x, y, look = 0) => {
  // x, y: the middle of the jaw's underside, where the palm holds it.
  x = Math.round(x); y = Math.round(y);
  g.stamp((l) => {
    l.ell(x + 0.5, y - 6, 3.8, 3.4, (nx, ny) => (nx + ny < -0.7 ? BONE_L : nx + ny > 0.7 ? BONE_D : BONE));
    l.rect(x - 2, y - 3, 5, 3, BONE).rect(x - 2, y - 1, 5, 1, BONE_D);
    l.px(x - 1, y - 2, SOCKET).px(x + 1, y - 2, SOCKET);
    l.rect(x - 2 + look, y - 6, 2, 2, SOCKET).rect(x + 1 + look, y - 6, 2, 2, SOCKET).px(x + look, y - 4, SOCKET);
  }, "#2A2A33");
};
def("skull", "To Read or Not", "Books", 60, "A nod to the brooding prince: Pip holds a skull at arm's length and ponders, very dramatically.", (g, f) => {
  const s = tl(f, [8, 18, 12, 14, 8]);
  const up = s.k === 0 ? lerp(0.35, 1, eo(s.t)) : s.k === 4 ? lerp(1, 0.35, eio(s.t)) : 1;
  let o, other = null;
  if (s.k === 0) o = { eyes: "open", mouth: "smile", la: 28 };
  if (s.k === 1) { o = { eyes: "half", brows: "focus", look: [1, -1], fdx: 1, mouth: "flat", la: 28 + wave(s.n, 18, 8) }; other = (A) => ({ x: A.fc + 2, y: A.ey + 6.5 }); }
  if (s.k === 2) { o = { eyes: "open", brows: "sad", look: [1, -1], fdx: 1, mouth: "wavy", la: 50 }; other = (A) => ({ x: A.fc + 2, y: A.ey + 6.5 }); }
  if (s.k === 3) { o = { eyes: "closed", brows: "sad", mouth: "o", lean: -1.5, la: 80 }; other = (A) => ({ x: A.fc - 4, y: A.ey - 4 }); }
  if (s.k === 4) o = { eyes: "happy", mouth: "smile", la: 28 };
  let hx = 0, hy = 0;
  g.shadow(11, 6);
  const A = drawPip(g, Object.assign({
    x: 11,
    hands: (A) => {
      hx = lerp(A.handR[0], 25, up); hy = lerp(A.handR[1], 19, up);
      return [other ? other(A) : { x: A.handL[0], y: A.handL[1] }];
    }
  }, o));
  skullAt(g, hx, hy - 1, s.k === 1 && s.n > 9 ? -1 : 0);
  drawHand(g, { x: hx, y: hy });
  if (s.k === 2) fx.drop(g, A.cx - 8, A.top.y + 3 + s.t * 6, SKY);
  if (s.k === 1 && s.n > 4) for (let i = 0; i < 3; i++) if (s.n > 4 + i * 4) g.stamp((l) => l.px(3 + i * 3, 4 - i, WHITE), "#1A1A22");
  if (s.k === 3 && s.n > 4) fx.twinkle(g, 4, 5, (s.n - 4) / 10, WHITE);
}, 20);
