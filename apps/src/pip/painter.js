/* The painter that Pip's rooms and pictures are drawn with: the engine's drawing API
 (px, rect, line, ell, ring, stamp, text, shadow) over a canvas of any size. Apart from
 the room (room.js), which re-exports it, so that what draws with it (a focus flower on
 the library page) does not bring the room and its items into the app's first download. */
import { rgba, FONT } from "./engine.js";

const TAU = Math.PI * 2;
const OUT = "#2A1E16";

// ------------------------------------------------------------ painter
class Canvas {
  /**
   * `w` x `h` pixels. (`ox`, `oy`): where the point (0, 0) is drawn, for a picture that runs on past the room's
   * own edges (a floor drawn wide, `renderLevel`'s `pad`): what is drawn at (-ox, -oy) lands in the top-left
   * pixel. `d` is indexed by the pixel (`y * w + x`, from the top-left), whatever the origin.
   */
  constructor(w, h, ox = 0, oy = 0) { this.w = w; this.h = h; this.ox = ox; this.oy = oy; this.d = new Array(w * h).fill(null); }
  set(x, y, c) {
    x = Math.round(x) + this.ox; y = Math.round(y) + this.oy;
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    // Translucent paint (glows, shadows) blends over what's already there.
    this.d[i] = c.length === 9 && this.d[i] ? blend(this.d[i], c) : c;
  }
  /** Leaves a pixel empty (see-through). */
  unset(x, y) { x = Math.round(x) + this.ox; y = Math.round(y) + this.oy; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = null; }
  get(x, y) { x += this.ox; y += this.oy; return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.d[y * this.w + x]; }
  /** Composite src on top (at `ox`, `oy` in this canvas's coordinates); translucent pixels blend over what's below. */
  blit(src, ox = 0, oy = 0) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.d[y * src.w + x];
      if (!c) continue;
      this.set(x - src.ox + ox, y - src.oy + oy, c);
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
  /**
   * `origin` (`[ox, oy]`): a picture larger than its room, the room's (0, 0) that many pixels in from the
   * top-left (see `Canvas`). `x0`..`x1` and `y0`..`y1` are then the picture's extent in the room's
   * coordinates (0..w and 0..h for an ordinary one), for what is to be drawn across all of it.
   */
  constructor(w, h, f, canvas, origin) {
    this.C = canvas || new Canvas(w, h, origin ? origin[0] : 0, origin ? origin[1] : 0);
    this.w = this.C.w; this.h = this.C.h; this.f = f || 0;
    this.x0 = -this.C.ox; this.x1 = this.C.w - this.C.ox; this.y0 = -this.C.oy; this.y1 = this.C.h - this.C.oy;
  }
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
    const t = new Canvas(this.w, this.h, this.C.ox, this.C.oy);
    fn(new Painter(0, 0, this.f, t));
    const o = col || OUT;
    for (let y = this.y0; y < this.y1; y++) for (let x = this.x0; x < this.x1; x++) {
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
