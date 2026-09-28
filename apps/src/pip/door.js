/* Scenery drawn with the same engine as Pip. There is one Pip; its home is the
   logo in the header. While Pip is out, the logo shows where Pip belongs: a
   marching-ants outline of Pip's shape, so the spot reads as "Pip's place,
   currently empty" rather than as a missing image. */
import { drawPip, G, Layer } from "./engine.js";

const N = 32;

function emptyHome(g, f) {
  const shape = new Layer();
  drawPip(new G(shape, g.S, f), { eyes: "none", mouth: "none", blush: false, acc: false });
  // A soft, filled silhouette with a marching-ants edge: reads as "Pip's
  // spot" at 44px in both themes, where a bare dotted line read as broken.
  const march = Math.floor(f / 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (shape.get(x, y)) {
      g.px(x, y, "#8F8A7E38");
      continue;
    }
    const edge = shape.get(x - 1, y) || shape.get(x + 1, y) || shape.get(x, y - 1) || shape.get(x, y + 1);
    if (edge && (x + y + march) % 4 !== 0) g.px(x, y, "#8F8A7E");
  }
}

const scene = (id, loop, draw) => ({ id, name: id, cat: "Scenery", loop, when: "", poster: 0, draw });

export const SCENERY = [scene("home-empty", 12, (g, f) => emptyHome(g, f))];
