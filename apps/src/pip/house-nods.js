/* Book-nod decor for Pip's house: original pieces with generic names that
 wink at famous books. `nod` names the book, for the app's own mapping only;
 it is never shown as a brand. Every drawing here is our own design; none
 copies film or cover art, logos, sigils or a character likeness.
 Same shape as the other house items (see house.js):
   { id, name, kind, fits, level, price, w, h, nod, draw(g, f), glow? }
 Pets are animated little residents. Pure functions of the frame, 12 fps. */
import { paintSky, rnd, lerpC } from "./room.js";
import { FONT } from "./engine.js";

const TAU = Math.PI * 2;
const wave = (f, per, amp = 1, off = 0) => amp * Math.sin((TAU * f) / per + off);
const it = (id, name, kind, fits, level, price, w, h, nod, draw, extra) => Object.assign({ id, name, kind, fits, level, price, w, h, nod, draw }, extra || {});
const note = (g, x, y, c) => g.stamp((l) => l.rect(x + 2, y, 1, 4, c).px(x + 3, y, c).px(x + 3, y + 1, c).rect(x, y + 3, 2, 2, c), "#1A1A22");
const plaque = (g, x, y, w, h) => g.stamp((l) => l.rect(x, y, w, h, "#6B4226").rect(x, y, w, 1, "#8E5C36").rect(x + 1, y + h - 1, w - 2, 1, "#4A2C16"), "#1E120A");

export const NOD_ITEMS = [
  it("racingbroom", "Racing Broomstick", "wall", ["wall"], "any", 450, 50, 16, "Harry Potter", (g, f) => {
    g.stamp((l) => { l.rect(8, 11, 2, 4, "#8C97A6").rect(38, 11, 2, 4, "#8C97A6"); }, "#23262E");
    const bob = Math.round(wave(f, 48, 0.6));
    g.stamp((l) => {
      // A sleek, polished handle with a gold band, then swept twig bristles.
      l.rect(2, 7 + bob, 32, 2, "#6B3A1E").rect(2, 7 + bob, 32, 1, "#B07A4A").px(1, 8 + bob, "#6B3A1E");
      l.rect(28, 6 + bob, 3, 4, "#FFD23F").px(28, 6 + bob, "#FFF3A6");
      for (let j = 0; j < 7; j++) {
        const y = 5 + j + bob, len = 14 - Math.abs(j - 3) * 2;
        l.line(31, 8 + bob, 32 + len, y + (j - 3) * 0.6, j % 2 ? "#C88A45" : "#A86A32");
      }
      l.rect(31, 6 + bob, 2, 5, "#8A5424");
    }, "#2A160A");
    if (f % 48 < 4) g.px(12 + (f % 48) * 4, 6 + bob, "#FFFFFF");
  }),
  it("sockelf", "House-Helper Elf", "furniture", ["stand", "top"], "any", 700, 22, 26, "Harry Potter", (g, f) => {
    // Our own little helper: round, moss-grey, huge floppy ears, a patchwork
    // tunic, and a stripy sock held up like a prize.
    const wv = Math.floor(f / 6) % 2, blink = f % 60 < 3, hop = f % 48 < 6 ? -1 : 0;
    g.shadow(11, 7, 25);
    g.stamp((l) => {
      l.ell(11, 15 + hop, 6, 7, (nx, ny) => (nx + ny < -0.6 ? "#C7D1B4" : "#A7B494"));
      for (const s of [-1, 1]) for (let j = 0; j < 5; j++) l.rect(11 + s * (5 + j) - (s < 0 ? 1 : 0), 11 + hop - Math.floor(j / 2) + (j > 3 ? 1 : 0), 2, 2 - (j > 3 ? 1 : 0), j < 2 ? "#A7B494" : "#C7D1B4").px(11 + s * (6 + j) - (s < 0 ? 1 : 0), 12 + hop - Math.floor(j / 2), j > 0 && j < 4 ? "#E8A8B0" : null);
      l.rect(6, 18 + hop, 11, 5, "#C88A45").rect(6, 18 + hop, 4, 3, "#8E5CFF").rect(13, 20 + hop, 4, 3, "#2FA35E").px(10, 21 + hop, "#FFFFFF");
      l.rect(7, 23, 3, 2, "#7A8468").rect(12, 23, 3, 2, "#7A8468");
    }, "#2A3020");
    g.stamp((l) => {
      l.ell(8.5, 13 + hop, 2, 2.2, "#FFFFFF").ell(13.5, 13 + hop, 2, 2.2, "#FFFFFF");
      if (!blink) l.rect(8, 13 + hop, 2, 2, "#2F6FD0").rect(13, 13 + hop, 2, 2, "#2F6FD0").px(8, 13 + hop, "#FFFFFF").px(13, 13 + hop, "#FFFFFF");
      l.px(10, 16 + hop, "#5A6450").px(11, 17 + hop, "#5A6450").px(12, 16 + hop, "#5A6450");
    }, "#2A3020");
    // The sock, waved overhead.
    const sx = 17 + wv, sy = 3 + hop;
    g.line(15, 16 + hop, sx, sy + 6, "#A7B494");
    g.stamp((l) => { for (let j = 0; j < 6; j++) l.rect(sx - 1, sy + j, 3, 1, j % 2 ? "#FFFFFF" : "#E0393E"); l.rect(sx - 3, sy + 5, 3, 2, "#E0393E"); }, "#3A0A10");
  }),
  it("owlperch", "Owl on a Perch", "furniture", ["stand"], "library", 600, 22, 36, "Harry Potter", (g, f) => {
    g.shadow(11, 7, 35);
    g.stamp((l) => { l.rect(10, 14, 2, 20, "#6B4226").rect(3, 13, 16, 2, "#8A5A34").rect(5, 33, 12, 2, "#6B4226"); }, "#1E120A");
    const turn = Math.floor(f / 36) % 3 - 1, blink = f % 50 < 3, letter = f % 144 > 96;
    g.stamp((l) => {
      l.ell(11, 7, 6, 6.5, (nx, ny, x, y) => ((x + y) % 3 === 0 && ny > 0 ? "#C9C2B2" : nx + ny < -0.5 ? "#FFFFFF" : "#F1ECDF"));
      l.px(6, 1, "#F1ECDF").px(16, 1, "#F1ECDF");
      for (const x of [9, 11, 13]) l.px(x + turn, 11, "#8C8A80");
    }, "#3A3428");
    g.stamp((l) => {
      l.ell(8.5 + turn, 5.5, 2, 2, "#FFD23F").ell(13.5 + turn, 5.5, 2, 2, "#FFD23F");
      if (!blink) l.px(8 + turn, 5, "#1A1A22").px(9 + turn, 5, "#1A1A22").px(13 + turn, 5, "#1A1A22").px(14 + turn, 5, "#1A1A22");
      else l.rect(7 + turn, 5, 3, 1, "#C9C2B2").rect(12 + turn, 5, 3, 1, "#C9C2B2");
      l.px(11 + turn, 7, "#E0A800").px(11 + turn, 8, "#B07A1A");
      l.px(8, 13, "#E0A800").px(10, 13, "#E0A800").px(12, 13, "#E0A800").px(14, 13, "#E0A800");
    }, "#3A3428");
    if (letter) g.stamp((l) => l.rect(10 + turn, 8, 6, 4, "#FFF6DF").line(10 + turn, 8, 13 + turn, 10, "#C9B58C").line(15 + turn, 8, 13 + turn, 10, "#C9B58C").px(13 + turn, 10, "#C8453B"), "#5A4A36");
  }),
  it("goldenball", "Winged Golden Ball", "ceiling", ["ceiling"], "any", 800, 48, 28, "Harry Potter", (g, f) => {
    // Darts around its box in a figure-eight, wings a blur.
    const t = (f % 96) / 96, x = 24 + Math.sin(t * TAU) * 16, y = 13 + Math.sin(t * TAU * 2) * 7, up = f % 2 === 0;
    for (let i = 1; i < 4; i++) { const u = t - i * 0.012, tx = 24 + Math.sin(u * TAU) * 16, ty = 13 + Math.sin(u * TAU * 2) * 7; g.px(tx, ty, i === 1 ? "#FFE36B99" : "#FFE36B44"); }
    g.stamp((l) => {
      for (const s of [-1, 1]) {
        if (up) { l.line(x + s * 2, y - 1, x + s * 7, y - 4, "#F4F1E8"); l.line(x + s * 2, y, x + s * 6, y - 2, "#DDE3EC"); l.px(x + s * 5, y - 3, "#F4F1E8"); }
        else { l.line(x + s * 2, y, x + s * 7, y + 2, "#F4F1E8"); l.line(x + s * 2, y + 1, x + s * 5, y + 3, "#DDE3EC"); }
      }
      l.ell(x, y, 2.3, 2.3, (nx, ny) => (nx + ny < -0.5 ? "#FFF6C2" : nx + ny > 0.6 ? "#E0A800" : "#FFD23F"));
    }, "#4A3100");
  }, { glow: (f) => { const t = (f % 96) / 96; return [[24 + Math.sin(t * TAU) * 16, 13 + Math.sin(t * TAU * 2) * 7, 14, "#FFD23F"]]; } }),
  it("wizardtrunk", "Wizard's Trunk", "furniture", ["stand"], "bedroom", 350, 38, 26, "Harry Potter", (g, f) => {
    const t = f % 120, open = t < 20 ? Math.sin((t / 20) * Math.PI) * 4 : 0;
    g.shadow(19, 17, 25);
    g.stamp((l) => {
      l.rect(2, 11, 34, 13, "#5A2E6B").rect(2, 11, 34, 1, "#7A4A8E");
      for (const x of [2, 33]) l.rect(x, 11, 3, 13, "#D9A441");
      l.rect(2, 22, 34, 2, "#D9A441");
      l.rect(10, 11, 3, 13, "#6B4226").rect(25, 11, 3, 13, "#6B4226");
      l.rect(17, 13, 4, 4, "#FFD23F").px(19, 15, "#4A3100");
      l.rect(5, 16, 4, 3, "#FFF6DF").px(6, 17, "#E0393E").rect(28, 17, 4, 3, "#9FE3CF");
    }, "#1E0E24");
    g.stamp((l) => { l.rect(2, 5 - open, 34, 6, "#6A3A7E").rect(2, 5 - open, 34, 1, "#8E5CA8").rect(2, 5 - open, 3, 6, "#D9A441").rect(33, 5 - open, 3, 6, "#D9A441").rect(10, 5 - open, 3, 6, "#6B4226").rect(25, 5 - open, 3, 6, "#6B4226"); }, "#1E0E24");
    if (open > 1) for (let i = 0; i < 4; i++) g.px(8 + i * 7 + (f % 3), 9 - open - ((f + i) % 4), i % 2 ? "#FFE36B" : "#C89BFF");
  }),
  it("floatingcandles", "Floating Candles", "ceiling", ["ceiling"], "library", 400, 54, 30, "Harry Potter", (g, f) => {
    for (let i = 0; i < 6; i++) {
      const x = 5 + i * 9, y = 8 + (i % 3) * 5 + Math.round(wave(f, 36, 1.2, i * 1.3)), h = 5 + (i % 2) * 2;
      g.stamp((l) => l.rect(x, y, 3, h, "#F4F1E8").px(x, y, "#FFFFFF").px(x + 2, y + 2, "#E6E0D2"), "#5A4A36");
      const k = (f + i * 3) % 6 < 3;
      g.px(x + 1, y - 1, "#FFC53D").px(x + 1 + (k ? 0 : -1), y - 2, "#FFE36B").px(x + 1, y - 3, k ? "#FFF3B0" : null);
    }
  }, { glow: [[14, 12, 26, "#FFD27A"], [40, 14, 26, "#FFD27A"]] }),
  it("dragonegg", "Dragon Egg on a Nest", "furniture", ["top", "stand"], "any", 900, 20, 22, "A Song of Ice and Fire", (g, f) => {
    const t = f % 96, wob = t < 12 ? Math.round(Math.sin((t / 12) * TAU * 2) * 1) : 0;
    g.stamp((l) => {
      l.ell(10 + wob * 0.5, 10, 5.5, 7.5, (nx, ny, x, y) => {
        const scale = ((x + Math.floor(y / 2)) % 3 === 0 && y % 2 === 0);
        return scale ? "#E0584E" : nx + ny < -0.6 ? "#B04A6A" : nx + ny > 0.6 ? "#3A1030" : "#6A1E44";
      });
      l.px(8 + wob, 5, "#FFB3C7");
    }, "#140610");
    g.stamp((l) => { for (let i = 0; i < 20; i++) l.px(1 + i, 17 + (i % 3 === 0 ? 0 : 1), i % 2 ? "#E8C872" : "#C9A04A"); l.ell(10, 19, 9, 2.5, (nx, ny, x) => (x % 2 ? "#D4AE58" : "#B08A3A")); }, "#3A2A0A");
    if (t < 12 || f % 24 < 3) g.px(14, 8, "#FFE36B");
  }, { glow: (f) => [[10, 10, 16 + Math.round(wave(f, 48, 3)), "#FF6B4D"]] }),
  it("banners", "House Banners", "wall", ["wall"], "any", 500, 50, 36, "A Song of Ice and Fire", (g, f) => {
    g.stamp((l) => l.rect(1, 1, 48, 2, "#6B4226").px(0, 1, "#D9A441").px(49, 1, "#D9A441"), "#1E120A");
    const banner = (x, field, trim, emblem) => {
      const sw = Math.round(wave(f, 60, 0.6, x));
      g.stamp((l) => {
        for (let y = 3; y < 33; y++) { const w = y > 27 ? 14 - (y - 27) * 2 : 14; l.rect(x + (14 - w) / 2 + (y > 20 ? sw : 0), y, w, 1, y === 3 || y === 4 ? trim : field); }
        l.px(x + 7 + sw, 33, field);
      }, "#1A1A22");
      emblem(x + 7, 13);
    };
    // A grey wolf's head on white, a lion's face on gold, a winged dragon on charcoal: all our own simple shapes.
    const map = (rows, pal) => (cx, cy) => g.stamp((l) => rows.forEach((r, j) => [...r].forEach((ch, i) => pal[ch] && l.px(cx - (r.length >> 1) + i, cy - 4 + j, pal[ch]))), "#1A1A22");
    banner(1, "#E6E9EE", "#6B7489", map([
      "..#..#....",
      "..##.##...",
      "..######..",
      ".##o#####.",
      ".#########",
      "..######..",
      "..####....",
      ".####.....",
      "####......"
    ], { "#": "#6B7489", o: "#FFFFFF" }));
    banner(18, "#FFC93C", "#B0203A", map([
      "..mmmmm..",
      ".mmfffmm.",
      "mmfffffmm",
      "mmfefefmm",
      "mmfffffmm",
      "mmffnffmm",
      ".mmfmfmm.",
      "..mmmmm..",
      "...m.m..."
    ], { m: "#B0203A", f: "#FFE08A", e: "#1A1A22", n: "#6B1A1A" }));
    banner(35, "#2A2A33", "#C8303F", map([
      ".#.......#",
      ".##.....##",
      "..##...##.",
      "...##.##..",
      "....###.##",
      "#########o",
      "....###...",
      "....#.#...",
      "...#...#.."
    ], { "#": "#E0393E", o: "#FFD23F" }));
  }),
  it("longsword", "Ripple-Steel Longsword", "wall", ["wall"], "any", 750, 52, 16, "A Song of Ice and Fire", (g, f) => {
    plaque(g, 2, 3, 48, 11);
    g.stamp((l) => {
      for (let x = 4; x < 38; x++) {
        const wav = Math.sin(x * 0.9) > 0.3;
        l.px(x, 7, wav ? "#8C95A8" : "#5A6278").px(x, 8, wav ? "#5A6278" : "#8C95A8");
      }
      l.px(3, 7, "#8C95A8").px(4, 6, "#C9D1DB");
      l.rect(38, 4, 2, 8, "#4A4F5E").rect(38, 4, 1, 8, "#8C95A8");
      l.rect(40, 7, 7, 2, "#3A2418").px(42, 7, "#6B4226").px(44, 8, "#6B4226");
      l.ell(48, 7.5, 1.6, 1.6, "#8C95A8");
    }, "#14161C");
    const k = f % 72;
    if (k < 18) g.px(4 + k * 2, 7, "#FFFFFF");
  }),
  it("sandworm", "Tiny Pet Sandworm", "furniture", ["stand", "top"], "any", 900, 30, 28, "Dune", (g, f) => {
    // A sand terrarium; now and then the worm rises, round toothy mouth open.
    g.shadow(15, 13, 27);
    g.stamp((l) => { l.rect(1, 6, 28, 20, "#D6F4FF").rect(2, 7, 1, 17, "#FFFFFF"); l.rect(0, 25, 30, 2, "#6B4226"); }, "#1E3A4A");
    for (let y = 18; y < 25; y++) for (let x = 2; x < 28; x++) g.px(x, y, y === 18 + Math.round(Math.sin(x * 0.6 + f * 0.05)) ? "#F2D29A" : rnd(x * 3 + y * 7) > 0.8 ? "#C99A58" : "#E0B872");
    const t = f % 72, rise = t < 36 ? Math.sin((t / 36) * Math.PI) : 0, top = Math.round(19 - rise * 14);
    if (rise > 0.05) {
      g.stamp((l) => {
        for (let y = top; y < 20; y++) {
          const u = (y - top) / Math.max(1, 20 - top), cx = 15 + Math.sin(u * 2.4 + 0.6) * 1.2, w = 3.6 + u * 1.6;
          for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) l.px(x, y, (y - top) % 3 === 2 ? "#9A6A3E" : x < cx - w * 0.4 ? "#E0AE7E" : x > cx + w * 0.5 ? "#A8784A" : "#C8966A");
        }
        const cx = 15 + Math.sin(0.6) * 1.2;
        l.ell(cx, top, 5, 2.8, "#C8966A");
        if (rise > 0.45) {
          l.ell(cx, top, 4, 2, "#FF8FA3");
          l.ell(cx, top + 0.3, 2.4, 1.1, "#5A1E10");
          for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; l.px(cx + Math.cos(a) * 3.3, top + Math.sin(a) * 1.6, "#FFF6DF"); }
        }
      }, "#3A2010");
      for (let i = 0; i < 3; i++) g.px(9 + i * 6, 17 - Math.round(rise * (2 + i % 2)), "#E0B872");
    }
  }),
  it("spicelamp", "Spice Lamp", "light", ["top", "stand"], "any", 300, 14, 24, "Dune", (g, f) => {
    g.stamp((l) => { l.rect(5, 16, 4, 6, "#8A5A34").rect(3, 21, 8, 2, "#6B4226"); l.rect(4, 3, 6, 1, "#B07A1A"); }, "#2A160A");
    g.stamp((l) => l.ell(7, 9.5, 5.5, 6.5, (nx, ny) => (nx + ny < -0.6 ? "#FFD08A" : nx + ny > 0.7 ? "#C85A1A" : "#FF8A2A")), "#4A1E08");
    for (let i = 0; i < 5; i++) { const a = f * 0.08 + i * 1.3, r = 1.5 + (i % 3); g.px(7 + Math.cos(a) * r, 9.5 + Math.sin(a * 1.3) * r * 1.3, i % 2 ? "#FFF3B0" : "#FFE36B"); }
  }, { glow: [[7, 10, 26, "#FF9A3D"]] }),
  it("mockingbird", "Mockingbird Pet", "furniture", ["stand", "top"], "greenhouse", 650, 22, 32, "The Hunger Games", (g, f) => {
    // A grey songbird with white wing flashes, perched inside a brass ring on a stand. It sings.
    g.shadow(11, 6, 31);
    g.stamp((l) => { l.ring(11, 12, 9, "#D9A441"); l.rect(10, 21, 2, 9, "#B07A1A").rect(5, 29, 12, 2, "#8A5A34"); }, "#4A3100");
    const sing = f % 48 < 24, bob = sing && f % 6 < 3 ? -1 : 0;
    g.stamp((l) => {
      l.ell(11, 14 + bob, 4, 3, "#7E8490").ell(14, 11 + bob, 2.4, 2.2, "#8C929E");
      l.line(7, 15 + bob, 2, 18 + bob, "#5A606E").line(7, 16 + bob, 3, 19 + bob, "#5A606E");
      l.rect(9, 13 + bob, 3, 1, "#FFFFFF").px(8, 14 + bob, "#FFFFFF");
      l.px(17, 11 + bob, sing ? "#1A1A22" : "#3A3F4B").px(17, 12 + bob, sing ? "#1A1A22" : "#3A3F4B").px(18, 11 + bob, "#1A1A22");
      l.px(15, 10 + bob, "#FFD23F");
      l.rect(10, 17, 1, 3, "#3A3F4B").rect(12, 17, 1, 3, "#3A3F4B");
    }, "#1B1E26");
    if (sing) { const t = (f % 24) / 24; note(g, 15 + Math.round(t * 4), Math.round(3 - t * 3), t < 0.5 ? "#8E5CFF" : "#FF4D6D"); }
  }),
  it("bowquiver", "Bow & Quiver", "wall", ["wall"], "any", 300, 32, 36, "The Hunger Games", (g) => {
    g.stamp((l) => {
      for (let y = 2; y < 34; y++) { const x = 6 + Math.round(Math.sin(((y - 2) / 31) * Math.PI) * -4 + (y < 6 || y > 30 ? 1 : 0)); l.px(x, y, "#6B3A1E").px(x + 1, y, "#8A5A34"); }
      l.line(7, 2, 7, 33, "#F4F1E8");
      l.rect(4, 16, 3, 4, "#3A2418");
    }, "#1E0E06");
    g.stamp((l) => {
      l.rect(17, 12, 9, 20, "#8A5A34").rect(17, 12, 9, 1, "#B07A4A").rect(17, 18, 9, 1, "#D9A441").rect(17, 28, 9, 1, "#D9A441");
      for (const [x, c] of [[18, "#E0393E"], [21, "#F4F1E8"], [24, "#E0393E"]]) { l.rect(x, 5, 1, 7, "#C9B58C"); l.rect(x - 1, 3, 3, 3, c); }
    }, "#2A160A");
  }),
  it("lamppost", "Lamppost in the Snow", "light", ["stand"], "greenhouse", 800, 24, 60, "The Chronicles of Narnia", (g, f) => {
    g.stamp((l) => {
      l.rect(10, 16, 4, 38, "#2A2A33").rect(10, 16, 1, 38, "#4A4A58");
      l.rect(7, 52, 10, 3, "#2A2A33").rect(6, 14, 12, 2, "#2A2A33");
      for (let j = 0; j < 9; j++) l.rect(7 + Math.floor(j / 3), 5 + j, 10 - Math.floor(j / 3) * 2, 1, j < 1 ? "#2A2A33" : "#FFE9A0");
      l.rect(8, 5, 1, 9, "#2A2A33").rect(15, 5, 1, 9, "#2A2A33").rect(9, 2, 6, 3, "#2A2A33").px(12, 1, "#2A2A33");
    }, "#0B0B10");
    g.stamp((l) => l.ell(12, 57, 11, 3, (nx, ny) => (ny < -0.2 ? "#FFFFFF" : "#DDE8F4")), "#6B7A90");
    g.rect(6, 14, 12, 1, "#FFFFFF");
    for (let i = 0; i < 7; i++) { const t = ((f * 0.4 + i * 9) % 56) / 56; g.px(Math.round(2 + rnd(i) * 20 + Math.sin(f * 0.1 + i) * 1.5), Math.round(t * 54), "#FFFFFF"); }
  }, { glow: [[12, 9, 32, "#FFE9A0"]] }),
  it("magicwardrobe", "Magic Wardrobe", "furniture", ["stand"], "bedroom", 1200, 40, 64, "The Chronicles of Narnia", (g, f) => {
    g.shadow(20, 18, 63);
    g.stamp((l) => {
      l.rect(2, 6, 36, 54, "#6B4226").rect(0, 2, 40, 5, "#8A5A34").rect(4, 0, 32, 3, "#6B4226").rect(2, 58, 36, 3, "#5A3820");
      l.rect(4, 9, 15, 47, "#7A4C2C");
      for (const [x, y] of [[7, 14], [7, 32], [11, 24]]) l.ell(x + 4, y, 3, 4, "#8E5C36").ell(x + 4, y, 1.5, 2, "#6B4226");
      l.rect(4, 61, 4, 2, "#3E2614").rect(32, 61, 4, 2, "#3E2614");
    }, "#1E120A");
    // The right door ajar: a snowy pine wood glows inside, snow drifts out.
    for (let y = 9; y < 56; y++) for (let x = 21; x < 36; x++) g.px(x, y, lerpC("#6A8FC8", "#DDEEFF", (y - 9) / 47));
    for (const [x, h] of [[24, 14], [31, 18]]) for (let j = 0; j < h; j++) { const w = Math.floor(j / 2); g.rect(x - w / 2, 56 - h + j, w + 1, 1, "#2E6B4A"); }
    g.rect(21, 52, 15, 4, "#FFFFFF");
    g.stamp((l) => l.rect(36, 9, 3, 47, "#8A5A34").rect(36, 9, 1, 47, "#B07A4A"), "#1E120A");
    g.rect(21, 10, 3, 20, "#8A6A4A").rect(22, 10, 1, 20, "#A88A6A");
    for (let i = 0; i < 6; i++) { const t = ((f * 0.5 + i * 11) % 40) / 40; g.px(Math.round(24 + i * 2 + t * 10), Math.round(14 + rnd(i) * 30 + t * 6), t < 0.8 ? "#FFFFFF" : null); }
    g.px(19, 33, "#FFD23F");
  }, { glow: [[28, 32, 26, "#CFE4FF"]] }),
  it("ringpedestal", "Ring on a Velvet Pedestal", "furniture", ["top"], "library", 1000, 16, 18, "The Lord of the Rings", (g, f) => {
    g.stamp((l) => { l.rect(3, 12, 10, 5, "#6B4226").rect(3, 12, 10, 1, "#8E5C36"); l.ell(8, 11, 6, 2.5, (nx, ny) => (ny < -0.2 ? "#C8303F" : "#8A1428")); }, "#1E0608");
    g.stamp((l) => { l.ring(8, 7, 2.6, "#FFD23F"); l.px(6, 5, "#FFF6C2"); }, "#4A3100");
    const k = f % 60;
    if (k < 8) { const r = k < 4 ? 1 : 2; g.px(10, 5 - r, "#FFFFFF").px(10, 5 + r, "#FFFFFF").px(10 - r, 5, "#FFFFFF").px(10 + r, 5, "#FFFFFF").px(10, 5, "#FFFFFF"); }
  }, { glow: [[8, 7, 10, "#FFD23F"]] }),
  it("greenlight", "Green Light Lamp", "light", ["stand"], "any", 400, 14, 44, "The Great Gatsby", (g, f) => {
    const on = Math.floor(f / 18) % 4 !== 3;
    g.stamp((l) => { l.rect(6, 8, 2, 33, "#3A3F4B").rect(3, 40, 8, 3, "#3A3F4B").rect(3, 3, 8, 2, "#3A3F4B").rect(5, 1, 4, 2, "#3A3F4B"); }, "#0B0B10");
    g.stamp((l) => l.rect(4, 5, 6, 4, on ? "#6BFF8A" : "#2E6B3E").px(4, 5, on ? "#DFFFE6" : "#4A8A5A"), "#0B2A14");
  }, { glow: (f) => (Math.floor(f / 18) % 4 !== 3 ? [[7, 7, 28, "#4DFF7A"]] : []) }),
  it("whaleskeleton", "Whale Skeleton", "wall", ["wall"], "library", 1100, 64, 26, "Moby-Dick", (g, f) => {
    const sw = Math.round(wave(f, 96, 0.6));
    g.line(14, 0, 14, 6, "#8C8F96").line(46, 0, 46, 6 + sw, "#8C8F96");
    g.stamp((l) => {
      l.ell(8, 12, 7, 4.5, (nx, ny) => (ny > 0.5 && nx > 0 ? null : "#F4F1E8")); l.px(6, 11, "#3A3428");
      for (let x = 14; x < 58; x++) l.px(x, 10 + Math.round(Math.sin((x - 14) / 44 * Math.PI) * -2 + (x > 44 ? sw * (x - 44) / 14 : 0)), "#F4F1E8");
      for (let i = 0; i < 8; i++) { const x = 17 + i * 4, len = 9 - Math.abs(i - 3); l.line(x, 9, x - 1, 9 + len, "#E6E0D2"); }
      l.line(57, 9 + sw, 62, 5 + sw, "#F4F1E8").line(57, 10 + sw, 62, 14 + sw, "#F4F1E8");
      l.line(3, 15, 12, 16, "#E6E0D2");
    }, "#5A5448");
  }),
  it("rosedome", "Rose Under a Glass Dome", "furniture", ["top"], "any", 600, 16, 24, "Beauty and the Beast", (g, f) => {
    g.stamp((l) => l.rect(2, 20, 12, 3, "#6B4226").rect(2, 20, 12, 1, "#8E5C36"), "#1E120A");
    g.stamp((l) => { l.line(8, 19, 8, 10, "#2E8B3C"); l.ell(6, 14, 1.6, 1, "#3FA35E"); l.ell(8, 8, 2.6, 2.4, (nx, ny) => (nx + ny < -0.4 ? "#FF6B7A" : "#C8203A")); l.px(8, 8, "#8A1020"); }, "#3A0610");
    const t = f % 96;
    if (t > 40 && t < 76) g.stamp((l) => l.px(9 + Math.round(Math.sin(t * 0.3)), 10 + Math.round((t - 40) / 4), "#C8203A"), "#3A0610");
    for (let y = 2; y < 20; y++) for (let x = 2; x < 14; x++) {
      const inG = y >= 7 ? true : (x + 0.5 - 8) ** 2 + ((y + 0.5 - 7) * 1.2) ** 2 < 36;
      if (!inG) continue;
      const edge = x === 2 || x === 13 || (y < 7 && (x + 0.5 - 8) ** 2 + ((y + 0.5 - 7) * 1.2) ** 2 > 25);
      if (edge) g.px(x, y, "#BFEFFF"); else if (x === 4 && y > 5 && y < 16) g.px(x, y, "#FFFFFF88");
    }
  }, { glow: [[8, 9, 12, "#FF8FA3"]] }),
  it("crimsonbloom", "Crimson Bloom", "furniture", ["stand", "top"], "greenhouse", 350, 18, 26, "Red Rising", (g, f) => {
    const sw = Math.round(wave(f, 72, 0.6));
    g.stamp((l) => { l.line(9, 20, 9 + sw, 9, "#2E8B3C"); l.ell(5, 17, 3.5, 1.5, "#3FA35E").ell(13, 16, 3.5, 1.5, "#3FA35E"); }, "#123A1E");
    // A round, spiky red flower head: many fine red rays around a red core.
    g.stamp((l) => {
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, r = i % 2 ? 5 : 4; l.line(9 + sw, 7, 9 + sw + Math.cos(a) * r, 7 + Math.sin(a) * r, i % 2 ? "#FF3040" : "#E0102A"); }
      l.ell(9 + sw, 7, 2.4, 2.4, "#B00820");
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; l.px(9 + sw + Math.cos(a) * 5, 7 + Math.sin(a) * 5, "#FFD23F"); }
    }, "#3A0008");
    g.stamp((l) => l.rect(3, 20, 12, 5, "#3A3F4B").rect(3, 20, 12, 1, "#5A606E"), "#0B0B10");
  }),
  it("slingblade", "Curved Slingblade", "wall", ["wall"], "workshop", 900, 44, 22, "Red Rising", (g, f) => {
    plaque(g, 2, 16, 40, 5);
    g.stamp((l) => {
      // A stylised whip-curved blade: one long crescent arc, gold grip.
      for (let i = 0; i < 34; i++) {
        const t = i / 33, x = 6 + t * 32, y = 12 - Math.sin(t * Math.PI) * 9 + t * 2;
        const w = 1 + Math.sin(t * Math.PI) * 1.2;
        for (let k = 0; k <= w; k++) l.px(x, y + k, k === 0 ? "#EEF3F8" : "#A8B2C4");
      }
      l.rect(2, 11, 5, 3, "#D9A441").rect(2, 11, 5, 1, "#FFE36B").rect(6, 10, 2, 5, "#8A6400");
    }, "#14161C");
    const k = f % 60;
    if (k < 16) { const t = k / 15, x = 6 + t * 32, y = 12 - Math.sin(t * Math.PI) * 9 + t * 2; g.px(x, y, "#FFFFFF"); }
  }),
  it("moonwindow", "Grey Moon-Station View", "window", ["window"], "observatory", 1000, 36, 36, "Star Wars", (g, f) => {
    const inside = (x, y) => (x + 0.5 - 18) ** 2 + (y + 0.5 - 18) ** 2 < 13 * 13;
    for (let y = 4; y < 32; y++) for (let x = 4; x < 32; x++) if (inside(x, y)) g.px(x, y, rnd(x * 31 + y * 7) > 0.96 && (f + x) % 40 > 2 ? "#FFFFFF" : "#0B0D24");
    // A grey, moon-sized station: panelled sphere, one big dish, drifting slowly.
    const cx = 17 + Math.round(wave(f, 240, 1.5)), cy = 17;
    g.ell(cx, cy, 7, 7, (nx, ny, x, y) => {
      if (!inside(x, y)) return null;
      const dish = (nx - 0.3) ** 2 + (ny + 0.32) ** 2 < 0.13;
      if (dish) return (nx - 0.3) ** 2 + (ny + 0.32) ** 2 < 0.025 ? "#C9CED6" : (nx - 0.3) + (ny + 0.32) < 0 ? "#4A4F5A" : "#7E8490";
      if ((y + x * 0) % 3 === 0 && Math.abs(ny) < 0.8) return nx + ny > 0.5 ? "#4A4F5A" : "#7E8490";
      return nx + ny < -0.6 ? "#C9CED6" : nx + ny > 0.6 ? "#5A606E" : "#9CA3B0";
    });
    g.stamp((l) => { l.ell(18, 18, 17, 17, (nx, ny) => (nx * nx + ny * ny < 0.62 ? null : nx + ny < -0.6 ? "#DDE3EC" : "#8C97A6")); for (const [x, y] of [[18, 2], [18, 33], [2, 18], [33, 18]]) l.px(x, y, "#3A3F4B"); }, "#1B2230");
    g.px(10, 10, "#FFFFFF66");
  }),
  it("chocofountain", "Chocolate Waterfall Fountain", "furniture", ["stand", "top"], "kitchen", 500, 26, 28, "Charlie and the Chocolate Factory", (g, f) => {
    g.stamp((l) => {
      l.ell(13, 24, 11, 3, (nx, ny) => (ny < -0.2 ? "#6B3A1E" : "#C9D1DB"));
      l.rect(12, 8, 2, 16, "#C9D1DB");
      l.ell(13, 17, 7, 2, (nx, ny) => (ny < -0.2 ? "#7A4A22" : "#C9D1DB"));
      l.ell(13, 9, 4.5, 1.6, (nx, ny) => (ny < -0.2 ? "#8A5424" : "#C9D1DB"));
      l.rect(12, 3, 2, 5, "#7A4A22");
    }, "#23262E");
    for (const [x0, y0, y1] of [[8, 10, 16], [18, 10, 16], [5, 18, 23], [21, 18, 23]]) for (let y = y0; y < y1; y++) g.px(x0 + ((y + (f >> 1)) % 3 === 0 ? (x0 < 13 ? -1 : 1) : 0), y, (y + (f >> 1)) % 2 ? "#6B3A1E" : "#8A5424");
    g.px(12, 2 - (f % 12 < 6 ? 0 : 1), "#8A5424");
    for (const [x, c] of [[4, "#FF4D6D"], [10, "#FFD23F"], [19, "#7FE0FF"]]) g.px(x, 25, c);
  }),
  it("timechair", "Time Machine Chair", "furniture", ["stand"], "workshop", 1500, 40, 40, "The Time Machine", (g, f) => {
    // A brass-and-velvet seat before a great spinning dial.
    g.shadow(20, 18, 39);
    const a = f * 0.25;
    g.stamp((l) => {
      l.ell(26, 15, 13, 13, (nx, ny) => {
        const d = nx * nx + ny * ny, ang = Math.atan2(ny, nx) + a;
        if (d < 0.08) return "#FFD23F";
        if (d > 0.85) return "#B07A1A";
        return Math.sin(ang * 6) > 0.2 ? "#D9A441" : "#8A6400";
      });
    }, "#3A2400");
    g.stamp((l) => {
      l.rect(4, 32, 26, 3, "#B07A1A").rect(6, 35, 2, 4, "#8A6400").rect(26, 35, 2, 4, "#8A6400");
      l.rect(5, 24, 22, 8, "#8A1428").rect(5, 24, 22, 1, "#C8303F");
      l.rect(5, 10, 6, 16, "#8A1428").rect(5, 10, 6, 1, "#C8303F").rect(4, 8, 8, 2, "#D9A441");
      l.rect(24, 20, 3, 12, "#D9A441");
      l.line(31, 34, 35, 26, "#8C97A6"); l.ell(35, 25, 1.6, 1.6, "#E0393E");
    }, "#1E0608");
    if (f % 24 < 4) for (let i = 0; i < 4; i++) g.px(20 + i * 5, 3 + (i % 2) * 22, "#FFFFFF");
  }, { glow: [[26, 15, 20, "#FFE36B"]] }),
  it("towelrack", "Towel Rack & 42 Towel", "wall", ["wall", "stand"], "any", 150, 26, 28, "The Hitchhiker's Guide to the Galaxy", (g, f) => {
    g.stamp((l) => { l.rect(2, 4, 22, 2, "#C9D1DB").rect(1, 2, 2, 6, "#8C97A6").rect(23, 2, 2, 6, "#8C97A6"); }, "#23262E");
    const sw = Math.round(wave(f, 72, 0.5));
    g.stamp((l) => {
      for (let y = 5; y < 26; y++) l.rect(5 + (y > 16 ? sw : 0), y, 16, 1, y % 5 === 0 ? "#2F80E6" : "#7FC6FF");
      l.rect(5, 5, 16, 2, "#5AA8E6");
    }, "#0A1E3A");
    let x = 7 + sw;
    for (const ch of "42") { const gph = FONT[ch]; for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (gph[j * 3 + i] === "#") g.rect(x + i * 2, 13 + j * 2 - 3, 2, 2, "#FFFFFF"); x += 7; }
  }),
  it("potatoplanter", "Potato Planter & Grow-Lights", "furniture", ["stand"], "greenhouse", 400, 38, 34, "The Martian", (g, f) => {
    g.shadow(19, 17, 33);
    g.stamp((l) => { l.rect(3, 1, 32, 3, "#3A3F4B").rect(3, 1, 2, 12, "#3A3F4B").rect(33, 1, 2, 12, "#3A3F4B"); for (let x = 7; x < 32; x += 4) l.rect(x, 4, 2, 1, "#E07AFF"); }, "#0B0B10");
    for (let y = 5; y < 20; y++) for (let x = 6; x < 33; x++) if ((x + y + (f >> 3)) % 4 === 0) g.px(x, y, "#C850FF22");
    g.stamp((l) => {
      for (let i = 0; i < 4; i++) {
        const x = 8 + i * 7, sw = Math.round(wave(f, 60, 0.6, i));
        l.line(x, 24, x + sw, 16, "#2E8B3C");
        l.ell(x - 2 + sw, 17, 2.4, 1.4, "#4FBF5A").ell(x + 2 + sw, 15, 2.4, 1.4, "#3FA35E");
      }
      l.rect(2, 23, 34, 9, "#C8683C").rect(2, 23, 34, 2, "#6B3A1E");
      l.ell(10, 24, 2, 1.4, "#C8A078").ell(24, 24, 2.2, 1.4, "#C8A078");
    }, "#2A120A");
    g.text("SOL", 12, 26, "#FFF6DF", false);
  }, { glow: [[19, 6, 26, "#C850FF"]] }),
  it("rounddoor", "Round Green Door", "wall", ["wall"], "any", 700, 34, 34, "The Hobbit", (g, f) => {
    g.stamp((l) => {
      l.ell(17, 17, 16, 16, (nx, ny) => (nx * nx + ny * ny > 0.78 ? "#8A5A34" : "#2E8B3C"));
      for (let i = -3; i <= 3; i++) l.line(17 + i * 4, 4, 17 + i * 4, 30, "#237032");
      l.ell(17, 17, 12.5, 12.5, (nx, ny) => (nx * nx + ny * ny > 0.9 ? "#237032" : null));
      l.ell(17, 17, 2.2, 2.2, (nx, ny) => (nx + ny < -0.5 ? "#FFF3A6" : "#D9A441"));
    }, "#1E120A");
    if (f % 72 < 4) g.px(16, 16, "#FFFFFF");
  }),
  it("teaset", "Topsy-Turvy Tea Set", "furniture", ["top"], "kitchen", 250, 22, 16, "Alice's Adventures in Wonderland", (g, f) => {
    // A tall hat with a price-tag card, a teapot and a cup with a spoon that stirs itself.
    g.stamp((l) => { l.rect(2, 7, 7, 1, "#1B1B22").rect(3, 1, 5, 6, "#2A2A33").rect(3, 5, 5, 1, "#B0203A"); l.rect(6, 2, 3, 2, "#FFF6DF"); }, "#F4F1E8");
    g.stamp((l) => { l.ell(14, 11, 4, 3.4, (nx, ny) => (nx + ny < -0.5 ? "#FFFFFF" : "#8FC4E0")).rect(13, 7, 2, 1, "#8FC4E0"); l.line(18, 10, 20, 8, "#8FC4E0"); l.ring(10, 11, 1.6, "#8FC4E0", (t) => t < 0.25 || t > 0.75); }, "#1E3A4A");
    g.stamp((l) => { l.rect(3, 11, 5, 3, "#FFFFFF").rect(3, 11, 5, 1, "#FF8FB0").rect(2, 14, 7, 1, "#E6E0D2"); }, "#5A4A36");
    const s = Math.round(wave(f, 12, 1));
    g.line(5 + s, 11, 6 + s, 8, "#C9D1DB");
    if (f % 24 < 12) g.px(15, 5 - ((f >> 2) % 3), "#FFFFFFcc");
  })
];
