/* The art of furnishings in use: what the house scene lays over the room's
 picture while a thing is not as the room art drew it (curtains drawn across
 a window). Drawn with the room Painter (room.js), in its palette and at its
 scale, each a pure function of its state.

 The room's picture dims itself after dark (house.js, `nightLight`); a sprite
 laid over it has to be dimmed the same way, which `dimForNight` does. */
import { Painter } from "./room.js";

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * The Window's curtains (room.js, "window": 36 x 30, curtains tied back at
 * both sides), drawn `closed` of the way across: 0 is the tied-back pair in
 * the shape the room art draws (the scene shows the room's own then, and
 * lays this over it only once they are pulled), 1 meets in the middle and
 * hides the glass. Only the curtains are drawn; the rest is clear.
 */
export function renderCurtains(closed, w = 36, h = 30) {
  const c = clamp01(closed);
  const g = new Painter(w, h, 0);
  const half = w / 2;
  const rows = h - 2;
  // Tied back, a curtain is waisted at its tie; drawn, it hangs straight.
  const tied = (y) => (y < 14 ? 5 - Math.round((y / 14) * 2) : 3 + Math.round(((y - 14) / 14) * 2));
  const width = (y) => Math.round(tied(y) + c * (half - tied(y)));
  // Gathered, the folds are a pixel each; spread out, they widen.
  const fold = 1 + Math.round(c * 2);
  g.stamp((l) => {
    for (const s of [0, 1]) {
      for (let y = 0; y < rows; y++) {
        const span = width(y);
        for (let i = 0; i < span; i++) {
          const x = s ? w - 1 - i : i;
          const light = Math.floor(i / fold) % 2 === 0;
          // The hem, and the edge that meets the other curtain, a shade darker.
          const edge = c > 0.15 && (i === span - 1 || y === rows - 1);
          l.px(x, y, edge ? "#A8323E" : light ? "#E0584E" : "#C8453B");
        }
      }
      // The tie holds until the curtain is pulled out of it.
      if (c < 0.3) l.rect(s ? w - 5 : 1, 14, 4, 1, "#FFD23F");
    }
  }, "#4A0E14");
  return g.toImageData();
}

/**
 * A sprite as the room's picture would show it after dark, away from any
 * lamp: the same dimming house.js gives every pixel no light reaches.
 */
export function dimForNight(image) {
  const out = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(d[i] * 0.34 * 0.78);
    d[i + 1] = Math.round(d[i + 1] * 0.34 * 0.82);
    d[i + 2] = Math.round(d[i + 2] * 0.34);
  }
  return out;
}
