/* Pip's moves for life in the house: what she does with her hands free and
 the reader's hand near. Drawn like every other move (a pure function of the
 frame, 12 fps) and registered through `def`, so LIB stays one list. Loaded
 with the Pip tab (houseArt.ts), not with the app: only the house plays them.

   eye-l, eye-ur...  the idle, looking one of eight ways (she follows the pointer)
   shift, bop        small things while standing about
   gaze              looking up, out of a window or at the sky
   water             a watering can tipped over a houseplant
   gamer             at an arcade cabinet, mashing buttons
   boop              poked: a squash and a start, at once
   pet               stroked: leaning into the hand, hearts
   tossed            thrown: a pose the scene turns as she flies
   squint            the curtains are drawn on her in the daytime
   scamper, carry    after the ball, and bringing it back
   beg               a treat is on offer
   tiptoe, fridge-stare, nibble, caught   the midnight snack
   scroll..., phone...                    on her phone, in bed and on her feet
   innocent          tapped while on her phone: what phone?
   snooze            morning, in bed: not yet

 The ones with no category (the eight ways of looking, the ball on its own)
 are parts, not moves to show off: the design kit (scripts/pip-kit.mjs) lists
 only moves that have one. */
import { drawPip, rgba } from "./engine.js";
import { def, fx, kit } from "./anims.js";

const { TAU, wave, lerp, hop, tl, blink, GOLD, WHITE, SKY } = kit;

// ------------------------------------------------------------ watching the pointer
// The idle, with the eyes (and the face, a pixel) turned one of eight ways.
// "eye-ul" looks up and left; the scene picks one from where the pointer is.
for (const [dy, v] of [[-1, "u"], [0, ""], [1, "d"]]) {
  for (const [dx, h] of [[-1, "l"], [0, ""], [1, "r"]]) {
    if (!dx && !dy) continue;
    def(`eye-${v}${h}`, "Watching", "", 48, "The pointer is near: Pip's eyes follow it.", (g, f) => {
      g.shadow(16, 6);
      drawPip(g, {
        sq: wave(f, 24, 0.035),
        // The leaf tips the way she looks.
        la: 28 + wave(f, 48, 7) + dx * 16,
        look: [dx, dy],
        fdx: dx,
        fdy: dy < 0 ? -1 : 0,
        eyes: blink(f) ? "blink" : "open",
        brows: dy < 0 ? "up" : null
      });
    });
  }
}

// ------------------------------------------------------------ standing about
def("shift", "Shifting Weight", "House", 24, "Standing about: Pip rocks from one foot to the other.", (g, f) => {
  const lean = wave(f, 24, 1.3);
  g.shadow(16, 6);
  drawPip(g, {
    lean,
    sq: wave(f, 12, 0.02),
    la: 28 - lean * 9,
    eyes: blink(f, 24, 14) ? "blink" : "open",
    feet: (A) => [[A.cx - 3.5, A.bottom + 1.1 - (lean > 0.6 ? 0.8 : 0)], [A.cx + 3.5, A.bottom + 1.1 - (lean < -0.6 ? 0.8 : 0)]]
  });
});

def("bop", "Little Bop", "House", 32, "A tune in her head: Pip bobs along.", (g, f) => {
  const beat = f % 8 < 4;
  g.shadow(16, beat ? 6 : 7);
  drawPip(g, {
    y: 28 - (beat ? 0.6 : 0),
    sq: beat ? -0.05 : 0.07,
    lean: wave(f, 16, 0.8),
    la: 28 + wave(f, 8, 16),
    eyes: "happy",
    mouth: f % 16 < 8 ? "smile" : "open",
    hands: (A) => [{ x: A.handL[0] - (beat ? 1 : 0), y: A.handL[1] - (beat ? 2 : 0) }, { x: A.handR[0] + (beat ? 0 : 1), y: A.handR[1] - (beat ? 0 : 2) }]
  });
  const t = (f % 16) / 16;
  fx.note(g, 24 + wave(f, 16, 1), 10 - t * 8);
  if (f >= 16) fx.note(g, 3 + wave(f, 12, 1), 12 - ((f - 16) / 16) * 8, "#FF4D6D");
});

def("gaze", "Gazing Up", "House", 48, "At a window, or under the open sky: Pip looks up a while.", (g, f) => {
  g.shadow(16, 6);
  const sigh = f >= 34 && f < 42;
  drawPip(g, {
    sq: wave(f, 48, 0.03),
    fdy: -1,
    look: [f % 48 < 24 ? 0 : 1, -1],
    la: 16 + wave(f, 48, 6),
    eyes: blink(f, 48, 20) ? "blink" : "open",
    mouth: sigh ? "o" : "smile",
    hands: (A) => [{ x: A.cx - 3, y: A.cy + 5 }, { x: A.cx + 3, y: A.cy + 5 }]
  });
  fx.twinkle(g, 26, 5, ((f + 10) % 48) / 48, WHITE);
}, 6);

// ------------------------------------------------------------ the houseplant
// The can is the greenhouse's own (house.js, "wateringcan"), small enough to hold.
const can = (g, x, y, tip) => {
  g.stamp((l) => {
    l.rect(x, y, 6, 5, "#35A6A0").rect(x, y, 6, 1, "#6FDCC7").rect(x, y, 1, 5, "#6FDCC7");
    // The spout, lower when tipped.
    l.line(x + 6, y + 2, x + 9, y + (tip ? 3 : 0), "#35A6A0");
    l.px(x + 10, y + (tip ? 3 : -1), "#1F7F71");
    l.ring(x + 2.5, y, 2.4, "#1F7F71", (t) => t < 0.5);
  }, "#0C2A26");
};

def("water", "Watering", "House", 48, "A houseplant looks thirsty: Pip tips the can over it.", (g, f) => {
  const s = tl(f, [8, 30, 10]);
  const tip = s.k === 1;
  g.shadow(11, 6);
  // She stands to the left of the frame, so the can and its water have room.
  const A = drawPip(g, {
    x: 11,
    lean: tip ? 0.8 : 0,
    fdx: 1,
    look: [1, tip ? 1 : 0],
    la: 20 + wave(f, 24, 5),
    eyes: blink(f, 48, 40) ? "blink" : s.k === 2 ? "happy" : "open",
    mouth: s.k === 2 ? "open" : "smile",
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + 9, y: A.cy + (tip ? 2 : 4) }]
  });
  can(g, A.cx + 9, A.cy - (tip ? 3 : 1), tip);
  if (tip) {
    // Drops arc out of the spout and down, three at a time.
    for (let i = 0; i < 3; i++) {
      const t = ((s.n + i * 4) % 12) / 12;
      g.px(A.cx + 20 + t, A.cy + 1 + t * t * 13, i % 2 ? SKY : "#BFE6FF");
    }
  }
}, 20);

// ------------------------------------------------------------ the arcade
def("gamer", "Button Masher", "House", 24, "At a cabinet in the arcade: eyes on the screen, hands flying.", (g, f) => {
  const a = f % 4 < 2;
  g.shadow(16, 6);
  const A = drawPip(g, {
    x: 15,
    lean: 0.9,
    sq: wave(f, 6, 0.025),
    fdx: 1,
    look: [1, 0],
    brows: "focus",
    eyes: "determined",
    mouth: f % 24 < 18 ? "flat" : "o",
    la: -8 + wave(f, 4, 6),
    hands: (A) => [{ x: A.cx + 7, y: A.cy + (a ? 0 : 2) }, { x: A.cx + 9, y: A.cy + 2 + (a ? 2 : 0) }]
  });
  // The screen's light on her face, and a point scored now and then.
  if (f % 4 < 2) g.px(A.cx + 12, A.cy + 1, "#7FE0FF");
  if (f >= 12 && f < 20) fx.star(g, 27, 6 - (f - 12) * 0.4, 1);
}, 2);

// ------------------------------------------------------------ the reader's hand
def("boop", "Booped", "House", 12, "You poke Pip: a squash, a start, and a blink.", (g, f) => {
  const s = tl(f, [2, 4, 6]);
  let o;
  if (s.k === 0) o = { sq: 0.2, eyes: "squeeze", mouth: "o", la: 60 };
  else if (s.k === 1) o = { y: 28 + hop(s.t, 3), sq: -0.14, eyes: "wide", brows: "up", mouth: "o", la: 0, ll: 1.15, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 3 }, { x: A.handR[0] + 2, y: A.cy - 3 }] };
  else o = { sq: 0.06 * (1 - s.t), eyes: s.n < 2 ? "blink" : "open", mouth: "smile", la: lerp(0, 28, s.t), blush: "big" };
  g.shadow(16, s.k === 1 ? 5 : 6);
  drawPip(g, o);
  if (s.k === 1) g.text("!", 26, 2, GOLD);
});

def("pet", "Being Petted", "House", 24, "You stroke Pip: she leans into your hand.", (g, f) => {
  g.shadow(16, 7);
  drawPip(g, {
    sq: 0.1 + wave(f, 12, 0.035),
    lean: wave(f, 24, 1.1),
    la: 70 + wave(f, 12, 10),
    eyes: "happy",
    mouth: "cat",
    blush: "big",
    hands: (A) => [{ x: A.cx - 3, y: A.cy + 5 }, { x: A.cx + 3, y: A.cy + 5 }]
  });
  for (let i = 0; i < 2; i++) {
    const t = ((f + i * 12) % 24) / 24;
    fx.heart(g, 6 + i * 19 + wave(f + i * 5, 12, 1.2), 14 - t * 14, t > 0.5 && i === 0);
  }
});

// Thrown. The stunt "tumble" turns itself, once every 8 frames; in the house
// the scene turns her (as fast as she was thrown, slower off each wall), and
// the two turns together cancelled out for a throw one way. So this one holds
// still in its frame and leaves the turning to the scene.
def("tossed", "Tossed", "", 8, "Thrown across the room: the house turns her as she flies.", (g, f) => {
  drawPip(g, {
    sq: -0.08,
    ll: 1.1,
    la: -40 + wave(f, 4, 14),
    eyes: "squeeze",
    mouth: "shout",
    hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 3 + wave(f, 4, 1) }, { x: A.handR[0] + 2, y: A.cy - 3 - wave(f, 4, 1) }],
    feet: (A) => [[A.cx - 3, A.bottom + 1.4 + wave(f, 4, 0.6)], [A.cx + 3, A.bottom + 1.4 - wave(f, 4, 0.6)]]
  });
});

def("squint", "Who Turned Out the Sun", "House", 24, "You draw the curtains in the daytime: Pip peers about in the gloom.", (g, f) => {
  const s = tl(f, [6, 12, 6]);
  const side = s.k === 1 ? (s.n < 6 ? -1 : 1) : 0;
  g.shadow(16, 6);
  drawPip(g, {
    sq: s.k === 0 ? 0.08 * (1 - s.t) : wave(f, 12, 0.02),
    lean: side * 0.6,
    fdx: side,
    look: [side, 0],
    la: 28 + side * 18,
    eyes: s.k === 0 ? "wide" : "squeeze",
    brows: s.k === 0 ? "up" : "focus",
    mouth: s.k === 2 ? "flat" : "o",
    // A hand up to her brow, peering.
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + 4 + side, y: A.cy - 5 }]
  });
  if (s.k === 0) g.text("?", 25, 3, GOLD);
});

def("beg", "Yes Please", "House", 16, "A treat is on offer: Pip is on her toes for it.", (g, f) => {
  const j = hop((f % 8) / 8, 1.6);
  g.shadow(16, 6);
  drawPip(g, {
    y: 28 + j,
    sq: -0.06,
    fdy: -1,
    look: [0, -1],
    eyes: "wide",
    mouth: "open",
    blush: "big",
    la: 10 + wave(f, 8, 10),
    hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 4 + wave(f, 8, 1) }, { x: A.handR[0] + 1, y: A.cy - 4 - wave(f, 8, 1) }]
  });
  fx.twinkle(g, 27, 5, (f % 16) / 16);
});

// ------------------------------------------------------------ the ball
// The ball from treats.js, or a ball of scrap paper for a Pip without one.
const ballArt = (g, x, y, f, paper) => {
  if (paper) {
    g.stamp((l) => l.ell(x, y, 2.8, 2.8, (nx, ny) => (nx + ny < -0.7 ? "#FFFFFF" : Math.abs(nx - ny) < 0.18 || Math.abs(nx + ny * 0.6 - 0.3) < 0.12 ? "#C9C0AC" : "#F2EAD6")), "#5E5544");
    return;
  }
  const rot = f * 0.5;
  g.stamp((l) => l.ell(x, y, 2.8, 2.8, (nx, ny) => {
    if (nx + ny < -0.9) return WHITE;
    const a = Math.atan2(ny, nx) + rot, seg = Math.floor(((((a % TAU) + TAU) % TAU) / (TAU / 4))) % 4;
    return ["#E0393E", "#FFFFFF", "#2F80E6", "#FFD23F"][seg];
  }), "#1A1A22");
};

def("scamper", "Scamper", "House", 6, "The ball is away: Pip is after it.", (g, f) => {
  const a = f % 6 < 3;
  g.shadow(16, 6);
  drawPip(g, {
    y: 28 - (f % 3 === 1 ? 1.2 : 0),
    lean: 1.6,
    fdx: 1,
    look: [1, 0],
    eyes: "determined",
    mouth: "open",
    la: -46 + wave(f, 6, 8),
    feet: (A) => [[A.cx - 3 + (a ? 2.4 : -2.4), A.bottom + 1.1 - (a ? 1.2 : 0)], [A.cx + 3 + (a ? -2.4 : 2.4), A.bottom + 1.1 - (a ? 0 : 1.2)]],
    hands: (A) => [{ x: A.handL[0] + (a ? 2 : -1), y: A.handL[1] - 1 }, { x: A.handR[0] + (a ? -1 : 2), y: A.handR[1] - 1 }]
  });
  fx.speed(g, 1, 20 + (f % 3), 4);
  fx.speed(g, 2, 26 - (f % 2), 3);
});

for (const paper of [false, true]) {
  def(paper ? "carry-paper" : "carry", "Bringing It Back", paper ? "" : "House", 8, "Pip has the ball, held high, and is bringing it back.", (g, f) => {
    const a = f % 8 < 4;
    g.shadow(16, 6);
    const A = drawPip(g, {
      y: 28 - (f % 4 < 2 ? 0 : 0.6),
      fdx: 1,
      look: [1, 0],
      eyes: "happy",
      mouth: "open",
      la: -30 + wave(f, 8, 6),
      feet: (A) => [[A.cx - 3 + (a ? 1.6 : -1.6), A.bottom + 1.1 - (a ? 0.8 : 0)], [A.cx + 3 + (a ? -1.6 : 1.6), A.bottom + 1.1 - (a ? 0 : 0.8)]],
      hands: (A) => [{ x: A.cx + 2, y: A.top.y + 1 }, { x: A.cx + 8, y: A.top.y + 1 }]
    });
    ballArt(g, A.cx + 5, A.top.y - 2 - (f % 4 < 2 ? 0 : 0.6), f, paper);
  });
}

/** The ball on its own, for the scene to throw: a move-shaped sprite like the scenery. */
def("ball", "Ball", "", 8, "The ball itself, rolling.", (g, f) => ballArt(g, 16, 16, f, false));
def("ball-paper", "Paper Ball", "", 8, "A ball of scrap paper, for a Pip without one.", (g, f) => ballArt(g, 16, 16, f * 0.5, true));

// ------------------------------------------------------------ the fridge
// The midnight snack (pip/behaviour.ts, `fridgeVisit`): over on tiptoe, a long
// stare into the light, something small eaten standing there, and the start
// she gives when the curtains open on her. She faces right in all of them:
// the scene stands her at the fridge's handle, the door open beyond her.

/** A pixel already drawn, mixed towards `col` by `t`: light falling on her (a layer keeps one colour a pixel, so it is mixed here). */
const lit = (g, x, y, col, t) => {
  const under = g.L.get(x, y);
  if (!under || t <= 0) return;
  const a = rgba(under), b = rgba(col);
  if (a[3] < 255) return;
  g.L.set(x, y, "#" + [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, "0")).join(""));
};
/** Light from a point falling on what is drawn within `r` of it, strongest near; and, where nothing is drawn, a faint halo of it. */
const glowFrom = (g, cx, cy, r, col, strength, halo) => {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
    if (d >= 1) continue;
    if (g.L.get(x, y)) lit(g, x, y, col, strength * (1 - d));
    else if (halo && d < 0.7) g.px(x, y, col + (d < 0.4 ? "3A" : "1E"));
  }
};

def("tiptoe", "Tiptoe", "House", 16, "After dark, on her way to the fridge: Pip would rather not be heard.", (g, f) => {
  const a = f % 16 < 8;
  const lift = Math.sin(((f % 8) / 8) * Math.PI);
  g.shadow(16, 5);
  drawPip(g, {
    y: 28 - lift * 0.8,
    sq: 0.07 - lift * 0.05,
    lean: 0.9,
    fdx: 1,
    // Eyes ahead, then a glance back over her shoulder.
    look: [f % 32 < 24 ? 1 : -1, 0],
    eyes: "wide",
    mouth: "tiny",
    la: -34 + wave(f, 16, 6),
    // One foot reaches out, high and slow; the other stays put.
    feet: (A) => [[A.cx - 3.5 + (a ? 0 : 1.6 * lift), A.bottom + 1.1 - (a ? 0 : 1.8 * lift)], [A.cx + 3.5 + (a ? 1.6 * lift : 0), A.bottom + 1.1 - (a ? 1.8 * lift : 0)]],
    // Hands up in front of her, like someone carrying a secret.
    hands: (A) => [{ x: A.cx + 2, y: A.cy + 1 + (a ? 0 : 0.6) }, { x: A.cx + 7, y: A.cy + 1 + (a ? 0.6 : 0) }]
  });
}, 2);

def("fridge-stare", "Fridge Stare", "House", 48, "The fridge is open: Pip stands in its light, looking for a while.", (g, f) => {
  // Top shelf, middle, bottom, middle: slowly, as if it might have changed.
  const shelf = [-1, 0, 1, 0][Math.floor(f / 12) % 4];
  g.shadow(16, 6);
  const A = drawPip(g, {
    lean: 0.7,
    sq: wave(f, 48, 0.02),
    fdx: 1,
    look: [1, shelf],
    eyes: blink(f, 48, 22) ? "blink" : "open",
    mouth: f >= 36 && f < 44 ? "o" : "flat",
    la: 34 + wave(f, 48, 4),
    // One hand on the door.
    hands: (A) => [{ x: A.handL[0], y: A.handL[1] }, { x: A.cx + 9.5, y: A.cy - 1 }]
  });
  glowFrom(g, A.cx + 17, A.cy, 17, "#FFF8E0", 0.34, false);
}, 6);

def("nibble", "A Little Something", "House", 36, "At the open fridge: something small, eaten standing there.", (g, f) => {
  const bites = Math.min(2, Math.floor(f / 10));
  const chew = f % 6 < 3;
  const done = f >= 28;
  g.shadow(16, 6);
  let hx = 0, hy = 0;
  const A = drawPip(g, {
    fdx: 1,
    look: [1, done ? 0 : 1],
    eyes: done ? "happy" : "open",
    mouth: done ? "smile" : chew ? "o" : "flat",
    mouthDx: 1,
    blush: "big",
    sq: chew ? 0.03 : 0,
    la: 30 + wave(f, 12, 5),
    hands: (A) => {
      hx = A.fc + 5;
      hy = A.ey + 4;
      return [{ x: A.handL[0], y: A.handL[1] }, done ? { x: A.handR[0], y: A.handR[1] } : { x: hx + 1, y: hy + 2 }];
    }
  });
  // A wedge of cheese, a bite smaller each time.
  if (!done) g.stamp((l) => l.rect(hx, hy - 1, 3 - bites, 2, "#FFD23F").px(hx, hy - 1, "#FFF1A8"), "#6B4A1E");
  if (!done && chew) g.px(A.fc + 3, hy + 3 + (f % 3), "#FFD23F");
  glowFrom(g, A.cx + 17, A.cy, 17, "#FFF8E0", 0.3, false);
}, 4);

def("caught", "Caught", "House", 30, "The light comes on while Pip is in the fridge: a start, then the picture of innocence.", (g, f) => {
  const s = tl(f, [3, 11, 16]);
  g.shadow(16, s.k === 0 ? 5 : 6);
  if (s.k === 0) drawPip(g, { y: 28 + hop(s.t, 2.5), sq: -0.12, eyes: "wide", brows: "up", mouth: "o", la: 0, ll: 1.15, hands: (A) => [{ x: A.handL[0] - 2, y: A.cy - 3 }, { x: A.handR[0] + 2, y: A.cy - 3 }] });
  // Frozen, cheeks full.
  else if (s.k === 1) drawPip(g, { sq: -0.04, eyes: "wide", brows: "up", mouth: "flat", blush: "big", la: 8, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 1 }, { x: A.handR[0] + 1, y: A.cy - 1 }] });
  // Nothing to see: hands behind her, eyes anywhere else.
  else drawPip(g, { sq: wave(s.n, 16, 0.02), look: [-1, -1], fdx: -1, eyes: "open", mouth: "whistle", blush: "big", la: 28 + wave(s.n, 8, 6), hands: false });
  if (s.k < 2) g.text("!", 26, 2, GOLD);
  else if (s.n % 16 < 12) fx.note(g, 5, 11 - (s.n % 16) * 0.4);
}, 8);

// ------------------------------------------------------------ the phone
// Late, in bed, her face lit by it (pip/behaviour.ts, `scrollSession`): thumb
// going, eyes down the feed, and the small things that happen on the way to
// falling asleep over it. Each is drawn twice from one description: lying in
// bed (`scroll-...`: only her head shows above the quilt, so the phone is held
// up beside it), and on her feet (`phone-...`, for a floor with no bed, and
// for the quick look she gives it by day).
const PHONE = { caseCol: "#2A2E3A", edge: "#10121A", on: "#EAF6FF", dim: "#6E8CA8", off: "#1B1F2A", glow: "#CFE9FF" };

/** The phone, upright, its top-left at (x, y): 4 by 7, the screen `lit01` 0..1, a post sliding up the feed. */
const phone = (g, x, y, f, lit01, mood) => {
  x = Math.round(x); y = Math.round(y);
  g.stamp((l) => {
    l.rect(x, y, 4, 7, PHONE.caseCol);
    const screen = lit01 > 0.66 ? PHONE.on : lit01 > 0.2 ? PHONE.dim : PHONE.off;
    l.rect(x + 1, y + 1, 2, 5, screen);
    if (lit01 > 0.66) {
      // The feed: one thing after another, all much the same.
      const at = 4 - (Math.floor(f / 3) % 5);
      l.rect(x + 1, y + 1 + at, 2, 1, mood === "frown" ? "#FF8A8A" : mood === "laugh" ? "#FFD23F" : "#9FD0FF");
    }
  }, PHONE.edge);
};

/** The phone lying flat (asleep on her chest, or on her nose): 6 by 3. */
const phoneFlat = (g, x, y, lit01) => {
  x = Math.round(x); y = Math.round(y);
  g.stamp((l) => l.rect(x, y, 6, 3, PHONE.caseCol).rect(x + 1, y + 1, 4, 1, lit01 > 0.66 ? PHONE.on : lit01 > 0.2 ? PHONE.dim : PHONE.off), PHONE.edge);
};

for (const lying of [true, false]) {
  const id = (beat) => (lying ? "scroll" : "phone") + (beat ? "-" + beat : "");
  // Lying, she is the sleeper's shape with her eyes open; the phone is up by her head. Standing, it is lower, at her side.
  const base = lying ? { sq: 0.06, la: -52 } : { la: -20 };
  const px = 23, py = lying ? 12 : 16;
  const eyeY = lying ? -1 : 0;
  const hold = (dy = 0) => (A) => (lying ? [{ x: px + 1.5, y: py + 8 + dy }] : [{ x: A.handL[0], y: A.handL[1] }, { x: px + 1.5, y: py + 8 + dy }]);
  const ground = (g) => { if (!lying) g.shadow(16, 6); };
  const shine = (g, strength = 1, y = py) => glowFrom(g, px + 2, y + 3, 9, PHONE.glow, 0.55 * strength, strength > 0.5);

  def(id(""), lying ? "Doom Scroll" : "On Her Phone", "House", 48, lying ? "Late, in bed: thumb going, eyes down the feed, face lit by the phone." : "A look at the phone, thumb going.", (g, f) => {
    // Down the feed, then a flick back to the top.
    const scan = f % 24 < 18 ? (f % 24 < 9 ? 0 : 1) : 0;
    const thumb = f % 6 < 3 ? 0 : 1;
    ground(g);
    drawPip(g, { ...base, sq: (base.sq || 0) + wave(f, 48, 0.02), fdx: 1, look: [1, eyeY + scan], eyes: blink(f, 48, 30) ? "blink" : "half", mouth: "flat", hands: hold(thumb * 0.6) });
    phone(g, px, py, f, 1);
    shine(g);
  }, 6);

  def(id("laugh"), "Quiet Laugh", "", 24, "On her phone: something was funny.", (g, f) => {
    const shake = f < 18 ? wave(f, 4, 0.5) : 0;
    ground(g);
    drawPip(g, { ...base, x: 16 + shake, sq: (base.sq || 0) + (f < 18 ? wave(f, 6, 0.04) : 0), fdx: 1, look: [1, eyeY], eyes: f < 18 ? "happy" : "half", mouth: f < 18 ? "open" : "smile", blush: "big", hands: hold() });
    phone(g, px, py, f, 1, "laugh");
    shine(g);
    if (f < 16 && f % 8 < 5) g.text("ha", 2, 5 - Math.floor(f / 8), WHITE);
  }, 6);

  def(id("frown"), "Hm", "", 24, "On her phone: somebody is wrong about something.", (g, f) => {
    ground(g);
    drawPip(g, { ...base, lean: 0.5, fdx: 1, look: [1, eyeY], eyes: "determined", brows: "angry", mouth: f < 18 ? "frown" : "flat", hands: hold() });
    phone(g, px, py, f, 1, "frown");
    shine(g);
  }, 6);

  def(id("yawn"), "One More", "", 36, "On her phone: a yawn she talks herself out of.", (g, f) => {
    const s = tl(f, [8, 14, 14]);
    ground(g);
    if (s.k === 0) drawPip(g, { ...base, sq: (base.sq || 0) - 0.08 * s.t, fdx: 1, look: [1, eyeY], eyes: "half", mouth: "o", hands: hold(1) });
    else if (s.k === 1) drawPip(g, { ...base, sq: (base.sq || 0) - 0.08, eyes: "squeeze", mouth: "shout", la: (base.la || 0) + wave(s.n, 6, 4), hands: hold(2) });
    // And back to it, as if nothing had happened.
    else drawPip(g, { ...base, fdx: 1, look: [1, eyeY], eyes: s.n < 4 ? "blink" : "half", mouth: "flat", hands: hold() });
    phone(g, px, py + (s.k === 1 ? 2 : s.k === 0 ? 1 : 0), f, 1);
    shine(g, 1, py + (s.k === 1 ? 2 : 0));
  }, 28);

  def(id("drop"), "On the Nose", "", 36, "On her phone, nearly asleep: it slips, and lands on her nose.", (g, f) => {
    const s = tl(f, [6, 3, 11, 16]);
    ground(g);
    const nose = { x: 13, y: lying ? 17 : 16 };
    if (s.k === 0) {
      // Eyes closing, the grip going.
      drawPip(g, { ...base, fdx: 1, look: [1, eyeY], eyes: s.n < 3 ? "half" : "closed", mouth: "flat", hands: hold(s.t * 1.5) });
      phone(g, px - s.t, py + s.t, f, 1);
      shine(g);
    } else if (s.k === 1) {
      drawPip(g, { ...base, eyes: "closed", mouth: "flat", hands: hold(2) });
      phoneFlat(g, lerp(px - 2, nose.x, s.t), lerp(py + 2, nose.y - 1, s.t), 1);
    } else if (s.k === 2) {
      drawPip(g, { ...base, sq: (base.sq || 0) + 0.1 * (1 - s.t), eyes: "squeeze", mouth: "o", hands: hold(2) });
      phoneFlat(g, nose.x, nose.y + (s.n < 2 ? 1 : 0), 1);
      if (s.n < 7) { fx.star(g, 9, 11 - s.n * 0.5, 1); fx.star(g, 24, 13 - s.n * 0.4, 0); }
    } else {
      // Picked up again, one eye still watering.
      drawPip(g, { ...base, fdx: 1, look: [1, eyeY], eyes: s.n < 8 ? "teary" : "half", mouth: s.n < 8 ? "frown" : "flat", hands: hold(1 - Math.min(1, s.t * 2)) });
      phone(g, px, py + 1 - Math.min(1, s.t * 2), f, 1);
      shine(g);
    }
  }, 12);

  def(id("doze"), "Out Like the Screen", "", 48, "On her phone: asleep with it on her chest, the screen going out.", (g, f) => {
    const s = tl(f, [14, 10, 24]);
    // The screen: on, dimmed, off.
    const lit01 = s.k === 0 ? 1 : s.k === 1 ? 0.5 : 0;
    ground(g);
    drawPip(g, { ...base, sq: (base.sq || 0) + 0.05 * Math.min(1, f / 24), eyes: s.k === 0 && s.n < 8 ? "half" : "closed", mouth: "tiny", la: (base.la || 0) + Math.min(1, f / 24) * (lying ? 150 : 110), hands: s.k === 0 ? hold(1 + s.t * 2) : lying ? false : null });
    if (s.k === 0) phone(g, px, py + 1 + s.t * 2, f, 1);
    else phoneFlat(g, lying ? 20 : 19, lying ? 18 : 28, lit01);
    if (lit01 > 0) shine(g, lit01, lying ? 16 : 25);
    if (s.k === 2) { const t = (s.n % 24) / 24; fx.z(g, 22 + t * 5, 11 - t * 9, t > 0.4); }
  }, 47);
}

/** Asleep for the night with the phone where it fell, dark: what "doze" ends on, in bed. */
def("scroll-asleep", "Asleep, Phone and All", "", 48, "In bed, asleep, the phone dark on her chest.", (g, f) => {
  const A = drawPip(g, { sq: 0.12 + wave(f, 24, 0.04), eyes: "closed", mouth: "tiny", la: 100 + wave(f, 48, 5), hands: false });
  phoneFlat(g, 20, 18, 0);
  const b = f % 48;
  if (b < 36) {
    const r = 0.8 + (b / 36) * 1.1;
    g.stamp((l) => l.ell(A.fc + 2.5, A.ey + 4.5, r, r, (nx, ny) => (nx + ny < -0.6 ? WHITE : "#CFEFFF")), "#3D7FA8");
  }
  for (let k = 0; k < 2; k++) { const t = ((f + k * 24) % 48) / 48; fx.z(g, 22 + t * 5, 12 - t * 11, k === 0 ? t > 0.4 : false); }
}, 20);

def("innocent", "What Phone", "House", 36, "Tapped while on her phone: it is nowhere to be seen, and neither is any guilt.", (g, f) => {
  g.shadow(16, 6);
  drawPip(g, { sq: 0.04 + wave(f, 18, 0.02), look: [-1, -1], fdx: -1, eyes: blink(f, 36, 20) ? "blink" : "open", brows: "up", mouth: "whistle", la: 20 + wave(f, 12, 8), hands: false });
  const t = (f % 18) / 18;
  fx.note(g, 5 - t * 2, 12 - t * 7);
}, 6);

// ------------------------------------------------------------ the morning
// In bed as day comes: awake for a moment, a hand out for the alarm, and back
// under the quilt (she sinks until only her leaf shows above it).
def("snooze", "Snooze", "House", 48, "Morning, in bed: Pip wakes, hits snooze, and pulls the quilt back over her head.", (g, f) => {
  const s = tl(f, [10, 8, 10, 20]);
  if (s.k === 0) drawPip(g, { sq: 0.1 - 0.06 * s.t, eyes: s.n < 4 ? "closed" : "half", mouth: "o", la: 100 - 40 * s.t, hands: false });
  else if (s.k === 1) {
    // A hand out, and down on it.
    const reach = s.n < 4 ? s.n / 4 : 1;
    drawPip(g, { sq: 0.04, eyes: "half", brows: "angry", mouth: "flat", la: 60, hands: () => [{ x: 24 + reach * 3, y: 19 - (s.n >= 4 && s.n < 6 ? -1.5 : 0) }] });
    if (s.n >= 4 && s.n < 7) { g.px(29, 17, WHITE).px(30, 15, WHITE).px(26, 16, WHITE); }
  } else if (s.k === 2) drawPip(g, { y: 28 + 4 * s.t, sq: 0.06 + 0.06 * s.t, eyes: "closed", mouth: "tiny", la: 60 + 50 * s.t, hands: false });
  else {
    drawPip(g, { y: 32, sq: 0.12 + wave(s.n, 24, 0.03), eyes: "closed", mouth: "tiny", la: 110 + wave(s.n, 20, 4), hands: false });
    const t = (s.n % 20) / 20;
    fx.z(g, 22 + t * 5, 14 - t * 9, t > 0.4);
  }
}, 16);
