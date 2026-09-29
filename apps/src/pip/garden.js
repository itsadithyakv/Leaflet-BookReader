/* Pip's garden: the plots and plants, drawn with the room art's Painter so
 they sit in the house at the same pixel scale. Every draw is a pure function
 of the plant, its growth (0..1) and the frame (12 fps).

 A plant shows four stages: a seed just breaking the soil, a sprout, a young
 plant, and grown; grown and ripe, it shows its fruit or flower and a little
 sparkle, so "ripe" reads from across the room.

 The house draws a plot as two sprites, the soil bed and the plant over it
 (renderSoil, renderPlant), so the plant can pop, sway and be picked on its
 own. renderPlot draws both together, for the seed packets.

 Also: a plain garden floor for when the house art has no garden floor. */
import { Painter } from "./room.js";

export const PLOT_W = 28;
export const PLOT_H = 34;
const SOIL_H = 7;

const OUT = "#2A1E16";
const LEAF = "#4FA84A";
const LEAF_DARK = "#2F7A36";
const LEAF_LIGHT = "#8FD66A";
const STEM = "#3E8A3A";

/** Growth stage from progress: 0 seed, 1 sprout, 2 young, 3 grown. */
const stageOf = (progress) => (progress <= 0.02 ? 0 : progress < 0.34 ? 1 : progress < 0.75 ? 2 : 3);

const soil = (g, empty) => {
  const y = PLOT_H - SOIL_H;
  g.stamp((l) => {
    l.rect(1, y, PLOT_W - 2, SOIL_H, "#6B4226");
    l.rect(1, y, PLOT_W - 2, 2, "#8A5A34");
    for (let x = 3; x < PLOT_W - 3; x += 5) l.px(x, y + 3 + (x % 2), "#4A2C16");
    // Wooden edging.
    l.rect(0, y - 1, PLOT_W, 1, "#A06A40");
    l.rect(0, PLOT_H - 1, PLOT_W, 1, "#5E3A1F");
  }, OUT);
  if (empty) {
    // Dug rows waiting for a seed.
    for (let x = 5; x < PLOT_W - 4; x += 6) g.rect(x, y + 2, 3, 1, "#4A2C16");
  }
};

const leafPair = (g, x, y, size) => {
  g.stamp((l) => {
    l.ell(x - size, y, size, size * 0.6, (nx, ny) => (ny < -0.2 ? LEAF_LIGHT : nx < 0 ? LEAF : LEAF_DARK));
    l.ell(x + size, y, size, size * 0.6, (nx, ny) => (ny < -0.2 ? LEAF_LIGHT : nx > 0 ? LEAF_DARK : LEAF));
  }, OUT);
};

const stem = (g, x, top, bottom) => g.stamp((l) => l.rect(x, top, 1, bottom - top, STEM), OUT);

/** Per plant: how it looks grown, and ripe. `g` is PLOT_W x PLOT_H, soil at the bottom. */
const PLANT_ART = {
  radish(g, ripe, f) {
    const base = PLOT_H - SOIL_H;
    if (ripe) g.stamp((l) => l.ell(14, base - 1, 4, 3.5, (nx, ny) => (nx + ny < -0.6 ? "#FF8FA3" : "#E0393E")), OUT);
    leafPair(g, 14, base - (ripe ? 7 : 4), 3);
    leafPair(g, 14, base - (ripe ? 10 : 7), 2);
    void f;
  },
  strawberry(g, ripe, f) {
    const base = PLOT_H - SOIL_H;
    leafPair(g, 14, base - 3, 4);
    leafPair(g, 14, base - 7, 3);
    if (ripe) {
      for (const [x, y] of [[8, base - 2], [20, base - 3], [14, base - 10]]) {
        g.stamp((l) => l.ell(x, y, 2.2, 2.6, "#E0393E").px(x, y - 1, "#FFE066").px(x - 1, y + 1, "#FFE066"), OUT);
      }
    } else {
      g.px(9, base - 3, "#FFFFFF").px(19, base - 4, "#FFFFFF");
    }
    void f;
  },
  sunflower(g, ripe, f) {
    const base = PLOT_H - SOIL_H;
    const top = ripe ? 5 : 9;
    stem(g, 14, top + 4, base);
    leafPair(g, 14, base - 8, 3);
    const sway = ripe ? Math.round(Math.sin(f / 8)) : 0;
    g.stamp((l) => {
      l.ell(14 + sway, top + 2, ripe ? 6 : 3, ripe ? 6 : 3, (nx, ny) => (nx * nx + ny * ny < 0.3 ? "#6B4226" : "#FFD23F"));
      if (ripe) l.px(13 + sway, top + 1, "#4A2C16").px(15 + sway, top + 3, "#4A2C16");
    }, OUT);
  },
  rose(g, ripe, f) {
    const base = PLOT_H - SOIL_H;
    stem(g, 14, 10, base);
    leafPair(g, 14, base - 6, 3);
    leafPair(g, 14, base - 12, 2.5);
    g.stamp((l) => {
      if (ripe) {
        l.ell(14, 9, 4.5, 4, (nx, ny) => (nx * nx + ny * ny < 0.25 ? "#8E1B2E" : nx + ny < -0.4 ? "#FF6F8A" : "#D83A56"));
      } else {
        l.ell(14, 10, 2, 2.5, "#4FA84A").px(14, 8, "#D83A56");
      }
    }, OUT);
    void f;
  },
  pumpkin(g, ripe, f) {
    const base = PLOT_H - SOIL_H;
    g.stamp((l) => {
      for (let x = 3; x < 25; x += 1) l.px(x, base - 1 - Math.round(Math.sin(x / 3) * 1.2), LEAF_DARK);
    }, OUT);
    leafPair(g, 7, base - 4, 3);
    leafPair(g, 21, base - 5, 3);
    const r = ripe ? 7 : 3.5;
    g.stamp((l) => {
      l.ell(14, base - r + 1, r, r * 0.8, (nx) => {
        const band = Math.abs(nx) < 0.2 || Math.abs(Math.abs(nx) - 0.6) < 0.12;
        return ripe ? (band ? "#D2691E" : "#FF9A2E") : band ? "#8FBF5A" : "#B8D86A";
      });
      l.rect(13, base - r * 1.6, 2, 2, "#5E3A1F");
    }, OUT);
    void f;
  },
  oak(g, ripe, f) {
    const base = PLOT_H - SOIL_H;
    g.stamp((l) => l.rect(12, ripe ? 12 : 16, 4, base - (ripe ? 12 : 16), "#7A4A26").rect(12, ripe ? 12 : 16, 1, base - (ripe ? 12 : 16), "#A06A40"), OUT);
    const r = ripe ? 11 : 7;
    const cy = ripe ? 10 : 13;
    g.stamp((l) => {
      l.ell(14, cy, r, r * 0.8, (nx, ny) => (nx + ny < -0.5 ? LEAF_LIGHT : nx + ny > 0.6 ? LEAF_DARK : LEAF));
      if (ripe) for (const [x, y] of [[8, cy + 2], [18, cy - 3], [20, cy + 4], [11, cy - 5]]) l.px(x, y, "#A0522D").px(x, y - 1, "#5E3A1F");
    }, OUT);
    void f;
  }
};

/** A plant at its growth (0..1), ripe or not, drawn into a PLOT_W x PLOT_H painter. */
const drawPlant = (g, plantId, progress, ripe, f) => {
  const stage = ripe ? 3 : stageOf(progress);
  const base = PLOT_H - SOIL_H;
  if (stage === 0) {
    // The seed's mound, with the first two leaves just out: planted reads as
    // "something is coming" from across the room.
    g.stamp((l) => l.ell(14, base, 3, 1.5, "#8A5A34").px(14, base - 1, "#E8D6A8"), OUT);
    g.stamp((l) => l.rect(14, base - 3, 1, 2, STEM).px(13, base - 4, LEAF_LIGHT).px(15, base - 4, LEAF), OUT);
  } else if (stage === 1) {
    stem(g, 14, base - 4, base);
    leafPair(g, 14, base - 4, 2);
  } else if (stage === 2) {
    stem(g, 14, base - 9, base);
    leafPair(g, 14, base - 4, 3);
    leafPair(g, 14, base - 9, 2.5);
  } else {
    (PLANT_ART[plantId] ?? PLANT_ART.sunflower)(g, ripe, f);
  }
  if (ripe) {
    // A glint that comes and goes: ripe, pick me.
    const k = f % 24;
    if (k < 8) {
      const x = 22, y = 4 + (k > 4 ? 1 : 0);
      g.px(x, y - 1, "#FFFFFF").px(x, y + 1, "#FFFFFF").px(x - 1, y, "#FFFFFF").px(x + 1, y, "#FFFFFF").px(x, y, "#FFE066");
    }
  }
};

/**
 * One plot as a PLOT_W x PLOT_H ImageData: empty soil, or a plant at its
 * growth (0..1), ripe or not.
 */
export const renderPlot = (plantId, progress, ripe, f = 0) => {
  const g = new Painter(PLOT_W, PLOT_H, f);
  soil(g, !plantId);
  if (plantId) drawPlant(g, plantId, progress, ripe, f);
  return g.toImageData();
};

/** The soil bed alone, PLOT_W x PLOT_H: dug rows while it waits for a seed. */
export const renderSoil = (dug) => {
  const g = new Painter(PLOT_W, PLOT_H, 0);
  soil(g, dug);
  return g.toImageData();
};

/** The plant alone, PLOT_W x PLOT_H over nothing, to stand on its soil bed. */
export const renderPlant = (plantId, progress, ripe, f = 0) => {
  const g = new Painter(PLOT_W, PLOT_H, f);
  drawPlant(g, plantId, progress, ripe, f);
  return g.toImageData();
};

/** A plant's packet picture for a shop tile: the plant grown and ripe. */
export const renderPacket = (plantId, f = 0) => renderPlot(plantId, 1, true, f);

/** A plain garden floor (sky, a fence, grass) for when the house art has none. */
export const renderGardenFloor = (w, h, floorY, f = 0) => {
  const g = new Painter(w, h, f);
  for (let y = 0; y < floorY; y++) {
    const t = y / floorY;
    const c = t < 0.5 ? "#A9D8FF" : "#CDEBFF";
    g.rect(0, y, w, 1, c);
  }
  for (let x = 4; x < w; x += 10) g.rect(x, floorY - 16, 3, 16, "#E8D6A8").px(x + 1, floorY - 17, "#E8D6A8");
  g.rect(0, floorY - 12, w, 2, "#D6C08E").rect(0, floorY - 6, w, 2, "#D6C08E");
  for (let y = floorY; y < h; y++) g.rect(0, y, w, 1, y % 3 ? "#5FB84A" : "#55AD42");
  return g.toImageData();
};
