/* Art for Pip's mini-games (the Attic Arcade). Pure art: the game logic lives
 in the page. Every draw is a pure function of the frame number (12 fps).

 GAME_SPRITES = {
   dash:  Pip Dash, an endless runner (offline-dino style)
   catch: Leaf Catch, Pip with a basket catches what falls
   flap:  Page Flap, Pip flies by leaf-copter between book-spine pillars
 }

 Two kinds of entries:
   Pip poses (32 x 32, any skin, wardrobe too): { id, name, loop, box, draw(g, f) }
     -> renderFrame(pose, f, resolve(skin, f)) from index.js, exactly like a
        move; dress(skin, ids) works as well. Pip faces right. `box` is the
        hit box [x, y, w, h] inside the 32 x 32 frame.
   Sprites: { w, h, box?, frames?, draw(g, f, opts) }
     -> renderGameSprite(sprite, f, opts) -> ImageData(w, h). `frames` is the
        animation loop length (the game can also just pass its own frame
        counter). opts.h overrides the height (pillars), opts.letter picks a
        letter tile, opts.top flips a pillar to hang from the ceiling.

 Sizes are listed next to each sprite. Backgrounds are 240 x 120 and tile
 horizontally (draw two side by side and scroll); ground strips tile too. */
import { drawPip } from "./engine.js";
import { Painter, rnd } from "./room.js";

const TAU = Math.PI * 2;
const wave = (f, per, amp = 1, off = 0) => amp * Math.sin((TAU * f) / per + off);

export function renderGameSprite(sprite, f = 0, opts = {}) {
  const h = opts.h || sprite.h;
  const g = new Painter(sprite.w, h, f);
  sprite.draw(g, f, Object.assign({}, opts, { h }));
  return g.toImageData();
}

const pose = (id, name, loop, box, draw) => ({ id, name, cat: "Game", loop, when: "Mini-game sprite.", poster: 0, box, draw });

/** A tileable sky gradient. */
const sky = (g, top, bot, h) => {
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const c = mix(top, bot, t);
    for (let x = 0; x < g.w; x++) g.px(x, y, c);
  }
};
function mix(a, b, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
const cloud = (g, x, y, w) => g.stamp((l) => { l.ell(x, y + 2, w, 2.6, "#FFFFFF"); l.ell(x - w * 0.35, y + 1, w * 0.45, 2.6, "#FFFFFF"); l.ell(x + w * 0.25, y, w * 0.5, 3.2, (nx, ny) => (ny > 0.5 ? "#E6F2FF" : "#FFFFFF")); }, "#8FB8D8");

// ============================================================ PIP DASH
const RUN = [
  { y: 0, feet: [[-4.5, 0.4], [2.5, -1.2]] },
  { y: -1, feet: [[-2, -0.8], [4, 0.4]] },
  { y: 0, feet: [[2.5, -1.2], [-4.5, 0.4]] },
  { y: -1, feet: [[4, 0.4], [-2, -0.8]] }
];

const dashRun = pose("dash-run", "Dash: Run", 8, [10, 13, 13, 17], (g, f) => {
  const k = RUN[Math.floor(f / 2) % 4];
  g.shadow(16, 5);
  drawPip(g, {
    x: 15, y: 28 + k.y, lean: 1.2, sq: k.y ? -0.02 : 0.02, eyes: "determined", mouth: "smile", brows: "focus",
    look: [1, 0], fdx: 1, la: -62 + wave(f, 8, 8), ll: 0.95,
    feet: (A) => k.feet.map(([dx, dy]) => [A.cx + dx, A.bottom + 1.1 + dy]),
    hands: (A) => [{ x: A.handL[0] + (k.y ? 1 : -1), y: A.handL[1] + (k.y ? -1 : 1) }, { x: A.handR[0] + (k.y ? -1 : 1), y: A.handR[1] + (k.y ? 1 : -1) }]
  });
  if (f % 4 < 2) g.px(4, 29, "#C9B894").px(6, 30, "#C9B894");
});

const dashJump = pose("dash-jump", "Dash: Jump", 4, [10, 11, 13, 17], (g, f) => {
  drawPip(g, {
    x: 15, y: 27, sq: -0.12, eyes: "wide", mouth: "open", look: [1, -1], fdx: 1, la: -20 + wave(f, 4, 6), ll: 1.1,
    feet: (A) => [[A.cx - 3, A.bottom + 0.4], [A.cx + 3.5, A.bottom - 0.4]],
    hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 4 }, { x: A.handR[0] + 1, y: A.cy - 5 }]
  });
});

const dashDuck = pose("dash-duck", "Dash: Duck", 4, [7, 21, 19, 10], (g, f) => {
  g.shadow(16, 7);
  drawPip(g, {
    x: 15, sq: 0.34, lean: 1, eyes: "determined", mouth: "grit", brows: "focus", look: [1, 0], fdx: 1, la: -86, ll: 0.9,
    feet: (A) => [[A.cx - 4 + (f % 4 < 2 ? 1 : 0), A.bottom + 1.1], [A.cx + 4 - (f % 4 < 2 ? 1 : 0), A.bottom + 1.1]],
    hands: (A) => [{ x: A.handL[0] + 1, y: A.handL[1] + 1 }, { x: A.handR[0] - 1, y: A.handR[1] + 1 }]
  });
});

const dashOver = pose("dash-over", "Dash: Game Over", 24, [8, 13, 17, 17], (g, f) => {
  g.shadow(16, 6);
  const A = drawPip(g, { sq: 0.12, eyes: "x", mouth: "wavy", leaf: "wilt", la: 110, blush: false, hands: (A) => [{ x: A.handL[0], y: A.handL[1] + 3 }, { x: A.handR[0], y: A.handR[1] + 3 }] });
  for (let i = 0; i < 3; i++) {
    const a = (f / 24) * TAU + (i * TAU) / 3, x = A.cx + Math.cos(a) * 8, y = A.top.y - 1 + Math.sin(a) * 2.2;
    g.stamp((l) => l.px(x, y - 1, "#FFD23F").px(x, y + 1, "#FFD23F").px(x - 1, y, "#FFD23F").px(x + 1, y, "#FFD23F").px(x, y, "#FFFFFF"), "#4A3100");
  }
});

const books = {
  w: 16, h: 20, box: [1, 3, 14, 17],
  draw(g) {
    const cols = [["#C8453B", 14, 1], ["#2F80E6", 12, 2], ["#FFB400", 13, 1], ["#1FA36A", 11, 3], ["#8E5CFF", 12, 2]];
    g.stamp((l) => cols.forEach(([c, w, dx], i) => {
      const y = 16 - i * 3;
      l.rect(dx, y, w, 3, c).rect(dx + w - 1, y + 1, 1, 1, "#FFF6DF").rect(dx, y, w, 1, mix(c, "#FFFFFF", 0.3)).rect(dx + 2, y + 1, 3, 1, "#FFD23F");
    }), "#1A1A22");
  }
};
const bookend = {
  w: 14, h: 30, box: [1, 2, 12, 28],
  draw(g) {
    g.stamp((l) => {
      l.rect(2, 3, 5, 25, "#B0203A").rect(2, 3, 5, 1, "#E0584E").rect(3, 6, 3, 1, "#FFD23F").rect(3, 22, 3, 1, "#FFD23F");
      l.rect(7, 7, 4, 21, "#35A6A0").rect(7, 7, 4, 1, "#6FDCC7").rect(8, 10, 2, 1, "#FFFFFF");
      l.rect(11, 12, 2, 16, "#8C97A6").rect(1, 27, 12, 2, "#8C97A6").rect(1, 27, 12, 1, "#DDE3EC");
    }, "#14161C");
  }
};
const bat = {
  w: 20, h: 14, frames: 8, box: [5, 4, 10, 7],
  draw(g, f) {
    const up = Math.floor(f / 2) % 4 < 2;
    g.stamp((l) => {
      l.ell(10, 7, 3.4, 3, "#4A3A6B").px(8, 3, "#4A3A6B").px(12, 3, "#4A3A6B");
      for (const s of [-1, 1]) {
        if (up) { l.line(10 + s * 3, 6, 10 + s * 9, 2, "#5A4A80"); l.line(10 + s * 3, 7, 10 + s * 8, 5, "#5A4A80"); l.px(10 + s * 7, 3, "#5A4A80").px(10 + s * 6, 4, "#5A4A80").px(10 + s * 5, 5, "#5A4A80"); }
        else { l.line(10 + s * 3, 7, 10 + s * 9, 11, "#5A4A80"); l.line(10 + s * 3, 8, 10 + s * 7, 12, "#5A4A80"); l.px(10 + s * 6, 9, "#5A4A80").px(10 + s * 5, 9, "#5A4A80"); }
      }
      l.px(9, 6, "#FFE36B").px(11, 6, "#FFE36B").px(10, 9, "#FFFFFF");
    }, "#140E24");
  }
};
const page = {
  w: 16, h: 12, frames: 8, box: [2, 2, 12, 8],
  draw(g, f) {
    const k = Math.floor(f / 2) % 4, bend = [0, 1, 2, 1][k];
    g.stamp((l) => {
      for (let x = 2; x < 14; x++) {
        const dy = Math.round(Math.sin((x / 12) * Math.PI) * bend * (x > 7 ? 1 : -1) * 0.8);
        l.rect(x, 3 + dy, 1, 7, x % 2 ? "#FFF6DF" : "#F6E9C8");
        if (x > 3 && x < 12) { l.px(x, 5 + dy, "#B3A383"); if (x < 10) l.px(x, 7 + dy, "#B3A383"); }
      }
    }, "#5A4A36");
  }
};
const dashGround = {
  w: 32, h: 12,
  draw(g) {
    for (let x = 0; x < 32; x++) {
      g.px(x, 0, "#8FD46A").px(x, 1, x % 5 === 2 ? "#8FD46A" : "#5FB84A").px(x, 2, "#3F8A4E");
      for (let y = 3; y < 12; y++) g.px(x, y, rnd(x * 13 + y * 7) > 0.88 ? "#6B4226" : (x + y) % 7 === 0 ? "#A06A40" : "#8A5A34");
    }
    g.px(6, 0, "#FFE066").px(21, 0, "#FFFFFF");
  }
};
const dashSky = {
  w: 240, h: 120,
  draw(g, f) {
    sky(g, "#7CC8FF", "#DDF2FF", 120);
    g.stamp((l) => l.ell(196, 26, 9, 9, (nx, ny) => (nx + ny < -0.4 ? "#FFF6C2" : "#FFE36B")), "#E0A800");
    void f;
  }
};
const dashHills = {
  w: 240, h: 44, box: null,
  draw(g) {
    for (let x = 0; x < 240; x++) {
      const t = (x / 240) * TAU;
      const far = Math.round(20 + Math.sin(t * 2) * 6 + Math.sin(t * 5 + 1) * 3);
      const near = Math.round(30 + Math.sin(t * 3 + 2) * 5 + Math.sin(t * 7) * 2);
      for (let y = far; y < 44; y++) g.px(x, y, y < near ? "#9CD0A8" : "#6FB47E");
      g.px(x, far, "#B8E0C0");
      g.px(x, near, "#8FC89A");
      if ((x * 7) % 61 === 0) g.rect(x, near - 5, 3, 5, "#4F9A5E").px(x + 1, near - 6, "#4F9A5E");
    }
  }
};
const dashCloud = { w: 40, h: 14, draw(g) { cloud(g, 20, 5, 12); } };

// ============================================================ LEAF CATCH
const BASKET = (g, x, y) => g.stamp((l) => {
  for (let j = 0; j < 6; j++) l.rect(Math.round(x - 8 + j * 0.5), y + j, 16 - j, 1, j === 0 ? "#E8B86B" : (j + Math.floor(x)) % 2 ? "#C88A45" : "#A86A32");
  for (let i = -6; i <= 6; i += 3) l.px(x + i, y + 2, "#8A5424").px(x + i + 1, y + 4, "#8A5424");
  l.line(x - 7, y, x - 4, y - 3, "#A86A32").line(x + 7, y, x + 4, y - 3, "#A86A32").line(x - 4, y - 3, x + 4, y - 3, "#A86A32");
}, "#3A2410");

const catchPose = (id, name, loop, o) => pose(id, name, loop, [5, 6, 22, 8], (g, f) => {
  const step = o.walk ? Math.floor(f / 2) % 2 : 0;
  g.shadow(16, 6);
  let bx = 16, by = 8;
  const A = drawPip(g, Object.assign({
    y: 28 - (o.walk && step ? 1 : 0),
    feet: o.walk ? (A) => [[A.cx - 3.5, A.bottom + 1.1 - (step ? 1 : 0)], [A.cx + 3.5, A.bottom + 1.1 - (step ? 0 : 1)]] : null,
    hands: (A) => { bx = A.top.x; by = Math.round(A.top.y - 6 + (o.hurt ? 1 : 0)); return [{ x: bx - 7, y: by + 3 }, { x: bx + 7, y: by + 3 }]; }
  }, o.pip(f)));
  BASKET(g, bx, by);
  if (o.after) o.after(g, f, A, bx, by);
});
const catchWalk = catchPose("catch-walk", "Catch: Walk", 4, { walk: true, pip: (f) => ({ eyes: "open", mouth: "smile", look: [0, -1], la: 28 + wave(f, 4, 6) }) });
const catchIdle = catchPose("catch-idle", "Catch: Wait", 48, { pip: (f) => ({ eyes: f % 48 > 44 ? "blink" : "open", mouth: "smile", look: [0, -1], sq: wave(f, 24, 0.03), la: 28 + wave(f, 48, 6) }) });
const catchHappy = catchPose("catch-happy", "Catch: Got It", 8, {
  pip: (f) => ({ eyes: "happy", mouth: "open", blush: "big", sq: f < 3 ? 0.08 : 0, la: 10 }),
  after: (g, f, A, bx, by) => { const t = f / 8; g.stamp((l) => { l.px(bx - 9 - t * 2, by - 3 - t * 3, "#FFD23F"); l.px(bx + 9 + t * 2, by - 4 - t * 3, "#FFD23F"); }, "#4A3100"); }
});
const catchHurt = catchPose("catch-hurt", "Catch: Inked", 12, {
  hurt: true,
  pip: (f) => ({ eyes: "squeeze", mouth: "frown", brows: "sad", x: 16 + (f % 4 < 2 ? -1 : 1), blush: false, la: 90 }),
  after: (g, f, A) => { g.stamp((l) => { l.ell(A.fc + 3, A.ey + 1, 2.4, 2, "#1B1B3A"); l.px(A.fc + 4, A.ey + 4 + (f >> 2), "#1B1B3A"); }, "#0B0B1A"); }
});

const leaf = {
  w: 12, h: 12, frames: 16, box: [2, 2, 8, 8],
  draw(g, f) {
    const a = wave(f, 16, 0.7), c = Math.cos(a), s = Math.sin(a);
    g.stamp((l) => {
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
        const X = x + 0.5 - 6, Y = y + 0.5 - 6, u = X * c + Y * s, v = -X * s + Y * c;
        const taper = 1 - 0.55 * Math.max(0, u / 4.8);
        if ((u / 4.8) ** 2 + (v / (2.6 * taper)) ** 2 > 1) { if (u < -4 && u > -6 && Math.abs(v) < 0.6) l.px(x, y, "#285F36"); continue; }
        l.px(x, y, Math.abs(v) < 0.5 && u < 3 ? "#B9F0B4" : v > 0.6 ? "#1D7646" : "#2FA35E");
      }
    }, "#123A1E");
  }
};
const goldleaf = {
  w: 12, h: 12, frames: 16, box: [2, 2, 8, 8],
  draw(g, f) {
    leaf.draw(g, f);
    for (let i = 0; i < 144; i++) {
      const c = g.C.d[i];
      if (c === "#2FA35E") g.C.d[i] = "#FFD23F"; else if (c === "#1D7646") g.C.d[i] = "#E0A800"; else if (c === "#B9F0B4") g.C.d[i] = "#FFF6C2"; else if (c === "#123A1E") g.C.d[i] = "#4A3100";
    }
    if (f % 16 < 4) g.px(10, 1, "#FFFFFF").px(1, 10, "#FFFFFF");
  }
};
const seed = {
  w: 10, h: 10, frames: 12, box: [2, 2, 6, 6],
  draw(g, f) {
    g.stamp((l) => {
      l.ell(5, 5.5, 3, 3.8, (nx, ny) => (nx + ny < -0.6 ? "#F6D69A" : nx + ny > 0.6 ? "#A86A32" : "#D9A05A"));
      l.px(5, 1, "#4FBF5A").px(6, 1, "#4FBF5A");
    }, "#3A2410");
    if (f % 12 < 3) g.px(7, 3, "#FFFFFF");
  }
};
const letter = {
  w: 11, h: 12, box: [1, 1, 9, 10],
  draw(g, f, o) {
    const tilt = Math.round(wave(f, 16, 0.6));
    g.stamp((l) => { l.rect(1, 1 + tilt, 9, 10, "#FFF6DF").rect(1, 10 + tilt, 9, 1, "#DCC89C"); }, "#5A4A36");
    g.text(String(o.letter || "A").slice(0, 1), 4, 3 + tilt, "#2A2A33", false);
  }
};
const ink = {
  w: 14, h: 14, frames: 12, box: [3, 3, 8, 8],
  draw(g, f) {
    const wob = Math.floor(f / 3) % 2;
    g.stamp((l) => {
      l.ell(7, 7, 4.2 + wob * 0.3, 4 - wob * 0.3, "#1B1B3A");
      for (const [x, y] of [[2, 4], [11, 5], [4, 11], [10, 10], [7, 2]]) l.px(x + (wob && x > 7 ? 1 : 0), y, "#1B1B3A");
      l.px(5, 5, "#5A5A8A").px(6, 5, "#3A3A6A");
      l.px(5, 7, "#FFFFFF").px(8, 7, "#FFFFFF").px(6, 9, "#FF4D6D").px(7, 9, "#FF4D6D");
    }, "#0B0B1A");
  }
};
const splash = {
  w: 16, h: 16, frames: 8,
  draw(g, f) {
    const t = Math.min(1, f / 7), r = 2 + t * 6;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      if (t < 0.9) g.px(8 + Math.cos(a) * r, 8 + Math.sin(a) * r, i % 2 ? "#FFD23F" : "#FFFFFF");
    }
    if (t < 0.4) g.px(8, 8, "#FFFFFF");
  }
};
const catchBg = {
  w: 240, h: 120,
  draw(g, f) {
    sky(g, "#8FD0FF", "#E6F6FF", 96);
    for (const [x, y, w] of [[40, 16, 12], [150, 26, 9], [215, 12, 10]]) cloud(g, x + wave(f, 480, 2), y, w);
    // An old tree on the left dropping its leaves, and the meadow.
    g.stamp((l) => { l.rect(14, 34, 8, 62, "#6B4226").rect(14, 34, 2, 62, "#8A5A34"); l.line(18, 50, 34, 38, "#6B4226"); }, "#2A160A");
    g.stamp((l) => { l.ell(22, 26, 24, 14, (nx, ny) => (ny < -0.3 ? "#6FC456" : "#3F9A4E")); l.ell(40, 34, 12, 7, "#3F9A4E"); }, "#123A1E");
    for (let y = 96; y < 120; y++) for (let x = 0; x < 240; x++) g.px(x, y, y === 96 ? "#8FD46A" : rnd(x * 5 + y * 3) > 0.94 ? "#8FD46A" : (x + y) % 3 ? "#5FB84A" : "#55AD42");
    for (let x = 60; x < 240; x += 37) g.px(x, 97, "#FFE066").px(x + 12, 99, "#FFFFFF");
  }
};

// ============================================================ PAGE FLAP
const flapPose = (id, name, loop, o) => pose(id, name, loop, [9, 10, 15, 15], (g, f) => {
  const A = drawPip(g, Object.assign({
    y: 26, leaf: "spin", lphase: f * (o.spin || 1.6), ll: 1.1, feet: (A) => [[A.cx - 3, A.bottom + 1.6], [A.cx + 3, A.bottom + 1.6]]
  }, o.pip(f)));
  if (o.after) o.after(g, f, A);
});
const flapFly = flapPose("flap-fly", "Flap: Fly", 4, { spin: 1.6, pip: (f) => ({ sq: f % 4 < 2 ? -0.06 : 0.02, eyes: "determined", mouth: "smile", look: [1, 0], fdx: 1, hands: (A) => [{ x: A.handL[0] - 1, y: A.handL[1] - (f % 4 < 2 ? 2 : 0) }, { x: A.handR[0] + 1, y: A.handR[1] - (f % 4 < 2 ? 2 : 0) }] }) });
const flapFall = flapPose("flap-fall", "Flap: Drop", 4, { spin: 0.7, pip: () => ({ sq: 0.05, eyes: "wide", mouth: "o", look: [1, 1], fdx: 1, hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 4 }, { x: A.handR[0] + 1, y: A.cy - 4 }] }) });
const flapBonk = flapPose("flap-bonk", "Flap: Bonk", 16, {
  spin: 0.2,
  pip: (f) => ({ eyes: "spiral", eyePhase: f, mouth: "wavy", sq: f < 3 ? 0.2 : 0.06, blush: false }),
  after: (g, f, A) => { for (let i = 0; i < 3; i++) { const a = (f / 16) * TAU + (i * TAU) / 3; g.stamp((l) => l.px(A.cx + Math.cos(a) * 8, A.top.y + Math.sin(a) * 2, "#FFD23F"), "#4A3100"); } }
});

const SPINES = [["#C8453B", "#8E2F28"], ["#2F80E6", "#1F5FB8"], ["#1FA36A", "#137049"], ["#8E5CFF", "#5E3AB8"], ["#E07A3A", "#A0522D"]];
const pillar = {
  w: 24, h: 60, box: [1, 0, 22, 60],
  draw(g, f, o) {
    const h = o.h, top = !!o.top, [c, d] = SPINES[(o.variant ?? 0) % SPINES.length];
    g.stamp((l) => {
      for (let y = 0; y < h; y++) {
        const yy = top ? h - 1 - y : y; // distance from the open end (the cap)
        const cap = yy < 5;
        const x0 = cap ? 1 : 3, x1 = cap ? 23 : 21;
        for (let x = x0; x < x1; x++) {
          let col = x < x0 + 3 ? mix(c, "#FFFFFF", 0.25) : x > x1 - 4 ? d : c;
          if (cap) col = yy === 0 || yy === 4 ? "#D9A441" : x < x0 + 3 ? "#FFF6DF" : "#F6E9C8";
          else if ((yy - 9) % 22 === 0 || (yy - 11) % 22 === 0) col = "#FFD23F";
          else if ((yy - 16) % 22 < 3 && x > 8 && x < 16) col = "#FFF6DF";
          l.px(x, y, col);
        }
      }
    }, "#1A1A22");
    void f;
  }
};
const flapBg = {
  w: 240, h: 120,
  draw(g, f) {
    sky(g, "#6A4FA8", "#FFB38A", 120);
    g.stamp((l) => l.ell(170, 70, 12, 12, (nx, ny) => (nx + ny < -0.4 ? "#FFF3C2" : "#FFD27A")), "#E0782E");
    for (const [x, y, w] of [[30, 22, 12], [120, 40, 9], [210, 18, 11]]) cloud(g, x + wave(f, 480, 2), y, w);
    // Far shelves: a skyline made of book silhouettes.
    for (let x = 0; x < 240; x++) {
      const h = 14 + Math.floor(rnd(Math.floor(x / 5) * 7) * 18) + (Math.floor(x / 5) % 7 === 0 ? 8 : 0);
      for (let y = 120 - h; y < 120; y++) g.px(x, y, x % 5 === 0 ? "#3A2A5A" : "#4A3A6B");
    }
  }
};
const flapGround = {
  w: 32, h: 10,
  draw(g) {
    for (let x = 0; x < 32; x++) for (let y = 0; y < 10; y++) g.px(x, y, y === 0 ? "#B07A4A" : y === 5 || (x + (y > 5 ? 16 : 0)) % 32 === 0 ? "#5E3A1F" : y < 5 ? "#8A5A34" : "#7A4C2C");
  }
};
const coin = {
  w: 10, h: 10, frames: 8, box: [1, 1, 8, 8],
  draw(g, f) {
    const w = [4, 3, 1.4, 3][Math.floor(f / 2) % 4];
    g.stamp((l) => l.ell(5, 5, w, 4, (nx, ny) => (nx + ny < -0.5 ? "#FFF6C2" : nx + ny > 0.6 ? "#E0A800" : "#FFD23F")), "#4A3100");
    if (w > 2) g.px(5, 4, "#4FBF5A").px(5, 5, "#2FA35E");
  }
};

export const GAME_SPRITES = {
  dash: {
    title: "Pip Dash",
    pip: { run: dashRun, jump: dashJump, duck: dashDuck, over: dashOver },
    obstacles: { books, bookend, bat, page },
    ground: dashGround, sky: dashSky, hills: dashHills, cloud: dashCloud, seed: coin
  },
  catch: {
    title: "Leaf Catch",
    pip: { walk: catchWalk, idle: catchIdle, happy: catchHappy, hurt: catchHurt },
    items: { leaf, goldleaf, seed, letter, ink },
    splash, bg: catchBg
  },
  flap: {
    title: "Page Flap",
    pip: { fly: flapFly, fall: flapFall, bonk: flapBonk },
    pillar, bg: flapBg, ground: flapGround, seed: coin, cloud: dashCloud
  }
};

/** All the Pip poses, for a move picker or a sprite cache. */
export const GAME_POSES = [dashRun, dashJump, dashDuck, dashOver, catchWalk, catchIdle, catchHappy, catchHurt, flapFly, flapFall, flapBonk];
