/* The focus flower: a pot planted when a focus session starts in full screen.
 It grows as the session is read (a seed, a sprout, a young plant, a bud) and
 opens when the session completes. Leaving early wilts it where it stands: the
 stem folds over, the leaves brown, and the bud hangs its head.

 Drawn with the room art's Painter, like the garden, and just as pure: the
 flower, its growth (0..1), its state and the frame. */
import { Painter } from "./room.js";

export const FLOWER_W = 24;
export const FLOWER_H = 36;

const OUT = "#2A1E16";

/** The flowers a session can grow: petals fresh, lit, and wilted, and the middle. */
export const FOCUS_FLOWERS = {
  tulip: { petal: "#E8484F", light: "#FF8A8F", dead: "#94605A", middle: "#E8484F" },
  daisy: { petal: "#FFFFFF", light: "#FFFFFF", dead: "#CFC4A4", middle: "#FFD23F" },
  sunflower: { petal: "#FFD23F", light: "#FFE98A", dead: "#B8983E", middle: "#6B4226" },
  rose: { petal: "#D83A56", light: "#FF6F8A", dead: "#80404A", middle: "#8E1B2E" }
};

const FRESH = { stem: "#3E8A3A", leaf: "#4FA84A", dark: "#2F7A36", light: "#8FD66A" };
const DEAD = { stem: "#7A6A32", leaf: "#8C7A3E", dark: "#66592C", light: "#A89A5A" };

/** Growth stage from progress: 0 seed, 1 sprout, 2 young, 3 bud. Open is its own state. */
export const flowerStage = (progress) => (progress < 0.04 ? 0 : progress < 0.3 ? 1 : progress < 0.62 ? 2 : 3);

/** The soil line in the mouth of the pot; the plant grows up from here. */
const SOIL_Y = 24;
const CX = 12;

const pot = (g) => {
  g.stamp((l) => {
    // The rim, lit along its top edge.
    l.rect(3, SOIL_Y, 18, 3, "#D8734A");
    l.rect(3, SOIL_Y, 18, 1, "#F08E5E");
    l.rect(3, SOIL_Y + 2, 18, 1, "#B25A36");
    // The body tapers to the foot, lit on the left.
    for (let y = SOIL_Y + 3; y < FLOWER_H - 1; y++) {
      const half = Math.round(7 - ((y - SOIL_Y - 3) / (FLOWER_H - SOIL_Y - 5)) * 2);
      for (let x = CX - half; x < CX + half; x++) {
        l.px(x, y, x < CX - half + 2 ? "#DE7C4E" : x >= CX + half - 2 ? "#A04E2C" : "#C8643C");
      }
    }
  }, OUT);
  // Soil in the mouth of the pot.
  g.rect(5, SOIL_Y, 14, 1, "#5E3A1F");
};

const stem = (g, top, c) => g.stamp((l) => l.rect(CX, top, 1, SOIL_Y - top, c.stem), OUT);

const leafPair = (g, y, size, c) => {
  g.stamp((l) => {
    l.ell(CX - size, y, size, size * 0.6, (nx, ny) => (ny < -0.2 ? c.light : nx < 0 ? c.leaf : c.dark));
    l.ell(CX + 1 + size, y, size, size * 0.6, (nx, ny) => (ny < -0.2 ? c.light : nx > 0 ? c.dark : c.leaf));
  }, OUT);
};

/** Leaves gone limp: hanging from the stem instead of reaching out. */
const limpLeaves = (g, y, size, c) => {
  g.stamp((l) => {
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? CX - 1 : CX + 1;
      l.line(x0, y, x0 + side * size, y + size, c.leaf);
      l.line(x0, y + 1, x0 + side * (size - 1), y + size + 1, c.dark);
    }
  }, OUT);
};

/** Open heads, drawn at (x, y) with a palette: petal, light, middle. */
const HEADS = {
  tulip(l, x, y, p) {
    l.ell(x - 2, y + 1, 2.4, 3.6, p.petal);
    l.ell(x + 2, y + 1, 2.4, 3.6, p.petal);
    l.ell(x, y, 2.4, 4.2, (nx, ny) => (nx < -0.1 && ny < 0 ? p.light : p.petal));
  },
  daisy(l, x, y, p) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      l.ell(x + Math.cos(a) * 3.6, y + Math.sin(a) * 3.3, 1.8, 1.8, p.petal);
    }
    l.ell(x, y, 2.1, 2.1, p.middle);
  },
  sunflower(l, x, y, p) {
    l.ell(x, y, 5.6, 5.3, (nx, ny) => (nx * nx + ny * ny < 0.34 ? p.middle : nx + ny < -0.7 ? p.light : p.petal));
  },
  rose(l, x, y, p) {
    l.ell(x, y, 4.3, 3.9, (nx, ny) => (nx * nx + ny * ny < 0.18 ? p.middle : nx + ny < -0.5 ? p.light : p.petal));
    l.px(x - 2, y - 1, p.middle).px(x + 1, y + 1, p.middle);
  }
};

const growing = (g, kind, p, stage, open, f) => {
  const c = FRESH;
  if (stage === 0) {
    // A seed just under the soil.
    g.stamp((l) => l.ell(CX, SOIL_Y - 1, 2.5, 1.3, "#8A5A34").px(CX, SOIL_Y - 2, "#E8D6A8"), OUT);
    return;
  }
  if (stage === 1) {
    stem(g, SOIL_Y - 5, c);
    leafPair(g, SOIL_Y - 5, 2, c);
    return;
  }
  const top = stage === 2 ? SOIL_Y - 11 : 10;
  stem(g, top, c);
  leafPair(g, SOIL_Y - 4, 3, c);
  leafPair(g, SOIL_Y - 10, 2.5, c);
  if (stage === 2) {
    return;
  }
  if (!open) {
    // A closed bud, its colour just showing at the tip.
    g.stamp((l) => l.ell(CX, 8, 2.3, 3.2, (nx, ny) => (ny < -0.35 ? p.petal : nx < 0 ? c.light : c.leaf)), OUT);
    return;
  }
  // Open: the head sways a pixel now and then, and a glint comes and goes.
  const sway = Math.round(Math.sin(f / 9) * 0.7);
  g.stamp((l) => HEADS[kind](l, CX + sway, 7, p), OUT);
  const k = f % 30;
  if (k < 8) {
    const x = 20;
    const y = 3 + (k > 4 ? 1 : 0);
    g.px(x, y - 1, "#FFFFFF").px(x, y + 1, "#FFFFFF").px(x - 1, y, "#FFFFFF").px(x + 1, y, "#FFFFFF").px(x, y, "#FFE066");
  }
};

const wilted = (g, kind, p, stage) => {
  const c = DEAD;
  if (stage === 0) {
    // It never came up: the soil has dried and cracked.
    g.px(CX - 2, SOIL_Y, "#3A2414").px(CX - 1, SOIL_Y, "#8A6A4A").px(CX, SOIL_Y, "#3A2414").px(CX + 2, SOIL_Y, "#3A2414");
    return;
  }
  if (stage === 1) {
    // A sprout lying over the rim.
    g.stamp((l) => {
      l.line(CX, SOIL_Y - 1, CX, SOIL_Y - 3, c.stem);
      l.line(CX, SOIL_Y - 3, CX + 3, SOIL_Y - 2, c.stem);
      l.px(CX + 4, SOIL_Y - 1, c.leaf).px(CX + 3, SOIL_Y - 1, c.dark);
    }, OUT);
    return;
  }
  // Taller: the stem folds over and whatever grew on it hangs down.
  const bend = stage === 2 ? SOIL_Y - 9 : SOIL_Y - 13;
  g.stamp((l) => {
    l.line(CX, SOIL_Y - 1, CX, bend, c.stem);
    l.line(CX, bend, CX + 2, bend - 2, c.stem);
    l.line(CX + 2, bend - 2, CX + 4, bend - 2, c.stem);
    l.line(CX + 4, bend - 2, CX + 6, bend, c.stem);
    l.line(CX + 6, bend, CX + 6, bend + 2, c.stem);
  }, OUT);
  limpLeaves(g, SOIL_Y - 6, 3, c);
  if (stage >= 3) {
    // The bud, head down and faded.
    g.stamp((l) => l.ell(CX + 6, bend + 5, 2.1, 2.9, (nx, ny) => (ny > 0.35 ? p.dead : c.leaf)), OUT);
    // A petal fallen on the rim, under the drooping head.
    g.px(16, SOIL_Y - 1, p.dead).px(17, SOIL_Y - 1, p.dead);
  }
  void kind;
};

/**
 * The focus flower as a FLOWER_W x FLOWER_H ImageData. `state` is "growing"
 * (by progress), "bloomed" (open) or "wilted" (at the stage it had reached).
 */
export const renderFocusFlower = (kind, progress, state, f = 0) => {
  const p = FOCUS_FLOWERS[kind] ?? FOCUS_FLOWERS.tulip;
  const g = new Painter(FLOWER_W, FLOWER_H, f);
  pot(g);
  if (state === "wilted") {
    wilted(g, kind, p, flowerStage(progress));
  } else {
    growing(g, kind in HEADS ? kind : "tulip", p, state === "bloomed" ? 3 : flowerStage(progress), state === "bloomed", f);
  }
  return g.toImageData();
};
