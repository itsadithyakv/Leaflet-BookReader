/* The bedroom's fixtures with a job: a wall calendar, a wall clock, a
 houseplant, a radio on a bedside table, a corkboard for what Pip brings home.
 Every Pip has each of them; none is in the shop, a slot or the saved layout
 (house.js lists them in FIXTURES, home.js says where each goes).

 The house's item format, with the room Painter (room.js): { id, name, kind,
 fits, level, price: 0, w, h, draw(g, f, data), glow?(f, data), hit? }.
   data  what the thing shows just now: plain values, worked out elsewhere
         (pip/roomTime.ts, pip/houseplant.ts, the ambience, the album). Each
         draws something sensible with none, for a picture of the floor made
         without the scene.
   hit   the part of the art that is the thing itself (to be chosen by, and
         to keep clear of other things), when the art has room round it:
         { x, y, w, h } in the art's own pixels. The whole art without it. */
import { drawFindMini } from "./expedition-art.js";

const TAU = Math.PI * 2;
const fixture = (id, name, kind, w, h, draw, extra) => Object.assign({ id, name, kind, fits: [kind === "wall" ? "wall" : "stand"], level: "bedroom", price: 0, w, h, draw }, extra || {});

/** The magnets' colours, for the corkboard's pins too. */
const PINS = ["#E0393E", "#2F80E6", "#FFD23F"];

export const ROOM_FIXTURES = [
  // `data`: { date, lead, length, met: [dates], kept: [dates] } (pip/roomTime.ts, `calendarArt`).
  // Today's date in figures, and under it the month, a square a day: green where the goal was met.
  fixture("calendar", "Wall Calendar", "wall", 11, 19, (g, f, data) => {
    const d = data || { date: 1, lead: 0, length: 30, met: [], kept: [] };
    g.stamp((l) => l.rect(1, 1, 9, 17, "#FFF6DF").rect(1, 1, 9, 3, "#E0393E").px(3, 2, "#FFD1D1").px(7, 2, "#FFD1D1"), "#3A2A1E");
    g.px(5, 0, "#8C97A6");
    const text = String(d.date), tw = text.length * 4 - 1;
    g.text(text, 1 + Math.floor((9 - tw) / 2), 5, "#3A2A1E", false);
    for (let day = 1; day <= Math.min(31, d.length); day++) {
      const i = d.lead + day - 1;
      const c = d.met.includes(day) ? "#1FA36A" : d.kept.includes(day) ? "#8FD3C8" : day === d.date ? "#E0393E" : day < d.date ? "#C9BC9C" : "#EADFC6";
      g.px(2 + (i % 7), 11 + Math.floor(i / 7), c);
    }
    void f;
  }),
  // `data`: { hour (0 to 12), minute, left } (pip/roomTime.ts, `clockArt`): the real time, and
  // the minutes a focus session has left as a wedge clockwise from twelve (none: no wedge).
  fixture("wallclock", "Wall Clock", "wall", 13, 13, (g, f, data) => {
    const d = data || { hour: 10.17, minute: 10, left: null };
    const part = d.left == null ? 0 : Math.min(1, d.left / 60);
    g.stamp((l) => l.ell(6.5, 6.5, 5.5, 5.5, (nx, ny) => {
      if (nx * nx + ny * ny > 0.7) return "#8A5A34";
      const turn = ((Math.atan2(nx, -ny) + TAU) % TAU) / TAU;
      return part > 0 && turn < part ? "#F6B3A8" : "#FFF6DF";
    }), "#2A160A");
    for (const [x, y] of [[6, 2], [10, 6], [6, 10], [2, 6]]) g.px(x, y, "#8C7A5A");
    const hand = (turn, length, c) => g.line(6, 6, 6 + Math.round(Math.sin(turn * TAU) * length), 6 - Math.round(Math.cos(turn * TAU) * length), c);
    hand(d.minute / 60, 4, "#1A1A22");
    hand(d.hour / 12, 2.4, "#C8453B");
    g.px(6, 6, "#1A1A22");
    void f;
  }),
  // `data`: { state: "thriving" | "fine" | "thirsty" | "drooping", leaves (2 to 6), flowers (0 to 3) }
  // (pip/houseplant.ts). It stands on the fridge. Thirsty, it pales; drooping, its leaves hang over the rim.
  fixture("plantpot", "Houseplant", "furniture", 10, 12, (g, f, data) => {
    const d = data || { state: "fine", leaves: 2, flowers: 0 };
    const droop = d.state === "drooping", dry = droop || d.state === "thirsty";
    const leaf = droop ? "#8A9A5A" : dry ? "#9CB86A" : "#3FA35E", light = droop ? "#A3AE74" : dry ? "#B9CC8A" : "#7FCB6A", stem = droop ? "#6E7A44" : "#2E6B33";
    const up = [[2, 4], [7, 3], [5, 1], [1, 6], [8, 6], [4, 2]];
    const down = [[1, 8], [8, 8], [2, 6], [1, 10], [8, 10], [7, 6]];
    const tips = [];
    g.stamp((l) => {
      for (let i = 0; i < Math.max(0, Math.min(6, d.leaves)); i++) {
        const [x, y0] = droop ? down[i] : up[i];
        const y = y0 + (dry && !droop ? 1 : 0);
        // Thriving, it stirs a little.
        const tx = x + (d.state === "thriving" ? Math.round(Math.sin(f * 0.13 + i * 2) * 0.6) : 0);
        l.line(tx, y + 1, x < 5 ? 4 : 5, 7, stem);
        l.rect(tx - (x < 5 ? 1 : 0), y, 2, 2, leaf).px(tx, y, light);
        tips.push([tx, y]);
      }
    }, "#123A1E");
    g.stamp((l) => l.rect(2, 8, 6, 1, "#D9774A").rect(3, 9, 4, 3, "#C8683C").px(3, 9, "#F29A6A"), "#4A1E0A");
    // Its flowers, on the first leaves to have come out; shut while it droops.
    for (const i of [2, 0, 1].slice(0, Math.max(0, Math.min(3, d.flowers)))) {
      if (!tips[i]) continue;
      const [x, y] = tips[i];
      if (droop) g.px(x, y, "#C8437A");
      else g.px(x, y - 1, "#FF8FC0").px(x - 1, y, "#FF8FC0").px(x + 1, y, "#FF8FC0").px(x, y, "#FFD23F");
    }
  }),
  // `data`: { on, playing }: its dial lit when it is on, and notes drifting up from it while it sounds.
  // A set on a bedside table; the room above it is for the notes.
  fixture("radio", "Radio", "furniture", 12, 28, (g, f, data) => {
    const d = data || { on: false, playing: false };
    g.shadow(6, 6, 27);
    g.stamp((l) => {
      l.rect(0, 20, 12, 2, "#8A5A34").rect(0, 20, 12, 1, "#B07A4A");
      l.rect(1, 22, 2, 6, "#6B4226").rect(9, 22, 2, 6, "#6B4226").rect(3, 22, 6, 3, "#7A4C2C").px(6, 23, "#FFD23F");
    }, "#2A160A");
    g.stamp((l) => {
      l.rect(1, 13, 10, 7, "#D9774A").rect(1, 13, 10, 1, "#F29A6A").rect(1, 19, 10, 1, "#B0562A");
      l.rect(2, 15, 5, 4, "#5E3A1F");
      for (const [x, y] of [[2, 15], [4, 15], [6, 15], [3, 16], [5, 16], [2, 17], [4, 17], [6, 17], [3, 18], [5, 18]]) l.px(x, y, "#C9A06A");
      l.rect(8, 15, 2, 2, d.on ? "#FFE36B" : "#6E6248").px(8, 18, "#F4F1E8").px(9, 18, "#3A3F4B");
      l.line(9, 12, 11, 8, "#8C97A6");
    }, "#3A1E08");
    if (d.on) g.px(8, 15, "#FFFFFF");
    if (!d.playing) return;
    for (let k = 0; k < 2; k++) {
      const t = ((f + k * 24) % 48) / 48;
      if (t >= 0.9) continue;
      const x = Math.round(2 + k * 4 + Math.sin(t * TAU) * 1.5), y = Math.round(8 - t * 8), c = k ? "#8E5CFF" : "#FF4D6D";
      g.rect(x + 1, y, 1, 3, c).px(x + 2, y, c).px(x, y + 2, c);
    }
  }, { hit: { x: 0, y: 12, w: 12, h: 16 }, glow: (f, data) => (data && data.on ? [[9, 16, 9, "#FFE36B"]] : []) }),
  // `data`: { finds: [ids] }: the newest things Pip has brought home, the newest first, each pinned up
  // at half size (pip/expedition-art.js draws them); a bare pin where there is nothing yet.
  fixture("corkboard", "Album Board", "wall", 24, 12, (g, f, data) => {
    const finds = (data && data.finds) || [];
    g.stamp((l) => {
      l.rect(1, 1, 22, 10, "#8A5A34").rect(1, 1, 22, 1, "#B07A4A").rect(2, 2, 20, 8, "#C9A06A");
      for (let i = 0; i < 9; i++) l.px(3 + ((i * 7) % 19), 2 + ((i * 5) % 8), "#B88E58");
    }, "#2A160A");
    for (let i = 0; i < 3; i++) {
      const x = 2 + i * 7;
      if (finds[i]) drawFindMini(g, x, 3, finds[i], f);
      g.px(x + 3, 2, finds[i] ? PINS[i] : "#8C7A5A");
    }
  })
];
