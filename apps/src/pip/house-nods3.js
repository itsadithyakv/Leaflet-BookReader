/* Book-nod decor, set three: literary artefacts for Pip's house. Same shape as
 house-nods.js (see house.js for the Painter API, slots and levels):
   { id, name, kind, fits, level, price, w, h, nod, draw(g, f), glow? }
 `nod` names the book, for the app's own mapping only. Public-domain works use
 their real names; works still in copyright get generic names, and every
 drawing is our own (no film or cover designs, logos or inscriptions).
 NOD_WALLPAPERS are shaped like house.js WALLPAPERS ({ id, name, price,
 draw(g, x, y, w, h, f) }) plus `nod`.
 Every draw is a pure function of the frame f (12 fps). */
import { paintSky, rnd, lerpC } from "./room.js";

const TAU = Math.PI * 2;
const wave = (f, per, amp = 1, off = 0) => amp * Math.sin((TAU * f) / per + off);
const it = (id, name, kind, fits, level, price, w, h, nod, draw, extra) => Object.assign({ id, name, kind, fits, level, price, w, h, nod, draw }, extra || {});
const tile = (fn) => (g, x0, y0, w, h, f) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g.px(x, y, fn(x, y, f)); };
const W8 = "#FFFFFFaa";
/** A little four-point twinkle; big adds the soft arms. */
const spark = (g, x, y, big) => { g.px(x, y, "#FFFFFF"); if (big) g.px(x - 1, y, W8).px(x + 1, y, W8).px(x, y - 1, W8).px(x, y + 1, W8); };
/** A three-pixel candle flame, as on the house's Candle Trio. */
const flameTip = (g, x, y, f, i = 0) => { const k = (f + i * 3) % 6 < 3; g.px(x, y, "#FFC53D").px(x + (k ? 0 : -1), y - 1, "#FFE36B").px(x, y - 2, k ? "#FFF3B0" : null); };
const gold = (nx, ny) => (nx + ny < -0.6 ? "#FFF3A6" : nx + ny > 0.6 ? "#B07A1A" : "#FFD23F");
const map = (g, rows, pal, x0, y0, out) => g.stamp((l) => rows.forEach((r, j) => [...r].forEach((ch, i) => pal[ch] && l.px(x0 + i, y0 + j, pal[ch]))), out);

// ============================================================ items
export const NOD_ITEMS_3 = [
  // ---------------------------------------------------------- tragic & gothic
  it("hauntedtypewriter", "Haunted Typewriter", "furniture", ["stand"], "library", 700, 36, 36, "The Shining", (g, f) => {
    // Nobody at the keys: it types by itself, the carriage creeps, the stack of pages grows.
    const P = 30, t = f % (P * 6), page = Math.floor(t / P), u = (t % P) / P;
    const c = -Math.round(u * 4);
    g.shadow(18, 16, 35);
    g.stamp((l) => {
      l.rect(1, 21, 34, 3, "#8A5A34").rect(1, 21, 34, 1, "#B07A4A");
      l.rect(3, 24, 2, 11, "#6B4226").rect(31, 24, 2, 11, "#6B4226").rect(5, 30, 26, 1, "#5E3A1F");
    }, "#2A160A");
    const n = 1 + page + (u > 0.9 ? 1 : 0);
    g.stamp((l) => { for (let i = 0; i < n; i++) l.rect(25 + (rnd(i * 7 + 1) > 0.5 ? 1 : 0), 20 - i, 8, 1, i % 2 ? "#E6E0D2" : "#FFFFFF"); }, "#5A4A36");
    const top = 6 - Math.round(u * 5);
    g.stamp((l) => l.rect(10 + c, top, 10, 10 - top, "#FFFFFF").rect(19 + c, top, 1, 10 - top, "#E6E0D2"), "#5A4A36");
    g.stamp((l) => {
      l.rect(7 + c, 9, 17, 3, "#3A3F4B").rect(7 + c, 9, 17, 1, "#6B7280").rect(5 + c, 9, 2, 3, "#1B1B22").rect(24 + c, 9, 2, 3, "#1B1B22");
      l.rect(25 + c, 7, 1, 2, "#C9D1DB").px(26 + c, 6, "#C9D1DB");
      l.rect(6, 12, 18, 3, "#2A2A33").rect(6, 12, 18, 1, "#4A4A58");
      l.rect(4, 15, 22, 5, "#2A2A33").rect(4, 15, 22, 1, "#4A4A58");
      l.rect(3, 20, 24, 1, "#1B1B22");
      for (let x = 6; x < 25; x += 2) l.px(x, 16, "#DDE3EC");
      for (let x = 7; x < 24; x += 2) l.px(x, 18, "#DDE3EC");
    }, "#0B0B10");
    if (u < 0.88) {
      const k = Math.floor(rnd(Math.floor(f / 2) + 3) * 19), row = k % 2, x = row ? 7 + (k >> 1) * 2 : 6 + (k >> 1) * 2;
      g.px(Math.min(x, 24), row ? 18 : 16, "#7FE0FF");
      if (f % 2 === 0) g.px(15, 12, "#C9D1DB").px(15, 11, "#8C97A6");
    } else spark(g, 27 + c, 5, true);
    for (let i = 0; i < 2; i++) { const t2 = ((f + i * 9) % 18) / 18; g.px(9 + i * 10 + Math.round(wave(f, 12, 1, i)), 14 - Math.round(t2 * 6), t2 < 0.5 ? "#CFEFFFaa" : "#CFEFFF55"); }
  }, { glow: [[15, 15, 20, "#9FD8FF"]] }),

  it("dorianportrait", "Dorian Gray's Portrait", "wall", ["wall"], "any", 1200, 24, 30, "The Picture of Dorian Gray", (g, f) => {
    // The sitter ages and darkens across the loop, then the canvas renews itself.
    const L = 288, t = f % L, renew = t >= 266, s = renew ? 0 : Math.min(3, Math.floor(t / 66));
    const bg = ["#4A6A52", "#3E5442", "#2E3A2C", "#1E221A"][s], bg2 = ["#3A5642", "#304234", "#222C20", "#141810"][s];
    const skin = ["#F6CFA8", "#E2BE98", "#BCA884", "#9A9270"][s], skinSh = ["#E0A882", "#C49C78", "#9A8A68", "#7A7458"][s];
    const hair = ["#6B3E1E", "#6A5040", "#8C8274", "#B4B0A6"][s], hairHi = ["#A0602E", "#8A6E58", "#A8A092", "#D4D0C6"][s];
    const coat = ["#2E3050", "#2A2A40", "#26262E", "#1E1E22"][s], lips = ["#D8606A", "#B8666A", "#8A6660", "#6A5A50"][s];
    const inC = (x, y) => x >= 4 && x < 20 && y >= 4 && y < 26;
    for (let y = 4; y < 26; y++) for (let x = 4; x < 20; x++) g.px(x, y, (x - 12) ** 2 / 64 + (y - 13) ** 2 / 121 > 0.55 ? bg2 : bg);
    g.ell(12, 27, 7.5, 8, (nx, ny, x, y) => (inC(x, y) ? (nx > 0.5 ? lerpC(coat, "#000000", 0.3) : coat) : null));
    g.rect(11, 16, 3, 3, skinSh);
    g.ell(12, 11, 3.6, 4.6, (nx, ny) => (nx > 0.45 ? skinSh : skin));
    g.ell(12, 8, 4.4, 3, (nx, ny, x, y) => (ny < 0.2 || x < 9 || x > 15 ? ((x + y) % 3 === 0 ? hairHi : hair) : null));
    if (s < 3) g.px(8, 11, hair).px(16, 11, hair); else g.px(8, 12, hair);
    g.rect(10, 19, 5, 2, "#F4F1E8").px(12, 21, "#F4F1E8").px(12, 19, "#DDE3EC");
    g.px(10, 11, s < 2 ? "#3A5A9A" : "#5A5A40").px(14, 11, s < 2 ? "#3A5A9A" : "#5A5A40");
    g.px(10, 10, hair).px(14, 10, hair);
    if (s === 0) g.rect(11, 14, 3, 1, lips).px(10, 13, skinSh).px(14, 13, skinSh);
    else g.rect(11, 14, 3, 1, lips).px(10, 15, skinSh).px(14, 15, skinSh);
    if (s >= 1) g.px(10, 12, skinSh).px(14, 12, skinSh);
    if (s >= 2) g.rect(10, 9, 5, 1, skinSh).px(9, 13, skinSh).px(15, 13, skinSh);
    if (s >= 3) { g.px(11, 12, skinSh).px(13, 12, skinSh).px(12, 15, skinSh); for (const [x, y] of [[5, 6], [6, 7], [17, 20], [18, 21], [16, 5], [7, 22]]) g.px(x, y, "#0B0B08"); }
    if (renew) for (let i = 0; i < 4; i++) { const k = (t - 266 + i * 5) % 22; if (k < 6) spark(g, 5 + Math.floor(rnd(i * 3 + 1) * 14), 5 + Math.floor(rnd(i * 5 + 2) * 19), k < 3); }
    // The gilt frame.
    g.stamp((l) => {
      for (let y = 1; y < 29; y++) for (let x = 1; x < 23; x++) {
        if (x >= 4 && x < 20 && y >= 4 && y < 26) continue;
        const e = Math.min(x - 1, y - 1, 22 - x, 28 - y);
        l.px(x, y, e === 1 ? "#FFD23F" : e === 0 ? (x + y < 24 || (x < 3 && y < 26) || (y < 3 && x < 20) ? "#FFE36B" : "#B07A1A") : "#8A6400");
      }
      for (const [x, y] of [[2, 2], [20, 2], [2, 26], [20, 26]]) l.rect(x, y, 2, 2, "#FFF3A6").px(x + 1, y + 1, "#D9A441");
      l.rect(10, 1, 4, 1, "#FFF3A6");
    }, "#3A2400");
    if (f % 96 < 10) g.px(3 + (f % 96) * 2, 2, "#FFFFFF");
  }),

  it("yorickskull", "Yorick's Skull", "furniture", ["top"], "library", 450, 18, 18, "Hamlet", (g, f) => {
    // The old jester still has a chuckle in him.
    const t = f % 72, laugh = t < 14 && t % 7 < 4 ? 1 : 0;
    g.stamp((l) => {
      l.ell(9, 14.5, 7.5, 3, (nx, ny) => (ny < -0.3 ? "#C8303F" : nx + ny > 0.6 ? "#6A0A1A" : "#8A1428"));
      l.px(9, 13, "#E0584E");
      l.px(2, 15, "#FFD23F").px(2, 16, "#D9A441").px(16, 15, "#FFD23F").px(16, 16, "#D9A441");
    }, "#2A0408");
    g.stamp((l) => {
      l.ell(9, 6.5, 5.5, 5, (nx, ny) => (nx + ny < -0.7 ? "#FFFFFF" : nx + ny > 0.5 ? "#D6CCB0" : "#F2EBD8"));
      l.rect(6, 10, 7, 2, "#E6DCC4");
      l.rect(7, 12 + laugh, 5, 2, "#E6DCC4").rect(7, 13 + laugh, 5, 1, "#D6CCB0");
      for (let x = 7; x < 12; x++) l.px(x, 11, x % 2 ? "#FFFFFF" : "#C9C0A8").px(x, 12 + laugh, x % 2 ? "#FFFFFF" : "#C9C0A8");
    }, "#3A3428");
    g.rect(6, 7, 2, 2, "#3A3428").rect(10, 7, 2, 2, "#3A3428").px(9, 9, "#6A6050").px(8, 10, "#8A8068");
    if (laugh) g.px(6, 7, "#5A5448").px(10, 7, "#5A5448");
    if (f % 48 < 3) g.px(6, 3, "#FFFFFF");
  }),

  it("atticveil", "The Attic Veil", "furniture", ["stand"], "bedroom", 650, 28, 52, "Jane Eyre", (g, f) => {
    // A long bridal veil over a dress form, drifting in a draught that isn't there.
    const cx = 14;
    g.shadow(cx, 9, 51);
    g.stamp((l) => {
      l.rect(13, 28, 2, 19, "#6B4226").rect(13, 28, 1, 19, "#8E5C36");
      l.line(13, 46, 6, 50, "#5E3A1F").line(14, 46, 21, 50, "#5E3A1F").rect(13, 47, 2, 3, "#5E3A1F");
    }, "#1E120A");
    const drift = (y) => Math.round(Math.sin((TAU * f) / 60 - y * 0.15) * Math.min(2, Math.max(0, (y - 8) / 14)));
    // The back of the veil: a long sheer fall, wider than the form, ending in a lace hem.
    g.stamp((l) => {
      for (let y = 6; y < 42; y++) {
        const half = Math.min(10, 2 + (y - 6) * 0.55), d = drift(y), x0 = Math.round(cx - half + d), x1 = Math.round(cx + half + d);
        for (let x = x0; x <= x1; x++) l.px(x, y, (x - d + 40) % 3 === 0 ? "#E4E8F4" : "#F7F8FF");
      }
      for (let x = -10; x <= 10; x++) if ((x + 20) % 3 !== 1) l.px(cx + x + drift(41), 42, "#F7F8FF");
    }, "#8C97B0");
    // The dress form.
    const HW = [3, 6, 7, 7, 6.5, 6, 5.5, 5, 4.5, 4.5, 4.5, 5, 5.5, 6, 6.5, 6.5, 6, 5, 3.5];
    g.stamp((l) => {
      HW.forEach((hw, j) => { const y = 9 + j; for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) l.px(x, y, x < cx - hw + 1.5 ? "#E8DCC4" : x > cx + hw - 2.5 ? "#8A7A62" : "#B8A888"); });
      l.rect(cx, 11, 1, 15, "#9A8A70");
      l.rect(12, 5, 4, 4, "#8A5A34").rect(12, 5, 4, 1, "#B07A4A").px(13, 4, "#8A5A34").px(14, 4, "#8A5A34");
    }, "#3A2E20");
    // Its sheer front fall over the shoulders, and a band of little white blossoms.
    for (let y = 8; y < 24; y++) {
      const half = 3 + (y - 8) * 0.5, d = drift(y), x0 = Math.round(cx - half + d), x1 = Math.round(cx + half + d);
      for (let x = x0; x <= x1; x++) g.px(x, y, (x - d) % 3 === 0 ? "#FFFFFF77" : "#FFFFFF55");
      g.px(x0, y, "#FFFFFFaa").px(x1, y, "#FFFFFFaa");
    }
    for (let x = -5; x <= 5; x++) if ((x + 20) % 2) g.px(cx + x + drift(24), 24, "#FFFFFFcc");
    g.stamp((l) => { for (let x = 10; x < 19; x += 2) l.px(x, 6 + (x % 4 === 0 ? 0 : 1), "#FFFFFF"); }, "#8C97B0");
  }),
  it("monkeypaw", "The Monkey's Paw", "furniture", ["top"], "library", 550, 16, 22, "The Monkey's Paw", (g, f) => {
    // Three wishes: one finger at a time curls, holds, and slowly lets go.
    const wish = Math.floor(f / 64) % 3, t = f % 64, curl = t >= 16 && t < 22 ? 1 : t >= 22 && t < 46 ? 2 : t >= 46 && t < 52 ? 1 : 0;
    g.stamp((l) => l.rect(2, 19, 12, 2, "#6B4226").rect(2, 19, 12, 1, "#8E5C36"), "#1E120A");
    g.stamp((l) => l.ell(8, 17.5, 4.5, 1.5, (nx, ny) => (ny < 0 ? "#3E7A4A" : "#2E5A3A")), "#10231A");
    g.stamp((l) => {
      l.rect(7, 14, 3, 3, "#7A5A3A").px(7, 14, "#9A7A52");
      l.ell(8.5, 12, 3, 2, (nx, ny) => (nx + ny < -0.4 ? "#A8885E" : "#8A6A48"));
      l.line(5, 12, 4, 9, "#8A6A48");
      for (let i = 0; i < 3; i++) {
        const x = 6 + i * 2, c = i === wish ? curl : 0;
        if (c === 0) l.rect(x, 5, 1, 6, "#8A6A48").px(x, 7, "#6B4E32");
        else if (c === 1) l.rect(x, 7, 1, 4, "#8A6A48").px(x + (i === 2 ? -1 : 1), 6, "#8A6A48");
        else l.rect(x, 9, 1, 2, "#6B4E32");
      }
    }, "#2A1E10");
    for (let i = 0; i < 3; i++) if (!(i === wish && curl)) g.px(6 + i * 2, 5, "#4A3622");
    if (curl === 2 && t < 30) spark(g, 11, 4, t % 4 < 2);
    for (let y = 2; y < 19; y++) for (let x = 2; x < 14; x++) {
      const inG = y >= 8 ? true : (x + 0.5 - 8) ** 2 + ((y + 0.5 - 8) * 1.1) ** 2 < 36;
      if (!inG) continue;
      const edge = x === 2 || x === 13 || (y < 8 && (x + 0.5 - 8) ** 2 + ((y + 0.5 - 8) * 1.1) ** 2 > 25);
      if (edge) g.px(x, y, "#BFEFFF"); else if (x === 3 && y > 5 && y < 15) g.px(x, y, "#FFFFFF88");
    }
  }),
  it("greencarnation", "Green Carnation", "furniture", ["top"], "any", 180, 12, 22, "The Picture of Dorian Gray", (g, f) => {
    const sw = Math.round(wave(f, 72, 0.7));
    g.stamp((l) => { l.line(6, 15, 6 + sw, 7, "#2E8B3C"); l.px(5, 12, "#3FA35E").px(4, 11, "#3FA35E").px(7, 11, "#3FA35E").px(8, 10, "#3FA35E"); }, "#123A1E");
    g.stamp((l) => {
      l.ell(6 + sw, 4.5, 4, 2.8, (nx, ny, x, y) => ((x + y) % 2 === 0 && ny < 0.1 ? "#B8F5A8" : nx + ny > 0.5 ? "#2E9A48" : "#5FD06A"));
      for (let x = 3; x < 10; x += 2) l.px(x + sw, 1 + (x % 4 === 1 ? 0 : 1), "#8FE88A");
      l.rect(5 + sw, 7, 3, 2, "#2E8B3C");
    }, "#0E3A1A");
    g.stamp((l) => {
      l.rect(5, 12, 2, 4, "#DDE3EC").px(5, 12, "#FFFFFF");
      l.ell(6, 18, 3.5, 3, (nx, ny) => (nx + ny < -0.4 ? "#FFFFFF" : nx + ny > 0.5 ? "#8C97A6" : "#C9D1DB"));
      l.rect(3, 20, 6, 1, "#8C97A6");
    }, "#23262E");
    if (f % 60 < 3) g.px(4, 17, "#FFFFFF");
  }),

  it("scarletletter", "The Scarlet Letter", "wall", ["wall"], "any", 400, 22, 26, "The Scarlet Letter", (g, f) => {
    g.stamp((l) => {
      l.rect(1, 1, 20, 24, "#5E3A1F").rect(1, 1, 20, 1, "#8A5A34").rect(1, 1, 1, 24, "#8A5A34");
      for (let y = 3; y < 23; y++) for (let x = 3; x < 19; x++) l.px(x, y, (x + y) % 4 === 0 ? "#DCCFB4" : (x * 3 + y) % 7 === 0 ? "#F4ECD8" : "#E8DCC4");
    }, "#1E120A");
    // An embroidered A, edged all round in gold thread.
    map(g, [
      ".....r.....",
      "....rrd....",
      "....rrd....",
      "...rr.rd...",
      "...rr.rd...",
      "..rr...rd..",
      "..rrrrrrd..",
      ".rr.....rd.",
      ".rr.....rd.",
      "rrr.....rdd"
    ], { r: "#D0203A", d: "#8A1020" }, 5, 8, "#FFD23F");
    g.px(4, 19, "#D9A441").px(3, 18, "#D9A441").px(17, 19, "#D9A441").px(18, 18, "#D9A441").px(10, 6, "#D9A441").px(9, 5, "#D9A441").px(11, 5, "#D9A441");
    const pts = [[10, 7], [7, 11], [14, 13], [5, 16], [16, 18], [10, 14]], k = f % 72;
    if (k < 24) { const [x, y] = pts[Math.floor(k / 4)]; g.px(x, y, "#FFFFFF"); }
  }),

  it("telltaleboard", "The Tell-Tale Floorboard", "floor", ["rug"], "any", 500, 34, 15, "The Tell-Tale Heart", (g, f) => {
    // A loose board that goes lub-dub, lub-dub.
    const t = f % 20, lift = t < 2 ? 2 : t >= 5 && t < 7 ? 1 : 0, beat = t < 3 || (t >= 5 && t < 8);
    g.stamp((l) => {
      for (const [y, c] of [[5, "#B77B48"], [11, "#A56A3B"]]) { l.rect(1, y, 32, 3, c).rect(1, y + 2, 32, 1, "#7A4A26"); l.px(3, y + 1, "#5E3A1F").px(30, y + 1, "#5E3A1F"); }
      l.rect(1, 8, 32, 3, "#2A1A0E");
    }, "#3E2614");
    g.stamp((l) => {
      for (let x = 2; x < 32; x++) { const dy = -Math.round(lift * (x - 2) / 29); l.px(x, 8 + dy, "#CC9460").px(x, 9 + dy, "#B77B48").px(x, 10 + dy, x % 9 === 0 ? "#7A4A26" : "#A56A3B"); }
      l.px(4, 9, "#5E3A1F").px(29, 9 - lift, lift ? "#C9D1DB" : "#5E3A1F");
    }, "#3E2614");
    if (lift === 2) g.px(31, 6, "#E8D8B8").px(32, 5, "#E8D8B888").px(30, 5, "#E8D8B8");
    if (beat) {
      const big = lift > 0, hx = 16, hy = big ? 0 : 1;
      g.stamp((l) => big
        ? l.rect(hx - 3, hy + 1, 3, 2, "#E0393E").rect(hx + 1, hy + 1, 3, 2, "#E0393E").rect(hx - 3, hy + 2, 7, 1, "#E0393E").rect(hx - 2, hy + 3, 5, 1, "#E0393E").px(hx, hy + 4, "#E0393E").px(hx - 2, hy + 1, "#FF8A8A")
        : l.px(hx - 1, hy + 1, "#E0393E").px(hx + 1, hy + 1, "#E0393E").rect(hx - 1, hy + 2, 3, 1, "#E0393E").px(hx, hy + 3, "#E0393E"), "#4A0A10");
    }
  }),

  it("blackveil", "The Minister's Black Veil", "furniture", ["stand"], "any", 380, 20, 50, "The Minister's Black Veil", (g, f) => {
    // A hat stand, a wide black hat, and the black crape veil hanging from its brim, stirring.
    g.shadow(10, 7, 49);
    g.stamp((l) => {
      l.rect(9, 8, 2, 38, "#6B4226").rect(9, 8, 1, 38, "#8E5C36");
      l.line(9, 45, 3, 48, "#5E3A1F").line(10, 45, 16, 48, "#5E3A1F").rect(9, 45, 2, 3, "#5E3A1F");
      l.line(8, 28, 4, 25, "#8E5C36").line(11, 28, 15, 25, "#8E5C36").px(4, 24, "#8E5C36").px(15, 24, "#8E5C36");
    }, "#1E120A");
    const sw = (y) => Math.round(wave(f, 72, 1, -y * 0.25) * Math.max(0, (y - 12) / 9));
    g.stamp((l) => {
      for (let y = 10; y < 22; y++) {
        const x0 = 5 + sw(y), x1 = 14 + sw(y);
        for (let x = x0; x <= x1; x++) { const k = (x - sw(y) - 5) % 3; l.px(x, y, k === 1 ? "#4A4A5A" : k === 2 ? "#26262E" : "#34343F"); }
      }
      for (let x = 5; x <= 14; x++) l.px(x + sw(22), 22 + ((x + 1) % 3 === 0 ? 1 : 0), "#34343F");
    }, "#0B0B10");
    g.stamp((l) => {
      l.rect(2, 8, 16, 2, "#2A2A33").rect(2, 8, 16, 1, "#5A5A6A");
      l.rect(6, 3, 8, 5, "#2A2A33").rect(6, 3, 8, 1, "#5A5A6A").rect(6, 3, 1, 5, "#4A4A58").rect(6, 6, 8, 1, "#6B6E7A");
    }, "#0B0B10");
  }),
  it("ahabdoubloon", "Ahab's Doubloon", "furniture", ["stand"], "any", 600, 18, 46, "Moby-Dick", (g, f) => {
    // A gold coin nailed to a stub of mast, winking at whoever looks.
    g.shadow(9, 8, 45);
    g.stamp((l) => {
      l.rect(5, 3, 8, 37, "#8A5A34").rect(5, 3, 2, 37, "#B07A4A").rect(11, 3, 2, 37, "#6B4226");
      for (let y = 5; y < 38; y += 4) l.px(8 + (y % 8 === 1 ? 1 : 0), y, "#6B4226").px(8 + (y % 8 === 1 ? 1 : 0), y + 1, "#6B4226");
      for (const y of [8, 31]) l.rect(4, y, 10, 2, "#5A606E").rect(4, y, 10, 1, "#8C97A6");
      l.rect(4, 1, 10, 3, "#6B4226").rect(4, 1, 10, 1, "#8E5C36");
      l.rect(1, 40, 16, 4, "#6B4226").rect(1, 40, 16, 1, "#8E5C36");
    }, "#1E120A");
    g.stamp((l) => { l.ell(9, 38.5, 7, 2, (nx, ny, x) => ((x + (ny > 0 ? 1 : 0)) % 2 ? "#D8C08A" : "#B89A60")); }, "#4A3410");
    g.stamp((l) => {
      l.ell(9, 18.5, 4, 4, (nx, ny) => (nx * nx + ny * ny > 0.55 ? (nx + ny < -0.3 ? "#FFF3A6" : "#D9A441") : "#FFD23F"));
      l.px(8, 19, "#C8901A").px(9, 18, "#C8901A").px(10, 19, "#C8901A").rect(7, 20, 5, 1, "#C8901A");
    }, "#4A3100");
    g.px(9, 15, "#3A3F4B");
    const k = f % 48;
    if (k < 12) { const a = (k / 12) * TAU; spark(g, 9 + Math.round(Math.cos(a) * 3.5), 18 + Math.round(Math.sin(a) * 3.5), k % 6 < 3); }
  }, { glow: [[9, 18, 8, "#FFD23F"]] }),
  it("albatross", "The Albatross", "ceiling", ["ceiling"], "any", 900, 52, 30, "The Rime of the Ancient Mariner", (g, f) => {
    // A great white seabird on a thread, slowly turning.
    const a = (f / 192) * TAU, c = Math.cos(a), s = Math.sin(a), bob = Math.round(wave(f, 48, 0.8));
    const cx = 26, cy = 18 + bob, span = 4 + 20 * Math.abs(c), flap = wave(f, 36, 1), dir = s >= 0 ? 1 : -1, side = Math.abs(s) > 0.35;
    g.line(26, 0, 26, cy - 3, "#8C8F96");
    g.stamp((l) => {
      for (const d of [-1, 1]) for (let i = 1; i <= span; i++) {
        const u = i / 24, y = cy - 1 + Math.round(-Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5) * 2 + u * u * flap * 2), x = cx + d * i;
        const th = i < span * 0.4 ? 3 : i < span * 0.8 ? 2 : 1, tip = i > span - 4;
        for (let k = 0; k < th; k++) l.px(x, y + k, tip ? (k ? "#3A3F4B" : "#2A2A33") : k === th - 1 && th > 1 ? "#C9CED8" : "#FFFFFF");
      }
      const rx = 3 + 4 * Math.abs(s);
      l.ell(cx, cy + 0.5, rx, 2.4, (nx, ny) => (ny > 0.3 ? "#DDE3EC" : "#FFFFFF"));
      if (side) {
        const hx = cx + dir * (rx + 0.5);
        l.ell(hx, cy - 1, 2.2, 1.9, "#FFFFFF");
        l.px(hx + dir * 2, cy - 1, "#FFC878").px(hx + dir * 3, cy - 1, "#FFC878").px(hx + dir * 4, cy - 1, "#FFC878").px(hx + dir * 4, cy, "#E0A060");
        l.px(cx - dir * (rx + 1), cy + 1, "#3A3F4B").px(cx - dir * (rx + 2), cy + 1, "#3A3F4B");
      } else l.ell(cx, cy - 1.5, 2.2, 1.9, "#FFFFFF").px(cx, cy, "#FFC878").px(cx, cy + 1, "#E0A060");
    }, "#3A3F4B");
    if (side) g.px(cx + dir * (3 + 4 * Math.abs(s) + 0.5), cy - 2, "#1A1A22");
    else g.px(cx - 1, cy - 2, "#1A1A22").px(cx + 1, cy - 2, "#1A1A22");
  }),


  // ---------------------------------------------------------- society & myth
  it("islandconch", "Island Conch Shell", "furniture", ["top"], "any", 300, 18, 14, "Lord of the Flies", (g, f) => {
    g.stamp((l) => { l.rect(3, 12, 12, 1, "#8A5A34").rect(4, 10, 2, 2, "#6B4226").rect(12, 10, 2, 2, "#6B4226"); }, "#1E120A");
    g.stamp((l) => {
      for (let x = 1; x < 14; x++) {
        const u = (x - 1) / 13, half = 0.8 + u * 3.4;
        for (let y = Math.round(7 - half); y <= Math.round(7 + half * 0.8); y++) l.px(x, y, (x + y) % 3 === 0 ? "#E8C8A0" : y < 7 - half * 0.3 ? "#FFF0DA" : y > 7 + half * 0.4 ? "#D8B48A" : "#F2D6B0");
      }
      for (const x of [5, 8, 11]) l.px(x, Math.round(7 - (0.8 + ((x - 1) / 13) * 3.4)) - 1, "#F2D6B0");
      l.ell(14, 7.5, 2.8, 3.8, (nx, ny) => (nx < -0.3 ? null : nx + ny < 0 ? "#FFC0CE" : "#F07A98"));
      l.ell(14.6, 8, 1.1, 2.2, "#C8506E");
    }, "#5A3A28");
    const k = f % 60;
    if (k < 14) g.px(2 + k, 7 - Math.round((0.8 + (k / 13) * 3.4) * 0.6), "#FFFFFF");
    if (k >= 40 && k < 52) { const r = (k - 40) / 4; for (let j = -1; j <= 1; j++) g.px(Math.round(17 + r * 0.4), 7 + j * Math.round(1 + r), "#FFFFFF99"); }
  }),

  it("crackedspecs", "Cracked Spectacles", "furniture", ["top"], "any", 220, 18, 10, "Lord of the Flies", (g, f) => {
    // One lens cracked; the other catches the sun and flares.
    const k = f % 60, flare = k >= 18 && k < 26;
    g.stamp((l) => { l.line(1, 7, 16, 8, "#6B4A2E"); l.line(1, 8, 16, 7, "#6B4A2E"); }, "#2A1A0E");
    g.stamp((l) => {
      for (const [cx, cr] of [[4.5, 0], [13.5, 1]]) l.ell(cx, 5, 3.6, 3.6, (nx, ny) => (nx * nx + ny * ny > 0.5 ? "#3A2A1E" : cr ? "#B8D8E8" : nx + ny < -0.4 ? "#E6F6FF" : "#C6E6F6"));
      l.rect(8, 4, 2, 1, "#3A2A1E");
    }, "#1A1008");
    g.px(12, 3, "#FFFFFF").px(13, 4, "#FFFFFF").px(13, 5, "#FFFFFF").px(14, 6, "#FFFFFF").px(15, 6, "#FFFFFF").px(12, 6, "#7FA8BC").px(14, 4, "#7FA8BC");
    if (k < 16) { const d = Math.floor(k / 2); if (d < 6) g.px(2 + d, 7 - d, "#FFFFFF").px(3 + d, 7 - d, "#FFFFFFaa"); }
    if (flare) spark(g, 3, 4, true);
  }, { glow: (f) => (f % 60 >= 18 && f % 60 < 26 ? [[3, 4, 16, "#FFE9A0"]] : []) }),

  it("spinningwheel", "Spinning Wheel & Golden Thread", "furniture", ["stand"], "bedroom", 800, 40, 38, "Sleeping Beauty", (g, f) => {
    const a = f * 0.12, hx = 27, hy = 14;
    g.shadow(20, 18, 37);
    g.stamp((l) => {
      l.rect(2, 26, 36, 3, "#8A5A34").rect(2, 26, 36, 1, "#B07A4A");
      l.line(5, 29, 3, 36, "#6B4226").line(34, 29, 36, 36, "#6B4226").line(20, 29, 20, 36, "#6B4226");
      l.rect(26, 14, 2, 12, "#6B4226").rect(8, 15, 2, 11, "#6B4226").rect(14, 15, 2, 11, "#6B4226");
      l.rect(4, 5, 1, 21, "#8A5A34");
    }, "#1E120A");
    // Treadle and footman, following the crank.
    const px2 = hx + Math.round(Math.cos(a) * 3), py2 = hy + Math.round(Math.sin(a) * 3);
    g.stamp((l) => { l.rect(12, 34 + Math.round(Math.sin(a)), 14, 2, "#8A5A34"); l.line(px2, py2, 22, 34 + Math.round(Math.sin(a)), "#C9B58C"); }, "#1E120A");
    // The wheel.
    g.stamp((l) => {
      for (let i = 0; i < 8; i++) { const b = a + (i * TAU) / 8; l.line(hx, hy, hx + Math.cos(b) * 10, hy + Math.sin(b) * 10, "#8A5A34"); }
      l.ell(hx, hy, 11.5, 11.5, (nx, ny) => { const d = nx * nx + ny * ny; return d < 0.72 ? null : nx + ny < -0.4 ? "#C8905A" : nx + ny > 0.5 ? "#6B4226" : "#A06A40"; });
      l.ell(hx, hy, 1.8, 1.8, "#5E3A1F");
    }, "#2A160A");
    // Drive band to the bobbin, and the bobbin wound with gold.
    g.line(hx, hy - 11, 12, 15, "#E8DCC4").line(hx, hy + 11, 12, 18, "#E8DCC4");
    g.stamp((l) => { l.rect(6, 15, 11, 3, "#8A5A34").rect(9, 14, 4, 5, "#FFD23F").rect(9, 14, 4, 1, "#FFF3A6").px(10, 16, "#D9A441").px(12, 17, "#D9A441"); l.rect(6, 13 + ((f >> 1) % 2) * 5, 3, 1, "#B07A4A"); }, "#2A1A0A");
    // The golden fluff on the distaff, and the thread running from it to the bobbin.
    g.stamp((l) => l.ell(4.5, 7, 2.6, 3.4, (nx, ny, x, y) => ((x + y) % 2 ? "#FFE36B" : "#FFD23F")), "#6A4A00");
    for (let i = 0; i < 6; i++) g.px(5 + i, 10 + Math.round(i * 0.8), "#FFD23F");
    const k = f % 12; g.px(5 + Math.floor(k / 2), 10 + Math.round(Math.floor(k / 2) * 0.8), "#FFFFFF");
  }, { glow: [[9, 12, 14, "#FFD23F"]] }),

  it("justicescales", "Scales of Justice", "furniture", ["top"], "library", 350, 20, 22, "The Merchant of Venice", (g, f) => {
    const th = wave(f, 96, 0.16), cx = 10, by = 5, ex = Math.cos(th) * 5.8, ey = Math.sin(th) * 5.8;
    const L = [cx - ex, by - ey], R = [cx + ex, by + ey];
    g.stamp((l) => { l.rect(9, 4, 2, 14, "#D9A441").rect(9, 4, 1, 14, "#FFE36B"); l.rect(5, 19, 10, 2, "#B07A1A").rect(6, 18, 8, 1, "#D9A441"); l.ell(10, 2.5, 1.5, 1.5, "#FFD23F"); }, "#4A3100");
    g.stamp((l) => {
      l.line(L[0], L[1], R[0], R[1], "#FFD23F");
      for (const [x, y] of [L, R]) { l.line(x, y, x - 2.5, y + 7, "#D9A441"); l.line(x, y, x + 2.5, y + 7, "#D9A441"); l.ell(x, y + 7.5, 3, 1.5, (nx, ny) => (ny < -0.1 ? "#FFE36B" : "#D9A441")); }
    }, "#4A3100");
    if (f % 96 < 8) g.px(Math.round(L[0] + (f % 96) * 1.6), Math.round(L[1] + ((f % 96) * 1.6 * (R[1] - L[1])) / (R[0] - L[0])), "#FFFFFF");
  }),

  it("silvercandlesticks", "Silver Candlesticks", "light", ["top"], "any", 450, 18, 22, "Les Misérables", (g, f) => {
    g.stamp((l) => {
      for (const x of [5, 13]) {
        l.ell(x, 20, 3.6, 1.4, (nx, ny) => (ny < 0 ? "#EEF3F8" : "#A8B2C4"));
        l.rect(x - 1, 11, 2, 9, "#C9D1DB").px(x - 1, 11, "#EEF3F8");
        l.ell(x, 16, 1.8, 1, "#DDE3EC").ell(x, 12, 1.4, 0.8, "#DDE3EC");
        l.rect(x - 2, 9, 4, 2, "#DDE3EC").rect(x - 2, 9, 4, 1, "#FFFFFF");
      }
    }, "#23262E");
    g.stamp((l) => { for (const x of [5, 13]) l.rect(x - 1, 3, 2, 6, "#FFF6DF").px(x - 1, 3, "#FFFFFF").px(x, 6, "#E6E0D2"); }, "#5A4A36");
    flameTip(g, 5, 2, f, 0); flameTip(g, 13, 2, f, 1);
    if (f % 72 < 3) g.px(4, 17, "#FFFFFF");
  }, { glow: [[5, 1, 20, "#FFD27A"], [13, 1, 20, "#FFD27A"]] }),
  it("goldenfleece", "The Golden Fleece", "wall", ["wall"], "any", 1100, 40, 26, "The Argonautica", (g, f) => {
    // A ram's golden fleece slung over an oak bough, horns and all.
    const branch = (l, skip) => {
      for (let x = 1; x < 39; x++) { if (skip && x > 8 && x < 32) continue; const y = 5 + Math.round(Math.sin(x * 0.3) * 0.8 - x * 0.04); l.px(x, y, "#8A5A34").px(x, y + 1, "#6B4226").px(x, y - 1, x % 5 === 0 ? "#B07A4A" : "#8A5A34"); }
    };
    g.stamp((l) => {
      branch(l, false);
      l.line(32, 4, 35, 2, "#6B4226");
      l.ell(36.5, 2.6, 2.4, 1.3, (nx, ny, x) => (x % 2 ? "#3FA35E" : "#2E8B3C")).ell(33, 2.4, 1.5, 1, "#4FBF5A");
    }, "#1E120A");
    const sw = Math.round(wave(f, 72, 0.6));
    const inF = (x, y) => {
      if (y >= 3 && y < 17) { const half = 11 - (y - 3) * 0.35 + (rnd(y * 7 + (x < 20 ? 1 : 2)) > 0.6 ? 1 : 0); return Math.abs(x + 0.5 - 20) < half; }
      if (y >= 17 && y < 24) { const s = y > 18 ? sw : 0; return Math.abs(x - 11 - s) <= (y > 21 ? 1 : 2) || Math.abs(x - 29 - s) <= (y > 21 ? 1 : 2); }
      return false;
    };
    const band = ((f * 0.6) % 70) - 15;
    g.stamp((l) => {
      for (let y = 3; y < 24; y++) for (let x = 6; x < 35; x++) {
        if (!inF(x, y)) continue;
        const k = rnd(x * 31 + y * 17);
        let c = k > 0.72 ? "#FFF3A6" : k < 0.22 ? "#D9A441" : y > 13 ? "#F0C030" : "#FFD23F";
        if (k > 0.72 && rnd(x * 31 + (y + 1) * 17) > 0.72) c = "#FFE36B";
        if (Math.abs(x - y * 0.5 - band) < 1) c = "#FFFBE0";
        l.px(x, y, c);
      }
      // The ram's head hanging at the middle, with curled horns.
      l.ell(20, 18.5, 2.6, 3.6, (nx, ny) => (ny > 0.5 ? "#E0A820" : nx < -0.3 ? "#FFE36B" : "#FFD23F"));
      for (const s of [-1, 1]) { l.ell(20 + s * 3.5, 16, 1.8, 1.8, "#D9A441"); l.px(20 + s * 3.5, 16, "#8A6400").px(20 + s * 4.5, 17, "#D9A441"); }
    }, "#6A4A00");
    g.px(19, 18, "#4A3100").px(21, 18, "#4A3100").px(20, 21, "#B07A1A");
    g.stamp((l) => branch(l, true), "#1E120A");
  }, { glow: [[20, 12, 22, "#FFD23F"]] }),
  it("loomoffate", "The Loom of Fate", "wall", ["wall"], "library", 900, 40, 30, "The Iliad", (g, f) => {
    // A woven hanging; three threads, gold, crimson and blue, braid across it and hang free.
    g.stamp((l) => { l.rect(3, 1, 34, 2, "#6B4226").rect(3, 1, 34, 1, "#8E5C36"); l.ell(3, 2, 1.4, 1.4, "#FFD23F").ell(37, 2, 1.4, 1.4, "#FFD23F"); }, "#1E120A");
    const TH = ["#FFD23F", "#C8203A", "#2F5FD0"], ph = f * 0.1;
    g.stamp((l) => {
      for (let y = 3; y < 21; y++) for (let x = 5; x < 35; x++) {
        let c = "#C8683C";
        if (y === 3 || y === 20) c = "#E8DCC4";
        else if (y <= 6 || y >= 17) { const r = y <= 6 ? y - 4 : y - 17, m = x % 4; c = r === 0 ? (m !== 3 ? "#2A2A33" : c) : r === 1 ? (m === 0 || m === 2 ? "#2A2A33" : c) : r === 2 ? (m !== 1 ? "#2A2A33" : c) : c; }
        else if ((x + y) % 5 === 0) c = "#B85A30";
        l.px(x, y, c);
      }
      for (let i = 0; i < 3; i++) for (let x = 5; x < 35; x++) l.px(x, Math.round(11.5 + Math.sin((x - 5) * 0.42 + ph + (i * TAU) / 3) * 3), TH[i]);
    }, "#3A1E10");
    g.stamp((l) => {
      for (let x = 6; x < 34; x += 2) l.px(x, 21, "#E8DCC4");
      for (let i = 0; i < 3; i++) {
        const x0 = 12 + i * 8;
        for (let y = 21; y < 27; y++) l.px(x0 + Math.round(wave(f, 60, 1, i * 2) * (y - 21) / 6), y, TH[i]);
        const ex = x0 + Math.round(wave(f, 60, 1, i * 2));
        l.rect(ex - 1, 27, 3, 1, "#8A5A34").px(ex, 26, TH[i]).px(ex, 28, "#8A5A34");
      }
    }, "#2A1A0A");
  }),

  it("poisonedapple", "The Poisoned Apple", "furniture", ["top"], "kitchen", 480, 16, 20, "Snow White", (g, f) => {
    // A perfect red apple; now and then a sly green gleam slides across it.
    const k = f % 72, sh = (k / 40) * 20 - 6, on = k < 40;
    g.stamp((l) => { l.ell(8, 14, 7, 1.6, (nx, ny) => (ny < 0 ? "#FFFFFF" : "#C9D1DB")); l.rect(7, 15, 2, 3, "#DDE3EC"); l.ell(8, 18, 4, 1, "#C9D1DB"); }, "#3A3F4B");
    g.stamp((l) => {
      l.ell(8, 8.5, 5, 4.6, (nx, ny, x, y) => {
        if (on && Math.abs(x - y * 0.6 - sh) < 1) return nx + ny < -0.2 ? "#C8FFB0" : "#5FD06A";
        return nx + ny < -0.8 ? "#FF9A9A" : nx + ny > 0.6 ? "#A8182C" : "#E0262E";
      });
      l.line(8, 4, 9, 1, "#6B3A1E");
      l.ell(11.5, 2, 2, 1, "#3FA35E");
    }, "#3A0610");
    g.px(5, 6, "#FFFFFF").px(8, 4, "#A8182C");
    if (on && k > 30) spark(g, 13, 5, k % 4 < 2);
  }, { glow: (f) => (f % 72 < 40 ? [[8, 9, 14, "#7CFF6B"]] : []) }),

  it("rabbitpocketwatch", "The White Rabbit's Pocket Watch", "wall", ["wall"], "any", 420, 18, 28, "Alice's Adventures in Wonderland", (g, f) => {
    const sw = Math.round(wave(f, 48, 1.2)), cx = 9 + sw, cy = 19;
    g.stamp((l) => l.rect(8, 1, 2, 2, "#8C97A6"), "#23262E");
    g.stamp((l) => { for (let i = 0; i < 8; i++) l.px(9 + Math.round((sw * i) / 8), 3 + i, i % 2 ? "#D9A441" : "#FFE36B"); }, "#4A3100");
    g.stamp((l) => {
      l.ell(cx, 11, 1.8, 1.4, (nx, ny) => (nx * nx + ny * ny < 0.3 ? null : "#FFD23F"));
      l.rect(cx - 1, 12, 3, 1, "#D9A441");
      l.ell(cx, cy, 6.5, 6.5, (nx, ny) => { const d = nx * nx + ny * ny; return d > 0.7 ? gold(nx, ny) : "#FFF6DF"; });
    }, "#4A3100");
    for (const [dx, dy] of [[0, -4], [4, 0], [0, 4], [-4, 0]]) g.px(cx + dx, cy + dy, "#3A3F4B");
    const sec = Math.floor(f / 12) % 60, sa = (sec / 60) * TAU, ma = ((f % 8640) / 8640) * TAU + 1.1;
    g.line(cx, cy, cx + Math.round(Math.sin(ma) * 3), cy - Math.round(Math.cos(ma) * 3), "#1A1A22");
    g.line(cx, cy, cx + Math.round(Math.sin(sa) * 4), cy - Math.round(Math.cos(sa) * 4), "#C8203A");
    g.px(cx, cy, "#1A1A22");
    if (f % 60 < 3) g.px(cx - 3, cy - 3, "#FFFFFF");
  }),

  it("gardendoor", "Garden Door & Golden Key", "furniture", ["stand"], "greenhouse", 1000, 36, 46, "The Secret Garden", (g, f) => {
    // An ivy-hung brick wall with a hidden green door, a golden key on its nail, and a robin.
    g.shadow(18, 17, 45);
    const inDoor = (x, y) => x >= 11 && x < 25 && y < 44 && (y >= 22 || (x + 0.5 - 18) ** 2 + (y + 0.5 - 22) ** 2 < 49);
    const inArch = (x, y) => x >= 9 && x < 27 && y < 44 && (y >= 22 || (x + 0.5 - 18) ** 2 + (y + 0.5 - 22) ** 2 < 81);
    g.stamp((l) => {
      for (let y = 8; y < 44; y++) for (let x = 1; x < 35; x++) {
        if (inDoor(x, y)) continue;
        if (inArch(x, y)) { l.px(x, y, (Math.round(Math.atan2(y + 0.5 - 22, x + 0.5 - 18) * 4) + (y >= 22 ? y >> 1 : 0)) % 2 ? "#C9C2B2" : "#B0A898"); continue; }
        const row = Math.floor(y / 3), off = row % 2 ? 3 : 0, mortar = y % 3 === 2 || (x + off) % 6 === 0;
        l.px(x, y, mortar ? "#C9B8A8" : rnd(((x + off) / 6 | 0) * 13 + row * 5) > 0.7 ? "#B04A36" : "#A34230");
      }
      l.rect(1, 6, 34, 2, "#9A9CA3").rect(1, 6, 34, 1, "#C9CCD2");
      for (let y = 15; y < 44; y++) for (let x = 11; x < 25; x++) if (inDoor(x, y)) l.px(x, y, (x - 11) % 4 === 3 ? "#2E5E38" : y === 15 || (x - 11) % 4 === 0 ? "#4FA05E" : "#3E7A4A");
      l.rect(12, 30, 12, 1, "#2E5E38").rect(12, 38, 12, 1, "#2E5E38");
      l.px(22, 33, "#1A1A22").px(22, 34, "#1A1A22").ell(21, 30.5, 1.2, 1.2, (nx, ny) => (nx * nx + ny * ny < 0.3 ? null : "#5A606E"));
    }, "#2A1410");
    // The key on its ribbon, swinging a little.
    const ksw = Math.round(wave(f, 60, 0.7));
    g.stamp((l) => {
      l.px(15, 24, "#E0393E").px(15 + (ksw > 0 ? 1 : 0), 25, "#E0393E");
      const kx = 15 + ksw;
      l.ell(kx + 0.5, 27, 1.6, 1.6, (nx, ny) => (nx * nx + ny * ny < 0.25 ? null : "#FFD23F"));
      l.rect(kx, 28, 1, 5, "#FFD23F").rect(kx + 1, 31, 1, 1, "#FFD23F").rect(kx + 1, 32, 2, 1, "#D9A441");
    }, "#4A3100");
    if (f % 72 < 4) spark(g, 16 + ksw, 27, f % 72 < 2);
    // Ivy over the top and down the sides.
    g.stamp((l) => {
      for (let i = 0; i < 46; i++) {
        const x = Math.floor(rnd(i * 3 + 7) * 34) + 1, yTop = 5 + Math.floor(rnd(i * 5 + 1) * 6), side = i > 26;
        const y = side ? 8 + Math.floor(rnd(i * 9) * 30) : yTop, xx = side ? (i % 2 ? 1 + Math.floor(rnd(i) * 7) : 28 + Math.floor(rnd(i) * 6)) : x;
        if (inDoor(xx, y) || xx < 1 || xx > 32) continue;
        const s = y < 16 ? Math.round(wave(f, 72, 0.6, i)) : 0;
        l.px(Math.max(1, xx + s), y, i % 3 ? "#3FA35E" : "#7FCB6A").px(Math.min(34, xx + s + 1), y, "#2E8B3C");
      }
      for (let x = 12; x < 24; x += 3) for (let j = 0; j < 3 + (x % 2); j++) l.px(x + Math.round(wave(f, 72, 0.7, x)), 16 + j, j % 2 ? "#2E8B3C" : "#3FA35E");
    }, "#123A1E");
    // The robin on the coping.
    const hop = f % 48 < 4 ? -1 : 0, look = Math.floor(f / 24) % 2;
    g.stamp((l) => {
      l.rect(6, 3 + hop, 4, 2, "#8A5A34").px(10 - look * 5, 3 + hop, "#8A5A34").rect(7, 4 + hop, 2, 1, "#E0582E").px(look ? 5 : 10, 2 + hop, "#8A5A34");
      l.px(look ? 4 : 11, 3 + hop, "#3A3F4B").px(look ? 11 : 4, 3 + hop, "#6B4226");
    }, "#2A160A");
    g.px(look ? 5 : 10, 2 + hop, "#1A1A22");
  }),

  it("sanluisbridge", "The Bridge of San Luis Rey", "furniture", ["stand"], "any", 750, 44, 30, "The Bridge of San Luis Rey", (g, f) => {
    // A little rope bridge between two crags, over a painted river.
    const sag = 4 + wave(f, 72, 0.7);
    g.stamp((l) => l.rect(1, 25, 42, 4, "#8A5A34").rect(1, 25, 42, 1, "#B07A4A").rect(2, 28, 40, 1, "#6B4226"), "#1E120A");
    for (let x = 9; x < 35; x++) g.px(x, 24, (x * 3 + (f >> 2)) % 7 === 0 ? "#DFF3FF" : "#4FA8E0").px(x, 23, (x * 5 + (f >> 2)) % 9 === 0 ? "#BFE6FF" : "#3F90C8");
    g.stamp((l) => {
      for (const s of [0, 1]) for (let y = 9; y < 25; y++) {
        const w = 3 + (y - 9) * 0.35, x0 = s ? 43 - w : 1;
        for (let x = Math.round(x0); x < Math.round(x0 + w); x++) l.px(x, y, (y + (s ? x : -x)) % 4 === 0 ? "#8C7A6A" : y % 5 === 0 ? "#B8A494" : "#A89484");
      }
      l.rect(6, 6, 2, 4, "#6B4226").rect(36, 6, 2, 4, "#6B4226");
      for (const x of [1, 2, 4, 5, 38, 39, 41, 42]) l.px(x, 8 + (x % 3 === 0 ? 0 : 1) - (x === 4 || x === 39 ? 1 : 0), x % 2 ? "#4FBF5A" : "#3FA35E");
    }, "#3A2A1A");
    const hr = (x) => 7 + sag * Math.sin(((x - 7) / 30) * Math.PI), dk = (x) => 11 + sag * Math.sin(((x - 7) / 30) * Math.PI);
    g.stamp((l) => {
      for (let x = 7; x <= 37; x++) {
        l.px(x, hr(x), "#D8C08A").px(x, dk(x), x % 2 ? "#B07A4A" : "#8A5A34").px(x, dk(x) + 1, "#6B4226");
        if (x % 4 === 1) l.line(x, hr(x) + 1, x, dk(x) - 1, "#C9B58C");
      }
    }, "#3A2A1A");
  }),

  it("mirrorofdesire", "The Mirror of Desire", "furniture", ["stand"], "bedroom", 1500, 28, 54, "Harry Potter", (g, f) => {
    // A tall gilt mirror on clawed feet; its glass shows only a shimmer, a glow and a sparkle.
    const outer = (x, y) => x >= 2 && x < 26 && y < 46 && (y >= 14 || ((x + 0.5 - 14) / 12) ** 2 + ((y + 0.5 - 14) / 11) ** 2 < 1);
    const inner = (x, y) => x >= 5 && x < 23 && y < 43 && (y >= 14 || ((x + 0.5 - 14) / 9) ** 2 + ((y + 0.5 - 14) / 8) ** 2 < 1);
    g.shadow(14, 12, 53);
    g.stamp((l) => {
      l.rect(4, 45, 4, 5, "#D9A441").rect(20, 45, 4, 5, "#D9A441").rect(2, 49, 4, 2, "#B07A1A").rect(22, 49, 4, 2, "#B07A1A").px(2, 48, "#FFD23F").px(25, 48, "#FFD23F");
      for (let y = 2; y < 46; y++) for (let x = 2; x < 26; x++) if (outer(x, y) && !inner(x, y)) l.px(x, y, x + y < 30 ? ((x * 2 + y) % 5 === 0 ? "#FFF3A6" : "#FFE36B") : (x + y) % 5 === 0 ? "#FFD23F" : "#D9A441");
      l.ell(14, 3, 2.6, 2, (nx, ny) => gold(nx, ny));
      l.rect(2, 44, 24, 2, "#B07A1A");
    }, "#3A2400");
    const pulse = 0.85 + 0.15 * Math.sin((f / 48) * TAU);
    for (let y = 3; y < 43; y++) for (let x = 5; x < 23; x++) {
      if (!inner(x, y)) continue;
      const band = Math.sin(x * 0.55 + y * 0.28 - f * 0.18) + Math.sin(y * 0.2 + f * 0.07) * 0.6;
      const o = ((x + 0.5 - 14) / (5 * pulse)) ** 2 + ((y + 0.5 - 25) / (8 * pulse)) ** 2;
      g.px(x, y, o < 0.35 ? "#DDE8FF" : o < 1 ? (band > 0.5 ? "#B8CCF0" : "#8FA8D8") : band > 1.1 ? "#8FA8D8" : band > 0.5 ? "#5A74A8" : lerpC("#2A3A62", "#3E5486", (y - 3) / 40));
    }
    for (let i = 0; i < 3; i++) { const k = (f + i * 20) % 60, n = Math.floor((f + i * 20) / 60); if (k < 8) spark(g, 7 + Math.floor(rnd(i * 7 + n) * 14), 8 + Math.floor(rnd(i * 11 + n) * 30), k < 4); }
    g.px(7, 16, "#FFFFFF88").px(7, 17, "#FFFFFF88").px(8, 15, "#FFFFFF88");
  }, { glow: [[14, 24, 22, "#AFC8FF"]] }),
  it("trojanhorse", "The Trojan Horse", "furniture", ["stand"], "any", 850, 36, 38, "The Odyssey", (g, f) => {
    // A wooden horse on wheels; now and then a hatch opens and someone peeks out.
    const dx = Math.round(wave(f, 96, 1)), t = f % 120, open = t >= 40 && t < 76, blink = t % 20 < 2;
    g.shadow(18, 16, 37);
    g.stamp((l) => { l.line(6 + dx, 13, 3 + dx, 21, "#C9B58C"); l.line(7 + dx, 13, 4 + dx, 21, "#B89A60"); }, "#3A2A10");
    g.stamp((l) => {
      l.rect(3 + dx, 28, 30, 3, "#8A5A34").rect(3 + dx, 28, 30, 1, "#B07A4A");
      for (const x of [8, 12, 22, 26]) l.rect(x + dx, 20, 2, 8, "#8A5A34").rect(x + dx, 20, 1, 8, "#A06A40");
      for (let y = 12; y < 21; y++) l.rect(6 + dx + (y === 12 || y === 20 ? 1 : 0), y, 22 - (y === 12 || y === 20 ? 2 : 0), 1, y % 3 === 0 ? "#8A5A34" : y % 3 === 1 ? "#C8905A" : "#B07A4A");
      l.rect(23 + dx, 7, 5, 6, "#B07A4A").rect(25 + dx, 4, 5, 4, "#B07A4A");
      l.rect(26 + dx, 2, 8, 4, "#C8905A").rect(26 + dx, 5, 8, 1, "#8A5A34").px(27 + dx, 1, "#B07A4A").px(29 + dx, 1, "#B07A4A");
      for (let y = 3; y < 12; y++) l.px(23 + dx + Math.floor((12 - y) / 3), y, y % 2 ? "#6B3A1E" : "#8A5424");
    }, "#2A160A");
    g.px(30 + dx, 3, "#1A1A22").px(33 + dx, 4, "#6B3A1E");
    g.stamp((l) => { if (open) { l.rect(12 + dx, 14, 5, 4, "#2A160A"); l.rect(12 + dx, 13, 5, 1, "#8A5A34"); } else l.rect(12 + dx, 14, 5, 4, "#A06A40").px(16 + dx, 16, "#FFD23F"); }, "#3A1E0A");
    if (open && t > 46 && !blink) g.px(13 + dx, 15, "#FFFFFF").px(15 + dx, 15, "#FFFFFF").px(14 + dx, 15, "#2A160A").px(16 + dx, 15, "#2A160A");
    const a = dx * 0.9;
    for (const x of [8, 18, 28]) g.stamp((l) => {
      l.ell(x + dx, 33, 3.2, 3.2, (nx, ny) => (nx * nx + ny * ny > 0.45 ? "#6B4226" : "#A06A40"));
      l.line(x + dx - Math.round(Math.cos(a) * 2), 33 - Math.round(Math.sin(a) * 2), x + dx + Math.round(Math.cos(a) * 2), 33 + Math.round(Math.sin(a) * 2), "#5E3A1F").px(x + dx, 33, "#D9A441");
    }, "#1E120A");
  }),

  it("scroogeledger", "Scrooge's Ledger", "furniture", ["stand"], "library", 550, 32, 40, "A Christmas Carol", (g, f) => {
    // A tall counting desk by a single stingy candle; the quill keeps on totting up.
    const topY = (x) => 19 - ((x - 1) * 4) / 29;
    g.shadow(16, 14, 39);
    g.stamp((l) => {
      for (let x = 1; x < 31; x++) l.rect(x, Math.round(topY(x)), 1, 20 - Math.round(topY(x)), "#8A5A34").px(x, Math.round(topY(x)), "#B07A4A");
      l.rect(3, 20, 26, 4, "#6B4226").rect(3, 20, 26, 1, "#5E3A1F").rect(14, 21, 4, 2, "#8A5A34").px(16, 22, "#FFD23F");
      l.rect(4, 24, 2, 14, "#6B4226").rect(26, 24, 2, 14, "#6B4226").rect(4, 33, 24, 1, "#5E3A1F");
    }, "#1E120A");
    // The ledger, open: two pages humped up from the gutter, ruled in red.
    const sp = 16, pageTop = (x) => { const d = Math.abs(x - sp), w = x < sp ? 9 : 9; return Math.round(topY(x)) - 2 - Math.round(Math.sin(Math.min(1, d / w) * Math.PI * 0.8) * 3) - (d > 0 ? 2 : 0); };
    g.stamp((l) => {
      for (let x = 6; x < 27; x++) {
        const base = Math.round(topY(x)) - 1, top = pageTop(x);
        l.px(x, base, "#8A1428").px(x, base - 1, "#E6DCC0");
        for (let y = top; y < base - 1; y++) l.px(x, y, x === sp ? "#C9B58C" : x === 9 || x === 22 ? "#E8A0A0" : (y - top) % 2 === 1 && x !== 6 && x !== 26 ? "#E6ECF4" : x < sp ? "#FFF6DF" : "#F6E9C8");
      }
      l.px(5, Math.round(topY(5)) - 1, "#8A1428").px(27, Math.round(topY(27)) - 1, "#8A1428");
    }, "#3A2410");
    const t = (f % 48) / 48, qx = 18 + Math.round(t * 6), qy = pageTop(qx) + 2;
    for (let x = 18; x < qx; x += 2) g.px(x, pageTop(x) + 2, "#3A3F4B");
    g.stamp((l) => { l.line(qx, qy, qx + 3, qy - 7, "#F4F1E8"); l.px(qx + 2, qy - 6, "#DDE3EC").px(qx + 4, qy - 7, "#F4F1E8").px(qx + 3, qy - 8, "#F4F1E8"); l.px(qx, qy, "#1A1A22"); }, "#5A4A36");
    g.stamp((l) => { l.rect(28, 12, 2, 3, "#1B1B22").px(28, 12, "#3A3F4B"); l.rect(2, 11, 2, 4, "#FFF6DF").rect(1, 15, 4, 1, "#D9A441"); }, "#2A1E14");
    flameTip(g, 2, 10, f);
  }, { glow: [[2, 9, 20, "#FFD27A"]] }),
  it("bluebeardkey", "Bluebeard's Key", "wall", ["wall"], "any", 520, 18, 26, "Bluebeard", (g, f) => {
    // A little golden key with a mark that will not come off: wipe it, and back it comes.
    const t = f % 96, wiping = t >= 40 && t < 64, cleanK = wiping ? Math.min(1, (t - 40) / 16) : 0;
    g.stamp((l) => { l.rect(3, 1, 12, 4, "#6B4226").rect(3, 1, 12, 1, "#8E5C36"); l.rect(8, 5, 2, 2, "#8C97A6"); }, "#1E120A");
    g.stamp((l) => {
      l.ell(9, 9.5, 3.4, 3, (nx, ny) => (nx * nx + ny * ny < 0.3 ? null : gold(nx, ny)));
      l.px(5, 9, "#FFD23F").px(13, 9, "#FFD23F").px(9, 6, "#FFD23F");
      l.rect(6, 12, 6, 1, "#D9A441").rect(8, 13, 2, 9, "#FFD23F").rect(8, 13, 1, 9, "#FFE36B");
      l.rect(10, 18, 3, 2, "#FFD23F").rect(10, 21, 3, 1, "#D9A441").px(12, 20, "#D9A441");
    }, "#4A3100");
    const stain = lerpC("#C8203A", "#F0B8B0", cleanK * 0.8);
    g.px(9, 17, stain).px(8, 18, stain).px(9, 18, stain).px(11, 19, stain);
    if (wiping) { const x = 4 + Math.round(((t - 40) / 24) * 8); g.stamp((l) => l.rect(x, 16, 4, 3, "#FFFFFF").px(x + 1, 17, "#E6E0D2"), "#8C97A6"); }
    if (t >= 64 && t < 70) spark(g, 13, 16, t < 67);
  }),

  it("blackfalcon", "Black Falcon Statuette", "furniture", ["top"], "any", 1300, 14, 22, "The Maltese Falcon", (g, f) => {
    // Our own little black bird on a plinth, with a slow sheen.
    g.stamp((l) => { l.rect(2, 18, 10, 3, "#2A2A33").rect(2, 18, 10, 1, "#5A5A6A").rect(3, 21, 8, 1, "#3A3A48"); }, "#0B0B10");
    const k = f % 84, sheen = k < 20 ? 2 + k : -9;
    g.stamp((l) => {
      l.rect(5, 15, 4, 3, "#34343F").px(5, 17, "#4A4A58");
      l.ell(7, 10.5, 3.6, 5.2, (nx, ny, x, y) => (Math.abs(y - sheen) < 1 && nx < 0.6 ? "#A8ACC0" : nx < -0.55 ? "#6A6A80" : (x + y) % 3 === 0 && ny > -0.2 ? "#2A2A33" : "#3A3A48"));
      l.ell(8, 4, 2.6, 2.4, (nx, ny) => (nx + ny < -0.5 ? "#6A6A80" : "#3A3A48"));
      l.px(10, 4, "#4A4A58").px(11, 4, "#4A4A58").px(11, 5, "#4A4A58");
      l.line(5, 8, 8, 14, "#2A2A33"); l.line(6, 7, 9, 13, "#5A5A6E");
    }, "#0B0B10");
    g.px(9, 3, "#C9CED8").px(6, 3, "#8C8FA6");
  }),
  it("ironcurtain", "The Iron Curtain", "window", ["window"], "any", 400, 40, 38, "The Iron Curtain", (g, f) => {
    // A window hung with drapes of riveted iron plate. They barely stir.
    paintSky(g, 7, 5, 26, 24, f);
    g.stamp((l) => {
      l.rect(6, 4, 28, 1, "#E8DCC4").rect(6, 29, 28, 1, "#E8DCC4").rect(6, 4, 1, 26, "#E8DCC4").rect(33, 4, 1, 26, "#E8DCC4");
      l.rect(19, 5, 2, 24, "#E8DCC4").rect(7, 17, 26, 1, "#E8DCC4");
      l.rect(4, 30, 32, 2, "#C9B894").rect(4, 30, 32, 1, "#E8DCC4");
    }, "#5A4A36");
    const sw = (y) => Math.round(wave(f, 144, 0.6) * Math.max(0, (y - 22) / 14));
    g.stamp((l) => {
      for (const s of [0, 1]) for (let y = 3; y < 37; y++) {
        const w = y < 21 ? 10 - Math.round(((y - 3) / 18) * 5) : 5 + Math.round(((y - 21) / 15) * 4), d = y > 22 ? (s ? -sw(y) : sw(y)) : 0;
        for (let i = 0; i < w; i++) {
          const x = s ? 37 - i + d : 2 + i + d, m = i % 3;
          l.px(x, y, (y - 3) % 7 === 6 ? "#3A3F4B" : m === 0 ? "#4A4F5E" : m === 1 ? "#6B7280" : "#8C97A6");
          if (m === 2 && (y - 3) % 7 === 2) l.px(x, y, "#DDE3EC");
        }
      }
    }, "#14161C");
    g.stamp((l) => { l.rect(3, 1, 34, 2, "#3A3F4B").rect(3, 1, 34, 1, "#6B7280"); l.ell(3, 2, 1.5, 1.5, "#5A606E").ell(37, 2, 1.5, 1.5, "#5A606E"); for (const x of [5, 8, 31, 34]) l.px(x, 21, "#C9D1DB").px(x + 1, 21, "#8C97A6"); }, "#14161C");
  }),

  it("shalottmirror", "The Cracked Mirror of Shalott", "wall", ["wall"], "any", 700, 30, 30, "The Lady of Shalott", (g, f) => {
    // Towers, river and barley fields in the glass, cracked from side to side.
    const inG = (x, y) => (x + 0.5 - 15) ** 2 + (y + 0.5 - 15) ** 2 < 11 * 11;
    for (let y = 4; y < 27; y++) for (let x = 4; x < 27; x++) {
      if (!inG(x, y)) continue;
      let c = lerpC("#BFDDF0", "#EAF3F0", (y - 4) / 12);
      if (y >= 16 && y < 19) c = (x * 3 + y + (f >> 2)) % 9 === 0 ? "#EAF6FF" : "#5E9CC8";
      else if (y >= 19) c = (x + y * 2) % 5 === 0 ? "#D8C870" : y % 2 ? "#7AAE6A" : "#6A9E5A";
      else if (y === 15) c = "#8AB87A";
      g.px(x, y, c);
    }
    g.stamp((l) => {
      for (const [x, h] of [[17, 5], [20, 8], [23, 4]]) { l.rect(x, 15 - h, 2, h, "#A8B0C8").px(x, 15 - h, "#8890A8"); l.px(x, 14 - h, "#6A7090").px(x + 1, 14 - h, "#6A7090").px(x, 13 - h, "#6A7090"); }
      l.rect(16, 13, 10, 2, "#A8B0C8").px(19, 13, "#5A6078").px(22, 13, "#5A6078");
      l.ell(8, 13.5, 2.4, 2.2, (nx, ny, x, y) => ((x + y) % 2 ? "#4A7A4A" : "#5A8A5A")).px(8, 15, "#4A3A2A");
    }, "#5A6078");
    const crack = [[4, 10], [8, 8], [11, 11], [15, 8], [19, 10], [23, 7], [27, 9]];
    for (let i = 0; i < crack.length - 1; i++) { g.line(crack[i][0], crack[i][1] + 1, crack[i + 1][0], crack[i + 1][1] + 1, "#FFFFFF"); g.line(crack[i][0], crack[i][1], crack[i + 1][0], crack[i + 1][1], "#2A3A4A"); }
    g.line(11, 11, 12, 14, "#2A3A4A").line(19, 10, 18, 6, "#2A3A4A");
    const k = f % 90; if (k < 12) { const b = k * 2 - 2; for (let y = 4; y < 27; y++) { const x = b + (26 - y) * 0.5; if (inG(Math.round(x), y)) g.px(x, y, "#FFFFFF66"); } }
    g.stamp((l) => l.ell(15, 15, 14, 14, (nx, ny) => { const d = nx * nx + ny * ny; if (d < 0.62) return null; return d > 0.9 ? (nx + ny < 0 ? "#FFE36B" : "#B07A1A") : Math.round(Math.atan2(ny, nx) * 5) % 2 ? "#FFD23F" : "#D9A441"; }), "#3A2400");
  }),

  // ---------------------------------------------------------- misc
  it("greenumbrella", "The Green Umbrella", "furniture", ["stand"], "any", 200, 30, 36, "Peter Pan", (g, f) => {
    // An open green umbrella propped on its crook, slowly twirling; a little fairy dust about it.
    const turn = Math.floor(f / 8), tilt = Math.round(wave(f, 96, 1));
    g.shadow(15, 8, 35);
    g.stamp((l) => {
      l.line(15 + tilt, 12, 15, 31, "#8A5A34");
      l.px(15, 32, "#8A5A34").px(14, 33, "#8A5A34").px(13, 33, "#8A5A34").px(12, 32, "#8A5A34").px(12, 31, "#8A5A34");
    }, "#2A160A");
    g.stamp((l) => {
      for (let y = 2; y < 14; y++) for (let x = 1; x < 29; x++) {
        const dx = (x + 0.5 - 15 - tilt) / 13.5, dy = (y + 0.5 - 13) / 10.5;
        const ang = Math.atan2(dy, dx), panel = Math.floor(((ang + Math.PI) / Math.PI) * 6 + 0.001);
        const scal = Math.abs(Math.sin(((x - tilt + 0.5) / 28) * Math.PI * 6)) * 1.6;
        if (dx * dx + dy * dy > 1 || y > 12 - scal + 1) continue;
        const shade = (panel + turn) % 2 ? "#2E9A48" : "#1F7A38";
        l.px(x, y, dx < -0.55 && dy < -0.2 ? "#5FD06A" : shade);
      }
      l.px(15 + tilt, 1, "#C9D1DB").px(15 + tilt, 2, "#C9D1DB");
    }, "#0E3A1A");
    for (let i = 0; i < 3; i++) { const t = ((f + i * 16) % 48) / 48; if (t < 0.7) g.px(Math.round(5 + i * 9 + Math.sin(f * 0.2 + i) * 2), Math.round(30 - t * 16), t < 0.35 ? "#FFF3A6" : "#FFE36B99"); }
  }),
  it("rabbitfan", "The White Rabbit's Fan", "wall", ["wall"], "any", 260, 30, 18, "Alice's Adventures in Wonderland", (g, f) => {
    // A lace fan; hold it, and it shrinks (and so, one supposes, do you).
    const t = f % 120, sc = t < 80 ? 1 : t < 92 ? 1 - ((t - 80) / 12) * 0.3 : t < 108 ? 0.7 : 0.7 + ((t - 108) / 12) * 0.3;
    const R = 13 * sc, px0 = 15, py0 = 16;
    g.stamp((l) => {
      for (let y = 1; y < 17; y++) for (let x = 1; x < 29; x++) {
        const dx = x + 0.5 - px0, dy = y + 0.5 - py0, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        if (r > R || a > -0.22 || a < -Math.PI + 0.22) continue;
        const k = Math.floor(((a + Math.PI - 0.22) / (Math.PI - 0.44)) * 12);
        l.px(x, y, r < 4 ? "#C9A06A" : r > R - 1.6 ? ((x + y) % 2 ? "#FFFFFF" : "#F4E6EE") : k % 2 ? "#FFFFFF" : "#FFD1E0");
      }
      l.px(px0, py0 - 1, "#8A5A34").px(px0, py0, "#8A5A34");
    }, "#6A3A4A");
    if (t >= 80 && t < 92) spark(g, 15 + Math.round(wave(t, 12, 8)), 4, t % 4 < 2);
  }),

  it("redchronicle", "Red Leather Chronicle", "furniture", ["top", "stand"], "library", 600, 18, 18, "The Lord of the Rings", (g, f) => {
    // A very thick red book open on a wooden stand, its pages turning themselves.
    const TOP = [7, 6, 5, 4, 4, 4, 5, 6];
    g.stamp((l) => { l.line(3, 13, 14, 16, "#8A5A34"); l.line(14, 13, 3, 16, "#8A5A34"); l.rect(2, 16, 14, 1, "#6B4226"); }, "#1E120A");
    g.stamp((l) => {
      l.rect(1, 10, 16, 3, "#B0203A").rect(1, 12, 16, 1, "#8A1428").px(1, 10, "#FFD23F").px(16, 10, "#FFD23F");
      for (const s of [0, 1]) for (let d = 0; d < 8; d++) { const x = s ? 9 + d : 8 - d; for (let y = TOP[d]; y < 11; y++) l.px(x, y, y >= 9 ? (y % 2 ? "#D6CCB0" : "#FFF6DF") : d === 0 ? "#C9B58C" : s ? "#F6E9C8" : "#FFF6DF"); }
      l.rect(9, 12, 1, 4, "#D9A441");
    }, "#3A0610");
    const k = f % 72;
    for (let p = 0; p < 3; p++) {
      const u = (k - p * 7) / 14;
      if (u <= 0 || u >= 1) continue;
      const th = u * Math.PI, tx = 8.5 + Math.cos(th) * 6, ty = 6 - Math.sin(th) * 4;
      g.stamp((l) => l.line(9, 7, tx, ty, "#FFFFFF").px(tx, ty + 1, "#E6DCC0"), "#5A4A36");
    }
  }),
  it("oilcan", "Tin Woodman's Oil Can", "furniture", ["top"], "workshop", 160, 16, 18, "The Wonderful Wizard of Oz", (g, f) => {
    g.stamp((l) => {
      l.rect(3, 11, 9, 5, "#C9D1DB").rect(3, 11, 2, 5, "#EEF3F8").rect(10, 11, 2, 5, "#8C97A6").rect(2, 16, 11, 1, "#8C97A6");
      for (let j = 0; j < 5; j++) l.rect(3 + Math.round(j * 0.8), 10 - j, 9 - Math.round(j * 1.6), 1, j % 2 ? "#DDE3EC" : "#C9D1DB");
      l.line(8, 6, 14, 1, "#A8B2C4").px(7, 5, "#8C97A6").px(7, 4, "#8C97A6");
      l.px(1, 11, "#8C97A6").px(1, 12, "#8C97A6").px(1, 13, "#8C97A6").px(2, 11, "#8C97A6").px(2, 14, "#8C97A6");
    }, "#23262E");
    const t = f % 48;
    if (t < 20) g.px(15, 1 + (t > 10 ? 1 : 0), "#E0A800");
    else if (t < 28) g.px(15, Math.round(2 + (t - 20) * 1.9), "#E0A800");
    else if (t < 32) g.px(14, 17, "#E0A80099").px(15, 17, "#E0A800");
    if (f % 60 < 3) g.px(4, 12, "#FFFFFF");
  }),

  it("snuffercap", "The Ghost's Snuffer Cap", "light", ["top"], "any", 380, 18, 22, "A Christmas Carol", (g, f) => {
    // A tall cone cap. Now and then it glides over the candle, and light leaks out beneath it.
    const t = f % 144, rest = [12, 9], over = [7, 2], down = [7, 8];
    const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    const pos = t < 60 ? rest : t < 72 ? lerp(rest, over, (t - 60) / 12) : t < 80 ? lerp(over, down, (t - 72) / 8) : t < 112 ? down : t < 120 ? lerp(down, over, (t - 112) / 8) : t < 132 ? lerp(over, rest, (t - 120) / 12) : rest;
    const covered = t >= 78 && t < 114;
    g.stamp((l) => { l.ell(7, 19.5, 4.5, 1.4, (nx, ny) => (ny < 0 ? "#FFD23F" : "#B07A1A")); l.rect(6, 11, 3, 8, "#FFF6DF").px(6, 11, "#FFFFFF"); l.ell(2, 19, 1.2, 1.2, (nx, ny) => (nx * nx + ny * ny < 0.3 ? null : "#D9A441")); }, "#4A3100");
    if (!covered) flameTip(g, 7, 10, f);
    const [cx, cy] = [Math.round(pos[0]), Math.round(pos[1])];
    g.stamp((l) => {
      for (let j = 0; j < 12; j++) { const hw = 0.5 + j * 0.3; l.rect(Math.round(cx - hw), cy + j, Math.round(hw * 2) + 1, 1, j === 11 ? "#3A3F4B" : "#5A606E"); l.px(Math.round(cx - hw), cy + j, "#8C97A6"); }
      l.ell(cx, cy - 1.5, 1.2, 1.2, (nx, ny) => (nx * nx + ny * ny < 0.25 ? null : "#5A606E"));
    }, "#14161C");
    if (covered) for (const d of [-5, -4, 4, 5]) g.px(cx + d, cy + 12 - (Math.abs(d) === 5 ? 0 : 1), (f + d) % 4 < 2 ? "#FFF3B0" : "#FFE36B99");
  }, { glow: (f) => { const t = f % 144; return t >= 78 && t < 114 ? [[7, 19, 12, "#FFE9A0"]] : [[7, 8, 22, "#FFD27A"]]; } }),
  it("giantpeach", "The Giant Peach", "furniture", ["stand"], "greenhouse", 1100, 40, 38, "James and the Giant Peach", (g, f) => {
    // A peach big enough to live in: a round window aglow and a little front door.
    g.shadow(20, 17, 37);
    const sw = Math.round(wave(f, 72, 0.7)), t = f % 120, ajar = t >= 60 && t < 90;
    g.stamp((l) => {
      l.ell(20, 21, 17, 15.5, (nx, ny, x, y) => {
        if (rnd(x * 13 + y * 7) > 0.93) return "#FFD0AA";
        if (nx + ny < -0.8) return "#FFD6B0";
        if (nx > 0.45 && ny < 0.3) return "#F07A62";
        return ny > 0.6 || nx + ny > 1 ? "#E0685A" : "#FFA880";
      });
      for (let y = 7; y < 34; y++) l.px(Math.round(19 + Math.sin(((y - 7) / 27) * Math.PI) * 4), y, "#E88A6A");
      l.rect(19, 2, 3, 5, "#6B3A1E").rect(19, 2, 1, 5, "#8A5424");
    }, "#5A1E12");
    g.stamp((l) => { l.ell(27 + sw, 3.5, 5, 2, (nx, ny) => (ny < -0.1 ? "#5FD06A" : "#2E9A48")); l.line(23 + sw, 4, 31 + sw, 3, "#1F7A38"); }, "#0E3A1A");
    const lit = (f >> 2) % 7 ? "#FFE08A" : "#FFD060";
    g.stamp((l) => { l.ell(12, 21, 3.4, 3.4, (nx, ny) => (nx * nx + ny * ny > 0.6 ? "#8A5A34" : lit)); l.rect(11, 18, 1, 6, "#8A5A34").rect(9, 20, 6, 1, "#8A5A34"); }, "#2A160A");
    g.stamp((l) => {
      for (let y = 26; y < 35; y++) for (let x = 25; x < 31; x++) if (y >= 28 || (x + 0.5 - 28) ** 2 + (y + 0.5 - 28) ** 2 < 9) l.px(x, y, ajar ? (x < 27 ? "#8A5A34" : "#FFE08A") : x % 2 ? "#8A5A34" : "#A06A40");
      if (!ajar) l.px(29, 31, "#FFD23F");
    }, "#2A160A");
  }, { glow: [[12, 21, 14, "#FFD27A"]] }),
  it("chocoticket", "Golden Chocolate Ticket", "wall", ["wall"], "kitchen", 1000, 32, 22, "Charlie and the Chocolate Factory", (g, f) => {
    // A shining golden ticket, framed on a chocolate-bar mat. No words: it speaks for itself.
    g.stamp((l) => {
      l.rect(1, 1, 30, 20, "#6B4226").rect(1, 1, 30, 1, "#8E5C36").rect(1, 1, 1, 20, "#8E5C36");
      for (let y = 3; y < 19; y++) for (let x = 3; x < 29; x++) l.px(x, y, (x - 3) % 6 === 5 || (y - 3) % 5 === 4 ? "#3A2014" : (x - 3) % 6 === 0 || (y - 3) % 5 === 0 ? "#6A3E26" : "#4E2C1A");
    }, "#1E120A");
    const band = ((f * 0.5) % 50) - 10;
    g.stamp((l) => {
      for (let y = 6; y < 16; y++) for (let x = 6; x < 26; x++) {
        if ((x === 6 || x === 25) && y % 2 === 0) continue;
        let c = y === 7 || y === 14 || x === 8 || x === 23 ? "#D9A441" : (x + y) % 5 === 0 ? "#FFE36B" : "#FFD23F";
        if (Math.abs(x - y * 0.6 - band) < 1.2) c = "#FFFBE0";
        l.px(x, y, c);
      }
      l.px(16, 9, "#B07A1A").rect(14, 10, 5, 1, "#B07A1A").rect(15, 11, 3, 1, "#B07A1A").px(15, 12, "#B07A1A").px(17, 12, "#B07A1A");
      for (const x of [11, 21]) l.px(x, 10, "#FFF3A6").px(x, 11, "#FFF3A6");
    }, "#6A4A00");
  }, { glow: [[16, 11, 16, "#FFD23F"]] }),
  it("farmwindmill", "Farmyard Windmill", "furniture", ["stand"], "greenhouse", 650, 30, 50, "Animal Farm", (g, f) => {
    const hx = 15, hy = 14, a = f * 0.08;
    g.shadow(15, 10, 49);
    g.stamp((l) => {
      for (let y = 15; y < 48; y++) { const hw = 5 + (y - 15) * 0.1; for (let x = Math.round(hx - hw); x < Math.round(hx + hw); x++) l.px(x, y, x > hx + hw - 2.5 ? "#D6C8A8" : (x * 3 + y * 5) % 11 === 0 ? "#E0D4B8" : "#F4ECD8"); }
      l.rect(13, 41, 4, 7, "#8A5A34").rect(14, 40, 2, 1, "#8A5A34").px(16, 44, "#FFD23F");
      l.rect(14, 26, 2, 3, "#3A2A1E");
      l.ell(hx, 15, 6.5, 6, (nx, ny, x, y) => (ny > 0 ? null : (x + y) % 3 === 0 ? "#6B4226" : "#8A5A34"));
      l.rect(8, 15, 14, 1, "#6B4226");
    }, "#2A1E14");
    g.stamp((l) => {
      for (let i = 0; i < 4; i++) {
        const b = a + (i * TAU) / 4, dx = Math.cos(b), dy = Math.sin(b), px = -dy, py = dx;
        l.line(hx, hy, hx + dx * 13, hy + dy * 13, "#6B4226");
        for (let r = 4; r <= 13; r++) for (let s = 1; s <= 3; s++) l.px(hx + dx * r + px * s, hy + dy * r + py * s, s === 3 || r === 13 ? "#8A5A34" : r % 4 === 0 ? "#D8C8A0" : "#F6ECD6");
      }
      l.ell(hx, hy, 1.6, 1.6, "#5E3A1F");
    }, "#2A160A");
  })

];

// ============================================================ wallpapers
export const NOD_WALLPAPERS = [
  {
    // Sickly yellow, with a pattern that won't keep still and a faint figure behind it.
    id: "yellowwallpaper", name: "The Yellow Wallpaper", price: 450, nod: "The Yellow Wallpaper",
    draw: tile((x, y, f) => {
      const TW = 20, TH = 28, tx = Math.floor(x / TW), ty = Math.floor(y / TH), X = x % TW, Y = y % TH, seed = tx * 7 + ty * 13;
      const wob = Math.sin((f / 240) * TAU + seed) * 0.5, v = Math.sin((Y / TH) * TAU + wob) * 6;
      const d = Math.min(Math.abs(X + 0.5 - (10 + v)), Math.abs(X + 0.5 - (10 - v)));
      const b0 = (X + 0.5 - 10) ** 2 + (Y + 0.5) ** 2, b1 = (X + 0.5 - 10) ** 2 + (Y + 0.5 - 14) ** 2, b2 = (X + 0.5 - 10) ** 2 + (Y + 0.5 - 28) ** 2;
      if (Math.min(b0, b1, b2) < 4.5) return Math.min(b0, b1, b2) < 1.5 ? "#C8B048" : "#A89238";
      if (d < 0.7) return "#B8A240";
      if (y % 60 === 40 || y % 60 === 41) return "#CDB850";
      if (rnd(seed) > 0.62) {
        const fx = 10 + Math.round(Math.sin((f / 360) * TAU + seed) * 1.2), fy = rnd(seed + 1) > 0.5 ? 7 : 21;
        if ((X - fx) ** 2 + (Y - (fy - 3)) ** 2 < 2.4 || ((X - fx) / 2) ** 2 + ((Y - (fy + 1.5)) / 3.5) ** 2 < 1) return "#CFBA55";
      }
      return rnd(Math.floor(x / 3) * 17 + Math.floor(y / 3) * 5) > 0.85 ? "#D4BF56" : "#DCC85E";
    })
  },
  {
    // Deep crimson damask: a diamond trellis with a flower in every lozenge.
    id: "redroom", name: "The Red Room", price: 380, nod: "Jane Eyre",
    draw: tile((x, y) => {
      const xm = x % 16, Y = y % 24, X = Math.abs(xm + 0.5 - 8), dY = Math.abs(Y + 0.5 - 12);
      const d = X / 8 + dY / 12;
      if (d > 0.92 && d < 1.04) return "#5A0A16";
      if (d < 1) {
        const core = (X / 4.2) ** 2 + ((Y + 0.5 - 12.5) / 6.5) ** 2;
        if (core < 0.3) return (X / 1.6) ** 2 + ((Y + 0.5 - 12) / 2.6) ** 2 < 1 ? "#B8303F" : "#8E1828";
        if (core < 0.55) return "#6E0E1C";
        if (core < 1) return "#A82436";
        if (X < 1 && Y > 2 && Y < 6) return "#A82436";
        if (Math.abs(X - (Y - 17) * 0.8) < 0.7 && Y > 17 && Y < 21) return "#A82436";
        return x % 4 === 0 ? "#7E1424" : "#7A1020";
      }
      const cx = Math.abs(xm + 0.5 - (xm < 8 ? 0 : 16)), cy = Math.abs(Y + 0.5 - (Y < 12 ? 0 : 24));
      if (cx + cy < 3) return cx + cy < 1.2 ? "#C8404E" : "#9A1C2E";
      return x % 4 === 0 ? "#6E0C1A" : "#6A0A18";
    })
  }
];
