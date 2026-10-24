/* The raid field's art (the Magpie Lands, 2026-10-24): a stronghold's pieces and its sentries, larger than the old
 raid's and in the camp's 3/4 pixel art, for the raid screens (components/pip/arcade/base/raidPaint.ts). Part of the
 Hollow's art: base-art.js puts these in BASE_SPRITES, so they are drawn and kept the same way (the room's painter,
 outlined, every draw a pure function of (f, opts)), each standing on the bottom row of its own canvas, centred.
 Our own pictures, nobody else's.

 raidperch  22 x 34  4 frames: a sentry magpie on a watch post. 0 watching the way in, 1 winding up (a pebble
                     drawn back over its head: the tell), 2 throwing, 3 the post with nobody on it (what tips over
                     once it falls; the sentry flies off). variant 1 the watch-crow's post: a crow, and a bell.
                     opts.rank 1 and 2: cracked, and more so
 raidwall   12 x 22  a section of a stronghold's palisade, sharpened stakes and two bindings, face on (the wall
                     across the picture: the field turned upright); sections ten apart join up. variant 1 the stout
                     gate, 2 the weak gate; 3 to 5 the same three running up the picture (the field as it lies
                     wide). rank cracked
 raidhoard  24 x 20  a sack of loot slumped against a heap of it; rank 1 and 2 torn
 raidnest   50 x 48  a stronghold's nest: a woven twig tower on an old stump, the nest on top, its pennant.
                     variant the region, 0 to 5 (the pennant's colours; from the third, a ring of stones at the
                     foot). rank cracked
 raidrubble 44 x 16  what is left once a thing falls, and stays for the rest of the raid: variant 0 a section of
                     wall, 1 a gate, 2 a perch, 3 a hoard, 4 the nest, 5 a building of a friend's camp
 raidzone   16 x 12  a hazard: variant 0 a clump of thorns, 1 a pit under leaves (scuffed, as a careful eye would
                     see it), 2 a pit sprung, 3 reeds at the ford's edge
 raidflag    8 x 12  a group's pennant, where its approach begins; variant 0 to 3 its colour (`FLAG_COLOURS`)
*/
import { rnd } from "./room.js";

const INK = "#2A1A10", INK_STONE = "#23262F", INK_GOLD = "#4A3100", INK_BIRD = "#0B0B14", CRACK = "#1A120C";
const STICK = ["#B88350", "#946235", "#6B4226", "#4E2E16"];
const TIMBER = ["#DCA662", "#BA8048", "#8E5C30", "#643C1C"];
const PLANK = ["#A8743E", "#7E5228", "#573518", "#3A2410"];
const STONE = ["#E3E8EF", "#B4BCC8", "#8C97A6", "#6A7482"];
const GOLD = ["#FFF6C2", "#FFD23F", "#E0A800"];
const TWIG = ["#A88A68", "#7A5E46", "#54402E", "#3A2A1E"];
const ROOK = ["#AEB4C2", "#7E8698", "#596074", "#3E4456"];
const DEADWOOD = ["#A89880", "#7E6E5C", "#56493C"];
const CLOTH = ["#FFF6DF", "#E8D4A0", "#C9AE74"];
const SACK = ["#E8D1A0", "#C9A86E", "#9C7A48", "#6E5430"];
const IRON = ["#9AA3B2", "#5E6676", "#3A404C"];
/** The magpie: K black, W white, w white in shade, B blue, b blue in the light, T teal, G its beak. */
const PIE = { K: "#1E1E2A", W: "#FFFFFF", w: "#CFD8E4", B: "#2F6FD0", b: "#7FB2FF", T: "#1F8A9A", G: "#8A8A98", S: "#C4CCD8" };
/** The watch-crow: black all over, a grey nape, a purple sheen. Told from the magpies at a glance. */
const CROW = { K: "#16161E", W: "#5C6274", w: "#474C5C", B: "#4A3A7A", b: "#8A78C0", T: "#2A2440", G: "#3A3A48", S: "#C4CCD8" };
/** A pennant's colours by region: the Twig Nest woods to the Far Rookeries. */
const PENNANTS = [
  ["#9A78D0", "#5E3AB8"],
  ["#EE8068", "#C8453B"],
  ["#7FD6D0", "#1F8A9A"],
  ["#FFE36B", "#E0A800"],
  ["#5C6274", "#2A2E3A"],
  ["#B9A8FF", "#463F70"]
];
/** A group's colours, light and dark: the trail's gold, then sky, rose and leaf. */
export const FLAG_COLOURS = [
  ["#FFE36B", "#E0A800"],
  ["#9CD8FF", "#2F80E6"],
  ["#FFB3D1", "#D9417A"],
  ["#A6E27C", "#3F9A4E"]
];

const mod = (f, n) => ((Math.round(Number(f) || 0) % n) + n) % n;
const level = (o, max) => Math.max(0, Math.min(max, Math.round(Number(o && o.variant) || 0)));
const rankOf = (o) => Math.max(0, Math.min(2, Math.round(Number(o && o.rank) || 0)));

/** A small picture as rows of letters: `key` gives each letter its colour, and a dot is empty. */
const chart = (l, x, y, rows, key) => {
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (key[row[i]]) l.px(x + i, y + j, key[row[i]]); });
  return l;
};

/** A dome standing on row `by`, `ry` rows tall and `rx` each side of cx (base-art.js has the same). */
const dome = (l, cx, by, rx, ry, col, p = 2) => {
  const half = (j) => (j >= ry ? 0 : Math.max(1, Math.round(rx * Math.pow(1 - Math.pow((j + 0.5) / ry, p), 1 / p))));
  for (let j = 0; j < ry; j++) {
    const hw = half(j), up = half(j + 1);
    for (let i = -hw; i < hw; i++) {
      const c = typeof col === "function" ? col((i + 0.5) / hw, (j + 0.5) / ry, cx + i, by - j, i < -up || i >= up) : col;
      if (c) l.px(cx + i, by - j, c);
    }
  }
  return l;
};
const twig = (x, y) => ((x + y * 2) % 5 === 0 ? TWIG[2] : (x * 2 - y * 3 + 90) % 7 === 0 ? TWIG[0] : TWIG[1]);
const shine = (u, t, x, y, edge) => (edge ? GOLD[0] : (x * 3 + y * 5) % 4 === 0 ? GOLD[2] : (x + y * 2) % 5 === 0 ? GOLD[0] : GOLD[1]);
const coin = (l, x, y) => l.rect(x, y, 2, 2, GOLD[1]).px(x, y, GOLD[0]).px(x + 1, y + 1, GOLD[2]);
const acorn = (l, x, y) => l.rect(x, y, 2, 1, "#6B4226").px(x, y + 1, "#FFD98A").px(x + 1, y + 1, "#E0A040").px(x, y + 2, "#E0A040").px(x + 1, y + 2, "#B06A28");

/**
 * Cracks: dark jagged lines run down over whatever is already painted (and only over that), from a few points the
 * rank chooses. The same cracks every time for the same sprite: the seed is fixed.
 */
const cracks = (g, n, starts, seed) => {
  starts.slice(0, n === 1 ? Math.ceil(starts.length / 2) : starts.length).forEach(([x0, y0, len], k) => {
    let x = x0;
    for (let i = 0; i < len; i++) {
      const y = y0 + i;
      if (g.get(x, y)) g.px(x, y, CRACK);
      const r = rnd(seed + k * 31 + i * 7);
      if (r > 0.66) x += 1;
      else if (r < 0.33) x -= 1;
    }
  });
};

// ---------------------------------------------------------------- a sentry on its watch post
/** Watching the way in (left), leaning back with a pebble over its head, and lunging forward as it throws. */
const SENTRY = [
  ["...KKK.....", "..KKKKK....", "GGKSKKK....", "..KKKKKK...", "..KWWWBBK..", "..WWWWBbBK.", "..WWWWBBBKT", "...WWwKBTTT", "....K..K.TT", "....K..K..."],
  [".......SS..", "....KK.KBb.", "...KKKKKBB.", "GGKSKKKBB..", "..KKKKKB...", "..KWWWWKK..", "..WWWWWBK..", "...WWWwBKTT", "....K..KTTT", "....K..K..."],
  ["...........", "..KKK......", "GKSKKK.....", "BbKKKKK....", "BBKWWWKK...", ".BWWWWWBK..", "..WWWWBBKTT", "...WWwKBTTT", "....K..K...", "....K..K..."]
];

const raidperch = {
  w: 22, h: 34, frames: 4,
  draw(g, f, o) {
    const k = mod(f, 4), crow = level(o, 1) === 1, G = 32;
    // The footing: a few stones bedded round the post.
    g.stamp((l) => l.ell(11, G - 0.5, 5.5, 2, (nx, ny) => (ny < -0.2 ? ROOK[0] : nx > 0.4 ? ROOK[2] : ROOK[1])), INK_STONE);
    // Two braces, then the post, lashed twice.
    g.stamp((l) => {
      l.line(4, G - 1, 9, G - 10, STICK[2]).line(5, G - 1, 10, G - 10, STICK[1]);
      l.line(18, G - 1, 13, G - 10, STICK[2]).line(17, G - 1, 12, G - 10, STICK[1]);
      l.rect(10, 15, 3, G - 15, TIMBER[1]).rect(10, 15, 1, G - 15, TIMBER[0]).rect(12, 15, 1, G - 15, TIMBER[2]);
      l.rect(10, 21, 3, 1, CLOTH[1]).rect(10, 27, 3, 1, CLOTH[1]).px(12, 21, CLOTH[2]).px(12, 27, CLOTH[2]);
    }, INK);
    // The platform, seen a little from above: the boards' tops, then their edge.
    g.stamp((l) => {
      l.rect(3, 12, 16, 2, PLANK[0]).rect(3, 14, 16, 1, PLANK[2]);
      for (let x = 6; x < 19; x += 4) l.px(x, 12, PLANK[1]).px(x, 13, PLANK[1]);
      l.px(3, 15, PLANK[3]).px(18, 15, PLANK[3]);
    }, INK);
    // The basket of pebbles at its far end.
    g.stamp((l) => l.rect(15, 9, 4, 3, CLOTH[2]).rect(15, 9, 4, 1, CLOTH[1]).px(16, 8, STONE[1]).px(17, 8, STONE[0]).px(18, 9, STONE[2]), INK);
    // The watch-crow's bell, under the near end of the platform.
    if (crow) g.stamp((l) => l.px(5, 15, STICK[2]).rect(4, 16, 3, 1, GOLD[0]).rect(3, 17, 5, 2, GOLD[1]).rect(3, 19, 5, 1, GOLD[2]).px(5, 20, IRON[2]), INK_GOLD);
    if (k < 3) g.stamp((l) => chart(l, 4, 2, SENTRY[k], crow ? CROW : PIE), INK_BIRD);
    const rank = rankOf(o);
    if (rank > 0) cracks(g, rank, [[11, 16, 9], [12, 23, 8], [7, 12, 3], [15, 12, 3]], 17);
  }
};

// ---------------------------------------------------------------- the palisade, and its gates
const STAKES = [13, 15, 14, 15, 13];
/**
 * A section of palisade running up the picture (the field as it lies wide: the wall stands across the trail, from the
 * top of the field to its foot). Seen from the near side: the stakes' sharpened tops in a band, their shaded flank
 * toward the trail, the section's near end at its foot. Ten apart, the bands join into one wall. The gates are a
 * break in the band: a heavy door's top banded with iron, or a few loose boards.
 */
const along = (g, kind, G) => {
  if (kind === 0) {
    g.stamp((l) => {
      for (let y = G - 18; y <= G - 6; y++) {
        const tip = (y + 18) % 2 === 0;
        l.px(3, y, TIMBER[2]).px(4, y, TIMBER[2]);
        for (let x = 5; x < 9; x++) l.px(x, y, tip && x % 2 ? "#F0D9A8" : x === 8 ? TIMBER[2] : (x + y) % 3 === 0 ? TIMBER[1] : TIMBER[0]);
      }
      // Its near end: the stakes' feet and one binding.
      for (let y = G - 6; y <= G; y++) for (let x = 3; x < 9; x++) l.px(x, y, y === G ? TIMBER[3] : x < 5 ? TIMBER[2] : x % 2 ? TIMBER[1] : TIMBER[0]);
      l.rect(3, G - 3, 6, 1, PLANK[2]).px(5, G - 3, CLOTH[1]);
    }, INK);
    return;
  }
  if (kind === 1) {
    // The stout gate: two heavy posts with the door's top between, banded with iron.
    g.stamp((l) => {
      for (const y of [G - 19, G - 7]) l.rect(2, y, 8, 3, TIMBER[1]).rect(2, y, 8, 1, TIMBER[0]).px(9, y + 2, TIMBER[3]);
      for (let y = G - 16; y < G - 7; y++) for (let x = 4; x < 8; x++) l.px(x, y, x % 2 ? PLANK[1] : PLANK[0]);
      l.rect(4, G - 13, 4, 1, IRON[1]).rect(4, G - 10, 4, 1, IRON[1]).px(5, G - 13, IRON[0]);
      for (let y = G - 4; y <= G; y++) l.rect(3, y, 6, 1, y === G ? TIMBER[3] : TIMBER[1]);
    }, INK);
    g.stamp((l) => l.line(6, G - 20, 8, G - 23, PIE.K).px(8, G - 24, PIE.W).px(7, G - 22, PIE.B), INK_BIRD);
    return;
  }
  // The weak gate: a gap in the band, a couple of loose boards across it, a rope.
  g.stamp((l) => {
    l.rect(3, G - 18, 6, 3, TIMBER[0]).rect(3, G - 16, 6, 1, TIMBER[2]);
    l.line(4, G - 13, 8, G - 11, STICK[1]).line(4, G - 9, 8, G - 8, STICK[0]);
    for (let y = G - 4; y <= G; y++) l.rect(3, y, 6, 1, y === G ? TIMBER[3] : TIMBER[1]);
  }, INK);
  g.px(5, G - 11, CLOTH[0]).px(6, G - 10, CLOTH[1]);
};

const raidwall = {
  w: 12, h: 22,
  draw(g, f, o) {
    const kind = level(o, 5), G = 20;
    if (kind >= 3) {
      along(g, kind - 3, G);
      const rank = rankOf(o);
      if (rank > 0) cracks(g, rank, [[6, G - 16, 7], [5, G - 6, 5]], 47 + kind);
      return;
    }
    if (kind === 0) {
      g.stamp((l) => {
        STAKES.forEach((tall, s) => {
          const x = 1 + s * 2;
          for (let y = G - tall; y <= G; y++) {
            l.px(x, y, y === G ? TIMBER[3] : s % 2 ? TIMBER[1] : TIMBER[0]);
            l.px(x + 1, y, y === G ? TIMBER[3] : TIMBER[2]);
          }
          // Sharpened: a pale point.
          l.px(x, G - tall - 1, "#F0D9A8");
        });
        for (const y of [G - 4, G - 10]) l.rect(1, y, 10, 1, PLANK[2]).px(3, y, CLOTH[1]).px(8, y, CLOTH[1]);
      }, INK);
    } else if (kind === 1) {
      // The stout gate: two tall posts, a plank door between them banded with iron, and a ring.
      g.stamp((l) => {
        for (const x of [0, 10]) l.rect(x, G - 17, 2, 18, TIMBER[1]).rect(x, G - 17, 1, 18, TIMBER[0]).px(x, G - 18, "#F0D9A8");
        l.rect(2, G - 13, 8, 1, TIMBER[2]);
        for (let x = 2; x < 10; x++) for (let y = G - 12; y <= G; y++) l.px(x, y, x % 2 ? PLANK[1] : PLANK[0]);
        for (const y of [G - 10, G - 3]) l.rect(2, y, 8, 1, IRON[1]).px(3, y, IRON[0]).px(8, y, IRON[0]);
        l.px(6, G - 6, GOLD[2]).px(5, G - 7, GOLD[2]).px(5, G - 5, GOLD[2]).px(4, G - 6, GOLD[2]);
      }, INK);
      // A tail feather pinned over it, for the stronghold's pride.
      g.stamp((l) => l.line(6, G - 14, 8, G - 19, PIE.K).px(7, G - 16, PIE.B).px(8, G - 20, PIE.W), INK_BIRD);
    } else {
      // The weak gate: thin posts, a crooked door of a few boards with gaps, held shut by a loop of rope.
      g.stamp((l) => {
        for (const x of [1, 10]) l.rect(x, G - 13, 1, 14, STICK[1]).px(x, G - 14, "#F0D9A8");
        for (const [x, top] of [[2, 9], [4, 10], [7, 9], [8, 8]]) l.rect(x, G - top, 2, top + 1, x % 4 === 0 ? STICK[0] : STICK[1]);
        l.line(2, G - 6, 9, G - 7, STICK[2]);
        l.px(9, G - 4, CLOTH[0]).px(10, G - 5, CLOTH[1]);
      }, INK);
    }
    const rank = rankOf(o);
    if (rank > 0) cracks(g, rank, [[4, G - 12, 9], [8, G - 9, 8], [2, G - 5, 4]], 41 + kind);
  }
};

// ---------------------------------------------------------------- a hoard
const raidhoard = {
  w: 24, h: 20,
  draw(g, f, o) {
    const G = 18, rank = rankOf(o);
    g.ell(12, G, 11, 2, "#3A2A1E30");
    // The sack, slumped, its neck tied with cord.
    g.stamp((l) => {
      dome(l, 9, G, 7, 12, (u, t, x, y, edge) => (edge ? SACK[0] : u > 0.55 ? SACK[2] : (x * 3 + y * 2) % 7 === 0 ? SACK[2] : u < -0.6 ? SACK[0] : SACK[1]), 2.4);
      l.rect(7, G - 14, 4, 2, SACK[1]).px(7, G - 14, SACK[0]).rect(7, G - 12, 4, 1, STICK[2]).px(11, G - 12, STICK[1]);
    }, INK);
    // The heap that spills from it: coins, acorns, a red button, a spoon, a blue bead.
    g.stamp((l) => dome(l, 16, G, 7, 6, shine), INK_GOLD);
    g.stamp((l) => { coin(l, 13, G - 6); coin(l, 18, G - 4); acorn(l, 15, G - 9); acorn(l, 20, G - 3); }, INK_GOLD);
    g.stamp((l) => l.ell(12, G - 2, 1.8, 1.6, (nx, ny) => (nx + ny < -0.4 ? "#FF8A7A" : "#E0393E")).px(11, G - 3, "#7A1418").px(12, G - 2, "#7A1418"), INK);
    g.stamp((l) => l.line(18, G - 8, 21, G - 12, STONE[1]).ell(22, G - 13, 1.4, 1.8, (nx, ny) => (nx + ny < -0.3 ? "#FFFFFF" : STONE[0])), INK_STONE);
    g.stamp((l) => l.px(17, G - 1, "#BDEBFF").px(16, G, "#3EC1F0").px(17, G, "#1E88C8"), "#0E3A5A");
    g.px(14, G - 7, "#FFFFFF").px(19, G - 6, "#FFFFFF");
    if (rank > 0) {
      // Torn: a slit down the sack with the gold showing through, then another.
      g.stamp((l) => { l.line(6, G - 9, 7, G - 4, CRACK); l.px(7, G - 6, GOLD[1]); if (rank > 1) { l.line(10, G - 11, 12, G - 7, CRACK); l.px(11, G - 9, GOLD[1]); } }, INK);
    }
  }
};

// ---------------------------------------------------------------- the nest
const raidnest = {
  w: 50, h: 48,
  draw(g, f, o) {
    const region = level(o, 5), G = 46, cx = 25, [light, dark] = PENNANTS[region];
    // The pennant, flown from a pole stuck through the nest.
    g.stamp((l) => l.rect(36, 2, 1, 16, STICK[1]).px(36, 1, GOLD[0]), INK);
    g.stamp((l) => { for (let j = 0; j < 7; j++) l.rect(37, 3 + j, Math.max(1, 8 - j - (j > 3 ? 1 : 0)), 1, j === 0 ? light : j % 3 === 2 ? dark : light); l.rect(38, 5, 2, 2, PIE.W).px(39, 7, PIE.K); }, INK);
    // An old stump, roots flared, the tower woven up out of it.
    g.stamp((l) => {
      for (let j = 0; j < 10; j++) {
        const flare = j === 0 ? 3 : j === 1 ? 2 : j === 2 ? 1 : 0;
        for (let x = 17 - flare; x < 33 + flare; x++) l.px(x, G - j, x < 20 ? DEADWOOD[0] : x > 29 ? DEADWOOD[2] : (x * 5 + j * 3) % 7 === 0 ? DEADWOOD[2] : DEADWOOD[1]);
      }
    }, INK);
    const tall = 16 + Math.min(4, region);
    g.stamp((l) => dome(l, cx, G - 8, 12, tall, (u, t, x, y, edge) => (edge ? TWIG[0] : u > 0.6 ? TWIG[2] : u < -0.7 ? TWIG[0] : twig(x, y)), 3), INK);
    // A dark way in, and two slits to look out of.
    g.stamp((l) => { dome(l, cx, G - 8, 3, 6, "#1E1620"); l.rect(cx - 7, G - 18, 2, 2, "#1E1620").rect(cx + 5, G - 18, 2, 2, "#1E1620"); }, INK);
    // The nest on top, heaped with what was taken, a blue egg among it.
    const rim = G - 8 - tall + 2;
    g.stamp((l) => l.ell(cx + 1, rim - 2, 2, 2, (nx, ny) => (nx + ny < -0.4 ? GOLD[0] : nx + ny > 0.6 ? GOLD[2] : GOLD[1])).ell(cx - 6, rim - 1, 2, 2, (nx, ny) => (nx + ny < -0.4 ? GOLD[0] : GOLD[1])), INK_GOLD);
    g.stamp((l) => l.ell(cx + 7, rim - 2, 1.8, 2.2, (nx, ny) => (nx + ny < -0.3 ? "#E6F7FF" : "#9CD8FF")), "#2A5A7A");
    g.stamp((l) => {
      for (let j = 0; j < 8; j++) {
        const t = j / 7, hw = Math.round(16 * (j === 0 ? 0.92 : 1 - 0.45 * t * t));
        for (let i = -hw; i < hw; i++) { const x = cx + i, y = rim + j; l.px(x, y, j === 0 ? (x % 3 === 0 ? TWIG[1] : TWIG[0]) : j === 7 || i >= hw - 1 ? TWIG[2] : twig(x, y)); }
      }
      l.line(cx - 16, rim, cx - 19, rim - 3, TWIG[1]).line(cx + 15, rim + 1, cx + 19, rim - 2, TWIG[1]).line(cx - 12, rim, cx - 13, rim - 3, TWIG[0]);
    }, INK);
    // From the third region on, a ring of stones round the foot.
    if (region >= 2) {
      g.stamp((l) => {
        for (let i = 0; i < 44; i++) {
          const x = 3 + i, rows = 4 + ((i * 7) % 3 === 0 ? 1 : 0);
          for (let j = 0; j < rows; j++) { const seam = j === 2 || (i + (j > 2 ? 3 : 0)) % 6 === 5; l.px(x, G - j, i === 0 ? ROOK[0] : i >= 42 ? ROOK[3] : seam ? ROOK[2] : j === rows - 1 ? ROOK[0] : ROOK[1]); }
        }
      }, INK_STONE);
    }
    const rank = rankOf(o);
    if (rank > 0) cracks(g, rank, [[cx - 4, G - 8 - tall + 4, 12], [cx + 6, G - 20, 10], [cx - 10, rim + 1, 5], [cx + 3, G - 9, 8]], 63 + region);
  }
};

// ---------------------------------------------------------------- what is left
const raidrubble = {
  w: 44, h: 16,
  draw(g, f, o) {
    const kind = level(o, 5), G = 14, cx = 22;
    g.ell(cx, G, kind === 4 ? 18 : 12, 2.4, "#3A2A1E2C");
    if (kind === 0) {
      // A section of wall: snapped stakes lying where they fell, splinters about.
      g.stamp((l) => {
        [[14, G, 26, G - 4], [16, G - 1, 30, G - 2], [18, G, 24, G - 6], [13, G - 2, 22, G - 3]].forEach(([x0, y0, x1, y1], k) => l.line(x0, y0, x1, y1, TIMBER[k % 3]).line(x0, y0 + 1, x1, y1 + 1, TIMBER[2]));
        l.px(26, G - 5, "#F0D9A8").px(30, G - 3, "#F0D9A8").px(11, G, TIMBER[1]).px(32, G, TIMBER[2]);
        l.rect(19, G - 2, 6, 1, PLANK[2]);
      }, INK);
    } else if (kind === 1) {
      // A gate: its door down flat, an iron band across it, one post still standing, snapped short.
      g.stamp((l) => {
        for (let i = 0; i < 14; i++) for (let j = 0; j < 4; j++) l.px(15 + i - j, G - j, i % 2 ? PLANK[1] : PLANK[0]);
        l.line(15, G - 1, 28, G - 1, IRON[1]).px(20, G - 1, IRON[0]);
        l.rect(30, G - 6, 2, 7, TIMBER[1]).px(30, G - 6, "#F0D9A8").px(31, G - 7, TIMBER[0]);
      }, INK);
    } else if (kind === 2) {
      // A perch: the post on its side, the platform's boards scattered, the basket tipped and its pebbles out.
      g.stamp((l) => {
        l.line(10, G, 30, G - 5, TIMBER[1]).line(10, G - 1, 30, G - 6, TIMBER[0]).line(11, G + 0, 30, G - 4, TIMBER[2]);
        l.rect(31, G - 7, 5, 2, PLANK[0]).rect(31, G - 5, 5, 1, PLANK[2]);
        l.rect(4, G - 2, 4, 2, PLANK[1]).rect(36, G - 1, 4, 1, PLANK[1]);
      }, INK);
      g.stamp((l) => l.rect(16, G - 3, 4, 3, CLOTH[2]).px(21, G, STONE[1]).px(23, G - 1, STONE[0]).px(25, G, STONE[2]), INK);
      g.stamp((l) => l.line(6, G - 4, 9, G - 6, PIE.K).px(9, G - 6, PIE.W).px(7, G - 5, PIE.B), INK_BIRD);
    } else if (kind === 3) {
      // A hoard: the sack empty and flat, folded on itself, a coin or two and an acorn left behind.
      g.stamp((l) => { l.ell(cx - 2, G - 1.5, 9, 2.6, (nx, ny) => (ny < -0.2 ? SACK[0] : nx > 0.5 ? SACK[2] : SACK[1])); l.line(cx - 8, G - 2, cx + 4, G - 2, SACK[2]); }, INK);
      g.stamp((l) => { coin(l, cx + 9, G - 1); coin(l, cx - 13, G - 1); acorn(l, cx + 5, G - 3); }, INK_GOLD);
    } else if (kind === 4) {
      // The nest: a low heap of twigs, sticks thrown clear, feathers stuck in it, the egg in pieces.
      g.stamp((l) => {
        dome(l, cx, G, 16, 6, (u, t, x, y, edge) => (edge ? TWIG[0] : u > 0.6 ? TWIG[2] : twig(x, y)), 2);
        l.line(cx - 18, G, cx - 13, G - 3, TWIG[1]).line(cx + 14, G - 2, cx + 20, G, TWIG[1]).line(cx - 4, G - 5, cx - 7, G - 9, TWIG[1]).line(cx + 6, G - 5, cx + 10, G - 9, TWIG[0]);
      }, INK);
      g.stamp((l) => l.line(cx - 2, G - 5, cx + 1, G - 11, PIE.K).px(cx, G - 8, PIE.B).px(cx + 1, G - 12, PIE.W).line(cx + 12, G - 3, cx + 16, G - 6, PIE.K).px(cx + 16, G - 7, PIE.W), INK_BIRD);
      g.stamp((l) => l.px(cx - 9, G - 5, "#E6F7FF").px(cx - 8, G - 6, "#9CD8FF").px(cx - 10, G - 4, "#9CD8FF"), "#2A5A7A");
    } else {
      // A building: a heap of boards and stones.
      g.stamp((l) => dome(l, cx, G, 11, 5, (u, t, x, y, edge) => (edge ? ROOK[0] : (x + y) % 3 === 0 ? ROOK[2] : ROOK[1]), 2), INK_STONE);
      g.stamp((l) => l.line(cx - 12, G, cx - 3, G - 6, PLANK[0]).line(cx + 2, G - 5, cx + 12, G, PLANK[1]).line(cx - 6, G - 1, cx + 6, G - 2, PLANK[2]), INK);
    }
  }
};

// ---------------------------------------------------------------- hazards
const raidzone = {
  w: 16, h: 12,
  draw(g, f, o) {
    const kind = level(o, 3), G = 11;
    if (kind === 0) {
      // Thorns: arching stems, dark leaves, pale thorns, a few red berries.
      g.stamp((l) => {
        l.line(2, G, 6, G - 7, "#4A2E1E").line(6, G - 7, 10, G - 2, "#4A2E1E").line(7, G, 11, G - 8, "#3E2A1E").line(11, G - 8, 14, G - 1, "#3E2A1E").line(4, G, 9, G - 9, "#56382A");
        [[4, G - 4], [9, G - 6], [12, G - 4], [7, G - 2], [5, G - 7]].forEach(([x, y]) => l.px(x, y, "#2F6B3A").px(x + 1, y, "#245A30"));
      }, "#1A120C");
      [[3, G - 3], [8, G - 8], [13, G - 5], [10, G - 3]].forEach(([x, y]) => g.px(x, y, "#F0E4C0"));
      g.px(6, G - 5, "#C8453B").px(11, G - 6, "#C8453B").px(9, G - 1, "#E0393E");
      return;
    }
    if (kind === 1) {
      // A pit hidden: a patch of leaves a little too neat, sticks laid across under them.
      g.ell(8, G - 3, 6, 2.6, "#3A2A1E22");
      g.line(3, G - 4, 13, G - 2, TWIG[1]).line(4, G - 2, 12, G - 4, TWIG[2]);
      [[4, G - 3, "#C9A24A"], [7, G - 4, "#B87A30"], [10, G - 3, "#D8B060"], [6, G - 2, "#9A7A3A"], [12, G - 3, "#B87A30"], [8, G - 2, "#C9A24A"]].forEach(([x, y, c]) => g.px(x, y, c).px(x + 1, y, c));
      return;
    }
    if (kind === 2) {
      // A pit sprung: a dark hole with a raw earth rim and the sticks that covered it snapped at its edges.
      g.stamp((l) => l.ell(8, G - 3, 6.5, 3.4, (nx, ny) => (ny < -0.45 ? "#7A5230" : ny > 0.55 ? "#9A6E40" : "#1A120C")), INK);
      g.line(1, G - 4, 4, G - 3, TWIG[1]).line(12, G - 2, 15, G - 4, TWIG[1]).px(7, G - 6, TWIG[0]);
      return;
    }
    // Reeds at the water's edge, with their brown heads.
    for (let k = 0; k < 4; k++) {
      const x = 3 + k * 3, top = G - 7 - (k % 2) * 2;
      g.stamp((l) => l.rect(x, top, 1, G - top + 1, k % 2 ? "#6E8E4A" : "#5A7A3A").rect(x, top - 2, 1, 2, "#7A5230"), "#1E3A1E");
    }
  }
};

const raidflag = {
  w: 8, h: 12,
  draw(g, f, o) {
    const [light, dark] = FLAG_COLOURS[level(o, FLAG_COLOURS.length - 1)];
    g.stamp((l) => l.rect(1, 1, 1, 11, STICK[1]).px(1, 0, GOLD[0]), INK);
    g.stamp((l) => { for (let j = 0; j < 5; j++) l.rect(2, 1 + j, Math.max(1, 5 - Math.abs(j - 2) * 2 + 1), 1, j === 4 ? dark : light); }, INK);
  }
};

export const RAID_SPRITES = { raidperch, raidwall, raidhoard, raidnest, raidrubble, raidzone, raidflag };
