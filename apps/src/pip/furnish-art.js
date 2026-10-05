/* The art of furnishings in use: what the house scene lays over the room's
 picture while a thing is not as the room art drew it (curtains drawn across
 a window). Drawn with the room Painter (room.js), in its palette and at its
 scale, each a pure function of its state.

 The room's picture dims itself after dark (house.js, `nightLight`); a sprite
 laid over it has to be dimmed the same way, which `dimForNight` does. */
import { Painter } from "./room.js";
import { drawPip } from "./engine.js";
import { def, prop, kit } from "./anims.js";

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

// ------------------------------------------------------------ the book in her hands
// When Pip reads in her house, the book she holds is the reader's own: its
// cover's colour, and a ribbon at the place the reader has reached. The
// furnishings layer says which book that is (`setHandBook`); the scene plays
// `readingMove()` in place of "read".

/** The pages of the open book, across: the places a ribbon can sit (pip/bookSpines.ts, `RIBBON_STEPS`). */
const PAGES = 8;

/**
 * The open book of the reading poses (anims.js, `prop.openBook`: the same
 * place, size and `flip`), in this `cover`, with a ribbon hanging from its
 * foot `progress` (0 to 1) of the way across its pages. No ribbon without a
 * `progress`.
 */
export function bookInHand(g, x, y, o = {}) {
  prop.openBook(g, x, y, { cover: o.cover, flip: o.flip, w: o.w, h: o.h });
  if (o.progress == null) return;
  const w = Math.max(4, Math.round(o.w || 10)), h = o.h || 6, x0 = Math.round(x - w / 2);
  const at = x0 + 1 + Math.min(w - 3, Math.floor(clamp01(o.progress) * (w - 2)));
  // Red, or gold against a red cover: from the last line of the page, over the cover's edge, and a little below it.
  const [r, gr, b] = [1, 3, 5].map((i) => parseInt((o.cover || "#C8453B").slice(i, i + 2), 16));
  g.rect(at, Math.round(y) + h - 2, 1, 4, r > 150 && gr < 110 && b < 110 ? "#FFD23F" : "#E0393E");
}

let held = null;

/** The book she reads: `{ cover: "#rrggbb", progress: 0..1 }`, or null for the plain red one. */
export const setHandBook = (book) => {
  held = book && /^#[0-9a-f]{6}$/i.test(book.cover || "") ? { cover: book.cover, progress: clamp01(book.progress || 0) } : null;
};
export const handBook = () => held;

const reading = new Set();
const bookHands = (A) => [{ x: A.cx - 5.5, y: A.cy + 5 }, { x: A.cx + 5.5, y: A.cy + 5 }];

/**
 * The move to play for "read": the same pose (anims.js), holding the book set
 * by `setHandBook`. Each look is a move of its own (a part, with no category:
 * not one to show off or sell), registered the first time it is asked for, so
 * a frame drawn once is kept like any other move's. "read" itself with no book.
 */
export function readingMove() {
  if (!held) return "read";
  const step = Math.min(PAGES - 1, Math.floor(held.progress * PAGES));
  const cover = held.cover;
  const id = `read-${cover.slice(1).toLowerCase()}-${step}`;
  if (!reading.has(id)) {
    reading.add(id);
    const { wave, lerp, blink } = kit;
    def(id, "Reading", "", 48, "In her house, with the reader's own book.", (g, f) => {
      const k = f % 48, flip = k >= 38 ? (k - 38) / 10 : null;
      const scan = k < 36 ? Math.round(lerp(-1, 1, (k % 12) / 11)) : 0;
      g.shadow(16, 6);
      drawPip(g, { sq: wave(f, 24, 0.03), look: [scan, 1], la: 28 + wave(f, 48, 5), mouth: "flat", eyes: blink(f, 48, 30) ? "blink" : "open", hold: (g, A) => bookInHand(g, A.cx, A.cy + 2, { cover, progress: (step + 0.5) / PAGES, flip }), hands: bookHands });
    });
  }
  return id;
}
