/* Art for The Hollow, the base-building game in the Attic Arcade: Pip's camp
 in a forest clearing. Pure art, like games-art.js: the rules and the screen
 live in the page, and every draw is a pure function of (f, opts).

 BASE_SPRITES = {
   bg        240 x 120  the clearing, a still; opts.variant 0 to 3 is summer, autumn,
                        winter, spring by day, 4 to 7 the same four by night
   burrow     48 x 40   Pip's home
   oak        40 x 48   the acorn oak
   store      32 x 28   the larder
   fence      72 x 18   the wall across the front
   tower      22 x 44   the lookout
   hut        32 x 30   the scouts' hut
       for those six, opts.variant is the level: 0 an empty plot, 1 to 5 built
   scaffold   28 x 24   8 frames, drawn over a building while it is built
   acorn       9 x 9    the currency
   magpie     18 x 14   6 frames, a raider in flight, facing left
   nest       44 x 34   a magpie camp; opts.variant is the tier, 0 to 4

   workshop, hive, well, stall   30 x 28 each, the yard; opts.variant is the level:
                        0 an empty plot, 1 to 3 built
   trophy     16 x 20   opts.variant 0 to 10, one for each kind of book: books, wizard's
                        hat, telescope, magnifying glass, heart topiary, gravestone,
                        broken column, globe, quill, lighthouse, kite
   banner     12 x 26   a season banner on a pole; opts.variant 0 to 3, summer to spring
   decor      20 x 18   things set down on the grass; opts.variant 0 to 17: flower bed,
                        lantern post, bench, pond, scarecrow, mushroom ring, bird bath,
                        log pile, signpost, picnic, campfire, hammock, birdhouse, wishing
                        well, swing, book nook, flower arch, tiny windmill
   king       56 x 44   the Magpie King's roost
   hedgehog   22 x 18   4 frames, the travelling trader, facing left
   lantern    12 x 14   4 frames, a lit lantern and its glow, for the top of the lookout
   burst      24 x 24   8 frames, played once over a building just finished
   scout      14 x 14   4 frames, one of Pip's scouts running right with a twig sword
   slinger    14 x 14   4 frames, a scout with a sling
   mole       16 x 12   4 frames, a mole with a miner's lamp, scurrying right

   perch      16 x 26   a sentry magpie on a post; variant 1 is the post broken, empty
   hoard      20 x 14   a pile of loot; variant 1 is the spot picked clean
   twigwall   10 x 14   one length of twig wall, made to stand in a row; variant 1 is flat
   nestdown   44 x 34   a nest pulled down
   kingdown   56 x 44   the roost broken, the crown on the ground
   pebble      4 x 4    a slung stone
   battleground 240 x 120  the magpies' ground, all of it ground; opts.variant 0 to 3,
                        summer to spring

   hero       18 x 20   4 frames, a story hero walking right; opts.variant 0 to 9: the
                        librarian, a young wizard, a sea-born camper, a mist thief, an
                        archer, a detective, an old wizard, a star captain, a lady with
                        a parasol, a monster hunter. Our own characters, nobody else's
   champion   22 x 24   4 frames, a magpie villain facing left; opts.variant 0 to 5:
                        Scratch, the Bramble Baron, Tin-Eye, the Crow Regent, Lord Roost,
                        the Hoarder King
   raider     16 x 14   4 frames, a magpie on foot with a sack, hopping right; frame 2
                        is off the ground
   fencepiece 10 x 14   one length of `fence`, made to stand in a row; opts.variant is
                        the level, 1 to 5 (0 draws 1)
   ring       40 x 40   a dashed circle, how far a lookout throws; variant 0 yellow, 1 red

   guardian   16 x 22   6 frames, a defender facing right: 0 and 1 standing at its post,
                        breathing; 2 to 5 four steps to the right (feet apart on 2 and 4,
                        together and the body a pixel higher on 3 and 5). The frame wraps.
                        opts.variant 0 to 6: Halvar Longstride the ranger, Corwin Blackcloak
                        of the cold wall, Mossgather the tree-shepherd (he lumbers), Dame
                        Berit Tallshield, Emberling the very small dragon (she does not
                        walk: 2 to 5 are a beat of her wings), Pim Greenhand the gardener,
                        Ilsa Reedwhistle the archer. Our own characters too.
                        opts.rank 1 to 3 is how well kitted they are; none, or anything
                        else, draws 3. Nobody has a weapon in the hand: the screen draws it
   animal     16 x 14   4 frames, a camp animal walking right; opts.variant 0 to 5: hen,
                        cat, goat, owl, fox, tortoise. The owl hops: frame 1 is a blink,
                        frame 2 is off the ground
   heart       7 x 6    a red heart, shown over an animal that has been petted

   land       48 x 28   2 frames, landscape set about the clearing; opts.variant 0 to 9:
                        pond, lake, knoll, boulders, pine, bush, wildflowers, stepping
                        stones, tall grass, birch. Frame 1 moves only what the wind or the
                        water would. The flat ones (pond, lake, wildflowers, stepping
                        stones, tall grass) lie on the ground under everything: they have
                        a soft dark rim, not the hard outline, and no shadow
   work       22 x 24   2 frames, a defensive work; opts.variant 0 to 11: ward stone (its
                        runes brighter on frame 1), whip-thorn hedge (a thorn or two
                        flexes), thumper (frame 1 is the beater down, dust at the foot),
                        smoke brazier (the smoke shifts), tanglefoot patch (two of its
                        loops twitch), hornet jar (only the hornets move), pitfall (a
                        stick sags, a leaf slips), watch bell (frame 1 is the bell swung),
                        caltrops (the glint moves), stone thrower (frame 0 cocked, frame 1
                        loosed), archer's nest (the pennant turns), dread totem (its eyes
                        burn brighter on frame 1)
   blade      12 x 16   a named blade as a small icon; opts.variant 0 to 8: Thornwhip, the
                        Maker's Tooth, Winterglass, Longfang, Needlewise, Dawnsplitter,
                        Undertow, the Songbird Bow, the Ashglass knives. Our own blades,
                        nobody else's
   spire      22 x 44   the lookout as the White Spire: white stone in tiers, a lamp and a
                        pennant at the top
   darkwatch  22 x 44   the lookout as the Dark Watch: jagged basalt, two horns, an orange
                        light burning between them
       for those two, opts.variant 0 to 2 stands for the lookout's levels 3 to 5; each
       has `tower`'s foot and its gallery at that level
   foe        16 x 18   4 frames, a raider on foot walking right; opts.variant 0 to 5: a
                        Mudtusk, one of the Gilded, one of the Stumbling (it drags, and
                        leans), a Frostwight, Rattlenut the great red squirrel (he bounds:
                        stretched out on 0 and 2, gathered up on 1 and 3), Fizzwick the
                        cross loaf of mossy bread (he waddles: a pixel up on 1 and 3; the
                        tip of his twig is at 7, 2 on frame 0). Our own, nobody else's
   signpost   14 x 18   a guardian's own signpost; opts.variant 0 to 6, in `guardian`'s
                        order: the ranger's straw target, the watchman's lantern, the
                        keeper's living stump, the knight's shield and hilt, the dragon's
                        burnt post, the gardener's flowerpot, the whistler's note board
 }

 The screen places a sprite by its bottom-centre, so every building stands on
 the bottom row of its own canvas, centred, and grows upward with its level.
 So do the trophies, the banner, the decor, the units, the raid's pieces, the
 guardians and the animals. */
import { rnd } from "./room.js";

const TAU = Math.PI * 2;
const level = (o, max) => Math.max(0, Math.min(max, Math.round(Number(o && o.variant) || 0)));

function mix(a, b, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

// Outlines: warm for wood and earth, green for leaves, cool for stone.
const INK = "#2A1A10", INK_LEAF = "#123A1E", INK_STONE = "#23262F", INK_GOLD = "#4A3100";

// Palettes run light edge, body, shaded edge, seam.
const STICK = ["#B88350", "#946235", "#6B4226", "#4E2E16"];
const MUD = ["#E0B880", "#C99A62", "#9A6E40", "#7A5230"];
const TIMBER = ["#DCA662", "#BA8048", "#8E5C30", "#643C1C"];
const PLANK = ["#A8743E", "#7E5228", "#573518", "#3A2410"];
const STONE = ["#E3E8EF", "#B4BCC8", "#8C97A6", "#6A7482"];
const GOLD = ["#FFF6C2", "#FFD23F", "#E0A800"];
const THATCH = ["#F0D27E", "#D8AE4E", "#A87C30", "#7E5A1E"];
const SHINGLE = ["#B88350", "#8A5A34", "#5E3A1F", "#442814"];
const TILE = ["#E88466", "#C8553B", "#8E2F28", "#6E2019"];
const SLATE = ["#8FB0E0", "#5578B0", "#35507F", "#263A5E"];
const RED = ["#EE8068", "#C8453B", "#8E2F28"];
const TURF = ["#9BDD70", "#5FB34C", "#3F8F4A", "#2F7340"];
const LEAF = ["#7CCB5E", "#3F9A4E", "#2A7A44"];
const BARK = ["#B07A4A", "#8A5A34", "#5E3A1F"];

// ---------------------------------------------------------------- materials
/** What a wall is made of: the colour at column i, row j of a panel w wide. */
const MAT = {
  mud(i, j, w) {
    if (i % 5 === 2) return j % 4 === 1 ? STICK[0] : STICK[1];
    const r = rnd(i * 7.3 + j * 3.1 + 5);
    return i === 0 ? MUD[0] : i >= w - 1 ? MUD[2] : r > 0.86 ? MUD[2] : r < 0.14 ? MUD[0] : MUD[1];
  },
  timber(i, j, w) {
    const k = j % 3;
    if (i === 0) return k === 2 ? TIMBER[1] : TIMBER[0];
    if (i >= w - 2) return k === 2 ? TIMBER[3] : TIMBER[2];
    return k === 0 ? TIMBER[0] : k === 1 ? TIMBER[1] : TIMBER[2];
  },
  stone(i, j, w) {
    const row = Math.floor(j / 3), off = row % 2 ? 3 : 0, seam = j % 3 === 2 || (i + off) % 6 === 5;
    if (i === 0) return seam ? STONE[1] : STONE[0];
    if (i >= w - 2) return seam ? STONE[3] : STONE[2];
    if (seam) return STONE[2];
    if (rnd(row * 17 + Math.floor((i + off) / 6) * 5 + 3) > 0.78) return "#A0A9B7";
    return j % 3 === 0 ? STONE[0] : STONE[1];
  }
};
const wall = (l, x, y, w, h, kind) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) l.px(x + i, y + j, MAT[kind](i, j, w));
  return l;
};

/** A pitched roof from the side: `top` is the ridge row, and the half-width
 grows from `ridge` to `eave` over `rows`. Thatch is streaky, the rest tiled. */
const roof = (l, cx, top, rows, ridge, eave, P, thatch) => {
  for (let j = 0; j < rows; j++) {
    const hw = Math.round(ridge + ((eave - ridge) * j) / Math.max(1, rows - 1));
    for (let i = -hw; i < hw; i++) {
      let c = P[1];
      if (thatch) {
        if ((i * 3 + j * 2 + 90) % 5 === 0) c = P[2];
        else if ((i * 2 + j * 3 + 90) % 7 === 0) c = P[0];
      } else if (j % 2 === 1 && (i + (j >> 1) * 2 + 90) % 4 === 0) c = P[2];
      if (j === 0 || i === -hw) c = P[0];
      if (i >= hw - 2 && j > 0) c = P[2];
      if (j === rows - 1 && i > -hw) c = P[3];
      l.px(cx + i, top + j, c);
    }
  }
  return l;
};

/** A dome standing on row `by`, `ry` rows tall and `rx` each side of cx.
 `col(u, t, x, y, edge, near)`: u runs -1 to 1 across the row, t 0 to 1
 upward, edge says the pixel has sky above it, near that it is one row under that. */
const dome = (l, cx, by, rx, ry, col, p = 2) => {
  const half = (j) => (j >= ry ? 0 : Math.max(1, Math.round(rx * Math.pow(1 - Math.pow((j + 0.5) / ry, p), 1 / p))));
  for (let j = 0; j < ry; j++) {
    const hw = half(j), up = half(j + 1), up2 = half(j + 2);
    for (let i = -hw; i < hw; i++) {
      const c = typeof col === "function" ? col((i + 0.5) / hw, (j + 0.5) / ry, cx + i, by - j, i < -up || i >= up, i < -up2 || i >= up2) : col;
      if (c) l.px(cx + i, by - j, c);
    }
  }
  return l;
};

/** Grass on a mound: lit along the top, shaded to the right, a few tufts. */
const turf = (u, t, x, y, edge, near) => {
  if (edge) return u > 0.5 ? TURF[1] : TURF[0];
  if (u > 0.7 || t < 0.06) return TURF[2];
  if (near && u < 0.1) return TURF[0];
  const r = rnd(x * 12.9 + y * 78.2);
  if (r > 0.94 && u < 0.5) return TURF[0];
  if (r < 0.07 || (u > 0.5 && (x + y) % 2 === 0)) return TURF[2];
  return TURF[1];
};

/** A plank door with a rounded top; `knob` is the knob's colour, or none. */
const door = (l, x, y, w, h, P, knob) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (j === 0 && w > 3 && (i === 0 || i === w - 1)) continue;
    l.px(x + i, y + j, i === 0 ? P[0] : i === w - 1 ? P[2] : w > 5 && i === (w >> 1) ? P[2] : j === 0 ? P[0] : P[1]);
  }
  if (knob) l.px(x + (w > 5 ? (w >> 1) - 1 : w - 2), y + (h >> 1), knob);
  return l;
};

/** A small lit window in a dark frame. */
const pane = (l, x, y, w, h) => l.rect(x - 1, y - 1, w + 2, h + 2, PLANK[2]).rect(x, y, w, h, "#FFD27A").px(x, y, "#FFF6C2");

/** A round window, four panes; gold-framed for the best house in the camp. */
const porthole = (g, x, y, gold) => g.stamp((l) => {
  if (gold) l.ell(x + 0.5, y + 0.5, 3.5, 3.5, (nx, ny) => (nx + ny < -0.3 ? GOLD[0] : nx + ny > 0.6 ? GOLD[2] : GOLD[1]));
  l.ell(x + 0.5, y + 0.5, 2.5, 2.5, (nx, ny) => (nx + ny < -0.2 ? (gold ? "#F2FBFF" : "#FFF6C2") : gold ? "#A8DCF5" : "#FFD27A"));
  l.rect(x, y - 2, 1, 5, gold ? "#A87400" : PLANK[1]).rect(x - 2, y, 5, 1, gold ? "#A87400" : PLANK[1]);
}, gold ? INK_GOLD : INK);

const acornBit = (l, x, y) => l.rect(x, y, 2, 1, "#6B4226").px(x, y + 1, "#FFD98A").px(x + 1, y + 1, "#E0A040").px(x, y + 2, "#E0A040").px(x + 1, y + 2, "#B06A28");
/** Loose acorns, each 2 x 3 with its cap on. */
const acorns = (g, list, ink = INK) => g.stamp((l) => list.forEach(([x, y]) => acornBit(l, x, y)), ink);

/** A barrel, 5 x 6, standing on row y + 5. */
const barrel = (g, x, y) => g.stamp((l) => {
  l.rect(x + 1, y, 3, 1, TIMBER[0]).rect(x, y + 1, 5, 4, TIMBER[1]).rect(x + 1, y + 5, 3, 1, TIMBER[2]);
  l.rect(x, y + 1, 1, 4, TIMBER[0]).rect(x + 4, y + 1, 1, 4, TIMBER[2]).rect(x + 2, y + 2, 1, 2, "#A06C3A");
  l.rect(x, y + 1, 5, 1, "#7E8698").rect(x, y + 4, 5, 1, "#7E8698").px(x, y + 1, STONE[1]).px(x, y + 4, STONE[1]);
}, INK);

const ladder = (g, x, top, bottom) => g.stamp((l) => {
  for (let y = top; y <= bottom; y++) {
    l.px(x, y, TIMBER[0]).px(x + 3, y, TIMBER[1]);
    if ((bottom - y) % 3 === 1) l.rect(x + 1, y, 2, 1, "#C4904E");
  }
}, INK);

/** A swallow-tailed flag flying right from (x, y). */
const banner = (g, x, y, w, h, P) => g.stamp((l) => {
  for (let j = 0; j < h; j++) {
    const cut = Math.abs(j - (h - 1) / 2) < 1 ? 2 : 0;
    for (let i = 0; i < w - cut; i++) l.px(x + i, y + j, j === 0 ? P[0] : j === h - 1 ? P[2] : P[1]);
  }
  l.rect(x + 1, y + (h >> 1), 2, 1, GOLD[1]);
}, INK);

/** A lit lantern, 3 x 5, with a soft glow round it. */
const lantern = (g, x, y) => {
  g.ell(x + 1.5, y + 2.5, 4.6, 4.6, "#FFE36B38");
  g.stamp((l) => l.px(x + 1, y, GOLD[2]).rect(x, y + 1, 3, 3, GOLD[1]).px(x + 1, y + 1, GOLD[0]).px(x + 1, y + 2, "#FFFFFF").rect(x, y + 4, 3, 1, GOLD[2]), INK_GOLD);
};

/** A round shield, 5 x 5. */
const shield = (g, x, y, P, boss) => g.stamp((l) => {
  l.ell(x + 2.5, y + 2.5, 2.5, 2.5, (nx, ny) => (nx + ny < -0.3 ? P[0] : nx + ny > 0.7 ? P[2] : P[1]));
  l.px(x + 2, y + 2, boss);
}, INK);

/** A wooden practice sword, point down: 9 rows from the pommel at `top`. */
const sword = (g, x, top) => g.stamp((l) => l.px(x, top, TIMBER[2]).rect(x, top + 1, 1, 2, TIMBER[1]).rect(x - 1, top + 3, 3, 1, TIMBER[2]).rect(x, top + 4, 1, 5, "#F0D9A8"), INK);

/** A cloud's colours: body, the shade under it, its outline. */
const CLOUD = ["#FFFFFF", "#E6F2FF", "#8FB8D8"];
const cloud = (g, x, y, w, P = CLOUD) => g.stamp((l) => { l.ell(x, y + 2, w, 2.6, P[0]); l.ell(x - w * 0.35, y + 1, w * 0.45, 2.6, P[0]); l.ell(x + w * 0.25, y, w * 0.5, 3.2, (nx, ny) => (ny > 0.5 ? P[1] : P[0])); }, P[2]);
/** A small picture as rows of letters: `key` gives each letter its colour, and a dot is empty. */
const chart = (l, x, y, rows, key) => {
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (key[row[i]]) l.px(x + i, y + j, key[row[i]]); });
  return l;
};
const puff = (g, x, y) => g.stamp((l) => l.rect(x, y, 3, 2, "#FFFFFF").px(x + 1, y - 1, "#FFFFFF").rect(x + 3, y - 4, 2, 2, "#FFFFFF"), "#9FB4C8");

// ---------------------------------------------------------------- level 0
const cord = (g, x0, y0, x1, y1) => g.line(x0, y0 + 1, x1, y1 + 1, "#2A1A1070").line(x0, y0, x1, y1, "#FFF6DF");
const stake = (g, x, top, bottom) => g.stamp((l) => l.rect(x, top, 2, bottom - top + 1, STICK[0]).rect(x + 1, top, 1, bottom - top + 1, STICK[2]).rect(x, top, 2, 1, "#F0D9A8"), INK);

/** An empty plot the size of its building: four stakes, string, a signpost. */
const plot = (g, w, h) => {
  const G = h - 2, d = Math.max(4, Math.min(8, Math.round(h / 5))), a = 1, b = w - 3, inset = Math.min(4, d);
  const ba = a + inset, bb = b - inset, by = G - d;
  cord(g, ba, by - 2, bb + 1, by - 2);
  stake(g, ba, by - 3, by);
  stake(g, bb, by - 3, by);
  cord(g, a + 1, G - 4, ba, by - 2);
  cord(g, b, G - 4, bb + 1, by - 2);
  const sx = Math.round(w * 0.6), sy = G - (d >> 1);
  g.stamp((l) => {
    l.rect(sx, sy - 5, 1, 6, STICK[1]);
    l.rect(sx - 3, sy - 9, 7, 4, "#E8C48A").rect(sx - 3, sy - 9, 7, 1, "#FFF0C8").rect(sx - 3, sy - 6, 7, 1, "#C99A62");
    l.rect(sx - 2, sy - 8, 2, 1, STICK[2]).rect(sx + 1, sy - 8, 2, 1, STICK[2]).rect(sx - 2, sy - 7, 3, 1, STICK[2]);
  }, INK);
  cord(g, a + 1, G - 4, b, G - 4);
  stake(g, a, G - 5, G);
  stake(g, b, G - 5, G);
};

// ---------------------------------------------------------------- the clearing
/** Leaves in summer: light, body, shade. A fourth colour is a fleck (blossom, a turned leaf). */
const GREEN = [["#86C878", "#5AA862", "#3F8A52"]];
const FALLEN = ["#D8642E", "#E8A030", "#B84A24", "#F0C24A"];
const PETALS = ["#FFB3D1", "#FFFFFF", "#C9A8FF", "#FFE066", "#FF8FB0"];

/** What a season changes in the clearing: its colours, and a little dressing laid on last. */
const SEASONS = [
  {
    sky: ["#8FD0FF", "#E6F6FF"], night: ["#0E1638", "#2B3C7C"], cloud: CLOUD,
    hill: ["#C9E8D0", "#AEDAB8"], far: [["#9CD0A0", "#84C090"]], band: ["#4A8C58", "#3A7A4C"], trunk: ["#4E5238", "#62633F"],
    crown: GREEN, bush: GREEN, grass: ["#6FAE58", "#82BE60", "#90CA66", "#A4D874"],
    path: ["#C6AA76", "#B89A68", "#EAD8AE", "#DCC492"], tuft: ["#B9E68A", "#78B656"],
    flower: ["#FFFFFF", "#FFE066", "#5FA04A"], rock: [STONE[0], STONE[1], STONE[2], "#5E8A4E"],
    // Fireflies over the grass after dark.
    dress(g, clear, lit, dark) {
      if (!dark) return;
      for (let k = 0; k < 10; k++) {
        const x = Math.round(6 + rnd(k * 47 + 3) * 228), y = Math.round(50 + rnd(k * 53 + 8) * 40);
        g.px(x - 1, y, "#E8FF8A40").px(x + 1, y, "#E8FF8A40").px(x, y - 1, "#E8FF8A40").px(x, y + 1, "#E8FF8A40").px(x, y, "#F4FFB0");
      }
    }
  },
  {
    sky: ["#86B4E4", "#FFE4B4"], night: ["#17123A", "#473A7C"], cloud: ["#FFF6E6", "#FFE0C0", "#C8A488"],
    hill: ["#EEDCAC", "#DEC690"], far: [["#F2CC84", "#E2B06C"], ["#EEAE86", "#DC9266"], ["#DCD088", "#C6BC70"]],
    band: ["#86642F", "#6C5026"], trunk: ["#46382A", "#5E4C38"],
    crown: [["#FBDD6A", "#E6AC30", "#B47C1E", "#F6884A"], ["#F09A5A", "#CC5C2C", "#8E3A1E", "#F6C24A"], ["#F8BC5A", "#E2862A", "#A8561C", "#C8452E"], ["#C2CC62", "#8A9C3C", "#5E7430", "#F0C24A"], ["#E2705A", "#AE3C2C", "#742418", "#F09A4A"]],
    bush: [["#F0BC52", "#CC7E30", "#8E4A22", "#F6DC6A"], ["#C2CC62", "#8A9C3C", "#5E7430", "#E8A030"], ["#E2705A", "#AE3C2C", "#742418", "#F09A4A"]],
    grass: ["#84963E", "#98AA4A", "#A8BA56", "#C0CE68"], fleck: 0.84,
    path: ["#B8985F", "#A88652", "#E6D0A0", "#D4B884"], tuft: ["#D8DC80", "#80963E"],
    flower: ["#E0583C", "#F09A4A", "#F6EEDC"], rock: [STONE[0], STONE[1], STONE[2], "#687A38"],
    // Fallen leaves, thickest under the trees.
    dress(g, clear, lit) {
      for (let k = 0; k < 120; k++) {
        const u = rnd(k * 13 + 17), x = Math.round(2 + rnd(k * 7 + 31) * 235), y = Math.round(50 + u * u * 68), c = lit(FALLEN[k % 4]);
        if (!clear(x, y) && k % 3) continue;
        g.px(x, y, c);
        if (k % 3 === 0) g.px(x + 1, y + (k % 2), c);
      }
      for (let k = 0; k < 10; k++) {
        const x = Math.round(4 + k * 24 + rnd(k * 5 + 3) * 12), y = 51 + Math.round(rnd(k * 9 + 1) * 3);
        g.rect(x, y, 5, 1, lit(FALLEN[k % 4])).rect(x + 1, y - 1, 3, 1, lit(FALLEN[(k + 1) % 4])).px(x + 2, y - 1, lit(FALLEN[(k + 3) % 4]));
      }
    }
  },
  {
    sky: ["#BFD2E6", "#EEF3F8"], night: ["#131B40", "#3C4C84"], cloud: ["#FAFCFF", "#DCE6F0", "#A4B6C8"],
    hill: ["#F2F6FB", "#D8E2EE"], far: [["#B4BECC", "#98A4B6"]], band: ["#6C8296", "#586E84"], trunk: ["#54483E", "#6E6254"],
    crown: [["#FFFFFF", "#D4E2F0", "#9DB4CC"], ["#FFFFFF", "#5E8E78", "#3F6E5C"], ["#FFFFFF", "#C6D6E8", "#8FA8C4"]],
    bush: [["#FFFFFF", "#D4E2F0", "#8FA8C4"], ["#FFFFFF", "#6E987E", "#4A7460"]],
    grass: ["#C0D0E4", "#D4E0EE", "#E4ECF6", "#F4F8FD"], snow: true, bare: true,
    path: ["#A8B6C8", "#B49E7C", "#E2DACA", "#CDBB9C"], tuft: ["#C8B88C", "#BCCCDE"],
    rock: ["#FFFFFF", STONE[1], STONE[2], "#8296AE"],
    // Drifts on the ground, and snow still coming down in front of the wood.
    dress(g, clear, lit) {
      for (let k = 0; k < 36; k++) {
        const x = Math.round(4 + rnd(k * 19 + 4) * 228), y = Math.round(55 + rnd(k * 23 + 6) * 62), w = 3 + Math.floor(rnd(k * 3 + 9) * 4);
        if (!clear(x, y) || !clear(x + w, y)) continue;
        g.rect(x, y, w, 1, lit("#C2D2E6")).rect(x + 1, y - 1, w - 2, 1, lit("#FFFFFF"));
      }
      for (let k = 0; k < 46; k++) g.px(Math.round(rnd(k * 29 + 2) * 239), Math.round(1 + rnd(k * 31 + 7) * 46), lit("#FFFFFF"));
    }
  },
  {
    sky: ["#86D4FF", "#F2FAFF"], night: ["#0F1840", "#30508C"], cloud: CLOUD,
    hill: ["#D8F4CE", "#C0EAB8"], far: [["#BCE8A4", "#A2DC92"], ["#FADAE8", "#F0BED6"], ["#BCE8A4", "#A2DC92"]],
    band: ["#56A05C", "#44904E"], trunk: ["#5A5238", "#70683F"],
    crown: [["#B4EC86", "#7CD060", "#4EA656", "#FFD6E8"], ["#C4F294", "#90DA6A", "#5CB05A", "#FFFFFF"], ["#FFE6F0", "#F8B8D4", "#D888AC", "#FFFFFF"], ["#B4EC86", "#7CD060", "#4EA656"], ["#FFFFFF", "#F6E2EE", "#CCB0C6", "#F8B8D4"]],
    bush: [["#B4EC86", "#7CD060", "#4EA656", "#FFD6E8"], ["#C4F294", "#90DA6A", "#5CB05A", "#FFF29A"]],
    grass: ["#74BC5A", "#8CD066", "#A2E078", "#BCF08C"], fleck: 0.87,
    path: ["#C6AA76", "#B89A68", "#EAD8AE", "#DCC492"], tuft: ["#D2F8A4", "#84CA60"],
    flower: ["#FFFFFF", "#FFE066", "#5FA04A"], rock: [STONE[0], STONE[1], STONE[2], "#5E9A4E"],
    // Flowers all through the grass, and petals blown off the blossom.
    dress(g, clear, lit) {
      for (let k = 0; k < 44; k++) {
        const x = Math.round(4 + rnd(k * 17 + 12) * 230), y = Math.round(54 + rnd(k * 21 + 3) * 62), c = lit(PETALS[k % 5]);
        if (!clear(x, y)) continue;
        g.px(x, y, c).px(x, y + 1, lit("#5FA04A"));
        if (k % 4 === 0) g.px(x - 1, y, c).px(x + 1, y, c).px(x, y - 1, c).px(x, y, lit("#FFE066"));
      }
      for (let k = 0; k < 34; k++) {
        const u = rnd(k * 37 + 5), x = Math.round(2 + rnd(k * 33 + 1) * 235), y = Math.round(49 + u * u * 22);
        g.px(x, y, lit(k % 3 ? "#FFD9E8" : "#FFFFFF"));
      }
    }
  }
];

/** A colour by moonlight: darker and bluer. `k` is how much of the light is left. */
const moonlit = (c, k) => {
  const [r, gr, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  return mix("#" + [r * 0.5 * k, gr * 0.62 * k, b * 0.86 * k].map((v) => Math.min(255, Math.round(v)).toString(16).padStart(2, "0")).join(""), "#18225A", 0.12);
};
/** How much light each part of the clearing keeps at night: the wood goes dark, the grass stays readable. */
const NIGHT = { hill: 0.5, far: 0.5, band: 0.6, trunk: 0.6, crown: 0.68, bush: 0.74 };
const tint = (v, fn) => (Array.isArray(v) ? v.map((c) => tint(c, fn)) : typeof v === "string" ? fn(v) : v);
const byNight = (S) => {
  const N = {};
  for (const key of Object.keys(S)) N[key] = tint(S[key], (c) => moonlit(c, NIGHT[key] || 0.9));
  return N;
};

/** Stars, a full moon with a halo, and two dim clouds, over a sky already painted dark. */
const nightSky = (g) => {
  for (let k = 0; k < 64; k++) {
    const x = Math.round(rnd(k * 3 + 5) * 239), y = Math.round(rnd(k * 7 + 9) * 31), c = k % 5 === 0 ? "#FFFFFF" : k % 3 === 0 ? "#C9D1FF" : "#8C9AD8";
    g.px(x, y, c);
    if (k % 13 === 0) g.px(x - 1, y, "#8C9AD8").px(x + 1, y, "#8C9AD8").px(x, y - 1, "#8C9AD8").px(x, y + 1, "#8C9AD8");
  }
  g.ell(203, 12, 10, 10, "#DDE6FF16").ell(203, 12, 7.6, 7.6, "#DDE6FF24");
  g.ell(203, 12, 5.5, 5.5, (nx, ny) => (nx + ny < -0.55 ? "#FFFFFF" : nx + ny > 0.8 ? "#DAD2A6" : "#FFF6D0"));
  g.px(201, 10, "#E4DAAE").rect(204, 13, 2, 2, "#E4DAAE").px(200, 14, "#E4DAAE").px(205, 9, "#E4DAAE");
  for (const [x, y, w] of [[38, 8, 11], [126, 5, 8]]) cloud(g, x, y, w, ["#3B4D88", "#31417A", "#222F60"]);
};

/** A far tree in winter: a bare trunk and a fan of branches. */
const bareTree = (g, x, y, r, P) => {
  g.rect(x, y, 1, 41 - y, P[1]);
  for (const s of [-1, 1]) {
    g.line(x, y + 3, x + s * r * 0.8, y - r * 0.3, P[1]).line(x, y + 1, x + s * r * 0.45, y - r * 0.8, P[1]);
    g.line(x + s * r * 0.4, y + 1, x + s * r * 0.85, y + 1, P[0]).line(x + s * r * 0.25, y - r * 0.4, x + s * r * 0.1, y - r * 0.95, P[0]);
  }
  g.line(x, y, x, y - r * 0.7, P[1]);
};

/** A crown's or a bush's colour once the season has had its say: `c` is what it would be in summer. */
const inSeason = (S, P, c, nx, ny, x, y) => {
  if (S.snow && ny < -0.15 + nx * 0.25) return P[0];
  if (P[3] && rnd(x * 3.7 + y * 9.1 + 5) > S.fleck) return P[3];
  return c;
};
const pick = (list, seed) => list[Math.floor(rnd(seed) * list.length) % list.length];

const bg = {
  w: 240, h: 120,
  draw(g, f, o) {
    // 0 to 3 are summer, autumn, winter and spring by day; 4 to 7 the same by night.
    const v = level(o, 7), dark = v > 3, D = SEASONS[v % 4], S = dark ? byNight(D) : D;
    const lit = dark ? (c) => moonlit(c, 0.9) : (c) => c, sky = dark ? D.night : D.sky;
    for (let y = 0; y < 46; y++) {
      const c = mix(sky[0], sky[1], Math.min(1, y / 36));
      for (let x = 0; x < 240; x++) g.px(x, y, c);
    }
    if (dark) nightSky(g);
    else for (const [x, y, w] of [[38, 8, 11], [126, 5, 8], [203, 11, 10]]) cloud(g, x, y, w, S.cloud);
    // Far hills, pale with distance.
    for (let x = 0; x < 240; x++) {
      const t = (x / 240) * TAU, far = Math.round(25 + Math.sin(t * 2 + 1) * 4 + Math.sin(t * 5) * 2);
      for (let y = far; y < 46; y++) g.px(x, y, y === far ? S.hill[0] : S.hill[1]);
    }
    // The tree line: a hazy row of crowns, then a nearer one, trunks in shade.
    for (let k = 0; k < 20; k++) {
      const x = k * 12.6 + rnd(k * 3 + 1) * 7 - 2, r = 6 + rnd(k * 5 + 3) * 3, y = 35 - rnd(k * 7 + 2) * 4, P = pick(S.far, k * 23 + 5);
      if (S.bare) bareTree(g, Math.round(x), Math.round(y), r, P);
      else g.ell(x, y, r, r * 0.9, (nx, ny) => (nx + ny < -0.6 ? P[0] : P[1]));
    }
    for (let x = 0; x < 240; x++) for (let y = 40; y < 47; y++) g.px(x, y, y < 43 ? S.band[0] : S.band[1]);
    for (let k = 0; k < 15; k++) {
      const x = k * 16.5 + rnd(k * 11 + 4) * 12 - 2, wide = rnd(k * 9 + 1) > 0.5 ? 2 : 1;
      g.rect(x, 42, wide, 5, S.trunk[0]).rect(x, 42, 1, 5, S.trunk[1]);
    }
    for (let k = 0; k < 22; k++) {
      const x = k * 11.3 + rnd(k * 13 + 6) * 6 - 3, r = 5.5 + rnd(k * 17 + 8) * 3.5, P = pick(S.crown, k * 29 + 2);
      g.ell(x, 38 - rnd(k * 19 + 9) * 4, r, r * 0.85, (nx, ny, px, py) => inSeason(S, P, nx + ny < -0.55 ? P[0] : nx + ny > 0.6 ? P[2] : P[1], nx, ny, px, py));
    }
    // Open grass, a little deeper in tone under the trees.
    for (let y = 47; y < 120; y++) {
      const row = y < 49 ? S.grass[0] : y < 51 ? S.grass[1] : mix(S.grass[2], S.grass[3], (y - 51) / 68);
      for (let x = 0; x < 240; x++) g.px(x, y, row);
    }
    // Bushes where the wood meets the grass, so the edge is not a ruled line.
    for (let k = 0; k < 14; k++) {
      const x = k * 18 + rnd(k * 41 + 7) * 12, r = 3 + rnd(k * 43 + 9) * 3, P = pick(S.bush, k * 31 + 4);
      g.ell(x, 47.5, r, r * 0.62, (nx, ny, px, py) => inSeason(S, P, nx + ny < -0.5 ? P[0] : ny > 0.35 ? P[2] : P[1], nx, ny, px, py));
    }
    // A worn dirt path up from the front of the camp.
    const pc = (y) => 120 + 15 * Math.sin((y - 60) * 0.047 + 0.5), ph = (y) => 2.5 + (y - 60) * 0.21 + (rnd(y * 3 + 1) > 0.6 ? 1 : 0);
    const onPath = (x, y) => y >= 59 && Math.abs(x - pc(y)) < ph(y) + 3;
    for (let y = 60; y < 120; y++) {
      const c = pc(y), hw = ph(y);
      for (let x = Math.round(c - hw); x <= Math.round(c + hw); x++) {
        const edge = x === Math.round(c - hw) || x === Math.round(c + hw) || y === 60;
        g.px(x, y, edge ? S.path[0] : rnd(x * 5 + y * 13) > 0.93 ? S.path[1] : rnd(x * 11 + y * 7) > 0.9 ? S.path[2] : S.path[3]);
      }
    }
    // Tufts, a few flowers and stones: texture, kept quiet.
    for (let k = 0; k < 64; k++) {
      const x = Math.round(3 + rnd(k * 3 + 11) * 232), y = Math.round(53 + rnd(k * 5 + 7) * 64);
      if (onPath(x, y) || onPath(x + 2, y)) continue;
      if (k % 4 === 3) g.px(x, y, S.tuft[0]).px(x + 1, y - 1, S.tuft[0]).px(x + 2, y, S.tuft[0]);
      else g.px(x, y, S.tuft[1]).px(x + 1, y - 1, S.tuft[1]).px(x + 2, y, S.tuft[1]);
    }
    for (let k = 0; S.flower && k < 9; k++) {
      const x = Math.round(6 + rnd(k * 23 + 2) * 226), y = Math.round(56 + rnd(k * 29 + 5) * 60);
      if (onPath(x, y)) continue;
      g.px(x, y, k % 3 ? S.flower[0] : S.flower[1]).px(x, y + 1, S.flower[2]);
    }
    for (let k = 0; k < 6; k++) {
      const x = Math.round(8 + rnd(k * 31 + 3) * 220), y = Math.round(58 + rnd(k * 37 + 4) * 56);
      if (onPath(x, y) || onPath(x + 3, y)) continue;
      g.stamp((l) => { l.rect(x, y, 3, 2, S.rock[1]).px(x, y, S.rock[0]).px(x + 2, y + 1, S.rock[2]); if (S.snow) l.rect(x, y, 3, 1, S.rock[0]); }, S.rock[3]);
    }
    if (D.dress) D.dress(g, (x, y) => !onPath(x, y), lit, dark);
  }
};

// ---------------------------------------------------------------- the burrow
const burrow = {
  w: 48, h: 40,
  draw(g, f, o) {
    const n = level(o, 5), G = 38, cx = 24;
    if (!n) return void plot(g, 48, 40);
    const [rx, ry] = [[14, 16], [17, 19], [20, 22], [21, 18], [22, 19]][n - 1];
    const up = n === 4 ? { rx: 12, ry: 14, by: 24 } : n === 5 ? { rx: 13, ry: 16, by: 24 } : null;
    // The chimney stands behind the mound, a puff of smoke over it.
    if (n >= 3) {
      const x = n === 3 ? 34 : n === 4 ? 36 : 37, top = n === 3 ? 15 : n === 4 ? 14 : 12;
      g.stamp((l) => {
        if (n === 3) l.rect(x, top, 3, 10, "#B5553C").rect(x, top, 1, 10, "#D97A5E").rect(x - 1, top, 5, 2, "#8E3B2A").rect(x - 1, top, 5, 1, "#C8553B");
        else wall(l, x, top + 1, 4, 14, "stone").rect(x - 1, top, 6, 2, n === 5 ? GOLD[1] : STONE[2]).rect(x - 1, top, 6, 1, n === 5 ? GOLD[0] : STONE[0]);
      }, INK);
      puff(g, x + 2, top - 4);
    }
    // The upper room: a smaller mound on the first, with a leaf flag at the top.
    if (up) {
      if (n === 5) {
        g.stamp((l) => l.rect(cx, 2, 1, 9, STICK[1]).px(cx, 1, GOLD[1]), INK);
        g.stamp((l) => {
          l.rect(cx + 3, 1, 3, 1, "#2FA35E").rect(cx + 2, 2, 6, 1, "#2FA35E").rect(cx + 2, 3, 7, 1, "#2FA35E").rect(cx + 3, 4, 4, 1, "#1D7646");
          l.rect(cx + 2, 3, 4, 1, "#B9F0B4").px(cx + 6, 2, "#B9F0B4");
        }, INK_LEAF);
      }
      g.stamp((l) => dome(l, cx, up.by, up.rx, up.ry, turf, 2.2), INK_LEAF);
      porthole(g, cx, up.by - 8, n === 5);
    }
    g.stamp((l) => dome(l, cx, G, rx, ry, turf, 2.3), INK_LEAF);
    // Flowers in the grass.
    const flowers = [[], [], [[-11, 9], [9, 14]], [[-13, 14], [10, 16], [-6, 18]], [[-15, 12], [11, 14], [16, 4]], [[-16, 12], [11, 15], [-12, 4], [18, 4], [-8, 25], [8, 22]]][n];
    flowers.forEach(([dx, dy], i) => g.px(cx + dx, G - dy, ["#FFFFFF", "#FFE066", "#FFB3D1"][i % 3]).px(cx + dx + 1, G - dy, "#FFE066"));
    // The front: earth, then sticks and mud, then timber, then stone.
    const face = ["earth", "mud", "timber", "stone", "stone"][n - 1], frx = [6, 7, 8, 9, 9][n - 1], fry = [9, 10, 12, 13, 13][n - 1];
    g.stamp((l) => dome(l, cx, G, frx, fry, (u, t, x, y, edge) => (face === "earth" ? (edge ? MUD[2] : u > 0.5 ? "#5E3A1F" : MUD[3]) : MAT[face](x - cx + frx, y - (G - fry + 1), frx * 2))), INK);
    const drx = [4, 4, 5, 5, 5][n - 1], dry = [7, 7, 8, 9, 9][n - 1], D = n >= 3 ? RED : PLANK;
    if (n === 5) g.stamp((l) => dome(l, cx, G, drx + 2, dry + 2, GOLD[1]).rect(cx - 1, G - dry - 1, 2, 1, GOLD[0]), INK_GOLD);
    g.stamp((l) => {
      dome(l, cx, G, drx, dry, (u, t, x, y, edge) => (edge && u < 0.3 ? D[0] : u > 0.5 ? D[2] : (x - cx + 30) % 3 === 1 ? D[2] : D[1]));
      if (n >= 3) l.rect(cx - 1, G - (dry >> 1), 2, 2, GOLD[1]).px(cx - 1, G - (dry >> 1), GOLD[0]);
      else l.px(cx + 1, G - (dry >> 1), PLANK[3]);
    }, INK);
    const wx = [0, 11, 13, 14, 14][n - 1];
    if (n >= 2) porthole(g, cx + wx, G - 7, n === 5);
    if (n >= 3) porthole(g, cx - wx - 1, G - 7, n === 5);
  }
};

// ---------------------------------------------------------------- the oak
const lobe = (nx, ny, x, y) => {
  const s = nx * 0.7 + ny;
  if (s < -0.5) return LEAF[0];
  if (s > 0.55) return LEAF[2];
  const r = rnd(x * 12.9 + y * 78.2);
  return r > 0.9 ? LEAF[2] : r < 0.06 && s < 0 ? LEAF[0] : LEAF[1];
};
/** Per level: the trunk (width, height), the crown's lobes, where acorns hang. */
const OAKS = [
  { trunk: [2, 12], lobes: [[20, 31, 4.5, 3.6], [16.5, 33.5, 2.6, 2.2], [23.5, 33, 2.6, 2.2]], nuts: [] },
  { trunk: [3, 15], lobes: [[20, 26.5, 9, 7.5], [13.5, 30.5, 5, 4.2], [26.5, 30, 5.5, 4.5]], nuts: [[15, 27], [24, 29]] },
  { trunk: [5, 16], lobes: [[20, 21, 13, 10], [10.5, 27, 7, 6], [29.5, 26.5, 7.5, 6.5], [20, 29.5, 10, 4.5]], nuts: [[11, 26], [18, 19], [26, 23], [30, 28], [18, 29]] },
  { trunk: [7, 17], lobes: [[13, 11.5, 7, 5.5], [27, 11, 6.5, 5.5], [20, 18, 15, 11.5], [8.5, 25, 7, 7], [31.5, 24.5, 7, 7.5], [20, 28.5, 13, 5.5]], nuts: [[12, 10], [26, 12], [8, 23], [17, 19], [24, 24], [32, 21], [14, 28], [28, 29]] },
  { trunk: [9, 18], lobes: [[20, 5.5, 7, 4.2], [12, 9, 8, 6.5], [28, 8.5, 8.5, 6.5], [20, 16, 17.5, 13], [8, 24.5, 6.6, 8], [32, 24, 6.6, 8.5], [20, 28.5, 15, 6]], nuts: [[19, 4], [10, 9], [27, 8], [5, 22], [14, 17], [22, 14], [30, 17], [35, 23], [10, 28], [19, 24], [27, 27], [32, 30]] }
];
const oak = {
  w: 40, h: 48,
  draw(g, f, o) {
    const n = level(o, 5), G = 46, cx = 20;
    if (!n) return void plot(g, 40, 48);
    const T = OAKS[n - 1], [tw, th] = T.trunk, x0 = cx - Math.ceil(tw / 2);
    // A sapling is staked and tied.
    if (n === 1) {
      g.line(x0 + 1, G - 6, x0 + 5, G - 7, "#FFF6DF");
      stake(g, x0 + 5, G - 8, G);
    }
    g.stamp((l) => {
      for (let j = 0; j < th; j++) {
        const flare = tw >= 5 ? (j === 0 ? 2 : j === 1 ? 1 : 0) : tw >= 3 && j === 0 ? 1 : 0;
        for (let i = -flare; i < tw + flare; i++) {
          const u = (i + 0.5) / tw, x = x0 + i, y = G - j;
          l.px(x, y, u < 0.3 ? BARK[0] : u > 0.7 ? BARK[2] : (x * 5 + y * 3) % 7 === 0 ? BARK[2] : BARK[1]);
        }
      }
      if (n >= 3) l.line(x0, G - th + 5, x0 - 4, G - th, BARK[1]).line(x0 + tw - 1, G - th + 5, x0 + tw + 3, G - th, BARK[2]);
      if (n === 5) l.ell(cx - 0.5, G - 4.5, 1.6, 2.2, "#3A2410");
    }, INK);
    g.stamp((l) => T.lobes.forEach(([x, y, a, b]) => l.ell(x, y, a, b, lobe)), INK_LEAF);
    acorns(g, T.nuts, "#1A4A26");
    // A basket of the harvest at the foot of a grown tree.
    if (n >= 4) {
      const bx = x0 + tw + 3;
      acorns(g, n === 5 ? [[bx + 1, G - 6], [bx + 4, G - 6], [bx + 2, G - 8]] : [[bx + 1, G - 6], [bx + 3, G - 6]]);
      g.stamp((l) => {
        l.rect(bx, G - 3, 7, 3, "#C88A45").rect(bx + 1, G, 5, 1, "#A86A32").rect(bx, G - 3, 7, 1, "#E8B86B");
        for (let i = 1; i < 7; i += 2) l.px(bx + i, G - 2, "#8A5424").px(bx + i - 1, G - 1, "#8A5424");
      }, INK);
    }
    // The great oak wears a ribbon, and some of its acorns are gold.
    if (n === 5) {
      g.stamp((l) => l.rect(x0, G - 11, tw, 2, RED[1]).rect(x0, G - 11, 2, 2, RED[0]).rect(x0 + tw - 2, G - 11, 2, 2, RED[2]).rect(cx - 1, G - 11, 2, 2, GOLD[1]), INK);
      for (const [x, y] of [[22, 14], [10, 9], [32, 30]]) g.px(x, y + 1, GOLD[0]).px(x + 1, y + 1, GOLD[1]).px(x, y + 2, GOLD[1]).px(x + 1, y + 2, GOLD[2]).px(x + 2, y - 1, "#FFFFFF");
    }
  }
};

// ---------------------------------------------------------------- the store
const store = {
  w: 32, h: 28,
  draw(g, f, o) {
    const n = level(o, 5), G = 26;
    if (!n) return void plot(g, 32, 28);
    if (n === 1) {
      // A hollow log on its side, acorns spilling from the open end.
      g.stamp((l) => {
        for (let j = 0; j < 10; j++) {
          const inset = [2, 1, 0, 0, 0, 0, 0, 0, 1, 2][j];
          for (let x = 8 + inset; x < 30 - inset; x++) l.px(x, G - 9 + j, j < 2 ? STICK[0] : j > 7 ? STICK[2] : (x * 3 + j * 5) % 11 === 0 ? STICK[2] : STICK[1]);
        }
        l.rect(19, G - 11, 2, 2, STICK[1]);
      }, INK);
      g.rect(13, G - 9, 5, 1, TURF[1]).rect(14, G - 8, 3, 1, TURF[2]).rect(24, G - 9, 3, 1, TURF[1]);
      g.stamp((l) => l.rect(20, G - 13, 3, 2, "#2FA35E").px(20, G - 13, "#B9F0B4"), INK_LEAF);
      g.stamp((l) => l.ell(10, G - 4.5, 4, 5, (nx, ny) => (nx + ny < -0.4 ? "#F0D9A8" : "#DCA662")), INK);
      g.ell(10, G - 4.5, 2.6, 3.6, "#3A2410");
      acorns(g, [[9, G - 3]], "#1A120A");
      acorns(g, [[3, G - 2], [6, G - 2], [12, G - 2]]);
      return;
    }
    if (n === 2) {
      // Sticks and mud under thatch, the door a dark gap.
      g.stamp((l) => wall(l, 8, G - 8, 16, 9, "mud"), INK);
      g.rect(13, G - 6, 5, 7, "#3A2410").px(13, G - 6, MUD[2]).px(17, G - 6, MUD[2]);
      acorns(g, [[14, G - 2]], "#1A120A");
      g.stamp((l) => roof(l, 16, G - 17, 9, 2, 11, THATCH, true), INK);
      acorns(g, [[3, G - 2], [26, G - 2], [28, G - 2]]);
      return;
    }
    if (n === 3) {
      // A timber shed with a tiled roof and its first barrel.
      g.stamp((l) => wall(l, 5, G - 10, 20, 11, "timber").rect(5, G - 10, 2, 11, TIMBER[2]).rect(23, G - 10, 2, 11, TIMBER[3]), INK);
      g.stamp((l) => door(l, 10, G - 7, 6, 8, PLANK, GOLD[1]), INK);
      g.stamp((l) => roof(l, 15, G - 19, 9, 5, 13, TILE), INK);
      barrel(g, 25, G - 5);
      return;
    }
    if (n === 4) {
      // Timber on a stone footing, a loft hatch in the roof, two barrels.
      g.stamp((l) => { wall(l, 4, G - 12, 22, 8, "timber"); wall(l, 4, G - 4, 22, 5, "stone"); l.rect(4, G - 12, 2, 8, TIMBER[2]).rect(24, G - 12, 2, 8, TIMBER[3]); }, INK);
      g.stamp((l) => door(l, 8, G - 8, 6, 9, PLANK, GOLD[1]), INK);
      g.stamp((l) => pane(l, 17, G - 9, 3, 3), INK);
      g.stamp((l) => roof(l, 15, G - 22, 10, 6, 14, TILE), INK);
      g.stamp((l) => l.rect(12, G - 20, 7, 1, TILE[0]).rect(13, G - 19, 5, 4, TIMBER[1]).rect(14, G - 18, 3, 3, "#FFD27A").px(14, G - 18, "#FFF6C2"), INK);
      barrel(g, 21, G - 5);
      barrel(g, 26, G - 5);
      return;
    }
    // A proper store: stone below, timber above, a gold ridge, barrels stacked.
    g.stamp((l) => {
      wall(l, 3, G - 8, 24, 9, "stone");
      wall(l, 2, G - 15, 26, 7, "timber").rect(2, G - 15, 2, 7, TIMBER[2]).rect(26, G - 15, 2, 7, TIMBER[3]).rect(2, G - 9, 26, 1, TIMBER[3]);
      pane(l, 6, G - 13, 3, 3);
      pane(l, 21, G - 13, 3, 3);
      l.rect(13, G - 14, 4, 5, "#F0D9A8").rect(13, G - 14, 4, 1, "#FFF6DF");
      acornBit(l, 14, G - 13);
    }, INK);
    g.stamp((l) => { door(l, 6, G - 7, 8, 8, PLANK, GOLD[1]); l.rect(6, G - 5, 2, 1, GOLD[2]).rect(12, G - 5, 2, 1, GOLD[2]).rect(6, G - 1, 2, 1, GOLD[2]).rect(12, G - 1, 2, 1, GOLD[2]); }, INK);
    g.stamp((l) => roof(l, 15, G - 23, 8, 7, 15, TILE).rect(8, G - 24, 14, 1, GOLD[1]).rect(8, G - 24, 4, 1, GOLD[0]).px(15, G - 25, GOLD[1]), INK);
    barrel(g, 20, G - 5);
    barrel(g, 26, G - 5);
    barrel(g, 23, G - 11);
  }
};

// ---------------------------------------------------------------- the fence
/** A row of pointed logs, 3 wide each, standing on row `by`. */
const logs = (l, x0, count, by, tall) => {
  for (let k = 0; k < count; k++) {
    const x = x0 + k * 3, hgt = tall(k);
    l.rect(x, by - hgt + 2, 1, hgt - 1, STICK[0]).rect(x + 1, by - hgt + 2, 1, hgt - 1, STICK[1]).rect(x + 2, by - hgt + 2, 1, hgt - 1, STICK[3]);
    l.px(x + 1, by - hgt + 1, STICK[0]);
  }
};
const fence = {
  w: 72, h: 18,
  draw(g, f, o) {
    const n = level(o, 5), G = 16;
    if (!n) return void plot(g, 72, 18);
    // Two runs, columns 1 to 31 and 40 to 70, with the way in between them.
    if (n === 1) {
      // Thin sticks and two rails, none of them straight.
      g.stamp((l) => {
        for (const x0 of [1, 40]) {
          l.rect(x0, G - 4, 31, 1, STICK[0]).rect(x0, G - 2, 31, 1, STICK[1]);
          for (let k = 0; k < 6; k++) {
            const x = x0 === 1 ? (k < 5 ? 2 + k * 6 : 31) : k < 5 ? 69 - k * 6 : 40, hgt = 6 + [1, 0, 1, -1, 0, 1][k];
            l.rect(x, G - hgt + 1, 1, hgt, STICK[1]).px(x, G - hgt + 1, STICK[0]);
          }
        }
      }, INK);
      return;
    }
    if (n === 2) {
      // Woven wattle between posts, a wicket in the gap.
      g.stamp((l) => {
        for (const x0 of [1, 40]) for (let i = 0; i < 31; i++) for (let j = 0; j < 7; j++) l.px(x0 + i, G - 6 + j, j === 0 ? MUD[0] : ((i >> 1) + j) % 2 ? MUD[1] : MUD[2]);
      }, INK);
      g.stamp((l) => { for (const x of [1, 11, 21, 30, 40, 49, 59, 69]) l.rect(x, G - 9, 2, 10, STICK[1]).rect(x, G - 9, 1, 10, STICK[0]).rect(x, G - 9, 2, 1, "#F0D9A8"); }, INK);
      g.stamp((l) => { for (const x of [33, 35, 37, 38]) l.rect(x, G - 5, 1, 6, STICK[0]); l.rect(32, G - 3, 8, 1, STICK[1]); }, INK);
      return;
    }
    if (n === 3) {
      // A palisade of sharpened logs roped together, a plank gate.
      g.stamp((l) => {
        logs(l, 2, 10, G, (k) => (k === 9 ? 14 : 11 + (k % 2)));
        logs(l, 40, 10, G, (k) => (k === 0 ? 14 : 12 - (k % 2)));
        for (const x0 of [2, 40]) for (let x = x0; x < x0 + 30; x++) l.px(x, G - 7, x % 3 === (x0 + 2) % 3 ? "#B8A070" : "#F0E0B0");
      }, INK);
      g.stamp((l) => {
        for (let i = 0; i < 8; i++) l.rect(32 + i, G - 9, 1, 10, i % 3 === 0 ? TIMBER[0] : i % 3 === 1 ? TIMBER[1] : TIMBER[2]);
        l.rect(32, G - 8, 8, 1, PLANK[2]).rect(32, G - 2, 8, 1, PLANK[2]).line(32, G - 7, 39, G - 3, PLANK[1]);
      }, INK);
      return;
    }
    if (n === 4) {
      // Squared timbers on a stone footing, stone piers at the ends and the gate.
      g.stamp((l) => {
        logs(l, 6, 7, G - 5, (k) => 9 - (k % 2));
        logs(l, 45, 7, G - 5, (k) => 8 + (k % 2));
        for (const x0 of [6, 45]) { l.rect(x0, G - 9, 21, 1, "#7E8698"); wall(l, x0, G - 5, 21, 6, "stone"); }
      }, INK);
      g.stamp((l) => {
        for (const x0 of [1, 27, 40, 66]) { wall(l, x0, G - 13, 5, 14, "stone"); l.rect(x0, G - 14, 5, 1, STONE[0]); }
      }, INK_STONE);
      g.stamp((l) => {
        for (let i = 0; i < 8; i++) l.rect(32 + i, G - 10, 1, 11, i === 3 ? TIMBER[3] : i === 4 ? TIMBER[0] : i % 2 ? TIMBER[1] : TIMBER[2]);
        l.rect(32, G - 9, 8, 1, "#7E8698").rect(32, G - 2, 8, 1, "#7E8698").px(32, G - 9, STONE[1]).px(32, G - 2, STONE[1]);
      }, INK);
      return;
    }
    // Stone, with battlements, gold-capped towers and a lantern over the gate.
    g.stamp((l) => {
      for (const x0 of [6, 45]) {
        wall(l, x0, G - 10, 21, 11, "stone");
        for (let k = 0; k < 4; k++) l.rect(x0 + k * 6, G - 13, 3, 3, STONE[1]).rect(x0 + k * 6, G - 13, 3, 1, STONE[0]).rect(x0 + k * 6 + 2, G - 12, 1, 2, STONE[2]);
      }
    }, INK_STONE);
    g.stamp((l) => {
      for (const x0 of [1, 27, 40, 66]) { wall(l, x0, G - 14, 5, 15, "stone"); l.rect(x0, G - 15, 5, 1, GOLD[1]).px(x0, G - 15, GOLD[0]).px(x0 + 4, G - 15, GOLD[2]); }
      l.rect(32, G - 14, 8, 2, STONE[1]).rect(32, G - 14, 8, 1, STONE[0]);
    }, INK_STONE);
    g.rect(32, G - 12, 8, 13, "#2E2630");
    g.stamp((l) => { door(l, 33, G - 6, 6, 7, PLANK); l.px(34, G - 4, GOLD[1]).px(37, G - 4, GOLD[1]).px(34, G - 1, GOLD[1]).px(37, G - 1, GOLD[1]); }, INK);
    lantern(g, 34, G - 12);
  }
};

// ---------------------------------------------------------------- the lookout
/** The lookout's top: a planked floor, a half wall, posts and a roof. `y` is the floor's top row. */
const cabin = (g, y, wallKind, P, thatch, rows) => {
  g.stamp((l) => l.rect(3, y - 8, 2, 4, TIMBER[1]).rect(17, y - 8, 2, 4, TIMBER[2]).rect(3, y - 8, 1, 4, TIMBER[0]), INK);
  g.stamp((l) => wall(l, 3, y - 4, 16, 4, wallKind), INK);
  g.stamp((l) => l.rect(2, y, 18, 2, TIMBER[1]).rect(2, y, 18, 1, TIMBER[0]).rect(2, y + 1, 18, 1, TIMBER[2]), INK);
  g.stamp((l) => roof(l, 11, y - 8 - rows, rows, 1, 10, P, thatch), INK);
};
const tower = {
  w: 22, h: 44,
  draw(g, f, o) {
    const n = level(o, 5), G = 42;
    if (!n) return void plot(g, 22, 44);
    if (n === 1) {
      // A tall stump to stand on, a ladder up its side.
      g.stamp((l) => {
        for (let j = 0; j < 17; j++) {
          const flare = j === 0 ? 2 : j === 1 ? 1 : 0;
          for (let x = 4 - flare; x < 13 + flare; x++) l.px(x, G - j, x < 6 ? BARK[0] : x > 10 ? BARK[2] : (x * 5 + j * 3) % 7 === 0 ? BARK[2] : BARK[1]);
        }
        l.ell(8.5, G - 17, 4.5, 1.9, "#E8C48A").rect(7, G - 17, 3, 1, "#C99A62");
        l.line(4, G - 10, 2, G - 13, BARK[1]);
      }, INK);
      g.stamp((l) => l.rect(1, G - 16, 3, 2, "#2FA35E").px(1, G - 16, "#B9F0B4"), INK_LEAF);
      ladder(g, 15, G - 19, G);
      return;
    }
    if (n === 2) {
      // A platform on lashed poles, open to the sky.
      g.stamp((l) => l.line(6, G - 2, 15, G - 13, STICK[2]).line(15, G - 2, 6, G - 13, STICK[1]), INK);
      g.stamp((l) => { for (const x of [4, 16]) l.rect(x, G - 23, 2, 24, STICK[1]).rect(x, G - 23, 1, 24, STICK[0]); l.rect(6, G - 21, 10, 1, STICK[0]); }, INK);
      g.stamp((l) => l.rect(2, G - 16, 18, 2, TIMBER[1]).rect(2, G - 16, 18, 1, TIMBER[0]), INK);
      for (const x of [4, 16]) g.rect(x, G - 16, 2, 2, "#F0E0B0").px(x + 1, G - 15, "#B8A070");
      ladder(g, 9, G - 14, G);
      return;
    }
    if (n === 3) {
      // A timber tower: braced legs, a boxed top, thatch over it.
      g.stamp((l) => l.line(7, G - 1, 14, G - 13, TIMBER[2]).line(14, G - 1, 7, G - 13, TIMBER[1]), INK);
      g.stamp((l) => { for (const x of [4, 15]) l.rect(x, G - 14, 3, 15, TIMBER[1]).rect(x, G - 14, 1, 15, TIMBER[0]).rect(x + 2, G - 14, 1, 15, TIMBER[2]); }, INK);
      cabin(g, G - 16, "timber", THATCH, true, 7);
      ladder(g, 9, G - 14, G);
      return;
    }
    const top = n === 4 ? G - 19 : G - 20;
    // A stone tower: at 4 a timber top, at 5 stone all the way with a lantern.
    g.stamp((l) => {
      wall(l, 5, top, 12, G - top + 1, "stone");
      l.rect(4, G - 1, 14, 2, STONE[2]).rect(4, G - 1, 1, 2, STONE[1]);
      l.rect(10, top + 5, 2, 4, "#2E2630");
      if (n === 5) l.rect(10, top + 11, 2, 3, "#2E2630");
    }, INK_STONE);
    g.stamp((l) => door(l, 9, G - 5, 4, 6, PLANK, n === 5 ? GOLD[1] : null), INK);
    if (n === 4) {
      cabin(g, top - 2, "timber", TILE, false, 6);
      return;
    }
    // Level 5: a stone parapet on corbels, the lantern under a gold-tipped roof.
    g.stamp((l) => l.rect(3, top - 9, 2, 6, STONE[1]).rect(17, top - 9, 2, 6, STONE[2]).rect(3, top - 9, 1, 6, STONE[0]), INK_STONE);
    lantern(g, 10, top - 9);
    g.stamp((l) => {
      wall(l, 2, top - 3, 18, 3, "stone");
      for (const x of [2, 6, 10, 14, 18]) l.rect(x, top - 4, 2, 1, STONE[0]);
      l.rect(3, top, 16, 2, STONE[2]).rect(3, top, 16, 1, STONE[1]);
    }, INK_STONE);
    g.stamp((l) => roof(l, 11, top - 15, 6, 1, 10, TILE).rect(1, top - 10, 20, 1, GOLD[1]).rect(1, top - 10, 6, 1, GOLD[0]).rect(17, top - 10, 4, 1, GOLD[2]), INK);
    g.stamp((l) => l.rect(10, top - 19, 1, 4, STICK[1]).px(10, top - 20, GOLD[1]), INK);
    banner(g, 12, top - 20, 6, 3, RED);
  }
};

// ---------------------------------------------------------------- the scouts' hut
const hut = {
  w: 32, h: 30,
  draw(g, f, o) {
    const n = level(o, 5), G = 28;
    if (!n) return void plot(g, 32, 30);
    if (n === 1) {
      // A lean-to: sticks and leaves propped on a forked pole, a sword in the ground.
      g.stamp((l) => {
        for (let x = 3; x <= 22; x++) {
          const y = G - Math.round(((x - 3) * 13) / 19);
          for (let yy = y; yy <= G; yy++) l.px(x, yy, yy - y < 3 ? ((x + yy) % 4 === 0 ? STICK[2] : (x * 3 + yy) % 7 < 3 ? "#3F9A4E" : yy === y ? STICK[0] : STICK[1]) : "#3A2618");
        }
        l.rect(9, G - 1, 7, 2, "#E8D4A0").rect(9, G - 1, 7, 1, "#FFF6DF");
      }, INK);
      g.stamp((l) => l.rect(22, G - 14, 2, 15, STICK[1]).rect(22, G - 14, 1, 15, STICK[0]).px(21, G - 15, STICK[1]).px(24, G - 15, STICK[1]), INK);
      sword(g, 28, G - 8);
      return;
    }
    if (n === 2) {
      // A round mud hut under a cone of thatch, the sword still by the door.
      g.stamp((l) => wall(l, 7, G - 8, 18, 9, "mud"), INK);
      g.rect(10, G - 5, 5, 6, "#3A2410").rect(11, G - 6, 3, 1, "#3A2410");
      g.stamp((l) => roof(l, 16, G - 18, 10, 1, 12, THATCH, true), INK);
      sword(g, 28, G - 8);
      return;
    }
    if (n === 3) {
      // A timber cabin with a shingled roof and the first shield.
      g.stamp((l) => wall(l, 5, G - 11, 22, 12, "timber").rect(5, G - 11, 2, 12, TIMBER[2]).rect(25, G - 11, 2, 12, TIMBER[3]), INK);
      g.stamp((l) => door(l, 9, G - 8, 6, 9, PLANK, STONE[1]), INK);
      g.stamp((l) => roof(l, 16, G - 21, 10, 4, 14, SHINGLE), INK);
      shield(g, 18, G - 9, RED, "#FFFFFF");
      sword(g, 29, G - 8);
      return;
    }
    if (n === 4) {
      // Stone footing, timber above, slate on the roof, a shield either side.
      g.stamp((l) => { wall(l, 4, G - 12, 24, 9, "timber"); wall(l, 4, G - 3, 24, 4, "stone"); l.rect(4, G - 12, 2, 9, TIMBER[2]).rect(26, G - 12, 2, 9, TIMBER[3]); }, INK);
      g.stamp((l) => door(l, 13, G - 8, 6, 9, PLANK, GOLD[1]), INK);
      g.stamp((l) => roof(l, 16, G - 23, 11, 3, 15, SLATE), INK);
      shield(g, 6, G - 10, RED, "#FFFFFF");
      shield(g, 21, G - 10, ["#8FB0E0", "#2F80E6", "#1F5FB8"], "#FFFFFF");
      return;
    }
    // A hall: stone walls, a great red door, gold on the ridge, the banner flying.
    g.stamp((l) => l.rect(15, 2, 1, 6, STICK[1]).px(15, 1, GOLD[1]), INK);
    banner(g, 17, 1, 8, 5, RED);
    g.stamp((l) => { wall(l, 3, G - 11, 26, 12, "stone"); l.rect(3, G - 11, 26, 1, TIMBER[2]); }, INK_STONE);
    g.stamp((l) => { door(l, 12, G - 9, 8, 10, RED, GOLD[1]); l.rect(12, G - 6, 2, 1, GOLD[2]).rect(18, G - 6, 2, 1, GOLD[2]).rect(12, G - 2, 2, 1, GOLD[2]).rect(18, G - 2, 2, 1, GOLD[2]); }, INK);
    g.stamp((l) => roof(l, 16, G - 22, 11, 4, 15, SLATE).rect(12, G - 23, 8, 1, GOLD[1]).rect(12, G - 23, 3, 1, GOLD[0]), INK);
    shield(g, 5, G - 9, RED, GOLD[1]);
    shield(g, 22, G - 9, ["#8FB0E0", "#2F80E6", "#1F5FB8"], GOLD[1]);
  }
};

// ---------------------------------------------------------------- building work
const scaffold = {
  w: 28, h: 24, frames: 8,
  draw(g, f) {
    const G = 22, k = ((Math.round(f) % 8) + 8) % 8;
    g.stamp((l) => l.line(5, 14, 22, 9, TIMBER[2]).line(5, 21, 22, 17, TIMBER[2]), INK);
    g.stamp((l) => { for (const x of [3, 23]) l.rect(x, 1, 2, G, TIMBER[1]).rect(x, 1, 1, G, TIMBER[0]); }, INK);
    g.stamp((l) => {
      for (const y of [7, 15]) {
        l.rect(1, y, 26, 2, "#C4904E").rect(1, y, 26, 1, "#F0D9A8");
        for (let x = 9; x < 26; x += 9) l.px(x, y + 1, TIMBER[2]);
      }
    }, INK);
    for (const y of [7, 15]) for (const x of [3, 23]) g.rect(x, y, 2, 2, "#F0E0B0").px(x + 1, y + 1, "#B8A070");
    // The hammer: up, back a little, then down on the plank.
    const a = ([-35, -45, -25, 20, 62, 80, 60, 5][k] * Math.PI) / 180, hx = 13, hy = 6;
    const tx = Math.round(hx + Math.sin(a) * 5), ty = Math.round(hy - Math.cos(a) * 5);
    g.stamp((l) => l.line(hx, hy, tx, ty, TIMBER[0]).rect(tx - 1, ty - 1, 3, 3, STONE[2]).px(tx - 1, ty - 1, STONE[0]).px(tx, ty - 1, STONE[1]).px(tx + 1, ty + 1, STONE[3]), INK);
    if (k === 5) g.px(tx + 3, ty - 2, GOLD[1]).px(tx + 4, ty, "#FFFFFF").px(tx + 2, ty - 3, GOLD[0]);
  }
};

// ---------------------------------------------------------------- acorn and magpie
const acorn = {
  w: 9, h: 9,
  draw(g) {
    g.stamp((l) => {
      l.px(4, 1, "#6B4226");
      l.rect(2, 2, 5, 1, "#B88350").rect(1, 3, 7, 1, "#946235").rect(2, 2, 2, 1, "#D9A86A").px(3, 3, "#6B4226").px(5, 3, "#6B4226").px(7, 3, "#6B4226");
      l.rect(1, 4, 7, 2, "#E8A93A").rect(2, 6, 5, 1, "#E8A93A").rect(3, 7, 3, 1, "#B8702A");
      l.rect(2, 4, 2, 1, "#FFE08A").px(2, 5, "#FFE08A");
      l.rect(7, 4, 1, 2, "#B8702A").px(6, 5, "#B8702A").rect(5, 6, 2, 1, "#B8702A");
    }, "#3A2410");
  }
};

/** The magpie as pixel maps: K black, W white, w white in shade, B blue, b blue in light, T teal, G beak. */
const PIE = { K: "#1E1E2A", W: "#FFFFFF", w: "#CFD8E4", B: "#2F6FD0", b: "#7FB2FF", T: "#1F8A9A", G: "#8A8A98" };
const PIE_BODY = [
  "....KK",
  "...KWKKKKKK",
  ".GGKKKKKKKKKKKKKK",
  "....KKWWWWKKTTTTT",
  "......WWWWw"
];
/** The near wing, from raised to fully down, with the row (counted from the top of the head) it starts on. */
const PIE_WINGS = [
  [-5, ["............KK", "..........KKWWK", ".........KKWWWK", "........KKBBWWK", "........KBbBBWK", ".......KKBbBBK"]],
  [-2, ["...........KKKK", "........KKBBWWWK", ".......KKBbBBBWK"]],
  [2, [".......KBbBBBK", "........KBBBWWK", ".........KBWWWK", "..........KKKK"]],
  [2, [".......KBbBBK", "........KBBBBK", "........KBBBWK", ".........KBWWK", ".........KWWWK", "..........KWWK", "...........KK"]]
];
const pieMap = (l, rows, y) => rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (PIE[row[i]]) l.px(i, y + j, PIE[row[i]]); });

const magpie = {
  w: 18, h: 14, frames: 6,
  draw(g, f) {
    // Up, half up, half down, down, and back again; the body lifts on the downstroke.
    const k = ((Math.round(f) % 6) + 6) % 6, [from, wing] = PIE_WINGS[[0, 1, 2, 3, 2, 1][k]], y = [6, 5, 5, 4, 5, 5][k];
    g.stamp((l) => { pieMap(l, PIE_BODY, y); pieMap(l, wing, y + from); }, "#0B0B14");
  }
};

// ---------------------------------------------------------------- magpie camps
const TWIG = ["#A88A68", "#7A5E46", "#54402E", "#3A2A1E"];
const ROOK = ["#AEB4C2", "#7E8698", "#596074", "#3E4456"];
const PURPLE = ["#9A78D0", "#5E3AB8", "#3A2478"];
const twig = (x, y) => ((x + y * 2) % 5 === 0 ? TWIG[2] : (x * 2 - y * 3 + 90) % 7 === 0 ? TWIG[0] : TWIG[1]);

/** A twig nest bowl: `top` is the rim row; loose twigs stick out of the rim. */
const bowl = (l, cx, top, half, rows) => {
  for (let j = 0; j < rows; j++) {
    const t = j / (rows - 1), hw = Math.round(half * (j === 0 ? 0.92 : 1 - 0.45 * t * t));
    for (let i = -hw; i < hw; i++) {
      const x = cx + i, y = top + j;
      l.px(x, y, j === 0 ? (x % 3 === 0 ? TWIG[1] : TWIG[0]) : j === rows - 1 || i >= hw - 1 ? TWIG[2] : twig(x, y));
    }
  }
  l.line(cx - half, top, cx - half - 2, top - 2, TWIG[1]).line(cx + half - 1, top + 1, cx + half + 2, top - 1, TWIG[1]);
  l.line(cx - half + 3, top, cx - half + 2, top - 2, TWIG[0]).line(cx + half - 5, top, cx + half - 4, top - 3, TWIG[1]);
};

/** Stolen shiny things heaped in a nest whose rim is row `y`: more with `n`. */
const loot = (g, cx, y, n) => {
  if (n >= 2) g.stamp((l) => l.ell(cx + 1, y - 3, 2, 2, (nx, ny) => (nx + ny < -0.4 ? GOLD[0] : nx + ny > 0.6 ? GOLD[2] : GOLD[1])), INK_GOLD);
  g.stamp((l) => l.ell(cx - 5, y - 1.5, 2, 2, (nx, ny) => (nx + ny < -0.4 ? GOLD[0] : nx + ny > 0.6 ? GOLD[2] : GOLD[1])), INK_GOLD);
  g.stamp((l) => l.px(cx + 5, y - 3, "#BDEBFF").rect(cx + 4, y - 2, 3, 1, "#3EC1F0").px(cx + 5, y - 1, "#1E88C8"), "#0E3A5A");
  g.stamp((l) => l.rect(cx - 1, y - 1, 3, 1, STONE[0]).px(cx + 2, y - 1, STONE[1]), INK_STONE);
  if (n >= 1) g.stamp((l) => l.rect(cx - 9, y - 1, 2, 1, "#FF8FB0").px(cx - 9, y - 1, "#FFD0E0"), "#5A1E3A");
  g.px(cx - 7, y - 4, "#FFFFFF").px(cx + 7, y - 4, "#FFFFFF");
};

/** A magpie tail feather standing up from (x, y), leaning the way of `dir`. */
const feather = (g, x, y, dir = 1) => g.stamp((l) => l.line(x, y, x + 3 * dir, y - 8, PIE.K).line(x + dir, y, x + 4 * dir, y - 7, PIE.B).px(x + 3 * dir, y - 9, PIE.W).px(x + 2 * dir, y - 6, PIE.b), "#0B0B14");

/** Sharpened sticks leaning out of the ground, from x0 to x1. */
const spikes = (g, x0, x1, by, hgt, lean) => g.stamp((l) => {
  for (let x = x0; x <= x1; x += 3) l.line(x, by, x + lean, by - hgt + ((x / 3) % 2 ? 1 : 0), TWIG[1]).line(x + 1, by, x + 1 + lean, by - hgt + 2, TWIG[2]);
}, INK);

const nest = {
  w: 44, h: 34,
  draw(g, f, o) {
    const n = level(o, 4), G = 32, cx = 22;
    if (n === 0) {
      // A scruffy nest on the ground, shiny loot in it.
      loot(g, cx, G - 6, 0);
      g.stamp((l) => bowl(l, cx, G - 6, 12, 7), INK);
      return;
    }
    if (n === 1) {
      // A bigger nest on a heap of stones, a tail feather stuck in it for a flag.
      feather(g, 31, G - 13);
      g.stamp((l) => { l.ell(13, G - 1.5, 6, 2.6, ROOK[1]); l.ell(28, G - 2, 8, 3.2, (nx, ny) => (ny < -0.3 ? ROOK[0] : ROOK[1])); l.ell(20, G - 4, 7, 2.6, (nx, ny) => (ny < -0.2 ? ROOK[0] : ROOK[2])); }, INK_STONE);
      loot(g, cx, G - 13, 1);
      g.stamp((l) => bowl(l, cx, G - 13, 14, 9), INK);
      return;
    }
    if (n === 2) {
      // The nest up on a dead stump, sharpened sticks round the foot of it.
      g.stamp((l) => {
        for (let j = 0; j < 11; j++) {
          const flare = j === 0 ? 2 : j === 1 ? 1 : 0;
          for (let x = 17 - flare; x < 27 + flare; x++) l.px(x, G - j, x < 20 ? "#A89880" : x > 24 ? "#56493C" : (x * 5 + j * 3) % 7 === 0 ? "#56493C" : "#7E6E5C");
        }
      }, INK);
      feather(g, 31, G - 17);
      feather(g, 9, G - 17, -1);
      loot(g, cx, G - 17, 2);
      g.stamp((l) => bowl(l, cx, G - 17, 14, 8), INK);
      spikes(g, 3, 13, G, 7, -2);
      spikes(g, 30, 40, G, 7, 2);
      return;
    }
    if (n === 3) {
      // A rookery: a woven twig tower with the nest on top and a ragged pennant.
      spikes(g, 2, 8, G, 9, -2);
      spikes(g, 35, 41, G, 9, 2);
      g.stamp((l) => l.rect(33, G - 29, 1, 11, TWIG[1]), INK);
      g.stamp((l) => [6, 5, 3, 1].forEach((wide, j) => l.rect(34, G - 29 + j, wide, 1, j === 0 ? PURPLE[0] : PURPLE[1])), INK);
      g.stamp((l) => dome(l, cx, G, 12, 16, (u, t, x, y, edge) => (edge ? TWIG[0] : u > 0.6 ? TWIG[2] : twig(x, y)), 3), INK);
      g.stamp((l) => dome(l, cx, G, 3, 6, "#1E1620"), INK);
      g.rect(cx - 1, G - 11, 2, 2, "#1E1620");
      loot(g, cx, G - 21, 2);
      g.stamp((l) => bowl(l, cx, G - 21, 12, 7), INK);
      return;
    }
    // A walled rookery: a tall twig tower behind a stone wall, a small nest on
    // a post, and the banner flying from a stolen spoon.
    g.stamp((l) => l.rect(37, 7, 1, 18, STONE[1]).ell(37.5, 3.5, 1.6, 2.6, (nx, ny) => (nx + ny < -0.3 ? "#FFFFFF" : STONE[0])), INK_STONE);
    g.stamp((l) => {
      for (let j = 0; j < 8; j++) for (let i = 0; i < 5; i++) if (!(j === 7 && i % 2)) l.px(38 + i, 8 + j, j === 0 ? PURPLE[0] : i === 4 ? PURPLE[2] : PURPLE[1]);
      l.rect(39, 9, 3, 3, "#FFFFFF").rect(40, 12, 1, 3, "#FFFFFF").px(41, 11, "#C4CCD8");
    }, INK);
    g.stamp((l) => l.rect(6, G - 14, 2, 6, TWIG[1]), INK);
    g.stamp((l) => bowl(l, 7, G - 17, 5, 4), INK);
    g.px(6, G - 19, GOLD[1]).px(7, G - 19, GOLD[0]).px(8, G - 18, "#3EC1F0");
    g.stamp((l) => dome(l, cx, G, 11, 22, (u, t, x, y, edge) => (edge ? TWIG[0] : u > 0.6 ? TWIG[2] : twig(x, y)), 3.5), INK);
    g.rect(cx - 1, G - 17, 2, 3, "#1E1620").rect(cx - 5, G - 13, 2, 2, "#1E1620").rect(cx + 3, G - 13, 2, 2, "#1E1620");
    loot(g, cx, G - 27, 2);
    g.stamp((l) => bowl(l, cx, G - 27, 11, 7), INK);
    g.stamp((l) => {
      for (let j = 0; j < 10; j++) for (let i = 0; i < 42; i++) {
        const row = Math.floor(j / 3), off = row % 2 ? 3 : 0, seam = j % 3 === 2 || (i + off) % 6 === 5;
        l.px(1 + i, G - 9 + j, i === 0 ? ROOK[0] : i >= 40 ? ROOK[3] : seam ? ROOK[2] : j % 3 === 0 ? ROOK[0] : ROOK[1]);
      }
      for (let x = 1; x < 42; x += 6) l.rect(x, G - 12, 3, 3, ROOK[1]).rect(x, G - 12, 3, 1, ROOK[0]).px(x + 1, G - 13, TWIG[2]).px(x + 1, G - 14, TWIG[1]);
    }, INK_STONE);
    g.stamp((l) => dome(l, cx, G, 3, 7, "#1E1620"), INK);
    for (const x of [cx - 2, cx, cx + 2]) g.rect(x, G - 5, 1, 6, ROOK[1]);
  }
};

// ---------------------------------------------------------------- the yard
const MOSS = ["#9CD0A0", "#5A9E78", "#35705A", "#245244"];
const CLOTH = ["#FFF6DF", "#E8D4A0", "#C9AE74"];
const HONEY = ["#FFD98A", "#F0A030", "#B8702A"];
const PEAR = ["#E4F08A", "#B4D04E", "#7A9A30"];

/** A hand saw lying flat, 9 x 3: the blade to the left with its teeth down, the handle to the right. */
const saw = (g, x, y) => g.stamp((l) => {
  l.rect(x + 1, y, 5, 1, STONE[0]).rect(x, y + 1, 6, 1, STONE[1]);
  for (let i = 0; i < 6; i += 2) l.px(x + i, y + 2, STONE[2]);
  l.rect(x + 6, y, 3, 3, TIMBER[0]).rect(x + 8, y, 1, 3, TIMBER[2]).px(x + 7, y + 1, PLANK[3]);
}, INK);

const workshop = {
  w: 30, h: 28,
  draw(g, f, o) {
    const n = level(o, 3), G = 26;
    if (!n) return void plot(g, 30, 28);
    if (n === 1) {
      // A lean-to: planks sloped on two poles, a workbench under them, a saw on the bench.
      g.stamp((l) => { for (const [x, top] of [[4, G - 16], [24, G - 9]]) l.rect(x, top, 2, G - top + 1, STICK[1]).rect(x, top, 1, G - top + 1, STICK[0]); }, INK);
      g.stamp((l) => {
        for (let x = 2; x <= 27; x++) {
          const y = G - 19 + Math.round(((x - 2) * 8) / 25), seam = x % 5 === 1;
          l.px(x, y, seam ? TIMBER[1] : TIMBER[0]).px(x, y + 1, seam ? TIMBER[3] : TIMBER[1]).px(x, y + 2, seam ? TIMBER[3] : TIMBER[2]);
        }
      }, INK);
      g.stamp((l) => l.rect(8, G - 6, 14, 2, TIMBER[1]).rect(8, G - 6, 14, 1, TIMBER[0]).rect(9, G - 4, 2, 5, TIMBER[2]).rect(19, G - 4, 2, 5, TIMBER[2]).rect(11, G - 2, 8, 1, PLANK[1]), INK);
      saw(g, 10, G - 9);
      return;
    }
    if (n === 2) {
      // A plank shed open at the front, the bench inside it, sawn timber stacked outside.
      g.stamp((l) => wall(l, 4, G - 11, 19, 12, "timber").rect(4, G - 11, 2, 12, TIMBER[2]).rect(21, G - 11, 2, 12, TIMBER[3]), INK);
      g.rect(7, G - 9, 13, 10, "#3A2618").rect(7, G - 9, 13, 1, "#2A1A10");
      g.rect(8, G - 4, 11, 1, TIMBER[0]).rect(8, G - 3, 11, 1, TIMBER[2]).rect(9, G - 2, 1, 3, TIMBER[2]).rect(17, G - 2, 1, 3, TIMBER[2]);
      saw(g, 9, G - 7);
      g.stamp((l) => roof(l, 13, G - 20, 9, 3, 12, SHINGLE), INK);
      g.stamp((l) => { for (let j = 0; j < 3; j++) l.rect(24, G - 1 - j * 2, 5, 2, TIMBER[1]).rect(24, G - 1 - j * 2, 5, 1, TIMBER[0]).px(28, G - j * 2, TIMBER[3]); }, INK);
      return;
    }
    // A proper workshop: timber on stone under green shingles, tools racked by the door, a barrow of offcuts.
    g.stamp((l) => { wall(l, 3, G - 13, 20, 10, "timber"); wall(l, 3, G - 3, 20, 4, "stone"); l.rect(3, G - 13, 2, 10, TIMBER[2]).rect(21, G - 13, 2, 10, TIMBER[3]); }, INK);
    g.rect(6, G - 10, 8, 11, "#3A2618").rect(5, G - 11, 10, 1, TIMBER[0]);
    g.rect(7, G - 4, 6, 1, TIMBER[0]).rect(7, G - 3, 6, 1, TIMBER[2]).rect(7, G - 2, 1, 3, TIMBER[2]).rect(12, G - 2, 1, 3, TIMBER[2]).rect(8, G - 5, 4, 1, "#F0D9A8");
    g.stamp((l) => l.rect(15, G - 11, 6, 7, "#F0D9A8").rect(15, G - 11, 6, 1, "#FFF6DF"), INK);
    g.rect(15, G - 10, 3, 1, STONE[3]).rect(16, G - 9, 1, 4, PLANK[1]).rect(19, G - 10, 1, 2, PLANK[1]).rect(19, G - 8, 1, 3, STONE[2]);
    g.stamp((l) => roof(l, 13, G - 23, 10, 4, 13, MOSS), INK);
    g.stamp((l) => chart(l, 19, G - 8, ["...c.c....", "..tttttt..", "..TTTTTThh", "...TTTTd..", "...dTTd...", ".WW..d.L..", "WwwW...L..", "WwwW...L..", ".WW....L.."], { c: "#F0D9A8", t: TIMBER[0], T: TIMBER[1], d: TIMBER[2], h: PLANK[0], L: PLANK[1], W: "#4A3A2E", w: STONE[1] }), INK);
  }
};

/** A straw skep: a dome of coiled straw standing on row `by`, its door at the foot. */
const skep = (l, cx, by, rx, ry) => {
  dome(l, cx, by, rx, ry, (u, t, x, y, edge) => {
    const coil = (by - y) % 2 === 1;
    if (edge) return u > 0.4 ? THATCH[1] : THATCH[0];
    if (u > 0.5) return coil ? THATCH[3] : THATCH[2];
    return coil ? THATCH[2] : u < -0.45 ? THATCH[0] : THATCH[1];
  }, 2.6);
  l.rect(cx - 1, by - 1, 2, 2, "#3A2410");
  return l;
};
/** A bee: one gold pixel and its dark tail. */
const bee = (g, x, y) => g.px(x, y, GOLD[1]).px(x + 1, y, INK);
const bloom = (g, x, y, c) => g.px(x, y, c).px(x, y + 1, "#4E9A46");

const hive = {
  w: 30, h: 28,
  draw(g, f, o) {
    const n = level(o, 3), G = 26;
    if (!n) return void plot(g, 30, 28);
    if (n === 1) {
      // One skep on a stand, two bees about it.
      g.stamp((l) => l.rect(8, G - 5, 14, 2, TIMBER[1]).rect(8, G - 5, 14, 1, TIMBER[0]).rect(9, G - 3, 2, 4, TIMBER[2]).rect(19, G - 3, 2, 4, TIMBER[2]), INK);
      g.stamp((l) => skep(l, 15, G - 6, 6, 10), INK);
      bee(g, 5, G - 11);
      bee(g, 23, G - 14);
      return;
    }
    if (n === 2) {
      // Two skeps on a long bench, clover at its feet.
      g.stamp((l) => l.rect(3, G - 5, 24, 2, TIMBER[1]).rect(3, G - 5, 24, 1, TIMBER[0]).rect(4, G - 3, 2, 4, TIMBER[2]).rect(24, G - 3, 2, 4, TIMBER[2]).rect(14, G - 3, 2, 4, TIMBER[2]), INK);
      g.stamp((l) => { skep(l, 9, G - 6, 5, 9); skep(l, 21, G - 6, 5, 10); }, INK);
      bloom(g, 8, G - 1, "#FFB3D1");
      bloom(g, 10, G - 2, "#FFFFFF");
      bloom(g, 20, G - 1, "#FFE066");
      bee(g, 14, G - 14);
      bee(g, 1, G - 12);
      bee(g, 27, G - 17);
      return;
    }
    // A bee house: three skeps on two shelves under a shingled roof, a pot of honey out front.
    g.stamp((l) => { for (const x of [2, 26]) l.rect(x, 7, 2, G - 6, TIMBER[1]).rect(x, 7, 1, G - 6, TIMBER[0]); }, INK);
    g.stamp((l) => l.rect(9, 16, 12, 1, TIMBER[0]).rect(11, 17, 1, 5, TIMBER[2]).rect(18, 17, 1, 5, TIMBER[2]), INK);
    g.stamp((l) => skep(l, 15, 15, 5, 7), INK);
    g.stamp((l) => l.rect(4, 22, 22, 2, TIMBER[1]).rect(4, 22, 22, 1, TIMBER[0]), INK);
    g.stamp((l) => { skep(l, 8, 21, 4, 7); skep(l, 22, 21, 4, 7); }, INK);
    g.stamp((l) => roof(l, 15, 2, 6, 3, 14, SHINGLE), INK);
    g.stamp((l) => {
      l.rect(13, 21, 4, 1, CLOTH[0]).rect(13, 22, 4, 1, RED[1]).rect(12, 23, 6, 4, HONEY[1]).rect(12, 23, 1, 4, HONEY[0]).rect(17, 23, 1, 4, HONEY[2]).rect(12, 26, 6, 1, HONEY[2]);
      l.rect(13, 23, 2, 1, HONEY[0]).px(14, 24, "#FFF6C2");
    }, INK);
    bee(g, 6, 11);
    bee(g, 21, 10);
    bee(g, 24, 13);
  }
};

/** A wooden bucket, 5 x 5 from (x, y), its handle standing up. */
const bucket = (l, x, y) => {
  l.rect(x, y, 5, 5, TIMBER[1]).rect(x, y, 1, 5, TIMBER[0]).rect(x + 4, y, 1, 5, TIMBER[2]).rect(x, y + 1, 5, 1, "#7E8698").rect(x, y + 3, 5, 1, "#7E8698");
  l.px(x, y - 1, "#7E8698").px(x + 4, y - 1, "#7E8698").rect(x + 1, y - 2, 3, 1, "#AEB4C2");
  return l;
};

const well = {
  w: 30, h: 28,
  draw(g, f, o) {
    const n = level(o, 3), G = 26;
    if (!n) return void plot(g, 30, 28);
    if (n === 1) {
      // A ring of stones round the spring, a bucket beside it.
      const cx = 11.5, cy = G - 4;
      const ring = (front) => {
        for (let i = 0; i < 10; i++) {
          const a = ((i + 0.5) / 10) * TAU, s = Math.sin(a);
          if ((s > 0) === front) g.stamp((l) => l.ell(cx + Math.cos(a) * 8.4, cy + s * 3.4, 2, front ? 1.6 : 1.3, (nx, ny) => (ny < -0.2 ? STONE[0] : nx > 0.4 || ny > 0.5 ? STONE[3] : front ? STONE[1] : STONE[2])), INK_STONE);
        }
      };
      ring(false);
      g.stamp((l) => l.ell(cx, cy, 7.6, 3, (nx, ny) => (ny < -0.45 ? "#1F5FB8" : nx < -0.2 && ny < 0.2 ? "#8FD0FF" : "#3E8FD0")), INK_STONE);
      ring(true);
      g.stamp((l) => bucket(l, 23, G - 4), INK);
      return;
    }
    if (n === 2) {
      // A proper wall of stone, two posts and a beam, the bucket hanging on its rope.
      g.stamp((l) => { for (const x of [7, 21]) l.rect(x, G - 20, 2, 12, TIMBER[1]).rect(x, G - 20, 1, 12, TIMBER[0]); l.rect(5, G - 22, 20, 2, TIMBER[1]).rect(5, G - 22, 20, 1, TIMBER[0]); }, INK);
      g.rect(15, G - 20, 1, 4, "#F0E0B0");
      g.stamp((l) => bucket(l, 13, G - 14), INK);
      g.stamp((l) => { wall(l, 6, G - 7, 18, 8, "stone"); l.rect(5, G - 9, 20, 2, STONE[1]).rect(5, G - 9, 20, 1, STONE[0]); }, INK_STONE);
      return;
    }
    // A roofed well: slate over a windlass and its crank, the bucket up on the rim, flowers at the foot.
    g.stamp((l) => { for (const x of [6, 22]) l.rect(x, G - 18, 2, 10, TIMBER[1]).rect(x, G - 18, 1, 10, TIMBER[0]); }, INK);
    g.stamp((l) => { l.rect(8, G - 18, 14, 2, TIMBER[1]).rect(8, G - 18, 14, 1, TIMBER[0]); for (let x = 12; x < 18; x++) l.rect(x, G - 18, 1, 2, x % 2 ? "#F0E0B0" : "#B8A070"); }, INK);
    g.stamp((l) => l.rect(24, G - 18, 2, 1, "#7E8698").rect(25, G - 18, 1, 4, "#7E8698").rect(25, G - 14, 3, 1, TIMBER[0]), INK_STONE);
    g.rect(13, G - 16, 1, 1, "#F0E0B0");
    g.stamp((l) => { wall(l, 5, G - 6, 20, 7, "stone"); l.rect(4, G - 8, 22, 2, STONE[1]).rect(4, G - 8, 22, 1, STONE[0]); l.rect(3, G - 1, 24, 2, STONE[2]).rect(3, G - 1, 24, 1, STONE[1]); }, INK_STONE);
    g.stamp((l) => bucket(l, 11, G - 13), INK);
    g.stamp((l) => roof(l, 15, G - 24, 6, 3, 14, SLATE).rect(14, G - 25, 2, 1, GOLD[1]).px(14, G - 25, GOLD[0]), INK);
    bloom(g, 1, G - 1, "#FFB3D1");
    bloom(g, 28, G - 1, "#FFE066");
  }
};

/** A slatted crate, 7 x 5 from (x, y), heaped with fruit in the colours P. */
const crate = (g, x, y, P) => g.stamp((l) => {
  l.rect(x, y, 7, 5, TIMBER[1]).rect(x, y, 7, 1, TIMBER[0]).rect(x, y + 2, 7, 1, PLANK[1]).rect(x, y + 4, 7, 1, TIMBER[2]).rect(x, y, 1, 5, TIMBER[2]).rect(x + 6, y, 1, 5, TIMBER[3]);
  for (let i = 0; i < 3; i++) l.rect(x + 1 + i * 2, y - 2 + (i === 1 ? -1 : 0), 2, 2 + (i === 1 ? 1 : 0), P[1]).px(x + 1 + i * 2, y - 2 + (i === 1 ? -1 : 0), P[0]).px(x + 2 + i * 2, y - 1, P[2]);
}, INK);

const stall = {
  w: 30, h: 28,
  draw(g, f, o) {
    const n = level(o, 3), G = 26;
    if (!n) return void plot(g, 30, 28);
    if (n === 1) {
      // A plank across two barrels, a patched cloth on two poles over it.
      g.stamp((l) => { for (const x of [3, 25]) l.rect(x, G - 18, 2, 19, STICK[1]).rect(x, G - 18, 1, 19, STICK[0]); }, INK);
      barrel(g, 7, G - 5);
      barrel(g, 18, G - 5);
      g.stamp((l) => l.rect(6, G - 7, 18, 2, TIMBER[1]).rect(6, G - 7, 18, 1, TIMBER[0]), INK);
      acorns(g, [[8, G - 10], [11, G - 10]]);
      g.stamp((l) => l.rect(16, G - 9, 2, 2, RED[1]).px(16, G - 9, RED[0]).rect(19, G - 9, 2, 2, RED[1]).px(19, G - 9, RED[0]), INK);
      g.stamp((l) => {
        for (let i = 0; i < 26; i++) {
          const sag = Math.round(Math.sin((i / 25) * Math.PI) * 1.4);
          l.px(2 + i, G - 21 + sag, CLOTH[0]).px(2 + i, G - 20 + sag, CLOTH[1]).px(2 + i, G - 19 + sag, i % 4 === 1 ? CLOTH[1] : CLOTH[2]);
        }
        l.rect(18, G - 20, 2, 2, "#C99A62");
      }, INK);
      return;
    }
    const awning = (top, rows, half, stripes) => g.stamp((l) => {
      for (let j = 0; j <= rows; j++) {
        const hw = Math.min(14, half + Math.round(j * 0.6));
        for (let i = -hw; i < hw; i++) {
          if (j === rows && (i + 42) % 3 === 2) continue;
          const white = stripes && Math.floor((i + 42) / 3) % 2 === 1;
          l.px(15 + i, top + j, white ? (j === 0 ? "#FFFFFF" : j >= rows - 1 ? CLOTH[1] : CLOTH[0]) : j === 0 ? RED[0] : j >= rows - 1 ? RED[2] : RED[1]);
        }
      }
    }, INK);
    if (n === 2) {
      // A counter of planks under a red awning, a crate of apples beside it.
      g.stamp((l) => { for (const x of [3, 25]) l.rect(x, G - 16, 2, 17, STICK[1]).rect(x, G - 16, 1, 17, STICK[0]); }, INK);
      g.stamp((l) => { wall(l, 5, G - 6, 20, 7, "timber"); l.rect(4, G - 8, 22, 2, TIMBER[1]).rect(4, G - 8, 22, 1, TIMBER[0]); }, INK);
      acorns(g, [[7, G - 11], [10, G - 11]]);
      g.stamp((l) => l.rect(14, G - 11, 3, 3, HONEY[1]).px(14, G - 11, HONEY[0]).rect(14, G - 12, 3, 1, CLOTH[0]), INK);
      awning(G - 22, 5, 11, false);
      crate(g, 19, G - 4, RED);
      return;
    }
    // The full stall: a striped awning, crates of apples and pears, a brass scale hanging at one end.
    g.stamp((l) => { for (const x of [2, 26]) l.rect(x, G - 18, 2, 19, TIMBER[1]).rect(x, G - 18, 1, 19, TIMBER[0]); }, INK);
    g.stamp((l) => { wall(l, 4, G - 7, 22, 8, "timber"); l.rect(3, G - 9, 24, 2, TIMBER[1]).rect(3, G - 9, 24, 1, TIMBER[0]); }, INK);
    g.stamp((l) => { l.rect(12, G - 7, 6, 5, CLOTH[1]).rect(12, G - 7, 6, 1, CLOTH[0]).px(12, G - 3, CLOTH[2]).px(17, G - 3, CLOTH[2]); acornBit(l, 14, G - 6); }, INK);
    g.stamp((l) => l.rect(5, G - 12, 3, 3, HONEY[1]).px(5, G - 12, HONEY[0]).rect(5, G - 13, 3, 1, CLOTH[0]).rect(9, G - 12, 3, 3, RED[1]).px(9, G - 12, RED[0]).rect(9, G - 13, 3, 1, CLOTH[0]), INK);
    acorns(g, [[13, G - 12]]);
    awning(G - 25, 7, 10, true);
    g.stamp((l) => chart(l, 16, G - 17, ["....d....", "gGGGGGGGd", ".d.....d.", "d.d...d.d", "GGG...GGd"], { g: GOLD[0], G: GOLD[1], d: GOLD[2] }), INK_GOLD);
    crate(g, 4, G - 4, RED);
    crate(g, 19, G - 4, PEAR);
  }
};

// ---------------------------------------------------------------- trophies
/** The plinth every trophy stands on: two steps, of stone or of wood. */
const plinth = (g, wood) => g.stamp((l) => {
  const P = wood ? TIMBER : STONE;
  l.rect(4, 15, 8, 2, P[1]).rect(4, 15, 8, 1, P[0]).px(11, 16, P[2]);
  l.rect(3, 17, 10, 2, P[1]).rect(3, 17, 10, 1, P[0]).rect(3, 18, 10, 1, P[2]).px(12, 17, P[2]);
}, wood ? INK : INK_STONE);

const BLUE = ["#8FB0E0", "#2F80E6", "#1F5FB8"];
const TROPHIES = [
  // A stack of three books, Pip's leaf for a bookmark.
  (g) => {
    [[3, 12, 10, RED], [4, 8, 8, BLUE], [3, 4, 9, ["#FFE08A", "#FFB400", "#C88A00"]]].forEach(([x, y, w, P]) => g.stamp((l) => l.rect(x, y, w, 3, P[1]).rect(x, y, w, 1, P[0]).rect(x, y + 2, w, 1, P[2]).rect(x + w - 2, y + 1, 2, 1, "#FFF6DF").px(x + 1, y + 1, GOLD[0]), INK));
    g.stamp((l) => l.rect(8, 2, 3, 1, "#2FA35E").px(10, 1, "#2FA35E").px(8, 2, "#B9F0B4"), INK_LEAF);
  },
  // A wizard's hat on a post, a star on it.
  (g) => {
    g.stamp((l) => l.rect(7, 10, 2, 5, STICK[1]).rect(7, 10, 1, 5, STICK[0]), INK);
    g.stamp((l) => chart(l, 2, 1, ["......pP....", ".....pPd....", "....pPPd....", "....pPPd....", "...pPPYPd...", "...pPYYYd...", "..pPPPYPPd..", "..GGgGGGGG..", "pPPPPPPPPPPd"], { p: PURPLE[0], P: PURPLE[1], d: PURPLE[2], G: GOLD[1], g: GOLD[0], Y: GOLD[1] }), INK);
    g.px(12, 3, GOLD[0]).px(3, 5, GOLD[0]);
  },
  // A brass telescope on a tripod, pointed at a star.
  (g) => {
    g.stamp((l) => l.line(8, 8, 4, 14, PLANK[1]).line(8, 8, 12, 14, PLANK[2]).line(8, 8, 8, 14, PLANK[0]), INK);
    g.stamp((l) => {
      for (let x = 2; x <= 13; x++) {
        const y = Math.round(10 - 0.6 * (x - 1)), fat = x >= 8, band = x === 7 || x === 12;
        if (fat) l.px(x, y - 1, band ? GOLD[2] : GOLD[0]);
        l.px(x, y, band ? "#A87400" : fat ? GOLD[1] : GOLD[0]).px(x, y + 1, band ? "#A87400" : fat ? GOLD[2] : GOLD[1]);
      }
      l.px(1, 10, PLANK[3]).rect(14, 2, 1, 3, "#A8DCF5");
    }, INK_GOLD);
    g.px(4, 2, "#FFFFFF").px(3, 2, GOLD[0]).px(5, 2, GOLD[0]).px(4, 1, GOLD[0]).px(4, 3, GOLD[0]);
  },
  // A magnifying glass, a boot print under it.
  (g) => {
    g.stamp((l) => l.line(11, 11, 14, 14, PLANK[1]).line(10, 11, 13, 14, PLANK[0]), INK);
    g.stamp((l) => {
      l.ell(7, 7, 5.5, 5.5, (nx, ny) => (nx + ny < -0.3 ? GOLD[0] : nx + ny > 0.7 ? GOLD[2] : GOLD[1]));
      l.ell(7, 7, 4, 4, (nx, ny) => (nx + ny < -0.8 ? "#FFFFFF" : "#CFEFFF"));
      chart(l, 6, 4, [".XX", "XXX", "XXX", "XX.", "...", "XX.", "XX."], { X: "#5E3A1F" });
    }, INK_GOLD);
  },
  // A heart of clipped box in a pot, roses in it.
  (g) => {
    g.stamp((l) => l.rect(7, 11, 2, 1, BARK[1]).px(7, 11, BARK[0]), INK);
    g.stamp((l) => l.rect(5, 12, 6, 1, "#F29A6A").rect(6, 13, 4, 2, "#C8683C").rect(9, 13, 1, 2, "#B0562A"), "#4A1E0A");
    g.stamp((l) => chart(l, 2, 1, ["..LL...MM..", ".LLMM.MMMD.", "LLMMMMMMMMD", "LMRrMMMRrMD", "LMMMMMMMMMD", ".MMRrMMMMD.", "..MMMMRrD..", "...MMMMD...", "....MMD....", ".....D....."], { L: LEAF[0], M: LEAF[1], D: LEAF[2], R: "#E0393E", r: "#FF9EB8" }), INK_LEAF);
  },
  // A crooked gravestone, a ghost behind it, a jack-o'-lantern at its foot.
  (g) => {
    g.stamp((l) => chart(l, 9, 2, [".WWW.", "WWWWW", "WEWEW", "WWWWs", "WWWWs", "W.W.s"], { W: "#F4F8FF", s: "#C4D0E4", E: INK_STONE }), INK_STONE);
    g.stamp((l) => {
      [[3, 4], [2, 6], [2, 6], [2, 6], [3, 6], [3, 6], [3, 6], [4, 6], [4, 6], [4, 6], [4, 6]].forEach(([x, w], j) => { for (let i = 0; i < w; i++) l.px(x + i, 4 + j, j === 0 || i === 0 ? STONE[0] : i === w - 1 ? STONE[2] : STONE[1]); });
      l.rect(4, 7, 3, 1, STONE[3]).rect(5, 6, 1, 4, STONE[3]).px(4, 13, "#5FB34C").px(5, 14, "#3F8F4A").px(4, 14, "#5FB34C");
    }, INK_STONE);
    g.stamp((l) => chart(l, 9, 9, ["..GG..", ".OOOO.", "OYOOYo", "OOOOOo", "OYYYYo", ".oooo."], { G: "#3F9A4E", O: "#F08A2A", o: "#C8601A", Y: "#FFE36B" }), INK);
  },
  // A broken column, a scroll tied with ribbon at its foot.
  (g) => {
    g.stamp((l) => {
      [5, 4, 4, 6, 5, 6].forEach((top, i) => { for (let y = top; y <= 11; y++) l.px(3 + i, y, i === 0 ? "#FFFFFF" : i === 5 ? STONE[3] : i % 2 ? STONE[2] : STONE[0]); });
      l.rect(2, 12, 8, 1, STONE[0]).rect(2, 13, 8, 2, STONE[1]).rect(9, 12, 1, 3, STONE[2]).rect(2, 14, 8, 1, STONE[2]);
    }, INK_STONE);
    g.stamp((l) => l.rect(10, 12, 5, 3, "#F0D9A8").rect(10, 12, 5, 1, "#FFF6DF").rect(10, 14, 5, 1, "#C99A62").rect(12, 12, 1, 3, RED[1]).px(10, 13, "#C99A62").px(14, 13, "#C99A62"), INK);
  },
  // A globe in a brass ring, on a brass foot.
  (g) => {
    g.stamp((l) => l.ring(8, 7.5, 5.8, "#D9A441").rect(7, 13, 2, 1, GOLD[2]).rect(5, 14, 6, 1, GOLD[1]).px(5, 14, GOLD[0]).px(10, 14, GOLD[2]), INK_GOLD);
    g.stamp((l) => l.ell(8, 7.5, 4.6, 4.6, (nx, ny) => {
      const land = Math.sin(nx * 3.3 + 4.2) * Math.cos(ny * 3.9) + Math.sin(nx * 6.9 + ny * 3 + 8.4) * 0.5 > 0.4;
      if (nx + ny < -0.9) return land ? "#9CE07A" : "#8FD0FF";
      return land ? (nx + ny > 0.6 ? "#2E8B3C" : "#4FBF5A") : nx + ny > 0.6 ? "#1F5FB8" : "#2F80E6";
    }), "#0A1E3A");
  },
  // A quill standing in an inkpot.
  (g) => {
    g.stamp((l) => chart(l, 4, 1, ["........WW", ".......WWs", "......WWWs", ".....WWqWs", "....WWqWs.", "....WqWWs.", "...WWqWs..", "...WqWs...", "..Wqs....."], { W: "#FFFFFF", s: "#B8C6DA", q: "#E8C48A" }), INK_STONE);
    g.stamp((l) => chart(l, 3, 10, ["..GGG.", ".kKKKd", "kKKKKd", "kKLLKd", "kKKKKd"], { G: GOLD[1], k: "#5A6BC4", K: "#2B3566", d: "#141A3A", L: "#F2E3C2" }), "#0C0F2A");
  },
  // A lighthouse, lit.
  (g) => {
    g.ell(8, 4, 4.5, 3, "#FFE36B38").rect(0, 4, 4, 1, "#FFE36B70").rect(12, 4, 4, 1, "#FFE36B70");
    g.stamp((l) => chart(l, 4, 1, ["...RR...", "..RRRr..", "..KYYK..", "..KYWK..", ".GGGGGG.", "..WWWs..", "..RRRr..", "..RRRr..", ".WWWWWs.", ".WWWWWs.", ".RRRRRr.", ".RRRRRr.", "WWWWWWWs", "WWWDDWWs"], { R: RED[1], r: RED[2], W: "#FFFFFF", s: STONE[1], K: "#3A3F4B", Y: "#FFE36B", G: "#3A3F4B", D: PLANK[2] }), INK);
  },
  // A kite on a stick, its tail of bows.
  (g) => {
    g.stamp((l) => l.rect(7, 10, 1, 5, STICK[1]), INK);
    g.px(8, 10, "#FFF6DF").px(10, 12, "#FFF6DF");
    g.stamp((l) => l.rect(9, 11, 2, 1, "#FF6FA8").rect(11, 13, 2, 1, GOLD[1]), INK);
    g.stamp((l) => chart(l, 4, 1, ["...r...", "..rRY..", ".rRRYY.", "rRRRYYY", "BBBBGGG", ".BBBGG.", ".BBBGG.", "..BBG..", "...B..."], { R: "#E0393E", r: "#FF8A7A", Y: "#FFD23F", B: "#2F80E6", G: "#1FBF6A" }), INK);
  }
];
const trophy = {
  w: 16, h: 20,
  draw(g, f, o) {
    const n = level(o, 10);
    plinth(g, n === 1 || n === 4 || n === 10);
    TROPHIES[n](g);
  }
};

// ---------------------------------------------------------------- season banners
/** A banner's cloth (light, body, shade) and the mark on it, for summer, autumn, winter and spring. */
const FLAGS = [
  { P: ["#8FE07A", "#3FA35E", "#1D7646"], key: { Y: GOLD[1], y: GOLD[0] }, mark: ["Y....Y", "..YY..", ".YyYY.", ".YYYY.", "..YY..", "Y....Y"] },
  { P: ["#F09A5A", "#CC5C2C", "#8E3A1E"], key: { Y: GOLD[1], y: GOLD[2] }, mark: ["...YY.", "..YYYY", ".YYyYY", "YYyYY.", "YyYY..", "y....."] },
  { P: ["#D4ECFF", "#8FC4EE", "#5E96C8"], key: { W: "#FFFFFF" }, mark: ["..WW..", "W.WW.W", ".WWWW.", ".WWWW.", "W.WW.W", "..WW.."] },
  { P: ["#FFC4DA", "#F08AB4", "#C8588A"], key: { W: "#FFFFFF", Y: GOLD[1] }, mark: ["WW..WW", "WWWWWW", ".WYYW.", ".WYYW.", "WWWWWW", "WW..WW"] }
];
const flagpole = {
  w: 12, h: 26,
  draw(g, f, o) {
    const F = FLAGS[level(o, 3)], P = F.P, G = 24;
    g.stamp((l) => l.rect(5, 3, 2, G - 2, STICK[1]).rect(5, 3, 1, G - 2, STICK[0]), INK);
    g.stamp((l) => l.rect(4, G - 1, 4, 2, STONE[1]).rect(4, G - 1, 4, 1, STONE[0]).px(7, G, STONE[2]), INK_STONE);
    g.stamp((l) => l.rect(1, 4, 10, 1, STICK[0]).px(10, 4, STICK[2]), INK);
    g.stamp((l) => {
      for (let j = 0; j < 13; j++) for (let i = 0; i < 8; i++) {
        if (j > 10 && Math.abs(i - 3.5) < j - 10) continue;
        l.px(2 + i, 5 + j, i === 0 || j === 0 ? P[0] : i === 7 ? P[2] : P[1]);
      }
      chart(l, 3, 8, F.mark, F.key);
    }, INK);
    g.stamp((l) => l.rect(5, 1, 2, 2, GOLD[1]).px(5, 1, GOLD[0]).px(6, 2, GOLD[2]), INK_GOLD);
  }
};

// ---------------------------------------------------------------- the Magpie King
const DEADWOOD = ["#A89880", "#7E6E5C", "#56493C"];
const FIRE = { y: "#FFE36B", Y: "#FFC53D", W: "#FFF3B0", o: "#FF8A2A", r: "#F0492F" };
/** A torch on a stick from `top` down to `bottom`, its flame and glow above it. */
const torch = (g, x, top, bottom) => {
  g.ell(x + 0.5, top - 2.5, 5.5, 5.5, "#FFB03A30");
  g.stamp((l) => l.rect(x, top, 1, bottom - top + 1, TWIG[1]).rect(x - 1, top, 3, 2, TWIG[3]), INK);
  g.stamp((l) => chart(l, x - 1, top - 5, [".y.", "yYo", "YWo", "oYr", ".r."], FIRE), "#7A2A0A");
};
const CROWN = ["....y...y", "y..yYy..Y", "Yy.YYY.yY", "YYYYYYYYd", "YRYYBYYRd", "dddddddDD"];
const CROWN_KEY = { y: GOLD[0], Y: GOLD[1], d: GOLD[2], D: "#A87400", R: "#E0393E", B: "#3EC1F0" };

const king = {
  w: 56, h: 44,
  draw(g) {
    const G = 42, cx = 28;
    // The dead tree: a pale trunk and two bare limbs reaching up past the nest, a stolen spoon and a key hung from them.
    g.stamp((l) => {
      for (let y = 22; y <= G; y++) for (let x = 23; x < 33; x++) l.px(x, y, x < 26 ? DEADWOOD[0] : x > 30 ? DEADWOOD[2] : (x * 5 + y * 3) % 7 === 0 ? DEADWOOD[2] : DEADWOOD[1]);
      for (let k = 0; k < 3; k++) l.line(23, 28 + k, 9, 23 + k, DEADWOOD[k]).line(32, 28 + k, 46, 22 + k, DEADWOOD[k]);
      for (let k = 0; k < 2; k++) l.line(8 + k, 24, 4 + k, 8, DEADWOOD[k]).line(46 + k, 23, 50 + k, 9, DEADWOOD[k + 1]);
      l.line(6, 14, 2, 10, DEADWOOD[1]).line(4, 8, 7, 3, DEADWOOD[0]).line(4, 8, 2, 4, DEADWOOD[1]);
      l.line(49, 14, 53, 11, DEADWOOD[1]).line(50, 9, 48, 4, DEADWOOD[1]).line(51, 9, 53, 5, DEADWOOD[2]);
    }, INK);
    g.px(13, 28, "#F0E0B0").px(43, 27, "#F0E0B0");
    g.stamp((l) => l.rect(13, 29, 1, 2, STONE[1]).rect(12, 31, 3, 2, STONE[0]).px(13, 33, STONE[1]).px(14, 32, STONE[2]), INK_STONE);
    g.stamp((l) => l.rect(42, 28, 3, 3, GOLD[1]).px(43, 29, INK_GOLD).px(42, 28, GOLD[0]).rect(43, 31, 1, 3, GOLD[1]).px(44, 32, GOLD[2]).px(44, 33, GOLD[2]), INK_GOLD);
    // The banner on a spoon, a spoon and a tail feather leaning out of the heap.
    g.stamp((l) => l.rect(39, 6, 1, 9, STONE[1]).ell(39.5, 3.5, 1.6, 2.4, (nx, ny) => (nx + ny < -0.3 ? "#FFFFFF" : STONE[0])), INK_STONE);
    g.stamp((l) => {
      for (let j = 0; j < 7; j++) for (let i = 0; i < 6; i++) if (!(j === 6 && i % 2)) l.px(40 + i, 7 + j, j === 0 ? PURPLE[0] : i === 5 ? PURPLE[2] : PURPLE[1]);
      l.px(41, 9, "#FFFFFF").px(43, 9, "#FFFFFF").rect(41, 10, 3, 1, "#FFFFFF");
    }, INK);
    g.stamp((l) => l.line(19, 13, 16, 7, STONE[1]).ell(15.5, 5, 1.6, 2.4, (nx, ny) => (nx + ny < -0.3 ? "#FFFFFF" : STONE[0])), INK_STONE);
    feather(g, 13, 14, -1);
    // The hoard, and the crown on top of it.
    g.stamp((l) => dome(l, cx, 13, 8, 5, (u, t, x, y, edge) => (edge ? GOLD[0] : (x * 3 + y * 5) % 4 === 0 ? GOLD[2] : (x + y * 2) % 5 === 0 ? GOLD[0] : GOLD[1])), INK_GOLD);
    loot(g, cx, 14, 2);
    g.stamp((l) => chart(l, cx - 4, 3, CROWN, CROWN_KEY), INK_GOLD);
    g.stamp((l) => bowl(l, cx, 14, 16, 9), INK);
    // The wall across the front, its gate barred, a torch either side of it.
    g.stamp((l) => {
      for (let j = 0; j < 7; j++) for (let i = 0; i < 51; i++) {
        const row = Math.floor(j / 3), off = row % 2 ? 3 : 0, seam = j % 3 === 2 || (i + off) % 6 === 5;
        l.px(3 + i, G - 6 + j, i === 0 ? ROOK[0] : i >= 49 ? ROOK[3] : seam ? ROOK[2] : j % 3 === 0 ? ROOK[0] : ROOK[1]);
      }
      for (let x = 3; x < 54; x += 6) l.rect(x, G - 9, 3, 3, ROOK[1]).rect(x, G - 9, 3, 1, ROOK[0]).px(x + 1, G - 10, TWIG[2]).px(x + 1, G - 11, TWIG[1]);
    }, INK_STONE);
    g.stamp((l) => dome(l, cx, G, 4, 6, "#1E1620"), INK);
    for (const x of [cx - 3, cx - 1, cx + 1]) g.rect(x, G - 4, 1, 5, ROOK[1]);
    g.px(cx - 1, G - 8, GOLD[1]).px(cx, G - 8, GOLD[0]);
    torch(g, 22, 28, G - 10);
    torch(g, 34, 28, G - 10);
  }
};

// ---------------------------------------------------------------- visitors and small things
const HOG = { S: "#7A5636", s: "#B08A5C", d: "#4E3220", F: "#F2DDB0", f: "#D9B884", N: "#2A1A10", E: "#10231A", C: "#FF9A8A" };
const HOG_BODY = [
  "......s..s..s....",
  "....sSSsSSsSSs...",
  "...sSSSSsSSSSSs..",
  "..FFSSsSSSSsSSSd.",
  ".FEFFSSSSsSSSSsSd",
  ".FEFFFSsSSSSsSSdd",
  "NFFFCFFSSSSsSSSSd",
  ".FFFFFFFSsSSSSSd.",
  "..ffFFFFFSSSSSdd.",
  "...ffFFFFFffddd.."
];
const hedgehog = {
  w: 22, h: 18, frames: 4,
  draw(g, f) {
    // The trader stands and breathes: the body dips, and the pack follows a frame behind.
    const k = ((Math.round(f) % 4) + 4) % 4, dip = [0, 0, 1, 1][k], lag = [1, 0, 0, 1][k], y0 = 5 + dip;
    g.stamp((l) => l.rect(8, 15, 2, 2, HOG.f).px(7, 16, HOG.f).rect(15, 15, 2, 2, HOG.f).px(14, 16, HOG.f), INK);
    g.stamp((l) => { chart(l, 4, y0, HOG_BODY, HOG); l.rect(2, y0 + 8, 4, 1, HOG.f); }, INK);
    g.line(14, y0 + 2, 11, y0 + 8, "#E8D4A0");
    g.stamp((l) => {
      const y = 1 + lag;
      l.rect(14, y, 5, 2, CLOTH[1]).rect(14, y, 5, 1, CLOTH[0]).px(15, y, "#5B7FD6").px(15, y + 1, "#5B7FD6").px(18, y, "#5B7FD6").px(18, y + 1, "#5B7FD6");
      l.rect(13, y + 2, 7, 4, RED[1]).rect(13, y + 2, 7, 1, RED[0]).rect(19, y + 3, 1, 3, RED[2]).rect(13, y + 5, 7, 1, RED[2]).rect(16, y + 2, 1, 4, "#5E3A1F");
      l.rect(20, y + 5, 1, 2, STONE[1]);
    }, INK);
    g.stamp((l) => l.rect(1, 4, 1, 13, STICK[1]).px(1, 4, STICK[0]).px(2, 4, STICK[1]), INK);
  }
};

const lamp = {
  w: 12, h: 14, frames: 4,
  draw(g, f) {
    // The glow breathes in and out, and the flame leans one way and the other.
    const k = ((Math.round(f) % 4) + 4) % 4, r = [5.4, 4.9, 5.6, 4.6][k];
    g.ell(6, 6.5, r, r + 0.4, "#FFD45A2C").ell(6, 6.5, r - 1.5, r - 1.2, "#FFE38A38").ell(6, 6.5, r - 3, r - 2.6, "#FFF3C250");
    g.stamp((l) => {
      l.rect(5, 3, 2, 1, GOLD[2]).rect(4, 4, 4, 1, GOLD[1]).px(4, 4, GOLD[0]).rect(4, 5, 4, 4, "#FFD86B").rect(4, 9, 4, 1, GOLD[2]);
      l.rect(5, k % 2 ? 5 : 6, 2, k % 2 ? 4 : 3, "#FFF6C2").px(5 + (k >> 1), 7, "#FFFFFF");
    }, INK_GOLD);
  }
};

const burst = {
  w: 24, h: 24, frames: 8,
  draw(g, f) {
    // Stars and leaves thrown out from the middle, slowing and fading as they go.
    const k = ((Math.round(f) % 8) + 8) % 8, t = k / 7, r = 1.6 + 8 * (1 - (1 - t) * (1 - t)), A = ["ff", "ff", "f0", "d8", "b0", "80", "50", "28"][k];
    if (k < 2) g.ell(12, 12, 3.2 - k, 3.2 - k, k ? "#FFFFFF90" : "#FFFFFF");
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.3 + t * 0.5, x = Math.floor(12 + Math.cos(a) * r), y = Math.floor(12 + Math.sin(a) * r + t * t * 1.2);
      if (i % 2 === 0) {
        if (k > 0 && k < 6) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.px(x + dx, y + dy, GOLD[1] + A);
        g.px(x, y, (k < 4 ? "#FFFFFF" : GOLD[0]) + A);
      } else {
        const turn = (k + i) % 4 < 2;
        g.px(x, y, LEAF[0] + A).px(x + (turn ? 1 : 0), y + (turn ? 0 : 1), LEAF[1] + A);
        if (k > 0 && k < 5) g.px(x + (turn ? 2 : 0), y + (turn ? 0 : 2), LEAF[2] + A);
      }
    }
    if (k > 0 && k < 6) for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 1 - t;
      g.px(Math.floor(12 + Math.cos(a) * r * 0.5), Math.floor(12 + Math.sin(a) * r * 0.5), "#FFF6C2" + ["", "e0", "b0", "80", "50", "30"][k]);
    }
  }
};

const SPROUT = { L: "#A2E477", B: "#6CC04A", D: "#3E8F3B", H: "#EFFFD8", E: "#10231A" };
const SPROUT_BODY = ["..LLBB..", ".LHLBBB.", "LLBBEBEB", "LBBBEBED", "BBBBBBDD", ".BBBBDD.", "..DDDD.."];
/** One of Pip's scouts running right, 8 wide from x0: the body, two leaves, the feet, and whatever
 `held` draws in its hand, given the body's top row. On frames 1 and 3 it is up on one foot. */
const sprout = (g, x0, k, held) => g.stamp((l) => {
  const up = k % 2, y0 = 5 - up, FOOT = "#2E6B33";
  if (!up) l.rect(x0 + (k ? 1 : 0), 12, 2, 1, FOOT).rect(x0 + (k ? 5 : 6), 12, 2, 1, FOOT);
  else if (k === 1) l.px(x0 + 3, 11, FOOT).rect(x0 + 3, 12, 2, 1, FOOT).px(x0 + 6, 11, FOOT);
  else l.px(x0 + 4, 11, FOOT).rect(x0 + 4, 12, 2, 1, FOOT).px(x0 + 1, 11, FOOT);
  chart(l, x0, y0, SPROUT_BODY, SPROUT);
  l.rect(x0 + 3, y0 - 1, 2, 1, "#285F36");
  l.rect(x0 - up, y0 - 3, 2, 1, "#2FA35E").rect(x0 + 1 - up, y0 - 2, 2, 1, "#2FA35E").px(x0 + 1 - up, y0 - 3, "#B9F0B4");
  l.rect(x0 + 6 - up, y0 - 3, 2, 1, "#2FA35E").rect(x0 + 5 - up, y0 - 2, 2, 1, "#1D7646");
  held(l, y0, up);
}, "#15281B");

const scout = {
  w: 14, h: 14, frames: 4,
  draw(g, f) {
    const k = ((Math.round(f) % 4) + 4) % 4;
    // The twig sword, held out ahead: up on the stride, levelled on the hop.
    sprout(g, 2, k, (l, y0, up) => {
      const hy = y0 + 3;
      if (up) l.px(10, hy, STICK[2]).px(11, hy - 1, STICK[1]).px(12, hy - 2, STICK[0]).px(12, hy - 3, "#F0D9A8");
      else l.px(10, hy, STICK[2]).px(10, hy - 1, STICK[1]).px(11, hy - 2, STICK[0]).px(11, hy - 3, STICK[0]).px(12, hy - 4, "#F0D9A8");
    });
  }
};

const slinger = {
  w: 14, h: 14, frames: 4,
  draw(g, f) {
    const k = ((Math.round(f) % 4) + 4) % 4;
    // The sling goes round overhead: out ahead, over, out behind, over again.
    sprout(g, 2, k, (l, y0) => {
      const CORD = "#FFF6DF", cord = [[[11, 4], [11, 3]], [[10, 3], [10, 2]], [[9, 4], [8, 3], [7, 2], [6, 2]], [[10, 3], [11, 2]]][k], x = [11, 9, 4, 11][k], y = k % 2 ? 1 : 2;
      l.px(10, y0 + 1, SPROUT.B).px(10, y0, SPROUT.L);
      cord.forEach(([cx, cy]) => l.px(cx, cy, CORD));
      l.px(x, y, STONE[0]).px(x + 1, y, STONE[1]);
      if (k % 2 === 0) l.px(x, y - 1, "#FFFFFF").px(x + 1, y - 1, STONE[0]).px(x + 1, y, STONE[2]);
      // A pouch of stones on its back, so it is told from a scout at a glance.
      l.rect(2, y0 + 3, 2, 3, "#9A6A3C").px(2, y0 + 3, "#C8935A").px(3, y0 + 5, "#6B4226").px(4, y0 + 2, "#6B4226").px(5, y0 + 1, "#6B4226");
    });
  }
};

const MOLE = { h: "#A27E60", H: "#BC9A78", M: "#72523E", d: "#4A3226", E: "#10231A", P: "#FF9E98" };
const MOLE_BODY = ["....hhhhhh....", "..hhHMMMMMMM..", ".hHMMMMMMMMME.", "hMMMMMMMMMMMMP", "MMMMMMMMMMMMMP", ".dMMMMMMMMMdd.", "..dddddddddd.."];
const mole = {
  w: 16, h: 12, frames: 4,
  draw(g, f) {
    // Low to the ground, the big front paws scissoring; the lamp on its head throws a beam ahead.
    const k = ((Math.round(f) % 4) + 4) % 4, PAW = "#FFC0B0", front = [11, 9, 8, 10][k], back = [1, 3, 5, 3][k];
    g.rect(13, 1, 3, 2, k % 2 ? "#FFE36B58" : "#FFE36B40").px(15, 0, "#FFE36B30").px(15, 3, "#FFE36B30");
    g.stamp((l) => {
      l.rect(front, 10, 3, 1, PAW).px(front + 1, 9, PAW).rect(back, 10, 2, 1, PAW);
      chart(l, 1, 3, MOLE_BODY, MOLE);
      l.rect(9, 3, 4, 1, "#3A3F4B");
    }, INK);
    g.stamp((l) => l.rect(10, 1, 2, 2, "#7E8698").px(10, 1, "#C4CCD8").rect(12, 1, 1, 2, "#FFE36B"), INK_STONE);
  }
};

// ---------------------------------------------------------------- the raid
const PERCHED = ["...KK......", "..KKKK.....", "GGKWKKK....", "..KKWWKK...", "..KWWWBbK..", "...WWWBBKK.", "...WW.KBTTT"];
const perch = {
  w: 16, h: 26,
  draw(g, f, o) {
    const G = 24;
    g.stamp((l) => l.ell(8, G, 3.4, 1.7, (nx, ny) => (ny < -0.1 ? ROOK[0] : nx > 0.3 ? ROOK[2] : ROOK[1])), INK_STONE);
    if (level(o, 1)) {
      // Broken: the stump, and the top of it lying where it fell. Nobody home.
      g.stamp((l) => l.rect(7, 16, 2, G - 16, STICK[1]).rect(7, 16, 1, G - 16, STICK[0]).px(7, 15, STICK[0]).px(7, 14, "#F0D9A8").px(8, 15, "#F0D9A8"), INK);
      g.stamp((l) => l.line(10, G, 14, G - 5, STICK[1]).line(11, G, 15, G - 5, STICK[2]).px(14, G - 6, "#F0D9A8"), INK);
      g.stamp((l) => l.rect(1, G, 5, 1, STICK[0]).px(1, G, "#F0D9A8"), INK);
      g.stamp((l) => l.line(2, G - 3, 4, G - 5, PIE.K).px(4, G - 5, PIE.W).px(3, G - 4, PIE.B), "#0B0B14");
      return;
    }
    // A post with a bar across the top, braced and roped, and the sentry on it, watching the way in.
    g.stamp((l) => l.rect(7, 10, 2, G - 10, STICK[1]).rect(7, 10, 1, G - 10, STICK[0]).line(4, 10, 6, 12, STICK[2]).line(11, 10, 9, 12, STICK[2]).rect(7, 16, 2, 1, "#F0E0B0"), INK);
    g.stamp((l) => l.rect(2, 9, 12, 1, STICK[0]).px(13, 9, STICK[2]), INK);
    g.stamp((l) => l.rect(13, 10, 1, 3, PURPLE[1]).px(13, 13, PURPLE[2]), INK);
    g.stamp((l) => chart(l, 2, 2, PERCHED, PIE).px(11, 9, PIE.K).px(12, 10, PIE.T), "#0B0B14");
  }
};

const SHINE = (u, t, x, y, edge) => (edge ? GOLD[0] : (x * 3 + y * 5) % 4 === 0 ? GOLD[2] : (x + y * 2) % 5 === 0 ? GOLD[0] : GOLD[1]);
const hoard = {
  w: 20, h: 14,
  draw(g, f, o) {
    const G = 12;
    if (level(o, 1)) {
      // Picked clean: the scuffed ground, the twigs it lay on, and what got dropped on the way out.
      g.ell(10, G - 1, 8, 2.6, "#3A2A1E2C");
      g.stamp((l) => l.line(1, G, 6, G - 1, TWIG[1]).line(13, G - 1, 18, G, TWIG[1]).line(8, G, 11, G - 2, TWIG[0]).px(6, G - 3, TWIG[2]), INK);
      g.stamp((l) => l.rect(14, G - 4, 2, 2, GOLD[1]).px(14, G - 4, GOLD[0]), INK_GOLD);
      g.stamp((l) => l.rect(4, G - 4, 2, 2, "#E0393E").px(4, G - 4, "#7A1418"), INK);
      return;
    }
    // Acorns, coins, a button and a spoon, heaped on a few twigs.
    g.stamp((l) => l.line(1, G, 6, G - 1, TWIG[1]).line(13, G - 1, 18, G, TWIG[1]).rect(3, G, 14, 1, TWIG[2]), INK);
    g.stamp((l) => l.line(13, G - 5, 16, 5, STONE[1]).ell(17, 3, 1.6, 2.4, (nx, ny) => (nx + ny < -0.3 ? "#FFFFFF" : STONE[0])), INK_STONE);
    g.stamp((l) => dome(l, 10, G, 7, 7, SHINE), INK_GOLD);
    g.stamp((l) => l.ell(11, G - 5, 2, 2, (nx, ny) => (nx + ny < -0.4 ? GOLD[0] : nx + ny > 0.6 ? GOLD[2] : GOLD[1])), INK_GOLD);
    acorns(g, [[5, G - 3], [8, G - 8], [14, G - 2]]);
    g.stamp((l) => l.ell(8, G - 1, 2, 2, (nx, ny) => (nx + ny < -0.4 ? "#FF8A7A" : "#E0393E")).px(7, G - 2, "#7A1418").px(8, G - 1, "#7A1418"), INK);
    g.stamp((l) => l.px(12, G - 1, "#BDEBFF").px(11, G, "#3EC1F0").px(12, G, "#1E88C8"), "#0E3A5A");
    g.px(6, G - 6, "#FFFFFF").px(14, G - 6, "#FFFFFF");
  }
};

const twigwall = {
  w: 10, h: 14,
  draw(g, f, o) {
    const G = 12;
    if (level(o, 1)) {
      // Knocked flat: a low heap of snapped twigs.
      g.stamp((l) => {
        for (let x = 0; x < 10; x++) for (let j = 0; j < [2, 3, 2, 1, 2, 3, 3, 2, 1, 2][x]; j++) l.px(x, G - j, j === 0 ? TWIG[2] : twig(x, G - j));
        l.line(1, G - 3, 3, G - 5, TWIG[0]).line(7, G - 3, 9, G - 4, TWIG[1]).px(5, G - 3, "#D8C8A8");
      }, INK);
      return;
    }
    // Woven twigs between bindings, thorns standing out of the top. The weave runs edge to edge, so a row of them joins up.
    g.stamp((l) => {
      for (let y = G - 8; y <= G; y++) for (let x = 0; x < 10; x++) l.px(x, y, x === 0 || x === 9 ? TWIG[3] : y === G - 8 ? TWIG[0] : ((x >> 1) + y) % 2 ? TWIG[1] : TWIG[2]);
      l.line(2, G - 9, 1, G - 11, TWIG[1]).line(5, G - 9, 6, G - 12, TWIG[1]).line(8, G - 9, 8, G - 10, TWIG[2]);
      l.px(1, G - 11, "#D8C8A8").px(6, G - 12, "#D8C8A8").px(3, G - 5, "#D8C8A8").px(7, G - 2, "#D8C8A8");
    }, INK);
  }
};

/** A tail feather lying on the ground, from (x, y) off to the right. */
const dropped = (g, x, y) => g.stamp((l) => l.line(x, y, x + 5, y - 1, PIE.K).px(x + 2, y - 1, PIE.B).px(x + 6, y - 1, PIE.W), "#0B0B14");

const nestdown = {
  w: 44, h: 34,
  draw(g) {
    // A nest pulled down: a low heap of twigs, the rim snapped, sticks thrown clear. Nothing left in it.
    const G = 32, cx = 22;
    g.stamp((l) => { l.ell(7, G - 1, 4, 2.2, (nx, ny) => (ny < -0.2 ? ROOK[0] : ROOK[1])); l.ell(37, G - 1, 3.4, 2, (nx, ny) => (ny < -0.2 ? ROOK[0] : ROOK[2])); }, INK_STONE);
    g.stamp((l) => l.line(14, G - 5, 10, G - 12, TWIG[1]).line(10, G - 12, 14, G - 14, TWIG[0]).line(21, G - 6, 23, G - 12, TWIG[1]).line(28, G - 5, 33, G - 11, TWIG[1]).line(31, G - 9, 34, G - 8, TWIG[2]).line(17, G - 6, 16, G - 10, TWIG[2]), INK);
    g.stamp((l) => dome(l, cx, G, 15, 7, (u, t, x, y, edge) => (edge ? TWIG[0] : u > 0.6 ? TWIG[2] : twig(x, y)), 2), INK);
    g.rect(19, G - 3, 6, 2, "#1E1620").rect(20, G - 4, 4, 1, "#1E1620").rect(12, G - 2, 3, 1, "#3A2A1E").rect(28, G - 3, 3, 1, "#3A2A1E");
    g.stamp((l) => l.line(1, G, 6, G - 2, TWIG[1]).line(37, G - 3, 42, G, TWIG[1]).line(2, G - 4, 5, G - 3, TWIG[2]).line(39, G - 5, 42, G - 6, TWIG[0]), INK);
    dropped(g, 25, G);
  }
};

const kingdown = {
  w: 56, h: 44,
  draw(g) {
    // The roost broken: the tree splintered, the nest down behind what is left of the wall, the crown in the rubble.
    const G = 42, cx = 28;
    g.stamp((l) => {
      [3, 1, 4, 2, 0, 3, 1, 2, 5, 3].forEach((cut, i) => { for (let y = 20 + cut; y <= G; y++) l.px(23 + i, y, i < 3 ? DEADWOOD[0] : i > 7 ? DEADWOOD[2] : ((23 + i) * 5 + y * 3) % 7 === 0 ? DEADWOOD[2] : DEADWOOD[1]); });
      for (let k = 0; k < 3; k++) l.line(23, 28 + k, 16, 25 + k, DEADWOOD[k]).line(32, 28 + k, 41, 24 + k, DEADWOOD[k]);
      l.line(41, 24, 44, 19, DEADWOOD[1]).line(42, 25, 45, 20, DEADWOOD[2]).px(16, 24, "#F0E4D0").px(27, 19, "#F0E4D0");
    }, INK);
    g.stamp((l) => l.line(8, 28, 3, 22, TWIG[1]).line(13, 28, 12, 21, TWIG[1]).line(18, 28, 20, 22, TWIG[0]).line(5, 30, 1, 28, TWIG[2]), INK);
    g.stamp((l) => bowl(l, 13, 28, 10, 7), INK);
    // What stands of the wall, and the breach where the gate was.
    const rows = (i) => (i < 16 ? 7 : i < 22 ? 22 - i : i < 41 ? 1 + (rnd(i * 7 + 3) > 0.55 ? 1 : 0) : i < 45 ? i - 39 : 7);
    g.stamp((l) => {
      for (let i = 0; i < 51; i++) for (let j = 7 - rows(i); j < 7; j++) {
        const row = Math.floor(j / 3), off = row % 2 ? 3 : 0, seam = j % 3 === 2 || (i + off) % 6 === 5;
        l.px(3 + i, G - 6 + j, i === 0 || j === 7 - rows(i) ? ROOK[0] : i >= 49 ? ROOK[3] : seam ? ROOK[2] : j % 3 === 0 ? ROOK[0] : ROOK[1]);
      }
      for (const x of [3, 9, 15, 51]) l.rect(x, G - 9, 3, 3, ROOK[1]).rect(x, G - 9, 3, 1, ROOK[0]);
      l.rect(24, G - 2, 3, 2, ROOK[1]).rect(24, G - 2, 3, 1, ROOK[0]).rect(43, G - 3, 2, 1, ROOK[0]);
    }, INK_STONE);
    g.stamp((l) => { for (let j = 0; j < 6; j++) for (let i = 0; i < 5; i++) if (!(j > 3 && (i + j) % 2)) l.px(9 + i, G - 9 + j, j === 0 ? PURPLE[0] : i === 4 ? PURPLE[2] : PURPLE[1]); }, INK);
    // A dead torch, a spoon, a feather; and the crown, tipped over where it rolled.
    g.stamp((l) => l.line(15, G, 20, G - 2, TWIG[1]).rect(20, G - 3, 2, 2, "#2A1E1A"), INK);
    g.px(22, G - 5, "#C4CCD870").px(23, G - 7, "#C4CCD850");
    g.stamp((l) => l.line(46, G - 1, 41, G - 1, STONE[1]).ell(47.5, G - 1, 2, 1.5, (nx, ny) => (ny < 0 ? "#FFFFFF" : STONE[0])), INK_STONE);
    g.stamp((l) => CROWN.forEach((row, j) => chart(l, 30 + (j >> 1), G - 5 + j, [row], CROWN_KEY)), INK_GOLD);
    g.px(29, G - 6, "#FFFFFF").px(42, G - 4, "#FFFFFF");
    dropped(g, 4, G);
  }
};

const pebble = {
  w: 4, h: 4,
  draw(g) {
    g.stamp((l) => l.rect(1, 1, 2, 2, STONE[1]).px(1, 1, STONE[0]).px(2, 2, STONE[2]), INK_STONE);
  }
};

/** The magpies' ground in each season: grass (top, bottom, fleck), bare earth (body, edge, grit), tufts (light, dark). */
const FIELDS = [
  { grass: ["#7CA456", "#8AB05E", "#70964C"], earth: ["#B49E70", "#9C8A5C", "#C8B48A"], tuft: ["#9CC470", "#648C44"] },
  { grass: ["#8A8C44", "#989A4C", "#7C7E3C"], earth: ["#B09464", "#987C50", "#C6AC7E"], tuft: ["#B6B262", "#70743A"] },
  { grass: ["#C6D0DC", "#D4DCE6", "#B8C4D2"], earth: ["#A6977D", "#8C7E66", "#BEB19B"], tuft: ["#B4A680", "#A8B6C8"] },
  { grass: ["#80B058", "#90BE62", "#74A24E"], earth: ["#B8A274", "#A08E60", "#CCB88E"], tuft: ["#B2DE82", "#6A9C48"] }
];
const battleground = {
  w: 240, h: 120,
  draw(g, f, o) {
    const v = level(o, 3), S = FIELDS[v];
    // Bare patches where the grass has been scratched away, ragged at the edge.
    const worn = [];
    for (let k = 0; k < 12; k++) worn.push([10 + rnd(k * 7 + 1) * 220, 6 + rnd(k * 11 + 4) * 108, 8 + rnd(k * 13 + 2) * 15, 3.5 + rnd(k * 17 + 6) * 6]);
    const bare = (x, y) => {
      let d = 9;
      for (const [cx, cy, rx, ry] of worn) { const u = (x - cx) / rx, w = (y - cy) / ry; d = Math.min(d, u * u + w * w); }
      return d + (rnd(x * 12.9 + y * 78.2) - 0.5) * 0.4;
    };
    for (let y = 0; y < 120; y++) {
      const green = mix(S.grass[0], S.grass[1], y / 119);
      for (let x = 0; x < 240; x++) {
        const d = bare(x, y), n = rnd(x * 7.7 + y * 31.3 + 2);
        g.px(x, y, d < 0.75 ? (n > 0.94 ? S.earth[2] : n < 0.08 ? S.earth[1] : S.earth[0]) : d < 1 ? ((x + y) % 2 ? S.earth[1] : green) : n > 0.975 ? S.grass[2] : green);
      }
    }
    // Scrub, quieter than the clearing's.
    for (let k = 0; k < 70; k++) {
      const x = Math.round(3 + rnd(k * 3 + 11) * 232), y = Math.round(3 + rnd(k * 5 + 7) * 114), c = k % 5 === 4 ? S.tuft[0] : S.tuft[1];
      if (bare(x, y) < 1.1) continue;
      g.px(x, y, c).px(x + 1, y - 1, c).px(x + 2, y, c);
    }
    // Dead branches, only at the very edges.
    for (let k = 0; k < 8; k++) {
      const side = k % 4, t = rnd(k * 19 + 5), len = 7 + rnd(k * 23 + 1) * 6;
      const x = side === 0 ? 1 : side === 1 ? 238 : 14 + t * 212, y = side === 2 ? 1 : side === 3 ? 118 : 10 + t * 100;
      const dx = side === 0 ? 1 : side === 1 ? -1 : rnd(k * 3 + 2) - 0.5, dy = side === 2 ? 0.6 : side === 3 ? -0.6 : rnd(k * 5 + 4) - 0.5;
      g.line(x, y + 1, x + dx * len, y + dy * len + 1, "#2A1A1050").line(x, y, x + dx * len, y + dy * len, TWIG[2]);
      g.line(x + dx * len * 0.5, y + dy * len * 0.5, x + dx * len * 0.5 + dy * 4 + dx * 2, y + dy * len * 0.5 - dx * 4 + dy * 2, TWIG[1]);
    }
    // Feathers and shiny litter, a pixel or three each.
    for (let k = 0; k < 9; k++) {
      const x = Math.round(8 + rnd(k * 41 + 3) * 224), y = Math.round(8 + rnd(k * 43 + 9) * 104), s = k % 2 ? 1 : -1;
      g.px(x, y, PIE.K).px(x + s, y - 1, PIE.K).px(x + 2 * s, y - 2, k % 3 ? PIE.W : PIE.B);
    }
    for (let k = 0; k < 11; k++) {
      const x = Math.round(6 + rnd(k * 47 + 13) * 228), y = Math.round(6 + rnd(k * 53 + 1) * 108);
      g.px(x, y, [GOLD[1], "#BDEBFF", "#FFFFFF", GOLD[0]][k % 4]).px(x, y + 1, "#2A1A1040");
    }
    for (let k = 0; k < 7; k++) {
      const x = Math.round(8 + rnd(k * 31 + 8) * 220), y = Math.round(8 + rnd(k * 37 + 2) * 104);
      g.stamp((l) => l.rect(x, y, 3, 2, v === 2 ? "#DDE4EC" : STONE[2]).px(x, y, v === 2 ? "#FFFFFF" : STONE[1]).px(x + 2, y + 1, STONE[3]), S.grass[2]);
    }
    // The season's own litter: turned leaves, drifts of old snow, a few brave flowers.
    for (let k = 0; v && k < (v === 1 ? 60 : 26); k++) {
      const x = Math.round(3 + rnd(k * 17 + 12) * 233), y = Math.round(3 + rnd(k * 21 + 3) * 113);
      if (v === 1) g.px(x, y, FALLEN[k % 4]);
      else if (v === 2) { if (bare(x, y) > 1.1) g.rect(x, y, 4, 1, "#B4C2D2").rect(x + 1, y - 1, 2, 1, "#EEF3F8"); }
      else if (bare(x, y) > 1.1) g.px(x, y, PETALS[k % 5]).px(x, y + 1, S.tuft[1]);
    }
  }
};

// ---------------------------------------------------------------- things for the grass
const SIGN = ["#FFF0C8", "#E8C48A", "#C99A62"];
/** A log seen end on, 5 x 5 round (cx, cy): bark, pale wood, the heart. */
const logEnd = (g, cx, cy) => g.stamp((l) => l.ell(cx, cy, 2.5, 2.5, (nx, ny) => { const d = nx * nx + ny * ny; return d > 0.6 ? (nx + ny > 0.3 ? BARK[2] : BARK[1]) : d < 0.1 ? "#C99A62" : nx + ny < -0.2 ? "#FFF0C8" : "#F0D9A8"; }), INK);
/** A red-capped mushroom standing on row `by`: 5 wide when big, 3 when small. */
const toadstool = (l, cx, by, big) => {
  if (big) l.rect(cx - 1, by - 1, 2, 2, "#F6EEDC").px(cx, by, "#D8CCB0").rect(cx - 2, by - 3, 5, 2, RED[1]).rect(cx - 1, by - 4, 3, 1, RED[0]).px(cx + 2, by - 2, RED[2]).px(cx - 1, by - 3, "#FFFFFF").px(cx + 1, by - 2, "#FFFFFF").px(cx, by - 4, "#FFFFFF");
  else l.px(cx, by, "#F6EEDC").rect(cx - 1, by - 1, 3, 1, RED[1]).px(cx, by - 2, RED[0]).px(cx - 1, by - 1, "#FFFFFF");
};
const DECOR = [
  // A flower bed: four bright flowers in a low wooden border.
  (g, G) => {
    g.stamp((l) => [[4, 7, "#FF6FA8", GOLD[1]], [8, 9, GOLD[1], "#E07A3A"], [12, 7, "#E0393E", GOLD[1]], [16, 10, "#FFFFFF", GOLD[1]]].forEach(([x, up, c, eye]) => {
      l.rect(x, G - up + 1, 1, up - 4, "#3F9A4E").px(x + (x % 8 ? 1 : -1), G - 5, LEAF[0]);
      l.rect(x - 1, G - up, 3, 1, c).rect(x, G - up - 1, 1, 3, c).px(x, G - up, eye);
    }), INK);
    g.stamp((l) => l.rect(3, G - 3, 14, 1, "#6B4A2E").rect(3, G - 2, 14, 3, TIMBER[1]).rect(3, G - 2, 14, 1, TIMBER[0]).rect(3, G, 14, 1, TIMBER[2]).rect(9, G - 2, 1, 3, TIMBER[3]).rect(1, G - 4, 2, 5, PLANK[1]).rect(1, G - 4, 1, 5, PLANK[0]).rect(17, G - 4, 2, 5, PLANK[1]).rect(18, G - 4, 1, 5, PLANK[2]), INK);
  },
  // A lantern post: a short post, the lantern lit on top of it.
  (g, G) => {
    g.ell(10, 5, 6.4, 5.4, "#FFD45A30").ell(10, 5, 4.4, 3.8, "#FFE38A38");
    g.stamp((l) => l.rect(9, 9, 2, G - 8, PLANK[1]).rect(9, 9, 1, G - 8, PLANK[0]).rect(7, G - 1, 6, 2, STONE[1]).rect(7, G - 1, 6, 1, STONE[0]).px(12, G, STONE[2]), INK);
    g.stamp((l) => l.rect(9, 1, 2, 1, GOLD[2]).rect(7, 2, 6, 1, GOLD[1]).px(7, 2, GOLD[0]).rect(8, 3, 4, 5, "#FFD86B").rect(9, 4, 2, 3, "#FFF6C2").px(9, 5, "#FFFFFF").rect(7, 8, 6, 1, GOLD[2]), INK_GOLD);
  },
  // A bench: two rails for a back, a plank to sit on.
  (g, G) => {
    g.stamp((l) => {
      l.rect(2, G - 11, 2, 12, TIMBER[2]).rect(16, G - 11, 2, 12, TIMBER[3]).rect(2, G - 11, 1, 12, TIMBER[1]);
      l.rect(4, G - 10, 12, 2, TIMBER[1]).rect(4, G - 10, 12, 1, TIMBER[0]).rect(4, G - 7, 12, 2, TIMBER[1]).rect(4, G - 7, 12, 1, TIMBER[0]);
      l.rect(1, G - 5, 18, 2, TIMBER[1]).rect(1, G - 5, 18, 1, TIMBER[0]).rect(4, G - 3, 2, 4, PLANK[1]).rect(14, G - 3, 2, 4, PLANK[1]);
    }, INK);
  },
  // A pond: stones round blue water, a lily pad on it, reeds behind.
  (g, G) => {
    const cy = G - 3, rim = (front) => {
      for (let i = 0; i < 12; i++) {
        const a = ((i + 0.5) / 12) * TAU, s = Math.sin(a);
        if ((s > 0) === front) g.stamp((l) => l.ell(10 + Math.cos(a) * 8.4, cy + s * 3.4, 1.6, 1.3, (nx, ny) => (ny < -0.1 ? STONE[0] : nx > 0.3 ? STONE[2] : STONE[1])), INK_STONE);
      }
    };
    g.stamp((l) => l.rect(14, G - 13, 1, 7, "#3F9A4E").rect(14, G - 14, 1, 3, "#7A4A26").rect(16, G - 10, 1, 4, "#3F9A4E").rect(16, G - 11, 1, 2, "#7A4A26").px(13, G - 9, LEAF[0]), INK_LEAF);
    rim(false);
    g.stamp((l) => l.ell(10, cy, 7.8, 3.1, (nx, ny) => (ny < -0.4 ? "#1F6FC8" : "#3E9BE0")), INK_STONE);
    g.rect(11, cy, 3, 1, "#BDEBFF").px(13, cy + 1, "#BDEBFF").rect(5, cy - 1, 3, 2, "#4FBF5A").px(7, cy - 1, "#3E9BE0").px(5, cy, "#2E8B3C").px(6, cy - 1, "#FFB3D1");
    rim(true);
  },
  // A scarecrow in a straw hat, smiling.
  (g, G) => {
    g.stamp((l) => l.rect(9, 13, 2, G - 12, STICK[1]).rect(9, 13, 1, G - 12, STICK[0]), INK);
    g.stamp((l) => chart(l, 1, 1, [
      "......hHHHHH......", "......HHHHHH......", "......BBBBBB......", "...hHHHHHHHHHHH...", "......FFFFFF......", "......FEFFEF......", "......FFMMFF......", "......sSsSSs......",
      "sSRRRRRRRRRRRRRRSs", "s.rRRRRRRRRRRRRd.s", ".....RRPPRRRd.....", ".....RRPPRRRd.....", ".....sSsSSsSs....."
    ], { H: "#E8C050", h: "#FFE08A", B: RED[1], F: "#F0D9A8", E: "#2A1A10", M: RED[1], S: "#F0C858", s: "#C89A30", R: BLUE[1], r: BLUE[0], d: BLUE[2], P: GOLD[1] }), INK);
  },
  // A ring of red-capped mushrooms: three small ones behind, three big ones in front.
  (g, G) => {
    g.stamp((l) => { toadstool(l, 10, G - 8, false); toadstool(l, 5, G - 6, false); toadstool(l, 15, G - 6, false); }, INK);
    g.stamp((l) => { toadstool(l, 3, G - 1, true); toadstool(l, 16, G - 1, true); toadstool(l, 10, G, true); }, INK);
    g.px(9, G - 4, "#78B656").px(10, G - 5, "#78B656").px(11, G - 4, "#78B656");
  },
  // A stone bird bath, a bird on the rim.
  (g, G) => {
    g.stamp((l) => {
      l.rect(6, G - 1, 8, 2, STONE[1]).rect(6, G - 1, 8, 1, STONE[0]).rect(13, G - 1, 1, 2, STONE[2]).rect(7, G - 2, 6, 1, STONE[1]);
      l.rect(9, G - 8, 2, 6, STONE[1]).rect(9, G - 8, 1, 6, STONE[0]).rect(8, G - 9, 4, 1, STONE[2]);
      l.rect(2, G - 12, 16, 1, STONE[0]).rect(3, G - 11, 14, 1, STONE[1]).rect(5, G - 10, 10, 1, STONE[2]).px(16, G - 11, STONE[2]);
    }, INK_STONE);
    g.rect(4, G - 12, 12, 1, "#3E9BE0").rect(6, G - 12, 3, 1, "#BDEBFF");
    g.stamp((l) => chart(l, 11, G - 15, [".BB.", "BEBY", "TWB."], { B: BLUE[1], E: "#10231A", Y: GOLD[1], W: "#FFE9B0", T: BLUE[2] }), "#0A1E3A");
  },
  // A pile of cut logs, three, two and one.
  (g, G) => {
    for (const cx of [3.5, 9.5, 15.5]) logEnd(g, cx, G - 2);
    for (const cx of [6.5, 12.5]) logEnd(g, cx, G - 7);
    logEnd(g, 9.5, G - 12);
  },
  // A signpost, one arm pointing each way.
  (g, G) => {
    g.stamp((l) => l.rect(9, 2, 2, G - 1, STICK[1]).rect(9, 2, 1, G - 1, STICK[0]).rect(9, 1, 2, 1, "#F0D9A8"), INK);
    g.stamp((l) => l.rect(3, 3, 10, 4, SIGN[1]).rect(3, 3, 10, 1, SIGN[0]).rect(3, 6, 10, 1, SIGN[2]).rect(2, 4, 1, 2, SIGN[1]).rect(5, 4, 3, 1, STICK[2]).rect(9, 4, 2, 1, STICK[2]).rect(5, 5, 4, 1, STICK[2]), INK);
    g.stamp((l) => l.rect(7, 9, 10, 4, SIGN[1]).rect(7, 9, 10, 1, SIGN[0]).rect(7, 12, 10, 1, SIGN[2]).rect(17, 10, 1, 2, SIGN[1]).rect(9, 10, 2, 1, STICK[2]).rect(12, 10, 3, 1, STICK[2]).rect(10, 11, 4, 1, STICK[2]), INK);
  },
  // A picnic: a checked blanket, a basket on it, an apple beside.
  (g, G) => {
    g.stamp((l) => { for (let j = 0; j < 5; j++) { const inset = 3 - ((j + 1) >> 1); for (let x = inset; x < 20 - inset; x++) l.px(x, G - 4 + j, ((x >> 1) + j) % 2 ? RED[1] : j === 0 ? "#FFFFFF" : "#FFF6DF"); } }, INK);
    g.stamp((l) => {
      for (let y = G - 7; y <= G - 2; y++) for (let x = 5; x < 13; x++) l.px(x, y, x === 12 ? "#A8702E" : (x + y) % 2 ? "#C89040" : "#E8C078");
      l.rect(4, G - 8, 10, 1, "#F6DC9A").rect(7, G - 9, 5, 1, "#FFFFFF").px(11, G - 9, "#DDE4EC");
      l.px(5, G - 9, "#C89040").px(5, G - 10, "#C89040").px(6, G - 11, "#C89040").rect(7, G - 12, 4, 1, "#E8C078").px(11, G - 11, "#A8702E").px(12, G - 10, "#A8702E").px(12, G - 9, "#A8702E");
    }, INK);
    g.stamp((l) => l.rect(15, G - 4, 2, 2, RED[1]).px(15, G - 4, RED[0]).px(16, G - 5, "#3F9A4E"), INK);
  },
  // A campfire: two logs crossed in a ring of stones, a small flame over them.
  (g, G) => {
    const stone = (x, y) => g.stamp((l) => l.ell(x, y, 1.9, 1.5, (nx, ny) => (ny < -0.1 ? STONE[0] : nx > 0.3 ? STONE[2] : STONE[1])), INK_STONE);
    g.ell(10, G - 8, 8.5, 6.5, "#FFB03A26").ell(10, G - 8, 5.5, 4.5, "#FFD45A30");
    for (const x of [5.5, 10, 14.5]) stone(x, G - 3);
    g.stamp((l) => {
      l.line(4, G - 2, 15, G - 5, BARK[0]).line(4, G - 1, 15, G - 4, BARK[1]).px(15, G - 5, "#F0D9A8");
      l.line(15, G - 2, 4, G - 5, BARK[1]).line(15, G - 1, 4, G - 4, BARK[2]).px(4, G - 5, "#F0D9A8");
    }, INK);
    g.stamp((l) => chart(l, 7, G - 12, ["...y...", "..yY...", "..YYo..", ".yYWYo.", ".YWWYo.", "oYWWYYr", "oYYWYor", ".ooYor."], FIRE), "#7A2A0A");
    for (const [x, y] of [[2.5, G - 1.5], [7, G - 0.5], [12.5, G - 0.5], [17.5, G - 1.5]]) stone(x, y);
    g.px(13, G - 13, "#FFE36BC0").px(6, G - 10, "#FF8A2AC0");
  },
  // A hammock: striped cloth slung between two short posts, a pillow at one end.
  (g, G) => {
    const sag = (x) => G - 8 + Math.round(3 * (1 - Math.pow((x - 9.5) / 7.5, 2)));
    g.stamp((l) => { for (const x of [1, 17]) l.rect(x, G - 10, 2, 11, TIMBER[1]).rect(x, G - 10, 1, 11, TIMBER[0]).rect(x, G - 10, 2, 1, "#F0D9A8"); }, INK);
    g.stamp((l) => {
      for (let x = 3; x <= 16; x++) {
        const y = sag(x), red = (x >> 1) % 2;
        l.px(x, y, red ? RED[0] : CLOTH[0]).px(x, y + 1, red ? RED[1] : CLOTH[0]).px(x, y + 2, red ? RED[2] : CLOTH[2]);
      }
      l.rect(4, sag(5) - 2, 3, 2, "#FFFFFF").px(6, sag(5) - 1, "#CFD8E4");
    }, INK);
  },
  // A birdhouse on a pole: a red roof, a round door, a peg to land on.
  (g, G) => {
    g.stamp((l) => l.rect(9, G - 6, 2, 7, STICK[1]).rect(9, G - 6, 1, 7, STICK[0]), INK);
    g.stamp((l) => {
      l.rect(6, G - 12, 8, 5, SIGN[1]).rect(6, G - 12, 1, 5, SIGN[0]).rect(13, G - 12, 1, 5, SIGN[2]).rect(5, G - 7, 10, 1, PLANK[1]).px(5, G - 7, PLANK[0]);
      l.rect(9, G - 11, 2, 2, "#3A2410").px(9, G - 11, "#1E1208").rect(9, G - 8, 2, 1, STICK[2]);
    }, INK);
    g.stamp((l) => l.rect(8, G - 15, 4, 1, TILE[0]).rect(6, G - 14, 8, 1, TILE[1]).px(6, G - 14, TILE[0]).rect(4, G - 13, 12, 1, TILE[2]).px(4, G - 13, TILE[1]), INK);
    bloom(g, 6, G - 1, "#FFB3D1");
    bloom(g, 13, G - 1, "#FFE066");
  },
  // A wishing well: a small ring of stone, two posts and a little tiled roof, the bucket on its rope.
  (g, G) => {
    g.stamp((l) => { for (const x of [5, 13]) l.rect(x, G - 12, 2, 7, TIMBER[1]).rect(x, G - 12, 1, 7, TIMBER[0]); }, INK);
    g.rect(10, G - 12, 1, 3, "#F0E0B0");
    g.stamp((l) => l.rect(9, G - 9, 3, 3, TIMBER[1]).rect(9, G - 9, 1, 3, TIMBER[0]).rect(11, G - 9, 1, 3, TIMBER[2]).rect(9, G - 8, 3, 1, "#7E8698"), INK);
    g.stamp((l) => { wall(l, 4, G - 4, 12, 5, "stone"); l.rect(3, G - 6, 14, 2, STONE[1]).rect(3, G - 6, 14, 1, STONE[0]).px(16, G - 5, STONE[2]); }, INK_STONE);
    g.stamp((l) => roof(l, 10, G - 15, 3, 3, 8, TILE), INK);
  },
  // A swing: two posts and a beam, a plank seat hanging on two ropes.
  (g, G) => {
    g.stamp((l) => {
      for (const x of [2, 16]) l.rect(x, G - 12, 2, 13, TIMBER[1]).rect(x, G - 12, 1, 13, TIMBER[0]);
      l.rect(1, G - 14, 18, 2, TIMBER[1]).rect(1, G - 14, 18, 1, TIMBER[0]).rect(18, G - 14, 1, 2, TIMBER[2]);
      l.px(4, G - 12, TIMBER[2]).px(5, G - 12, TIMBER[2]).px(4, G - 11, TIMBER[2]).px(15, G - 12, TIMBER[2]).px(14, G - 12, TIMBER[2]).px(15, G - 11, TIMBER[2]);
    }, INK);
    for (const x of [7, 12]) g.rect(x, G - 12, 1, 8, "#F0E0B0").px(x, G - 12, "#B8A070").px(x, G - 8, "#B8A070");
    g.stamp((l) => l.rect(6, G - 4, 8, 2, TIMBER[1]).rect(6, G - 4, 8, 1, TIMBER[0]).px(13, G - 3, TIMBER[2]), INK);
  },
  // A book nook: a stump with a small stack of books on it, a cushion beside it to sit on.
  (g, G) => {
    g.stamp((l) => l.ell(15, G - 1.5, 3.6, 2.1, (nx, ny) => (ny < -0.35 ? "#E3D2FF" : nx > 0.55 || ny > 0.45 ? "#8E6AD0" : "#B08CF0")).px(15, G - 2, GOLD[1]), INK);
    g.stamp((l) => {
      for (let y = G - 6; y <= G; y++) for (let x = 2; x <= 10; x++) l.px(x, y, x === 2 ? BARK[0] : x >= 9 ? BARK[2] : (x * 3 + y) % 5 === 0 ? BARK[2] : BARK[1]);
      l.px(1, G, BARK[1]).px(11, G, BARK[2]).rect(2, G - 8, 9, 2, "#F0D9A8").rect(3, G - 8, 7, 1, "#FFF0C8").rect(5, G - 7, 3, 1, "#C99A62");
    }, INK);
    g.stamp((l) => {
      const book = (x, y, w, P) => l.rect(x, y, w, 2, P[1]).rect(x, y, w, 1, P[0]).px(x, y + 1, P[2]).rect(x + w - 1, y, 1, 2, "#FFF6DF").px(x + w - 1, y + 1, "#D8CCB0");
      book(3, G - 10, 7, RED);
      book(4, G - 12, 6, BLUE);
      book(3, G - 14, 6, LEAF);
      l.px(5, G - 12, GOLD[1]).px(5, G - 10, GOLD[1]);
    }, INK);
  },
  // A flower arch: a hoop of leaves on two wooden feet, in bloom all the way over.
  (g, G) => {
    const cy = G - 7;
    g.stamp((l) => {
      for (let y = 1; y <= G; y++) for (let x = 1; x <= 18; x++) {
        const dx = x + 0.5 - 10, dy = Math.min(0, y + 0.5 - cy), out = (dx * dx) / 81 + (dy * dy) / 64, hole = (dx * dx) / 30.25 + (dy * dy) / 25;
        if (out > 1 || hole <= 1) continue;
        const r = rnd(x * 5.7 + y * 9.1 + 2);
        l.px(x, y, y >= G - 1 ? (dx < 0 ? (x === 1 ? TIMBER[0] : TIMBER[1]) : x === 18 ? TIMBER[3] : TIMBER[2]) : out > 0.72 && dx + dy < 0 ? LEAF[0] : r > 0.7 ? LEAF[2] : r < 0.25 ? LEAF[0] : LEAF[1]);
      }
    }, INK_LEAF);
    [[2, 12], [3, 8], [2, 5], [5, 3], [8, 2], [12, 1], [14, 3], [17, 5], [16, 8], [17, 11], [10, 3], [1, 9], [18, 13]].forEach(([x, y], i) => g.px(x, y, PETALS[i % 5]));
    g.px(8, 1, GOLD[1]).px(3, 12, "#FFFFFF").px(16, 4, "#FF6FA8").px(6, 2, "#FFFFFF");
  },
  // A tiny windmill: a white tower under a red cap, four sails set like an X.
  (g, G) => {
    g.stamp((l) => {
      for (let y = G - 9; y <= G; y++) {
        const hw = y > G - 4 ? 4 : 3;
        for (let x = 10 - hw; x < 10 + hw; x++) l.px(x, y, x === 10 - hw ? "#FFFFFF" : x >= 10 + hw - 2 ? CLOTH[2] : y === G - 3 ? CLOTH[1] : CLOTH[0]);
      }
      l.rect(9, G - 2, 2, 3, PLANK[1]).px(9, G - 2, PLANK[0]);
    }, INK);
    g.stamp((l) => l.rect(8, G - 12, 4, 1, TILE[0]).rect(7, G - 11, 6, 1, TILE[1]).px(7, G - 11, TILE[0]).rect(6, G - 10, 8, 1, TILE[2]).px(6, G - 10, TILE[1]), INK);
    g.stamp((l) => {
      const hx = 10, hy = G - 10;
      for (const [dx, dy] of [[1, -1], [1, 1], [-1, 1], [-1, -1]]) for (let i = 1; i <= 5; i++) {
        if (i === 1) l.px(hx + dx, hy + dy, TIMBER[2]);
        else l.px(hx + dx * i, hy + dy * i, "#FFFFFF").px(hx + dx * i, hy + dy * i + 1, CLOTH[1]);
      }
      l.px(hx, hy, GOLD[1]);
    }, INK);
  }
];
const decor = {
  w: 20, h: 18,
  draw(g, f, o) {
    DECOR[level(o, DECOR.length - 1)](g, 16);
  }
};

// ---------------------------------------------------------------- heroes out of books
/** Each hero: where its picture goes (x, and y for its top row), the picture, what is under it
 (a robe's `hem` as [from, to, colours], or two `legs`), and what it carries: `held` is drawn
 with it, `back` and `front` are glows laid behind and over it. */
const FACE = "#F6D2AC", EYE = "#2A1A10";
const HEROES = [
  { // Marian Inkwell, the Librarian
    x: 2, y: 4, hem: [1, 10, ["#A86AB8", "#7A3E8A", "#522A60"]], shoe: "#3A2410",
    key: { H: "#7A5A48", K: FACE, W: "#EAF6FF", e: EYE, g: GOLD[1], p: "#A86AB8", P: "#7A3E8A", d: "#522A60", T: "#2FA89A", D: "#1F7F71", c: "#FFF6DF" },
    rows: ["..HH............", "..HHHHHHH.......", "...HHHHHHH......", "...HHHKKKK......", "...HHKKWeK......", "...HgKKKKK......", "....gKKKK.......", "...pPPPPPP......", "..pPPPPTTTTT....", "..pPPPKKTgcT....", "..pPPPPTTTcT....", "..pPPPPTTTTD....", ".pPPPPPPPPd....."]
  },
  { // Barnaby Thistlewand, a young wizard
    x: 1, y: 5, hem: [3, 11, ["#5A6080", "#3A3F5A", "#262A40"]], shoe: "#3A2410",
    key: { H: "#6B4226", K: FACE, W: "#DDF2FF", e: EYE, G: "#2FA35E", y: GOLD[1], r: "#5A6080", R: "#3A3F5A", d: "#262A40" },
    rows: [".....HHHHH......", "....HHHHHHH.....", "....HHHKKKH.....", "....HKWeWK......", "....HKKKKK......", ".....GyGyG......", "....rRRRRRRK....", "....rRRRRRd.....", "....rRRyRRd.....", "....rRRRRRd.....", "...rRRRRRRd.....", "...rRRRRRRRd...."],
    held(l, k, dy) {
      const y = 10 + dy, w = k % 2;
      l.px(4, y, "#2FA35E").px(3, y + w, GOLD[1]).px(2, y + 1, "#2FA35E").px(1, y + 1 - w, GOLD[1]);
      l.px(13, y, "#8A5A34").px(14, y - 1, "#8A5A34").px(14, y - 2, "#B07A4A").px(15, y - 3, "#B07A4A");
    },
    front(g, k, dy) {
      const y = 6 + dy;
      if (k === 0) g.px(15, y, GOLD[1]).px(17, y, GOLD[1]).px(16, y - 1, GOLD[1]).px(16, y + 1, GOLD[1]);
      if (k === 2) g.px(15, y - 1, GOLD[0]).px(17, y - 1, GOLD[0]).px(15, y + 1, GOLD[0]).px(17, y + 1, GOLD[0]);
      g.px(16, y, k % 2 ? GOLD[1] : "#FFFFFF");
    }
  },
  { // Piers Jetsam, sea-born camper
    x: -1, y: 4, legs: [5, 8], leg: "#E8B88A", shoe: "#F4F4F4",
    key: { H: "#2A2430", K: "#E8B88A", e: EYE, y: "#FFE880", Y: "#FFD23F", o: "#E0A800", b: "#6FA0E8", B: "#3D6FC8", n: "#274E9A" },
    rows: ["......H..H......", ".....HHHHH......", "....HHHHHHH.....", "....HHHKKKH.....", "....HHKKeK......", "....HKKKKK......", ".....KKKK.......", "....yYYYYY......", "....yYYYYYKK....", "....yYYYYo......", "....yYYYYo......", "....bBBBBn......", "....bB..Bn......"],
    held(l, k, dy) {
      const y = 12 + dy;
      l.px(11, y, "#6B4226").rect(10, y - 1, 4, 1, "#B87A28").rect(11, y - 6, 1, 5, "#FFE9A8").rect(12, y - 6, 1, 5, "#E0A040").px(11, y - 7, "#FFF0C0");
    },
    front(g, k) {
      for (let i = 0; i < 12; i++) g.px(i, (i + k) % 4 ? 18 : 17, (i + k) % 4 === 1 ? "#FFFFFFC0" : "#5AB8FFB0");
      g.px(k % 2, 16, "#5AB8FF90").px(11 - (k % 2), 16, "#5AB8FF90").px(k % 2 ? 1 : 0, 15, "#FFFFFFA0").px(k % 2 ? 10 : 12, 15, "#FFFFFFA0");
    }
  },
  { // Vess Ashfall, mist thief
    x: 4, y: 5, legs: [5, 7], leg: "#3A3F50", shoe: "#22242E",
    key: { H: "#2E2A3A", K: "#F4D8C0", e: EYE, c: "#C4CAD8", C: "#8C93A6", d: "#5E6478", D: "#3A3F50" },
    rows: [".....HHHH.......", "....HHHHHH......", "....HHHKKK......", "....HHKKeK......", "....HKKKKK......", "....cCCKK.......", "...cCCCCCKKK....", "...cCCCCCd......", "...cCCCCd.......", "...cCDDDd.......", "....cDDDd.......", "....cDDDd......."],
    held(l, k, dy) {
      for (let i = 0; i < 3; i++) for (let t = 1; t <= 5; t++) l.px(7 - t, 12 + i * 2 + dy + Math.round(Math.sin((t + k * 1.6) * 1.1 + i * 2) * 1.2 * (t / 5)), (t + i) % 2 ? "#8C93A6" : "#C4CAD8");
      const y = [9, 6, 4, 7][k];
      if (k % 2) l.rect(15, y, 2, 1, GOLD[1]);
      else l.rect(15, y, 2, 2, GOLD[1]).px(15, y, GOLD[0]).px(16, y + 1, GOLD[2]);
    }
  },
  { // Kestrel Evergreen, archer
    x: 0, y: 5, legs: [5, 8], leg: "#7E6040", shoe: "#4E2E16",
    key: { H: "#B8562A", h: "#E08A4A", K: "#C8915F", e: EYE, j: "#56A86A", J: "#2F7A4A", o: "#1D5232", B: "#C89A30", T: GOLD[1], n: "#A8845A", N: "#7E6040", m: "#5A4428" },
    rows: [".....HHHHH......", "....HHHHHHH.....", "....HHHKKKK.....", "...HHHKKeK......", "...hHKKKKK......", "...Hh.KKK.......", "...hjJJJJJK.....", "...TjJJJJJ......", "...hjJJJJo......", "....jJBBJo......", "....nNNNNm......", "....nN..Nm......"],
    held(l, k, dy) {
      const y = 11 + dy, W = "#B07A4A";
      l.line(12, y - 3, 10, y, "#FFF6DF").line(10, y, 12, y + 3, "#FFF6DF");
      l.px(12, y - 4, W).px(13, y - 3, W).px(14, y - 2, W).px(14, y - 1, W).px(14, y + 1, W).px(14, y + 2, W).px(13, y + 3, W).px(12, y + 4, W);
      l.rect(11, y, 3, 1, "#E8C48A").px(10, y, "#C8915F").px(14, y, "#C8915F").px(15, y, STONE[0]);
    }
  },
  { // Inspector Sheldrake Holm, detective
    x: 0, y: 3, hem: [4, 10, ["#7E6040", "#7E6040", "#5E4628"]], shoe: "#3A2410",
    key: { C: "#B89060", c: "#DDBB86", H: "#5E4630", K: FACE, e: EYE, a: "#C8A878", t: "#A8845A", T: "#7E6040", x: "#5E4628" },
    rows: [".......xx.......", ".....CCCCCC.....", "....CccccCxC....", "...CCCCCCCCCC...", "..CC.HKKKK.CC...", ".....HKKeK......", ".....KKKKK......", "......KKK.......", "...attttttt.....", "..atttxtttxK....", "..attxttttx.....", "....TTTTTx......", "....TTTxTx......", "....TTTTTTx....."],
    held(l, k, dy) {
      const y = 7 + dy;
      l.px(12, y + 4, "#8A5A34").rect(13, y, 2, 1, GOLD[1]).rect(13, y + 3, 2, 1, GOLD[2]).rect(12, y + 1, 1, 2, GOLD[1]).rect(15, y + 1, 1, 2, GOLD[2]);
      l.rect(13, y + 1, 2, 2, "#CFEFFF").px(13, y + 1, "#FFFFFF");
    }
  },
  { // Old Grey Mumble, wandering wizard
    x: 1, y: 1, hem: [2, 11, ["#CFCFD6", "#A4A4AE", "#7A7A86"]], shoe: "#6B4226",
    key: { h: "#98A2B8", H: "#6E7890", d: "#4A5268", W: "#FFFFFF", w: "#D4DAE6", K: FACE, e: EYE, g: "#CFCFD6", G: "#A4A4AE", x: "#7A7A86" },
    rows: ["........hh......", ".......hHH......", "......hHHH......", "......hHHHd.....", ".....hHHHHd.....", "...hHHHHHHHHd...", ".....WKKKK......", ".....WKKeK......", ".....WWWWWK.....", "....gWWWWW......", "...gGWWWWWGK....", "...gGGWWwGx.....", "...gGGGwGGx.....", "...gGGGGGGx.....", "..gGGGGGGGx.....", "..gGGGGGGGGx...."],
    held(l) {
      l.rect(13, 4, 1, 15, STICK[1]).px(13, 3, STICK[0]).px(14, 3, STICK[0]).px(14, 4, STICK[2]);
    }
  },
  { // Captain Vega Starling, star captain
    x: 0, y: 5, legs: [5, 8], leg: "#1FA0A0", shoe: "#E8ECF4",
    key: { H: "#E8ECF4", a: GOLD[1], K: "#9A6A48", V: "#FFB03A", v: "#FFF3B0", t: "#5FD0C8", T: "#1FA0A0", d: "#147078", w: "#FFFFFF", y: GOLD[0], Y: GOLD[1] },
    rows: [".....HHHHH......", "....HHHHHHH.....", "....HHKKKK......", "....aKVvVV......", "....HKKKKK......", ".....KKKK.......", "....tTTTTT......", "....tTwTTTTK....", "....tTTTTd......", "....yYYYYy......", "....tTTTTd......", "....tT..Td......"],
    held(l, k, dy) {
      l.rect(12, 12 + dy, 2, 1, "#AEB4C2").px(12, 13 + dy, "#7E8698");
    },
    front(g, k, dy) {
      const y = 12 + dy;
      g.px(14, y, k % 2 ? "#FFFFFF" : "#7FF0FF").px(15, y, k % 2 ? "#7FF0FFC0" : "#7FF0FF60").px(14, y - 1, "#7FF0FF50").px(14, y + 1, "#7FF0FF50");
      if (k % 2) g.px(16, y, "#7FF0FF60");
    }
  },
  { // Lady Rosalind Thorne
    x: -1, y: 4, hem: [4, 11, ["#FFC0D4", "#E88AA8", "#B85A80"]], shoe: "#FFFFFF",
    key: { B: "#FFF6DF", b: "#E0CFA4", r: "#E0608A", H: "#8A5A34", K: FACE, e: EYE, p: "#FFC0D4", P: "#E88AA8", d: "#B85A80", w: "#FFFFFF" },
    rows: ["....wBBBB.......", "...wBBBrBBBB....", "...BBBBrBBBBBB..", "...bBBBrHKKKBb..", "....bBBrHKeK....", "....rr..KKKK....", "....r...KKK.....", "......pPPPPKK...", "......wwwww.....", "......pPPPd.....", ".....pPPPPd.....", ".....pPPPPPd....", "....pPPPPPPd...."],
    held(l, k, dy) {
      const y = 10 + dy;
      l.px(9, y + 2, "#8A5A34").px(12, y, "#FFFFFF").px(12, y + 1, "#E0608A").px(13, y, "#E0608A").px(13, y + 1, "#FFFFFF").px(14, y, "#FFFFFF").px(14, y + 1, "#E0608A").px(15, y, STONE[1]).px(16, y, GOLD[1]);
    }
  },
  { // Doctor Marrow, monster hunter
    x: 1, y: 4, hem: [2, 10, ["#6E6270", "#4A4050", "#2A2430"]], shoe: "#201C26",
    key: { H: "#3A3440", h: "#5E566A", d: "#201C26", s: "#B8BCC8", K: "#EAC8A4", e: EYE, R: "#A83A3A", c: "#6E6270", C: "#4A4050", x: "#2A2430", b: GOLD[1] },
    rows: ["......HHHH......", ".....hHHHHd.....", "..hHHHHHHHHHd...", ".....sKKKK......", ".....sKKeK......", ".....RRRRR......", "....cRRRRC......", "...cCCCCCCC.....", "...cCCCCCCCK....", "...cCCbCCx......", "...cCCCCCx......", "...cCCbCCCx.....", "..cCCCCCCCx....."],
    back(g, k, dy) {
      g.ell(13.5, 15 + dy, k % 2 ? 4.4 : 4.9, k % 2 ? 3.8 : 4.2, "#FFD45A30");
    },
    held(l, k, dy) {
      const y = 13 + dy;
      l.rect(12, y, 3, 1, GOLD[1]).rect(12, y + 1, 3, 2, "#FFD86B").px(13, y + 1, "#FFFFFF").px(13, y + 2, "#FFF6C2").rect(12, y + 3, 3, 1, GOLD[2]);
    }
  }
];

/** What a hero walks on: a robe's hem over two shoes, or two legs. On frames 1 and 3 the body has dipped onto them. */
const stride = (l, H, k) => {
  const up = k % 2, x = H.x;
  if (H.hem) {
    const [a, b, P] = H.hem, m = (a + b) >> 1;
    if (up) return void l.rect(x + m - 1, 18, 2, 1, H.shoe).rect(x + m + 2, 18, 2, 1, H.shoe);
    for (let i = a; i <= b; i++) l.px(x + i, 17, i === a ? P[0] : i === b ? P[2] : P[1]);
    l.rect(x + m - (k ? 1 : 2), 18, 2, 1, H.shoe).rect(x + m + (k ? 1 : 2), 18, 2, 1, H.shoe);
    return;
  }
  const [a, b] = H.legs;
  if (up) return void l.rect(x + a, 18, 2, 1, H.shoe).rect(x + b, 18, 2, 1, H.shoe);
  l.px(x + a + (k ? 1 : 0), 17, H.leg).px(x + b - (k ? 1 : 0), 17, H.leg);
  l.rect(x + a + (k ? 1 : -1), 18, 2, 1, H.shoe).rect(x + b - (k ? 1 : 0), 18, 2, 1, H.shoe);
};
const hero = {
  w: 18, h: 20, frames: 4,
  draw(g, f, o) {
    // A walk facing right: stride, dip, the other stride, dip.
    const k = ((Math.round(f) % 4) + 4) % 4, dy = k % 2, H = HEROES[level(o, 9)];
    if (H.back) H.back(g, k, dy);
    g.stamp((l) => {
      stride(l, H, k);
      chart(l, H.x, H.y + dy, H.rows, H.key);
      if (H.held) H.held(l, k, dy);
    }, INK);
    if (H.front) H.front(g, k, dy);
  }
};

// ---------------------------------------------------------------- the magpies' champions
const MAGPIE = { body: PIE.K, lit: "#3C3C52", dark: "#0E0E16", belly: PIE.W, bellyShade: PIE.w, wing: PIE.B, wingLit: PIE.b, beak: "#6A6A78", beakDark: "#4A4A58", eye: "#FFFFFF" };
const CROW = { body: "#2A2A3A", lit: "#50506E", dark: "#14141E", wing: "#34344A", wingLit: "#5C5C80", beak: "#44444F", beakDark: "#2E2E38", eye: "#FFD23F" };
const PALE = { body: "#D4D8E2", lit: "#F6F8FC", dark: "#98A0B2", wing: "#BEC4D2", wingLit: "#E8EBF2", beak: "#5A5E6C", beakDark: "#3E424E", eye: "#1F3A6E" };
/** A big bird standing, facing left. S gives its head and body as [cx, cy, rx, ry], a wing the
 same, its tail as a line from the rump, and how long its beak is. */
const fowl = (l, S, P) => {
  const [hx, hy, hrx, hry] = S.head, [bx, by, brx, bry] = S.body;
  if (S.tail) for (let k = 0; k < 3; k++) l.line(S.tail[0], S.tail[1] + k, S.tail[2], S.tail[3] + k, k === 0 ? P.lit : k === 1 ? P.body : P.dark);
  l.ell(bx, by, brx, bry, (nx, ny) => (P.belly && nx < -0.1 + ny * 0.35 && ny > -0.6 ? (ny > 0.65 ? P.bellyShade : P.belly) : nx + ny > 0.8 ? P.dark : ny < -0.6 && nx < 0.2 ? P.lit : P.body));
  if (S.wing) l.ell(S.wing[0], S.wing[1], S.wing[2], S.wing[3], (nx, ny) => (nx + ny < -0.55 ? P.wingLit : nx + ny > 0.65 ? P.dark : P.wing));
  l.ell(hx, hy, hrx, hry, (nx, ny) => (ny < -0.45 && nx < 0.4 ? P.lit : nx + ny > 0.85 ? P.dark : P.body));
  const fx = Math.round(hx - hrx), fy = Math.round(hy);
  for (let i = 0; i < S.beak; i++) {
    l.px(fx - 1 - i, fy, P.beak);
    if (i < S.beak - 1) l.px(fx - 1 - i, fy + 1, P.beakDark);
  }
  l.px(fx + 2, fy - 1, P.eye);
};
/** Two feet on the ground, toes to the left; the legs show only while the body is up. */
const talons = (g, xa, xb, dy, c) => g.stamp((l) => { for (const x of [xa, xb]) { if (!dy) l.px(x, 21, c); l.rect(x - 2, 22, 3, 1, c); } }, INK);

const CHAMPIONS = [
  // Scratch the Twig-Tyrant: a scruffy magpie under a bottle cap, a twig club over its shoulder.
  (g, k, dy) => {
    const lag = [1, 0, 0, 1][k], y = 4 + dy;
    talons(g, 11, 15, dy, "#C8935A");
    g.stamp((l) => {
      fowl(l, { head: [9.5, 8 + dy, 4.3, 3.7], body: [12.5, 15.5 + dy, 5.6, 5.4], wing: [14, 15.5 + dy, 3, 3.8], tail: [17, 16 + dy, 20, 19 + dy], beak: 3 }, MAGPIE);
      l.px(14, 6 + dy, PIE.K).px(15, 7 + dy, PIE.K).px(18, 12 + dy, PIE.K).px(19, 14 + dy, PIE.K).px(6, 13 + dy, PIE.W).px(6, 16 + dy, PIE.w).px(13, 21 + dy - 1, PIE.K);
      l.rect(7, y - 1, 6, 1, RED[0]).rect(6, y, 8, 1, RED[1]).px(8, y - 1, "#FFFFFF");
      for (let x = 5; x < 15; x++) l.px(x, y + 1, x % 2 ? STONE[0] : STONE[2]);
    }, "#0B0B14");
    g.stamp((l) => {
      const cy = 14 + lag;
      l.line(12, cy, 18, cy - 9, TWIG[0]).line(13, cy, 19, cy - 9, TWIG[2]);
      l.ell(18.5, cy - 10, 2.4, 2.6, (nx, ny) => (nx + ny < -0.4 ? TWIG[0] : nx + ny > 0.5 ? TWIG[2] : TWIG[1])).px(18, cy - 10, TWIG[3]).px(20, cy - 8, TWIG[3]);
    }, INK);
    g.rect(12, 14 + lag, 2, 2, PIE.K).px(11, 15 + lag, PIE.B);
  },
  // The Bramble Baron: a magpie in a cloak of thorns, a monocle on a chain.
  (g, k, dy) => {
    talons(g, 11, 15, dy, "#C8935A");
    g.stamp((l) => fowl(l, { head: [9.5, 7 + dy, 4, 3.5], body: [12.5, 15 + dy, 5.2, 5.6], tail: [17, 17 + dy, 19, 19 + dy], beak: 3 }, MAGPIE), "#0B0B14");
    g.stamp((l) => {
      for (let y = 10; y <= 20; y++) {
        const t = (y - 10) / 10, xl = Math.round(9 - t * 2), xr = Math.round(15 + t * 3);
        for (let x = xl; x <= xr; x++) l.px(x, y + dy, x === xl ? "#5E8A54" : x >= xr - 1 ? "#22361F" : (x + y * 2) % 4 === 0 ? "#6A4E34" : (x * 2 - y + 40) % 7 === 0 ? "#5E8A54" : "#35583A");
        if (y % 2 === 0) l.px(xr + 1, y + dy - 1, "#E4D6B4");
        if (y % 3 === 1) l.px(xl - 1, y + dy, "#E4D6B4");
      }
      l.rect(8, 10 + dy, 8, 1, "#6E9A60").px(9, 9 + dy, "#E4D6B4").px(12, 9 + dy, "#E4D6B4").px(15, 9 + dy, "#E4D6B4");
      l.px(11, 20 + dy - 1, "#E4D6B4").px(8, 21 + dy - 1, "#3C6440").px(14, 21 + dy - 1, "#243C28").px(18, 21 + dy - 1, "#243C28");
    }, "#101C12");
    g.px(12, 13 + dy, "#9A5AC8").px(13, 13 + dy, "#6A3498").px(15, 17 + dy, "#9A5AC8").px(16, 17 + dy, "#6A3498").px(10, 18 + dy, "#9A5AC8");
    g.stamp((l) => l.rect(7, 5 + dy, 3, 3, GOLD[1]).px(7, 5 + dy, GOLD[0]).px(9, 7 + dy, GOLD[2]).px(8, 6 + dy, k === 2 ? "#FFFFFF" : "#CFEFFF"), INK_GOLD);
    g.px(9, 9 + dy, GOLD[1]).px(10, 10 + dy, GOLD[2]);
  },
  // Tin-Eye the Collector: a magpie in a tin can, one great lens strapped over its eye.
  (g, k, dy) => {
    talons(g, 11, 15, dy, "#C8935A");
    g.stamp((l) => fowl(l, { head: [10, 7.5 + dy, 4, 3.5], body: [12.5, 15 + dy, 5, 5.6], wing: [17, 15 + dy, 2.2, 3.4], tail: [17, 17 + dy, 19, 19 + dy], beak: 3 }, MAGPIE), "#0B0B14");
    g.stamp((l) => {
      for (let j = 0; j < 10; j++) for (let x = 8; x <= 16; x++) {
        const rim = j === 0 || j === 9, label = j > 2 && j < 7;
        l.px(x, 11 + j + dy, label ? (x === 8 ? RED[0] : x >= 15 ? RED[2] : RED[1]) : x === 8 ? "#FFFFFF" : x >= 15 ? STONE[3] : rim ? STONE[0] : j === 2 || j === 7 ? STONE[2] : STONE[1]);
      }
      l.rect(11, 15 + dy, 3, 2, GOLD[1]).px(11, 15 + dy, GOLD[0]).px(9, 12 + dy, STONE[3]).px(14, 12 + dy, STONE[3]).px(9, 19 + dy, STONE[3]).px(14, 19 + dy, STONE[3]);
    }, INK_STONE);
    g.stamp((l) => l.rect(9, 3 + dy, 5, 1, STONE[1]).px(9, 3 + dy, STONE[0]).rect(11, 2 + dy, 2, 1, STONE[2]), INK_STONE);
    g.rect(11, 6 + dy, 3, 1, "#6B4226");
    g.stamp((l) => {
      l.ell(8, 7 + dy, 3, 3, (nx, ny) => (nx + ny < -0.3 ? GOLD[0] : nx + ny > 0.6 ? GOLD[2] : GOLD[1]));
      l.ell(8, 7 + dy, 1.9, 1.9, (nx, ny) => (nx + ny > 0.5 ? "#2FA8D8" : "#7FE0FF"));
      l.px(k % 2 ? 8 : 7, 6 + dy, "#FFFFFF").px(8, 7 + dy, "#10231A");
    }, INK_GOLD);
  },
  // The Crow Regent: a tall crow in a ragged coat, the chain of office across its chest.
  (g, k, dy) => {
    talons(g, 11, 15, dy, "#8A8A98");
    g.stamp((l) => fowl(l, { head: [10, 5.5 + dy, 3.6, 3.2], body: [12.5, 14 + dy, 4.4, 7], tail: [16, 15 + dy, 20, 18 + dy], beak: 4 }, CROW), "#07070C");
    g.stamp((l) => {
      for (let y = 9; y <= 20; y++) {
        const xr = Math.round(17 + (y - 9) * 0.2);
        for (let x = 11; x <= xr; x++) {
          if (y > 18 && (x + y) % 3 === 0) continue;
          l.px(x, y + dy - (y > 19 ? dy : 0), x === 11 ? GOLD[1] : x >= xr - 1 ? "#4E1424" : (x === 14 && y > 12) ? "#5E1A2C" : y === 9 ? "#A84058" : "#7A2438");
        }
      }
      l.rect(15, 8 + dy, 4, 2, GOLD[1]).rect(15, 8 + dy, 4, 1, GOLD[0]).px(16, 10 + dy, GOLD[2]).px(18, 10 + dy, GOLD[2]);
    }, "#1C060C");
    g.stamp((l) => l.line(9, 10 + dy, 11, 13 + dy, GOLD[1]).line(11, 13 + dy, 15, 10 + dy, GOLD[1]).rect(10, 13 + dy, 2, 2, GOLD[1]).px(10, 13 + dy, GOLD[0]).px(11, 14 + dy, RED[1]), INK_GOLD);
  },
  // Lord Roost: a pale raven, bolt upright in white and gold, rings on every claw.
  (g, k) => {
    const dy = k === 3 ? 1 : 0;
    g.stamp((l) => { for (const x of [10, 14]) l.rect(x - 2, 22, 3, 1, "#8A8A98").px(x - 1, 22, GOLD[1]); }, INK);
    g.stamp((l) => l.rect(14, 5 + dy, 2, 5, "#F6F4EC").rect(15, 5 + dy, 1, 5, "#D8D2C0").rect(14, 4 + dy, 2, 1, GOLD[1]), INK_GOLD);
    g.stamp((l) => { fowl(l, { head: [10.5, 5.5 + dy, 3.6, 3.3], body: [11.5, 12 + dy, 3.6, 4], beak: 4 }, PALE); l.px(13, 3 + dy, PALE.dark).px(14, 4 + dy, PALE.body); }, "#262A36");
    g.stamp((l) => {
      for (let y = 9 + dy; y <= 21; y++) {
        const t = (y - 9) / 12, xl = Math.round(8 - t), xr = Math.round(14 + t * 4);
        for (let x = xl; x <= xr; x++) l.px(x, y, y === 21 ? (x % 3 ? GOLD[1] : GOLD[2]) : x === 11 ? GOLD[1] : x === 12 ? GOLD[2] : x === xl ? "#FFFFFF" : x >= xr - 1 ? "#D8D2C0" : x === 15 && y > 13 ? "#E4DECE" : "#F6F4EC");
      }
      l.rect(7, 9 + dy, 9, 2, GOLD[1]).rect(7, 9 + dy, 9, 1, GOLD[0]).px(15, 10 + dy, GOLD[2]).px(11, 10 + dy, RED[1]);
    }, INK_GOLD);
    g.stamp((l) => l.rect(6, 13 + dy, 3, 3, PALE.body).rect(6, 13 + dy, 3, 1, PALE.lit).rect(6, 14 + dy, 3, 1, GOLD[1]).px(6, 16 + dy, PALE.dark).px(8, 16 + dy, GOLD[1]), INK_STONE);
    g.stamp((l) => l.rect(9, 2 + dy, 3, 1, GOLD[1]).px(9, 2 + dy, GOLD[0]).px(10, 1 + dy, "#3EC1F0"), INK_GOLD);
    if (k === 1) g.px(8, 1, "#FFFFFF");
  },
  // The Hoarder King: a huge raven hooded in the dark, a stolen crown on the hood, eyes like coals.
  (g, k, dy) => {
    const top = 6 + dy, hot = [0, 1, 2, 1][k];
    g.stamp((l) => { for (const x of [8, 15]) l.rect(x - 3, 22, 4, 1, "#6E6E7C").px(x - 3, 22, "#AEB4C2"); }, INK);
    g.stamp((l) => {
      for (let y = top; y <= 21; y++) {
        const t = (y - top) / (21 - top), round = y - top < 3 ? 3 - (y - top) : 0, xl = Math.round(7 - t * 6) + round, xr = Math.round(15 + t * 5) - round;
        for (let x = xl; x <= xr; x++) {
          if (y === 21 && x % 4 === 1) continue;
          l.px(x, y, x - xl < 2 ? "#4A3E66" : xr - x < 3 ? "#17121F" : (x * 3 + y) % 9 === 0 && y > top + 7 ? "#17121F" : "#2A2238");
        }
      }
    }, "#07060C");
    g.ell(8.5, top + 4.5, 3.6, 2.8, "#0C0A12");
    g.stamp((l) => l.rect(3, top + 4, 4, 1, "#8A8A98").rect(1, top + 5, 6, 1, "#6A6A78").rect(1, top + 6, 2, 1, "#4A4A58").rect(3, top + 6, 4, 1, "#3A3A46").px(1, top + 7, "#4A4A58").px(3, top + 4, "#B4B4C0"), "#07060C");
    g.ell(7.5, top + 3.5, 2.6 + hot * 0.5, 1.8 + hot * 0.4, "#FF8A2A38");
    g.px(6, top + 3, hot ? "#FFF3B0" : "#FFC53D").px(9, top + 3, hot ? "#FFF3B0" : "#FFC53D").px(7, top + 3, "#F0492F90").px(10, top + 3, "#F0492F90");
    g.stamp((l) => chart(l, 7, top - 5, CROWN, CROWN_KEY), INK_GOLD);
    g.stamp((l) => l.ell(11, top + 9, 2, 2, (nx, ny) => (nx + ny < -0.4 ? GOLD[0] : nx + ny > 0.6 ? GOLD[2] : GOLD[1])).px(11, top + 9, RED[1]), INK_GOLD);
    g.px(2, 20, "#4A3E66").px(4, 21, "#4A3E66").px(18, 20, "#17121F");
  }
];
const champion = {
  w: 22, h: 24, frames: 4,
  draw(g, f, o) {
    // A slow, heavy bob: up for two frames, down for two.
    const k = ((Math.round(f) % 4) + 4) % 4;
    CHAMPIONS[level(o, 5)](g, k, [0, 0, 1, 1][k]);
  }
};

const RAIDER = ["........KKK...", ".......KKWKK..", ".SSS...KKKKGG.", "SSSSSKKKKKK...", "SSsSSKBBWWW...", ".SsSKKBbWWW...", "TTKKKKKWWW....", "T...KKKWW....."];
const raider = {
  w: 16, h: 14, frames: 4,
  draw(g, f) {
    // A hop to the right: crouch, push off, in the air, land.
    const k = ((Math.round(f) % 4) + 4) % 4, up = [0, 1, 2, 1][k], y0 = 3 - up, FOOT = "#C8935A";
    g.stamp((l) => {
      if (k === 2) l.px(7, 9, FOOT).px(9, 9, FOOT).rect(7, 10, 2, 1, FOOT).rect(9, 10, 2, 1, FOOT);
      else {
        for (let y = y0 + 8; y < 12; y++) l.px(7, y, FOOT).px(9, y, FOOT);
        l.rect(7, 12, 2, 1, FOOT).rect(9, 12, 2, 1, FOOT);
      }
      chart(l, 1, y0, RAIDER, Object.assign({ S: "#D8B484", s: "#A8845A" }, PIE));
      l.px(5, y0 + 3, "#F0E0B0");
    }, "#0B0B14");
  }
};

// ---------------------------------------------------------------- the fence, a length at a time
/** Stone for a wall that must join up every 10 px: MAT.stone's courses, with a joint every 5. */
const course = (i, j) => (j % 3 === 2 || (i + (Math.floor(j / 3) % 2 ? 2 : 0)) % 5 === 4 ? STONE[2] : j % 3 === 0 ? STONE[0] : STONE[1]);
/** A pointed log `w` wide, its tip on row `top`, standing on row `by`. */
const log = (l, x, w, top, by) => {
  for (let i = 0; i < w; i++) l.rect(x + i, top + 1, 1, by - top, i === 0 ? STICK[0] : i === w - 1 ? STICK[3] : STICK[1]);
  l.rect(x + 1, top, w - 2, 1, STICK[0]);
};
const fencepiece = {
  w: 10, h: 14,
  draw(g, f, o) {
    // One length of `fence` at each level. The art runs edge to edge, with no outline at the sides, so a row joins up.
    const n = Math.max(1, level(o, 5)), G = 12;
    if (n === 1) {
      g.stamp((l) => {
        l.rect(0, G - 4, 10, 1, STICK[0]).rect(0, G - 2, 10, 1, STICK[1]);
        for (const [x, hgt] of [[2, 7], [7, 6]]) l.rect(x, G - hgt + 1, 1, hgt, STICK[1]).px(x, G - hgt + 1, STICK[0]);
      }, INK);
      return;
    }
    if (n === 2) {
      g.stamp((l) => { for (let i = 0; i < 10; i++) for (let j = 0; j < 7; j++) l.px(i, G - 6 + j, j === 0 ? MUD[0] : (Math.floor(i * 0.4) + j) % 2 ? MUD[1] : MUD[2]); }, INK);
      g.stamp((l) => l.rect(4, G - 9, 2, 10, STICK[1]).rect(4, G - 9, 1, 10, STICK[0]).rect(4, G - 9, 2, 1, "#F0D9A8"), INK);
      return;
    }
    if (n === 3) {
      g.stamp((l) => {
        log(l, 0, 3, G - 10, G);
        log(l, 3, 4, G - 11, G);
        log(l, 7, 3, G - 10, G);
        for (let x = 0; x < 10; x++) l.px(x, G - 7, x % 3 === 2 ? "#B8A070" : "#F0E0B0");
      }, INK);
      return;
    }
    if (n === 4) {
      g.stamp((l) => {
        log(l, 0, 3, G - 11, G - 5);
        log(l, 3, 4, G - 10, G - 5);
        log(l, 7, 3, G - 11, G - 5);
        l.rect(0, G - 8, 10, 1, "#7E8698");
        for (let j = 0; j < 5; j++) for (let i = 0; i < 10; i++) l.px(i, G - 4 + j, course(i, j));
      }, INK);
      return;
    }
    g.stamp((l) => {
      for (let j = 0; j < 8; j++) for (let i = 0; i < 10; i++) l.px(i, G - 7 + j, course(i, j));
      for (const x of [1, 6]) l.rect(x, G - 10, 3, 3, STONE[1]).rect(x, G - 10, 3, 1, STONE[0]).rect(x + 2, G - 9, 1, 2, STONE[2]).rect(x, G - 11, 3, 1, GOLD[1]).px(x, G - 11, GOLD[0]).px(x + 2, G - 11, GOLD[2]);
    }, INK_STONE);
  }
};

const reach = {
  w: 40, h: 40,
  draw(g, f, o) {
    // A dashed circle one pixel thick, 40 across: 24 dashes, each a little longer than its gap.
    const c = level(o, 1) ? "#F0492F" : "#FFF2A8", R = 19.5, on = (dx, dy) => ((Math.atan2(dy, dx) / TAU + 1) * 24) % 1 < 0.6;
    for (let i = 0; i < 40; i++) {
      const d = i - 19.5;
      if (Math.abs(d) > R * Math.SQRT1_2) continue;
      const s = Math.sqrt(R * R - d * d), q = Math.min(19, Math.round(s - 0.5));
      for (const way of [-1, 1]) {
        const p = way > 0 ? 20 + q : 19 - q;
        if (on(d, way * s)) g.px(i, p, c);
        if (on(way * s, d)) g.px(p, i, c);
      }
    }
  }
};

// ---------------------------------------------------------------- the camp's guardians
/** Each guardian has three looks, one for each rank, and six frames. A look is a picture 16 wide
 whose last row stands on row 20. Frame 1 is a breath out: rows 0 to `dip` sink a pixel onto the
 row under them, and `alt` redraws whole rows of that frame (a hem, a tail). Frames 2 to 5 are four
 steps to the right: the rows from `legs` down give way to that frame's `steps` (the guardian's, or
 the look's own), keeping what the look has left of column `cut` there (the tail of a cloak). The
 feet are apart on 2 and 4, which are a row shorter, so the body is a pixel lower then; they are
 together on 3 and 5, one foot off the ground. What was kept swings a pixel in on 4 and 5, and
 `swing` redraws whole rows on 2 and 4 (a plume, long hair). A look with `beat` does not walk:
 frames 2 to 5 redraw those rows of it instead (a wing). `held` is drawn with the picture, given
 whether it is the breath out and the picture's top row; `front` is laid over it, unoutlined, given
 the frame. Nobody has a weapon in the hand: the screen draws that. */
const STEEL = ["#E3E8EF", "#AEB4C2", "#7E8698"];
/** A sword at the hip: its pommel at (x, y), where the hand rests. */
const hipSword = (l, x, y, pommel, sheath, lit) => l.px(x, y, pommel).px(x, y + 1, "#4E2E16").rect(x - 1, y + 2, 3, 1, STEEL[1]).px(x - 1, y + 2, STEEL[0]).px(x + 1, y + 2, STEEL[2])
  .rect(x, y + 3, 1, 2, sheath).rect(x + 1, y + 5, 1, 3, sheath).px(x, y + 3, lit).px(x + 1, y + 8, STEEL[1]);
/** A bow slung on the back: the wood down column x, its two tips a column nearer the body. */
const backBow = (l, x, top, bottom) => { for (let y = top; y <= bottom; y++) l.px(y === top || y === bottom ? x + 1 : x, y, y * 2 < top + bottom ? "#D8A468" : "#B07A4A"); };
/** The curl of smoke off the dragon's nose; on the odd frames it drifts and, once she is old enough, she manages a very small flame. */
const dragonSmoke = (flame) => (g, n, y) => {
  const S = "#F4F7FB", s = "#C4CCD8";
  if (n % 2 === 0) g.px(14, y + 2, s).px(14, y + 1, S).px(13, y, S).px(14, y - 1, s);
  else {
    g.px(13, y + 1, s).px(13, y, S).px(14, y - 1, S).px(14, y - 2, s);
    if (flame) g.px(14, y + 4, FIRE.Y).px(15, y + 4, FIRE.o).px(14, y + 5, FIRE.o).px(15, y + 3, FIRE.r);
  }
};

const HALVAR = { h: "#A3B394", H: "#748A6C", D: "#506350", x: "#3A4A3C", b: "#4E3220", K: FACE, s: "#C7A081", e: EYE, g: GOLD[1], t: "#B08050", T: "#8A5E38", B: "#4E2E16", l: "#7E6C54", L: "#5E4E3C", o: "#5E4028", O: "#3A2410", c: STEEL[0], a: STEEL[1], q: "#FFFFFF", Q: RED[1], V: "#8A4A2A", f: "#FFFFFF", F: "#E0393E" };
const HALVAR_CLOAKED = [
  "......hHHH......", ".....hHHHHHD....", "....hHHHHHHHD...", "....hHHbKKKKD...", "....hHbKKKeK....", "...qhHbKKKKKK...", "..qQhHHsKKss....",
  "..VVhHHHsss.....", "...hHHHBtTTT....", "..hHHDHtTTTTT...", "..hHHHDtTTTTK...", "..hHHHDtTTTTT...", "..hDHHDBBBgBB...", "..hHHHDlLLLLL...",
  "..hHHDxlL..lL...", ".hHHHDxlL..lL...", ".hHDHDxlL..lL...", ".hDHDx.lL..lL...", "..D.x..oO..oO...", ".......oOO.oOO.."
];
const HALVAR_HEM = { 17: ".hHDDx.lL..lL...", 18: ".hD.x..oO..oO..." };
const CORWIN = { b: "#4A4458", B: "#2A2633", K: FACE, e: EYE, w: "#F2F8FF", f: "#8C8892", F: "#5E5A66", c: "#565B72", C: "#34384A", d: "#23252F", g: STEEL[1], O: "#1E1E26", p: "#4A4E62", P: "#34384A" };
const CORWIN_SWORD = (l, k, y) => hipSword(l, 13, y + 10 + k, STEEL[1], "#2A2633", "#4A4458");
/** Under the long cloak only the boots show, and the hem that swings over them. */
const CORWIN_CLOAKED = [
  [".cCdCCdCiIddd...", "..OOO......OOO.."],
  [".cCCCcCCiICd....", "..cCdCCdiIdd....", "......OOO......."],
  [".cCCdCdCiIddd...", "...OO......OOO.."],
  [".cCCCcCCiICd....", ".cCdCCdCiIdd....", ".......OOO......"]
];
const MOSSY = { l: LEAF[0], L: LEAF[1], d: LEAF[2], p: "#FFB3D1", b: BARK[0], B: BARK[1], D: BARK[2], e: "#10231A", n: "#C99A62", m: MOSS[0], M: MOSS[1], N: MOSS[2], t: STICK[1], T: STICK[0], u: "#9FE8FF", U: "#F2FDFF" };
const BERIT = { y: "#FFE9A0", Y: "#E8C050", d: "#B8922E", K: FACE, e: EYE, b: BLUE[0], B: BLUE[1], n: BLUE[2], w: "#FFF6DF" };
const BERIT_LEGS = ["....uU..uU......", "....uU..uU......", "....uU..uU......", "....vV..vV......", "....vVW.vVW....."];
const BERIT_SWORD = (l, k, y) => hipSword(l, 12, y + 10 + k, GOLD[1], "#8A4A2A", "#B06A3A");
const EMBER = { r: "#FF9A5A", R: "#EC5A2E", D: "#B63C20", y: "#FFE9A0", Y: "#F2C458", h: "#FFF6DF", w: "#FFE38A", W: "#FFC04A", i: "#FFFFFF", e: EYE, n: "#7A2A0A", c: "#FFF6DF" };
const PIM = { c: "#C88A4A", C: "#8E5A2C", d: "#5E3A1F", K: FACE, e: EYE, f: "#D9A884", w: "#FFF6DF", W: "#E0D4B0", g: LEAF[0], G: LEAF[1], x: LEAF[2], y: GOLD[1], n: "#A8845A", N: "#7E6040", m: "#5A4428", s: THATCH[0], S: THATCH[1], z: THATCH[2], b: "#6B4226", A: "#FFF6DF", a: "#E0D4B0", p: "#FF8FB0", P: "#FFE066", h: STEEL[0], H: RED[1] };
const PIM_FACE = [".CCCCKKKK.......", ".CCCKKKeK.......", ".dCKKKKKKK......", "..dKKKKKK......."];
const PIM_LEGS = ["..nNN.NNm.......", "..KK...KK.......", "..KKf..KKf......"];
const ILSA = { h: "#FFF8DC", H: "#EADFA8", a: "#C8B878", E: "#F0B090", K: "#F8DCC0", e: EYE, g: "#8FD86A", G: "#4FA650", x: "#2F7A44", B: "#6B4226", q: GOLD[1], l: "#8A7A5A", L: "#62543E", o: "#8A5A34", O: "#5E3A1F", j: "#B08050", J: "#8A5E38", f: "#FFFFFF", F: "#C4CCD8" };
const ILSA_SKIRT = ["...Ha.gGGGx.....", "...h..gGGGGx....", "......gGxgGx....", "......lL.lL.....", "......lL.lL.....", "......oO.oO.....", "......oO.oO.....", "......oO.oOO...."];
const ILSA_HAIR = { 11: "..hHa.gGGGx.....", 12: "..h...gGGGGx...." };
const ILSA_BOW = (l, k, y) => backBow(l, 1, y + 4, y + 12);

const GUARDIANS = [
  { // Halvar Longstride, a ranger out of the north
    steps: [
      ["........LLlL....", ".......LL..lL...", ".......LL...lL..", "......OO....oO..", "......OOO...oOO."],
      [".........lLL....", ".........lLL....", ".........lLL....", ".........lL.....", ".......OOoO.....", ".........oOO...."],
      ["........lLLL....", ".......lL..LL...", ".......lL...LL..", "......oO....OO..", "......oOO...OOO."],
      [".........LlL....", ".........LlL....", ".........LLlL...", ".........LLlL...", ".........OOoO...", ".........OOO...."]
    ],
    ranks: [
      { // bare-headed in a plain green tunic, his bow on his back
        key: HALVAR, dip: 10, legs: 14, cut: 6,
        rows: [
          "................", "......bbbb......", ".....bbbbbbb....", ".....bbbKKKK....", ".....bbKKKeK....", ".....bbKKKKKK...", "......bsKKss....",
          "........sss.....", ".......hHHHH....", "......hHHHHHH...", "......hHHHHHK...", "......KHHHHHD...", ".......BBBgBB...", ".......lLLLLL...",
          ".......lL..lL...", ".......lL..lL...", ".......lL..lL...", ".......lL..lL...", ".......oO..oO...", ".......oOO.oOO.."
        ],
        held(l, k, y) { backBow(l, 4, y + 6 + k, y + 13); l.rect(5, y + 7 + k, 1, 6 - k, "#FFF6DF"); }
      },
      { // a hooded travelling cloak, pale with wear, and a quiver
        key: { ...HALVAR, h: "#B6C2A6", H: "#8A9C80", D: "#627260", x: "#465446", Q: "#C4CCD8" }, dip: 10, alt: HALVAR_HEM, legs: 14, cut: 6, rows: HALVAR_CLOAKED
      },
      { // the cloak of the north, a silver clasp, a bracer, a feather in the hood, his long sword at his hip
        key: HALVAR, dip: 10, alt: HALVAR_HEM, legs: 14, cut: 6,
        rows: HALVAR_CLOAKED.map((row, j) => ({ 0: "....f.hHHH......", 1: ".....FHHHHHD....", 8: "...hHHHctTTT....", 10: "..hHHHDtTTTaK..." }[j] || row)),
        held(l, k, y) { hipSword(l, 13, y + 10 + k, GOLD[1], "#8A4A2A", "#B06A3A"); }
      }
    ]
  },
  { // Corwin Blackcloak, sworn to a far colder wall
    steps: CORWIN_CLOAKED,
    ranks: [
      { // a plain dark tunic, his sword at his hip
        key: CORWIN, dip: 12, legs: 15, held: CORWIN_SWORD,
        rows: [
          "......bBBBB.....", ".....bBBBBBB....", ".....BBBKKKK....", ".....BBKKKeK....", ".....BBKKKKKK...", "......bKKKKK....", "........KK......",
          "......cCCCCC....", ".....cCCCCCCd...", ".....cCCCCCCd...", ".....cCCCCCCK...", ".....KCCCCCd....", "......FFFgFF....", "......cCCCCd....",
          "......cCCCCd....", ".....pP..pP.....", ".....pP..pP.....", ".....pP..pP.....", ".....pP..pP.....", ".....OOO.OOO...."
        ],
        steps: [
          ["......PP.pP.....", ".....PP...pP....", "....PP.....pP...", "...OOO.....OOO.."],
          [".......pPP......", ".......pPP......", ".......pP.......", ".....OOpP.......", ".......OOO......"],
          ["......pP.PP.....", ".....pP...PP....", "....pP.....PP...", "...OOO.....OOO.."],
          [".......PpP......", ".......PpP......", ".......PPpP.....", ".......PPOO.....", ".......OOO......"]
        ]
      },
      { // the black cloak, over mail
        key: { ...CORWIN, i: "#9AA2B4", I: "#6A7080" }, dip: 10, alt: { 18: ".cCCdCCdiIdd...." }, legs: 17, held: CORWIN_SWORD,
        rows: [
          "......bBBBB.....", ".....bBBBBBB....", ".....BBBKKKK....", ".....BBKKKeK....", ".....BBKKKKKK...", "......bKKKKK....", "...cCCCCCCd.....",
          "..cCCCCCCCCd....", "..cCCCCCCCCd....", "..cCCCCCCCCC....", "..cCCCCCCCCCK...", "..cCCcCCCiCd....", "..cCCcCCiICd....", "..cCCcCCIgCd....",
          "..cCCcCCiICd....", "..cCCcCCIiCd....", ".cCCCcCCiICd....", ".cCCCcCCIiCd....", ".cCdCCdCiIdd....", "....OO...OOO...."
        ]
      },
      { // a fur collar, a helm, steel-blue plate under the cloak
        key: { ...CORWIN, i: "#7E98B8", I: "#56708E", s: "#C8D4E4", S: "#8EA2BC", x: "#5E7896" }, dip: 10, alt: { 18: ".cCCdCCdiIdd...." }, legs: 17, held: CORWIN_SWORD,
        rows: [
          "......sSSSS.....", ".....sSSSSSx....", ".....SSxKKKK....", ".....BSKKKeK....", ".....BBKKKKKK...", "......bKKKKK....", "...wfwFfwFf.....",
          "..wfFfFFfFFd....", "..fFFFfFFFFd....", "..cCFFCCCCCC....", "..cCCCCCCCCCK...", "..cCCcCCCiCd....", "..cCCcCCiICd....", "..cCCcCCigCd....",
          "..cCCcCCiICd....", "..cCCcCCiICd....", ".cCCCcCCiICd....", ".cCCCcCCiICd....", ".cCdCCdCIIdd....", "....OO...OOO...."
        ]
      }
    ]
  },
  { // Mossgather, a shepherd of trees: he lumbers, one root off the ground at a time
    steps: [
      ["...bBBD..bBBD...", ".bBBD.....bBBDD."],
      ["....bBBDbBBD....", "...bBBD.bBBD....", "........bBBDD..."],
      ["....bBBDbBBD....", "..bBBD...bBBDD.."],
      ["....bBBDbBBD....", "....bBBD.bBBD...", "...bBBD........."]
    ],
    ranks: [
      { // young and bare: bark, a pale belly, one sprig
        key: MOSSY, dip: 11, legs: 13,
        rows: [
          "................", "................", "......lL........", ".......t........", ".....bBBBBBD....", "....bBBBBBBD....", "....bBBeBBeD....", "....bBBBBBBnB...",
          "....bBBBBBBD....", "...tbBBnnBBD.t..", "..tTbBnnnBDDtt..", ".t..bBBnnBBDt...", "....bBBBBBBD....", "....bBBDbBBD....", "...bBBD.bBBD....", "..bBBD..bBBDD..."
        ]
      },
      { // mossy, in leaf
        key: MOSSY, dip: 11, alt: { 1: ".......l...l...." }, legs: 13,
        rows: [
          "................", "......l...l.....", "....lLLl.lLLd...", "...lLLLLLLLLLd..", "...dLbBBBBBLd...", "....bBBBBBBD....", "....bBBeBBeD....", "....bBBBBBBnB...",
          "....bmMMMMMN....", "...tbBmMMMMN.tl.", "..tTbBmMmMNDtt..", ".tt.bBBmMNBDt...", ".t..bBBBmNBD....", "....bBBDbBBD....", "...bBBD.bBBD....", "..bBBD..bBBDD..."
        ]
      },
      { // a full crown in blossom, and a mushroom on his shoulder that glows
        key: MOSSY, dip: 11, alt: { 0: "......l....l....", 1: ".....lLl..lLd..." }, legs: 13,
        rows: [
          ".....l....l.....", "....lLl..lLd....", "...lLLpllLpLd...", "..lpLLLLLLLLLd..", "...dLbBBBBBLd...", "....bBBBBBBD....", "....bBBeBBeD....", "...ubBBBBBBnB...",
          "...UbmMMMMMN....", "...tbBmMMMMN.tl.", "..tTbBmMmMNDtt..", ".tt.bBBmMNBDt...", ".t..bBBBmNBD....", "....bBBDbBBD....", "...bBBD.bBBD....", "..bBBD..bBBDD..."
        ],
        front(g, n, y) { const at = y + 7 + (n === 1 ? 1 : 0); g.px(2, at, n % 2 ? "#9FE8FF90" : "#9FE8FF50").px(3, at - 1, n % 2 ? "#9FE8FF90" : "#9FE8FF50").px(2, at - 1, "#9FE8FF30"); }
      }
    ]
  },
  { // Dame Berit Tallshield
    steps: [
      [".....rr.uU......", "....rr...uU.....", "...RR.....vV....", "...RRR....vVW..."],
      ["......uUr.......", "......uUr.......", "......uU........", "....RRvV........", "......vVW......."],
      [".....uU.rr......", "....uU...rr.....", "...vV.....RR....", "...vVW....RRR..."],
      ["......ruU.......", "......ruU.......", "......rruU......", "......RRvV......", "......RRR......."]
    ],
    ranks: [
      { // a padded tunic and a blue sash: no shield yet, no armour, her sword
        key: { ...BERIT, t: "#F6ECCC", T: "#DCCB9E", i: "#B4A074", u: "#8A7A5A", U: "#62543E", r: "#4E4232", v: "#8A5A34", V: "#5E3A1F", W: "#5E3A1F", R: "#4A2E18" }, dip: 12, legs: 15, held: BERIT_SWORD,
        rows: [
          ".....yYYYY......", "....yYYYYYYd....", "....yYYKKKK.....", "....YYKKKeK.....", "....dYKKKKKK....", ".....dKKKKK.....", "....tTTTTi......",
          "...tTiTTTTTi....", "...tTiTTTiTT....", "...tTiTTTiTT....", "...KTiTTTiTK....", "....bbbBBn......", "....tTiTTi......", "....tTiTTi......",
          "....tTTTTi......", ...BERIT_LEGS
        ]
      },
      { // a breastplate of plain iron, and the tall shield on her far arm
        key: { ...BERIT, a: "#C4CAD6", A: "#9AA2B2", z: "#727A8C", Z: "#565C6C", u: "#C4CAD6", U: "#9AA2B2", r: "#727A8C", v: "#C4CAD6", V: "#9AA2B2", W: "#727A8C", R: "#727A8C" }, dip: 12, legs: 15, held: BERIT_SWORD,
        rows: [
          ".....yYYYY......", "....yYYYYYYd....", "....yYYKKKK.....", "....YYKKKeK.....", "....dYKKKKKK....", ".bbbbdKKKKK.....", ".bBBnaAAAAz.....",
          ".bwwnaAAAAAz....", ".wBBwaAAAzAA....", ".bBBnaAAAzAA....", ".bBBnaAAAZAK....", ".bBBnZZAAAz.....", ".bBBnZZZZZZ.....", ".bBBnaAAAAA.....",
          "..bn.aAAAA......", ...BERIT_LEGS
        ]
      },
      { // bright plate trimmed with gold, and a helm with a blue plume
        key: { ...BERIT, a: STONE[0], A: STONE[1], z: STONE[2], Z: STONE[3], u: STONE[0], U: STONE[1], r: STONE[2], v: STONE[0], V: STONE[1], W: STONE[2], R: STONE[2], g: GOLD[1], G: GOLD[2], p: BLUE[0], P: BLUE[1] }, dip: 12, legs: 15, held: BERIT_SWORD,
        swing: { 2: ".pPPaAGKKKK.....", 3: "..p.aAKKKeK....." },
        rows: [
          "...pPPaAAA......", "..pPPaAAAAAz....", "..pPaAGKKKK.....", "...paAKKKeK.....", "....dYKKKKKK....", ".bbbbdKKKKK.....", ".bBBngGGGGz.....",
          ".bwwnaAAAAAz....", ".wBBwaAAAzAA....", ".bBBnaAAAzAA....", ".bBBnaAAAZgK....", ".bBBnZZAAAz.....", ".bBBngGGGGG.....", ".bBBnaAAAAA.....",
          "..bn.aAGAA......", ...BERIT_LEGS
        ]
      }
    ]
  },
  { // Emberling, a very small dragon who believes she is a large one: she keeps to her roof, and beats her wings
    ranks: [
      { // small and dull, no horns yet, a stub of a wing
        key: { ...EMBER, r: "#E8A078", R: "#C8744E", D: "#9A5236", y: "#F0DCB0", Y: "#D8BC84", w: "#E8C890", W: "#D0A060", n: "#6E3A22" }, front: dragonSmoke(false),
        alt: { 6: "...w..rRRyY.....", 7: "...wW.rRRyYY....", 8: "....DrRRRyYYr...", 11: "r..rRRRRRRyYRR.." },
        rows: [
          "................", "......rRRRR.....", ".....rRRRRRRR...", ".....rRieRRRRR..", ".....rRRRRRRnR..", "......rRRyyyy...", "......rRRyY.....",
          "...w..rRRyYY....", "...wWrRRRyYYr...", "....DrRRRyYYRr..", "....rRRRRyYYR...", ".r.rRRRRRRyYRR..", ".rRRRRDRRRRDRRc."
        ],
        beat: [
          { 6: "...w..rRRyY.....", 7: "...wW.rRRyYY....", 8: "....DrRRRyYYr..." },
          { 7: "..wW..rRRyYY....", 8: "....WrRRRyYYr..." },
          { 7: "......rRRyYY....", 8: "....WrRRRyYYr...", 9: "...wDrRRRyYYRr.." },
          {}
        ]
      },
      { // horns, proper wings, a pale belly
        key: { ...EMBER, r: "#F29060", R: "#DC5A34", D: "#A83C22", y: "#FFF3D0", Y: "#EDD9A6" }, front: dragonSmoke(true),
        alt: { 5: "..w...rRRyyyy...", 6: "..wW..rRRyY.....", 7: "..wWW.rRRyYY....", 8: "...DWrRRRyYYr...", 9: "....DrRRRyYYRr..", 11: "r..rRRRRRRyYRR.." },
        rows: [
          ".......h..h.....", "......rRRRR.....", ".....rRRRRRRR...", ".....rRieRRRRR..", ".....rRRRRRRnR..", "......rRRyyyy...", "..w...rRRyY.....",
          "..wW..rRRyYY....", "..wWWrRRRyYYr...", "...DWrRRRyYYRr..", "....rRRRRyYYR...", ".r.rRRRRRRyYRR..", ".rRRRRDRRRRDRRc."
        ],
        beat: [
          { 2: ".w...rRRRRRRR...", 3: ".wW..rRieRRRRR..", 4: "..wW.rRRRRRRnR..", 5: "..wWW.rRRyyyy...", 6: "...WWWrRRyY.....", 7: "....DWrRRyYY....", 8: ".....rRRRyYYr...", 9: ".....rRRRyYYRr.." },
          { 5: "..w...rRRyyyy...", 6: "..wW..rRRyY.....", 7: "..wWW.rRRyYY....", 8: "...DWrRRRyYYr...", 9: "....DrRRRyYYRr.." },
          { 6: "......rRRyY.....", 7: "......rRRyYY....", 8: "...WWrRRRyYYr...", 9: "..wWWrRRRyYYRr..", 10: ".wWDrRRRRyYYR..." },
          {}
        ]
      },
      { // bright scales, a golden belly, wings a size larger
        key: { ...EMBER, y: "#FFE36B", Y: "#FFC53D" }, front: dragonSmoke(true),
        alt: { 4: ".w...rRRRRRRnR..", 5: ".wW...rRRyyyy...", 6: ".wWW..rRRyY.....", 7: "..wWW.rRRyYY....", 8: "...DWrRRRyYYr...", 9: "....DrRRRyYYRr..", 11: "r..rRRRRRRyYRR.." },
        rows: [
          ".......h..h.....", "......rRRRR.....", ".....rRRRRRRR...", ".....rRieRRRRR..", ".....rRRRRRRnR..", ".w....rRRyyyy...", ".wW...rRRyY.....",
          ".wWW..rRRyYY....", "..wWWrRRRyYYr...", "...DWrRRRyYYRr..", "....rRRRRyYYR...", ".r.rRRRRRRyYRR..", ".rRRRRDRRRRDRRc."
        ],
        beat: [
          { 1: ".w....rRRRR.....", 2: ".wW..rRRRRRRR...", 3: ".wWW.rRieRRRRR..", 4: "..wWWrRRRRRRnR..", 5: "..wWWWrRRyyyy...", 6: "...WWWrRRyY.....", 7: "....DWrRRyYY....", 8: ".....rRRRyYYr...", 9: ".....rRRRyYYRr.." },
          { 4: ".w...rRRRRRRnR..", 5: ".wW...rRRyyyy...", 6: ".wWW..rRRyY.....", 7: "..wWW.rRRyYY....", 8: "...DWrRRRyYYr...", 9: "....DrRRRyYYRr.." },
          { 5: "......rRRyyyy...", 6: "......rRRyY.....", 7: "......rRRyYY....", 8: "...WWrRRRyYYr...", 9: "..wWWrRRRyYYRr..", 10: ".wWDrRRRRyYYR..." },
          {}
        ]
      }
    ]
  },
  { // Pim Greenhand, a gardener of uncommon nerve
    steps: [
      ["..mNN...nNN.....", ".fff.....KKf...."],
      ["...nNNNm........", "..ff.KK.........", ".....KKf........"],
      ["..nNN...NNm.....", ".KKf.....fff...."],
      ["...nNNNm........", "....ffKK........", "....fff........."]
    ],
    ranks: [
      { // a plain green smock, his curls bare
        key: PIM, dip: 7, legs: 11,
        rows: ["..cCc.cC........", ".cCCCCCCd.......", ...PIM_FACE, ".ggGGGGxggGK....", ".ggGGGGGGx......", ".ggGGGGGGx......", ".KgGGGGGx.......", "..nNNNNNm.......", ...PIM_LEGS]
      },
      { // white sleeves, an apron, a straw hat
        key: PIM, dip: 8, legs: 12,
        rows: ["...sSSSz........", "...bbbbb........", ".sSSSSSSSSz.....", ...PIM_FACE, ".wgGAAAxwwwK....", ".wgGAAAGGx......", ".wgGAAAGGx......", ".KgGAAAGx.......", "..nNAAaNm.......", ...PIM_LEGS]
      },
      { // a taller hat with a flower in the band, gold buttons, shears at his belt
        key: PIM, dip: 8, legs: 13,
        rows: ["....sSSz........", "...sSSSSzp......", "...bbbbbpPp.....", ".sSSSSSSSSSz....", ...PIM_FACE, ".wgGAyAxwwwK....", ".wgGAAAGGx......", ".wgGAyAGGx......", ".KgGAAAGxh......", "..nNAAaNmhH.....", ...PIM_LEGS]
      }
    ]
  },
  { // Ilsa Reedwhistle, an archer of the old wood
    steps: [
      ["......LL.lL.....", ".....LL...lL....", "....OO.....oO...", "....OOO....oOO.."],
      [".......lLL......", ".......lLL......", ".......oO.......", ".....OOoO.......", ".......oOO......"],
      ["......lL.LL.....", ".....lL...LL....", "....oO.....OO...", "....oOO....OOO.."],
      [".......LlL......", ".......LlL......", ".......OOlL.....", ".......OOoO.....", ".......OOO......"]
    ],
    ranks: [
      { // a plain green shift, her bow on her back
        key: ILSA, dip: 8, alt: ILSA_HAIR, swing: ILSA_HAIR, legs: 14, held: ILSA_BOW,
        rows: [
          "....hHHHH.......", "...hHHHHHH......", "...hEHKKKK......", "...hHEKKeK......", "...hHHKKKKK.....", "...hHaKKKK......", "...hHagGG.......",
          "..hHHagGGGx.....", "..hHHagGGGxgK...", "..hHaagGGGx.....", "..hHa.gGGGx.....", ...ILSA_SKIRT
        ]
      },
      { // a leather jerkin and belt, a quiver
        key: ILSA, dip: 8, alt: ILSA_HAIR, swing: ILSA_HAIR, legs: 14, held: ILSA_BOW,
        rows: [
          "....hHHHH.......", "..fhHHHHHH......", "..FhEHKKKK......", "...hHEKKeK......", "...hHHKKKKK.....", "...hHaKKKK......", "...hHajJJ.......",
          "..hHHajJJJx.....", "..hHHajJJJxgK...", "..hHaajJJJx.....", "..hHa.BBBBB.....", ...ILSA_SKIRT
        ]
      },
      { // a green hood up over her hair, a gold buckle, fletching in red and gold
        key: { ...ILSA, f: GOLD[1], F: RED[1] }, dip: 8, alt: ILSA_HAIR, swing: ILSA_HAIR, legs: 14, held: ILSA_BOW,
        rows: [
          "....gGGGG.......", "..fgGGGGGGx.....", "..FgGHKKKK......", "...gGHKKeK......", "...gGGKKKKK.....", "...xGxKKKK......", "...hHajJJ.......",
          "..hHHajJJJx.....", "..hHHajJJJxgK...", "..hHaajJJJx.....", "..hHa.BBqBB.....", ...ILSA_SKIRT
        ]
      }
    ]
  }
];
const guardian = {
  w: 16, h: 22, frames: 6,
  draw(g, f, o) {
    // Frames 0 and 1 are the idle: standing, then a breath out. Frames 2 to 5 are four steps, or four beats of a wing.
    const n = ((Math.round(f) % 6) + 6) % 6, k = n === 1 ? 1 : 0, who = GUARDIANS[level(o, 6)], rank = Math.round(Number(o && o.rank) || 0);
    // No rank, or one that is not 1 to 3, is the last look.
    const L = who.ranks[rank >= 1 && rank <= 3 ? rank - 1 : 2];
    let rows = L.rows.slice();
    if (k) {
      if (L.dip !== undefined) { rows.splice(L.dip + 1, 1); rows.unshift(""); }
      Object.keys(L.alt || {}).forEach((j) => { rows[j] = L.alt[j]; });
    } else if (n > 1 && L.beat) Object.keys(L.beat[n - 2]).forEach((j) => { rows[j] = L.beat[n - 2][j]; });
    else if (n > 1) {
      const steps = (L.steps || who.steps)[n - 2], sink = rows.length - L.legs - steps.length, cut = L.cut || 0;
      if (n % 2 === 0) Object.keys(L.swing || {}).forEach((j) => { rows[j] = L.swing[j]; });
      rows = rows.slice(0, L.legs).concat(steps.map((step, i) => {
        const kept = rows[L.legs + i + sink].slice(0, cut);
        return (n > 3 && cut ? "." + kept.slice(0, -1) : kept) + step.slice(cut);
      }));
    }
    const y = 21 - rows.length;
    g.stamp((l) => { chart(l, 0, y, rows, L.key); if (L.held) L.held(l, k, y); }, INK);
    if (L.front) L.front(g, n, y);
  }
};

// ---------------------------------------------------------------- the camp's animals
/** Four legs down to the ground on row 12, from row `top`: the near pair at `back` and `front`, the
 far pair a step ahead of them in the darker colour. One pair swings apart as the other closes, and
 on the frames between a near foot is off the ground. P is near leg, far leg, foot; `sock` is how
 far the foot's colour comes up the leg. */
const trot = (l, k, top, back, front, P, sock = 0) => {
  const s = [1, 0, -1, 0][k];
  const leg = (x, c, up) => l.rect(x, top, 1, 12 - top - up, c).rect(x, 12 - sock - up, 1, 1 + sock, P[2]);
  leg(back + 1 + s, P[1], 0);
  leg(front + 1 - s, P[1], 0);
  leg(back - s, P[0], k === 3 ? 1 : 0);
  leg(front + s, P[0], k === 1 ? 1 : 0);
};
const HEN = { W: "#FFFFFF", w: "#E6EDF5", s: "#C2CCDA", R: RED[0], r: RED[1], y: "#F0A030", e: "#10231A" };
const CAT = { o: "#FFB866", O: "#E8903A", d: "#B8602A", w: "#FFF6E8", p: "#FF9A8A", e: "#10231A" };
const GOAT = { c: "#FFFBEE", C: "#EFE4C8", d: "#C4B48E", E: "#B8A078", h: "#8A7A68", H: "#5E5044", e: "#10231A", n: "#C88A80", b: "#FFFFFF", t: "#EFE4C8" };
const OWL = { T: "#B07A44", t: "#D6A468", d: "#7A522C", Y: GOLD[1], E: "#10231A", b: "#F0A030", c: "#F6E6C0", C: "#C89A62" };
const FOX = { r: "#F08A4A", R: "#D8642E", d: "#A8441E", w: "#FFFFFF", W: "#E6EDF5", k: "#3A2418", e: "#10231A", n: "#2A1A10" };
const TORT = { s: "#B4BC68", S: "#86924A", d: "#5A6630", D: "#4E5A2C", r: "#9A7C44", R: "#6B5226", p: "#E0D494", P: "#B8A868", g: "#A8CC70", G: "#7EA850", e: "#10231A" };
const ANIMALS = [
  // A white hen: she steps, and her head goes forward and back as hens' heads do.
  (g, k) => g.stamp((l) => {
    const dy = k % 2, y0 = 3 + dy, hx = [1, 0, 0, 1][k], LEG = "#E0903A";
    if (k === 0) l.px(5, 11, LEG).rect(5, 12, 2, 1, LEG).px(8, 11, LEG).rect(8, 12, 2, 1, LEG);
    else if (k === 2) l.px(6, 11, LEG).rect(6, 12, 2, 1, LEG).px(8, 11, LEG).rect(8, 12, 2, 1, LEG);
    else l.rect(7, 12, 2, 1, LEG).px(k === 1 ? 9 : 5, 11, LEG);
    chart(l, 3, y0 + 2, ["w......", "wW.....", "wWWWWWW", ".WWsWWW", ".sWWssW", "..ssss."], HEN);
    chart(l, 7 + hx, y0, ["..RR.", ".WWW.", ".WeWy", ".WWr."], HEN);
  }, INK),
  // A ginger tabby, tail straight up.
  (g, k) => g.stamp((l) => {
    const dy = k % 2;
    trot(l, k, 10 + dy, 3, 9, [CAT.O, CAT.d, CAT.w]);
    chart(l, 0, 1 + dy, [
      "..oO............", ".oO.......o..o..", ".dd......oOooOd.", ".oO......OOOOOO.", ".dd......OeOOeO.", ".oO......OOwpwO.",
      ".oOodOodOOOwwwd.", "..OOdOOdOOOOdd..", "..OOOOOOOOOd...."
    ], CAT);
    if (k === 2) l.px(2, 1, CAT.o).px(1, 1, CAT.O);
  }, INK),
  // A cream goat with two small horns and a beard.
  (g, k) => g.stamp((l) => {
    const dy = k % 2;
    trot(l, k, 9 + dy, 3, 8, [GOAT.C, GOAT.d, "#5A4636"]);
    chart(l, 0, 1 + dy, [
      ".........h.h....", "..........h.H...", ".........cCCCC..", "........EcCeCCC.", "..t.....EcCCCCn.", "..cCCCCCCCCCCd..",
      "..cCCCCCCCCdbb..", "..CCddddCCd..b.."
    ], GOAT);
  }, INK),
  // A tawny owl. It does not walk: it settles and blinks, hops, and comes down.
  (g, k) => g.stamp((l) => {
    const y0 = [3, 4, 1, 2][k], x0 = 3, FOOT = "#E0903A";
    if (k === 2) l.px(x0 + 3, y0 + 9, FOOT).px(x0 + 6, y0 + 9, FOOT);
    else {
      if (k === 3) l.px(x0 + 3, 11, FOOT).px(x0 + 6, 11, FOOT);
      if (k !== 1) l.rect(x0 + 2, 12, 2, 1, FOOT).rect(x0 + 5, 12, 2, 1, FOOT);
    }
    chart(l, x0, y0, ["T.......T", "TTtttttTd", "TtYYtYYTd", "TtYEbYEtd", "TTttbttTd", "TTcCcCcTd", "TTCcCcCTd", ".TcCcCcd.", "..TcCcd.."], OWL);
    if (k === 1) chart(l, x0 + 2, y0 + 2, ["tt.tt", "dd.dd"], OWL);
    if (k === 2) l.px(x0 - 1, y0 + 4, OWL.T).px(x0 - 1, y0 + 5, OWL.d).px(x0 + 9, y0 + 4, OWL.T).px(x0 + 9, y0 + 5, OWL.d);
  }, INK),
  // A russet fox, the tip of the tail white.
  (g, k) => g.stamp((l) => {
    const dy = k % 2;
    trot(l, k, 10 + dy, 4, 8, [FOX.R, FOX.d, FOX.k]);
    chart(l, 0, 1 + dy, [
      ".........k..k...", ".........Rr.Rr..", "........rRRRRR..", "........rReRRRR.", "..wr....rRRwwwn.", ".wWrRrrrrRRww...",
      ".wWrRRRRRRRww...", "..rRRRRRRRRw....", "...RRddddRR....."
    ], FOX);
  }, INK),
  // A tortoise, in no hurry: one pair of legs at a time, the head out a little further on the way.
  (g, k) => g.stamp((l) => {
    const s = [1, 0, -1, 0][k];
    for (const [x, c, up] of [[4 + s, TORT.G, 0], [8 - s, TORT.G, 0], [3 - s, TORT.g, k === 3], [7 + s, TORT.g, k === 1]]) l.rect(x, 11, 2, up ? 1 : 2, c);
    chart(l, 0, 6, ["....sSSS........", "..sSSdSSSD......", "..sSdSSdSD.gG...", "..sdSSdSSDDgeG..", "..rrrrrrrRgGG...", "...pppppP......."], TORT);
  }, INK)
];
const animal = {
  w: 16, h: 14, frames: 4,
  draw(g, f, o) {
    // A walk to the right: a stride, the legs passing, the other stride, passing again.
    ANIMALS[level(o, 5)](g, ((Math.round(f) % 4) + 4) % 4);
  }
};

const heart = {
  w: 7, h: 6,
  draw(g) {
    g.stamp((l) => chart(l, 1, 1, ["wr.RR", "rRRRd", ".RRd.", "..d.."], { w: "#FFD6D6", r: "#FF7A7A", R: "#E8303C", d: "#B01E30" }), "#6E1420");
  }
};

// ---------------------------------------------------------------- the lie of the land
/** The edge of anything that lies flat on the grass: a soft dark rim, not the hard line. */
const RIM = "#1C4A2A78";
/** Water: a glint, the shallows, the body, the deep, the shade under the far bank. */
const WATER = ["#BDEBFF", "#62B4EE", "#3E9BE0", "#2F86D6", "#2A78C8"];
const BANK = ["#F2E9C0", "#D9CB98"];
const PINE = ["#5FA868", "#2F7A4A", "#1D5A38", "#17482E"];
const BIRCH = ["#C8EE8A", "#96D060", "#62A848"];
const BLADES_OF_GRASS = ["#B9E68A", "#78B656", "#4E9A46", "#3A7A40"];
/** A tuft of three pixels; on frame 1 its tip leans with the wind. */
const tuft = (g, x, y, c, k) => g.px(x, y, c).px(x + 1 + k, y - 1, c).px(x + 2, y, c);
const LANDS = [
  // A pond: an oval of water in a pale bank, a lily pad on it.
  (g, k, G) => {
    const cy = G - 4;
    g.stamp((l) => {
      l.ell(24, cy, 11, 4.6, (nx, ny) => (nx + ny * 1.5 < 0 ? BANK[0] : BANK[1]));
      l.ell(24, cy, 9.6, 3.4, (nx, ny) => (ny < -0.5 ? WATER[4] : ny > 0.4 && nx < 0.6 ? WATER[1] : WATER[2]));
    }, RIM);
    g.rect(25 + k, cy, 3, 1, WATER[0]).px(29 + k, cy + 1, WATER[0]).rect(21 - k, cy + 2, 2, 1, WATER[0]);
    g.rect(18, cy - 1, 3, 2, "#4FBF5A").px(20, cy - 1, WATER[2]).px(18, cy, "#2E8B3C").px(19, cy - 1, "#FFB3D1");
  },
  // A lake: a bigger, uneven oval, reeds at its left end, light moving on the water.
  (g, k, G) => {
    const E = [[24, G - 7.5, 19, 6.2], [14, G - 10.5, 10, 5], [33, G - 5.5, 12, 5.2]];
    const wet = (x, y, grow) => E.some(([cx, cy, rx, ry]) => { const nx = (x + 0.5 - cx) / (rx + grow), ny = (y + 0.5 - cy) / (ry + grow * 0.6); return nx * nx + ny * ny <= 1; });
    g.stamp((l) => {
      for (let y = 8; y <= G; y++) for (let x = 1; x <= 46; x++) {
        if (!wet(x, y, 1.4)) continue;
        if (!wet(x, y, 0)) l.px(x, y, wet(x + 1, y + 1, 0) ? BANK[0] : BANK[1]);
        else l.px(x, y, !wet(x, y - 1, 0) ? WATER[4] : wet(x, y, -3.2) ? WATER[3] : !wet(x, y + 2, 0) ? WATER[1] : WATER[2]);
      }
    }, RIM);
    [[17, G - 12, 3], [26, G - 9, 4], [34, G - 6, 3], [21, G - 5, 2], [39, G - 8, 2], [11, G - 9, 2], [30, G - 3, 3]].forEach(([x, y, w], i) => g.rect(x + (i % 2 ? k : -k), y, w - (k && i % 3 === 0 ? 1 : 0), 1, WATER[0]));
    g.px(28 + k, G - 9, "#FFFFFF").px(35 - k, G - 6, "#FFFFFF");
    g.rect(37, G - 4, 3, 2, "#4FBF5A").px(39, G - 4, WATER[2]).px(37, G - 3, "#2E8B3C").rect(41, G - 6, 2, 1, "#4FBF5A");
    // The reeds stand in the shallows; their heads nod.
    [[4, 7, G - 9], [6, 4, G - 11], [8, 6, G - 12], [10, 8, G - 12]].forEach(([x, top, foot], i) => {
      for (let y = top; y <= foot; y++) g.px(x + (y < top + 4 ? k : 0), y, y < top + 3 ? (y === top ? "#A86A3A" : "#6E4222") : i % 2 ? "#3F8F4A" : "#2F7340");
      g.px(x + 1, foot - 3 - i, "#4E9A46").px(x + 2, foot - 4 - i, "#4E9A46");
    });
  },
  // A knoll: a rounded grassy hill for the back of the clearing, lit from the upper left.
  (g, k, G) => {
    const crest = (x) => { const u = (x + 0.5 - 24) / 22.5; return Math.abs(u) >= 1 ? 0 : Math.max(1, Math.round(20 * Math.pow(Math.cos((u * Math.PI) / 2), 0.62))); };
    g.stamp((l) => {
      for (let x = 2; x <= 45; x++) {
        const h = crest(x), u = (x + 0.5 - 24) / 22.5;
        for (let j = 0; j < h; j++) {
          // The shade deepens to the right and toward the foot.
          const y = G - j, d = h - 1 - j, r = rnd(x * 12.9 + y * 78.2), s = u * 1.1 - j / 40;
          let c = TURF[1];
          if (d === 0 || j >= crest(x - 1)) c = u > 0.25 ? TURF[1] : TURF[0];
          else if (s > 0.62 || (j === 0 && u > -0.2)) c = TURF[3];
          else if (s > 0.3 || j === 0 || j >= crest(x + 1)) c = TURF[2];
          else if (s > 0.2 && (x + y) % 2 === 0) c = TURF[2];
          else if (d <= 2 && u < 0.1) c = TURF[0];
          else if (r > 0.96 && s < 0) c = TURF[0];
          else if (r < 0.04) c = TURF[2];
          l.px(x, y, c);
        }
      }
    }, INK_LEAF);
    for (const [x, y] of [[8, 21], [14, 14], [21, 11], [18, 22]]) tuft(g, x, y, "#C4F09A", k);
    for (const [x, y] of [[28, 15], [35, 13], [38, 22], [29, 23]]) tuft(g, x, y, TURF[3], k);
    for (const [x, y, c] of [[12, 18, "#FFFFFF"], [25, 10, "#FFE066"], [22, 17, "#FFB3D1"], [33, 19, "#FFFFFF"]]) g.px(x + k, y, c).px(x, y + 1, TURF[3]);
  },
  // Boulders: three grey rocks, the grass grown up against them.
  (g, k, G) => {
    const rock = (cx, by, rx, ry, p) => g.stamp((l) => dome(l, cx, by, rx, ry, (u, t, x, y, edge, near) => {
      if (edge) return u > 0.35 ? STONE[1] : STONE[0];
      if (u > 0.6) return STONE[3];
      if (u > 0.25 || t < 0.15) return STONE[2];
      if (near && u < 0) return STONE[0];
      return rnd(x * 7.7 + y * 3.9) > 0.88 ? "#A0A9B7" : STONE[1];
    }, p), INK_STONE);
    rock(31, G - 1, 5, 6, 2.6);
    rock(21, G, 7, 10, 2.5);
    rock(28, G, 3, 3, 2.2);
    g.px(19, G - 6, STONE[3]).px(20, G - 5, STONE[3]).px(20, G - 4, STONE[3]).px(17, G - 8, "#5E8A4E").px(18, G - 9, "#5E8A4E").px(19, G - 9, "#78B656");
    tuft(g, 11, G, BLADES_OF_GRASS[1], k);
    tuft(g, 35, G, BLADES_OF_GRASS[2], k);
  },
  // A pine: a dark conifer in four tiers, each one's skirt stirring.
  (g, k, G) => {
    g.stamp((l) => l.rect(23, G - 2, 2, 3, BARK[1]).rect(23, G - 2, 1, 3, BARK[0]).px(22, G, BARK[1]).px(25, G, BARK[2]), INK);
    g.stamp((l) => {
      for (const [y0, n, a, b] of [[18, 6, 4, 7.6], [12, 6, 3, 6.4], [6, 6, 2, 5], [1, 5, 0.5, 3]]) for (let j = 0; j < n; j++) {
        const hw = Math.round(a + ((b - a) * j) / (n - 1)), last = j === n - 1;
        for (let i = -hw; i < hw; i++) {
          const u = (i + 0.5) / hw;
          l.px(24 + i + (last ? k : 0), y0 + j, last ? (u < 0 ? PINE[2] : PINE[3]) : i === -hw || u < -0.5 ? PINE[0] : u > 0.35 ? PINE[2] : (i + j * 2 + 40) % 5 === 0 ? PINE[2] : PINE[1]);
        }
      }
    }, INK_LEAF);
  },
  // A bush: round, with a few red berries.
  (g, k, G) => {
    g.stamp((l) => [[24 + k * 0.4, G - 4.5, 6.5, 5.2], [19.4, G - 2.6, 3.4, 3.1], [28.8 + k * 0.6, G - 2.8, 3.6, 3.3], [24, G - 1.5, 6, 2]].forEach(([x, y, a, b]) => l.ell(x, y, a, b, lobe)), INK_LEAF);
    for (const [x, y] of [[20, G - 3], [24, G - 6], [27, G - 2], [29, G - 5], [22, G - 1]]) g.px(x, y, "#E0393E").px(x + 1, y, RED[2]);
    g.px(24, G - 7, "#FF9A8A").px(20, G - 4, "#FF9A8A");
  },
  // Wildflowers: a loose patch of small flowers in the grass, no edge to it.
  (g, k, G) => {
    for (const [x, y] of [[14, G + 1], [19, G], [24, G + 1], [29, G], [33, G + 1], [16, G - 3], [27, G - 4], [22, G - 2]]) tuft(g, x, y, BLADES_OF_GRASS[(x + y) % 2 ? 1 : 2], k);
    [[15, G - 2], [18, G - 5], [21, G], [23, G - 5], [26, G - 1], [30, G - 5], [32, G - 2], [34, G - 4], [13, G - 5], [28, G - 6]].forEach(([x, y], i) => g.px(x, y + 1, BLADES_OF_GRASS[2]).px(x + (i % 2 ? k : 0), y, [...PETALS, "#FF6FA8"][i % 6]));
    for (const [x, y, c, eye] of [[20, G - 3, "#FFFFFF", GOLD[1]], [25, G - 3, "#FF6FA8", GOLD[1]], [31, G - 1, GOLD[1], "#E07A3A"]]) {
      g.rect(x, y + 2, 1, 2, BLADES_OF_GRASS[2]).rect(x - 1 + k, y, 3, 1, c).rect(x + k, y - 1, 1, 3, c).px(x + k, y, eye);
    }
  },
  // Stepping stones: five flat pale stones in a gentle curve.
  (g, k, G) => {
    for (const [x, y, rx, ry] of [[11.5, G - 0.5, 3, 1.5], [18, G - 2.5, 2.6, 1.5], [24.5, G - 3.5, 3, 1.5], [31, G - 2.5, 2.6, 1.5], [37.5, G - 0.5, 3, 1.5]]) {
      g.stamp((l) => l.ell(x, y, rx, ry, (nx, ny) => (ny > 0.3 ? STONE[2] : nx + ny < -0.6 ? "#FFFFFF" : nx > 0.45 ? STONE[1] : STONE[0])), RIM);
    }
  },
  // Tall grass: a clump that leans one way and then the other.
  (g, k, G) => {
    const H = [3, 6, 4, 8, 5, 9, 6, 10, 7, 9, 5, 8, 4, 7, 3, 5];
    g.stamp((l) => H.forEach((h, i) => {
      for (let j = 0; j < h; j++) {
        const lean = j === h - 1 ? (i % 2 ? (k ? 1 : 0) : k ? 0 : -1) : j === h - 2 && k && i % 2 ? 1 : 0;
        l.px(16 + i + lean, G - j, j === h - 1 ? BLADES_OF_GRASS[0] : j === 0 && i % 2 ? BLADES_OF_GRASS[3] : BLADES_OF_GRASS[1 + ((i * 7) % 3 === 0 || (j === 1 && i % 3 === 1) ? 1 : 0)]);
      }
    }), RIM);
  },
  // A birch: a white trunk with dark marks, a light crown that shifts.
  (g, k, G) => {
    const leaf = (nx, ny, x, y) => {
      const s = nx * 0.7 + ny, r = rnd(x * 12.9 + y * 78.2);
      return s < -0.45 ? BIRCH[0] : s > 0.55 ? BIRCH[2] : r > 0.88 ? BIRCH[2] : r < 0.08 && s < 0 ? BIRCH[0] : BIRCH[1];
    };
    g.stamp((l) => {
      l.rect(23, 9, 1, G - 8, "#FFFFFF").rect(24, 9, 1, G - 8, "#F2F2EA").rect(25, 9, 1, G - 8, "#CDD3CE").px(22, G, "#F2F2EA").px(26, G, "#CDD3CE");
      for (const [x, y, w] of [[23, G - 1, 2], [24, G - 4, 2], [23, G - 6, 1], [24, G - 8, 2], [23, G - 11, 2]]) l.rect(x, y, w, 1, "#3A3A40");
    }, INK);
    g.stamp((l) => [[24, 7.5, 6, 6.2], [20.5, 11.5, 3.2, 3.2], [27.8 + k * 0.6, 11, 3.4, 3.4], [24 + k * 0.5, 3.6, 3.6, 2.8]].forEach(([x, y, a, b]) => l.ell(x, y, a, b, leaf)), INK_LEAF);
  }
];
const land = {
  w: 48, h: 28, frames: 2,
  draw(g, f, o) {
    LANDS[level(o, 9)](g, ((Math.round(f) % 2) + 2) % 2, 26);
  }
};

// ---------------------------------------------------------------- defensive works
const HEDGE = ["#4E8A5A", "#2B5E40", "#1C4532", "#143524"];
const BRONZE = ["#FFE08A", "#E2A63A", "#A86E1C", "#6E440E"];
const WORKS = [
  // A ward stone: a tall standing stone, three marks cut in it that glow pale blue.
  (g, k, G) => {
    const SPAN = [[9, 11], [8, 12], [8, 13], [7, 13], [7, 14], [7, 14], [7, 14], [7, 14], [6, 14], [6, 14], [6, 14], [6, 14], [6, 14], [6, 14], [6, 15], [6, 15], [6, 15], [5, 15], [5, 15]];
    const MARKS = [[G - 15, [".r.", "r.r", ".r."]], [G - 11, [".r.", ".r.", "r.r"]], [G - 7, ["rr.", "...", ".rr"]]];
    g.ell(10.5, G - 9, 7.5, 10, k ? "#9FE8FF30" : "#9FE8FF16");
    if (k) g.ell(10.5, G - 9, 10, 12, "#9FE8FF20");
    g.stamp((l) => SPAN.forEach(([a, b], j) => {
      const y = G - 18 + j;
      for (let x = a; x <= b; x++) l.px(x, y, j === 0 || x === a ? STONE[0] : x === b ? STONE[3] : x >= b - 2 ? STONE[2] : x === a + 1 && j % 4 !== 3 ? STONE[0] : rnd(x * 5.3 + y * 9.7) > 0.86 ? "#A0A9B7" : STONE[1]);
    }), INK_STONE);
    g.px(12, G - 17, STONE[2]).px(13, G - 16, STONE[2]).px(8, G - 3, STONE[2]).px(9, G - 2, STONE[2]);
    g.rect(5, G - 1, 3, 2, MOSS[1]).px(5, G - 2, MOSS[1]).px(6, G - 2, MOSS[0]).px(8, G, MOSS[2]).px(7, G - 1, MOSS[0]);
    g.stamp((l) => l.rect(16, G, 2, 1, STONE[1]).px(16, G, STONE[0]), INK_STONE);
    tuft(g, 1, G, BLADES_OF_GRASS[1], 0);
    for (const [top, rows] of MARKS) rows.forEach((row, j) => { for (let i = 0; i < 3; i++) if (row[i] === "r") for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.px(9 + i + dx, top + j + dy, k ? "#9FE8FF90" : "#9FE8FF24"); });
    for (const [top, rows] of MARKS) chart(g, 9, top, rows, { r: k ? "#F2FDFF" : "#8FDCF6" });
    if (k) g.px(3, G - 13, "#DFF8FF").px(18, G - 16, "#DFF8FF").px(17, G - 6, "#9FE8FFC0").px(4, G - 7, "#9FE8FFC0");
  },
  // A whip-thorn hedge: low and dark, bristling with long pale thorns that curl like whips.
  (g, k, G) => {
    const leaf = (nx, ny, x, y) => {
      const s = nx * 0.7 + ny, r = rnd(x * 12.9 + y * 78.2);
      return s < -0.55 ? HEDGE[0] : s > 0.5 ? HEDGE[3] : r > 0.8 ? HEDGE[3] : r < 0.1 && s < 0 ? HEDGE[0] : (x + y) % 3 === 0 ? HEDGE[2] : HEDGE[1];
    };
    const THORNS = [
      [[5, G - 6], [4, G - 7], [4, G - 8], [4, G - 9], [3, G - 10], [2, G - 11], k ? [1, G - 12] : [1, G - 11], k ? [1, G - 13] : [1, G - 10]],
      [[10, G - 8], [10, G - 9], [10, G - 10], [10, G - 11], [11, G - 12], [12, G - 13], [13, G - 13], k ? [14, G - 13] : [14, G - 12], k ? [15, G - 12] : [14, G - 11]],
      [[16, G - 6], [17, G - 7], [17, G - 8], [17, G - 9], [18, G - 10], [19, G - 11], [20, G - 11], [20, G - 10]],
      [[7, G - 8], [7, G - 9]], [[14, G - 7], [14, G - 8]], [[2, G - 3], [1, G - 4]], [[19, G - 3], [20, G - 4]]
    ];
    g.stamp((l) => {
      [[5.5, G - 2.6, 4.5, 3.6], [11, G - 3.2, 5.5, 4.2], [16.5, G - 2.6, 4.5, 3.6]].forEach(([x, y, a, b]) => l.ell(x, y, a, b, leaf));
      for (let x = 2; x <= 19; x++) l.px(x, G, x > 12 ? HEDGE[3] : HEDGE[2]);
      THORNS.forEach((pts) => pts.forEach(([x, y], i) => l.px(x, y, i === 0 ? "#B4C098" : i === pts.length - 1 ? "#FFFFFF" : "#EEF2D8")));
    }, INK_LEAF);
  },
  // A thumper: a stout post driven into the ground, a weighted beater on a spring arm; frame 1 is the blow.
  (g, k, G) => {
    const ex = k ? 17 : 16, ey = k ? G - 5 : G - 18, bx = ex - 2, by = k ? G - 4 : ey - 2;
    g.stamp((l) => {
      l.rect(5, G - 12, 4, 13, TIMBER[1]).rect(5, G - 12, 1, 13, TIMBER[0]).rect(8, G - 12, 1, 13, TIMBER[2]).rect(5, G - 13, 4, 1, "#F0D9A8");
      l.rect(5, G - 8, 4, 1, STEEL[2]).px(5, G - 8, STEEL[1]).rect(5, G - 3, 4, 1, STEEL[2]).px(5, G - 3, STEEL[1]);
      l.rect(3, G, 8, 1, MUD[2]).px(4, G - 1, MUD[1]).px(9, G - 1, MUD[2]).px(3, G, MUD[1]);
    }, INK);
    g.stamp((l) => l.line(8, G - 11, ex, ey + 1, TIMBER[2]).line(8, G - 12, ex, ey, TIMBER[0]), INK);
    g.stamp((l) => l.rect(7, G - 13, 3, 3, STEEL[1]).px(7, G - 13, STEEL[0]).px(8, G - 12, "#3A3F4B").px(9, G - 11, STEEL[2]), INK_STONE);
    g.stamp((l) => {
      l.rect(bx, by, 5, 5, STONE[1]).rect(bx, by, 5, 1, STONE[0]).rect(bx, by, 1, 5, STONE[0]).rect(bx + 4, by + 1, 1, 4, STONE[2]).rect(bx + 1, by + 4, 4, 1, STONE[3]);
      l.rect(bx, by + 2, 5, 1, "#565C6C").px(bx, by + 2, STEEL[2]);
    }, INK_STONE);
    if (k) g.px(12, G, "#E8DCC0").px(11, G - 1, "#E8DCC0C0").px(12, G - 3, "#E8DCC090").px(21, G - 1, "#E8DCC0").px(20, G - 3, "#E8DCC0C0").px(21, G - 5, "#E8DCC070").px(13, G - 1, "#C9B890");
  },
  // A smoke brazier: an iron bowl on three legs, thick smoke pouring up and a little to one side.
  (g, k, G) => {
    const SMOKE = ["#FFFFFF", "#E4E9F0", "#BCC4D2"];
    const billow = (x, y, a, b) => g.stamp((l) => l.ell(x, y, a, b, (nx, ny) => (nx + ny < -0.45 ? SMOKE[0] : nx * 0.6 + ny > 0.45 ? SMOKE[2] : SMOKE[1])), "#8A93A6");
    for (const [x, y, a, b] of k ? [[16.2, G - 19.4, 2.4, 1.8], [14, G - 16.5, 4.2, 2.8], [12.4, G - 12.6, 3.4, 2.6], [11, G - 9.4, 3, 2]] : [[15.4, G - 19, 3.2, 2.2], [13.4, G - 15.4, 3.8, 3], [11.6, G - 11.6, 3.8, 2.6], [10.6, G - 9, 2.6, 1.8]]) billow(x, y, a, b);
    g.stamp((l) => {
      l.line(7, G - 3, 5, G, "#565C6C").line(14, G - 3, 16, G, "#3A3F4B").rect(10, G - 3, 2, 4, "#4A4F5C").px(10, G - 3, "#7E8698");
      l.rect(5, G - 7, 12, 1, "#8C93A6").rect(5, G - 6, 12, 1, "#565C6C").rect(6, G - 5, 10, 1, "#4A4F5C").rect(7, G - 4, 8, 1, "#3A3F4B").px(5, G - 6, "#7E8698").px(6, G - 5, "#6A7080").rect(14, G - 6, 3, 1, "#3A3F4B");
      l.rect(7, G - 8, 8, 1, "#2E2630").px(8, G - 8, FIRE.r).px(10, G - 8, FIRE.o).px(11, G - 8, FIRE.Y).px(13, G - 8, FIRE.r);
    }, INK_STONE);
  },
  // A tanglefoot patch: a low mat of creeping vine, root loops standing out of it to catch a foot; on frame 1 two of them twitch.
  (g, k, G) => {
    const top = G - 5 - k;
    g.stamp((l) => {
      // The mat, and a low hump of root at its left end.
      chart(l, 1, G - 3, ["..rR................", ".r..d.l.......l.....", "lRkLdLLk.....lLkdkk.", ".LlLkLLkLlRkLkLdLkk."], { l: TURF[1], L: TURF[2], k: TURF[3], r: STICK[0], R: STICK[1], d: STICK[2] });
      // The big loop in the middle, open enough to see the grass through.
      l.rect(10, top, 3, 1, STICK[0]).px(9, top + 1, STICK[0]).px(13, top + 1, STICK[1]).px(9, G - 1, STICK[1]).px(13, G - 1, STICK[2]);
      for (let y = top + 2; y <= G - 2; y++) l.px(8, y, STICK[0]).px(14, y, STICK[2]);
      // A hooked runner at the right end.
      (k ? [[17, 2], [17, 3], [17, 4], [18, 5], [19, 5], [20, 4]] : [[17, 2], [17, 3], [18, 4], [19, 4], [20, 3]]).forEach(([x, up], i, all) => l.px(x, G - up, i === all.length - 1 ? STICK[1] : STICK[0]));
      l.px(7, G - 3, "#FFFFFF").px(15, G - 3, "#FFF6DF");
    }, INK);
  },
  // A hornet jar: a squat clay jar wedged in a forked post, its rim banded like its tenants. Only the hornets move.
  (g, k, G) => {
    g.stamp((l) => {
      l.rect(10, G - 6, 2, 7, STICK[1]).rect(10, G - 6, 1, 7, STICK[0]);
      for (let i = 1; i <= 6; i++) l.px(10 - i, G - 6 - i, i === 6 ? "#F0D9A8" : STICK[0]).px(11 + i, G - 6 - i, i === 6 ? STICK[0] : STICK[2]);
      l.rect(9, G, 4, 1, MUD[2]).px(9, G, MUD[1]);
      l.ell(11, G - 11.5, 5.2, 3.5, (nx, ny) => (nx + ny < -0.7 ? TILE[0] : nx * 0.8 + ny > 0.6 ? TILE[2] : TILE[1]));
      l.px(8, G - 13, "#FFD6C2");
      for (let x = 7; x <= 14; x++) l.px(x, G - 16, x % 2 ? GOLD[1] : PLANK[3]);
      l.rect(8, G - 17, 6, 1, "#2E2630").px(7, G - 17, TILE[0]).px(14, G - 17, TILE[2]).rect(8, G - 18, 6, 1, TILE[1]).px(8, G - 18, TILE[0]);
    }, INK);
    g.rect(8, G - 1, 2, 2, MOSS[1]).px(8, G - 1, MOSS[0]).px(9, G, MOSS[2]).px(7, G, MOSS[1]);
    tuft(g, 14, G, BLADES_OF_GRASS[1], 0);
    for (const [x, y, d] of k ? [[2, G - 9, 1], [20, G - 16, -1], [17, G - 6, 1], [5, G - 3, -1], [9, G - 21, 1]] : [[1, G - 16, 1], [18, G - 17, 1], [19, G - 9, -1], [3, G - 5, 1], [12, G - 20, -1]]) g.px(x, y, GOLD[1]).px(x + d, y, INK).px(x, y - 1, "#F2FBFF");
  },
  // A pitfall: a pit ringed with dug earth, half hidden under a lattice of sticks and a few leaves; one stake shows. On frame 1 a stick sags and a leaf slips.
  (g, k, G) => {
    g.stamp((l) => {
      l.ell(11, G - 2, 10, 2.9, (nx, ny, x, y) => (ny > 0.55 || nx > 0.8 ? MUD[3] : nx * 0.6 + ny < -0.35 ? MUD[1] : rnd(x * 7.7 + y * 3.9) > 0.8 ? MUD[3] : MUD[2]));
      l.ell(11, G - 2, 8.3, 2, (nx, ny) => (ny < -0.5 ? STICK[3] : "#24160C"));
      l.px(6, G - 3, "#FFF6DF").px(5, G - 2, STICK[0]).px(6, G - 2, "#F0D9A8").px(7, G - 2, STICK[2]);
      // Three sticks lie from the far rim to the near one, and two across them; the nearer of those is the one that sags.
      for (const x of [10, 13, 16]) l.rect(x, G - 4, 1, 4, TIMBER[0]);
      l.px(17, G - 5, TIMBER[0]).px(16, G, TIMBER[1]).px(12, G, TIMBER[1]);
      l.rect(10, G - 4, 9, 1, "#F0D9A8");
      for (let x = 9; x <= 20; x++) l.px(x, G - 2 + (k && x > 11 && x < 16 ? 1 : 0), "#F0D9A8");
      l.px(14 + k, G - 3, LEAF[0]).px(15 + k, G - 3, LEAF[1]).px(17, G - 2, FALLEN[1]).px(18, G - 2, FALLEN[0]);
    }, INK);
  },
  // A watch bell: a bronze bell hung in a short timber frame under a shingled cap, a rope's end below it. Frame 1 is the bell swung, ringing.
  (g, k, G) => {
    g.stamp((l) => {
      for (const [x, a, b] of [[3, TIMBER[0], TIMBER[1]], [17, TIMBER[1], TIMBER[2]]]) l.rect(x, G - 12, 1, 13, a).rect(x + 1, G - 12, 1, 13, b);
      l.rect(3, G - 14, 16, 1, TIMBER[0]).rect(3, G - 13, 16, 1, TIMBER[2]).px(3, G - 13, TIMBER[1]).px(5, G - 12, TIMBER[2]).px(16, G - 12, TIMBER[3]);
      l.rect(2, G, 4, 1, MUD[2]).px(2, G, MUD[1]).rect(16, G, 4, 1, MUD[2]).px(19, G, MUD[3]);
    }, INK);
    g.stamp((l) => roof(l, 11, G - 18, 4, 3, 9, SHINGLE), INK);
    g.stamp((l) => {
      for (let y = G - 5; y <= G - 2; y++) l.px(10 - (k && y < G - 3 ? 1 : 0), y, (G - y) % 2 ? CLOTH[0] : CLOTH[1]);
      l.px(10, G - 1, CLOTH[2]);
    }, INK);
    g.stamp((l) => {
      l.rect(10, G - 12, 2, 1, BRONZE[3]);
      ["..lBBd..", "..lBBd..", ".lBBBBd.", ".lwBBBd.", ".lBBBBd.", "lBBBBBdd"].forEach((row, j) => chart(l, 7 + (k && j > 1 ? 1 : 0), G - 11 + j, [row], { l: BRONZE[0], B: BRONZE[1], d: BRONZE[2], w: "#FFF6C2" }));
      if (k) l.rect(8, G - 5, 2, 1, "#565C6C").px(8, G - 5, "#8C93A6");
    }, INK_GOLD);
    if (k) g.px(1, G - 9, "#FFF6DF").px(20, G - 10, "#FFF6DF").px(21, G - 8, "#FFF6DFB0").px(0, G - 7, "#FFF6DFB0");
  },
  // Caltrops: iron spikes strewn over a patch of trodden earth, each a four-pointed star with one point up, a few half trodden in. On frame 1 the light catches different ones.
  (g, k, G) => {
    // Where each star's middle is (its column, and how far over the ground line), then the tips of the buried ones.
    const STARS = [[5, 3], [10, 3], [16, 3], [3, 1], [8, 1], [14, 1], [18, 1]], BITS = [[12, 3], [11, 1], [6, 1]];
    const LIT = k ? [2, 5, 9] : [0, 4, 7];
    g.stamp((l) => {
      l.ell(11, G - 1, 9.2, 2.2, (nx, ny, x, y) => (ny > 0.5 ? MUD[2] : nx + ny * 2 < -0.9 ? MUD[0] : rnd(x * 7.7 + y * 3.9) > 0.9 ? MUD[0] : MUD[1]));
      STARS.forEach(([x, up], i) => l.px(x - 1, G - up, "#4A4F5C").px(x + 1, G - up, "#2E323C").px(x, G - up + 1, "#2E323C").px(x, G - up, "#565C6C").px(x, G - up - 1, LIT.includes(i) ? "#FFFFFF" : STEEL[1]));
      BITS.forEach(([x, up], i) => l.px(x, G - up + 1, "#2E323C").px(x, G - up, LIT.includes(i + STARS.length) ? "#FFFFFF" : STEEL[1]));
    }, INK);
  },
  // A stone thrower: a squat A-frame on a sled, a throwing arm with a cup at one end and a weight hung from the other. Frame 0 is cocked, frame 1 loosed.
  (g, k, G) => {
    // The cup's end of the arm, and the weight's.
    const [cx, cy] = k ? [16, G - 16] : [3, G - 5], [wx, wy] = k ? [9, G - 7] : [14, G - 12];
    g.stamp((l) => {
      l.rect(3, G - 1, 16, 1, TIMBER[0]).rect(3, G, 16, 1, TIMBER[2]).px(3, G - 1, "#F0D9A8").px(2, G - 1, TIMBER[1]).px(19, G - 1, TIMBER[1]).px(19, G - 2, TIMBER[0]);
      l.line(11, G - 10, 7, G - 2, TIMBER[0]).line(11, G - 10, 15, G - 2, TIMBER[2]).rect(9, G - 6, 5, 1, PLANK[1]);
    }, INK);
    g.stamp((l) => l.px(wx, wy + 1, CLOTH[1]).rect(wx - 1, wy + 2, 3, 3, PLANK[1]).rect(wx - 1, wy + 2, 1, 3, PLANK[0]).rect(wx + 1, wy + 2, 1, 3, PLANK[2]).rect(wx - 1, wy + 3, 3, 1, STEEL[2]).px(wx - 1, wy + 3, STEEL[1]), INK);
    g.stamp((l) => {
      l.line(cx, cy + 1, wx, wy + 1, TIMBER[2]).line(cx, cy, wx, wy, TIMBER[0]);
      l.rect(cx - 1, cy, 3, 1, PLANK[2]).px(cx - 1, cy - 1, PLANK[1]).px(cx + 1, cy - 1, PLANK[2]);
    }, INK);
    g.px(10, G - 10, STEEL[1]).px(11, G - 10, "#565C6C");
    if (!k) g.stamp((l) => l.rect(2, G - 8, 3, 3, STONE[1]).rect(2, G - 8, 2, 1, STONE[0]).px(2, G - 7, STONE[0]).rect(3, G - 6, 2, 1, STONE[3]).px(4, G - 7, STONE[2]), INK_STONE);
    // The rope that holds the arm down, and the same rope let go.
    if (k) g.px(4, G - 2, CLOTH[0]).px(5, G - 2, CLOTH[1]).px(6, G - 3, CLOTH[0]).px(18, G - 19, "#E8DCC0C0").px(20, G - 17, "#E8DCC090");
    else g.px(3, G - 3, CLOTH[0]).px(3, G - 2, CLOTH[1]);
  },
  // An archer's nest: a wicker-walled platform up on four thin poles, a ladder at its side, a quiver and a bow left leaning. The pennant turns on frame 1.
  (g, k, G) => {
    // The far poles and the braces are plain lines, so the daylight shows between them.
    g.rect(7, G - 11, 1, 11, PLANK[2]).rect(12, G - 11, 1, 11, PLANK[2]).line(5, G - 2, 14, G - 10, STICK[1]).line(14, G - 2, 5, G - 10, STICK[2]);
    g.stamp((l) => l.rect(4, G - 11, 1, 12, TIMBER[0]).rect(15, G - 11, 1, 12, TIMBER[1]), INK);
    g.stamp((l) => { for (let y = G - 12; y <= G; y++) { l.px(17, y, TIMBER[0]).px(19, y, TIMBER[1]); if ((G - y) % 2) l.px(18, y, "#C4904E"); } }, INK);
    g.stamp((l) => l.rect(4, G - 21, 1, 5, STICK[1]).px(4, G - 21, STICK[0]), INK);
    g.stamp((l) => {
      l.px(7, G - 18, "#FFFFFF").px(8, G - 18, RED[1]).rect(7, G - 17, 2, 1, "#8A4A2A").px(7, G - 17, "#B06A3A");
      l.px(12, G - 20, "#D8A468").px(13, G - 19, "#D8A468").rect(14, G - 18, 1, 2, "#B07A4A").rect(11, G - 20, 1, 4, "#FFF6DF");
    }, INK);
    g.stamp((l) => {
      for (let y = G - 16; y <= G - 14; y++) for (let x = 3; x <= 16; x++) l.px(x, y, x === 3 ? THATCH[0] : x === 16 ? THATCH[3] : y === G - 16 ? ((x & 1) ? THATCH[0] : THATCH[1]) : ((x + y) & 1) ? THATCH[1] : THATCH[2]);
      l.rect(3, G - 13, 14, 1, TIMBER[0]).rect(3, G - 12, 14, 1, TIMBER[2]).px(3, G - 12, TIMBER[1]);
    }, INK);
    g.stamp((l) => (k ? l.rect(1, G - 21, 3, 1, RED[0]).rect(2, G - 20, 2, 1, RED[1]).px(3, G - 19, RED[2]) : l.rect(5, G - 21, 3, 1, RED[0]).rect(5, G - 20, 2, 1, RED[1]).px(5, G - 19, RED[2])), INK);
  },
  // A dread totem: a post of dark wood carved into a scowling face, horned, hung with feathers and bones. On frame 1 its red eyes burn brighter.
  (g, k, G) => {
    g.stamp((l) => {
      chart(l, 8, G - 17, [
        ".pPPd.", "pPPPPd", "pPPPPd", "kkPPkk", "pkkkkd", "peDDed", "pPDDPd", "pPPPPd", "pkkkkd", "pwkkwd", "pPPPPd", "cCcCcC", "pPPPPd", "pPDPPd", "pPPDPd", "pPPPPd", "pPPPPd", "pPPPPd"
      ], { p: PLANK[0], P: PLANK[1], d: PLANK[2], D: PLANK[2], k: PLANK[3], w: "#F0D9A8", e: k ? "#FF5A4A" : "#B01E30", c: CLOTH[1], C: CLOTH[2] });
      // The horns, base to tip.
      [[7, 16], [6, 17], [5, 18], [5, 19], [6, 20]].forEach(([x, up], i) => l.px(x, G - up, CLOTH[i < 2 ? 2 : i < 4 ? 1 : 0]).px(21 - x, G - up, CLOTH[i < 3 ? 2 : 1]));
      // Two feathers on the left of the cord, two bones on the right.
      l.px(7, G - 6, CLOTH[1]).px(6, G - 6, CLOTH[2]).px(14, G - 6, CLOTH[1]).px(15, G - 6, CLOTH[2]);
      l.rect(7, G - 5, 1, 2, RED[1]).px(7, G - 3, "#FFFFFF").px(6, G - 5, "#3A3F4B").px(6, G - 4, "#FFFFFF");
      l.rect(14, G - 5, 1, 3, "#FFF6DF").px(14, G - 3, CLOTH[1]).px(15, G - 5, "#FFF6DF").px(15, G - 4, CLOTH[1]);
      l.rect(7, G, 8, 1, MUD[2]).px(7, G, MUD[1]);
    }, INK);
    if (k) for (const x of [9, 12]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.px(x + dx, G - 12 + dy, "#FF3A3070");
    g.px(6, G, MOSS[1]).px(7, G - 1, MOSS[0]).px(7, G, MOSS[2]);
  }
];
const work = {
  w: 22, h: 24, frames: 2,
  draw(g, f, o) {
    WORKS[level(o, WORKS.length - 1)](g, ((Math.round(f) % 2) + 2) % 2, 22);
  }
};

// ---------------------------------------------------------------- named blades
/** Each blade: its picture from row 1 and its colours, or `cut` to draw it; its outline; `under` and
 `over` for a glow behind it and glints on it. */
const BLADES = [
  { // Thornwhip: linked segments, the far half coiled like a whip
    ink: INK_STONE,
    cut(l) {
      const JOINT = "#4E5566", THORN = "#D8E8B0";
      for (let y = 7; y <= 11; y++) l.px(3, y, y === 9 ? JOINT : STONE[0]).px(4, y, y === 9 ? JOINT : STONE[2]);
      [[4, 6], [4, 5], [5, 4], [6, 3], [7, 2], [8, 2], [9, 3], [10, 4], [10, 5], [10, 6], [9, 7], [8, 8], [7, 8]].forEach(([x, y], i) => l.px(x, y, i % 3 === 2 ? JOINT : i % 3 ? STONE[2] : STONE[0]));
      l.px(2, 8, THORN).px(5, 10, THORN).px(3, 5, THORN).px(8, 1, THORN);
      l.rect(1, 12, 6, 1, "#B88A3A").px(1, 12, "#E0B860").rect(5, 12, 2, 1, "#8A6424").px(3, 13, "#3F7A4E").px(4, 13, "#28583A").px(3, 14, "#B88A3A").px(4, 14, "#8A6424");
    }
  },
  { // The Maker's Tooth: a curved knife of milky white tooth, a plain grip
    ink: INK, key: { w: "#FFFFFF", W: "#F6F0DC", t: "#D8CDB0", c: "#E8D4A0", C: "#C9AE74", h: "#A8743E", H: "#7E5228", d: "#573518" },
    rows: ["..........w.", "........wWt.", ".......wWt..", "......wWWt..", ".....wWWt...", ".....wWWt...", "....wWWt....", "....wWWt....", "...cCc......", "...hHd......", "..hHd.......", "..hHd.......", ".hHd........", ".dd........."]
  },
  { // Winterglass: a very wide greatsword of smoke-dark rippled steel
    ink: INK_STONE, key: { l: "#A0A9B7", d: "#7A8296", D: "#4E5566", k: "#2E3340", g: "#7E8698", G: "#565C6C", x: "#3A3F4B", h: "#5E3A1F", H: "#3A2410", p: "#7E8698" },
    rows: [".....lk.....", "....lDDk....", "...ldDDDk...", "...lDdDDk...", "...lDDdDk...", "...lDDDdk...", "...ldDDDk...", "...lDdDDk...", "...lDDdDk...", "..gGGGGGGx..", ".....hH.....", ".....hH.....", ".....hH.....", "....pGGx...."]
  },
  { // Longfang: a hand-and-a-half sword, its pale pommel carved as a fox's head
    ink: INK_STONE, key: { s: "#F4F7FB", S: STONE[1], g: "#C8A050", G: "#A07A30", x: "#7A5A20", h: "#7A3E22", H: "#4E2A16", W: "#FFFDF0", w: "#E0D8C0", n: "#3A2410" },
    rows: [".....s......", ".....sS.....", ".....sS.....", ".....sS.....", ".....sS.....", ".....sS.....", ".....sS.....", "...gGGGGx...", ".....hH.....", ".....hH.....", ".....hH.....", "....W..w....", "....WWWw....", ".....nn....."]
  },
  { // Needlewise: a short, very slender quick sword
    ink: INK_STONE, key: { s: "#F4F7FB", S: STONE[1], g: "#8FB0E0", G: "#5578B0", h: "#5E3A1F", p: STONE[0] },
    rows: ["............", "............", "......s.....", "......s.....", "......s.....", "......s.....", "......s.....", "......S.....", "......S.....", "........g...", "....gGGGG...", "....G.h.....", "......h.....", "......p....."]
  },
  { // Dawnsplitter: a pale greatsword that seems to glow, warm white with a gold edge
    ink: INK_GOLD, key: { y: GOLD[1], Y: GOLD[0], W: "#FFFFFF", w: "#FFF6DF", d: GOLD[2], g: GOLD[1], G: GOLD[2], x: "#A87400", c: "#FFF6DF", C: "#D8CCB0" },
    rows: [".....Yy.....", "....yWwd....", "....yWwd....", "....yWwd....", "....yWwd....", "....yWwd....", "....yWwd....", "....yWwd....", "....yWwd....", "..YgggGGGx..", ".....cC.....", ".....cC.....", ".....cC.....", "....YgGx...."],
    under: (g) => g.ell(6, 5.5, 5.4, 6.4, "#FFE36B30").ell(6, 5.5, 3.6, 5.6, "#FFF3B040"),
    over: (g) => g.px(2, 3, "#FFFFFF").px(9, 1, "#FFFFFF").px(10, 6, "#FFF6C2")
  },
  { // Undertow: a leaf-shaped bronze short sword, sea-green on the grip, a pen's cap for a pommel
    ink: INK, key: { l: "#FFE0A0", B: "#D69A4E", d: "#9A6228", g: "#B87A34", x: "#7A4E1E", t: "#5FD0C8", T: "#1FA0A0", y: GOLD[1], C: "#35507F", c: "#5578B0" },
    rows: ["......l.....", ".....lBd....", ".....lBd....", "....lBBBd...", "....lBBBd...", "....lBBBd...", ".....lBd....", ".....lBd....", "....gggxx...", "......t.....", "......T.....", ".....yyy....", "......Cy....", "......c....."]
  },
  { // The Songbird Bow: a slim recurve of pale wood, strung, an arrow laid across it, a bird charm at the grip
    ink: INK,
    cut(l) {
      [7, 6, 7, 8, 9, 9, 9, 9, 9, 9, 8, 7, 6, 7].forEach((x, j) => l.px(x, 1 + j, j < 7 ? "#F6E6C0" : "#D4B884"));
      l.rect(9, 7, 1, 2, "#8A5A34").rect(3, 6, 8, 1, STICK[0]).px(2, 6, RED[1]).px(1, 6, RED[0]).px(1, 5, RED[1]).px(1, 7, RED[2]).px(10, 6, STONE[1]).px(11, 6, STONE[0]);
      l.px(10, 11, BLUE[1]).px(9, 12, BLUE[2]).px(10, 12, BLUE[1]).px(11, 11, GOLD[1]).px(10, 10, "#C9AE74");
    },
    over: (g) => { for (let y = 3; y <= 12; y++) if (y !== 6) g.px(5, y, "#FFFFFF"); }
  },
  { // The Ashglass knives: a crossed pair of short daggers of dark glass, glinting
    ink: INK_STONE,
    cut(l) {
      for (const way of [1, -1]) {
        const at = (x) => (way > 0 ? x : 11 - x);
        for (let i = 0; i < 7; i++) l.px(at(9 - i), 3 + i, i < 2 ? "#C4CCD8" : i < 5 ? "#8C93A6" : "#6A7080").px(at(9 - i), 4 + i, way > 0 ? "#4E5566" : "#3A3F4B");
        l.px(at(2), 8, STEEL[2]).px(at(4), 11, STEEL[2]).px(at(3), 11, STEEL[1]).px(at(2), 11, "#5E3A1F").px(at(2), 12, "#5E3A1F").px(at(1), 12, "#3A2410").px(at(1), 13, "#3A2410").px(at(1), 14, STEEL[1]);
      }
    },
    over: (g) => g.px(9, 3, "#FFFFFF").px(2, 3, "#FFFFFF").px(7, 5, "#FFFFFFC0").px(10, 1, "#FFFFFFA0").px(10, 2, "#FFFFFF").px(11, 2, "#FFFFFFA0").px(9, 2, "#FFFFFFA0")
  }
];
const blade = {
  w: 12, h: 16,
  draw(g, f, o) {
    const B = BLADES[level(o, BLADES.length - 1)];
    if (B.under) B.under(g);
    g.stamp((l) => (B.cut ? B.cut(l) : chart(l, 0, 1, B.rows, B.key)), B.ink);
    if (B.over) B.over(g);
  }
};

// ---------------------------------------------------------------- the lookout's two paths
/** Both stand on `tower`'s foot and keep its gallery: the floor a figure would stand on is where the
 lookout's is at levels 3, 4 and 5, and the top is as high. */
const WATCH_FLOOR = [26, 21, 22];
const WHITE = ["#FFFFFF", "#EEF1F6", "#CBD3DF", "#A3AEBF"];
const CAP = ["#D6E6FA", "#9DBCE6", "#6A8CC4", "#4A6AA0"];
/** White stone, clean: lit down the left, shaded down the right, a faint course every third row. */
const marble = (l, x, y, w, h) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) l.px(x + i, y + j, i === 0 ? WHITE[0] : i === w - 1 ? WHITE[3] : i === w - 2 ? WHITE[2] : j % 3 === 2 ? "#DDE3EC" : i === 1 ? WHITE[0] : WHITE[1]);
  return l;
};
const spire = {
  w: 22, h: 44,
  draw(g, f, o) {
    const n = level(o, 2), G = 42, floor = WATCH_FLOOR[n];
    // The shaft, in tiers that narrow as they rise: [left, width, top row, bottom row], a ledge under each but the lowest.
    const TIERS = [[[6, 10, 34, 40], [7, 8, 28, 32]], [[5, 12, 35, 40], [6, 10, 28, 33], [7, 8, 23, 26]], [[5, 12, 35, 40], [6, 10, 29, 33], [7, 8, 24, 27]]][n];
    g.stamp((l) => {
      l.rect(4, G - 1, 14, 2, WHITE[2]).rect(4, G - 1, 14, 1, WHITE[1]).px(4, G - 1, WHITE[0]).rect(16, G, 2, 1, WHITE[3]);
      TIERS.forEach(([x, w, top, bottom], i) => {
        marble(l, x, top, w, bottom - top + 1);
        if (i) l.rect(x - 1, bottom + 1, w + 2, 1, n === 2 ? GOLD[1] : WHITE[0]).px(x + w, bottom + 1, n === 2 ? GOLD[2] : WHITE[2]);
        if (i) l.rect(10, top + 1, 2, Math.min(3, bottom - top - 1), SLATE[2]).px(10, top + 1, SLATE[1]);
      });
    }, INK_STONE);
    g.stamp((l) => door(l, 9, G - 5, 4, 6, SLATE, GOLD[1]), INK_STONE);
    // The gallery: a floor on the shaft, a low wall with four merlons, two slim columns.
    const under = n === 0 ? 17 : 12, tall = floor - 5 - under;
    g.stamp((l) => { for (const x of [4, 16]) l.rect(x, under + 1, 2, tall, WHITE[1]).rect(x, under + 1, 1, tall, WHITE[0]); l.rect(17, under + 1, 1, tall, WHITE[2]); }, INK_STONE);
    g.stamp((l) => {
      marble(l, 3, floor - 3, 16, 3);
      for (const x of [3, 7, 13, 17]) l.rect(x, floor - 4, 2, 1, WHITE[0]);
      l.rect(2, floor, 18, 2, WHITE[1]).rect(2, floor, 18, 1, WHITE[0]).rect(2, floor + 1, 18, 1, n === 2 ? GOLD[1] : WHITE[2]).px(19, floor, WHITE[2]);
    }, INK_STONE);
    // Over it: a blue cap; at the last level a lamp room stands between the two.
    const lamp = n === 2 ? 3 : under - 6;
    if (n === 2) {
      g.stamp((l) => l.rect(3, 12, 16, 1, WHITE[0]).px(18, 12, WHITE[2]), INK_STONE);
      g.stamp((l) => { marble(l, 8, 9, 6, 3); l.rect(10, 9, 2, 2, "#FFD27A").px(10, 9, "#FFF6C2"); }, INK_STONE);
      g.stamp((l) => roof(l, 11, 6, 3, 1, 5, CAP).rect(6, 8, 10, 1, GOLD[1]).px(6, 8, GOLD[0]).rect(14, 8, 2, 1, GOLD[2]), INK_STONE);
    } else g.stamp((l) => roof(l, 11, under - 3, 4, 1, 9, CAP), INK_STONE);
    // The beacon, and a pennant on its finial.
    g.ell(11, lamp + 1.5, n === 2 ? 5.6 : 4.2, n === 2 ? 5.2 : 4, n === 2 ? "#FFE36B48" : "#FFE36B30");
    if (n === 2) g.ell(11, lamp + 1.5, 3.4, 3.2, "#FFF3B050");
    g.stamp((l) => l.px(11, lamp - 1, GOLD[1]), INK_GOLD);
    banner(g, 12, lamp - 1, n === 2 ? 6 : 5, 3, BLUE);
    g.stamp((l) => l.rect(10, lamp, 2, 3, GOLD[1]).px(10, lamp, GOLD[0]).rect(10, lamp + 1, 2, 1, n === 2 ? "#FFFFFF" : "#FFF6C2").px(11, lamp + 2, GOLD[2]), INK_GOLD);
    if (n === 2) g.px(8, lamp + 1, "#FFFFFFC0").px(13, lamp + 1, "#FFFFFFC0").px(11, lamp + 4, "#FFF6C2");
  }
};

const BASALT = ["#77708A", "#4E485E", "#383444", "#27242F"];
const DARK_INK = "#0E0C14";
/** Basalt, in columns: seams run down it, not across. */
const basalt = (l, x, y, w, h) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) l.px(x + i, y + j, i === 0 ? BASALT[0] : i === w - 1 ? BASALT[3] : (i + x) % 3 === 2 ? BASALT[2] : rnd((x + i) * 7.1 + (y + j) * 13.3) > 0.9 ? BASALT[0] : BASALT[1]);
  return l;
};
const darkwatch = {
  w: 22, h: 44,
  draw(g, f, o) {
    const n = level(o, 2), G = 42, floor = WATCH_FLOOR[n];
    const TIERS = [[[6, 10, 34, 40], [7, 8, 28, 33]], [[5, 12, 35, 40], [6, 10, 28, 34], [7, 8, 23, 27]], [[5, 12, 35, 40], [6, 10, 29, 34], [7, 8, 24, 28]]][n];
    // The shaft: each tier ends in a pair of fangs where the white tower has a ledge.
    g.stamp((l) => {
      l.rect(4, G - 1, 14, 2, BASALT[2]).rect(4, G - 1, 14, 1, BASALT[1]).px(4, G - 1, BASALT[0]).rect(16, G, 2, 1, BASALT[3]).px(4, G - 2, BASALT[0]).px(17, G - 2, BASALT[3]);
      TIERS.forEach(([x, w, top, bottom], i) => {
        basalt(l, x, top, w, bottom - top + 1);
        if (i) l.px(x - 1, bottom, BASALT[0]).px(x - 1, bottom - 1, BASALT[0]).px(x + w, bottom, BASALT[3]).px(x + w, bottom - 1, BASALT[3]);
        if (i) l.rect(10 + (i % 2), top + 1, 1, 3, FIRE.o).px(10 + (i % 2), top + 1, FIRE.Y);
      });
    }, DARK_INK);
    g.stamp((l) => door(l, 9, G - 5, 4, 6, ["#6A3A3A", "#4A2630", "#2E1820"], FIRE.o), DARK_INK);
    // The gallery: a toothed wall, two piers, and across them the crown the horns stand on.
    const crown = n === 0 ? 16 : 11;
    g.stamp((l) => { for (const x of [3, 16]) basalt(l, x, crown + 2, 3, floor - crown - 5); }, DARK_INK);
    g.stamp((l) => {
      basalt(l, 3, floor - 3, 16, 3);
      for (const x of [3, 5, 7, 14, 16, 18]) l.px(x, floor - 4, x < 10 ? BASALT[0] : BASALT[2]);
      l.rect(2, floor, 18, 2, BASALT[1]).rect(2, floor, 18, 1, BASALT[0]).rect(2, floor + 1, 18, 1, BASALT[3]).px(2, floor + 2, BASALT[1]).px(19, floor + 2, BASALT[3]);
    }, DARK_INK);
    // The light, and its glow on the stone.
    const r = [2, 2.2, 3][n], cy = n === 2 ? 6 : crown - r;
    g.ell(11, cy, r + 4, r + 3.6, "#FF8A2A26").ell(11, cy, r + 2, r + 1.8, "#FFB03A38");
    g.stamp((l) => {
      l.rect(3, crown, 16, 2, BASALT[1]).rect(3, crown, 16, 1, BASALT[0]).rect(13, crown, 6, 1, BASALT[1]).rect(3, crown + 1, 16, 1, BASALT[3]);
      // Two horns, rising from the ends of the crown and bending in.
      const L = [5, 6, 10][n];
      for (let i = 0; i < L; i++) {
        const t = i / (L - 1), dx = Math.round((n === 2 ? 3 : 2) * t * t), wide = t < 0.45 ? 2 : 1, y = crown - 1 - i;
        l.rect(3 + dx, y, wide, 1, BASALT[1]).px(3 + dx, y, BASALT[0]).rect(19 - dx - wide, y, wide, 1, BASALT[2]).px(18 - dx, y, BASALT[3]);
      }
      if (n === 2) l.rect(9, crown - 2, 4, 2, BASALT[1]).rect(10, crown - 3, 2, 1, BASALT[1]).px(9, crown - 2, BASALT[0]).rect(12, crown - 2, 1, 2, BASALT[3]);
    }, DARK_INK);
    g.stamp((l) => l.ell(11, cy, r, r, (nx, ny) => { const d = nx * nx + ny * ny; return d < 0.16 ? FIRE.W : d < 0.5 ? (nx + ny < 0 ? FIRE.y : FIRE.Y) : nx + ny > 0.5 ? FIRE.r : FIRE.o; }), "#7A2A0A");
    g.px(11, Math.round(cy - r) - 2, FIRE.o).px(10, Math.round(cy - r) - 1, FIRE.Y);
    if (n === 2) g.px(12, Math.round(cy - r) - 3, "#FF8A2AC0").px(7, cy, "#FFE36BC0").px(14, cy - 1, "#FFE36BC0");
  }
};

// ---------------------------------------------------------------- raiders on foot
/** Each foe: its picture, whose last row sits on row 14, and two legs under it; `held` is drawn
 with it and `front` laid over it. `walk` replaces the legs, `dip` the rise and fall of the body. */
const FOES = [
  { // A Mudtusk: squat and hunched, small tusks, a club over the shoulder
    y: 5, legs: [5, 9], leg: "#566848", shoe: "#3A2410",
    key: { g: "#A9BA90", G: "#7E9068", d: "#566848", J: "#A8743E", j: "#7E5228", s: "#573518", y: GOLD[1], t: "#FFFFFF", e: EYE },
    rows: ["....gGGGG.......", "...gGGGGGgGGG...", "..gJJJJGgGGyGG..", "..jJJJJJgGGGGGG.", "..jJJsJJGGtGGtd.", "..jJJJJJGdddddd.", "...jJJJJJGG.....", "...jJJsJJgG.....", "...jJJJJJd......", "....jjdjjd......"],
    held(l, k, y) {
      const up = k === 1 || k === 2 ? 1 : 0;
      l.px(6, y - up, STICK[2]).px(5, y - 1 - up, STICK[1]).px(4, y - 2 - up, STICK[1]).rect(2, y - 4 - up, 3, 2, STICK[1]).rect(2, y - 4 - up, 3, 1, STICK[0]).px(3, y - 3 - up, STONE[0]);
    }
  },
  { // One of the Gilded: tall and proud in gold plate, a short cape, a slim blade held high
    y: 1, legs: [5, 8], leg: GOLD[1], shoe: GOLD[2],
    key: { y: GOLD[0], Y: GOLD[1], d: GOLD[2], D: "#A87400", K: FACE, e: EYE, c: "#FFFFFF", C: "#DCE4EE", x: "#AEB8C8", r: RED[1] },
    rows: ["......rr........", ".....yYYYd......", "....yYYYYYd.....", "....YYKKKeK.....", "....dYKKKKK.....", ".....dKKKK......", "..cCyYYYYYYYYK..", ".cCCyYYdYYd.....", ".cCCyYYYYYd.....", ".cCx.dYYYd......", "..cx.DDDDD......", ".....yYYYYd.....", ".....yYdYYd.....", ".....yY..Yd....."],
    held(l, k, y) {
      l.rect(12, y + 5, 3, 1, GOLD[1]).px(14, y + 5, GOLD[2]).rect(13, y, 1, 5, STEEL[0]).px(13, y + 4, STEEL[1]);
      if (k === 3) l.px(1, y + 10, "#DCE4EE").px(0, y + 9, "#FFFFFF");
    }
  },
  { // One of the Stumbling: slumped, ragged, the arms hanging forward, one shoe
    y: 4, dip: [0, 0, 1, 0], ink: INK,
    key: { H: "#5E5648", K: "#C2D2B0", k: "#93A586", e: EYE, r: "#A8987E", R: "#7E6E5A", d: "#5A4E40" },
    rows: [".......HHH.H....", "......HKKKKK....", "......KKKeKK....", "......kKKKKk....", ".....rRRkKk.....", "....rRRRRRKK....", "....rRRRRd.KK...", "....rRdRRd..K...", "....rRRRRd..k...", "....rR.RRd......", "....r..R.d......"],
    walk(l, F, k) {
      const back = [4, 5, 6, 5][k], fore = [9, 9, 9, 10][k];
      l.px(back + 1, 15, "#7E6E5A").rect(back, 16, 2, 1, "#3A2410").px(fore, 15, "#93A586").rect(fore, 16, 2, 1, "#C2D2B0");
    }
  },
  { // A Frostwight: tall and thin, long white hair, ice-blue eyes, armour rimed with frost, a shard of ice for a sword
    y: 1, legs: [5, 8], leg: "#4A4F5C", shoe: "#34384A", ink: INK_STONE,
    key: { W: "#FFFFFF", w: "#D4DCE8", K: "#D6EAF6", k: "#A8C8E0", e: "#19A8F0", a: "#7A8296", A: "#4A4F5C", x: "#34384A", f: "#F2FAFF" },
    rows: [".....WWWW.......", "....WWWWWW......", "....WWKKKK......", "...WWWKKeK......", "...wWWKKKKK.....", "...wWW.kKK......", "...wWfaAAf......", "..wWWaAAAAaK....", "..wW.aAxAA......", "..w..fAAAx......", ".....aAxAx......", ".....aAAfx......", ".....aA.Ax......", ".....a..A......."],
    held(l, k, y) {
      [[12, 6], [12, 5], [13, 4], [13, 3], [14, 2], [14, 1]].forEach(([x, dy], i) => l.px(x, y + dy, i < 2 ? "#9FD8F0" : "#DFF6FF"));
      l.px(13, y + 5, "#9FD8F0").px(11, y + 8, "#D6EAF6");
    },
    front(g, k, y) {
      const at = [[2, 3], [1, 5], [0, 7], [3, 1]][k], and = [[1, 11], [3, 12], [2, 13], [0, 10]][k];
      g.px(at[0], y + at[1], "#FFFFFF").px(and[0], y + and[1], "#BDEBFF");
    }
  },
  { // Rattlenut, the great red squirrel who carries gossip up and down the oak and helps himself on the way. He bounds:
    // stretched out on frames 0 and 2 (off his hind feet, then onto his front ones), gathered up on 1 and 3, an acorn held to his chest.
    draw(g, k) {
      const long = k % 2 === 0, late = k > 1 ? 1 : 0, CREAM = ["#FFF0D0", "#EDD9A6"];
      const fur = (nx, ny, x, y) => { const s = nx * 0.7 + ny; return s < -0.5 ? FOX.r : s > 0.55 ? FOX.d : rnd(x * 12.9 + y * 78.2) > 0.9 ? FOX.r : FOX.R; };
      // The tail is most of him: streaming out behind when he is stretched, arched over his back when he is gathered.
      const TAIL = long ? [[4.4, 10.4 - late * 0.6, 2.6, 2], [3.2, 8.6 - late, 2.6, 2.5], [2.9, 6.2 - late, 2, 1.9]] : [[3.7, 13, 1.7, 1.7], [3, 10.4, 2.2, 2.4], [4, 7.3 - late, 2.4, 2.2], [6.3, 5.6 - late, 2.1, 1.8]];
      g.stamp((l) => TAIL.forEach(([x, y, a, b]) => l.ell(x, y, a, b, fur)), INK);
      const hx = long ? 12.2 : 11.4, hy = long ? 9.8 : 9.2 + late;
      g.stamp((l) => {
        if (long) {
          // Hind legs thrown back, forelegs reaching: he is off his hind feet on frame 0 and onto his front ones on 2.
          l.line(5, 13, late ? 2 : 3, late ? 14 : 16, FOX.d).px(late ? 1 : 2, late ? 14 : 16, FOX.d).line(11, 13, 13, late ? 16 : 14, FOX.R).px(14, late ? 16 : 14, FOX.r);
          l.ell(8.4, 12, 3.8, 2.3, (nx, ny, x, y) => (ny > 0.4 && nx > -0.5 ? CREAM[nx > 0.3 ? 0 : 1] : fur(nx, ny, x, y)));
          l.ell(5.3, 12.6, 1.7, 1.6, fur);
        } else {
          l.ell(7.6, 12, 3.3, 3.3, (nx, ny, x, y) => (nx > 0.35 && ny > -0.5 ? CREAM[ny > 0.4 ? 1 : 0] : fur(nx, ny, x, y)));
          l.rect(6, 16, 3, 1, FOX.d).px(6, 16, FOX.R).px(10, 15, FOX.R).rect(10 + late, 16 - late, 2, 1, FOX.r);
        }
        l.ell(hx, hy, 2.4, 2.2, fur).px(Math.round(hx - 1.2), Math.round(hy - 3.3), FOX.d).px(Math.round(hx + 0.8), Math.round(hy - 3.3), FOX.R);
        // The bulging cheek, the eye, the nose.
        l.ell(hx + 0.6, hy + 1.4, 1.3, 1.1, (nx, ny) => CREAM[ny > 0.2 ? 1 : 0]);
        l.px(Math.round(hx + 0.8), Math.round(hy - 0.8), FOX.e).px(Math.round(hx + 1.8), Math.round(hy + 0.2), FOX.n);
      }, INK);
      g.stamp((l) => acornBit(l, long ? 10 : 10, long ? 13 : 12 + late), INK);
    }
  },
  { // Fizzwick, a cross loaf of mossy bread on four stubby feet, a twig for a fuse sprouting from his head. He waddles:
    // feet apart on frames 0 and 2, together and himself a pixel up on 1 and 3. The twig's tip is at (7, 2) on frame 0.
    draw(g, k) {
      const y = 6 - (k % 2), EYE_GREEN = "#17261E";
      // Where the four feet stand, the near pair first.
      const FEET = [[2, 12, 6, 9], [3, 10, 5, 12], [4, 10, 2, 12], [3, 10, 6, 12]][k];
      g.stamp((l) => {
        FEET.forEach((x, i) => l.rect(x, y + 9, 2, 17 - y - 9, i < 2 ? MOSS[2] : MOSS[3]).px(x, y + 9, i < 2 ? MOSS[1] : MOSS[3]));
        for (let j = 0; j < 9; j++) {
          const inset = j === 0 ? 2 : j === 1 || j === 8 ? 1 : 0;
          for (let x = 2 + inset; x <= 13 - inset; x++) {
            const r = rnd(x * 12.9 + j * 78.2);
            l.px(x, y + j, j === 8 || x >= 13 - inset ? MOSS[2] : j === 0 || x === 2 + inset ? MOSS[0] : x === 12 - inset ? MOSS[2] : j === 1 ? MOSS[0] : MOSS[1]);
          }
        }
        // Two square eyes, brows that go up in the middle, a small frown.
        l.rect(7, y + 3, 2, 2, EYE_GREEN).rect(10, y + 3, 2, 2, EYE_GREEN).px(7, y + 3, "#FFFFFF").px(10, y + 3, "#FFFFFF");
        l.px(6, y + 2, EYE_GREEN).px(7, y + 1, EYE_GREEN).px(12, y + 2, EYE_GREEN).px(11, y + 1, EYE_GREEN).px(3, y + 3, MOSS[0]).px(4, y + 2, MOSS[0]).px(4, y + 5, MOSS[2]).px(3, y + 6, MOSS[2]);
        l.px(9, y + 6, EYE_GREEN).px(10, y + 6, EYE_GREEN).px(8, y + 7, EYE_GREEN).px(11, y + 7, EYE_GREEN);
        // The twig, and its one leaf, which flaps as he goes.
        l.rect(6, y - 3, 1, 3, STICK[1]).px(6, y - 1, STICK[2]).px(7, y - 4, STICK[0]);
        [[[7, 2], [8, 3], [8, 2]], [[7, 2], [8, 3], [9, 4]], [[7, 2], [8, 3], [8, 2]], [[7, 2], [8, 2], [9, 2]]][k].forEach(([x, up], i) => l.px(x, y - up, i ? LEAF[0] : LEAF[1]));
      }, INK);
    }
  }
];
/** Two legs on rows 15 and 16; on frames 1 and 3 the body has dipped onto them. */
const tread = (l, F, k) => {
  const [a, b] = F.legs;
  if (k % 2) return void l.rect(a, 16, 2, 1, F.shoe).rect(b, 16, 2, 1, F.shoe);
  l.px(a + (k ? 1 : 0), 15, F.leg).px(b - (k ? 1 : 0), 15, F.leg);
  l.rect(a + (k ? 1 : -1), 16, 2, 1, F.shoe).rect(b - (k ? 1 : 0), 16, 2, 1, F.shoe);
};
const foe = {
  w: 16, h: 18, frames: 4,
  draw(g, f, o) {
    // A walk facing right, as the heroes walk: stride, dip, the other stride, dip.
    const k = ((Math.round(f) % 4) + 4) % 4, F = FOES[level(o, FOES.length - 1)], y = F.y + (F.dip ? F.dip[k] : k % 2);
    // The squirrel and the loaf are not built like the rest: they draw themselves.
    if (F.draw) return void F.draw(g, k);
    g.stamp((l) => {
      (F.walk || tread)(l, F, k);
      chart(l, 0, y, F.rows, F.key);
      if (F.held) F.held(l, k, y);
    }, F.ink || INK);
    if (F.front) F.front(g, k, y);
  }
};

/** The colour the sky is at its very top, for where there is more sky above the picture than the picture has: 0 to 3 by day, 4 to 7 by night. */
const skytop = {
  w: 1, h: 1,
  draw(g, f, o) {
    const v = level(o, 7), D = SEASONS[v % 4];
    g.px(0, 0, v > 3 ? D.night[0] : D.sky[0]);
  }
};

/** The colour the grass is at the very foot of the picture, for where there is more ground below it than the picture has: 0 to 3 by day, 4 to 7 by night. */
const groundend = {
  w: 1, h: 1,
  draw(g, f, o) {
    const v = level(o, 7), D = SEASONS[v % 4], S = v > 3 ? byNight(D) : D;
    g.px(0, 0, S.grass[3]);
  }
};

/** The garden's bed by the burrow: 0 dug and empty, 1 with something growing, 2 with something ripe. */
const gardenbed = {
  w: 24, h: 14,
  draw(g, f, o) {
    const v = level(o, 2);
    g.rect(1, 7, 22, 6, "#5A3D25").rect(0, 6, 24, 1, "#9A6F42").rect(0, 13, 24, 1, "#3E2A18");
    g.rect(0, 7, 1, 6, "#9A6F42").rect(23, 7, 1, 6, "#6E4C2C");
    for (let k = 0; k < 3; k++) g.rect(2, 8 + k * 2, 20, 1, "#6B4A2E");
    if (v === 0) {
      g.px(5, 8, "#84CA60").px(13, 10, "#84CA60").px(19, 8, "#84CA60");
      return;
    }
    for (let k = 0; k < 5; k++) {
      const x = 3 + k * 4 + (k % 2);
      g.rect(x, 5, 1, 3, "#4E8E3E").px(x - 1, 5, "#84CA60").px(x + 1, 4, "#84CA60");
      if (v > 1 && k % 2 === 0) g.rect(x - 1, 2, 3, 2, "#FFD86B").px(x, 1, "#FFF2A8").px(x, 3, "#E08A2C").px(x, 4, "#4E8E3E");
    }
  }
};

// ---------------------------------------------------------------- the guardians' signposts
/** The stake every signpost but the stump stands on: from row `top` down to the ground, a little mud at its foot. */
const signStake = (l, top, G) => l.rect(6, top, 2, G - top + 1, STICK[1]).rect(6, top, 1, G - top + 1, STICK[0]).rect(5, G, 4, 1, MUD[2]).px(5, G, MUD[1]);
const SIGNPOSTS = [
  // The ranger's: a round straw target with an arrow in the gold, a pennant the green of his cloak.
  (g, G) => {
    g.stamp((l) => signStake(l, G - 6, G), INK);
    g.stamp((l) => l.rect(4, G - 5, 2, 1, "#A3B394").rect(2, G - 4, 4, 1, "#748A6C").rect(4, G - 3, 2, 1, "#506350"), INK);
    g.stamp((l) => {
      chart(l, 3, G - 14, ["..sSSd..", ".sRRRRd.", "sRRwwRRd", "SRwyywRd", "SRwyYwRd", "SRRwwRRd", ".dRRRRd.", "..dddd.."], { s: THATCH[0], S: THATCH[1], d: THATCH[2], R: RED[1], w: "#FFF6DF", y: GOLD[1], Y: GOLD[2] });
      l.px(8, G - 12, STICK[2]).px(9, G - 13, STICK[2]).px(10, G - 14, STICK[1]).px(11, G - 15, STICK[1]).px(10, G - 15, "#FFFFFF").px(11, G - 14, "#FFFFFF");
    }, INK);
  },
  // The watchman's: a lit lantern on an iron bracket, a strip of his black cloak tied under it.
  (g, G) => {
    g.stamp((l) => {
      signStake(l, G - 14, G).rect(6, G - 14, 2, 1, "#F0D9A8");
      l.rect(8, G - 13, 3, 1, "#565C6C").px(8, G - 12, "#3A3F4B").px(10, G - 12, "#3A3F4B");
    }, INK);
    g.stamp((l) => chart(l, 3, G - 6, ["..cCC", ".cC..", ".cC..", "cCd..", "cd..."], { c: "#565B72", C: "#34384A", d: "#23252F" }), INK);
    lantern(g, 9, G - 11);
  },
  // The keeper's: no cut post but a living stump, mossy, a leafy twig growing from it and an acorn hung on it.
  (g, G) => {
    g.stamp((l) => {
      chart(l, 4, G - 8, [".mMB..", ".bMBD.", ".bBBD.", ".bBDD.", ".mBBD.", ".MbBD.", ".bBBD.", ".bBBDD", "bBBDBD"], { b: BARK[0], B: BARK[1], D: BARK[2], m: MOSS[0], M: MOSS[1] });
      l.px(7, G - 9, BARK[1]).px(7, G - 10, BARK[1]).px(8, G - 11, BARK[0]).px(4, G - 7, BARK[1]).px(3, G - 7, BARK[0]).px(3, G - 6, "#F0D9A8");
      acornBit(l, 2, G - 5);
    }, INK);
    g.stamp((l) => chart(l, 6, G - 15, ["..lL..", ".lLLd.", "lLpLLd", ".dLLd."], { l: LEAF[0], L: LEAF[1], d: LEAF[2], p: "#FFB3D1" }), INK_LEAF);
  },
  // The knight's: her blue shield with its white chevron hung on the post, a sword's hilt standing over it.
  (g, G) => {
    g.stamp((l) => {
      signStake(l, G - 11, G);
      l.rect(6, G - 15, 2, 1, GOLD[1]).px(6, G - 15, GOLD[0]).rect(6, G - 14, 2, 2, "#8A4A2A").rect(6, G - 14, 1, 2, "#B06A3A");
      l.rect(4, G - 12, 6, 1, STEEL[1]).px(4, G - 12, STEEL[0]).px(9, G - 12, STEEL[2]).rect(6, G - 11, 2, 1, STEEL[1]).px(6, G - 11, STEEL[0]);
    }, INK);
    g.stamp((l) => chart(l, 3, G - 10, ["bbbbbbbn", "bBBwwBBn", "bBwBBwBn", "bwBBBBwn", ".bBBBBn.", "..bBBn..", "...bn..."], { b: BLUE[0], B: BLUE[1], n: BLUE[2], w: "#FFF6DF" }), INK);
  },
  // The dragon's: a post burnt black, the arm gone to a stub, embers still alight in it and a curl of smoke.
  (g, G) => {
    g.ell(7, G - 9.5, 4.6, 4, "#FF8A2A30");
    g.stamp((l) => {
      l.rect(6, G - 10, 2, 11, "#3A3F4B").rect(6, G - 9, 1, 10, "#565C6C").px(7, G - 11, "#3A3F4B").rect(8, G - 8, 3, 2, "#3A3F4B").rect(8, G - 8, 2, 1, "#565C6C").px(10, G - 7, FIRE.r);
      l.rect(4, G, 6, 1, "#2E2630").px(5, G, "#565C6C").px(8, G, FIRE.r);
      l.px(6, G - 10, FIRE.Y).px(7, G - 10, FIRE.o).px(6, G - 9, FIRE.o).px(7, G - 8, FIRE.r).px(6, G - 5, FIRE.r).px(9, G - 7, FIRE.o).px(7, G - 3, FIRE.r);
    }, INK_STONE);
    g.px(7, G - 13, "#F4F7FB").px(8, G - 14, "#F4F7FB").px(8, G - 15, "#C4CCD8").px(7, G - 16, "#C4CCD8");
  },
  // The gardener's: a clay pot on top with a daisy in it, a trowel hung on a nail.
  (g, G) => {
    g.stamp((l) => signStake(l, G - 8, G).px(8, G - 7, STEEL[2]), INK);
    g.stamp((l) => l.rect(9, G - 6, 1, 2, "#B06A3A").rect(9, G - 4, 2, 2, STEEL[1]).px(9, G - 4, STEEL[0]).px(10, G - 3, STEEL[2]).px(9, G - 2, STEEL[1]), INK);
    g.stamp((l) => {
      l.rect(4, G - 11, 6, 1, TILE[0]).px(9, G - 11, TILE[1]).rect(5, G - 10, 4, 2, TILE[1]).rect(5, G - 10, 1, 2, TILE[0]).rect(8, G - 10, 1, 2, TILE[2]);
      l.px(6, G - 12, LEAF[0]).px(7, G - 12, LEAF[1]).px(8, G - 12, LEAF[2]).px(7, G - 13, "#FFFFFF").px(7, G - 15, "#FFFFFF").px(6, G - 14, "#FFFFFF").px(8, G - 14, "#F2F2EA").px(7, G - 14, GOLD[1]);
    }, INK);
  },
  // The whistler's: a carved board with one note on it, a reed whistle hung from it on a green ribbon.
  (g, G) => {
    g.stamp((l) => signStake(l, G - 8, G), INK);
    g.stamp((l) => l.px(10, G - 7, "#8FD86A").px(10, G - 6, "#4FA650").px(10, G - 5, "#FFF8DC").px(10, G - 4, "#8A7A5A").px(10, G - 3, "#EADFA8").px(10, G - 2, "#C8B878"), INK);
    g.stamp((l) => {
      l.rect(2, G - 14, 10, 7, SIGN[1]).rect(2, G - 14, 10, 1, SIGN[0]).rect(2, G - 14, 1, 6, SIGN[0]).rect(2, G - 8, 10, 1, SIGN[2]).rect(11, G - 13, 1, 6, SIGN[2]);
      chart(l, 4, G - 13, ["..XXx", "..X.X", "..X..", "XXX..", "XX..."], { X: STICK[3], x: STICK[2] });
    }, INK);
  }
];
const signpost = {
  w: 14, h: 18,
  draw(g, f, o) {
    SIGNPOSTS[level(o, 6)](g, 16);
  }
};

export const BASE_SPRITES = {
  title: "The Hollow", bg, burrow, oak, store, fence, tower, hut, scaffold, acorn, magpie, nest,
  workshop, hive, well, stall, trophy, banner: flagpole, king, hedgehog, lantern: lamp, burst, scout,
  slinger, mole, perch, hoard, twigwall, nestdown, kingdown, pebble, battleground, decor,
  hero, champion, raider, fencepiece, ring: reach, guardian, animal, heart, land, work, blade,
  spire, darkwatch, foe, skytop, groundend, gardenbed, signpost
};
