/* Pip's house: the room drawn on the Pip tab, and the items bought for it.
 Each item is its own small pixel sprite, drawn at its own size:
   { id, name, kind: "furniture" | "wall" | "floor" | "window" | "light", price, w, h, draw(g, f) }
 `drawRoom(g, f, style)` paints the empty room (walls, floor) at ROOM_W x ROOM_H.

 The engine's G is fixed at 32x32, so the room has its own painter (Painter)
 with the same drawing API (px, rect, line, ell, ring, stamp, text, shadow)
 over a canvas of any size. Every draw is a pure function of the frame number
 (12 fps), like Pip's moves.

 For the UI:
   renderRoomItem(item | id, f)            -> ImageData(item.w, item.h)
   renderRoom(style, f, placed?)           -> ImageData(ROOM_W, ROOM_H)
       placed: [{ id, x, y }] top-left in room pixels; wall/window items are
       drawn first, then floor items, then the rest by their bottom edge.
   Each item has `at: [x, y]`, a suggested spot that fits the room.
   ROOM_STYLES lists the wall/floor styles; FLOOR_Y is where the floor starts.
   skyFrame(hour) gives the frame at which the window shows that hour's sky
   (the window runs a full day every DAY frames). */
import { rgba, FONT } from "./engine.js";

export const ROOM_W = 160;
export const ROOM_H = 96;
export const FLOOR_Y = 66;
/** Frames in one window day (a minute at 12 fps). */
export const DAY = 720;
export const skyFrame = (hour) => Math.round((((hour % 24) + 24) % 24) / 24 * DAY);

const TAU = Math.PI * 2;
export const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const OUT = "#2A1E16";

// ------------------------------------------------------------ painter
class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Array(w * h).fill(null); }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    // Translucent paint (glows, shadows) blends over what's already there.
    this.d[i] = c.length === 9 && this.d[i] ? blend(this.d[i], c) : c;
  }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.d[y * this.w + x]; }
  /** Composite src on top; translucent pixels blend over what's below. */
  blit(src, ox = 0, oy = 0) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.d[y * src.w + x];
      if (!c) continue;
      this.set(x + ox, y + oy, c);
    }
  }
}

export function blend(under, over) {
  const a = rgba(under), b = rgba(over), t = b[3] / 255;
  const out = [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t));
  const al = Math.round(255 - (255 - a[3]) * (1 - t));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("") + (al < 255 ? al.toString(16).padStart(2, "0") : "");
}

/** Same API as the engine's G, for a canvas of any size. */
export class Painter {
  constructor(w, h, f, canvas) { this.C = canvas || new Canvas(w, h); this.w = this.C.w; this.h = this.C.h; this.f = f || 0; }
  px(x, y, c) { this.C.set(x, y, c); return this; }
  get(x, y) { return this.C.get(Math.round(x), Math.round(y)); }
  rect(x, y, w, h, c) {
    x = Math.round(x); y = Math.round(y);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.C.set(x + i, y + j, c);
    return this;
  }
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (let i = 0; i < 400; i++) {
      this.C.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
    return this;
  }
  ell(cx, cy, rx, ry, c) {
    const x0 = Math.floor(cx - rx - 1), x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1), y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) {
        const col = typeof c === "function" ? c(nx, ny, x, y) : c;
        if (col) this.C.set(x, y, col);
      }
    }
    return this;
  }
  ring(cx, cy, r, c, skip) {
    const steps = Math.max(12, Math.round(r * 8));
    for (let i = 0; i < steps; i++) {
      if (skip && skip(i / steps)) continue;
      const a = (i / steps) * TAU;
      this.C.set(Math.floor(cx + Math.cos(a) * r), Math.floor(cy + Math.sin(a) * r), c);
    }
    return this;
  }
  /** Draw with fn on a scratch layer, outline it, then composite. */
  stamp(fn, col) {
    const t = new Canvas(this.w, this.h);
    fn(new Painter(0, 0, this.f, t));
    const o = col || OUT;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (t.get(x, y)) continue;
      if (t.get(x - 1, y) || t.get(x + 1, y) || t.get(x, y - 1) || t.get(x, y + 1)) this.C.set(x, y, o);
    }
    this.C.blit(t);
    return this;
  }
  text(str, x, y, c, outline) {
    const draw = (l) => {
      let cx = Math.round(x);
      for (const ch of String(str).toUpperCase()) {
        const gph = FONT[ch] || FONT[" "];
        for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (gph[j * 3 + i] === "#") l.px(cx + i, Math.round(y) + j, c);
        cx += 4;
      }
    };
    if (outline === false) draw(this); else this.stamp(draw, outline || "#1A1A22");
    return this;
  }
  shadow(x, w, y) {
    for (let i = -Math.round(w); i < Math.round(w); i++) this.C.set(x + i, y, Math.abs(i + 0.5) > w - 1.5 ? "#00000022" : "#00000040");
    return this;
  }
  toImageData() {
    const img = new ImageData(this.w, this.h);
    for (let i = 0; i < this.w * this.h; i++) {
      const c = this.C.d[i];
      if (!c) continue;
      const [r, g, b, a] = rgba(c);
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
    }
    return img;
  }
}

// ------------------------------------------------------------ the room
export const ROOM_STYLES = [
  { id: "cozy", name: "Cozy Cottage" },
  { id: "night", name: "Midnight Blue" },
  { id: "library", name: "Old Library" },
  { id: "pastel", name: "Sweet Pastel" }
];

const STYLE = {
  cozy: { wall: "#F2E4C6", wall2: "#E9D6B0", trim: "#8A5A34", trimHi: "#B07A4A", trimDk: "#5E3A1F", floor: "#B77B48", floor2: "#A56A3B", seam: "#7A4A26", hi: "#CC9460" },
  night: { wall: "#2B3566", wall2: "#252E5A", trim: "#1B2142", trimHi: "#3A4478", trimDk: "#10142C", floor: "#46407A", floor2: "#3D386E", seam: "#2A2552", hi: "#5A539A" },
  library: { wall: "#2F5A45", wall2: "#294F3C", trim: "#6B4226", trimHi: "#8E5C36", trimDk: "#442814", floor: "#6A4428", floor2: "#5C3A22", seam: "#3E2614", hi: "#80563A", panel: "#7A4C2C" },
  pastel: { wall: "#FBE3EC", wall2: "#F6D3E1", trim: "#FFFFFF", trimHi: "#FFFFFF", trimDk: "#D9B3C6", floor: "#BFE8D8", floor2: "#AEDDCB", seam: "#8CC7B2", hi: "#D6F4E9" }
};

/** Paint the empty room (wall, skirting, floor) into a ROOM_W x ROOM_H painter. */
export function drawRoom(g, f, style) {
  const S = STYLE[style] || STYLE.cozy, W = g.w || ROOM_W, H = g.h || ROOM_H, fy = FLOOR_Y;
  // Wall.
  for (let y = 0; y < fy - 3; y++) for (let x = 0; x < W; x++) {
    let c = S.wall;
    if (style === "night") {
      if (rnd(x * 31 + y * 7) > 0.994) c = (Math.floor(f / 8) + x) % 5 ? "#8C95F0" : "#FFFFFF";
    } else if (style === "library") {
      if (y >= 40) c = y === 40 || y === 41 ? S.trimHi : (x % 26 === 0 || x % 26 === 25 || y === 44 || y === fy - 6) ? S.trimDk : S.panel;
      else if (x % 12 === 6 && y % 12 < 8) c = S.wall2;
    } else if (style === "pastel") {
      if ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 && x % 4 === 1 && y % 4 === 1) c = "#FFFFFF";
      else if ((x + 8) % 16 === 0 && y % 16 === 8) c = "#F6B8CE";
    } else {
      if (x % 10 < 2) c = S.wall2;
      if (x % 10 === 5 && y % 10 === 5) c = "#E0C69A";
    }
    g.px(x, y, c);
  }
  // A soft shade under the ceiling.
  for (let x = 0; x < W; x++) g.px(x, 0, "#00000022").px(x, 1, "#00000014");
  // Skirting board.
  g.rect(0, fy - 3, W, 1, S.trimHi).rect(0, fy - 2, W, 2, S.trim).rect(0, fy, W, 1, S.trimDk);
  // Floor: planks with staggered seams and a little sheen.
  for (let y = fy + 1; y < H; y++) {
    const row = Math.floor((y - fy - 1) / 5);
    for (let x = 0; x < W; x++) {
      let c = row % 2 ? S.floor2 : S.floor;
      if ((y - fy - 1) % 5 === 4) c = S.seam;
      else if ((x + row * 23) % 37 === 0) c = S.seam;
      else if ((y - fy - 1) % 5 === 0 && (x + row * 11) % 29 < 6) c = S.hi;
      g.px(x, y, c);
    }
  }
  // Shadow where wall meets floor.
  for (let x = 0; x < W; x++) g.px(x, fy + 1, "#00000030");
}

// ------------------------------------------------------------ items
const wood = (nx, ny) => (nx + ny < -0.6 ? "#B07A4A" : nx + ny > 0.8 ? "#5E3A1F" : "#8A5A34");

export function flame(g, cx, by, hgt, wid, f, seed) {
  for (let y = 0; y < hgt; y++) {
    const t = y / hgt;
    const wob = Math.sin(f * 0.9 + seed + y * 0.8) * 1.1 * t;
    const half = wid * Math.sin(Math.PI * Math.min(1, (t + 0.15) / 1.05)) * (1 - t * 0.6);
    for (let x = -Math.ceil(wid); x <= Math.ceil(wid); x++) {
      const d = Math.abs(x - wob);
      if (d > half) continue;
      const core = d < half * 0.45;
      g.px(cx + x, by - y, t > 0.75 ? "#FFE36B" : core ? (t < 0.4 ? "#FFF3B0" : "#FFC53D") : t < 0.35 ? "#F0492F" : "#FF8A2A");
    }
  }
}

/**
 * The hour (0-24, fractional) the sky shows while `draw` runs, when the caller
 * knows the real time: the house scene draws a 4-second loop of frames for its
 * lamps and fish, and the sky must stay at the real time throughout, not run
 * 48 frames (1.6 hours) of day and snap back every loop. Without it the hour
 * comes from the frame, as for shop previews (a window runs a day every DAY frames).
 */
let skyHour = null;
export const withSkyHour = (hour, draw) => {
  const previous = skyHour;
  skyHour = hour;
  try {
    return draw();
  } finally {
    skyHour = previous;
  }
};

export function skyAt(f) {
  const hr = skyHour ?? ((f % DAY) + DAY) % DAY / DAY * 24;
  if (hr < 5 || hr >= 20) return { hr, top: "#141A3A", bot: "#2B3566", night: 1 };
  if (hr < 7) return { hr, top: "#5A6BC4", bot: "#FFB38A", night: 0.4 };
  if (hr < 17) return { hr, top: "#5AB8FF", bot: "#BFE6FF", night: 0 };
  return { hr, top: "#6A4FA8", bot: "#FF9A5A", night: 0.3 };
}

const ITEMS = [
  // ---------------------------------------------------------- starters
  {
    id: "bed", name: "Snug Bed", kind: "furniture", price: 0, w: 42, h: 24, at: [2, 68], mount: "stand", starter: true,
    draw(g) {
      g.shadow(21, 19, 23);
      g.stamp((l) => {
        l.rect(1, 2, 5, 20, "#8A5A34").rect(1, 2, 5, 1, "#B07A4A").rect(2, 1, 3, 1, "#8A5A34").rect(1, 3, 1, 18, "#B07A4A");
        l.rect(36, 10, 5, 12, "#8A5A34").rect(36, 10, 5, 1, "#B07A4A").rect(37, 9, 3, 1, "#8A5A34");
        l.rect(6, 16, 30, 4, "#8A5A34").rect(6, 16, 30, 1, "#B07A4A").rect(6, 19, 30, 1, "#5E3A1F");
        l.rect(2, 21, 3, 1, "#5E3A1F").rect(37, 21, 3, 1, "#5E3A1F");
      });
      g.stamp((l) => {
        l.rect(6, 12, 30, 4, "#EEE9DD").rect(6, 15, 30, 1, "#CFC8B8");
        l.ell(11, 11, 4.5, 2.6, (nx, ny) => (ny > 0.4 ? "#D9D2C2" : "#FFFFFF"));
      });
      g.stamp((l) => {
        for (let y = 10; y < 17; y++) for (let x = 15; x < 37; x++) {
          const chk = (Math.floor((x - 15) / 4) + Math.floor((y - 10) / 3)) % 2;
          l.px(x, y, y === 10 ? "#8FAAF0" : chk ? "#5B7FD6" : "#6F8FE0");
        }
        l.rect(15, 10, 1, 7, "#3D5BAA").rect(15, 17, 22, 1, "#3D5BAA");
      }, "#1B2A5A");
    }
  },
  {
    id: "rug", name: "Round Rug", kind: "floor", price: 0, w: 52, h: 14, at: [54, 78], mount: "floor", starter: true,
    draw(g) {
      g.stamp((l) => {
        l.ell(26, 7, 23, 5.8, (nx, ny) => {
          const d = nx * nx + ny * ny;
          if (d > 0.78) return "#C8453B";
          if (d > 0.62) return "#F2E3C2";
          if (d > 0.4) return "#E07A3A";
          if (d > 0.18) return "#F2E3C2";
          return "#C8453B";
        });
      }, "#5A1A12");
      for (const x of [1, 50]) for (let y = 5; y < 10; y += 2) g.px(x, y, "#F2E3C2");
    }
  },

  // ---------------------------------------------------------- floor & furniture
  {
    id: "plant", name: "Potted Monstera", kind: "furniture", price: 80, w: 16, h: 26, at: [144, 62], mount: "stand",
    draw(g, f) {
      g.shadow(8, 5, 25);
      const sway = (i) => Math.round(Math.sin(f * 0.08 + i) * 0.8);
      g.stamp((l) => {
        for (const [x, y, rx, ry, i] of [[4, 8, 3.4, 2.6, 0], [11, 6, 3.6, 2.8, 1], [8, 3, 3, 2.6, 2], [3, 13, 3, 2.2, 3], [12, 12, 3, 2.3, 4]]) {
          l.line(8, 18, x + sway(i), y + 1, "#2E6B33");
          l.ell(x + sway(i), y, rx, ry, (nx, ny) => (Math.abs(nx) < 0.12 ? "#2E6B33" : ny < -0.3 && nx < 0 ? "#7FCB6A" : "#3FA35E"));
        }
      }, "#123A1E");
      g.stamp((l) => {
        l.rect(3, 17, 10, 2, "#D9774A");
        for (let y = 19; y < 24; y++) l.rect(4 + (y > 21 ? 1 : 0), y, 8 - (y > 21 ? 2 : 0), 1, y === 19 ? "#B0562A" : "#C8683C");
        l.px(4, 17, "#F29A6A");
      }, "#4A1E0A");
    }
  },
  {
    id: "lamp", name: "Floor Lamp", kind: "light", price: 120, w: 16, h: 36, at: [128, 50], mount: "stand",
    // The light it casts after dark (house.js pools it; switched off, it casts none).
    glow: [[8, 8, 30, "#FFE08A"]],
    draw(g, f) {
      const flick = f % 48 === 0 ? 0 : 1;
      if (flick) for (let y = 11; y < 20; y++) for (let x = 8 - (y - 10); x <= 8 + (y - 10) - 1; x++) if ((x + y) % 2 === 0) g.px(x, y, "#FFE9A022");
      g.shadow(8, 5, 35);
      g.stamp((l) => {
        l.rect(7, 10, 2, 22, "#3A3F4B").rect(7, 10, 1, 22, "#5A606E");
        l.ell(8, 33, 4.5, 1.5, "#3A3F4B");
      }, "#14161C");
      g.stamp((l) => {
        for (let j = 0; j < 9; j++) {
          const w = 6 + Math.round(j * 0.9);
          l.rect(8 - w / 2, 2 + j, w, 1, j === 8 ? "#E0A83A" : flick ? (j < 3 ? "#FFF3C2" : "#FFE08A") : "#E8D8A8");
        }
        l.px(5, 3, "#FFFFFF");
      }, "#5A3A10");
    }
  },
  {
    id: "bookshelf", name: "Bookshelf", kind: "furniture", price: 300, w: 32, h: 46, at: [124, 24], mount: "stand",
    draw(g) {
      g.shadow(16, 15, 45);
      g.stamp((l) => {
        l.rect(1, 1, 30, 43, "#6B4226").rect(1, 1, 30, 1, "#8E5C36").rect(1, 1, 1, 43, "#8E5C36");
        l.rect(3, 3, 26, 39, "#3E2614");
        for (const y of [12, 22, 32, 42]) l.rect(2, y, 28, 2, "#8A5A34").rect(2, y + 1, 28, 1, "#5E3A1F");
      }, "#1E120A");
      const cols = ["#C8453B", "#2F80E6", "#FFB400", "#1FA36A", "#8E5CFF", "#E07A3A", "#F2E3C2", "#35A6A0", "#B0203A", "#5B7FD6"];
      let k = 0;
      for (const base of [12, 22, 32, 42]) {
        let x = 3;
        while (x < 28) {
          const w = 2 + Math.floor(rnd(k * 3 + 1) * 2), hh = 6 + Math.floor(rnd(k * 5 + 2) * 3);
          if (x + w > 29) break;
          if (rnd(k * 7 + 3) > 0.9 && x < 25) {
            // A book leaning over.
            const c = cols[k % cols.length];
            for (let j = 0; j < 7; j++) g.px(x + Math.floor(j * 0.5), base - 1 - j, c).px(x + 1 + Math.floor(j * 0.5), base - 1 - j, c);
            x += 5; k++; continue;
          }
          const c = cols[(k * 7) % cols.length];
          g.rect(x, base - hh, w, hh, c).px(x, base - hh, "#FFFFFF55").rect(x, base - hh + 2, w, 1, "#00000033");
          x += w; k++;
        }
      }
      // A little cactus and a globe-ish bookend.
      g.stamp((l) => l.rect(24, 5, 3, 3, "#3FA35E").px(25, 4, "#3FA35E").rect(23, 8, 5, 3, "#C8683C"), "#1E120A");
    }
  },
  {
    id: "beanbag", name: "Beanbag", kind: "furniture", price: 150, w: 26, h: 18, at: [62, 68], mount: "stand",
    draw(g) {
      g.shadow(13, 11, 17);
      g.stamp((l) => {
        l.ell(13, 11, 11.5, 6, (nx, ny) => (nx + ny < -0.7 ? "#FF9ACB" : nx + ny > 0.7 ? "#B8336A" : "#E8559A"));
        l.ell(10, 6, 7, 4.5, (nx, ny) => (nx + ny < -0.6 ? "#FFB3D6" : nx + ny > 0.8 ? "#C8437A" : "#F06AA8"));
        l.line(6, 9, 11, 11, "#C8437A").px(7, 5, "#FFFFFF");
      }, "#4A0A24");
    }
  },
  {
    id: "armchair", name: "Velvet Armchair", kind: "furniture", price: 350, w: 32, h: 28, at: [94, 58], mount: "stand",
    draw(g) {
      g.shadow(16, 14, 27);
      g.stamp((l) => {
        l.rect(4, 22, 2, 4, "#5E3A1F").rect(26, 22, 2, 4, "#5E3A1F");
        l.ell(16, 8, 11, 7.5, (nx, ny) => (ny > 0.7 ? null : nx + ny < -0.7 ? "#5FD0C0" : "#2FA89A"));
        l.rect(5, 8, 22, 9, "#2FA89A");
        for (const x of [9, 16, 23]) l.px(x, 8, "#1F7F71");
      }, "#0C2A26");
      g.stamp((l) => {
        l.rect(6, 15, 20, 4, "#3FC1B0").rect(6, 15, 20, 1, "#7FE0D2");
        l.rect(3, 19, 26, 4, "#2FA89A").rect(3, 22, 26, 1, "#1F7F71");
      }, "#0C2A26");
      g.stamp((l) => {
        for (const x of [1, 25]) {
          l.rect(x, 11, 6, 11, "#2FA89A").ell(x + 3, 11, 3, 2, "#5FD0C0").rect(x + (x < 10 ? 0 : 5), 12, 1, 10, "#1F7F71");
        }
      }, "#0C2A26");
    }
  },
  {
    id: "desk", name: "Writing Desk", kind: "furniture", price: 400, w: 36, h: 28, at: [36, 42], mount: "stand",
    draw(g, f) {
      g.shadow(18, 16, 27);
      g.stamp((l) => {
        l.rect(1, 12, 34, 3, "#8A5A34").rect(1, 12, 34, 1, "#B07A4A");
        l.rect(3, 15, 3, 11, "#6B4226").rect(30, 15, 3, 11, "#6B4226");
        l.rect(20, 15, 10, 6, "#7A4C2C").rect(24, 17, 2, 1, "#FFD23F");
      }, "#2A160A");
      // Desk lamp.
      g.stamp((l) => {
        l.rect(4, 10, 6, 2, "#2F80E6").line(6, 10, 8, 5, "#2F80E6").line(8, 5, 12, 3, "#2F80E6");
        l.rect(11, 2, 5, 3, "#1F5FB8").px(12, 5, "#FFE08A").px(13, 5, "#FFE08A").px(14, 5, "#FFE08A");
      }, "#0A1E3A");
      for (let y = 6; y < 12; y++) for (let x = 11 - (y - 6) / 2; x < 16 + (y - 6) / 2; x++) if ((x + y) % 2) g.px(x, y, "#FFE9A033");
      // Open book and a mug.
      g.stamp((l) => {
        l.rect(14, 9, 5, 3, "#FFF6DF").rect(19, 9, 5, 3, "#F6E9C8").px(19, 9, "#DCC89C").rect(15, 10, 3, 1, "#B3A383").rect(20, 10, 3, 1, "#B3A383");
      }, "#5A3A10");
      g.stamp((l) => l.rect(28, 7, 4, 5, "#F4F1E8").rect(28, 8, 4, 1, "#C8453B").px(32, 9, "#F4F1E8").px(32, 10, "#F4F1E8"), "#3A2A1E");
      for (let k = 0; k < 2; k++) {
        const t = ((f + k * 6) % 12) / 12;
        if (t < 0.8) g.px(29 + k + Math.round(Math.sin((f + k * 5) * 0.8)), Math.round(5 - t * 5), "#FFFFFFaa");
      }
    }
  },
  {
    id: "globe", name: "Spinning Globe", kind: "furniture", price: 160, w: 16, h: 20, at: [133, 5], mount: "stand",
    draw(g, f) {
      const spin = f * 0.25;
      g.stamp((l) => {
        l.ell(8, 8, 5.6, 5.6, (nx, ny, x, y) => {
          const lon = (nx * 3 + spin) % 12, lat = ny * 3;
          const land = Math.sin(lon * 1.1) * Math.cos(lat * 1.3) + Math.sin(lon * 2.3 + lat) * 0.5 > 0.45;
          if (nx + ny < -0.9) return land ? "#9CE07A" : "#8FD0FF";
          return land ? (nx + ny > 0.6 ? "#2E8B3C" : "#4FBF5A") : nx + ny > 0.6 ? "#1F5FB8" : "#2F80E6";
        });
      }, "#0A1E3A");
      g.stamp((l) => {
        l.ring(8, 8, 7, "#D9A441", (t) => t > 0.08 && t < 0.42);
        l.rect(7, 15, 2, 2, "#8A5A34").ell(8, 18, 4.5, 1.3, "#6B4226");
      }, "#2A160A");
    }
  },
  {
    id: "aquarium", name: "Aquarium", kind: "furniture", price: 600, w: 30, h: 34, at: [2, 36], mount: "stand",
    draw(g, f) {
      // Cabinet.
      g.stamp((l) => {
        l.rect(2, 21, 26, 11, "#6B4226").rect(2, 21, 26, 1, "#8E5C36").rect(4, 23, 10, 7, "#5A3820").rect(16, 23, 10, 7, "#5A3820");
        l.px(13, 26, "#FFD23F").px(16, 26, "#FFD23F");
      }, "#1E120A");
      // Tank.
      g.stamp((l) => {
        for (let y = 3; y < 20; y++) for (let x = 2; x < 28; x++) {
          const t = (y - 3) / 17;
          l.px(x, y, y >= 17 ? ((x + y) % 3 ? "#E8C872" : "#D4AE58") : t < 0.3 ? "#8FE0FF" : t < 0.7 ? "#4FC0EA" : "#2F9AD0");
        }
        l.rect(2, 2, 26, 1, "#3A3F4B").rect(2, 20, 26, 1, "#3A3F4B");
      }, "#0C2436");
      for (let i = 0; i < 3; i++) {
        const bx = 5 + i * 9;
        for (let j = 0; j < 6; j++) g.px(bx + Math.round(Math.sin(f * 0.15 + j * 0.8 + i) * (j / 4)), 16 - j, j % 2 ? "#2E8B3C" : "#4FBF5A");
      }
      // Fish swim back and forth.
      const fish = (x, y, dir, c, c2) => {
        x = Math.round(x); y = Math.round(y);
        g.rect(x - 1, y, 4, 2, c).px(x + (dir > 0 ? 3 : -2), y, c).px(x + (dir > 0 ? -2 : 3), y - 1, c2).px(x + (dir > 0 ? -2 : 3), y + 2, c2).px(x + (dir > 0 ? -2 : 3), y, c2).px(x + (dir > 0 ? -2 : 3), y + 1, c2);
        g.px(x + (dir > 0 ? 2 : -1), y, "#10231A");
      };
      const a = (f % 120) / 120, d1 = a < 0.5 ? 1 : -1, x1 = a < 0.5 ? 6 + a * 2 * 17 : 23 - (a - 0.5) * 2 * 17;
      fish(x1, 7 + Math.sin(f * 0.1) * 1.2, d1, "#FF8A2A", "#FFFFFF");
      const b = ((f + 50) % 90) / 90, d2 = b < 0.5 ? -1 : 1, x2 = b < 0.5 ? 23 - b * 2 * 16 : 7 + (b - 0.5) * 2 * 16;
      fish(x2, 12 + Math.sin(f * 0.13) * 1, d2, "#FFD23F", "#2F80E6");
      for (let i = 0; i < 3; i++) {
        const t = ((f + i * 13) % 36) / 36;
        g.px(21 + (i % 2), Math.round(16 - t * 12), "#FFFFFFcc");
      }
      g.px(3, 4, "#FFFFFF").px(3, 5, "#FFFFFF").px(4, 4, "#FFFFFF");
    }
  },
  {
    id: "recordplayer", name: "Record Player", kind: "furniture", price: 450, w: 24, h: 30, at: [46, 58], mount: "stand",
    draw(g, f) {
      g.stamp((l) => {
        l.rect(1, 16, 22, 12, "#8A5A34").rect(1, 16, 22, 1, "#B07A4A").rect(3, 19, 18, 7, "#6B4226");
        for (let x = 4; x < 20; x += 2) l.rect(x, 20, 1, 5, "#5A3820");
        l.rect(2, 28, 2, 1, "#5E3A1F").rect(20, 28, 2, 1, "#5E3A1F");
      }, "#1E120A");
      g.stamp((l) => {
        l.rect(1, 12, 22, 4, "#E8D8B8").rect(1, 12, 22, 1, "#FFF6DF");
        l.ell(10, 12.5, 7, 2, (nx, ny, x) => ((x + Math.floor(f / 2)) % 4 === 0 ? "#3A3A48" : "#1B1B22"));
        l.px(10, 12, "#E0393E").px(9, 12, "#E0393E");
        l.line(20, 11, 17, 13, "#8C97A6").px(20, 10, "#C9D1DB");
      }, "#1E120A");
      const k = f % 48;
      for (let i = 0; i < 2; i++) {
        const t = ((k + i * 24) % 48) / 48;
        const x = Math.round(3 + i * 9 + Math.sin(t * TAU) * 2), y = Math.round(6 - t * 6);
        if (t < 0.9) g.stamp((l) => l.rect(x + 2, y, 1, 4, i ? "#8E5CFF" : "#FF4D6D").px(x + 3, y, i ? "#8E5CFF" : "#FF4D6D").rect(x, y + 3, 2, 2, i ? "#8E5CFF" : "#FF4D6D"), "#1A1A22");
      }
    }
  },
  {
    id: "catbed", name: "Cat & Cat Bed", kind: "furniture", price: 500, w: 24, h: 16, at: [100, 80], mount: "stand",
    draw(g, f) {
      const br = Math.sin(f * 0.13) > 0 ? 1 : 0;
      g.shadow(12, 10, 15);
      g.stamp((l) => {
        l.ell(12, 11, 10.5, 4, (nx, ny) => (ny < -0.2 ? "#7A4BD6" : nx + ny > 0.7 ? "#4B2E8A" : "#6A3FC0"));
        l.ell(12, 10, 8, 2.5, "#EAD9FF");
      }, "#1E1238");
      g.stamp((l) => {
        l.ell(13.5, 8.5 - br * 0.5, 6, 3 + br * 0.5, (nx, ny, x) => (x % 3 === 0 && ny < 0.4 ? "#E0782E" : "#FFA24A"));
        l.line(19, 10, 16, 11, "#E0782E").px(15, 11, "#E0782E");
      }, "#3A1E08");
      g.stamp((l) => {
        l.ell(6.5, 8.5, 3.2, 2.7, (nx, ny) => (nx + ny < -0.6 ? "#FFC27A" : "#FFA24A"));
        l.px(4, 5, "#FFA24A").px(4, 6, "#FFA24A").px(5, 6, "#FFA24A").px(8, 5, "#FFA24A").px(8, 6, "#FFA24A").px(7, 6, "#FFA24A");
        l.px(5, 8, "#3A1E08").px(8, 8, "#3A1E08").px(6, 9, "#FF8FA3").px(7, 9, "#FF8FA3");
      }, "#3A1E08");
      const t = (f % 48) / 48;
      if (t < 0.7) {
        const zx = Math.round(3 - t * 2), zy = Math.round(4 - t * 4);
        g.px(zx, zy, "#FFFFFF").px(zx + 1, zy, "#FFFFFF").px(zx, zy + 1, "#FFFFFF").px(zx, zy + 2, "#FFFFFF").px(zx + 1, zy + 2, "#FFFFFF");
      }
    }
  },
  {
    id: "readingnook", name: "Reading Nook Tent", kind: "furniture", price: 900, w: 42, h: 42, at: [80, 28], mount: "stand",
    draw(g, f) {
      g.shadow(21, 19, 41);
      // Poles crossing at the top.
      g.stamp((l) => { l.line(18, 0, 23, 5, "#8A5A34"); l.line(24, 0, 19, 5, "#8A5A34"); }, "#2A160A");
      g.stamp((l) => {
        for (let y = 4; y < 40; y++) {
          const t = (y - 4) / 35, half = 2 + t * 18;
          for (let x = Math.round(21 - half); x <= Math.round(21 + half); x++) {
            const stripe = Math.floor((x - 21) / (1 + t * 3.2) + 20) % 2;
            l.px(x, y, stripe ? "#F4ECD8" : "#E9D8B6");
          }
        }
        // The opening: a dark triangle with a cushion and a book inside.
        for (let y = 16; y < 40; y++) {
          const t = (y - 16) / 23, half = t * 8;
          for (let x = Math.round(21 - half); x <= Math.round(21 + half); x++) l.px(x, y, y > 34 ? "#6A3FC0" : "#3A2A1E");
        }
        l.line(21, 16, 11, 39, "#C9B58C").line(21, 16, 31, 39, "#C9B58C");
        l.rect(18, 32, 7, 3, "#FF6FA8").px(18, 32, "#FFB3D6");
        l.rect(20, 29, 4, 3, "#FFF6DF").rect(22, 29, 1, 3, "#DCC89C");
      }, "#4A3410");
      // Bunting across the front.
      const cols = ["#E0393E", "#FFD23F", "#2F80E6", "#1FBF6A", "#8E5CFF"];
      for (let x = 9; x < 36; x++) g.px(x, 11 + Math.round(Math.sin(((x - 9) / 27) * Math.PI) * 3), "#8A5A34");
      for (let i = 0; i < 7; i++) {
        const x = 9 + i * 4, y = 12 + Math.round(Math.sin((i / 6) * Math.PI) * 3) + (i % 2 && f % 24 < 12 ? 1 : 0);
        g.px(x, y, cols[i % 5]).px(x + 1, y, cols[i % 5]).px(x + 2, y, cols[i % 5]).px(x + 1, y + 1, cols[i % 5]);
      }
      // A string of warm lights inside.
      for (let i = 0; i < 4; i++) g.px(17 + i * 2, 21 + (i % 2), (f + i * 6) % 24 < 16 ? "#FFE36B" : "#B08A2A");
    }
  },
  {
    id: "fireplace", name: "Fireplace", kind: "furniture", price: 800, w: 44, h: 40, at: [78, 30], mount: "stand",
    draw(g, f) {
      g.stamp((l) => {
        for (let y = 5; y < 39; y++) for (let x = 2; x < 42; x++) {
          const row = Math.floor((y - 5) / 3), off = row % 2 ? 3 : 0;
          const mortar = (y - 5) % 3 === 2 || (x + off) % 6 === 0;
          l.px(x, y, mortar ? "#8C6A5A" : (x * 7 + row * 3) % 5 === 0 ? "#B8563A" : "#A84A32");
        }
        l.rect(0, 2, 44, 4, "#6B4226").rect(0, 2, 44, 1, "#8E5C36").rect(1, 6, 42, 1, "#442814");
      }, "#2A140A");
      g.stamp((l) => {
        l.ell(22, 24, 11, 10, (nx, ny) => (ny < -0.1 || true ? "#1B1210" : null));
        l.rect(11, 24, 22, 14, "#1B1210");
      }, "#4A2A1A");
      // Glow, logs and flames.
      for (let y = 30; y < 38; y++) for (let x = 12; x < 33; x++) g.px(x, y, y > 35 ? "#4A2010" : "#FF8A2A" + (y > 33 ? "30" : "18"));
      g.stamp((l) => {
        l.rect(14, 34, 16, 2, "#6B3A1E").rect(14, 34, 16, 1, "#8A5A34").px(14, 35, "#C8A078").px(29, 35, "#C8A078");
        l.rect(16, 32, 12, 2, "#5A3218").px(27, 32, "#C8A078");
      }, "#1E0E06");
      flame(g, 18, 32, 9 + Math.round(Math.sin(f * 0.4) * 1.5), 3, f, 0);
      flame(g, 26, 32, 8 + Math.round(Math.sin(f * 0.5 + 2) * 1.5), 3, f, 2.4);
      flame(g, 22, 32, 12 + Math.round(Math.sin(f * 0.35 + 1) * 2), 3.6, f, 1.1);
      for (let i = 0; i < 3; i++) {
        const t = ((f + i * 9) % 27) / 27;
        if (t < 0.8) g.px(Math.round(19 + i * 3 + Math.sin(f * 0.3 + i) * 1.5), Math.round(28 - t * 12), t < 0.4 ? "#FFE36B" : "#FF8A2A");
      }
      // Stockings? No: a candle and a little frame on the mantel.
      g.stamp((l) => l.rect(5, -2 + 2, 2, 2, "#F4F1E8").rect(34, 0, 6, 2, "#D9A441").rect(35, 0, 4, 1, "#7FE0FF"), "#2A140A");
      if (f % 12 < 8) g.px(5, 0, "#FFC53D"); else g.px(6, 0, "#FFE36B");
    }
  },
  {
    id: "bookstack", name: "Book Tower", kind: "floor", price: 60, w: 14, h: 18, at: [26, 76], mount: "stand",
    draw(g) {
      g.shadow(7, 6, 17);
      const books = [["#C8453B", 12, 0], ["#2F80E6", 10, 1], ["#FFB400", 11, 0], ["#1FA36A", 9, 2], ["#8E5CFF", 10, 1]];
      g.stamp((l) => {
        books.forEach(([c, w, dx], i) => {
          const y = 14 - i * 3;
          l.rect(1 + dx, y, w, 3, c).rect(1 + dx + w - 1, y + 1, 1, 1, "#FFF6DF").rect(1 + dx, y, w, 1, "#FFFFFF44");
        });
      }, "#1A1A22");
    }
  },

  // ---------------------------------------------------------- wall
  {
    id: "window", name: "Window", kind: "window", price: 200, w: 36, h: 30, at: [40, 4], mount: "wall",
    draw(g, f) {
      const sky = skyAt(f), hr = sky.hr;
      const lerpC = (a, b, t) => {
        const A = rgba(a), B = rgba(b);
        return "#" + [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, "0")).join("");
      };
      // Sky.
      for (let y = 3; y < 24; y++) for (let x = 6; x < 30; x++) g.px(x, y, lerpC(sky.top, sky.bot, (y - 3) / 21));
      if (sky.night > 0.5) {
        for (let i = 0; i < 9; i++) {
          const x = 7 + Math.floor(rnd(i * 3) * 22), y = 4 + Math.floor(rnd(i * 5 + 1) * 15);
          if ((f + i * 7) % 40 > 3) g.px(x, y, i % 3 ? "#C9D1FF" : "#FFFFFF");
        }
        g.stamp((l) => l.ell(23, 8, 2.6, 2.6, (nx, ny) => (nx > 0.35 ? null : "#FFF3C2")), "#141A3A");
      } else {
        const sy = hr < 12 ? 22 - (hr - 5) * 2.3 : 6 + (hr - 12) * 2.6;
        g.ell(8 + (hr - 5) * 1.3, Math.max(6, Math.min(21, sy)), 2.2, 2.2, (nx, ny) => (nx + ny < -0.3 ? "#FFF6C2" : sky.night ? "#FFB35A" : "#FFE36B"));
        if (!sky.night) for (const [cx, cy, sp] of [[0, 9, 1], [14, 15, 0.6]]) {
          const x = 6 + ((cx + f * 0.05 * sp) % 30) - 4;
          g.rect(Math.round(x), cy, 6, 2, "#FFFFFF").rect(Math.round(x) + 1, cy - 1, 3, 1, "#FFFFFF");
        }
      }
      // Frame and cross bars.
      g.stamp((l) => {
        l.rect(5, 2, 26, 1, "#F4F1E8").rect(5, 24, 26, 1, "#F4F1E8").rect(5, 2, 1, 23, "#F4F1E8").rect(30, 2, 1, 23, "#F4F1E8");
        l.rect(17, 3, 2, 21, "#F4F1E8").rect(6, 13, 24, 1, "#F4F1E8");
        l.rect(3, 25, 30, 2, "#E8DCC4").rect(3, 26, 30, 1, "#C9B894");
      }, "#5A4A36");
      // Curtains, tied back.
      g.stamp((l) => {
        for (const s of [0, 1]) {
          for (let y = 0; y < 28; y++) {
            const w = y < 14 ? 5 - Math.round((y / 14) * 2) : 3 + Math.round(((y - 14) / 14) * 2);
            const x0 = s ? 35 - w : 0;
            for (let x = x0; x < x0 + w; x++) l.px(x, y, (x + (s ? 1 : 0)) % 2 ? "#C8453B" : "#E0584E");
          }
          l.rect(s ? 31 : 1, 14, 4, 1, "#FFD23F");
        }
      }, "#4A0E14");
    }
  },
  {
    id: "poster", name: "Reading Poster", kind: "wall", price: 60, w: 18, h: 22, at: [4, 6], mount: "wall",
    draw(g) {
      g.stamp((l) => {
        l.rect(1, 1, 16, 20, "#FFF6DF").rect(2, 2, 14, 11, "#7FD6FF");
        l.ell(9, 10, 4, 3.4, (nx, ny) => (nx + ny < -0.6 ? "#A2E477" : "#6CC04A"));
        l.px(7, 9, "#10231A").px(10, 9, "#10231A").px(8, 11, "#10231A").px(9, 11, "#10231A");
        l.line(9, 6, 10, 4, "#285F36").ell(11.5, 3.6, 2, 1.2, "#2FA35E");
        l.rect(2, 12, 14, 1, "#1FA36A");
      }, "#2A2A33");
      g.text("READ", 2, 14, "#C8453B", false);
      g.px(1, 1, "#FFFFFFaa").px(16, 1, "#FFFFFFaa");
    }
  },
  {
    id: "fairylights", name: "Fairy Lights", kind: "light", price: 180, w: 64, h: 12, at: [44, 0], mount: "wall",
    draw(g, f) {
      const pts = [];
      for (let x = 1; x < 63; x++) {
        const t = ((x - 1) % 21) / 21;
        const y = 2 + Math.round(Math.sin(t * Math.PI) * 5);
        pts.push([x, y]);
        g.px(x, y, "#2E4A2E");
      }
      const cols = ["#FFE36B", "#FF6FA8", "#7FE0FF", "#9CE07A", "#FFB35A"];
      for (let i = 0; i < 12; i++) {
        const [x, y] = pts[2 + i * 5];
        const on = (Math.floor(f / 6) + i * 3) % 7 !== 0;
        const c = cols[i % cols.length];
        if (on) { g.px(x - 1, y + 1, c + "44").px(x + 1, y + 1, c + "44").px(x, y + 3, c + "44"); }
        g.stamp((l) => l.px(x, y + 1, on ? c : "#6B6558").px(x, y + 2, on ? c : "#6B6558"), "#2E2A22");
        if (on) g.px(x, y + 1, "#FFFFFF");
      }
    }
  },
  {
    id: "trophyshelf", name: "Trophy Shelf", kind: "wall", price: 700, w: 40, h: 20, at: [80, 8], mount: "wall",
    draw(g, f) {
      g.stamp((l) => {
        l.rect(1, 15, 38, 2, "#8A5A34").rect(1, 15, 38, 1, "#B07A4A");
        l.rect(4, 17, 2, 2, "#5E3A1F").rect(34, 17, 2, 2, "#5E3A1F");
      }, "#2A160A");
      g.stamp((l) => {
        l.rect(4, 5, 7, 5, "#FFD23F").rect(5, 10, 5, 1, "#FFD23F").rect(6, 11, 3, 2, "#E0A800").rect(5, 13, 5, 2, "#8A5A34");
        l.px(3, 6, "#FFD23F").px(3, 7, "#FFD23F").px(11, 6, "#FFD23F").px(11, 7, "#FFD23F").px(5, 6, "#FFFFFF");
      }, "#4A3100");
      g.stamp((l) => {
        l.px(19, 3, "#DDE3EC").rect(18, 4, 3, 1, "#DDE3EC").rect(16, 5, 7, 1, "#DDE3EC").rect(17, 6, 5, 2, "#C9D1DB").px(17, 8, "#C9D1DB").px(21, 8, "#C9D1DB");
        l.rect(18, 9, 3, 3, "#8C97A6").rect(16, 12, 7, 3, "#3A3F4B");
      }, "#1B2230");
      g.stamp((l) => {
        l.line(29, 4, 31, 8, "#2F80E6").line(34, 4, 32, 8, "#E0393E");
        l.ell(31.5, 11, 3, 3, (nx, ny) => (nx + ny < -0.4 ? "#FFE9B0" : "#D98C3A")).px(31, 11, "#A85A1A");
        l.rect(28, 14, 8, 1, "#6B4226");
      }, "#3A1E08");
      const k = f % 60;
      if (k < 10) g.px(5 + k * 3, 5 + (k % 3), "#FFFFFF");
    }
  },
  {
    id: "clock", name: "Cuckoo Clock", kind: "wall", price: 100, w: 16, h: 28, at: [23, 10], mount: "wall",
    draw(g, f) {
      const sw = Math.sin(f * 0.26) * 3;
      g.line(8, 16, 8 + sw, 24, "#D9A441");
      g.stamp((l) => l.ell(8 + sw, 25, 1.6, 1.6, "#FFD23F"), "#4A3100");
      g.stamp((l) => {
        l.rect(2, 4, 12, 12, "#8A5A34").rect(2, 4, 12, 1, "#B07A4A");
        for (let j = 0; j < 4; j++) l.rect(1 + j, 3 - j, 14 - j * 2, 1, "#6B4226");
        l.ell(8, 10, 4, 4, "#FFF6DF");
      }, "#2A160A");
      const m = (f % 720) / 720 * TAU, hh = (f % 8640) / 8640 * TAU;
      g.line(8, 10, 8 + Math.round(Math.sin(m) * 3), 10 - Math.round(Math.cos(m) * 3), "#1A1A22");
      g.line(8, 10, 8 + Math.round(Math.sin(hh) * 2), 10 - Math.round(Math.cos(hh) * 2), "#C8453B");
      g.px(8, 10, "#1A1A22");
    }
  }
];

// Where each item snaps in Pip's house (house.js): which slot types it fits,
// and which floor of the house it belongs to ("any" = anywhere).
const FITS = { window: ["window"], poster: ["wall"], fairylights: ["wall"], trophyshelf: ["wall"], clock: ["wall"], rug: ["rug"], globe: ["top", "stand"], bookstack: ["stand", "top"] };
const LEVEL = { aquarium: "any", fireplace: "bedroom", readingnook: "library", bookshelf: "library", desk: "library", globe: "library", catbed: "any", recordplayer: "arcade", plant: "greenhouse" };
for (const it of ITEMS) {
  it.fits = FITS[it.id] || ["stand"];
  it.level = LEVEL[it.id] || (it.starter ? "bedroom" : "any");
}

export const lerpC = (a, b, t) => {
  const A = rgba(a), B = rgba(b);
  return "#" + [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, "0")).join("");
};

/** Paint the sky for frame f inside (x0, y0, w, h), only where inside(x, y). */
export function paintSky(g, x0, y0, w, h, f, inside = () => true) {
  const sky = skyAt(f), hr = sky.hr;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inside(x, y)) g.px(x, y, lerpC(sky.top, sky.bot, (y - y0) / Math.max(1, h - 1)));
  if (sky.night > 0.5) {
    for (let i = 0; i < Math.max(4, (w * h) / 40); i++) {
      const x = x0 + Math.floor(rnd(i * 3 + w) * w), y = y0 + Math.floor(rnd(i * 5 + h) * h * 0.8);
      if (inside(x, y) && (f + i * 7) % 40 > 3) g.px(x, y, i % 3 ? "#C9D1FF" : "#FFFFFF");
    }
    const mx = x0 + w * 0.7, my = y0 + h * 0.3, r = Math.max(1.6, Math.min(w, h) / 9);
    g.ell(mx, my, r, r, (nx, ny, x, y) => (inside(x, y) && nx < 0.35 ? (nx + ny < -0.6 ? "#FFFFFF" : "#FFF3C2") : null));
  } else {
    const t = clamp01((hr - 5) / 15);
    const sx = x0 + w * (0.15 + t * 0.7), sy = y0 + h * (0.85 - Math.sin(t * Math.PI) * 0.65), r = Math.max(1.6, Math.min(w, h) / 9);
    g.ell(sx, sy, r, r, (nx, ny, x, y) => (inside(x, y) ? (nx + ny < -0.3 ? "#FFF6C2" : sky.night ? "#FFB35A" : "#FFE36B") : null));
    if (!sky.night) for (const [cx, cy, sp, cw] of [[0, 0.3, 1, 7], [0.55, 0.6, 0.6, 5]]) {
      const x = x0 + ((cx * w + f * 0.05 * sp) % (w + 10)) - 5, y = Math.round(y0 + cy * h);
      for (let i = 0; i < cw; i++) { if (inside(Math.round(x + i), y)) g.px(x + i, y, "#FFFFFF"); if (i > 1 && i < cw - 1 && inside(Math.round(x + i), y - 1)) g.px(x + i, y - 1, "#FFFFFF"); }
    }
  }
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const ROOM_ITEMS = ITEMS;
const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

/** One item as its own w x h sprite. */
export function renderRoomItem(item, f = 0) {
  const it = typeof item === "string" ? BY_ID.get(item) : item;
  const g = new Painter(it.w, it.h, f);
  it.draw(g, f);
  return g.toImageData();
}

const LAYER = { wall: 0, floor: 1, stand: 2 };

/** The whole room: walls and floor in `style`, with `placed` items on top. */
export function renderRoom(style = "cozy", f = 0, placed = []) {
  const g = new Painter(ROOM_W, ROOM_H, f);
  drawRoom(g, f, style);
  const list = placed
    .map((p) => ({ p, it: BY_ID.get(p.id) }))
    .filter((o) => o.it)
    .sort((a, b) => (LAYER[a.it.mount] - LAYER[b.it.mount]) || (a.it.mount === "wall" ? 0 : (a.p.y + a.it.h) - (b.p.y + b.it.h)));
  for (const { p, it } of list) {
    const s = new Painter(it.w, it.h, f);
    it.draw(s, f);
    g.C.blit(s.C, Math.round(p.x), Math.round(p.y));
  }
  return g.toImageData();
}

/** Every item at its suggested spot: a furnished show room. */
export const SHOWROOM = ITEMS.filter((i) => i.id !== "readingnook").map((i) => ({ id: i.id, x: i.at[0], y: i.at[1] }));
