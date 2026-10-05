/* Book scenes, part of ./index.js. */
import { drawPip, drawHand } from "../engine.js";
import { def, fx, prop, kit } from "../anims.js";

const { TAU, wave, tri, lerp, clamp, eo, ei, eio, back, hop, rnd, tl, blink, GOLD, RED, WHITE, PINK, BLUE, SKY, INKX } = kit;

// Nods to love stories, rom-coms and the courts of fae fantasy. Each scene is
// its own little story with a beginning, a middle and an end, and stays inside
// the 32px frame. None of them is any one book's plot.

const R = Math.round;

// ------------------------------------------------------------ the other one
// Rom-coms take two. The second is a pip in rose with a flower for a leaf,
// drawn small beside a small Pip so both fit the frame.
const ROSE = {
  base: "#F4A3BC", shade: "#C96A8E", light: "#FFCFDF", hi: "#FFF3F7", belly: "#FFDCE8", foot: "#9C4468",
  outline: "#3A1626", ink: "#2A1020", stem: "#8A4A66", petal: "#FFE27A", petalCore: "#FF9A3D", cheek: "#FF5F87", eyes: null
};
const SMALL = { w: 6, h: 5.5 };
const friend = (g, o) => drawPip(g, Object.assign({ colors: ROSE, leaf: "flower", acc: false }, SMALL, o));

// ------------------------------------------------------------ love letter
const PAPER = "#FFF6DF", PAPER_D = "#E6DCC0", SEAL = "#FF4D6D";
const envelope = (g, x, y, o = {}) => {
  x = R(x); y = R(y);
  g.stamp((l) => {
    l.rect(x, y, 9, 6, WHITE).rect(x, y + 5, 9, 1, PAPER_D);
    l.line(x, y, x + 4, y + 3, "#C9C2B0").line(x + 8, y, x + 4, y + 3, "#C9C2B0");
    if (o.sealed) l.px(x + 3, y + 2, SEAL).px(x + 5, y + 2, SEAL).rect(x + 3, y + 3, 3, 1, SEAL).px(x + 4, y + 4, SEAL).px(x + 3, y + 2, "#FF9FB3");
  }, "#3A2A1E");
  if (o.wings != null) {
    // Two small wings that beat: up, level, down.
    const up = o.wings % 4 < 2;
    g.stamp((l) => {
      for (const side of [-1, 1]) {
        const wx = side < 0 ? x - 1 : x + 9;
        l.px(wx, y + 2, WHITE).px(wx + side, y + (up ? 1 : 3), WHITE).px(wx + side * 2, y + (up ? 0 : 4), WHITE).px(wx + side, y + 2, "#DCE6F2");
      }
    }, "#3A4A66");
  }
};
const quill = (g, h) => g.stamp((l) => {
  l.line(h.x, h.y - 1, h.x + 3, h.y - 6, WHITE).px(h.x + 4, h.y - 7, "#DCE6F2").px(h.x + 2, h.y - 5, "#DCE6F2").px(h.x + 4, h.y - 5, WHITE);
  l.px(h.x - 1, h.y + 1, INKX);
}, "#3A4A66");

def("loveletter", "Love Letter", "Books", 60, "Book nod: love stories. Pip writes a letter, seals it with a heart, and watches it fly off on little wings.", (g, f) => {
  const s = tl(f, [18, 8, 8, 16, 10]);
  const sheet = [17, 20];
  let o, flying = null;
  if (s.k === 0) {
    // Writing: the quill works along the page and the lines fill in behind it.
    const row = Math.min(2, Math.floor(s.t * 3)), along = (s.t * 3) % 1;
    const hx = sheet[0] + 1 + along * 7, hy = sheet[1] + 1 + row * 2;
    o = {
      eyes: blink(s.n, 12, 9) ? "blink" : "determined", look: [1, 1], fdx: 1, mouth: "blep", la: 40 + wave(f, 10, 4), lean: 1,
      hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: hx, y: hy + 1, item: quill }],
      behind: null
    };
    o.page = { row, along };
  }
  if (s.k === 1) o = { eyes: "happy", mouth: "smile", blush: "big", la: 20, hands: (A) => [{ x: A.cx - 1, y: A.cy + 4 }, { x: A.cx + 9, y: A.cy + 4 }] };
  if (s.k === 2) o = { eyes: "closed", mouth: "o", blush: "big", la: 30, fdx: 1, hands: (A) => [{ x: A.cx + 1, y: A.cy + 3 }, { x: A.cx + 8, y: A.cy + 3 }] };
  if (s.k === 3) {
    const t = eio(s.t);
    flying = [lerp(15, 25, t) + Math.sin(s.t * TAU * 1.5) * 3, lerp(13, -9, t)];
    o = { eyes: "open", look: [1, -1], fdx: 1, fdy: -1, mouth: "smile", blush: "big", la: 10, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.handR[0] + 1, y: A.cy - 5 + (s.n % 6 < 3 ? 0 : 1) }] };
  }
  if (s.k === 4) o = { eyes: s.n % 8 < 4 ? "heart" : "heartBig", mouth: "smile", blush: "big", la: 20 + wave(s.n, 10, 10), hands: (A) => [{ x: A.cx - 3, y: A.cy + 4 }, { x: A.cx + 3, y: A.cy + 4 }] };
  g.shadow(s.k === 0 ? 11 : 13, 6);
  const A = drawPip(g, Object.assign({ x: s.k === 0 ? 11 : 13 }, o));
  if (s.k === 0) {
    // The page, drawn after Pip so the writing hand sits on top of it.
    g.stamp((l) => {
      l.rect(sheet[0], sheet[1], 10, 8, PAPER).rect(sheet[0], sheet[1] + 7, 10, 1, PAPER_D);
      for (let r = 0; r <= o.page.row; r++) {
        const len = r < o.page.row ? 8 : R(o.page.along * 8);
        for (let i = 0; i < len; i++) if ((i + r) % 4 !== 3) l.px(sheet[0] + 1 + i, sheet[1] + 1 + r * 2, "#8A7A5A");
      }
    }, "#3A2A1E");
    drawHand(g, { x: sheet[0] + 1 + o.page.along * 7, y: sheet[1] + 2 + o.page.row * 2, item: quill });
  }
  if (s.k === 1) envelope(g, A.cx, A.cy - 1, { sealed: false });
  if (s.k === 2) {
    envelope(g, A.cx + 1, A.cy - 2, { sealed: s.t > 0.5 });
    if (s.t > 0.5) fx.heart(g, A.cx + 10, A.cy - 6 - (s.t - 0.5) * 6, false);
  }
  if (s.k === 1 || s.k === 2) { drawHand(g, { x: A.cx + (s.k === 1 ? -1 : 1), y: A.cy + (s.k === 1 ? 4 : 3) }); drawHand(g, { x: A.cx + (s.k === 1 ? 9 : 8), y: A.cy + (s.k === 1 ? 4 : 3) }); }
  if (flying) envelope(g, flying[0], flying[1], { sealed: true, wings: s.n });
  if (s.k === 4) for (let k = 0; k < 2; k++) { const t = ((s.n + k * 5) % 10) / 10; fx.heart(g, (k ? 26 : 3) + Math.sin(t * 6) * 0.8, 13 - t * 9, false); }
}, 30);

// ------------------------------------------------------------ restless heart
const bigHeart = (g, x, y, beat) => {
  const rows = beat
    ? [".##...##.", "####.####", "#########", "#########", ".#######.", "..#####..", "...###...", "....#...."]
    : [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];
  const ox = beat ? 4 : 3;
  g.stamp((l) => {
    rows.forEach((r, j) => [...r].forEach((ch, i) => ch === "#" && l.px(R(x) + i - ox, R(y) + j - 3, PINK)));
    l.px(R(x) - ox + 1, R(y) - 2, "#FFB3C1").px(R(x) - ox + 2, R(y) - 2, "#FFB3C1");
  }, "#4A0E1C");
};
/** Where the runaway heart is, t = 0..1 through its three bounces. */
const heartPath = (t) => [16 + Math.sin(t * TAU * 1.5) * 11, 21 - Math.abs(Math.sin(t * Math.PI * 3)) * 15];

def("heartbeat", "Restless Heart", "Books", 60, "Book nod: love stories. Pip's heart thumps right out of its chest and bounces round the room; Pip chases it down and tucks it back in.", (g, f) => {
  const s = tl(f, [10, 6, 24, 6, 14]);
  let o, heart = null, beat = f % 6 < 2;
  if (s.k === 0) {
    // Reading, and something on the page lands.
    const hit = s.n > 5;
    o = { eyes: hit ? "wide" : "open", look: [0, 1], mouth: hit ? "o" : "smile", blush: hit ? "big" : true, la: 28, hold: (g, A) => prop.openBook(g, A.cx, A.cy + 2, { w: 10 }), hands: (A) => [{ x: A.cx - 5.5, y: A.cy + 5 }, { x: A.cx + 5.5, y: A.cy + 5 }] };
    if (hit && s.n % 2) o.x = 16.5;
  }
  if (s.k === 1) {
    heart = [16 + s.t * 2, lerp(20, 8, eo(s.t))];
    o = { eyes: "wide", brows: "up", mouth: "o", blush: "big", la: 0, sq: -0.08, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 2 }, { x: A.handR[0] + 1, y: A.cy - 2 }] };
  }
  if (s.k === 2) {
    heart = heartPath(s.t);
    // Pip grabs for it a beat late, every time.
    const [hx] = heartPath(Math.max(0, s.t - 0.09));
    const side = hx < 16 ? -1 : 1;
    o = {
      x: 16 + side * 1.5, lean: side * 1.5, eyes: "wide", look: [side, -1], fdx: side, mouth: s.n % 8 < 4 ? "open" : "o", blush: "big", la: 28 - side * 30,
      hands: (A) => (side < 0 ? [{ x: A.cx - 10, y: A.cy - 6 }, { x: A.handR[0], y: A.handR[1] }] : [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + 10, y: A.cy - 6 }])
    };
  }
  if (s.k === 3) {
    heart = [lerp(heartPath(1)[0], 16, eo(s.t)), lerp(heartPath(1)[1], 19, eo(s.t))];
    o = { eyes: "squeeze", mouth: "grit", blush: "big", la: 10, sq: 0.08 * s.t, hands: (A) => [{ x: lerp(A.handL[0], A.cx - 3, s.t), y: A.cy + 1 }, { x: lerp(A.handR[0], A.cx + 3, s.t), y: A.cy + 1 }] };
  }
  if (s.k === 4) {
    // Both hands pressed over it. It still thumps.
    const thump = s.n % 6 < 2 ? 0.5 : 0;
    o = { eyes: s.n < 6 ? "closed" : "happy", mouth: s.n < 6 ? "wavy" : "smile", blush: "big", la: 30 + wave(s.n, 6, 6), sq: -0.03 * thump * 2, hands: (A) => [{ x: A.cx - 2.5, y: A.cy + 2 - thump }, { x: A.cx + 2.5, y: A.cy + 2 - thump }] };
  }
  g.shadow(o.x ?? 16, 6);
  const A = drawPip(g, o);
  if (heart) bigHeart(g, heart[0], heart[1], beat);
  if (s.k === 2) for (let i = 1; i <= 2; i++) { const p = heartPath(Math.max(0, s.t - i * 0.03)); g.px(p[0], p[1] + 1, "#FF9FB3"); }
  if (s.k === 1 && s.n < 3) fx.impact(g, 16, 20);
  if (s.k === 4 && s.n % 6 < 2) { g.px(A.cx - 6, A.cy - 1, PINK).px(A.cx + 6, A.cy - 1, PINK); }
  if (s.k === 4 && s.n > 5) fx.heart(g, 25, 12 - (s.n - 6) * 0.7, false);
}, 22);

// ------------------------------------------------------------ room for two
const BROLLY = "#E0393E", BROLLY_L = "#FF7A7A", BROLLY_D = "#A61E2A";
const brolly = (g, cx, top, hand) => {
  // A domed canopy with a scalloped hem, and a crook handle down to the hand.
  g.stamp((l) => l.line(cx, top + 5, cx, hand[1] - 1, "#6B4A2E").line(cx, hand[1] - 1, hand[0], hand[1], "#6B4A2E"), "#2E1D10");
  g.stamp((l) => {
    for (let y = 0; y < 6; y++) {
      const hw = R(10 * Math.sqrt(1 - ((5 - y) / 6) ** 2));
      for (let x = -hw; x <= hw; x++) {
        const panel = Math.floor((x + 10) / 5) % 2;
        if (y === 5 && (x + 10) % 5 === 2) continue;
        l.px(cx + x, top + y, y === 0 ? BROLLY_L : panel ? BROLLY : BROLLY_D);
      }
    }
    l.px(cx, top - 1, "#6B4A2E");
  }, "#3A0E12");
};
const rainfall = (g, f, dry) => {
  for (let i = 0; i < 12; i++) {
    const x = R(rnd(i) * 31), y = ((f * 2 + i * 9) % 36) - 3;
    if (dry && dry(x, y)) continue;
    g.px(x, y, BLUE).px(x, y + 1, SKY);
  }
};

def("umbrella", "Room for Two", "Books", 72, "Book nod: rom-coms. It rains; Pip scoots over and holds the umbrella over a friend, and neither of them minds the weather after that.", (g, f) => {
  const s = tl(f, [16, 8, 12, 24, 12]);
  // Pip's umbrella starts over Pip alone, then covers both.
  const share = s.k < 2 ? 0 : s.k === 2 ? eo(s.t) : 1;
  const ux = R(lerp(8, 16, share)), utop = 4;
  const px = lerp(8, 10, share), qx = 23;
  const dry = (x, y) => y > utop && Math.abs(x - ux) <= 10;
  if (s.k < 4 || s.n % 3 === 0) rainfall(g, f, dry);
  const wet = share < 0.7;
  let p, q;
  p = { eyes: blink(f, 20) ? "blink" : "happy", mouth: "smile", la: 70 };
  q = { eyes: "sad", brows: "sad", mouth: "frown", look: [0, 1], blush: false };
  if (s.k === 1) p = { eyes: "wide", look: [1, 0], fdx: 1, mouth: "o", la: 70 };
  if (s.k === 2) { p = { eyes: "open", look: [1, 0], fdx: 1, mouth: "smile", la: 70, lean: 1 }; q = { eyes: s.t > 0.5 ? "wide" : "sad", look: [s.t > 0.5 ? -1 : 0, s.t > 0.5 ? -1 : 1], mouth: s.t > 0.5 ? "o" : "frown", blush: s.t > 0.5 }; }
  if (s.k === 3) {
    const shy = s.n < 10;
    p = { eyes: shy ? "open" : "happy", look: shy ? [-1, 0] : [1, 0], fdx: shy ? 0 : 1, mouth: "smile", blush: "big", la: 70 };
    q = { eyes: shy ? "open" : "happy", look: shy ? [1, 0] : [-1, 0], fdx: shy ? 0 : -1, mouth: shy ? "tiny" : "smile", blush: "big", x: lerp(qx, qx - 2, eo(clamp((s.n - 10) / 6))) };
  }
  if (s.k === 4) { p = { eyes: "closed", mouth: "smile", blush: "big", la: 70, lean: 1 }; q = { eyes: "closed", mouth: "smile", blush: "big", x: qx - 2, lean: -1 }; }
  g.shadow(px, 5); g.shadow(q.x ?? qx, 5);
  const hand = [px + 6.4, 23];
  brolly(g, ux, utop, hand);
  friend(g, Object.assign({ x: qx, la: 40 }, q));
  drawPip(g, Object.assign({ x: px, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: hand[0], y: hand[1] }] }, SMALL, p));
  if (wet && s.k < 3) { fx.drop(g, qx - 5, 13 + (f % 8) * 0.4, SKY); if (f % 8 < 4) g.px(qx + 4, 15, SKY); }
  if (s.k === 3 && s.n >= 10) fx.heart(g, 16, 16 - ((s.n - 10) % 14) * 0.5, s.n % 14 > 6);
  if (s.k === 4) fx.heart(g, 16, 11, true);
}, 48);

// ------------------------------------------------------------ two coffees
const CUP = "#FFFFFF", CUP_D = "#D8DEE6", COFFEE = "#6B3A1E";
const cup = (g, x, y, band) => {
  x = R(x); y = R(y);
  g.stamp((l) => l.rect(x, y, 4, 4, CUP).rect(x, y, 4, 1, COFFEE).rect(x, y + 2, 4, 1, band).px(x + 3, y + 3, CUP_D), "#2A2A33");
};
const steam = (g, x, y, f, lean = 0) => {
  for (let i = 0; i < 3; i++) g.px(R(x + Math.sin((f + i * 3) * 0.6) + lean * i), y - i * 2, i % 2 ? "#8A93A0" : "#AEB6C2");
};

def("coffeecups", "Two Coffees", "Books", 60, "Book nod: rom-coms. A small table, two cups and two pips; the steam from both curls up into one heart.", (g, f) => {
  const s = tl(f, [14, 6, 12, 16, 12]);
  // The table, with a cloth, between them.
  g.stamp((l) => {
    l.rect(11, 23, 10, 1, "#FFF6DF").rect(11, 24, 10, 1, "#E6DCC0");
    for (let x = 11; x < 21; x += 2) l.px(x, 24, "#FF8FA3");
    l.rect(15, 25, 2, 6, "#8A5A34").rect(13, 31, 6, 1, "#5E3A1F");
  }, "#2E1D10");
  const sip = s.k === 0 ? Math.sin(Math.PI * clamp(s.t * 1.2)) : 0;
  const cl = [11 - sip * 2, 19 - sip * 2], cr = [17 + sip * 2, 19 - sip * 2];
  let p = { eyes: sip > 0.6 ? "closed" : "open", look: [1, 0], fdx: 1, mouth: sip > 0.6 ? "o" : "smile", la: 20 };
  let q = { eyes: sip > 0.6 ? "closed" : "open", look: [-1, 0], fdx: -1, mouth: sip > 0.6 ? "o" : "smile" };
  if (s.k === 2) {
    // A glance across the table, caught, and a quick look away.
    const caught = s.n > 5;
    p = { eyes: caught ? "dot" : "open", look: caught ? [-1, -1] : [1, 0], fdx: caught ? -1 : 1, mouth: caught ? "wavy" : "smile", blush: caught ? "big" : true, la: 20 };
    q = { eyes: caught ? "dot" : "open", look: caught ? [1, -1] : [-1, 0], fdx: caught ? 1 : -1, mouth: caught ? "wavy" : "smile", blush: caught ? "big" : true };
  }
  if (s.k === 3) { p = { eyes: "wide", look: [1, -1], fdx: 1, mouth: "o", blush: "big", la: 10 }; q = { eyes: "wide", look: [-1, -1], fdx: -1, mouth: "o", blush: "big" }; }
  if (s.k === 4) { p = { eyes: "happy", fdx: 1, mouth: "smile", blush: "big", la: 30 + wave(s.n, 12, 6) }; q = { eyes: "happy", fdx: -1, mouth: "smile", blush: "big" }; }
  g.shadow(6, 5); g.shadow(26, 5);
  drawPip(g, Object.assign({ x: 6, hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: cl[0] - 1, y: cl[1] + 2.5 }] }, SMALL, p));
  friend(g, Object.assign({ x: 26, la: 20, hands: (A) => [{ x: cr[0] + 5, y: cr[1] + 2.5 }, { x: A.handR[0], y: A.handR[1] }] }, q));
  cup(g, cl[0], cl[1], "#7CC8FF"); cup(g, cr[0], cr[1], "#FF8FA3");
  if (s.k !== 0 && s.k < 3) { steam(g, 13, 17, f); steam(g, 18, 17, f + 5); }
  if (s.k === 3) {
    // The two wisps lean in, meet, and close into a heart.
    const t = eo(s.t);
    steam(g, 13, 17, f, t * 0.9); steam(g, 18, 17, f + 5, -t * 0.9);
    if (s.t > 0.45) fx.heart(g, 16, lerp(12, 8, (s.t - 0.45) / 0.55), s.t > 0.7, "#FF8FA3");
  }
  if (s.k === 4) { fx.heart(g, 16, 8 - s.t * 5, true, s.n % 6 < 3 ? PINK : "#FF8FA3"); steam(g, 13, 17, f); steam(g, 18, 17, f + 5); }
}, 44);

// ------------------------------------------------------------ a glare that melts
const zap = (g, x0, x1, y, f) => {
  // A crackle of bad feeling between two stares.
  g.stamp((l) => {
    let x = x0, up = f % 2 === 0;
    while (x < x1) { const nx = Math.min(x1, x + 2); l.line(x, y + (up ? -1 : 1), nx, y + (up ? 1 : -1), GOLD); x = nx; up = !up; }
  }, "#4A3100");
};

def("glaresmile", "Enemies, Mostly", "Books", 60, "Book nod: rom-coms. Two pips glare at each other across a crackle of sparks; one mouth twitches, then the other, and the glare melts into a smile.", (g, f) => {
  const s = tl(f, [16, 8, 8, 14, 14]);
  let p = { eyes: "angry", brows: "angry", mouth: "flat", look: [1, 0], fdx: 1, blush: false, la: -10, lean: 1.5 };
  let q = { eyes: "angry", brows: "angry", mouth: "flat", look: [-1, 0], fdx: -1, blush: false, lean: -1.5 };
  if (s.k === 0 && s.n % 8 > 5) { p.lean = 2; q.lean = -2; }
  if (s.k === 1) { p = Object.assign(p, { mouth: s.n % 4 < 2 ? "wavy" : "flat", brows: s.n > 4 ? null : "angry", eyes: s.n > 4 ? "open" : "angry" }); }
  if (s.k === 2) {
    p = Object.assign(p, { eyes: "open", brows: null, mouth: "smirk", lean: 1 });
    q = Object.assign(q, { mouth: s.n % 4 < 2 ? "wavy" : "flat", brows: s.n > 3 ? null : "angry", eyes: s.n > 3 ? "open" : "angry" });
  }
  if (s.k === 3) {
    // Caught smiling. Both look anywhere else.
    p = { eyes: "dot", look: [-1, -1], fdx: -1, mouth: "wavy", blush: "big", la: 30, lean: -0.5 };
    q = { eyes: "dot", look: [1, -1], fdx: 1, mouth: "wavy", blush: "big", lean: 0.5 };
  }
  if (s.k === 4) {
    p = { eyes: "happy", look: [1, 0], fdx: 1, mouth: "smile", blush: "big", la: 30 + wave(s.n, 12, 8), lean: 1 };
    q = { eyes: "happy", look: [-1, 0], fdx: -1, mouth: "smile", blush: "big", lean: -1 };
  }
  g.shadow(8, 5); g.shadow(24, 5);
  drawPip(g, Object.assign({ x: 8 }, SMALL, p));
  friend(g, Object.assign({ x: 24, la: -20 }, q));
  if (s.k === 0 || (s.k === 1 && s.n < 5)) { if (f % 3 !== 2) zap(g, 13, 19, 20, f); if (f % 6 < 3) fx.star(g, 16, 20, 0, WHITE); }
  if (s.k === 0 && s.n % 8 > 5) { g.px(3, 13, INKX).px(4, 12, INKX).px(28, 13, INKX).px(27, 12, INKX); }
  if (s.k === 3) { fx.drop(g, 2, 15 + (s.n % 7) * 0.4, SKY); fx.drop(g, 29, 15 + ((s.n + 3) % 7) * 0.4, SKY); if (s.n > 6) fx.heart(g, 16, 18 - (s.n - 6) * 0.6, false); }
  if (s.k === 4) fx.heart(g, 16, 12 - s.t * 4 + wave(s.n, 8, 0.6), true);
}, 50);

// ------------------------------------------------------------ a touch that crackles
const GLOVE = "#6C7FC4", GLOVE_L = "#C9D4F2", GLOVE_D = "#45548F";
const gloved = (g, h) => g.stamp((l) => {
  l.ell(h.x, h.y, 2.2, 2.2, (nx, ny) => (nx + ny < -0.5 ? GLOVE_L : nx + ny > 0.6 ? GLOVE_D : GLOVE));
  l.rect(R(h.x) - 2, R(h.y) + 2, 4, 1, GLOVE_L);
}, "#1C2340");
const looseGlove = (g, x, y, flat) => g.stamp((l) => {
  x = R(x); y = R(y);
  if (flat) l.rect(x - 2, y, 5, 2, GLOVE).rect(x - 2, y, 2, 2, GLOVE_L).px(x + 2, y + 1, GLOVE_D);
  else l.rect(x - 1, y - 2, 3, 4, GLOVE).px(x - 1, y - 2, GLOVE_D).rect(x - 1, y + 1, 3, 1, GLOVE_L);
}, "#1C2340");
const arc = (g, a, b, f, seed) => {
  // A jagged thread of light from a to b, redrawn every frame.
  const tall = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]);
  g.stamp((l) => {
    let [x, y] = a;
    for (let i = 1; i <= 4; i++) {
      const t = i / 4, j = i < 4 ? (rnd(f * 3 + i + seed) - 0.5) * 6 : 0;
      const nx = lerp(a[0], b[0], t) + (tall ? j : 0), ny = lerp(a[1], b[1], t) + (tall ? 0 : j);
      l.line(x, y, nx, ny, i % 2 ? "#BFE8FF" : WHITE);
      x = nx; y = ny;
    }
  }, "#2F6FB8");
};
const whiteBird = (g, x, y, flap) => {
  // A small white bird, a fleck of gold on its head.
  x = R(x); y = R(y);
  g.stamp((l) => {
    l.rect(x - 2, y, 5, 2, WHITE).rect(x + 2, y - 1, 2, 2, WHITE).px(x - 3, y + 1, "#DCE6F2").px(x - 3, y, WHITE).px(x + 4, y, "#F0A020").px(x + 2, y - 2, GOLD).px(x + 3, y - 1, INKX);
    if (flap) l.px(x, y - 1, WHITE).px(x - 1, y - 2, WHITE).px(x, y - 2, "#DCE6F2").px(x - 1, y - 3, WHITE).px(x - 2, y - 3, WHITE);
    else l.px(x, y + 2, WHITE).px(x - 1, y + 3, WHITE).px(x, y + 3, "#DCE6F2").px(x - 2, y + 3, WHITE);
  }, "#3A4A66");
};

def("sparktouch", "Gloves Off", "Books", 72, "Book nod: Shatter Me. The gloves come off, sparks jump between Pip's hands, and out of the light a small white bird takes flight.", (g, f) => {
  const s = tl(f, [12, 10, 10, 16, 14, 10]);
  const X = 12;
  let o, sparks = 0, bird = null;
  // Which hands are bare, and how far each glove has fallen.
  const offR = s.k > 1 || (s.k === 1 && s.t > 0.5), offL = s.k > 2 || (s.k === 2 && s.t > 0.5);
  if (s.k === 0) o = { eyes: blink(s.n, 12, 8) ? "blink" : "sad", brows: "sad", look: [0, 1], mouth: "flat", blush: false, la: 60, sq: 0.03 };
  if (s.k === 1) o = { eyes: "open", look: [1, 1], fdx: 1, mouth: "tiny", blush: false, la: 50 };
  if (s.k === 2) o = { eyes: "open", look: [-1, 1], fdx: -1, mouth: "tiny", blush: false, la: 40 };
  if (s.k === 3) { sparks = clamp(s.t * 2.5); o = { eyes: s.t < 0.35 ? "wide" : "determined", brows: s.t < 0.35 ? "up" : "focus", look: [1, 0], fdx: 1, mouth: s.t < 0.35 ? "o" : "smirk", la: -10 + (s.n % 2) * 6, lean: 0.8 }; }
  if (s.k === 4) { bird = [lerp(24, 21, s.t) + Math.sin(s.t * TAU * 1.5) * 2, lerp(17, -6, ei(s.t))]; sparks = 1 - s.t * 1.6; o = { eyes: "wide", look: [1, -1], fdx: 1, fdy: -1, mouth: "open", blush: "big", la: -10 }; }
  if (s.k === 5) o = { eyes: "happy", look: [1, -1], fdx: 1, mouth: "smile", blush: "big", la: 28 + wave(s.n, 10, 8) };
  // The bare hands lift to one side, one above the other, for the light to jump between.
  const up = s.k === 3 ? eo(clamp(s.t * 3)) : s.k === 4 ? 1 : s.k === 5 ? 1 - eo(clamp(s.t * 2)) : 0;
  let top = null, low = null;
  const hands = (A) => {
    let L = { x: A.cx - 6, y: A.cy + 3 }, Rh = { x: A.cx + 6, y: A.cy + 3 };
    if (s.k === 1 && s.t <= 0.5) Rh = { x: A.cx + 7 + s.t * 6, y: A.cy + 2 };
    if (s.k === 2 && s.t <= 0.5) L = { x: A.cx - 7 - s.t * 6, y: A.cy + 2 };
    if (up > 0) {
      L = { x: lerp(L.x, A.cx + 9, up), y: lerp(L.y, A.cy - 8, up) };
      Rh = { x: lerp(Rh.x, A.cx + 11, up), y: lerp(Rh.y, A.cy + 4, up) };
      top = [L.x + 1, L.y + 1]; low = [Rh.x, Rh.y - 2];
    }
    if (!offL) L.item = gloved;
    if (!offR) Rh.item = gloved;
    return [Rh, L];
  };
  g.shadow(X, 6);
  const fallen = (side, t) => { t = clamp(t); looseGlove(g, X + side * (9 + t * 3) + (side > 0 ? 3 : 0), lerp(21, 29, ei(t)), t >= 1); };
  if (offL) fallen(-1, s.k === 2 ? (s.t - 0.5) * 2.5 : 1);
  if (offR) fallen(1, s.k === 1 ? (s.t - 0.5) * 2.5 : 1);
  drawPip(g, Object.assign({ x: X, hands }, o));
  if (sparks > 0.1 && top) {
    arc(g, top, low, f, 0);
    if (sparks > 0.6) arc(g, top, low, f, 9);
    for (let i = 0; i < 3; i++) if ((f + i * 2) % 3 === 0) fx.star(g, 24 + (rnd(f + i) - 0.5) * 9, 16 + (rnd(f * 2 + i) - 0.5) * 16, rnd(f + i * 5) > 0.5 ? 1 : 0, i % 2 ? "#BFE8FF" : WHITE);
  }
  if ((s.k === 1 || s.k === 2) && s.t > 0.5 && s.n % 3 === 0) fx.star(g, X + (s.k === 1 ? 8 : -8), 23, 0, "#BFE8FF");
  if (bird) whiteBird(g, bird[0], bird[1], s.n % 4 < 2);
  if (s.k === 5) { const t = s.t; g.stamp((l) => l.px(23 + Math.sin(t * 6) * 2, 3 + t * 16, WHITE).px(24 + Math.sin(t * 6) * 2, 4 + t * 16, "#DCE6F2"), "#3A4A66"); }
}, 40);

// ------------------------------------------------------------ masquerade
const MASK = "#6B3FA0", MASK_L = "#9A6BD6", MASK_D = "#3F2466";
const domino = (g, x, y, peep) => {
  // A half-mask with gold trim and a plume, on a stick. Centre of the mask at (x, y).
  x = R(x); y = R(y);
  g.stamp((l) => l.line(x + 6, y + 1, x + 9, y + 8, "#8A5A34"), "#2E1D10");
  g.stamp((l) => {
    l.rect(x - 6, y - 2, 13, 4, MASK).rect(x - 5, y - 3, 4, 1, MASK).rect(x + 2, y - 3, 4, 1, MASK).rect(x - 6, y - 2, 13, 1, MASK_L);
    l.px(x - 6, y + 1, null).px(x + 6, y + 1, null).rect(x - 1, y + 1, 3, 1, null);
    l.rect(x - 4, y - 1, 3, 2, peep ? WHITE : MASK_D).rect(x + 2, y - 1, 3, 2, peep ? WHITE : MASK_D);
    if (peep) l.px(x - 3 + peep[0], y - 1 + (peep[1] > 0 ? 1 : 0), INKX).px(x + 3 + peep[0], y - 1 + (peep[1] > 0 ? 1 : 0), INKX);
    l.px(x - 6, y - 3, GOLD).px(x + 6, y - 3, GOLD).px(x, y - 2, GOLD);
    // The plume.
    l.line(x - 6, y - 3, x - 8, y - 7, "#1FBF6A").px(x - 7, y - 7, "#7CE0A8").px(x - 9, y - 6, "#1FBF6A").px(x - 8, y - 4, "#7CE0A8");
  }, "#1E0E33");
};

def("mask", "Masquerade", "Books", 60, "Book nod: courts and intrigue. Pip lifts a plumed mask to its face, glances left and right behind it, then lowers it with a wink.", (g, f) => {
  const s = tl(f, [10, 8, 20, 8, 14]);
  let o, on = 0, peep = null;
  if (s.k === 0) o = { eyes: blink(s.n, 10, 7) ? "blink" : "open", mouth: "smirk", look: [1, 0], la: 20 };
  if (s.k === 1) { on = eo(s.t); o = { eyes: s.t > 0.7 ? "none" : "open", mouth: "smirk", la: 20 }; }
  if (s.k === 2) {
    on = 1;
    const dir = s.n < 6 ? -1 : s.n < 12 ? 1 : 0;
    peep = [dir, s.n >= 12 && s.n < 16 ? 1 : 0];
    o = { eyes: "none", mouth: dir === 0 ? "smile" : "flat", fdx: dir, la: 20 - dir * 20, lean: dir * 1.2, x: 16 + dir };
  }
  if (s.k === 3) { on = 1 - eo(s.t); o = { eyes: s.t > 0.3 ? "wink" : "none", mouth: "smirk", la: 30 }; }
  if (s.k === 4) {
    const bow = Math.sin(Math.PI * clamp(s.t * 1.3));
    o = { eyes: bow > 0.4 ? "closed" : "wink", mouth: "smile", blush: "big", la: 30 + bow * 40, sq: 0.12 * bow, fdy: R(bow), hands: (A) => [{ x: A.handL[0] - 2 * bow, y: A.handL[1] - 3 * bow }, { x: A.cx + 10, y: A.cy - 1 + bow * 2 }] };
  }
  g.shadow(o.x ?? 16, 6);
  const side = [27, 22];
  let at = null;
  const A = drawPip(g, Object.assign({
    acc: on < 0.5,
    hands: (A) => { at = [lerp(side[0] - 6, A.fc, on), lerp(side[1] - 8, A.ey, on)]; return [{ x: A.handL[0], y: A.handL[1] }, { x: at[0] + 9, y: at[1] + 8 }]; }
  }, o, o.hands ? { hands: (A) => { at = [A.cx + 4, A.cy - 9 + (o.fdy || 0) * 2]; return o.hands(A); } } : null));
  domino(g, at[0], at[1], on > 0.9 ? peep ?? [0, 0] : null);
  drawHand(g, { x: at[0] + 9, y: at[1] + 8 });
  if (s.k === 2 && s.n % 6 === 0 && s.n < 12) g.text("?", s.n < 6 ? 2 : 27, 6, WHITE);
  if (s.k === 3 && s.t > 0.4) fx.twinkle(g, A.fc + 6, A.ey - 4, (s.t - 0.4) / 0.6, WHITE);
  if (s.k === 4) { fx.twinkle(g, 4, 8, (s.n % 10) / 10, GOLD); fx.twinkle(g, 28, 5, ((s.n + 5) % 10) / 10, "#C79BFF"); }
}, 24);

// ------------------------------------------------------------ thorns and roses
const VINE = "#4A6B2A", VINE_D = "#2E4A1A", THORN = "#6B4A2E", ROSE_R = "#E0393E", ROSE_L = "#FF8A8A", ROSE_D = "#8A1420";
const rose = (g, x, y, open) => {
  x = R(x); y = R(y);
  if (open < 0.3) { g.stamp((l) => l.px(x, y, ROSE_D), "#2A0A0E"); return; }
  g.stamp((l) => {
    l.rect(x - 1, y - 1, 3, 3, ROSE_R).px(x - 1, y - 1, ROSE_L).px(x, y, ROSE_D).px(x + 1, y + 1, ROSE_D);
    if (open > 0.8) l.px(x - 2, y, ROSE_R).px(x + 2, y, ROSE_R).px(x, y - 2, ROSE_L);
  }, "#2A0A0E");
};
/** A point on the briar that arches over Pip: t = 0 at the left root, 1 at the right. */
const briarAt = (t) => [16 - Math.cos(Math.PI * t) * 13, 31 - Math.sin(Math.PI * t) * 27];
const briar = (g, grown) => {
  g.stamp((l) => {
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      if (Math.min(t, 1 - t) * 2 > grown) continue;
      const [x, y] = briarAt(t);
      l.px(x, y, i % 5 === 0 ? VINE_D : VINE);
      if (i % 6 === 3) { const out = t < 0.5 ? -1 : 1; l.px(x + out, y - 1, THORN); }
      if (i % 6 === 0 && i % 12 !== 0) { const inn = t < 0.5 ? 1 : -1; l.px(x + inn, y, THORN); }
    }
  }, "#16240C");
};
const ROSES = [0.14, 0.3, 0.5, 0.7, 0.86];
const thornCrown = (g, A) => {
  const x = R(A.top.x), y = R(A.top.y) + 1;
  g.stamp((l) => {
    l.rect(x - 5, y, 11, 1, VINE).rect(x - 4, y - 1, 9, 1, VINE_D);
    for (let i = -5; i <= 5; i += 2) l.px(x + i, y - 2, THORN);
    l.px(x - 6, y - 1, THORN).px(x + 6, y - 1, THORN);
  }, "#16240C");
  rose(g, x - 4, y - 1, 1); rose(g, x, y - 2, 1); rose(g, x + 4, y - 1, 1);
};

def("thorncrown", "Thorns and Roses", "Books", 72, "Book nod: fae courts. A briar grows up and over Pip, breaks into roses, and settles on its head as a crown.", (g, f) => {
  const s = tl(f, [16, 14, 10, 8, 24]);
  const grown = s.k === 0 ? eo(s.t) : s.k < 3 ? 1 : 0;
  const bloom = s.k === 1 ? s.t : s.k === 2 ? 1 : 0;
  let o;
  if (s.k === 0) o = { eyes: "wide", look: [s.t < 0.5 ? -1 : 1, -1], mouth: "o", la: 28, sq: 0.04, hands: (A) => [{ x: A.handL[0] + 1, y: A.cy + 1 }, { x: A.handR[0] - 1, y: A.cy + 1 }] };
  if (s.k === 1) o = { eyes: s.t > 0.5 ? "happy" : "open", look: [0, -1], fdy: -1, mouth: s.t > 0.5 ? "open" : "o", blush: s.t > 0.5 ? "big" : true, la: 28 };
  if (s.k === 2) o = { eyes: "open", look: [0, -1], fdy: -1, mouth: "o", la: 28 };
  if (s.k === 3) o = { eyes: "squeeze", mouth: "flat", la: 28, leaf: "none", sq: 0.1 * Math.sin(Math.PI * s.t) };
  if (s.k === 4) o = { eyes: s.n < 4 ? "open" : blink(s.n, 12, 9) ? "blink" : "half", brows: s.n < 4 ? "up" : null, mouth: "smirk", blush: "big", leaf: "none", lean: wave(s.n, 24, 0.5), hands: (A) => [{ x: A.handL[0] + 1, y: A.cy + 4 }, { x: A.handR[0] + 1, y: A.cy - 3 }] };
  g.shadow(16, 6);
  if (grown > 0) briar(g, grown);
  // In the third beat the arch pulls itself down into a ring above Pip's head.
  const shrink = s.k === 2 ? eio(s.t) : 0;
  const A = drawPip(g, Object.assign({ over: s.k >= 3 ? thornCrown : null, acc: s.k < 3 }, o));
  if (bloom > 0 && s.k < 3) ROSES.forEach((t, i) => {
    const open = clamp(bloom * 5 - i * 0.8);
    if (open <= 0) return;
    const [x, y] = briarAt(t);
    rose(g, lerp(x, A.top.x + (i - 2) * 2, shrink), lerp(y, A.top.y - 3, shrink), open);
  });
  if (s.k === 3 && s.t > 0.3) fx.impact(g, A.top.x, A.top.y - 4);
  if (s.k === 4) {
    for (let i = 0; i < 3; i++) { const t = ((s.n + i * 8) % 24) / 24; g.stamp((l) => l.px(5 + i * 10 + Math.sin(t * 7 + i) * 2, 2 + t * 26, i % 2 ? ROSE_L : ROSE_R), "#2A0A0E"); }
    fx.twinkle(g, 27, 9, (s.n % 12) / 12, GOLD);
  }
}, 56);
