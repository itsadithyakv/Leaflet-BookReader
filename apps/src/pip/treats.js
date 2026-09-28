/* Food and toys for Pip. Each treat has its own move (registered through
 `def`), which is what plays when Pip is fed or given the toy:
   { id, name, kind: "food" | "toy", price, move, mood }
 `mood` is how much it cheers Pip up (0..100 scale).

 Foods share one timeline (the treat drops in, three bites with crumbs, a
 happy finish); drinks are sipped and bowls slurped. Every toy has its own
 little routine. Each move is a pure function of the frame, 12 fps. */
import { drawPip } from "./engine.js";
import { def, fx, kit } from "./anims.js";

const { TAU, wave, lerp, clamp, eo, ei, eio, hop, tl, GOLD, WHITE, PINK } = kit;

// ------------------------------------------------------------ helpers
/** A painter that skips pixels inside `hole(x, y)`: how bites are taken out. */
function masked(l, hole) {
  const m = {
    px(x, y, c) { x = Math.round(x); y = Math.round(y); if (!hole(x, y)) l.px(x, y, c); return m; },
    rect(x, y, w, h, c) { x = Math.round(x); y = Math.round(y); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) m.px(x + i, y + j, c); return m; },
    ell(cx, cy, rx, ry, c) {
      for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        const col = typeof c === "function" ? c(nx, ny, x, y) : c;
        if (col) m.px(x, y, col);
      }
      return m;
    },
    line(x0, y0, x1, y1, c) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) m.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
      return m;
    }
  };
  return m;
}

/** Where the bites go: a row of round notches eaten in from the mouth side (left). */
const biteHoles = (x, y, w, h, bites, from) => (px, py) => {
  for (let i = 1; i <= bites; i++) {
    let bx, by;
    if (from === "top") { bx = x + w * (i % 2 ? 0.3 : 0.7); by = y - 0.6 + (i - 1) * (h / 3.2); }
    else { bx = x - 0.6 + (i - 1) * (w / 3.1); by = y + h * 0.5 + (i % 2 ? -0.8 : 0.8); }
    const r = Math.max(w, h) / 3.6 + 0.5;
    if ((px + 0.5 - bx) ** 2 + (py + 0.5 - by) ** 2 < r * r) return true;
  }
  return false;
};

// ------------------------------------------------------------ food sprites
// Each draws at top-left (x, y) into `l` (a stamp layer, possibly masked).
const FOODS = {
  apple: {
    w: 7, h: 7, crumb: "#FFF3D6", out: "#4A0A10",
    draw(l, x, y) {
      l.ell(x + 3.5, y + 4, 3.4, 3.1, (nx, ny) => (nx + ny < -0.7 ? "#FF8A8A" : nx + ny > 0.7 ? "#A8182C" : "#E0262E"));
      l.px(x + 2, y + 2, WHITE).rect(x + 3, y, 1, 2, "#6B3A1E").rect(x + 4, y, 2, 1, "#4FBF5A");
    }
  },
  cookie: {
    w: 7, h: 7, crumb: "#C88A45", out: "#4A2A0A",
    draw(l, x, y) {
      l.ell(x + 3.5, y + 3.5, 3.4, 3.4, (nx, ny) => (nx + ny < -0.7 ? "#F2C27A" : nx + ny > 0.7 ? "#B8783A" : "#E0A55A"));
      for (const [dx, dy] of [[2, 2], [5, 3], [3, 5], [5, 5], [1, 4]]) l.px(x + dx, y + dy, "#4A2A14");
    }
  },
  donut: {
    w: 8, h: 7, crumb: "#FF9ACB", out: "#4A1A0A",
    draw(l, x, y) {
      l.ell(x + 4, y + 3.5, 3.9, 3.3, (nx, ny) => {
        const d = nx * nx + ny * ny;
        if (d < 0.12) return null;
        return ny < 0.25 && d < 0.85 ? (nx + ny < -0.6 ? "#FFC2E0" : "#FF7FB8") : "#D99A4A";
      });
      l.px(x + 2, y + 2, "#FFE066").px(x + 5, y + 2, "#7FE0FF").px(x + 6, y + 4, "#FFFFFF").px(x + 1, y + 4, "#7CFF6B");
    }
  },
  pizza: {
    w: 8, h: 7, crumb: "#FFD24A", out: "#4A1A0A",
    draw(l, x, y) {
      for (let j = 0; j < 7; j++) {
        const w = Math.max(1, Math.round(1 + (j / 6) * 7));
        l.rect(x + 8 - w, y + j - 0, w - (j === 6 ? 0 : 1), 1, "#FFD24A");
      }
      // Slice tip to the left: redraw as a wedge pointing at the mouth.
    }
  },
  cupcake: {
    w: 7, h: 8, crumb: "#FF9ACB", out: "#3A0A24", from: "top",
    draw(l, x, y) {
      for (let j = 0; j < 3; j++) l.rect(x + 1 + (j > 1 ? 1 : 0), y + 5 + j, 5 - (j > 1 ? 2 : 0), 1, j % 2 ? "#3AA0FF" : "#7FC6FF");
      l.px(x + 2, y + 5, "#2F80E6").px(x + 4, y + 6, "#2F80E6");
      l.ell(x + 3.5, y + 3.6, 3.4, 2, (nx, ny) => (nx + ny < -0.5 ? "#FFD1E6" : "#FF8FC0"));
      l.ell(x + 3.5, y + 2, 2, 1.4, "#FF8FC0").px(x + 3, y + 1, "#FFD1E6");
      l.px(x + 3, y, "#E0262E").px(x + 4, y, "#E0262E");
    }
  },
  icecream: {
    w: 7, h: 11, crumb: "#FFB3D1", out: "#3A1A0A", from: "top",
    draw(l, x, y) {
      for (let j = 0; j < 5; j++) {
        const w = Math.max(1, 5 - j);
        l.rect(x + 1 + Math.floor((5 - w) / 2), y + 6 + j, w, 1, (j + x) % 2 ? "#D99A4A" : "#E8B86B");
      }
      l.ell(x + 3.5, y + 5, 3.3, 1.9, (nx, ny) => (nx + ny < -0.5 ? "#D9FFF0" : "#7FE0B8"));
      l.ell(x + 3.5, y + 2.4, 2.8, 2.3, (nx, ny) => (nx + ny < -0.5 ? "#FFE0EC" : "#FF9AC0"));
      l.px(x + 3, y, "#E0262E");
    }
  },
  sushi: {
    w: 7, h: 7, crumb: "#FFFFFF", out: "#0E1A12",
    draw(l, x, y) {
      l.ell(x + 3.5, y + 3.5, 3.5, 3.5, (nx, ny) => {
        const d = nx * nx + ny * ny;
        if (d > 0.7) return "#1F3A2A";
        if (d > 0.16) return nx + ny < -0.4 ? "#FFFFFF" : "#ECECE2";
        return nx < 0 ? "#FF8A5A" : "#6FCF5A";
      });
    }
  },
  cake: {
    w: 8, h: 8, crumb: "#F2D29A", out: "#3A1A0A",
    draw(l, x, y) {
      l.rect(x, y + 2, 8, 6, "#F2D29A");
      l.rect(x, y + 4, 8, 1, "#FF7FB8").rect(x, y + 6, 8, 1, "#FF7FB8");
      l.rect(x, y + 1, 8, 2, "#FFFFFF").px(x + 1, y + 3, "#FFFFFF").px(x + 5, y + 3, "#FFFFFF");
      l.ell(x + 5.5, y + 0.5, 1.6, 1.4, "#E0262E").px(x + 5, y - 1, "#4FBF5A");
    }
  },
  watermelon: {
    w: 9, h: 6, crumb: "#FF6B7A", out: "#1A3A12",
    draw(l, x, y) {
      l.ell(x + 4.5, y, 4.4, 5.6, (nx, ny) => {
        if (ny < 0) return null;
        const d = nx * nx + ny * ny;
        return d > 0.8 ? "#2E8B3C" : d > 0.65 ? "#DFF5C8" : "#FF4D5E";
      });
      for (const [dx, dy] of [[2, 1], [4, 2], [6, 1], [4, 0]]) l.px(x + dx, y + dy, "#1A1A22");
    }
  }
};
// The pizza slice: a proper wedge with its tip to the left (towards the mouth).
FOODS.pizza.draw = (l, x, y) => {
  for (let i = 0; i < 8; i++) {
    const half = (i / 7) * 3.2;
    for (let j = Math.round(3 - half); j <= Math.round(3 + half); j++) l.px(x + i, y + j, i >= 7 ? "#D99A4A" : "#FFD24A");
  }
  l.px(x + 4, y + 2, "#E0393E").px(x + 5, y + 4, "#E0393E").px(x + 6, y + 2, "#E0393E").px(x + 3, y + 3, "#FFF3B0");
};

const DRINKS = {
  tea: {
    w: 7, h: 5, out: "#3A2A1E", liquid: "#C79A4A",
    draw(l, x, y, level) {
      l.rect(x, y, 5, 4, WHITE).rect(x + 5, y + 1, 1, 2, WHITE).px(x + 6, y + 1, WHITE).px(x + 6, y + 2, WHITE);
      l.rect(x, y + 1, 1, 3, "#E6E0D2");
      if (level > 0.05) l.rect(x + 1, y, 3, 1, "#C79A4A");
      l.px(x + 2, y + 2, "#7FC6FF").px(x + 3, y + 2, "#7FC6FF");
      l.rect(x - 1, y + 4, 7, 1, "#E6E0D2");
    }
  },
  cocoa: {
    w: 7, h: 6, out: "#2A160A", liquid: "#7A4A22",
    draw(l, x, y, level) {
      l.rect(x, y + 1, 5, 5, "#E0393E").rect(x + 5, y + 2, 1, 2, "#E0393E").px(x + 6, y + 2, "#E0393E").px(x + 6, y + 3, "#E0393E");
      l.rect(x, y + 2, 1, 4, "#FF7A7A").rect(x + 1, y + 3, 3, 1, WHITE);
      if (level > 0.05) l.rect(x + 1, y + 1, 3, 1, "#7A4A22");
      if (level > 0.35) l.px(x + 1, y, WHITE).px(x + 3, y, WHITE).px(x + 2, y, "#FFE0EC");
    }
  }
};

// ------------------------------------------------------------ eating move
function eatMove(id, name, food, when) {
  def("treat-" + id, name, "Treats", 44, when, (g, f) => {
    const s = tl(f, [8, 24, 12]);
    g.shadow(15, 6);
    let bites = 0, fxp = 0, fyp = 0, o;
    const H = (A) => [A.fc + 5, A.ey + 2 - Math.round(food.h / 3)];
    const M = (A) => [A.fc + 2, A.ey + 3 - Math.floor(food.h / 2)];
    if (s.k === 0) {
      const t = s.t;
      o = { eyes: t > 0.7 ? "star" : "wide", mouth: "open", look: [1, -1], fdx: 1, la: 0, brows: "up" };
      o.hands = (A) => {
        const [hx, hy] = H(A);
        fxp = hx; fyp = lerp(-food.h - 2, hy, ei(t));
        if (t > 0.85) fyp = hy - 1;
        return [{ x: A.handL[0], y: A.handL[1] }, { x: hx + food.w / 2, y: lerp(A.handR[1], hy + food.h, clamp(t * 1.4)) }];
      };
    } else if (s.k === 1) {
      const n = s.n % 8, bi = Math.floor(s.n / 8);
      bites = bi + (n >= 3 ? 1 : 0);
      const reach = n < 3 ? eo(n / 2.5) : n < 5 ? 1 - (n - 3) / 2 : 0;
      o = {
        x: 15, eyes: n < 3 ? "open" : "happy", look: [1, 0], fdx: n < 3 ? 1 : 0,
        mouth: n < 3 ? "open" : n === 3 ? "flat" : n % 2 ? "o" : "flat", mouthDx: 0,
        sq: n === 3 ? 0.07 : n > 3 ? wave(n, 2, 0.02) : 0, blush: "big", la: 20 + wave(s.n, 8, 10)
      };
      o.hands = (A) => {
        const [hx, hy] = H(A), [mx, my] = M(A);
        fxp = lerp(hx, mx, reach); fyp = lerp(hy, my, reach);
        return [{ x: A.handL[0], y: A.handL[1] }, { x: fxp + food.w / 2 + 1, y: fyp + food.h }];
      };
    } else {
      bites = 3;
      const t = s.t;
      o = {
        y: 28 + (t < 0.4 ? hop(t / 0.4, 3) : 0), sq: t < 0.4 ? -0.06 : 0.04 * (1 - t),
        eyes: "happy", mouth: t < 0.6 ? "open" : "blep", blush: "big", la: 28 + wave(s.n, 6, 14),
        hands: (A) => [{ x: A.handL[0] - 1, y: A.cy - 4 + (t > 0.5 ? 4 : 0) }, { x: A.handR[0] + 1, y: A.cy - 4 + (t > 0.5 ? 4 : 0) }]
      };
    }
    const A = drawPip(g, o);
    if (bites < 3) {
      const x = Math.round(fxp), y = Math.round(fyp);
      const hole = biteHoles(x, y, food.w, food.h, bites, food.from);
      g.stamp((l) => food.draw(bites ? masked(l, hole) : l, x, y), food.out);
      if (s.k === 0 && s.t > 0.7) fx.twinkle(g, x + food.w + 1, y - 1, (s.t - 0.7) / 0.3, WHITE);
    }
    // Crumbs after each bite.
    if (s.k >= 1) {
      for (let b = 0; b < 3; b++) {
        const age = f - (8 + b * 8 + 3);
        if (age < 0 || age > 9) continue;
        for (let i = 0; i < 3; i++) {
          const cx = A.fc + 1 + i * 1.5 + age * (i - 1) * 0.3, cy = A.ey + 4 + age * 0.7 + i * 0.5 + ei(age / 9) * 3;
          g.px(Math.round(cx), Math.round(cy), food.crumb);
        }
      }
    }
    if (s.k === 2) {
      const t = s.t;
      fx.heart(g, A.cx - 7, A.top.y - 1 - t * 5, false);
      if (t > 0.3) fx.heart(g, A.cx + 7, A.top.y + 1 - (t - 0.3) * 6, t > 0.6);
      if (t < 0.5) fx.twinkle(g, A.cx + 10, A.top.y + 4, t * 2, GOLD);
    }
  }, 20);
}

// Sipping: the cup goes to the mouth and the level drops; then a happy "ahh".
function sipMove(id, name, drink, when) {
  def("treat-" + id, name, "Treats", 44, when, (g, f) => {
    const s = tl(f, [8, 22, 14]);
    g.shadow(15, 6);
    let cx = 0, cy = 0, level = 1, o;
    if (s.k === 0) {
      const t = s.t;
      o = { eyes: t > 0.7 ? "star" : "wide", mouth: "o", look: [1, 0], fdx: 1, la: 10 };
      o.hands = (A) => { cx = A.fc + 5; cy = lerp(-8, A.ey + 3, eo(t)); return [{ x: A.handL[0], y: A.handL[1] }, { x: cx + 3, y: Math.max(A.handR[1] - 3, cy + drink.h) }]; };
    } else if (s.k === 1) {
      const t = s.t;
      level = 1 - eio(t);
      o = { eyes: "closed", mouth: "o", blush: "big", la: 40 + wave(s.n, 11, 6), sq: wave(s.n, 11, 0.02) };
      o.hands = (A) => { cx = A.fc + 1; cy = A.ey + 1; return [{ x: A.fc - 3, y: A.ey + 6 }, { x: cx + 4, y: cy + drink.h }]; };
    } else {
      const t = s.t;
      level = 0;
      o = { eyes: "happy", mouth: t < 0.5 ? "open" : "smile", blush: "big", la: lerp(40, -10, eo(clamp(t * 2))), sq: t < 0.2 ? 0.08 : 0 };
      o.hands = (A) => { cx = A.fc + 5; cy = A.ey + 4; return [{ x: A.handL[0], y: A.handL[1] }, { x: cx + 3, y: cy + drink.h }]; };
    }
    const A = drawPip(g, o);
    g.stamp((l) => drink.draw(l, Math.round(cx), Math.round(cy), level), drink.out);
    if (s.k !== 1) for (let k = 0; k < 2; k++) {
      const t = ((f + k * 6) % 12) / 12;
      if (t < 0.8) g.px(Math.round(cx + 1 + k * 2 + Math.sin((f + k * 5) * 0.8)), Math.round(cy - 1 - t * 5), "#FFFFFFcc");
    }
    if (s.k === 1 && s.n % 11 === 6) fx.drop(g, A.fc - 6, A.ey - 4, "#FFFFFF");
    if (s.k === 2) {
      const t = s.t;
      fx.heart(g, A.cx - 8, A.top.y + 2 - t * 6, t > 0.4);
      if (t < 0.6) { g.px(A.fc - 2, A.ey + 6 + Math.round(t * 4), "#FFFFFFaa"); fx.puff(g, A.fc - 5 - t * 4, A.ey + 3 - t * 3, 1 + t, "#FFFFFF"); }
    }
  }, 20);
}

// Slurping noodles: a bowl held low, a noodle strand wriggling up into the mouth.
function slurpMove(id, name, when) {
  def("treat-" + id, name, "Treats", 44, when, (g, f) => {
    const s = tl(f, [8, 24, 12]);
    g.shadow(15, 6);
    let bx = 0, by = 0, level = 1, o;
    if (s.k === 0) {
      const t = s.t;
      o = { eyes: t > 0.7 ? "star" : "wide", mouth: "open", look: [1, 1], fdx: t < 0.7 ? 1 : 0, la: 0, brows: "up" };
      o.hands = (A) => { bx = lerp(30, A.fc - 4, eo(t)); by = A.ey + 6 - Math.round(Math.sin(t * Math.PI) * 3); return [{ x: A.handL[0], y: A.handL[1] }, { x: bx + 9, y: by + 3 }]; };
    } else if (s.k === 1) {
      level = 1 - s.t * 0.95;
      o = { eyes: "closed", mouth: "o", blush: "big", la: 30 + wave(s.n, 8, 12), sq: wave(s.n, 4, 0.03) };
      o.hands = (A) => { bx = A.fc - 4; by = A.ey + 6; return [{ x: bx - 1, y: by + 3 }, { x: bx + 9, y: by + 3 }]; };
    } else {
      level = 0.05;
      const t = s.t;
      o = { eyes: "happy", mouth: t < 0.5 ? "open" : "blep", blush: "big", la: 28 + wave(s.n, 6, 14) };
      o.hands = (A) => { bx = A.fc - 4; by = A.ey + 7; return [{ x: bx - 1, y: by + 3 }, { x: bx + 9, y: by + 3 }]; };
    }
    const A = drawPip(g, o);
    const x = Math.round(bx), y = Math.round(by);
    if (s.k === 1) {
      const n = s.n % 8, top = A.ey + 3;
      for (let yy = top; yy < y + 1; yy++) {
        const wob = Math.round(Math.sin(yy * 1.3 + f * 1.2) * (n < 5 ? 0.8 : 0.3));
        g.px(A.fc - 1 + wob, yy, "#F6E08A").px(A.fc + wob, yy, "#E8C860");
      }
      if (n === 5) { g.px(A.fc - 4, A.ey + 5, "#C8864A").px(A.fc + 3, A.ey + 4, "#C8864A"); }
    }
    g.stamp((l) => {
      l.rect(x, y, 10, 2, level > 0.3 ? "#F6E08A" : "#C8864A");
      if (level > 0.3) { l.px(x + 2, y, "#E8C860").px(x + 5, y, "#E8C860").px(x + 7, y, "#FF8FA3").px(x + 6, y, "#FFFFFF"); if (level > 0.6) l.px(x + 3, y - 1, "#4FBF5A").px(x + 4, y - 1, "#F6E08A"); }
      l.rect(x, y + 2, 10, 2, "#E0393E").rect(x + 1, y + 4, 8, 1, "#C0262E").rect(x + 2, y + 5, 6, 1, "#A81E2A");
      l.px(x + 2, y + 3, WHITE).px(x + 6, y + 3, WHITE);
    }, "#3A0A10");
    if (s.k === 2) fx.heart(g, A.cx + 8, A.top.y + 2 - s.t * 6, s.t > 0.4);
  }, 20);
}

// ============================================================ FOODS
const food = [
  { id: "apple", name: "Crunchy Apple", price: 10, mood: 5, make: () => eatMove("apple", "Crunchy Apple", FOODS.apple, "You feed Pip an apple: three crunchy bites.") },
  { id: "cookie", name: "Choc-Chip Cookie", price: 15, mood: 8, make: () => eatMove("cookie", "Choc-Chip Cookie", FOODS.cookie, "You feed Pip a cookie. Crumbs everywhere.") },
  { id: "watermelon", name: "Watermelon Slice", price: 20, mood: 10, make: () => eatMove("watermelon", "Watermelon Slice", FOODS.watermelon, "You feed Pip a slice of watermelon.") },
  { id: "tea", name: "Cup of Tea", price: 20, mood: 10, make: () => sipMove("tea", "Cup of Tea", DRINKS.tea, "You make Pip a cup of tea: a long sip and a happy sigh.") },
  { id: "donut", name: "Sprinkle Donut", price: 25, mood: 12, make: () => eatMove("donut", "Sprinkle Donut", FOODS.donut, "You feed Pip a pink sprinkle donut.") },
  { id: "cocoa", name: "Hot Cocoa", price: 30, mood: 14, make: () => sipMove("cocoa", "Hot Cocoa", DRINKS.cocoa, "You make Pip hot cocoa with marshmallows.") },
  { id: "cupcake", name: "Cupcake", price: 30, mood: 14, make: () => eatMove("cupcake", "Cupcake", FOODS.cupcake, "You feed Pip a cupcake with a cherry on top.") },
  { id: "pizza", name: "Pizza Slice", price: 35, mood: 15, make: () => eatMove("pizza", "Pizza Slice", FOODS.pizza, "You feed Pip a slice of pizza, tip first.") },
  { id: "icecream", name: "Ice Cream Cone", price: 40, mood: 18, make: () => eatMove("icecream", "Ice Cream Cone", FOODS.icecream, "You give Pip a double-scoop ice cream.") },
  { id: "noodles", name: "Bowl of Noodles", price: 50, mood: 20, make: () => slurpMove("noodles", "Bowl of Noodles", "You give Pip a bowl of noodles to slurp.") },
  { id: "sushi", name: "Salmon Sushi", price: 60, mood: 22, make: () => eatMove("sushi", "Salmon Sushi", FOODS.sushi, "You treat Pip to salmon sushi.") },
  { id: "cake", name: "Strawberry Cake", price: 80, mood: 30, make: () => eatMove("cake", "Strawberry Cake", FOODS.cake, "You treat Pip to a slice of strawberry cake.") }
];

// ============================================================ TOYS
const ball = (g, x, y, f, r = 2.8) => {
  const rot = f * 0.5;
  g.stamp((l) => l.ell(x, y, r, r, (nx, ny) => {
    if (nx + ny < -0.9) return WHITE;
    const a = Math.atan2(ny, nx) + rot, seg = ((Math.floor(((a % TAU) + TAU) % TAU / (TAU / 4))) % 4);
    return ["#E0393E", "#FFFFFF", "#2F80E6", "#FFD23F"][seg];
  }), "#1A1A22");
};

def("treat-ball", "Bouncy Ball", "Treats", 48, "You give Pip a ball: two headers and a catch.", (g, f) => {
  const s = tl(f, [10, 10, 10, 18]);
  g.shadow(16, 6);
  let o, bx = 16, by = 0;
  const top = (A) => A.top.y - 3;
  if (s.k === 0) o = { look: [0, -2], eyes: "wide", mouth: "o", la: 0 };
  else if (s.k === 1 || s.k === 2) {
    const hit = s.n < 2;
    o = { look: [0, -2], eyes: hit ? "squeeze" : "wide", mouth: hit ? "flat" : "open", sq: hit ? 0.14 : 0, la: hit ? 60 : 10, blush: s.k === 2 ? "big" : true };
  } else o = { eyes: "happy", mouth: "open", blush: "big", la: 28 + wave(s.n, 6, 14), y: 28 + (s.t < 0.35 ? hop(s.t / 0.35, 3) : 0) };
  o.hands = (A) => {
    const T = top(A);
    if (s.k === 0) { bx = A.cx; by = lerp(-4, T, ei(s.t)); }
    else if (s.k === 1) { bx = A.cx; by = T - hop(s.t, -9); }
    else if (s.k === 2) { bx = lerp(A.cx, A.cx + 1, s.t); by = s.t < 0.5 ? T - hop(s.t * 2, -7) : T; if (s.t >= 0.5) { const u = (s.t - 0.5) * 2; bx = lerp(A.cx, A.cx, u); by = lerp(T, A.cy + 3, eio(u)) - hop(u, 4); } }
    else { bx = A.cx; by = A.cy + 3 - (s.t > 0.35 ? 0 : hop(s.t / 0.35, 3)); }
    if (s.k >= 3 || (s.k === 2 && s.t > 0.8)) return [{ x: bx - 3.5, y: by + 1 }, { x: bx + 3.5, y: by + 1 }];
    return null;
  };
  const A = drawPip(g, o);
  ball(g, bx, by, f);
  if ((s.k === 1 || s.k === 2) && s.n < 3) fx.impact(g, A.cx, top(A) + 1);
  if (s.k === 3) { fx.twinkle(g, A.cx - 9, A.top.y + 1, s.t, GOLD); fx.twinkle(g, A.cx + 9, A.top.y + 3, clamp(s.t * 1.3), GOLD); }
}, 40);

def("treat-yoyo", "Yo-yo", "Treats", 48, "You give Pip a yo-yo: three throws and a flashy catch.", (g, f) => {
  const s = tl(f, [14, 14, 14, 6]);
  g.shadow(15, 6);
  let hx = 0, hy = 0, yy = 0;
  const t = s.k < 3 ? s.t : 0;
  const drop = s.k < 3 ? (t < 0.5 ? eo(t * 2) : 1 - ei((t - 0.5) * 2)) : 0;
  const A = drawPip(g, {
    x: 14, eyes: s.k === 3 ? "star" : drop > 0.8 ? "wide" : "open", mouth: s.k === 3 ? "open" : drop > 0.5 ? "o" : "smile",
    look: [1, Math.round(drop * 2)], fdx: 1, blush: s.k === 3 ? "big" : true, la: 28 + wave(f, 14, 8),
    hands: (A) => { hx = A.handR[0] + 1; hy = A.cy - 6 - (drop < 0.15 ? 1 : 0); yy = lerp(hy + 3, 28, drop); return [{ x: A.handL[0], y: A.handL[1] }, { x: hx, y: hy }]; }
  });
  const x = Math.round(hx + 2);
  g.line(hx + 1, hy, x, yy - 2, "#A89878");
  const spin = f % 2;
  g.stamp((l) => l.ell(x, yy, 2.2, 2.2, (nx, ny) => (Math.abs(nx) < 0.2 ? WHITE : (spin ? nx > 0 : nx < 0) ? "#E0393E" : "#A81E2A")), "#3A0A10");
  if (drop > 0.3 && drop < 0.95) { g.px(x - 3, yy - 1, "#FFFFFF88").px(x + 3, yy + 1, "#FFFFFF88"); }
  if (s.k === 3) { fx.star(g, A.cx + 9, A.top.y, 1, GOLD); fx.star(g, A.cx - 8, A.top.y + 3, s.n % 3 ? 1 : 2, GOLD); }
  void A;
}, 20);

def("treat-kite", "Kite", "Treats", 48, "You give Pip a kite: it catches the wind and flies.", (g, f) => {
  const s = tl(f, [16, 32]);
  g.shadow(13, 6);
  let hx = 0, hy = 0;
  const up = s.k === 0 ? eo(s.t) : 1;
  const A = drawPip(g, {
    x: 12, eyes: s.k === 0 ? "wide" : "happy", mouth: s.k === 0 ? "o" : "open", look: [1, -1], fdx: 1, blush: "big",
    la: 60 + wave(f, 8, 12), ll: 1 + wave(f, 8, 0.06),
    hands: (A) => { hx = A.handR[0] + 1; hy = A.cy - 4 - (s.k === 1 ? wave(s.n, 16, 1) : 0); return [{ x: A.handL[0], y: A.handL[1] - (s.k === 1 ? 3 : 0) }, { x: hx, y: hy }]; }
  });
  const kx = lerp(hx + 2, 25 + wave(f, 24, 1.5), up), ky = lerp(hy - 3, 6 + wave(f, 16, 1.2), up);
  // String with a little sag.
  for (let i = 0; i <= 14; i++) {
    const u = i / 14, x = lerp(hx, kx, u), y = lerp(hy, ky + 4, u) + Math.sin(u * Math.PI) * 2 * up;
    g.px(Math.round(x), Math.round(y), "#F4F1E8");
  }
  // Tail bows.
  for (let i = 1; i <= 4; i++) {
    const x = kx - i * 1.4 + Math.sin(f * 0.6 + i) * 1.2, y = ky + 5 + i * 1.8;
    g.stamp((l) => l.px(x, y, i % 2 ? "#FFD23F" : "#E0393E"), "#3A1A0A");
  }
  const x = Math.round(kx), y = Math.round(ky);
  g.stamp((l) => {
    for (let j = 0; j < 9; j++) {
      const w = j < 4 ? 1 + j * 2 : 1 + (8 - j) * 1.5;
      const x0 = Math.round(x - (w - 1) / 2);
      for (let i = 0; i < w; i++) l.px(x0 + i, y - 4 + j, (x0 + i < x) === (j < 4) ? "#E0393E" : "#3AA0FF");
    }
    l.line(x, y - 4, x, y + 4, "#FFFFFF").line(x - 3, y - 1, x + 3, y - 1, "#FFFFFF");
  }, "#1A1A22");
  if (s.k === 1 && s.n % 16 < 8) fx.speed(g, 2, 8 + (s.n % 4), 4);
  void A;
}, 24);

def("treat-duck", "Rubber Duck", "Treats", 36, "You give Pip a rubber duck. Squeak!", (g, f) => {
  const s = tl(f, [8, 10, 10, 8]);
  g.shadow(16, 6);
  let dx = 0, dy = 0, sq = 0;
  const squeeze = s.k === 1 || s.k === 2 ? (s.n < 3 ? Math.sin((s.n / 3) * Math.PI) : 0) : 0;
  const o = {
    eyes: s.k === 0 ? "wide" : s.k === 3 ? "happy" : squeeze > 0.3 ? "squeeze" : "happy",
    mouth: s.k === 0 ? "o" : s.k === 2 && s.n >= 3 ? "open" : squeeze > 0.3 ? "grin" : "smile",
    blush: s.k >= 2 ? "big" : true, la: 28 + (squeeze > 0.3 ? -30 : 0) + wave(f, 12, 6), sq: squeeze * 0.06,
    y: 28 + (s.k === 2 && s.n >= 3 ? hop(clamp((s.n - 3) / 6), 2) : 0),
    hands: (A) => {
      dx = A.cx; dy = A.cy + 3;
      sq = squeeze;
      const inn = squeeze * 1.5 + (s.k === 3 ? 1 : 0);
      return [{ x: dx - 4.5 + inn, y: dy + 1 }, { x: dx + 4.5 - inn, y: dy + 1 }];
    }
  };
  const A = drawPip(g, o);
  const w = 3.6 - sq * 0.9, h = 2.4 + sq * 0.5;
  if (s.k === 0) fx.burst(g, dx, dy, s.t * 1.6, GOLD);
  if (s.k > 0 || s.t > 0.3) g.stamp((l) => {
    l.ell(dx + 0.5, dy + 1.5, w, h, (nx, ny) => (nx + ny < -0.7 ? "#FFF3A6" : ny > 0.5 ? "#E0A800" : "#FFD23F"));
    l.ell(dx - 1.5, dy - 1.5 + sq * 0.5, 2, 1.9, (nx, ny) => (nx + ny < -0.6 ? "#FFF3A6" : "#FFD23F"));
    l.rect(dx - 4.5, dy - 1 + sq * 0.5, 2, 1, "#FF8A2A").px(dx - 4, dy + sq * 0.5, "#E0661A");
    l.px(dx - 2, dy - 2 + sq * 0.5, "#1A1A22");
  }, "#4A3100");
  if (squeeze > 0.5) { fx.note(g, dx + 4 + (s.k === 2 ? 2 : 0), A.top.y - 1 - s.n, s.k === 2 ? PINK : "#8E5CFF"); }
  if (s.k === 3) { fx.heart(g, A.cx - 8, A.top.y + 2 - s.t * 5, false); fx.heart(g, A.cx + 8, A.top.y - s.t * 4, true); }
}, 12);

def("treat-skateboard", "Skateboard", "Treats", 48, "You give Pip a skateboard: a roll, an ollie, a stuck landing.", (g, f) => {
  const s = tl(f, [12, 6, 12, 18]);
  let lift = 0, flip = 0, o;
  if (s.k === 0) o = { eyes: "determined", mouth: "smile", lean: 1.5, la: 70 + wave(f, 6, 8), brows: "focus" };
  else if (s.k === 1) o = { eyes: "determined", mouth: "grit", sq: 0.16 * eo(s.t), la: 80, brows: "focus" };
  else if (s.k === 2) { lift = -hop(s.t, 9); flip = s.t; o = { eyes: "wide", mouth: "open", sq: -0.1 * Math.sin(Math.PI * s.t), la: 0, ll: 1.2 }; }
  else o = { eyes: s.t < 0.2 ? "squeeze" : "star", mouth: "open", blush: "big", sq: s.t < 0.2 ? 0.15 * (1 - s.t / 0.2) : 0, la: 28 + wave(s.n, 6, 12), lean: -1 };
  g.shadow(16, 7 - Math.min(4, lift / 2));
  const by = 29 - lift;
  // The board: deck, kicktails and wheels; it flips a full turn in the air.
  const w = Math.max(1, Math.round(Math.abs(Math.cos(flip * TAU)) * 1.5 + 0.5));
  const spin = f % 2;
  g.stamp((l) => {
    if (w > 1 || flip === 0) {
      l.rect(9, by, 14, 1, flip > 0.25 && flip < 0.75 ? "#FFD23F" : "#8E5CFF").px(8, by - 1, "#8E5CFF").px(23, by - 1, "#8E5CFF");
      l.px(10, by, "#B89CFF");
    } else l.rect(8, by - 1, 16, 1, "#FFD23F");
    if (flip < 0.25 || flip > 0.75) l.px(11, by + 1, spin ? "#DDE3EC" : "#8C97A6").px(20, by + 1, spin ? "#DDE3EC" : "#8C97A6");
  }, "#1A1A22");
  o.y = by - 1;
  o.feet = (A) => [[A.cx - 3.5, by - 0.2], [A.cx + 3.5, by - 0.2]];
  o.hands = (A) => (s.k === 3 ? [{ x: A.handL[0] - 1, y: A.cy - 5 }, { x: A.handR[0] + 1, y: A.cy - 5 }] : s.k === 2 ? [{ x: A.handL[0] - 1, y: A.cy - 2 }, { x: A.handR[0] + 1, y: A.cy - 2 }] : null);
  const A = drawPip(g, o);
  if (s.k === 0 || s.k === 3) for (let i = 0; i < 3; i++) fx.speed(g, ((f * 3 + i * 11) % 34) - 6, 21 + i * 3, 3);
  if (s.k === 3 && s.t < 0.3) { fx.puff(g, 7, 29, 1.4); fx.puff(g, 25, 29, 1.4); }
  if (s.k === 3 && s.t > 0.3) fx.twinkle(g, A.cx + 10, A.top.y + 2, (s.t - 0.3) / 0.7, GOLD);
}, 32);

def("treat-bubbles", "Bubble Wand", "Treats", 48, "You give Pip bubbles: a long blow, then one pops on its nose.", (g, f) => {
  const s = tl(f, [8, 26, 14]);
  g.shadow(15, 6);
  let rx = 0, ry = 0;
  const blowing = s.k === 1;
  const popT = s.k === 2 ? s.t : -1;
  const A = drawPip(g, {
    x: 14, eyes: s.k === 2 ? (popT < 0.25 ? "squeeze" : "happy") : blowing ? "closed" : "open",
    mouth: blowing ? "whistle" : s.k === 2 ? "open" : "smile", mouthDx: blowing ? 1 : 0, blush: blowing ? "big" : true,
    look: [1, 0], fdx: s.k === 0 ? 1 : 0, la: 28 + wave(f, 16, 8), sq: s.k === 2 && popT < 0.25 ? 0.06 : 0,
    hands: (A) => { rx = A.fc + 6; ry = A.ey + 1 + (s.k === 0 ? (1 - eo(s.t)) * 5 : 0); return [{ x: A.handL[0], y: A.handL[1] }, { x: rx - 1, y: ry + 6 }]; }
  });
  // The wand: a loop on a stick.
  g.stamp((l) => { l.line(rx - 1, ry + 6, rx, ry + 3, "#FF6FA8"); l.ring(rx + 0.5, ry + 1, 1.8, "#FF6FA8"); }, "#4A0A24");
  const bubble = (x, y, r) => {
    g.ring(x, y, r, "#BFEFFF");
    g.px(Math.round(x - r * 0.5), Math.round(y - r * 0.5), "#FFFFFF");
    if (r > 1.6) g.px(Math.round(x + r * 0.3), Math.round(y + r * 0.6), "#FFC2E0");
  };
  if (s.k >= 1) {
    for (let i = 0; i < 4; i++) {
      const age = f - (9 + i * 6);
      if (age < 0) continue;
      const r = Math.min(2.6, 0.8 + age * 0.25);
      const x = rx + 2 + age * 0.45 + Math.sin(age * 0.4 + i) * 1.2, y = ry - age * 0.55 + Math.sin(age * 0.3 + i * 2) * 0.8;
      if (y > -3 && x < 34) bubble(x, y, r);
    }
  }
  if (s.k === 2) {
    if (popT < 0.25) {
      // One drifts back and pops on Pip's nose.
      fx.burst(g, A.fc - 1, A.ey + 1, popT * 4, "#BFEFFF");
    } else {
      fx.heart(g, A.cx - 8, A.top.y + 2 - (popT - 0.25) * 6, false);
      fx.twinkle(g, A.fc - 4, A.ey - 5, (popT - 0.25) / 0.75, WHITE);
    }
  } else if (s.k === 1 && s.t > 0.85) {
    const u = (s.t - 0.85) / 0.15;
    bubble(lerp(A.fc + 6, A.fc - 1, u), lerp(A.ey - 7, A.ey + 1, u), 2);
  }
}, 22);

const toy = [
  { id: "duck", name: "Rubber Duck", price: 30, mood: 12, move: "treat-duck" },
  { id: "ball", name: "Bouncy Ball", price: 40, mood: 15, move: "treat-ball" },
  { id: "bubbles", name: "Bubble Wand", price: 45, mood: 16, move: "treat-bubbles" },
  { id: "yoyo", name: "Yo-yo", price: 55, mood: 18, move: "treat-yoyo" },
  { id: "kite", name: "Kite", price: 90, mood: 25, move: "treat-kite" },
  { id: "skateboard", name: "Skateboard", price: 120, mood: 30, move: "treat-skateboard" }
];

for (const t of food) t.make();

export const TREATS = [
  ...food.map(({ id, name, price, mood }) => ({ id, name, kind: "food", price, move: "treat-" + id, mood })),
  ...toy.map(({ id, name, price, mood, move }) => ({ id, name, kind: "toy", price, move, mood }))
];
