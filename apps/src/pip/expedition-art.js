/* The things Pip brings back from her expeditions (expedition.ts), each its
 own small pixel sprite: FIND_SIZE x FIND_SIZE, small enough for her to hold
 up, drawn larger in the album. Drawn with the room Painter (room.js), in the
 house's palette and the house's way: the thing on a stamp layer for its 1px
 outline, glints laid over it. Every draw is a pure function of the frame
 (12 fps); most are still, and a few of the rarest glint.

 For the UI:
   renderFind(id, f)             -> ImageData(FIND_SIZE, FIND_SIZE), clear ground
   renderFindSilhouette(id, c)   -> the same shape in one flat colour (a thing not found yet)
   hasFindArt(id)                -> whether a sprite is drawn for that id

 For the room's own picture (house.js draws with a Painter of its own):
   FIND_SPRITES  [{ id, w, h, draw(g, f) }]   each find at full size, in the house's item format
   FIND_MINIS    [{ id, w, h, draw(g, f) }]   each at half size (FIND_MINI square), for a
                                              display too small for the real thing
   drawFindMini(g, x, y, id, f)               one mini at (x, y) on any Painter */
import { Painter } from "./room.js";
import { rgba } from "./engine.js";

export const FIND_SIZE = 12;
/** A find at half size, for a shelf or a board in the room's picture. */
export const FIND_MINI = FIND_SIZE / 2;

const WOOD = "#8A5A34", BARK = "#6B4226", DARK = "#2A160A";
const GOLD = "#FFD23F", BRASS = "#D9A441", OLD = "#8A6420";
const CREAM = "#FFF6DF", PAPER = "#E8D5A0", INK = "#3A2C1E";
const STEEL = "#C9D1DB", IRON = "#8C97A6", SLATE = "#5A606E";
const RED = "#C8453B", ROSE = "#E0584E", LEAF = "#4FBF5A", MOSS = "#2F8F46";

/** Light from the upper left: a round thing in three tones. */
const ball = (hi, mid, lo) => (nx, ny) => (nx + ny < -0.7 ? hi : nx + ny > 0.75 ? lo : mid);

/** A small pixel map, one character a pixel, its top left at (x, y); `key` gives each character its colour. */
const map = (l, x, y, rows, key) => {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (key[row[i]]) l.px(x + i, y + j, key[row[i]]);
  });
  return l;
};

/** A feather lying from lower left to upper right: the quill (q), the vane in the light (a) and in shade (b). */
const FEATHER = [
  ".......ab.",
  ".....aaqb.",
  "....aaqbb.",
  "...aaqbb..",
  "..aaqbb...",
  "..aqbb....",
  "..qb......",
  ".q........",
  "q........."
];
const feather = (l, a, b, q) => map(l, 1, 1, FEATHER, { a, b, q });

const SPRITES = {
  // ------------------------------------------------------------ common
  "pressed-leaf"(g) {
    g.stamp((l) => {
      l.ell(6, 5, 3.1, 4, (nx, ny) => (nx < -0.1 ? "#C9A85A" : "#A8873E"));
      l.px(6, 1, "#A8873E").line(6, 2, 6, 10, "#6E5524");
      l.px(5, 4, "#6E5524").px(4, 3, "#6E5524").px(7, 5, "#6E5524").px(8, 4, "#6E5524").px(5, 7, "#6E5524").px(7, 7, "#6E5524");
    }, "#3E2E10");
  },
  acorn(g) {
    g.stamp((l) => {
      l.ell(6, 7.5, 2.9, 3.2, ball("#E8B878", "#C88A45", "#9A6428"));
      l.rect(3, 3, 6, 3, BARK).rect(4, 2, 4, 1, BARK).rect(3, 3, 6, 1, WOOD);
      l.px(4, 4, WOOD).px(6, 5, WOOD).px(8, 4, WOOD).rect(6, 1, 1, 1, "#4A2C16");
    }, DARK);
  },
  "smooth-stone"(g) {
    g.stamp((l) => l.ell(6, 7, 4.6, 3, ball("#DDE3EC", "#A9B2BF", "#7C8594")), "#2E3440");
    g.px(4, 6, "#FFFFFF").px(5, 5, "#FFFFFF");
  },
  "bottle-cap"(g) {
    g.stamp((l) => {
      l.ell(6, 6, 4.6, 4.6, (nx, ny, x, y) => ((x + y) % 2 ? RED : "#A8323E"));
      l.ell(6, 6, 3.2, 3.2, ball("#F08A7E", ROSE, RED));
    }, "#4A0E14");
    g.px(4, 5, CREAM).px(5, 4, CREAM);
  },
  feather(g) {
    g.stamp((l) => feather(l, "#F4F1E8", "#C2C8D2", "#8C97A6"), "#3A3F4B");
  },
  button(g) {
    g.stamp((l) => {
      l.ell(6, 6, 4.4, 4.4, ball("#8FAAF0", "#5B7FD6", "#3F5FB0"));
      l.ring(6, 6, 3.2, "#3F5FB0");
      l.px(5, 5, "#1E2F66").px(7, 5, "#1E2F66").px(5, 7, "#1E2F66").px(7, 7, "#1E2F66");
    }, "#162048");
  },
  "good-stick"(g) {
    g.stamp((l) => {
      l.line(2, 10, 9, 3, WOOD).line(3, 10, 10, 3, BARK);
      l.line(6, 6, 6, 3, WOOD).px(6, 2, LEAF).px(7, 2, MOSS);
      l.px(10, 2, LEAF);
    }, DARK);
  },
  "pine-cone"(g) {
    g.stamp((l) => {
      l.ell(6, 6.5, 3.2, 4.2, (nx, ny, x, y) => ((x + (y % 2 ? 1 : 0)) % 2 ? "#9A6428" : "#6B4226"));
      l.px(4, 4, "#C88A45").px(6, 3, "#C88A45").px(5, 6, "#C88A45").px(7, 5, "#C88A45");
      l.rect(6, 1, 1, 1, "#4A2C16");
    }, DARK);
  },
  dandelion(g) {
    g.line(6, 7, 6, 10, MOSS).px(5, 9, LEAF);
    g.stamp((l) => l.ell(6, 4, 3.4, 3.4, (nx, ny, x, y) => ((x + y) % 2 ? "#FFFFFF" : "#DDE3EC")), "#8C97A6");
    g.px(6, 4, "#C9B26A");
    // One seed, leaving.
    g.px(10, 2, "#FFFFFF").px(10, 1, "#DDE3EC");
  },
  paperclip(g) {
    g.stamp((l) => {
      map(l, 2, 1, [
        ".hss...",
        "s...s..",
        "s...s.d",
        "s.d.s.d",
        "s.d.s.d",
        "s.d.s.d",
        "s.d.s.d",
        "s..d..d",
        "s.....d",
        ".sssdd."
      ], { s: STEEL, d: IRON, h: "#FFFFFF" });
    }, "#3A3F4B");
  },
  "snail-shell"(g) {
    g.stamp((l) => {
      l.ell(6, 6, 4.6, 4.4, ball("#F6E2B8", "#E0B878", "#B88A4A"));
      // The whorl: a turn that does not quite close, and its middle.
      l.rect(5, 4, 3, 1, WOOD).rect(8, 5, 1, 3, WOOD).rect(5, 8, 3, 1, WOOD).rect(4, 6, 1, 2, WOOD).px(6, 6, WOOD);
    }, DARK);
    g.px(3, 4, "#FFFFFF");
  },
  "pencil-stub"(g) {
    g.stamp((l) => {
      l.rect(1, 5, 2, 3, "#FF8FB0").rect(3, 5, 1, 3, STEEL);
      l.rect(4, 5, 4, 3, GOLD).rect(4, 5, 4, 1, "#FFE98A").rect(4, 7, 4, 1, BRASS);
      l.rect(8, 5, 1, 3, "#E8C28A").rect(9, 6, 1, 1, "#E8C28A").px(10, 6, INK);
    }, DARK);
  },
  clover(g) {
    g.stamp((l) => {
      // Three leaflets, each a heart with its point to the middle, and the stalk.
      map(l, 0, 0, [
        "............",
        "...hl..ll...",
        "...llllll...",
        "....llll....",
        ".hl..ll..ll.",
        ".lll.dd.lll.",
        "..lllddlll..",
        ".lll..s.lll.",
        ".ll...s..ll.",
        "......s.....",
        ".......s...."
      ], { l: LEAF, h: "#9BEFA4", d: MOSS, s: MOSS });
    }, "#14401E");
  },
  mushroom(g) {
    g.stamp((l) => {
      l.rect(5, 6, 3, 4, CREAM).rect(7, 6, 1, 4, "#E0D2B0");
      l.ell(6.5, 6, 4.6, 4, (nx, ny) => (ny > 0 ? null : nx + ny < -0.9 ? "#F06A5E" : "#D23A30"));
      l.px(4, 4, "#FFFFFF").px(7, 3, "#FFFFFF").px(9, 5, "#FFFFFF").px(6, 5, "#FFFFFF");
    }, "#3A0E0A");
  },

  // ------------------------------------------------------------ uncommon
  "ticket-stub"(g) {
    g.stamp((l) => {
      l.rect(1, 4, 9, 5, "#F2C27A").rect(1, 4, 9, 1, "#FFE0A8");
      // Torn where the rest was taken.
      l.px(10, 4, "#F2C27A").px(10, 6, "#F2C27A").px(10, 8, "#F2C27A");
      l.rect(3, 5, 1, 3, "#B8783A").rect(5, 6, 3, 1, INK).px(8, 5, RED).px(8, 7, RED);
    }, "#4A2A0A");
  },
  "lost-bookmark"(g) {
    g.line(6, 1, 6, 2, GOLD);
    g.stamp((l) => {
      l.rect(4, 2, 5, 8, RED).rect(4, 2, 1, 8, ROSE);
      l.px(4, 10, RED).px(8, 10, RED).px(5, 10, RED).px(7, 10, RED);
      l.rect(5, 4, 3, 1, GOLD).rect(5, 6, 3, 1, GOLD);
    }, "#4A0E14");
    g.px(6, 0, BRASS);
  },
  marble(g) {
    g.stamp((l) => {
      l.ell(6, 6, 4.4, 4.4, ball("#BFE8FF", "#4FA3E6", "#2F6FB0"));
      l.px(5, 7, GOLD).px(6, 6, "#FF8A3D").px(7, 6, GOLD).px(7, 5, "#FF8A3D").px(6, 8, "#FF8A3D");
    }, "#12305A");
    g.px(4, 4, "#FFFFFF").px(5, 3, "#FFFFFF");
  },
  "small-key"(g) {
    g.stamp((l) => {
      l.ell(3.5, 6, 2.6, 2.6, (nx, ny) => (nx * nx + ny * ny < 0.2 ? null : ny < -0.3 ? "#FFE98A" : BRASS));
      l.rect(6, 5, 5, 2, BRASS).rect(6, 5, 5, 1, "#FFE98A");
      l.rect(8, 7, 1, 2, BRASS).rect(10, 7, 1, 2, BRASS);
    }, "#4A3100");
  },
  "jay-feather"(g) {
    g.stamp((l) => {
      feather(l, "#4FA3E6", "#2F6FB0", "#F4F1E8");
      // The jay's bars: black and white across the light side.
      l.px(6, 2, "#12203A").px(5, 3, "#12203A").px(4, 4, "#12203A").px(3, 5, "#12203A");
      l.px(7, 2, "#E6F6FF").px(5, 4, "#E6F6FF");
    }, "#12203A");
  },
  "sea-glass"(g) {
    g.stamp((l) => {
      l.ell(6, 6.5, 4.4, 3.4, (nx, ny) => (ny < -0.75 && nx > 0 ? null : nx + ny < -0.6 ? "#D6FFF2" : nx + ny > 0.8 ? "#5FBF9F" : "#9FE3CF"));
      l.px(8, 4, "#9FE3CF");
    }, "#1E4A40");
    g.px(4, 5, "#FFFFFF");
  },
  conker(g) {
    g.stamp((l) => {
      l.ell(6, 6.5, 4.4, 3.9, ball("#B8683A", "#7A3A1C", "#4A1E0A"));
      l.ell(6, 4, 2.4, 1.3, "#E0C29A");
    }, "#2A0E04");
    g.px(4, 6, "#E8A878");
  },
  "library-card"(g) {
    g.stamp((l) => {
      l.rect(1, 3, 10, 7, CREAM).rect(1, 3, 10, 2, "#2F80E6");
      l.rect(2, 6, 3, 3, "#E8C28A").rect(6, 6, 4, 1, IRON).rect(6, 8, 3, 1, IRON);
      l.px(2, 3, "#8FC0FF");
    }, "#23262E");
  },
  die(g) {
    g.stamp((l) => {
      l.rect(2, 2, 8, 8, "#FFFFFF").rect(2, 9, 8, 1, "#C9D1DB").rect(9, 2, 1, 8, "#C9D1DB");
      l.rect(3, 3, 2, 2, "#23262E").rect(7, 3, 2, 2, "#23262E").rect(3, 7, 2, 2, "#23262E").rect(7, 7, 2, 2, "#23262E");
    }, "#23262E");
  },
  "postage-stamp"(g) {
    g.stamp((l) => {
      l.rect(2, 1, 8, 10, CREAM);
      // Perforations: every other pixel along each edge.
      for (let i = 0; i < 5; i++) l.px(1, 1 + i * 2, CREAM).px(10, 2 + i * 2, CREAM);
      for (let i = 0; i < 4; i++) l.px(2 + i * 2, 0, CREAM).px(3 + i * 2, 11, CREAM);
      l.rect(3, 2, 6, 6, "#8FAAF0").rect(3, 6, 6, 2, LEAF).px(7, 3, GOLD).px(4, 5, MOSS).px(5, 5, MOSS);
      l.rect(4, 9, 4, 1, RED);
    }, "#5A4A36");
  },
  thimble(g) {
    g.stamp((l) => {
      // Seen a little from below, so its hollow shows: h in the light, s steel,
      // d in shade, o a dimple, k the dark inside its rim.
      map(l, 0, 0, [
        "............",
        "....ssss....",
        "...hsssss...",
        "...hososd...",
        "...hsosod...",
        "...hososd...",
        "...hssssd...",
        "..hhssssdd..",
        "..skkkkkkd..",
        "...ssssdd..."
      ], { h: "#FFFFFF", s: STEEL, d: IRON, o: IRON, k: "#3A3F4B" });
    }, "#23262E");
  },

  // ------------------------------------------------------------ rare
  "tiny-fossil"(g) {
    g.stamp((l) => {
      // A flake of stone, and the ammonite pressed into it.
      l.rect(2, 2, 8, 8, "#B8AE96").rect(1, 3, 1, 5, "#B8AE96").rect(10, 4, 1, 5, "#A39880").rect(3, 10, 5, 1, "#A39880");
      l.rect(2, 2, 8, 1, "#D6CCB4").px(9, 2, "#A39880");
      l.rect(4, 3, 4, 1, "#6E6248").rect(8, 4, 1, 4, "#6E6248").rect(4, 8, 4, 1, "#6E6248").rect(3, 4, 1, 4, "#6E6248");
      l.rect(5, 5, 2, 1, "#6E6248").px(6, 6, "#6E6248").px(5, 7, "#D6CCB4").px(7, 5, "#D6CCB4");
    }, "#3E3420");
  },
  "four-leaf-clover"(g, f) {
    g.line(6, 6, 8, 10, MOSS);
    for (const [x, y] of [[4, 4], [8, 4], [4, 8], [8, 8]]) {
      g.stamp((l) => l.ell(x, y, 2, 2, (nx, ny) => (nx + ny < -0.4 ? "#A8F0A0" : "#5FD96A")), "#14401E");
    }
    g.px(6, 6, MOSS);
    if ((f >> 3) % 4 === 0) g.px(10, 1, "#FFFFFF");
  },
  "old-coin"(g) {
    g.stamp((l) => {
      l.ell(6, 6, 4.6, 4.6, ball("#FFE98A", BRASS, OLD));
      l.ring(6, 6, 3.4, OLD);
      l.rect(5, 4, 2, 1, OLD).rect(5, 5, 1, 3, OLD).rect(6, 6, 1, 1, OLD).rect(5, 8, 2, 1, OLD);
    }, "#4A3100");
  },
  compass(g) {
    g.stamp((l) => {
      l.rect(5, 0, 2, 2, BRASS);
      l.ell(6, 6.5, 4.6, 4.6, ball("#FFE98A", BRASS, OLD));
      l.ell(6, 6.5, 3.3, 3.3, CREAM);
      l.line(6, 6, 8, 4, RED).line(6, 7, 4, 9, SLATE).px(6, 6, INK);
    }, "#4A3100");
  },
  seashell(g) {
    g.stamp((l) => {
      // A scallop: a fan from its hinge, ribbed.
      l.ell(6, 5.5, 4.6, 4.4, "#FFD6E8");
      l.rect(4, 9, 4, 1, "#FFD6E8").rect(5, 10, 2, 1, "#E07AA8");
      for (const [x, y] of [[2, 5], [3, 2], [6, 1], [9, 2], [10, 5]]) l.line(6, 9, x, y, "#FF8FB8");
    }, "#5A1E3A");
    g.px(4, 4, "#FFFFFF");
  },
  "magnifying-glass"(g) {
    g.stamp((l) => {
      l.ell(5, 5, 3.6, 3.6, (nx, ny) => (nx * nx + ny * ny > 0.55 ? IRON : nx + ny < -0.3 ? "#E6F6FF" : "#BFE8FF"));
      l.line(8, 8, 10, 10, WOOD).line(8, 9, 9, 10, BARK);
    }, "#23262E");
    g.px(4, 4, "#FFFFFF");
  },
  quill(g) {
    g.stamp((l) => {
      feather(l, "#FFFFFF", "#D6DCE6", "#C9B26A");
      l.px(2, 8, BRASS).px(1, 9, INK);
    }, "#3A3F4B");
    g.px(0, 11, INK);
  },
  "sealed-letter"(g) {
    g.stamp((l) => {
      l.rect(1, 3, 10, 7, CREAM).rect(1, 9, 10, 1, "#E0D2B0");
      l.line(1, 3, 5, 7, "#C9B894").line(10, 3, 6, 7, "#C9B894");
      l.ell(6, 7, 1.6, 1.6, RED).px(5, 6, ROSE);
    }, "#5A4A36");
  },
  "tiny-bell"(g, f) {
    const swing = (f >> 2) % 4;
    g.stamp((l) => {
      l.rect(5, 1, 2, 1, BRASS);
      l.ell(6, 5, 3, 3.2, ball("#FFE98A", GOLD, BRASS));
      l.rect(3, 5, 6, 3, GOLD).rect(3, 5, 1, 3, "#FFE98A").rect(8, 5, 1, 3, BRASS);
      l.rect(2, 8, 8, 1, BRASS).rect(2, 8, 3, 1, GOLD);
      l.px(6 + (swing === 1 ? 1 : swing === 3 ? -1 : 0), 10, OLD);
    }, "#4A3100");
  },

  // ------------------------------------------------------------ epic
  "message-bottle"(g) {
    g.stamp((l) => {
      l.rect(5, 0, 2, 1, "#C88A45").rect(5, 1, 2, 2, "#BFEFE0");
      l.rect(3, 3, 6, 8, "#BFEFE0").rect(3, 3, 1, 8, "#E6FFF6").rect(8, 3, 1, 8, "#8FD0BC").rect(3, 10, 6, 1, "#8FD0BC");
      l.rect(5, 5, 2, 5, CREAM).px(5, 7, RED).px(6, 7, RED);
    }, "#1E4A40");
    g.px(4, 4, "#FFFFFF");
  },
  "map-fragment"(g) {
    g.stamp((l) => {
      l.rect(1, 2, 9, 8, PAPER).rect(1, 2, 9, 1, "#F4E6BC");
      // The torn edge.
      l.px(10, 2, PAPER).px(10, 3, PAPER).px(10, 5, PAPER).px(10, 8, PAPER).px(10, 9, PAPER);
      l.px(2, 4, INK).px(3, 5, INK).px(4, 6, INK).px(5, 6, INK).px(6, 7, INK);
      l.px(8, 6, RED).px(9, 7, RED).px(8, 8, RED).px(7, 7, RED).px(9, 5, RED);
      l.px(3, 8, MOSS).px(2, 8, MOSS).px(7, 3, "#4FA3E6").px(8, 3, "#4FA3E6");
    }, "#4A3A1A");
  },
  "pocket-watch"(g) {
    g.stamp((l) => {
      l.rect(5, 0, 2, 2, BRASS).px(8, 1, BRASS).px(9, 0, BRASS);
      l.ell(6, 6.5, 4.6, 4.6, ball("#FFE98A", GOLD, BRASS));
      l.ell(6, 6.5, 3.3, 3.3, CREAM);
      // Ten past four.
      l.line(6, 6, 7, 5, INK).line(6, 6, 8, 8, INK).px(6, 4, OLD).px(6, 9, OLD).px(3, 6, OLD).px(9, 6, OLD);
    }, "#4A3100");
  },
  geode(g, f) {
    g.stamp((l) => {
      l.ell(6, 6.5, 4.6, 4.2, ball("#A9B2BF", "#7C8594", "#5A606E"));
      l.ell(6, 6.5, 3.2, 2.8, (nx, ny, x, y) => ((x * 3 + y * 5) % 4 === 0 ? "#E6D6FF" : (x + y) % 2 ? "#8E5CFF" : "#6A3CD0"));
    }, "#23262E");
    g.px(5 + ((f >> 3) % 3), 6, "#FFFFFF");
  },
  spyglass(g) {
    g.stamp((l) => {
      l.rect(1, 5, 3, 3, BRASS).rect(1, 5, 3, 1, "#FFE98A");
      l.rect(4, 4, 3, 5, WOOD).rect(4, 4, 3, 1, "#B07A4A");
      l.rect(7, 3, 3, 7, BRASS).rect(7, 3, 3, 1, "#FFE98A").rect(7, 9, 3, 1, OLD);
      l.rect(10, 3, 1, 7, "#BFE8FF").px(10, 4, "#FFFFFF");
    }, "#4A3100");
  },
  "tiny-book"(g) {
    g.stamp((l) => {
      l.rect(2, 1, 8, 10, "#2F5039").rect(2, 1, 2, 10, "#1F3A28").rect(4, 1, 6, 1, "#3F6A4C");
      l.rect(9, 2, 1, 8, CREAM).rect(5, 3, 3, 1, GOLD).rect(5, 5, 3, 1, GOLD).rect(6, 7, 1, 2, GOLD);
      l.px(7, 11, RED);
    }, "#0E2014");
  },

  // ------------------------------------------------------------ legendary
  "star-jar"(g, f) {
    const lit = (f >> 2) % 6;
    g.stamp((l) => {
      l.rect(3, 1, 6, 2, WOOD).rect(3, 1, 6, 1, "#B07A4A");
      l.rect(2, 3, 8, 8, "#2A3A6A").rect(2, 3, 1, 8, "#5A6FB0").rect(9, 3, 1, 8, "#1B2548").rect(2, 10, 8, 1, "#1B2548");
      // The star, and its light on the glass.
      l.rect(5, 6, 3, 1, GOLD).rect(6, 5, 1, 3, GOLD).px(6, 6, "#FFFFFF");
      if (lit < 3) l.px(5, 5, "#FFE98A").px(7, 7, "#FFE98A").px(7, 5, "#FFE98A").px(5, 7, "#FFE98A");
      l.px(4, 8, lit === 1 ? "#FFE98A" : "#5A6FB0").px(8, 4, lit === 4 ? "#FFE98A" : "#5A6FB0");
    }, "#0E1430");
    g.px(3, 4, "#FFFFFF");
  },
  "golden-acorn"(g, f) {
    g.stamp((l) => {
      l.ell(6, 7.5, 2.9, 3.2, ball("#FFF6C2", GOLD, BRASS));
      l.rect(3, 3, 6, 3, BRASS).rect(4, 2, 4, 1, BRASS).rect(3, 3, 6, 1, "#FFE98A");
      l.px(4, 4, OLD).px(6, 5, OLD).px(8, 4, OLD).rect(6, 1, 1, 1, OLD);
    }, "#4A3100");
    g.px(5, 7, "#FFFFFF");
    if ((f >> 3) % 3 === 0) g.px(9, 2, "#FFFFFF").px(10, 2, "#FFE98A").px(9, 1, "#FFE98A");
  },
  "dragon-scale"(g, f) {
    const sheen = (f >> 3) % 4;
    g.stamp((l) => {
      l.ell(6, 5, 3.6, 3.8, (nx, ny) => (nx + ny < -0.5 ? "#7FFFD0" : nx + ny > 0.6 ? "#0E7A6A" : "#1FBF9A"));
      l.rect(4, 8, 5, 1, "#0E7A6A").rect(5, 9, 3, 1, "#0E7A6A").rect(6, 10, 1, 1, "#0A5A50");
      l.line(6, 2, 6, 9, "#0A5A50").px(4, 5, "#8E5CFF").px(8, 4, "#8E5CFF").px(7, 7, "#8E5CFF");
      l.px(3 + sheen, 3 + sheen, "#E6FFF6");
    }, "#06302A");
  },
  "moon-piece"(g, f) {
    g.stamp((l) => {
      // A crescent: the disc, less a bite the size of the dark.
      l.ell(5.5, 6, 4.6, 4.6, (nx, ny, x, y) => {
        if ((x + 0.5 - 8.4) ** 2 + (y + 0.5 - 4.6) ** 2 < 3.5 * 3.5) return null;
        return nx + ny < -0.5 ? "#FFFFFF" : ny > 0.55 ? "#D9CF9A" : "#FFF3C2";
      });
      l.px(3, 5, "#D9CF9A").px(4, 8, "#D9CF9A").px(2, 7, "#C9BE82").px(6, 9, "#C9BE82");
    }, "#5A5230");
    if ((f >> 3) % 2 === 0) g.px(8, 4, "#FFFFFF");
    g.px(10, 2, "#C9D1FF");
  }
};

export const FIND_ART_IDS = Object.keys(SPRITES);
export const hasFindArt = (id) => Object.prototype.hasOwnProperty.call(SPRITES, id);

/** The thing on its own layer, as the Painter left it (null for a thing with no art). */
const paint = (id, f) => {
  if (!hasFindArt(id)) return null;
  const g = new Painter(FIND_SIZE, FIND_SIZE, f);
  SPRITES[id](g, f);
  return g;
};

/**
 * The colour a 2 x 2 block of a sprite comes down to at half size: clear when
 * most of it is clear, else its commonest colour that is not the outline (the
 * outline only where the block is nothing else), so a mini keeps the thing's
 * colours and loses its edge last.
 */
const blockColour = (g, bx, by) => {
  const seen = new Map();
  let filled = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const c = g.C.d[(by * 2 + j) * FIND_SIZE + bx * 2 + i];
    if (!c) continue;
    filled += 1;
    seen.set(c, (seen.get(c) || 0) + 1);
  }
  if (filled < 2) return null;
  let best = null, most = 0, darkest = null, dark = 1e9;
  for (const [c, n] of seen) {
    const [r, gr, b] = rgba(c), light = r + gr + b;
    if (light < dark) { dark = light; darkest = c; }
    if (n > most) { most = n; best = c; }
  }
  if (seen.size > 1 && best === darkest) {
    // Not the outline if there is anything else in the block.
    most = 0;
    for (const [c, n] of seen) if (c !== darkest && n > most) { most = n; best = c; }
  }
  return best;
};

/** One find at half size, its top left at (x, y), on any Painter (the room's own picture). */
export function drawFindMini(g, x, y, id, f = 0) {
  const full = paint(id, f);
  if (!full) return g;
  for (let by = 0; by < FIND_MINI; by++) for (let bx = 0; bx < FIND_MINI; bx++) {
    const c = blockColour(full, bx, by);
    if (c) g.px(x + bx, y + by, c);
  }
  return g;
}

/** Every find in the house's item format, at full size and at half. */
export const FIND_SPRITES = FIND_ART_IDS.map((id) => ({ id, w: FIND_SIZE, h: FIND_SIZE, draw: (g, f = 0) => SPRITES[id](g, f) }));
export const FIND_MINIS = FIND_ART_IDS.map((id) => ({ id, w: FIND_MINI, h: FIND_MINI, draw: (g, f = 0) => drawFindMini(g, 0, 0, id, f) }));

/** One find at half size as its own sprite. */
export function renderFindMini(id, f = 0) {
  const g = new Painter(FIND_MINI, FIND_MINI, f);
  drawFindMini(g, 0, 0, id, f);
  return g.toImageData();
}

/** One find as its own FIND_SIZE x FIND_SIZE sprite; an empty one for an id with no art. */
export function renderFind(id, f = 0) {
  const g = paint(id, f);
  return g ? g.toImageData() : new ImageData(FIND_SIZE, FIND_SIZE);
}

/**
 * The same shape filled with one colour: how the album shows a thing not
 * found yet. Always the first frame, so the shape never changes.
 */
export function renderFindSilhouette(id, colour = "#00000055") {
  const out = new ImageData(FIND_SIZE, FIND_SIZE);
  const g = paint(id, 0);
  if (!g) return out;
  const [r, gr, b, a] = rgba(colour);
  for (let i = 0; i < FIND_SIZE * FIND_SIZE; i++) {
    if (!g.C.d[i]) continue;
    out.data[i * 4] = r; out.data[i * 4 + 1] = gr; out.data[i * 4 + 2] = b; out.data[i * 4 + 3] = a;
  }
  return out;
}
