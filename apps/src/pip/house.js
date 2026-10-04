/* Pip's house: floors (levels) stacked into a home, the wallpapers and floors
 that dress them, and the decor that snaps into each level's slots. Drawn with
 the room Painter (room.js), every draw a pure function of the frame (12 fps).

 LEVELS
   HOUSE_LEVELS: [{ id, name, w, h, floorY, price, unlock, unlockText, night,
                    wallpaper, floor, blurb, slots, decor(g, f), fridgeAt? }]
     w x h is 240 x 120 for every level (draw it scaled up, pixelated).
     price is seeds; unlock = { after: <level id>|null, sessions: n } — the
     level before it must be owned and n focus sessions completed.
     night: true when the level is always dark (lights glow there).
   Slots: { id, fits, x, y, w, h }
     fits: "ceiling" | "wall" | "window" | "top" | "stand" | "rug"
     (x, y) anchor: ceiling = top-centre; wall/window = centre;
                    top/stand/rug = bottom-centre (what the item stands on).
     w, h: the room the slot has. An item goes in a slot when
     item.fits includes slot.fits (and ideally item.w <= slot.w).
   placeAt(item, slot) -> { x, y } the item's top-left for that slot.

 ITEMS
   HOUSE_ITEMS (new, including the book-nod pieces from house-nods.js, also
   exported alone as NOD_ITEMS) and ALL_ITEMS (= ROOM_ITEMS from room.js + HOUSE_ITEMS):
   { id, name, kind: "furniture"|"wall"|"floor"|"window"|"light"|"ceiling",
     fits: [slot types], level: <level id>|"any", price, w, h, draw(g, f),
     glow?: [[x, y, r, colour]] or (f) => [...]  (light it casts, item coords) }
   Windows show the sky for the frame: pass f = skyFrame(hour) (room.js) to
   match the real time of day.

 WALLPAPERS / FLOORS: [{ id, name, price, draw(g, x, y, w, h, f) }]

 RENDER
   renderLevel(levelId, f, { wallpaper?, floor?, placed?, night?, sky? }) -> ImageData
     placed: [{ slot, itemId }] (snapped) or [{ itemId, x, y }] (free, top-left);
       `off: true` on one draws a light switched off: unlit, casting no glow.
     night: dim the room and let lights glow (defaults to level.night).
     sky: false leaves the garden's glass clear (transparent), for the living
     sky (sky.js) to be laid under the floor's picture.
   renderHouseItem(itemOrId, f) -> ImageData(item.w, item.h)
   renderSwatch("wallpaper"|"floor", id, w = 32, h = 32, f) -> ImageData (shop tiles) */
import { Painter, skyAt, flame, rnd, blend, ROOM_ITEMS, paintSky, lerpC, withSkyHour } from "./room.js";
const clamp01 = (v) => Math.max(0, Math.min(1, v));
import { rgba, FONT } from "./engine.js";
import { NOD_ITEMS as NODS_BOOKS } from "./house-nods.js";
import { NOD_ITEMS_2 } from "./house-nods2.js";
import { NOD_ITEMS_3, NOD_WALLPAPERS } from "./house-nods3.js";
/** Every book-nod item: the first set, then the literary artefacts. */
export const NOD_ITEMS = [...NODS_BOOKS, ...NOD_ITEMS_2, ...NOD_ITEMS_3];

const TAU = Math.PI * 2;
const OUT = "#2A1E16";
const W = 240, H = 120, FY = 96;



// ============================================================ WALLPAPERS
const tile = (fn) => (g, x0, y0, w, h, f) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g.px(x, y, fn(x, y, f)); };
export const WALLPAPERS = [
  { id: "cream", name: "Plain Cream", price: 0, draw: tile((x, y) => (x % 10 === 5 && y % 10 === 5 ? "#E6D2AA" : "#F2E4C6")) },
  { id: "stripes", name: "Mint Stripes", price: 80, draw: tile((x) => (x % 12 < 6 ? "#CDEBD9" : x % 12 === 6 || x % 12 === 11 ? "#B6DEC6" : "#E6F5EC")) },
  { id: "polka", name: "Pink Polka", price: 90, draw: tile((x, y) => { const r = (y >> 3) % 2 ? 4 : 0, dx = (x + r) % 8, dy = y % 8; return (dx === 3 || dx === 4) && (dy === 3 || dy === 4) ? "#FFFFFF" : "#F9CFDF"; }) },
  { id: "stars", name: "Starry Blue", price: 150, draw: tile((x, y, f) => { const k = rnd(Math.floor(x / 9) * 31 + Math.floor(y / 9) * 7); const cx = Math.floor(x / 9) * 9 + 4, cy = Math.floor(y / 9) * 9 + 4; if (k > 0.55 && ((x === cx && Math.abs(y - cy) <= 1) || (y === cy && Math.abs(x - cx) <= 1))) return (Math.floor(f / 10) + Math.floor(k * 9)) % 7 === 0 ? "#FFFFFF" : "#FFE36B"; return "#2B3566"; }) },
  { id: "leaves", name: "Leafy Green", price: 120, draw: tile((x, y) => { const X = x % 14, Y = (y + ((x / 14) | 0) * 7) % 14; const d = Math.abs(X - 7) + Math.abs(Y - 7) * 0.7; if (d < 2.4) return X === 7 ? "#3F8A4E" : "#5FB06A"; return "#DDEFD2"; }) },
  { id: "bricks", name: "Red Brick", price: 140, draw: tile((x, y) => { const row = (y / 5) | 0, off = row % 2 ? 6 : 0; if (y % 5 === 4 || (x + off) % 12 === 0) return "#C9B8A8"; return rnd(((x + off) / 12 | 0) * 13 + row * 5) > 0.7 ? "#B04A36" : "#A34230"; }) },
  { id: "books", name: "Bookish", price: 220, draw: tile((x, y) => { const row = (y / 14) | 0, yy = y % 14; if (yy >= 12) return "#6B4226"; const col = ((x + row * 5) / 3) | 0, k = rnd(col * 7 + row * 3); const top = 2 + Math.floor(k * 4); if (yy < top) return "#3E2614"; const c = ["#9A4A3E", "#3F5E8C", "#A8843E", "#3E7456", "#6A5A8E", "#9A6440"][Math.floor(k * 6)]; return yy === top ? lerpC(c, "#FFFFFF", 0.25) : c; }) },
  { id: "checker", name: "Lemon Checker", price: 100, draw: tile((x, y) => (((x >> 3) + (y >> 3)) % 2 ? "#FFF3B8" : "#FFE27A")) },
  { id: "clouds", name: "Sky Clouds", price: 160, draw: tile((x, y) => { const X = x % 36, Y = (y + ((x / 36) | 0) * 13) % 30; const inC = ((X - 10) ** 2) / 36 + ((Y - 12) ** 2) / 9 < 1 || ((X - 16) ** 2) / 25 + ((Y - 10) ** 2) / 12 < 1; return inC ? (Y > 13 ? "#E6F2FF" : "#FFFFFF") : "#A9D8FF"; }) },
  { id: "woodpanel", name: "Wood Panel", price: 180, draw: tile((x, y) => { const p = (x / 10) | 0, X = x % 10; if (X === 0) return "#4A2C16"; const grain = Math.sin(y * 0.4 + p * 3 + X * 0.2) > 0.85; return grain ? "#7A4C2C" : X === 1 ? "#A06A40" : "#8E5C36"; }) },
  { id: "nightsky", name: "Night Sky", price: 300, draw: tile((x, y, f) => { const k = rnd(x * 17 + y * 131); if (k > 0.985) return (f + ((k * 997) | 0)) % 48 < 40 ? "#FFFFFF" : "#8C95F0"; if (k > 0.975) return "#6A73C9"; return y < 30 ? "#141A3A" : lerpC("#141A3A", "#2B2F66", clamp01((y - 30) / 60)); }) },
  { id: "hearts", name: "Sweethearts", price: 130, draw: tile((x, y) => { const X = x % 10, Y = (y + ((x / 10) | 0) % 2 * 5) % 10; const rows = [".#.#.", "#####", ".###.", "..#.."]; if (X >= 2 && X < 7 && Y >= 3 && Y < 7 && rows[Y - 3][X - 2] === "#") return "#FF8FB0"; return "#FFE6EE"; }) },
  { id: "concrete", name: "Concrete", price: 60, draw: tile((x, y) => { const k = rnd(x * 7 + y * 13); return y % 24 === 0 || x % 40 === 0 ? "#8C8F96" : k > 0.9 ? "#A3A7AE" : k < 0.08 ? "#8F939A" : "#9A9EA5"; }) },
  // The book wallpapers (the Yellow Wallpaper, the Red Room).
  ...NOD_WALLPAPERS
];

// ============================================================ FLOORS
export const FLOORS = [
  { id: "wood", name: "Oak Boards", price: 0, draw: tile((x, y) => { const row = ((y - FY) / 5) | 0, yy = (y - FY) % 5; if (yy === 4) return "#7A4A26"; if ((x + row * 23) % 37 === 0) return "#7A4A26"; if (yy === 0 && (x + row * 11) % 29 < 6) return "#CC9460"; return row % 2 ? "#A56A3B" : "#B77B48"; }) },
  { id: "tiles", name: "Kitchen Tiles", price: 120, draw: tile((x, y) => { const X = x % 8, Y = (y - FY) % 6; if (X === 0 || Y === 0) return "#B9C3CC"; return ((x >> 3) + (((y - FY) / 6) | 0)) % 2 ? "#FFFFFF" : "#E4ECF2"; }) },
  { id: "carpet", name: "Plush Carpet", price: 150, draw: tile((x, y) => (rnd(x * 3 + y * 7) > 0.8 ? "#7A4BB0" : (x + y) % 2 ? "#8E5CC8" : "#8657C0")) },
  { id: "grass", name: "Soft Grass", price: 160, draw: tile((x, y, f) => { const k = rnd(x * 5 + y * 3); if (k > 0.9) return (x + (f >> 3)) % 3 ? "#6FC456" : "#7FCB6A"; if (k < 0.012) return x % 2 ? "#FFE066" : "#FFFFFF"; return (x + y) % 3 ? "#5FB84A" : "#55AD42"; }) },
  { id: "stone", name: "Flagstones", price: 140, draw: tile((x, y) => { const row = ((y - FY) / 8) | 0, off = row % 2 ? 7 : 0, X = (x + off) % 14, Y = (y - FY) % 8; if (X === 0 || Y === 0) return "#5E6068"; const k = rnd(((x + off) / 14 | 0) * 9 + row * 3); return k > 0.6 ? "#9A9CA3" : k > 0.3 ? "#8C8E95" : "#A7A9AF"; }) },
  { id: "checker", name: "Diner Checker", price: 180, draw: tile((x, y) => (((x >> 3) + ((y - FY) >> 2)) % 2 ? "#1B1B22" : "#F4F1E8")) },
  { id: "marble", name: "Marble", price: 260, draw: tile((x, y) => { const v = Math.sin(x * 0.15 + Math.sin(y * 0.4) * 2 + y * 0.3); return v > 0.93 ? "#B8B2C8" : (x % 20 === 0 || (y - FY) % 11 === 0) ? "#D6D0E0" : "#EEEAF4"; }) }
];

// ============================================================ LEVELS
const shelf = (g, x0, x1, y, c = "#8A5A34") => {
  g.rect(x0, y, x1 - x0, 2, c).rect(x0, y, x1 - x0, 1, "#B07A4A").rect(x0, y + 2, x1 - x0, 1, "#00000030");
  g.rect(x0 + 3, y + 2, 2, 3, "#5E3A1F").rect(x1 - 5, y + 2, 2, 3, "#5E3A1F");
};
const ceil = (...xs) => xs.map((x, i) => ({ id: "ceiling-" + (i + 1), fits: "ceiling", x, y: 0, w: 56, h: 40 }));
const stand = (...xs) => xs.map(([x, w], i) => ({ id: "floor-" + (i + 1), fits: "stand", x, y: 112, w, h: 80 }));

export const HOUSE_LEVELS = [
  {
    id: "bedroom", name: "Bedroom", price: 0, unlock: { after: null, sessions: 0 }, unlockText: "Pip's first room. Yours from day one.",
    blurb: "Where Pip sleeps, reads and dreams.", wallpaper: "cream", floor: "wood", night: false,
    slots: [
      ...ceil(56, 120, 184),
      { id: "window-1", fits: "window", x: 120, y: 40, w: 64, h: 48 },
      { id: "wall-1", fits: "wall", x: 36, y: 34, w: 50, h: 40 },
      { id: "wall-2", fits: "wall", x: 198, y: 36, w: 76, h: 40 },
      { id: "top-1", fits: "top", x: 184, y: 68, w: 20, h: 22 },
      { id: "top-2", fits: "top", x: 212, y: 68, w: 20, h: 22 },
      ...stand([34, 56], [92, 34], [150, 36], [206, 50]),
      { id: "rug-1", fits: "rug", x: 120, y: 118, w: 64, h: 18 }
    ],
    // Where the mini fridge may stand (its left edge), best first: in the gaps the floor spots leave between them.
    fridgeAt: [169, 115, 63],
    decor(g) { shelf(g, 172, 228, 68); }
  },
  {
    id: "kitchen", name: "Kitchen", price: 300, unlock: { after: "bedroom", sessions: 3 }, unlockText: "300 seeds, after the Bedroom and 3 focus sessions.",
    blurb: "Snacks for the brain. The kettle's always on.", wallpaper: "checker", floor: "tiles", night: false,
    slots: [
      ...ceil(40, 100, 200),
      { id: "window-1", fits: "window", x: 100, y: 38, w: 60, h: 46 },
      { id: "wall-1", fits: "wall", x: 30, y: 36, w: 44, h: 40 },
      { id: "wall-2", fits: "wall", x: 200, y: 32, w: 66, h: 36 },
      { id: "top-1", fits: "top", x: 176, y: 80, w: 24, h: 24 },
      { id: "top-2", fits: "top", x: 202, y: 80, w: 24, h: 24 },
      { id: "top-3", fits: "top", x: 226, y: 80, w: 18, h: 24 },
      ...stand([26, 34], [72, 46], [128, 36]),
      { id: "rug-1", fits: "rug", x: 76, y: 118, w: 60, h: 16 }
    ],
    decor(g) {
      // Built-in counter with cupboards, a sink and a tiled splash-back.
      for (let y = 62; y < 80; y++) for (let x = 162; x < 240; x++) g.px(x, y, (x % 6 === 0 || y % 6 === 2) ? "#C9D6DE" : "#EAF3F8");
      g.stamp((l) => {
        l.rect(162, 80, 78, 3, "#E8E0D0").rect(162, 80, 78, 1, "#FFFFFF");
        l.rect(163, 83, 77, 27, "#6FA8C8").rect(163, 83, 77, 1, "#8FC4E0");
        for (const x of [165, 191, 217]) l.rect(x, 86, 22, 21, "#5A93B4").rect(x, 86, 22, 1, "#7FB6D2").rect(x + 10, 95, 3, 1, "#E8E0D0");
        l.rect(163, 108, 77, 2, "#3E6F8C");
      });
    }
  },
  {
    id: "library", name: "Library", price: 600, unlock: { after: "kitchen", sessions: 10 }, unlockText: "600 seeds, after the Kitchen and 10 focus sessions.",
    blurb: "Floor-to-ceiling stories and a very comfy chair.", wallpaper: "books", floor: "carpet", night: false,
    slots: [
      ...ceil(50, 120, 190),
      { id: "window-1", fits: "window", x: 120, y: 34, w: 48, h: 50 },
      { id: "wall-1", fits: "wall", x: 64, y: 30, w: 40, h: 32 },
      { id: "wall-2", fits: "wall", x: 180, y: 30, w: 40, h: 32 },
      { id: "top-1", fits: "top", x: 166, y: 70, w: 18, h: 22 },
      { id: "top-2", fits: "top", x: 194, y: 70, w: 18, h: 22 },
      ...stand([24, 44], [76, 40], [164, 40], [216, 44]),
      { id: "rug-1", fits: "rug", x: 120, y: 118, w: 70, h: 18 }
    ],
    decor(g) {
      for (let y = 70; y < 93; y++) for (let x = 0; x < W; x++) g.px(x, y, y === 70 ? "#A06A40" : x % 30 === 0 || y === 72 || y === 91 ? "#4A2C16" : "#6B4226");
      g.rect(0, 0, W, 3, "#6B4226").rect(0, 3, W, 1, "#4A2C16");
      shelf(g, 152, 208, 70, "#6B4226");
    }
  },
  {
    id: "greenhouse", name: "Greenhouse", price: 900, unlock: { after: "library", sessions: 20 }, unlockText: "900 seeds, after the Library and 20 focus sessions.",
    blurb: "Sunlight, soil and a pond. Pip's leafy cousins live here.", wallpaper: "leaves", floor: "grass", night: false,
    slots: [
      ...ceil(60, 120, 180),
      { id: "window-1", fits: "window", x: 206, y: 36, w: 50, h: 44 },
      { id: "wall-1", fits: "wall", x: 206, y: 74, w: 50, h: 22 },
      { id: "top-1", fits: "top", x: 22, y: 76, w: 18, h: 22 },
      { id: "top-2", fits: "top", x: 44, y: 76, w: 18, h: 22 },
      { id: "top-3", fits: "top", x: 66, y: 76, w: 18, h: 22 },
      ...stand([112, 36], [152, 30], [202, 66]),
      { id: "rug-1", fits: "rug", x: 136, y: 119, w: 70, h: 18 }
    ],
    decor(g, f) {
      // Glass walls and roof on a low brick base. The sky through them is
      // painted here, or left clear for the scene's own living sky (sky.js)
      // to show through: only the glazing bars and the glints are drawn then.
      if (openSky) { for (let y = 0; y < 60; y++) for (let x = 0; x < W; x++) g.C.d[y * W + x] = null; }
      else paintSky(g, 0, 0, W, 60, f);
      for (let y = 0; y < 60; y++) for (let x = 0; x < W; x++) if (x % 30 === 0 || y % 20 === 0) g.px(x, y, "#E8F1EC"); else if ((x + y) % 23 === 0) g.px(x, y, "#FFFFFF66");
      g.rect(0, 60, W, 2, "#E8F1EC").rect(0, 62, W, 1, "#B8C8BE");
      g.stamp((l) => {
        l.rect(8, 76, 72, 3, "#8A5A34").rect(8, 76, 72, 1, "#B07A4A");
        l.rect(10, 79, 3, 17, "#6B4226").rect(75, 79, 3, 17, "#6B4226").rect(10, 88, 68, 2, "#6B4226");
      });
    }
  },
  {
    id: "arcade", name: "Attic Arcade", price: 1200, unlock: { after: "greenhouse", sessions: 30 }, unlockText: "1,200 seeds, after the Greenhouse and 30 focus sessions.",
    blurb: "Under the roof: blinking cabinets and Pip's high scores.", wallpaper: "stars", floor: "checker", night: true,
    slots: [
      ...ceil(96, 144),
      { id: "window-1", fits: "window", x: 120, y: 30, w: 40, h: 40 },
      { id: "wall-1", fits: "wall", x: 76, y: 48, w: 40, h: 30 },
      { id: "wall-2", fits: "wall", x: 166, y: 48, w: 40, h: 30 },
      { id: "top-1", fits: "top", x: 196, y: 72, w: 18, h: 22 },
      { id: "top-2", fits: "top", x: 220, y: 72, w: 18, h: 22 },
      ...stand([28, 36], [74, 46], [126, 40], [168, 34]),
      { id: "rug-1", fits: "rug", x: 120, y: 118, w: 64, h: 16 }
    ],
    decor(g, f) {
      // Sloping roof beams at both sides and a neon strip under the ridge.
      for (let y = 0; y < 56; y++) {
        const e = Math.round(60 - y * 1.07);
        for (let x = 0; x < e; x++) g.px(x, y, (x + y) % 9 === 0 ? "#3A2616" : "#4A3020");
        for (let x = W - e; x < W; x++) g.px(x, y, (x - y) % 9 === 0 ? "#3A2616" : "#4A3020");
        g.px(e, y, "#6B4226").px(W - e - 1, y, "#6B4226");
      }
      const hue = ["#FF4DB8", "#7FE0FF", "#FFE36B"][Math.floor(f / 24) % 3];
      g.rect(60, 2, 120, 1, hue).rect(60, 3, 120, 1, hue + "66");
      shelf(g, 184, 234, 72, "#5A3820");
    }
  },
  {
    id: "workshop", name: "Basement Workshop", price: 1500, unlock: { after: "arcade", sessions: 45 }, unlockText: "1,500 seeds, after the Attic Arcade and 45 focus sessions.",
    blurb: "Pipes, sawdust and Pip's inventions.", wallpaper: "concrete", floor: "stone", night: true,
    slots: [
      ...ceil(110, 190),
      { id: "window-1", fits: "window", x: 150, y: 16, w: 44, h: 20 },
      { id: "wall-1", fits: "wall", x: 90, y: 44, w: 46, h: 32 },
      { id: "wall-2", fits: "wall", x: 200, y: 38, w: 66, h: 32 },
      { id: "top-1", fits: "top", x: 196, y: 68, w: 18, h: 20 },
      { id: "top-2", fits: "top", x: 220, y: 68, w: 18, h: 20 },
      ...stand([80, 56], [134, 40], [176, 36], [218, 40]),
      { id: "rug-1", fits: "rug", x: 130, y: 118, w: 60, h: 16 }
    ],
    decor(g, f) {
      // Stairs up to the house, pipes along the ceiling with a drip.
      g.stamp((l) => {
        for (let i = 0; i < 8; i++) l.rect(0, 20 + i * 10, 48 - i * 5, 3, "#8A5A34").rect(0, 23 + i * 10, 48 - i * 5, 1, "#5E3A1F");
        l.line(48, 22, 8, 96, "#6B4226");
      });
      g.stamp((l) => { l.rect(52, 5, 188, 3, "#8C97A6").rect(52, 5, 188, 1, "#C9D1DB"); l.rect(52, 10, 188, 2, "#B0563A"); for (const x of [90, 150, 210]) l.rect(x, 4, 3, 5, "#5A606E"); }, "#23262E");
      const t = (f % 36) / 36;
      if (t < 0.7) g.px(151, Math.round(12 + t * 80), "#7FC6FF");
      shelf(g, 184, 234, 68, "#6B6E76");
    }
  },
  {
    id: "observatory", name: "Rooftop Observatory", price: 2000, unlock: { after: "workshop", sessions: 60 }, unlockText: "2,000 seeds, after the Workshop and 60 focus sessions.",
    blurb: "The top of the house, under a glass dome full of stars.", wallpaper: "nightsky", floor: "marble", night: true,
    glow: [[120, 0, 120, "#6A73C9"]],
    slots: [
      ...ceil(50, 190),
      { id: "window-1", fits: "window", x: 30, y: 70, w: 40, h: 34 },
      { id: "window-2", fits: "window", x: 210, y: 70, w: 40, h: 34 },
      { id: "wall-1", fits: "wall", x: 120, y: 74, w: 66, h: 30 },
      { id: "top-1", fits: "top", x: 76, y: 76, w: 18, h: 22 },
      { id: "top-2", fits: "top", x: 164, y: 76, w: 18, h: 22 },
      ...stand([120, 60], [40, 44], [200, 44]),
      { id: "rug-1", fits: "rug", x: 120, y: 119, w: 80, h: 16 }
    ],
    decor(g, f) {
      // A glass dome over the room: the real sky through iron ribs.
      const inDome = (x, y) => { const nx = (x + 0.5 - 120) / 118, ny = (58 - y) / 58; return y < 58 && nx * nx + ny * ny <= 1; };
      for (let y = 0; y < 58; y++) for (let x = 0; x < W; x++) if (!inDome(x, y)) g.px(x, y, (x + y) % 7 ? "#1B2142" : "#232A52");
      paintSky(g, 2, 0, 236, 58, f, inDome);
      for (let y = 0; y < 58; y++) for (let x = 0; x < W; x++) {
        if (!inDome(x, y)) continue;
        const nx = (x + 0.5 - 120) / 118, ny = (58 - y) / 58, r = Math.hypot(nx, ny), a = Math.atan2(ny, nx);
        if (r > 0.96 || Math.abs(r - 0.55) < 0.018 || Math.abs(r - 0.8) < 0.014 || Math.abs(((a / Math.PI) * 8) % 1) < 0.045 * (1.1 - r)) g.px(x, y, r > 0.96 ? "#5A606E" : "#8C97A6");
      }
      g.rect(0, 57, W, 2, "#5A606E").rect(0, 57, W, 1, "#8C97A6");
      shelf(g, 64, 90, 76, "#5A606E"); shelf(g, 150, 176, 76, "#5A606E");
    }
  }
];
for (const L of HOUSE_LEVELS) { L.w = W; L.h = H; L.floorY = FY; }

// ============================================================ ITEMS
const it = (id, name, kind, fits, level, price, w, h, draw, extra) => Object.assign({ id, name, kind, fits, level, price, w, h, draw }, extra || {});
const bulbCol = (on) => (on ? "#FFE9A0" : "#8C7A4A");

const NEW_ITEMS = [
  // ---------------------------------------------------------- ceiling & lights
  it("hangingbulb", "Hanging Bulb", "ceiling", ["ceiling"], "any", 40, 12, 30, (g, f) => {
    g.line(6, 0, 6, 17, "#3A3F4B");
    g.stamp((l) => l.rect(4, 17, 4, 3, "#3A3F4B").px(4, 17, "#5A606E"), "#14161C");
    g.stamp((l) => { l.ell(6, 24, 3.4, 3.8, (nx, ny) => (nx + ny < -0.6 ? "#FFFFFF" : "#FFE9A0")); l.px(5, 23, "#E0A800").px(6, 24, "#E0A800").px(7, 23, "#E0A800"); }, "#8A6400");
    if (f % 60 < 3) g.px(3, 21, "#FFFFFF");
  }, { glow: [[6, 24, 30, "#FFD27A"]] }),
  it("chandelier", "Chandelier", "ceiling", ["ceiling"], "any", 600, 44, 30, (g, f) => {
    g.line(22, 0, 22, 8, "#8A6400");
    g.stamp((l) => {
      l.ell(22, 18, 18, 4, (nx, ny) => (nx * nx + ny * ny < 0.55 ? null : ny < 0 ? "#FFE36B" : "#D9A441"));
      l.ell(22, 12, 3, 4, "#FFD23F").rect(21, 8, 2, 3, "#D9A441");
      for (const x of [6, 14, 22, 30, 38]) l.rect(x - 1, 12, 2, 4, "#F4F1E8");
      for (const x of [10, 18, 26, 34]) l.px(x, 23, "#BFEFFF").px(x, 24, "#FFFFFF");
    }, "#4A3100");
    for (const [i, x] of [6, 14, 22, 30, 38].entries()) {
      const k = (f + i * 5) % 8 < 4;
      g.px(x, 11, "#FFC53D").px(x - (k ? 0 : 1), 10, "#FFE36B").px(x, 9, k ? "#FFF3B0" : null);
    }
  }, { glow: [[22, 14, 56, "#FFE0A0"]] }),
  it("discoball", "Disco Ball", "ceiling", ["ceiling"], "arcade", 450, 22, 26, (g, f) => {
    g.line(11, 0, 11, 6, "#8C97A6");
    g.stamp((l) => l.ell(11, 15, 8, 8, (nx, ny, x, y) => {
      const k = (x + y + Math.floor(f / 3)) % 5;
      if ((x + Math.floor(f / 2)) % 3 === 0 || y % 3 === 0) return "#6B7489";
      return nx + ny < -0.6 ? "#FFFFFF" : k === 0 ? "#FFFFFF" : k === 1 ? "#C9D1FF" : nx + ny > 0.6 ? "#8C95B0" : "#B8C0D8";
    }), "#1B2230");
    const s = f % 16;
    if (s < 4) g.px(5 + s * 3, 11 + (s % 2) * 6, "#FFFFFF");
  }, { glow: (f) => [[11, 15, 44, ["#FF4DB8", "#7FE0FF", "#FFE36B", "#9CE07A"][Math.floor(f / 12) % 4]]] }),
  it("paperlantern", "Paper Lantern", "ceiling", ["ceiling"], "any", 120, 18, 30, (g, f) => {
    const sw = Math.round(Math.sin(f * 0.08));
    g.line(9, 0, 9 + sw, 9, "#3A2A1E");
    g.stamp((l) => {
      l.ell(9 + sw, 19, 7.5, 8.5, (nx, ny, x, y) => ((y - 11) % 3 === 0 ? "#E0782E" : nx + ny < -0.5 ? "#FFE0B8" : "#FFB36B"));
      l.rect(6 + sw, 10, 6, 1, "#8A3A1A").rect(6 + sw, 27, 6, 1, "#8A3A1A");
    }, "#5A2A0A");
  }, { glow: [[9, 19, 32, "#FFB36B"]] }),
  it("ceilingfan", "Ceiling Fan", "ceiling", ["ceiling"], "any", 200, 52, 18, (g, f) => {
    g.rect(25, 0, 2, 6, "#5E3A1F");
    const a = f * 0.9;
    for (let b = 0; b < 4; b++) {
      const c = Math.cos(a + (b * TAU) / 4), len = 22 * Math.abs(c) + 3, dir = c > 0 ? 1 : -1;
      g.stamp((l) => l.rect(dir > 0 ? 28 : 24 - len, 8 + (b % 2), len, 2, b % 2 ? "#8A5A34" : "#A06A40"), "#2A160A");
    }
    g.stamp((l) => { l.ell(26, 9, 4, 2.5, "#D9A441"); l.ell(26, 13, 3, 2.4, (nx, ny) => (ny > -0.2 ? "#FFF3C2" : null)); }, "#4A3100");
  }, { glow: [[26, 14, 22, "#FFE9A0"]] }),
  it("hangingplant", "Hanging Fern", "ceiling", ["ceiling"], "greenhouse", 120, 22, 36, (g, f) => {
    g.line(11, 0, 5, 12, "#C9B58C").line(11, 0, 17, 12, "#C9B58C").line(11, 0, 11, 12, "#C9B58C");
    g.stamp((l) => { l.ell(11, 15, 7, 4, (nx, ny) => (ny < -0.3 ? null : nx + ny > 0.5 ? "#A84A32" : "#C8683C")); l.rect(4, 13, 15, 2, "#D9774A"); }, "#4A1E0A");
    g.stamp((l) => {
      for (let v = 0; v < 5; v++) {
        const x0 = 4 + v * 3.5, len = 10 + (v % 3) * 6;
        for (let j = 0; j < len; j++) l.px(x0 + Math.round(Math.sin(j * 0.5 + f * 0.1 + v) * 1.2), 13 + j, j % 3 === 0 ? "#7FCB6A" : "#3FA35E");
      }
    }, "#123A1E");
  }),
  it("stringlights", "Globe String Lights", "light", ["wall"], "any", 150, 72, 14, (g, f) => {
    const cols = ["#FF6B6B", "#FFD23F", "#7FE0FF", "#9CE07A", "#FF9CCB"];
    const y = (x) => 2 + Math.round(Math.sin(((x - 1) / 70) * Math.PI) * 5);
    for (let x = 1; x < 71; x++) g.px(x, y(x), "#2E3A2E");
    for (let i = 0; i < 9; i++) {
      const x = 5 + i * 8, yy = y(x) + 2, on = (Math.floor(f / 8) + i) % 6 !== 0, c = cols[i % 5];
      g.stamp((l) => l.ell(x, yy + 1.5, 1.8, 2.1, (nx, ny) => (on ? (nx + ny < -0.4 ? "#FFFFFF" : c) : "#6B6558")), "#2E2A22");
    }
  }, { glow: [[18, 8, 22, "#FFD27A"], [54, 8, 22, "#FFB0C8"]] }),
  it("neonread", "Neon READ Sign", "light", ["wall"], "any", 350, 46, 20, (g, f) => {
    const flick = f % 90 > 84 && f % 2;
    const c = flick ? "#7A2A5A" : "#FF4DB8", hi = flick ? "#9A4A7A" : "#FFD1EE";
    g.rect(1, 1, 44, 18, "#1B1422").rect(1, 1, 44, 1, "#2E2438");
    let x = 7;
    for (const ch of "READ") {
      const gph = FONT[ch];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (gph[j * 3 + i] === "#") g.rect(x + i * 2, 5 + j * 2, 2, 2, c).px(x + i * 2, 5 + j * 2, hi);
      x += 8;
    }
    for (let i = 0; i < 44; i++) if (i % 3 !== 1) { g.px(1 + i, 0, "#FFE36B"); g.px(1 + i, 19, "#FFE36B"); }
  }, { glow: (f) => (f % 90 > 84 && f % 2 ? [] : [[23, 10, 36, "#FF4DB8"]]) }),
  it("wallsconce", "Wall Sconce", "light", ["wall"], "any", 100, 14, 20, (g, f) => {
    g.stamp((l) => { l.rect(5, 10, 4, 8, "#D9A441").rect(3, 16, 8, 2, "#B07A1A"); l.line(7, 14, 7, 11, "#8A6400"); }, "#4A3100");
    g.stamp((l) => { for (let j = 0; j < 7; j++) l.rect(7 - Math.floor(j / 2) - 2, 2 + j, 4 + Math.floor(j / 2) * 2, 1, j > 4 ? "#FFD27A" : "#FFF3C2"); }, "#8A6400");
    void f;
  }, { glow: [[7, 7, 26, "#FFE0A0"]] }),
  it("lavalamp", "Lava Lamp", "light", ["top", "stand"], "any", 180, 12, 24, (g, f) => {
    g.stamp((l) => {
      for (let y = 5; y < 17; y++) { const w = y < 11 ? 4 + ((y - 5) >> 1) : 7 - ((y - 11) >> 2); l.rect(6 - w / 2, y, w, 1, "#7A2A9A"); }
      for (let i = 0; i < 3; i++) {
        const t = ((f * 0.6 + i * 16) % 48) / 48, y = 16 - Math.sin(t * Math.PI) * 10, x = 6 + Math.sin(i * 2 + f * 0.05);
        l.ell(x, y, 1.6 - (i === 1 ? 0.4 : 0), 1.8, "#FF8A3D");
      }
      l.rect(3, 17, 7, 6, "#C9D1DB").rect(3, 17, 2, 6, "#EEF3F8").rect(4, 2, 5, 3, "#C9D1DB");
    }, "#1B1422");
  }, { glow: [[6, 11, 18, "#FF8A3D"]] }),
  it("candles", "Candle Trio", "light", ["top"], "any", 60, 16, 14, (g, f) => {
    g.stamp((l) => { l.rect(2, 7, 3, 6, "#F4F1E8").rect(7, 4, 3, 9, "#FFF6DF").rect(12, 8, 3, 5, "#F4F1E8").rect(1, 12, 15, 1, "#D9A441"); }, "#5A4A36");
    for (const [i, x, y] of [[0, 3, 6], [1, 8, 3], [2, 13, 7]]) {
      const k = (f + i * 3) % 6 < 3;
      g.px(x, y, "#FFC53D").px(x + (k ? 0 : -1), y - 1, "#FFE36B").px(x, y - 2, k ? "#FFF3B0" : null);
    }
  }, { glow: [[8, 5, 22, "#FFC870"]] }),
  it("mushroomlamp", "Mushroom Lamp", "light", ["top", "stand"], "greenhouse", 140, 16, 16, (g, f) => {
    const on = f % 120 > 3;
    g.stamp((l) => {
      l.rect(6, 8, 4, 7, "#F4F1E8").rect(3, 14, 10, 1, "#C9B58C");
      l.ell(8, 7, 7, 5, (nx, ny) => (ny > 0.35 ? null : nx + ny < -0.6 ? "#FF9A9A" : on ? "#FF4D5E" : "#A8323E"));
      l.px(5, 4, "#FFFFFF").px(10, 5, "#FFFFFF").px(8, 3, "#FFFFFF");
    }, "#4A0A10");
  }, { glow: [[8, 7, 20, "#FF7A8A"]] }),

  // ---------------------------------------------------------- windows
  it("roundwindow", "Porthole Window", "window", ["window"], "any", 180, 34, 34, (g, f) => {
    const inside = (x, y) => (x + 0.5 - 17) ** 2 + (y + 0.5 - 17) ** 2 < 12.5 ** 2;
    paintSky(g, 4, 4, 26, 26, f, inside);
    g.stamp((l) => {
      l.ell(17, 17, 16, 16, (nx, ny) => (nx * nx + ny * ny < 0.62 ? null : nx + ny < -0.6 ? "#F4D27A" : "#D9A441"));
      l.rect(16, 5, 2, 24, "#D9A441").rect(5, 16, 24, 2, "#D9A441");
      for (const [x, y] of [[17, 2], [17, 31], [2, 17], [31, 17]]) l.px(x, y, "#8A6400");
    }, "#4A3100");
    g.px(10, 10, "#FFFFFFaa").px(11, 9, "#FFFFFFaa");
  }),
  it("archedwindow", "Arched Window", "window", ["window"], "any", 260, 36, 46, (g, f) => {
    const inside = (x, y) => x >= 4 && x < 32 && y < 44 && (y >= 18 || (x + 0.5 - 18) ** 2 + (y + 0.5 - 18) ** 2 < 14 * 14);
    paintSky(g, 4, 4, 28, 40, f, inside);
    g.stamp((l) => {
      for (let y = 0; y < 46; y++) for (let x = 0; x < 36; x++) {
        const out = (x + 0.5 - 18) ** 2 + (y + 0.5 - 18) ** 2;
        const frame = y < 18 ? out >= 14 * 14 && out < 17.5 * 17.5 : (x < 4 && x >= 1) || (x >= 32 && x < 35);
        if (frame && y < 44) l.px(x, y, "#F4F1E8");
      }
      l.rect(17, 4, 2, 40, "#F4F1E8").rect(4, 18, 28, 2, "#F4F1E8").rect(4, 31, 28, 1, "#F4F1E8");
      l.rect(0, 43, 36, 3, "#E8DCC4").rect(0, 45, 36, 1, "#C9B894");
    }, "#5A4A36");
  }),
  it("baywindow", "Bay Window Seat", "window", ["window"], "any", 400, 62, 46, (g, f) => {
    paintSky(g, 3, 3, 56, 30, f);
    g.stamp((l) => {
      l.rect(1, 1, 60, 2, "#F4F1E8").rect(1, 33, 60, 2, "#F4F1E8");
      for (const x of [1, 14, 30, 46, 59]) l.rect(x, 1, 2, 34, "#F4F1E8");
      l.rect(15, 17, 45, 1, "#F4F1E8");
    }, "#5A4A36");
    g.stamp((l) => {
      l.rect(0, 35, 62, 9, "#8A5A34").rect(0, 35, 62, 1, "#B07A4A");
      l.rect(2, 31, 58, 5, "#5B7FD6").rect(2, 31, 58, 1, "#8FAAF0");
      l.ell(10, 30, 5, 3, "#FF8FB0").ell(52, 30, 5, 3, "#FFD23F");
    }, "#2A160A");
  }),
  it("stainedglass", "Stained Glass", "window", ["window"], "library", 500, 30, 44, (g, f) => {
    const cols = ["#E0393E", "#2F80E6", "#FFD23F", "#1FBF6A", "#8E5CFF", "#FF8A3D"];
    const lit = skyAt(f).night < 0.5;
    for (let y = 3; y < 42; y++) for (let x = 3; x < 27; x++) {
      const d = (x + 0.5 - 15) ** 2 + (y + 0.5 - 15) ** 2;
      if (y < 15 && d > 12 * 12) continue;
      const cell = Math.floor((x - 3) / 6) + Math.floor((y + (x % 12 < 6 ? 0 : 4)) / 7) * 4;
      const lead = (x - 3) % 6 === 0 || (y + (x % 12 < 6 ? 0 : 4)) % 7 === 0;
      g.px(x, y, lead ? "#2A2A33" : lit ? cols[cell % 6] : lerpC(cols[cell % 6], "#1B1B30", 0.55));
    }
    g.stamp((l) => {
      for (let y = 0; y < 44; y++) for (let x = 0; x < 30; x++) {
        const d = (x + 0.5 - 15) ** 2 + (y + 0.5 - 15) ** 2;
        if (y < 15 ? d >= 12 * 12 && d < 15 * 15 : x < 3 || x >= 27 || y >= 42) l.px(x, y, "#8C8F96");
      }
    }, "#23262E");
    g.ell(15, 22, 3, 3, (nx, ny) => (lit ? "#FFF6C2" : "#8C7A4A"));
  }),
  it("skylight", "Skylight", "window", ["ceiling"], "any", 320, 46, 14, (g, f) => {
    paintSky(g, 3, 0, 40, 11, f);
    g.stamp((l) => { l.rect(1, 0, 2, 13, "#F4F1E8").rect(43, 0, 2, 13, "#F4F1E8").rect(1, 11, 44, 2, "#F4F1E8").rect(22, 0, 2, 11, "#F4F1E8"); }, "#5A4A36");
  }, { glow: (f) => (skyAt(f).night < 0.5 ? [[23, 12, 50, "#FFF6D0"]] : []) }),

  // ---------------------------------------------------------- kitchen
  it("fridge", "Retro Fridge", "furniture", ["stand"], "kitchen", 350, 28, 56, (g, f) => {
    g.shadow(14, 12, 55);
    g.stamp((l) => {
      l.ell(14, 6, 13, 6, (nx, ny) => (ny > 0 ? null : nx < -0.4 ? "#D6FFF2" : "#9FE3CF"));
      l.rect(1, 6, 26, 48, "#9FE3CF").rect(1, 6, 3, 48, "#C6F4E6").rect(24, 6, 3, 48, "#7CC8B2");
      l.rect(1, 20, 26, 1, "#5A9C8A").rect(20, 10, 2, 8, "#DDE3EC").rect(20, 24, 2, 12, "#DDE3EC");
      l.rect(3, 53, 4, 2, "#3A3F4B").rect(21, 53, 4, 2, "#3A3F4B");
    }, "#1E4A40");
    g.stamp((l) => l.rect(6, 26, 7, 8, "#FFF6DF").rect(7, 27, 5, 1, "#E0393E").rect(7, 29, 4, 1, "#8C97A6").rect(7, 31, 5, 1, "#8C97A6"), "#5A4A36");
    g.stamp((l) => l.ell(8, 12, 1.6, 1.6, "#FF6FA8"), "#4A0A24");
    g.stamp((l) => l.rect(12, 10, 3, 3, "#FFD23F"), "#4A3100");
  }),
  it("stove", "Cosy Stove", "furniture", ["stand"], "kitchen", 400, 32, 42, (g, f) => {
    g.shadow(16, 14, 41);
    g.stamp((l) => {
      l.rect(1, 14, 30, 26, "#E8E0D0").rect(1, 14, 30, 1, "#FFFFFF").rect(1, 14, 2, 26, "#FFFFFF");
      l.rect(1, 12, 30, 2, "#3A3F4B");
      l.rect(5, 21, 22, 14, "#3A3F4B").rect(7, 23, 18, 10, (f >> 3) % 2 ? "#FF8A2A" : "#FF7A1A").rect(7, 23, 18, 1, "#FFC53D");
      l.rect(10, 19, 12, 1, "#8C97A6");
      for (const x of [6, 12, 20, 26]) l.px(x, 16, "#E0393E");
      l.rect(3, 39, 3, 2, "#3A3F4B").rect(26, 39, 3, 2, "#3A3F4B");
    }, "#23262E");
    g.stamp((l) => { l.rect(6, 6, 12, 6, "#C8453B").rect(6, 6, 12, 1, "#E0584E").rect(4, 7, 2, 1, "#8C97A6").rect(18, 7, 2, 1, "#8C97A6"); l.rect(9, 4, 6, 2, "#A8323E"); l.px(11, 3, "#3A3F4B"); }, "#4A0E14");
    for (let k = 0; k < 3; k++) {
      const t = ((f + k * 5) % 15) / 15;
      if (t < 0.85) g.px(Math.round(9 + k * 3 + Math.sin((f + k * 4) * 0.7)), Math.round(3 - t * 4) + 1, "#FFFFFFcc");
    }
  }, { glow: [[16, 28, 16, "#FF8A2A"]] }),
  it("kitchentable", "Gingham Table", "furniture", ["stand"], "kitchen", 250, 44, 28, (g, f) => {
    g.shadow(22, 20, 27);
    g.stamp((l) => {
      l.rect(4, 14, 3, 13, "#8A5A34").rect(37, 14, 3, 13, "#8A5A34");
      for (let y = 10; y < 17; y++) for (let x = 1; x < 43; x++) l.px(x, y, y === 10 ? "#FFFFFF" : ((x >> 1) + (y >> 1)) % 2 ? "#E0393E" : "#FFFFFF");
    }, "#4A0E14");
    g.stamp((l) => { l.ell(14, 9, 5, 1.5, "#F4F1E8"); l.ell(14, 8, 2.5, 1.2, "#FFD23F"); l.rect(28, 3, 4, 7, "#BFEFFF"); l.rect(29, 1, 2, 3, "#4FBF5A").px(30, 0, "#FF6FA8").px(29, 1, "#FF6FA8"); }, "#3A3F4B");
    void f;
  }),
  it("fruitbowl", "Fruit Bowl", "furniture", ["top"], "kitchen", 60, 18, 12, (g) => {
    g.stamp((l) => {
      l.ell(5, 5, 2.5, 2.5, "#E0262E").ell(12, 5, 2.5, 2.5, "#FF8A2A").ell(8.5, 3.5, 2.3, 2.3, "#9CE07A").rect(8, 0, 1, 2, "#6B3A1E");
      l.ell(9, 8, 8, 3.2, (nx, ny) => (ny < -0.2 ? null : "#5B7FD6")).rect(1, 7, 16, 1, "#8FAAF0");
    }, "#1B2A5A");
  }),
  it("kettle", "Whistling Kettle", "furniture", ["top"], "kitchen", 80, 16, 16, (g, f) => {
    g.stamp((l) => {
      l.ell(8, 11, 6, 4.5, (nx, ny) => (nx + ny < -0.5 ? "#FF9A9A" : "#E0393E")).rect(2, 14, 12, 1, "#A8182C");
      l.line(13, 10, 15, 7, "#E0393E");
      l.ring(8, 6.5, 3.2, "#3A3F4B", (t) => t < 0.5);
      l.rect(7, 6, 2, 1, "#3A3F4B");
    }, "#4A0A10");
    const t = (f % 24) / 24;
    if (t < 0.6) { g.px(15, Math.round(5 - t * 5), "#FFFFFFcc"); if (f % 48 < 24) g.px(14, Math.round(4 - t * 4), "#FFFFFF99"); }
  }),
  it("toaster", "Pop-up Toaster", "furniture", ["top"], "kitchen", 90, 16, 16, (g, f) => {
    const t = f % 48, pop = t < 8 ? -Math.sin((t / 8) * Math.PI) * 5 : 0;
    g.stamp((l) => l.rect(4, 5 + pop, 8, 5, "#E8B86B").rect(5, 5 + pop, 6, 1, "#C88A45"), "#6B4A1E");
    g.stamp((l) => { l.rect(1, 8, 14, 7, "#C9D1DB").rect(1, 8, 14, 1, "#EEF3F8").rect(1, 8, 2, 7, "#EEF3F8").rect(14, 11, 1, 2, "#3A3F4B"); l.rect(3, 8, 10, 1, "#3A3F4B"); }, "#23262E");
  }),

  // ---------------------------------------------------------- library
  it("tallshelf", "Tall Bookcase", "furniture", ["stand"], "library", 450, 38, 72, (g) => {
    g.shadow(19, 17, 71);
    g.stamp((l) => {
      l.rect(1, 3, 36, 67, "#5A3820").rect(0, 1, 38, 3, "#6B4226").rect(1, 3, 1, 67, "#7A4C2C");
      l.rect(3, 5, 32, 63, "#2E1C0E");
      for (const y of [18, 31, 44, 57, 68]) l.rect(2, y, 34, 2, "#7A4C2C");
    }, "#1E120A");
    const cols = ["#C8453B", "#2F80E6", "#FFB400", "#1FA36A", "#8E5CFF", "#E07A3A", "#F2E3C2", "#35A6A0", "#B0203A"];
    let k = 3;
    for (const base of [18, 31, 44, 57, 68]) {
      let x = 3;
      while (x < 34) {
        const w = 2 + Math.floor(rnd(k * 3 + 1) * 2), hh = 7 + Math.floor(rnd(k * 5 + 2) * 4);
        if (x + w > 35) break;
        const c = cols[(k * 5) % cols.length];
        g.rect(x, base - hh, w, hh, c).px(x, base - hh, "#FFFFFF55").rect(x, base - hh + 2, w, 1, "#00000033");
        x += w + (rnd(k) > 0.85 ? 2 : 0); k++;
      }
    }
  }),
  it("ladder", "Library Ladder", "furniture", ["stand"], "library", 120, 18, 64, (g) => {
    g.stamp((l) => {
      l.line(9, 1, 2, 63, "#8A5A34").line(17, 1, 10, 63, "#8A5A34");
      for (let i = 0; i < 8; i++) { const y = 6 + i * 7, s = (y / 63) * 7; l.line(9 - s + 1, y, 17 - s - 1, y, "#B07A4A"); }
      l.rect(8, 0, 10, 2, "#D9A441");
    }, "#2A160A");
  }),
  it("readingchair", "Wingback Chair", "furniture", ["stand"], "library", 380, 36, 36, (g) => {
    g.shadow(18, 16, 35);
    g.stamp((l) => {
      l.rect(5, 30, 2, 5, "#5E3A1F").rect(29, 30, 2, 5, "#5E3A1F");
      l.ell(18, 10, 12, 9, (nx, ny) => (ny > 0.6 ? null : nx + ny < -0.6 ? "#E0584E" : "#B0203A"));
      l.rect(6, 10, 24, 12, "#B0203A");
      for (const s of [0, 1]) l.ell(s ? 31 : 5, 12, 4.5, 8, (nx, ny) => (nx * (s ? 1 : -1) > 0.3 ? "#8A1428" : "#C8303F"));
    }, "#3A0610");
    g.stamp((l) => {
      l.rect(7, 20, 22, 5, "#C8303F").rect(7, 20, 22, 1, "#FF6B7A");
      l.rect(3, 24, 30, 6, "#B0203A").rect(3, 29, 30, 1, "#8A1428");
      for (const x of [3, 29]) l.rect(x, 15, 4, 10, "#B0203A").rect(x, 15, 4, 1, "#E0584E");
    }, "#3A0610");
    g.stamp((l) => l.rect(22, 18, 6, 3, "#2F80E6").rect(22, 18, 6, 1, "#FFF6DF"), "#0A1E3A");
  }),
  it("lectern", "Reading Lectern", "furniture", ["stand"], "library", 200, 22, 34, (g, f) => {
    g.shadow(11, 8, 33);
    g.stamp((l) => { l.rect(9, 12, 4, 19, "#6B4226").rect(4, 30, 14, 3, "#6B4226"); l.line(2, 11, 20, 7, "#8A5A34").line(2, 12, 20, 8, "#8A5A34"); }, "#1E120A");
    const flip = (f % 72) / 72;
    g.stamp((l) => {
      l.line(3, 9, 10, 7, "#FFF6DF").line(3, 8, 10, 6, "#FFF6DF").line(12, 6, 19, 5, "#F6E9C8").line(12, 5, 19, 4, "#F6E9C8");
      l.px(11, 6, "#DCC89C");
      if (flip < 0.15) { const x = Math.round(12 - flip / 0.15 * 7); l.line(11, 6, x, 1, "#FFFFFF"); }
    }, "#5A3A10");
  }),
  it("grandfatherclock", "Grandfather Clock", "furniture", ["stand"], "library", 300, 20, 60, (g, f) => {
    g.shadow(10, 8, 59);
    g.stamp((l) => {
      l.rect(3, 10, 14, 48, "#6B4226").rect(1, 4, 18, 8, "#6B4226").rect(2, 2, 16, 2, "#8A5A34");
      l.rect(6, 22, 8, 26, "#3E2614").rect(2, 56, 16, 3, "#5A3820");
      l.ell(10, 8, 4, 3.4, "#FFF6DF");
    }, "#1E120A");
    const sw = Math.round(Math.sin(f * 0.26) * 2.5);
    g.line(10, 23, 10 + sw, 40, "#D9A441");
    g.stamp((l) => l.ell(10 + sw, 42, 2, 2, "#FFD23F"), "#4A3100");
    const m = (f % 720) / 720 * TAU;
    g.line(10, 8, 10 + Math.round(Math.sin(m) * 3), 8 - Math.round(Math.cos(m) * 2.5), "#1A1A22").px(10, 8, "#C8453B");
  }),

  // ---------------------------------------------------------- garden
  it("tulips", "Tulip Planter", "furniture", ["stand", "top"], "greenhouse", 80, 24, 20, (g, f) => {
    const cols = ["#FF4D6D", "#FFD23F", "#FF8FC0", "#8E5CFF", "#FF8A3D"];
    for (let i = 0; i < 5; i++) {
      const x = 4 + i * 4, sw = Math.round(Math.sin(f * 0.1 + i) * 0.7);
      g.line(x, 13, x + sw, 5 + (i % 2) * 2, "#2E8B3C");
      g.stamp((l) => l.rect(x - 1 + sw, 2 + (i % 2) * 2, 3, 3, cols[i]).px(x + sw, 1 + (i % 2) * 2, cols[i]), "#3A0A14");
    }
    g.stamp((l) => { l.rect(1, 12, 22, 7, "#C8683C").rect(1, 12, 22, 2, "#D9774A"); l.px(4, 15, "#FFFFFF"); }, "#4A1E0A");
  }),
  it("wateringcan", "Watering Can", "furniture", ["top", "stand"], "greenhouse", 60, 20, 14, (g, f) => {
    g.stamp((l) => {
      l.rect(4, 5, 10, 8, "#35A6A0").rect(4, 5, 10, 1, "#6FDCC7").rect(4, 5, 2, 8, "#6FDCC7");
      l.line(14, 9, 18, 4, "#35A6A0").rect(17, 3, 2, 2, "#1F7F71");
      l.ring(9, 5, 3.5, "#1F7F71", (t) => t < 0.5);
    }, "#0C2A26");
    if (f % 36 < 12) for (let i = 0; i < 3; i++) g.px(19 - (f % 12 < 6 ? 0 : 1), 6 + i * 3 + ((f >> 1) % 3), "#7FC6FF");
  }),
  it("pond", "Lily Pond", "floor", ["rug"], "greenhouse", 500, 66, 18, (g, f) => {
    g.stamp((l) => {
      l.ell(33, 9, 31, 8, (nx, ny) => {
        const d = nx * nx + ny * ny;
        if (d > 0.82) return (Math.floor(nx * 20) + Math.floor(ny * 4)) % 2 ? "#9A9CA3" : "#7E8088";
        return d > 0.6 ? "#2F80C0" : "#4FA8E0";
      });
    }, "#1E2A3A");
    for (const [x, y] of [[18, 8], [44, 10]]) g.stamp((l) => l.ell(x, y, 4, 2, (nx, ny) => (nx > 0.3 && Math.abs(ny) < 0.3 ? null : "#3FA35E")), "#123A1E");
    g.px(19, 7, "#FF8FC0").px(20, 7, "#FFFFFF");
    const t = (f % 96) / 96, fx = 14 + t * 38, fy = 9 + Math.sin(t * TAU * 2);
    g.rect(Math.round(fx), Math.round(fy), 3, 1, "#FF8A2A").px(Math.round(fx) - 1, Math.round(fy), "#FFB36B");
    const r = ((f % 48) / 48) * 6;
    g.ring(32, 8, r + 1, r < 4 ? "#BFEFFF" : "#8FD0F0", (a) => a > 0.5);
  }),
  it("bonsai", "Bonsai Tree", "furniture", ["top", "stand"], "greenhouse", 220, 20, 20, (g, f) => {
    g.stamp((l) => { l.line(10, 16, 9, 11, "#6B3A1E"); l.line(9, 11, 5, 8, "#6B3A1E"); l.line(9, 12, 14, 8, "#6B3A1E"); }, "#2A160A");
    g.stamp((l) => {
      for (const [x, y, r] of [[5, 6, 3.5], [14, 6, 3.8], [10, 3, 3.2]]) l.ell(x + Math.round(Math.sin(f * 0.06 + x) * 0.5), y, r, r * 0.7, (nx, ny) => (ny < -0.2 ? "#7FCB6A" : "#3F9A4E"));
    }, "#123A1E");
    g.stamp((l) => l.rect(3, 16, 14, 3, "#35A6A0").rect(5, 19, 10, 1, "#1F7F71"), "#0C2A26");
  }),
  it("gnome", "Garden Gnome", "furniture", ["stand", "top"], "greenhouse", 150, 14, 22, (g, f) => {
    g.shadow(7, 5, 21);
    g.stamp((l) => {
      for (let j = 0; j < 8; j++) l.rect(7 - Math.floor(j / 2) - 1, 1 + j, 2 + Math.floor(j / 2) * 2, 1, "#E0393E");
      l.ell(7, 11, 3, 2.3, "#F2C89B").ell(7, 14, 4, 3, "#FFFFFF");
      l.rect(3, 15, 8, 5, "#2F80E6").rect(3, 19, 3, 2, "#6B3A1E").rect(8, 19, 3, 2, "#6B3A1E");
      l.px(5, 11, f % 60 < 3 ? "#F2C89B" : "#1A1A22").px(8, 11, f % 60 < 3 ? "#F2C89B" : "#1A1A22").px(6, 12, "#FF8FA3");
    }, "#2A1E16");
  }),
  it("sunflowers", "Tall Sunflowers", "furniture", ["stand"], "greenhouse", 100, 22, 48, (g, f) => {
    for (const [x, top, i] of [[6, 6, 0], [15, 12, 1]]) {
      const sw = Math.round(Math.sin(f * 0.07 + i) * 1);
      g.stamp((l) => { l.line(x, 44, x + sw, top + 3, "#2E8B3C"); l.ell(x - 3, 28 - i * 4, 2.5, 1.2, "#3FA35E").ell(x + 3, 34 - i * 3, 2.5, 1.2, "#3FA35E"); }, "#123A1E");
      g.stamp((l) => {
        for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; l.px(x + sw + Math.cos(a) * 4, top + Math.sin(a) * 4, "#FFC53D").px(x + sw + Math.cos(a) * 3, top + Math.sin(a) * 3, "#FFD23F"); }
        l.ell(x + sw, top, 2.4, 2.4, (nx, ny) => ((Math.floor(nx * 4) + Math.floor(ny * 4)) % 2 ? "#6B3A1E" : "#8A5A34"));
      }, "#4A3100");
    }
    g.stamp((l) => l.rect(2, 42, 18, 5, "#8A5A34").rect(2, 42, 18, 1, "#B07A4A"), "#2A160A");
  }),

  // ---------------------------------------------------------- arcade
  it("arcadecabinet", "Arcade Cabinet", "furniture", ["stand"], "arcade", 800, 30, 60, (g, f) => {
    g.shadow(15, 13, 59);
    g.stamp((l) => {
      l.rect(3, 2, 24, 8, "#8E5CFF").rect(1, 10, 28, 48, "#3A2A6B").rect(1, 10, 3, 48, "#5A43A0");
      l.rect(5, 12, 20, 16, "#0B0D24");
      l.rect(2, 30, 26, 6, "#5A43A0").rect(2, 30, 26, 1, "#8C75D8");
      l.rect(6, 40, 18, 12, "#2A1E52");
    }, "#0C0820");
    const on = (f >> 3) % 2;
    g.text("PIP", 9, 4, on ? "#FFE36B" : "#FF4DB8", false);
    // The screen: Pip dashing over a book stack.
    const t = f % 32, x = 7 + ((t * 0.5) % 16), jump = t > 14 && t < 22 ? -Math.sin(((t - 14) / 8) * Math.PI) * 5 : 0;
    g.rect(5, 25, 20, 1, "#6CC04A");
    g.rect(16, 22, 3, 3, "#C8453B");
    g.rect(Math.round(x), Math.round(21 + jump), 3, 3, "#6CC04A").px(Math.round(x) + 1, Math.round(20 + jump), "#2FA35E");
    for (let i = 0; i < 3; i++) g.px(7 + i * 6, 14 + ((i + (f >> 4)) % 2), "#FFFFFF");
    g.px(8, 33, "#FF4D6D").px(8, 32, "#FF4D6D").rect(14, 32, 2, 2, on ? "#FFD23F" : "#B08A2A").rect(19, 32, 2, 2, !on ? "#7FE0FF" : "#3A7A8A");
    g.px(15, 45, "#FFD23F").px(14, 46, "#FFD23F");
  }, { glow: [[15, 20, 24, "#7FE0FF"]] }),
  it("tvconsole", "TV & Console", "furniture", ["stand"], "arcade", 500, 46, 38, (g, f) => {
    g.shadow(23, 21, 37);
    g.stamp((l) => { l.rect(2, 26, 42, 10, "#8A5A34").rect(2, 26, 42, 1, "#B07A4A").rect(6, 29, 14, 5, "#5A3820").rect(26, 29, 14, 5, "#5A3820"); l.rect(8, 30, 10, 3, "#3A3F4B").px(16, 31, "#7CFF6B"); }, "#2A160A");
    g.stamp((l) => { l.rect(3, 2, 40, 22, "#1B1B22").rect(20, 24, 6, 2, "#3A3F4B"); }, "#0B0B10");
    // On screen: Leaf Catch — Pip under falling leaves.
    for (let y = 4; y < 22; y++) for (let x = 5; x < 41; x++) g.px(x, y, y > 18 ? "#6CC04A" : lerpC("#5AB8FF", "#BFE6FF", (y - 4) / 14));
    const px = 12 + Math.round(Math.sin(f * 0.15) * 8);
    g.rect(px, 15, 5, 4, "#6CC04A").rect(px, 15, 5, 1, "#A2E477").px(px + 1, 16, "#10231A").px(px + 3, 16, "#10231A").rect(px - 1, 13, 7, 2, "#C8864A");
    for (let i = 0; i < 4; i++) { const y = 4 + ((f * 0.5 + i * 5) % 14), x = 9 + i * 8; g.px(x, Math.round(y), i % 2 ? "#FFD23F" : "#2FA35E").px(x + 1, Math.round(y), i % 2 ? "#FFD23F" : "#2FA35E"); }
    g.px(6, 5, "#FFFFFF88");
  }, { glow: [[23, 13, 30, "#9FD8FF"]] }),
  it("controller", "Game Controller", "furniture", ["top", "rug"], "arcade", 50, 16, 9, (g, f) => {
    g.stamp((l) => {
      l.ell(4, 5, 3.5, 3, "#3A3F4B").ell(12, 5, 3.5, 3, "#3A3F4B").rect(4, 2, 8, 5, "#3A3F4B");
      l.rect(2, 4, 3, 1, "#C9D1DB").rect(3, 3, 1, 3, "#C9D1DB");
      l.px(12, 3, (f >> 3) % 2 ? "#FF4D6D" : "#A8323E").px(13, 5, "#FFD23F").px(11, 5, "#2F80E6");
    }, "#0B0B10");
  }),
  it("clawmachine", "Claw Machine", "furniture", ["stand"], "arcade", 700, 30, 60, (g, f) => {
    g.shadow(15, 13, 59);
    g.stamp((l) => {
      l.rect(1, 1, 28, 6, "#FF6FA8").rect(1, 36, 28, 22, "#FF6FA8").rect(1, 36, 28, 1, "#FFB3D6");
      l.rect(1, 7, 2, 29, "#FF6FA8").rect(27, 7, 2, 29, "#FF6FA8");
      l.rect(3, 7, 24, 29, "#D6F4FF").rect(4, 8, 1, 26, "#FFFFFF");
      l.rect(6, 42, 8, 6, "#3A2A6B").rect(19, 41, 6, 8, "#1B1B22");
    }, "#4A0A24");
    const cols = ["#FFD23F", "#7FE0FF", "#9CE07A", "#FF8A3D", "#C89BFF", "#FF4D6D"];
    for (let i = 0; i < 6; i++) g.stamp((l) => l.ell(6 + i * 3.6, 32 - (i % 2) * 2, 2.2, 2, cols[i]).px(5 + i * 3.6, 31 - (i % 2) * 2, "#1A1A22"), "#3A2A1E");
    const t = (f % 72) / 72, cx = Math.round(8 + Math.sin(t * TAU) * 6 + 7), dy = t > 0.4 && t < 0.6 ? Math.sin(((t - 0.4) / 0.2) * Math.PI) * 12 : 0;
    g.line(cx, 8, cx, 12 + dy, "#5A606E");
    g.stamp((l) => l.rect(cx - 2, 12 + dy, 5, 2, "#C9D1DB").px(cx - 2, 14 + dy, "#C9D1DB").px(cx + 2, 14 + dy, "#C9D1DB"), "#23262E");
    g.text("WIN", 8, 1, (f >> 3) % 2 ? "#FFFFFF" : "#FFE36B", false);
    g.rect(8, 44, 1, 2, "#FF4D6D").px(10, 44, "#FFD23F");
  }, { glow: [[15, 20, 22, "#FFB3D6"]] }),

  // ---------------------------------------------------------- observatory
  it("telescope", "Brass Telescope", "furniture", ["stand"], "observatory", 1000, 48, 54, (g, f) => {
    g.shadow(24, 16, 53);
    g.stamp((l) => { l.line(24, 30, 12, 52, "#6B4226"); l.line(24, 30, 36, 52, "#6B4226"); l.line(24, 30, 24, 52, "#5A3820"); }, "#1E120A");
    g.stamp((l) => {
      // The tube: a thick segment, wider at the eyepiece end, brass bands.
      const ax = 9, ay = 40, bx = 42, by = 7, len = Math.hypot(bx - ax, by - ay);
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        const t = ((x + 0.5 - ax) * (bx - ax) + (y + 0.5 - ay) * (by - ay)) / (len * len);
        if (t < 0 || t > 1) continue;
        const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
        const side = ((x + 0.5 - px) * (by - ay) - (y + 0.5 - py) * (bx - ax)) / len;
        const r = 3.4 - t * 0.9 + (t > 0.9 ? 0.8 : 0);
        if (Math.abs(side) > r) continue;
        const band = Math.abs(t - 0.3) < 0.03 || Math.abs(t - 0.62) < 0.03 || t > 0.93;
        l.px(x, y, band ? "#8A6400" : side < -r * 0.35 ? "#FFE9A0" : side > r * 0.45 ? "#B07A1A" : "#D9A441");
      }
      l.rect(6, 41, 4, 3, "#3A3F4B");
      l.ell(24, 30, 2.6, 2.6, "#6B4226");
    }, "#3A2400");
    if (f % 48 < 6) g.px(44, 3, "#FFFFFF").px(45, 2, "#FFFFFF88").px(43, 4, "#FFFFFF88");
  }),
  it("starmap", "Star Chart", "wall", ["wall"], "observatory", 300, 44, 32, (g, f) => {
    g.stamp((l) => { l.rect(1, 1, 42, 30, "#1B2A5A"); l.rect(1, 1, 42, 1, "#D9A441").rect(1, 30, 42, 1, "#D9A441").rect(1, 1, 1, 30, "#D9A441").rect(42, 1, 1, 30, "#D9A441"); }, "#0A0E24");
    const stars = [[6, 8], [11, 6], [16, 9], [20, 5], [27, 12], [33, 8], [38, 14], [30, 20], [22, 23], [12, 22], [7, 18]];
    const lines = [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10]];
    for (const [a, b] of lines) g.line(stars[a][0], stars[a][1], stars[b][0], stars[b][1], "#3A5AA8");
    stars.forEach(([x, y], i) => { const tw = (f + i * 11) % 40 < 4; g.px(x, y, tw ? "#FFFFFF" : "#FFE36B"); if (tw) g.px(x - 1, y, "#FFFFFF88").px(x + 1, y, "#FFFFFF88"); });
    g.ell(36, 25, 3, 3, (nx, ny) => (nx > 0.3 ? null : "#F4F1E8"));
  }),
  it("orrery", "Orrery", "furniture", ["top", "stand"], "observatory", 600, 26, 26, (g, f) => {
    g.stamp((l) => { l.rect(12, 14, 2, 9, "#8A6400").rect(7, 22, 12, 3, "#6B4226"); }, "#2A1E08");
    g.ring(13, 11, 6, "#8A6400"); g.ring(13, 11, 10, "#6B5A2A", (t) => t % 0.1 < 0.05);
    g.stamp((l) => l.ell(13, 11, 2.6, 2.6, (nx, ny) => (nx + ny < -0.5 ? "#FFF3B0" : "#FFC53D")), "#8A4A00");
    const a1 = f * 0.08, a2 = f * 0.035;
    g.stamp((l) => l.ell(13 + Math.cos(a1) * 6, 11 + Math.sin(a1) * 6 * 0.6, 1.3, 1.3, "#2F80E6"), "#0A1E3A");
    g.stamp((l) => l.ell(13 + Math.cos(a2) * 10, 11 + Math.sin(a2) * 10 * 0.5, 1.7, 1.7, "#E07A3A"), "#3A1A0A");
  }, { glow: [[13, 11, 14, "#FFC53D"]] }),

  // ---------------------------------------------------------- fun
  it("cattower", "Cat Tower", "furniture", ["stand"], "any", 400, 30, 64, (g, f) => {
    g.shadow(15, 13, 63);
    g.stamp((l) => {
      l.rect(12, 14, 5, 46, "#E8D3A8"); for (let y = 16; y < 58; y += 3) l.rect(12, y, 5, 1, "#C9B084");
      l.rect(1, 58, 28, 5, "#8E5CFF").rect(15, 34, 14, 4, "#8E5CFF").rect(3, 12, 20, 4, "#8E5CFF").rect(3, 12, 20, 1, "#C89BFF").rect(15, 34, 14, 1, "#C89BFF");
      l.ell(8, 44, 7, 6, "#7A4BD6").ell(8, 45, 3.5, 3.5, "#2E1E52");
    }, "#1E1238");
    const tail = Math.round(Math.sin(f * 0.15) * 2);
    g.stamp((l) => {
      l.ell(13, 9, 6, 3.4, "#5A5F6B").ell(7, 7, 3.2, 2.8, "#5A5F6B").px(5, 4, "#5A5F6B").px(9, 4, "#5A5F6B").px(5, 5, "#5A5F6B").px(9, 5, "#5A5F6B");
      l.line(19, 10, 22, 13 + tail, "#5A5F6B");
      const bl = f % 72 < 3;
      l.px(6, 7, bl ? "#5A5F6B" : "#FFE36B").px(8, 7, bl ? "#5A5F6B" : "#FFE36B").px(7, 8, "#FF8FA3");
    }, "#14161C");
  }),
  it("piano", "Upright Piano", "furniture", ["stand"], "any", 900, 50, 40, (g, f) => {
    g.shadow(25, 23, 39);
    g.stamp((l) => {
      l.rect(2, 2, 46, 36, "#2A1E1E").rect(2, 2, 46, 2, "#4A3434").rect(2, 20, 46, 3, "#3A2A2A");
      l.rect(4, 23, 42, 4, "#FFFFFF");
      for (let x = 5; x < 46; x += 3) l.rect(x, 23, 1, 3, "#1B1B22");
      l.rect(6, 6, 38, 10, "#3A2A2A").rect(20, 8, 10, 7, "#FFF6DF");
      l.rect(4, 36, 3, 2, "#1B1B22").rect(43, 36, 3, 2, "#1B1B22");
    }, "#0B0808");
    const pressed = (f >> 2) % 14;
    g.rect(5 + pressed * 3 - 1, 26, 2, 1, "#C9D1DB");
    const t = (f % 36) / 36;
    if (t < 0.8) g.stamp((l) => { const x = Math.round(30 + t * 8), y = Math.round(8 - t * 8); l.rect(x + 2, y, 1, 4, "#FF4D6D").px(x + 3, y, "#FF4D6D").rect(x, y + 3, 2, 2, "#FF4D6D"); }, "#1A1A22");
  }),
  it("jukebox", "Jukebox", "furniture", ["stand"], "arcade", 700, 30, 48, (g, f) => {
    g.shadow(15, 13, 47);
    const cols = ["#FF4D6D", "#FF8A3D", "#FFD23F", "#9CE07A", "#7FE0FF", "#C89BFF"];
    g.stamp((l) => {
      l.ell(15, 14, 14, 13, (nx, ny, x, y) => (ny > 0.2 ? null : cols[(Math.floor((Math.atan2(ny, nx) + Math.PI) * 3) + (f >> 2)) % 6]));
      l.ell(15, 15, 9.5, 9, (nx, ny) => (ny > 0.3 ? null : "#6B3A1E"));
      l.rect(1, 16, 28, 31, "#8A3A1E").rect(6, 17, 18, 10, "#1B1B22").rect(4, 30, 22, 14, "#C8453B");
      for (let x = 6; x < 25; x += 3) l.rect(x, 32, 1, 10, "#FFD23F");
    }, "#2A0E06");
    const k = (f >> 2) % 18;
    g.ell(15, 22, 4, 1.2, "#3A3A48").px(11 + (k % 9), 22, "#C9D1DB");
  }, { glow: (f) => [[15, 12, 26, ["#FF4D6D", "#FFD23F", "#7FE0FF"][(f >> 4) % 3]]] }),
  it("fishbowl", "Goldfish Bowl", "furniture", ["top"], "any", 150, 16, 16, (g, f) => {
    g.stamp((l) => l.ell(8, 9, 7, 6, (nx, ny) => (ny < -0.6 ? null : ny > 0.6 ? "#E8C872" : ny < -0.35 ? "#D6F4FF" : "#8FD8F8")), "#1E4A6B");
    g.rect(4, 3, 8, 1, "#BFEFFF");
    const t = (f % 48) / 48, dir = t < 0.5 ? 1 : -1, x = Math.round(t < 0.5 ? 4 + t * 2 * 7 : 11 - (t - 0.5) * 2 * 7);
    g.rect(x, 8, 3, 2, "#FF8A2A").px(x + (dir > 0 ? -1 : 3), 8, "#FFB36B").px(x + (dir > 0 ? -1 : 3), 9, "#FFB36B").px(x + (dir > 0 ? 2 : 0), 8, "#1A1A22");
    if (f % 24 < 12) g.px(x + (dir > 0 ? 3 : -1), 6 - ((f >> 2) % 3), "#FFFFFF");
  }),
  it("hammock", "Hammock", "furniture", ["stand"], "greenhouse", 350, 66, 34, (g, f) => {
    g.shadow(33, 28, 33);
    const sw = Math.sin(f * 0.1) * 1.5;
    g.stamp((l) => { l.rect(2, 4, 3, 29, "#8A5A34").rect(61, 4, 3, 29, "#8A5A34").rect(1, 2, 5, 2, "#6B4226").rect(60, 2, 5, 2, "#6B4226"); }, "#2A160A");
    g.stamp((l) => {
      for (let x = 6; x < 61; x++) {
        const t = (x - 6) / 54, y = 10 + Math.sin(t * Math.PI) * 10 + sw * Math.sin(t * Math.PI);
        l.rect(x, Math.round(y), 1, 3, ((x >> 2) % 2) ? "#FF8A3D" : "#FFD23F");
      }
      l.line(5, 5, 7, 10, "#C9B58C").line(61, 5, 59, 10, "#C9B58C");
      l.ell(18, 15 + sw * 0.6, 5, 2.4, "#FFFFFF");
    }, "#5A2A0A");
  }),
  it("trophywall", "Trophy Wall", "wall", ["wall"], "any", 500, 46, 34, (g, f) => {
    g.stamp((l) => l.rect(1, 1, 44, 32, "#6B4226").rect(3, 3, 40, 28, "#2F5A45"), "#1E120A");
    g.stamp((l) => { l.ell(10, 10, 4, 4, "#FFD23F").rect(8, 14, 2, 6, "#2F80E6").rect(11, 14, 2, 6, "#E0393E"); l.px(9, 9, "#FFFFFF"); }, "#4A3100");
    g.stamp((l) => { l.ell(23, 10, 4, 4, "#DDE3EC").rect(21, 14, 2, 6, "#8E5CFF").rect(24, 14, 2, 6, "#8E5CFF"); }, "#23262E");
    g.stamp((l) => { l.ell(36, 10, 4, 4, "#D98C3A").rect(34, 14, 2, 6, "#1FA36A").rect(37, 14, 2, 6, "#1FA36A"); }, "#3A1E08");
    g.stamp((l) => { for (let i = 0; i < 3; i++) l.rect(6 + i * 13, 24, 8, 3, "#D9A441"); }, "#4A3100");
    const k = f % 72;
    if (k < 12) g.px(6 + k * 3, 8 + (k % 3), "#FFFFFF");
  }),

  // ---------------------------------------------------------- workshop
  it("workbench", "Workbench", "furniture", ["stand"], "workshop", 400, 54, 32, (g, f) => {
    g.shadow(27, 25, 31);
    g.stamp((l) => {
      l.rect(1, 12, 52, 4, "#B07A4A").rect(1, 12, 52, 1, "#D9A06A");
      l.rect(3, 16, 4, 14, "#8A5A34").rect(47, 16, 4, 14, "#8A5A34").rect(3, 24, 48, 2, "#8A5A34");
      l.rect(8, 7, 8, 5, "#5A606E").rect(10, 5, 4, 2, "#8C97A6");
      l.rect(30, 9, 12, 3, "#E8B86B").rect(30, 9, 12, 1, "#F6D69A");
      l.rect(20, 26, 10, 3, "#E0393E").rect(20, 26, 10, 1, "#FF7A7A");
    }, "#2A160A");
    const t = f % 24;
    g.stamp((l) => { const y = t < 4 ? 3 + t : 7 - (t - 4) * 0.2; l.rect(44, Math.round(y) - 1, 2, 7, "#8A5A34").rect(42, Math.round(y) - 3, 6, 3, "#5A606E"); }, "#14161C");
    if (t >= 4 && t < 8) { g.px(40, 8, "#FFE36B").px(49, 7, "#FFE36B"); }
    for (let i = 0; i < 4; i++) g.px(28 + i * 5, 29 + (i % 2), "#E8C872");
  }),
  it("toolboard", "Pegboard Tools", "wall", ["wall"], "workshop", 200, 46, 30, (g) => {
    g.stamp((l) => { l.rect(1, 1, 44, 28, "#C9A06A"); for (let y = 4; y < 28; y += 4) for (let x = 4; x < 44; x += 4) l.px(x, y, "#8A6A3A"); }, "#4A3410");
    g.stamp((l) => { l.rect(6, 5, 2, 16, "#8A5A34").rect(3, 4, 8, 4, "#5A606E"); }, "#14161C");
    g.stamp((l) => { l.rect(16, 6, 2, 16, "#8C97A6").rect(15, 4, 4, 3, "#8C97A6").rect(15, 21, 4, 3, "#8C97A6"); }, "#14161C");
    g.stamp((l) => { l.rect(26, 4, 2, 7, "#E0393E").rect(26.5, 11, 1, 10, "#C9D1DB"); }, "#14161C");
    g.stamp((l) => { l.rect(33, 5, 9, 12, "#DDE3EC"); for (let x = 33; x < 42; x += 2) l.px(x, 17, "#DDE3EC"); l.rect(33, 3, 9, 3, "#8A5A34"); }, "#14161C");
  }),
  it("robotbuddy", "Robot Buddy", "furniture", ["stand", "top"], "workshop", 600, 20, 26, (g, f) => {
    g.shadow(10, 7, 25);
    const bob = (f >> 3) % 2;
    g.stamp((l) => {
      l.rect(9, 1 + bob, 1, 3, "#5A606E").px(9, 0 + bob, (f >> 4) % 2 ? "#FF4D4D" : "#7A2A2A");
      l.rect(3, 4 + bob, 14, 9, "#A9B5C4").rect(3, 4 + bob, 14, 1, "#D5DEE8");
      l.rect(5, 7 + bob, 3, 2, "#7FE7FF").rect(12, 7 + bob, 3, 2, "#7FE7FF").rect(8, 11 + bob, 4, 1, "#39414F");
      l.rect(5, 14, 10, 7, "#8C97A6").rect(8, 16, 4, 2, (f >> 2) % 3 ? "#7CFF6B" : "#2E6B33");
      l.rect(1, 15, 3, 2, "#A9B5C4").rect(16, 15 - (f % 36 < 12 ? 3 : 0), 3, 2, "#A9B5C4");
      l.rect(5, 22, 4, 3, "#5A606E").rect(11, 22, 4, 3, "#5A606E");
    }, "#171D29");
  })
];

export const HOUSE_ITEMS = [...NEW_ITEMS, ...NOD_ITEMS];
export const ALL_ITEMS = [...ROOM_ITEMS, ...HOUSE_ITEMS];

// ============================================================ FIXTURES
// What a floor has that is not decor: never in the shop, a slot or the saved
// layout. home.js stands each where there is room (a level's `fridgeAt`) and
// hands it to renderLevel as a piece placed free. The bedroom's mini fridge,
// shut and open: the door is hinged on the right and swings out past the
// cabinet, and the light inside is a glow, so after dark it pools on the floor.
const FRIDGE = { body: "#8FD3C8", light: "#C6EEE6", shade: "#5FB3A8", edge: "#1F4A4A", chrome: "#E6EDF2", foot: "#3A3F4B", glass: "#BFE6FF" };
const fridgeCabinet = (l) => {
  const c = FRIDGE;
  l.rect(1, 2, 10, 16, c.body).rect(2, 1, 8, 1, c.light).rect(1, 2, 1, 15, c.light);
  l.rect(10, 2, 1, 16, c.shade).rect(1, 17, 10, 1, c.shade);
  l.rect(2, 18, 2, 1, c.foot).rect(8, 18, 2, 1, c.foot);
};
export const FIXTURES = [
  it("minifridge", "Mini Fridge", "furniture", ["stand"], "bedroom", 0, 12, 20, (g) => {
    const c = FRIDGE;
    g.shadow(6, 6, 19);
    g.stamp((l) => {
      fridgeCabinet(l);
      // The freezer's seam, a handle for each door, and what is stuck to the front: a magnet and a note.
      l.rect(1, 6, 10, 1, c.shade);
      l.rect(3, 3, 1, 2, c.chrome).rect(3, 8, 1, 5, c.chrome).px(3, 8, "#FFFFFF");
      l.px(8, 9, "#E0584E").rect(6, 11, 3, 3, "#FFE36B").px(7, 12, "#C9A227").px(6, 13, "#F2CF4A");
    }, c.edge);
  }),
  it("minifridge-open", "Mini Fridge, open", "furniture", ["stand"], "bedroom", 0, 17, 20, (g, f) => {
    const c = FRIDGE;
    g.shadow(8, 8, 19);
    g.stamp((l) => {
      fridgeCabinet(l);
      // Inside, lit from the top: two glass shelves and a few things to stare at.
      l.rect(2, 3, 8, 14, "#FFF6D8").rect(2, 3, 8, 1, "#FFFFFF").rect(2, 16, 8, 1, "#F2E2B0");
      l.rect(2, 7, 8, 1, c.glass).rect(2, 12, 8, 1, c.glass);
      // Milk and a jar of jam; cheese and an apple; carrots and a bottle of something green.
      l.rect(3, 4, 2, 3, "#FFFFFF").rect(3, 4, 2, 1, "#5AB8FF").rect(6, 5, 2, 2, "#C8453B").rect(6, 4, 2, 1, "#FFD23F");
      l.rect(3, 10, 3, 2, "#FFD23F").px(3, 10, "#FFF6D8").px(4, 11, "#E0A800").rect(7, 10, 2, 2, "#E0584E").px(8, 9, "#3FA35E");
      l.rect(3, 15, 3, 1, "#FF8A2A").px(4, 14, "#3FA35E").px(5, 14, "#3FA35E").rect(8, 13, 1, 3, "#6FDCC7").px(8, 13, "#FFFFFF");
      // The door, swung wide: its pale inside, nearer (and so lower) at its free edge, with a rack and a bottle in it.
      const tops = [2, 2, 2, 3, 3];
      const ends = [17, 17, 18, 18, 18];
      for (let i = 0; i < 5; i++) l.rect(11 + i, tops[i], 1, ends[i] - tops[i] + 1, i === 4 ? c.body : i === 0 ? "#C9D6DE" : "#EAF3F8");
      l.rect(12, 12, 3, 1, c.glass).rect(13, 9, 1, 3, "#FF9ACB").px(13, 9, "#FFFFFF");
    }, c.edge);
    // The bulb, with the faintest flicker.
    if (f % 48 !== 7) g.px(5, 3, "#FFE36B").px(6, 3, "#FFE36B");
  }, { glow: [[6, 10, 36, "#E4F3FF"]] }),
  // The light of Pip's phone, late, in bed: nothing to draw (she holds the phone), only what it throws on the pillow and the wall after dark.
  it("phoneglow", "Phone glow", "furniture", ["stand"], "bedroom", 0, 1, 1, () => {}, { glow: [[0, 0, 12, "#BFDFFF"]] })
];

const ITEM = new Map([...ALL_ITEMS, ...FIXTURES].map((i) => [i.id, i]));
const LEVEL = new Map(HOUSE_LEVELS.map((l) => [l.id, l]));
const WP = new Map(WALLPAPERS.map((w) => [w.id, w]));
const FL = new Map(FLOORS.map((w) => [w.id, w]));

// ============================================================ render
/** Top-left position of an item snapped into a slot. */
export function placeAt(item, slot) {
  if (slot.fits === "ceiling") return { x: Math.round(slot.x - item.w / 2), y: slot.y };
  if (slot.fits === "wall" || slot.fits === "window") return { x: Math.round(slot.x - item.w / 2), y: Math.round(slot.y - item.h / 2) };
  return { x: Math.round(slot.x - item.w / 2), y: slot.y - item.h };
}

const ORDER = { window: 0, wall: 1, rug: 2, top: 3, stand: 3, ceiling: 4 };

/** While a level is drawn with `sky: false`: its glass shows nothing, for a sky laid under it. */
let openSky = false;

export function renderLevel(levelId, f = 0, opts = {}) {
  // opts.hour: the real time of day for windows; f then only animates.
  if (opts.hour != null) {
    return withSkyHour(opts.hour, () => renderLevel(levelId, f, { ...opts, hour: null }));
  }
  if (opts.sky === false && !openSky) {
    openSky = true;
    try { return renderLevel(levelId, f, opts); } finally { openSky = false; }
  }
  const L = LEVEL.get(levelId) || HOUSE_LEVELS[0];
  const g = new Painter(L.w, L.h, f);
  (WP.get(opts.wallpaper) || WP.get(L.wallpaper)).draw(g, 0, 0, L.w, FY - 3, f);
  (FL.get(opts.floor) || FL.get(L.floor)).draw(g, 0, FY + 1, L.w, L.h - FY - 1, f);
  for (let x = 0; x < L.w; x++) g.px(x, 0, "#00000022").px(x, 1, "#00000012");
  g.rect(0, FY - 3, L.w, 1, "#B07A4A").rect(0, FY - 2, L.w, 2, "#8A5A34").rect(0, FY, L.w, 1, "#5E3A1F");
  for (let x = 0; x < L.w; x++) g.px(x, FY + 1, "#00000030");
  if (L.decor) L.decor(g, f);

  const list = [];
  for (const p of opts.placed || []) {
    const item = ITEM.get(p.itemId || p.id);
    if (!item) continue;
    const slot = p.slot != null ? L.slots.find((s) => s.id === p.slot) : null;
    let pos, type;
    if (slot) { pos = placeAt(item, slot); type = slot.fits; }
    else if (p.x != null) { pos = { x: Math.round(p.x), y: Math.round(p.y) }; type = (item.fits && item.fits[0]) || "stand"; }
    else continue;
    list.push({ item, pos, type, off: Boolean(p.off) });
  }
  list.sort((a, b) => ORDER[a.type] - ORDER[b.type] || (a.pos.y + a.item.h) - (b.pos.y + b.item.h));
  const glows = [];
  for (const { item, pos, off } of list) {
    const s = new Painter(item.w, item.h, f);
    item.draw(s, f);
    if (off) unlight(s.C.d);
    g.C.blit(s.C, pos.x, pos.y);
    const gl = off ? null : typeof item.glow === "function" ? item.glow(f) : item.glow;
    if (gl) for (const [x, y, r, c] of gl) glows.push([pos.x + x, pos.y + y, r, rgba(c)]);
  }
  if (L.glow) for (const [x, y, r, c] of L.glow) glows.push([x, y, r, rgba(c)]);
  if (opts.night ?? L.night) nightLight(g, glows);
  return g.toImageData();
}

/**
 * A light switched off: its warm, bright pixels (bulb, shade, flame) go dull,
 * and the see-through ones (the light it throws) go altogether.
 */
function unlight(d) {
  for (let i = 0; i < d.length; i++) {
    const c = d[i];
    if (!c) continue;
    const [r, g0, b, a] = rgba(c);
    if (a < 255) { if (r > 200 && g0 > 150) d[i] = null; continue; }
    if (r > 215 && g0 > 150 && b < 215 && r >= b + 30) d[i] = lerpC(c, "#6E6248", 0.72);
  }
}

/** Darken the room to night and let each light pool its glow around it. */
function nightLight(g, glows) {
  const d = g.C.d, w = g.w;
  for (let i = 0; i < d.length; i++) {
    const c = d[i];
    if (!c) continue;
    const x = i % w, y = (i / w) | 0;
    let L = 0, tr = 0, tg = 0, tb = 0;
    for (const [gx, gy, r, col] of glows) {
      const dist = Math.hypot(x - gx, (y - gy) * 1.1);
      if (dist >= r) continue;
      const k = (1 - dist / r) ** 1.4;
      if (k > L) L = k;
      tr += col[0] * k * 0.22; tg += col[1] * k * 0.22; tb += col[2] * k * 0.22;
    }
    const [r0, g0, b0, a] = rgba(c);
    const m = 0.34 + 0.66 * Math.min(1, L * 1.25);
    const out = [r0 * m * (0.78 + 0.22 * L) + tr, g0 * m * (0.82 + 0.18 * L) + tg, b0 * m + tb].map((v) => Math.max(0, Math.min(255, Math.round(v))));
    d[i] = "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("") + (a < 255 ? a.toString(16).padStart(2, "0") : "");
  }
}

/** One decor item (old or new) as its own sprite. */
export function renderHouseItem(item, f = 0) {
  const i = typeof item === "string" ? ITEM.get(item) : item;
  const g = new Painter(i.w, i.h, f);
  i.draw(g, f);
  return g.toImageData();
}

/** A square swatch of a wallpaper or floor, for shop tiles. */
export function renderSwatch(type, id, w = 32, h = 32, f = 0) {
  const src = (type === "floor" ? FL : WP).get(id);
  const g = new Painter(w, h, f);
  // Floors are patterned from FLOOR_Y down; shift so the swatch shows the pattern.
  if (type === "floor") { const t = new Painter(w, FY + h, f); src.draw(t, 0, FY, w, h, f); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g.px(x, y, t.get(x, FY + y)); }
  else src.draw(g, 0, 0, w, h, f);
  return g.toImageData();
}

void blend; void flame;
