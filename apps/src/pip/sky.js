/* The sky over Pip's garden: the real time of day, clouds drifting at three
 depths, the sun or the moon and stars, birds, and now and then something
 worth looking up for: a dragon crossing, a shooting star, a hot-air balloon.

 Everything is a pure function of the clock: `renderSky(w, h, timeMs)` is the
 same picture for the same moment, so there is no state to keep and nothing
 to save. What flies when is decided by the time alone (`skyEvents`): every
 Leaflet shows the same dragon at the same minute, and a reader sees it only
 if they are in the garden then. Rare on purpose: a treat, not wallpaper.

 Drawn like the rest of the house: the sprites with the room's Painter (the
 same outline, the same palette), once each and kept; the backdrop straight
 into the picture's bytes, so a frame costs a fraction of a millisecond.

 The colours are the windows' own (room.js, skyAt), blended through the hour
 instead of stepping from one to the next. */
import { Painter, rnd } from "./room.js";
import { rgba } from "./engine.js";

/** How much of the garden floor the sky fills, from the top (the glass wall). */
export const SKY_H = 62;

const OUT = "#2A1E16";
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const hex = (c) => rgba(c).slice(0, 3);

// ---- the time of day ---------------------------------------------------------------
// Key moments round the clock: the top and the bottom of the sky, and how
// much of a night it is (stars, the moon, clouds gone dark).
const KEYS = [
  [0, "#141A3A", "#2B3566", 1],
  [4.5, "#141A3A", "#2B3566", 1],
  [5.5, "#5A6BC4", "#FFB38A", 0.45],
  [7, "#5AB8FF", "#FFD9B0", 0.05],
  [8.5, "#5AB8FF", "#BFE6FF", 0],
  [16.5, "#5AB8FF", "#BFE6FF", 0],
  [18, "#6A4FA8", "#FF9A5A", 0.3],
  [19.5, "#3A2F7A", "#C2567A", 0.7],
  [20.5, "#141A3A", "#2B3566", 1],
  [24, "#141A3A", "#2B3566", 1]
].map(([hour, top, bot, night]) => ({ hour, top: hex(top), bot: hex(bot), night }));

/** The sky's colours at an hour (0-24, fractional): top, bottom and how dark (0 day, 1 night). */
export const skyColours = (hour) => {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && h >= KEYS[i + 1].hour) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp01((h - a.hour) / (b.hour - a.hour));
  return { top: mix(a.top, b.top, t), bot: mix(a.bot, b.bot, t), night: a.night + (b.night - a.night) * t };
};

/** The reader's local hour at a moment, with its minutes as a fraction. */
export const hourOf = (timeMs) => {
  const date = new Date(timeMs);
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
};

// ---- what flies when -----------------------------------------------------------------
// The clock is cut into slots; each slot may hold one thing, decided by the
// slot's number alone. Most hold nothing.

const hash = (n, salt) => rnd(n * 7.13 + salt * 101.7);

/** A slot for the rare things: two and a half minutes. */
const EVENT_SLOT_MS = 150_000;
/** How long each takes to cross (or fall). */
export const EVENT_MS = { dragon: 15_000, star: 1_100, balloon: 44_000 };
/**
 * The chance a slot holds each thing. By day: a balloon about every eleven
 * minutes, a dragon about every half hour. By night: a shooting star about
 * every eight minutes, a dragon as rarely as by day.
 */
const CHANCE = { day: { balloon: 0.22, dragon: 0.08 }, night: { star: 0.3, dragon: 0.08 } };

/** What a slot holds: { kind, at (ms, when it starts), seed } or null. */
export const eventInSlot = (slot) => {
  const start = slot * EVENT_SLOT_MS;
  const dark = skyColours(hourOf(start)).night > 0.5;
  const roll = hash(slot, 1);
  const table = dark ? CHANCE.night : CHANCE.day;
  let kind = null, upTo = 0;
  for (const [name, chance] of Object.entries(table)) {
    upTo += chance;
    if (roll < upTo) { kind = name; break; }
  }
  if (!kind) return null;
  const at = start + Math.floor(hash(slot, 2) * (EVENT_SLOT_MS - EVENT_MS[kind]));
  return { kind, at, seed: slot };
};

/** The rare things in the sky at a moment: [{ kind, t (0..1 through its crossing), seed }]. */
export const skyEvents = (timeMs) => {
  const found = eventInSlot(Math.floor(timeMs / EVENT_SLOT_MS));
  if (!found) return [];
  const t = (timeMs - found.at) / EVENT_MS[found.kind];
  return t >= 0 && t < 1 ? [{ kind: found.kind, t, seed: found.seed }] : [];
};

/** Birds: a slot every 45 seconds, by day; most have a small flock crossing. */
const BIRD_SLOT_MS = 45_000;
const BIRD_MS = 17_000;
const birdsAt = (timeMs, night) => {
  if (night > 0.5) return null;
  const slot = Math.floor(timeMs / BIRD_SLOT_MS);
  if (hash(slot, 5) > 0.62) return null;
  const at = slot * BIRD_SLOT_MS + Math.floor(hash(slot, 6) * (BIRD_SLOT_MS - BIRD_MS));
  const t = (timeMs - at) / BIRD_MS;
  return t >= 0 && t < 1 ? { t, seed: slot, count: 2 + Math.floor(hash(slot, 7) * 3) } : null;
};

// ---- the sprites -----------------------------------------------------------------------
// Each drawn once with the room's Painter and kept as plain pixels.

const sprite = (w, h, draw) => {
  const g = new Painter(w, h, 0);
  draw(g);
  const px = new Array(w * h).fill(null);
  for (let i = 0; i < w * h; i++) if (g.C.d[i]) px[i] = rgba(g.C.d[i]);
  return { w, h, px };
};
const kept = new Map();
const keep = (key, make) => {
  let found = kept.get(key);
  if (!found) { found = make(); kept.set(key, found); }
  return found;
};

/** A cloud: a flat-bottomed heap, lit from above. `tone` 0 day, 1 dusk, 2 night. */
const CLOUD_TONES = [["#FFFFFF", "#E6F2FF"], ["#FFE3D0", "#F2A98C"], ["#4A5388", "#343C6E"]];
const cloud = (w, tone) => keep(`cloud-${w}-${tone}`, () => sprite(w + 2, 9, (g) => {
  const [lit, shade] = CLOUD_TONES[tone];
  const fill = (nx, ny) => (ny > 0.25 ? shade : lit);
  g.ell(w * 0.5 + 1, 6, w * 0.5, 2.6, fill);
  g.ell(w * 0.32 + 1, 4.4, w * 0.22, 2.6, fill);
  g.ell(w * 0.6 + 1, 3.6, w * 0.26, 3.2, fill);
  // A flat base.
  for (let x = 0; x < w + 2; x++) g.C.d[8 * (w + 2) + x] = null;
}));

const bird = (up) => keep(`bird-${up}`, () => sprite(5, 3, (g) => {
  const c = "#3A2616";
  if (up) g.px(0, 0, c).px(1, 1, c).px(2, 2, c).px(3, 1, c).px(4, 0, c);
  else g.px(0, 2, c).px(1, 1, c).px(2, 1, c).px(3, 1, c).px(4, 2, c);
}));

/** The dragon, flying left: a long red body, a gold belly, wings up or down. */
const dragon = (wingsUp) => keep(`dragon-${wingsUp}`, () => sprite(34, 22, (g) => {
  const RED = "#C8453B", DARK = "#8E1B2E", GOLD = "#FFD23F", WING = "#E0393E", WING_LIT = "#FF7A5A";
  const body = (nx, ny) => (ny > 0.35 ? GOLD : ny < -0.5 ? "#E0604E" : RED);
  // The far wing, behind the body.
  g.stamp((l) => {
    if (wingsUp) for (let i = 0; i < 8; i++) l.line(17, 11, 15 + i * 1.6, 2 + Math.abs(i - 3) * 0.7, DARK);
    else for (let i = 0; i < 8; i++) l.line(17, 12, 15 + i * 1.6, 19 - Math.abs(i - 3) * 0.6, DARK);
  }, OUT);
  g.stamp((l) => {
    // Tail: a tapering curve up to a spade.
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, x = 22 + t * 9, y = 12 - Math.sin(t * Math.PI * 0.9) * 4 + t * 1.5;
      l.ell(x, y, 1.9 - t * 1.2, 1.7 - t * 1.0, RED);
    }
    l.px(32, 10, DARK).px(33, 9, DARK).px(33, 11, DARK).px(32, 9, DARK).px(32, 11, DARK);
    // Body, neck and head.
    l.ell(17, 12, 6.5, 3.4, body);
    l.ell(10, 10.5, 3.4, 2.4, body);
    l.ell(5.5, 8.5, 3.6, 2.6, (nx, ny) => (ny > 0.5 ? GOLD : RED));
    // Snout, horns, eye, and the spines down its back.
    l.rect(1, 8, 3, 2, RED).px(1, 10, DARK);
    l.px(6, 5, GOLD).px(7, 4, GOLD).px(8, 5, GOLD).px(9, 4, GOLD);
    l.px(4, 8, "#FFFFFF").px(5, 8, "#1A1A22");
    for (let x = 12; x < 23; x += 3) l.px(x, 8, DARK);
  }, OUT);
  // The near wing, in front: ribs and membrane.
  g.stamp((l) => {
    const tips = wingsUp ? [[10, 1], [15, 0], [20, 1], [25, 4]] : [[11, 20], [16, 21], [21, 20], [25, 17]];
    const root = [16, wingsUp ? 10 : 13];
    for (let k = 0; k < tips.length - 1; k++) {
      // Fill the web between two ribs.
      for (let s = 0; s <= 10; s++) {
        const x = tips[k][0] + ((tips[k + 1][0] - tips[k][0]) * s) / 10, y = tips[k][1] + ((tips[k + 1][1] - tips[k][1]) * s) / 10;
        l.line(root[0], root[1], x, y + (wingsUp ? 1.5 : -1.5), k % 2 ? WING : WING_LIT);
      }
    }
    for (const [x, y] of tips) l.line(root[0], root[1], x, y, DARK);
  }, OUT);
}));

/** A hot-air balloon: a striped envelope, ropes, a basket. */
const balloon = () => keep("balloon", () => sprite(15, 22, (g) => {
  g.stamp((l) => {
    l.ell(7.5, 7, 6.5, 7, (nx, ny) => {
      const band = Math.floor((nx + 1) * 2.5);
      const c = ["#E0393E", "#FFD23F", "#2F80E6", "#FFD23F", "#E0393E"][Math.max(0, Math.min(4, band))];
      return ny < -0.6 && nx < 0 ? "#FFFFFF" : c;
    });
    l.rect(5, 14, 5, 1, "#8E1B2E");
  }, OUT);
  g.line(5, 15, 6, 18, "#5E3A1F").line(9, 15, 8, 18, "#5E3A1F");
  g.stamp((l) => l.rect(5, 18, 5, 3, "#8A5A34").rect(5, 18, 5, 1, "#B07A4A"), OUT);
}));

// ---- the picture -------------------------------------------------------------------------

const put = (img, x, y, c, a = 1) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4, d = img.data;
  d[i] = d[i] * (1 - a) + c[0] * a;
  d[i + 1] = d[i + 1] * (1 - a) + c[1] * a;
  d[i + 2] = d[i + 2] * (1 - a) + c[2] * a;
  d[i + 3] = 255;
};

const stampSprite = (img, s, ox, oy, flip = false, alpha = 1) => {
  ox = Math.round(ox); oy = Math.round(oy);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const c = s.px[y * s.w + (flip ? s.w - 1 - x : x)];
    if (c) put(img, ox + x, oy + y, c, (c[3] / 255) * alpha);
  }
};

const disc = (img, cx, cy, r, colour) => {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const nx = (x + 0.5 - cx) / r, ny = (y + 0.5 - cy) / r;
    if (nx * nx + ny * ny > 1) continue;
    const c = colour(nx, ny);
    if (c) put(img, x, y, c);
  }
};

/** The clouds: [width, height in the sky (0 top), speed in pixels a second, where it starts]. Far ones small and slow. */
const CLOUDS = [
  [9, 0.2, 0.35, 20], [11, 0.34, 0.4, 150], [8, 0.12, 0.3, 230],
  [16, 0.46, 0.9, 60], [14, 0.28, 0.8, 190],
  [24, 0.58, 1.7, 110], [20, 0.4, 1.5, 280]
];

/**
 * The sky at a moment, `w` x `h` pixels. `events` replaces the clock's own
 * rare things (for tests and for looking at the art); pass `still` to leave
 * out everything that moves fast (birds and the rare things), for readers
 * who asked for less motion.
 */
export const renderSky = (w, h, timeMs, events, still = false) => {
  const img = new ImageData(w, h);
  const hour = hourOf(timeMs);
  const sky = skyColours(hour);
  const seconds = timeMs / 1000;

  // The gradient, in bands of two rows so it reads as pixel art.
  for (let y = 0; y < h; y++) {
    const c = mix(sky.top, sky.bot, clamp01((Math.floor(y / 2) * 2) / Math.max(1, h - 1)));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
    }
  }

  // Stars come out as it darkens, and twinkle: each on its own slow beat.
  if (sky.night > 0.35) {
    const strength = clamp01((sky.night - 0.35) / 0.5);
    for (let i = 0; i < 46; i++) {
      const x = Math.floor(rnd(i * 3 + 1) * w), y = Math.floor(rnd(i * 5 + 2) * h * 0.82);
      const beat = (seconds * (0.25 + rnd(i) * 0.5) + rnd(i + 9) * 7) % 1;
      if (beat > 0.9) continue;
      put(img, x, y, i % 3 ? [201, 209, 255] : [255, 255, 255], strength * (beat > 0.8 ? 0.5 : 1));
      if (i % 9 === 0 && beat < 0.5) { put(img, x - 1, y, [201, 209, 255], strength * 0.5); put(img, x + 1, y, [201, 209, 255], strength * 0.5); }
    }
  }

  // The sun rides an arc from five in the morning to eight at night; the moon takes the night shift.
  const day = clamp01((hour - 5) / 15);
  if (hour >= 5 && hour < 20) {
    const sx = w * (0.1 + day * 0.8), sy = h * (0.92 - Math.sin(day * Math.PI) * 0.74);
    const low = Math.sin(day * Math.PI) < 0.45;
    disc(img, sx, sy, 7.5, () => (low ? [255, 179, 90] : [255, 227, 107]));
    disc(img, sx - 1.2, sy - 1.2, 5, () => (low ? [255, 214, 150] : [255, 246, 194]));
    // Rays, turning slowly.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + seconds * 0.05;
      put(img, sx + Math.cos(a) * 10, sy + Math.sin(a) * 10, low ? [255, 179, 90] : [255, 246, 194], 0.8);
    }
  } else {
    const through = hour >= 20 ? (hour - 20) / 9 : (hour + 4) / 9;
    const mx = w * (0.14 + through * 0.72), my = h * (0.6 - Math.sin(through * Math.PI) * 0.42);
    disc(img, mx, my, 6.5, (nx, ny) => (nx - 0.5) * (nx - 0.5) + (ny + 0.12) * (ny + 0.12) < 0.5 ? null : nx + ny < -0.5 ? [255, 255, 255] : [255, 243, 194]);
  }

  // Clouds, far to near: the near ones bigger and faster, so the sky has depth.
  const tone = sky.night > 0.6 ? 2 : sky.night > 0.15 ? 1 : 0;
  for (const [cw, cy, speed, start] of CLOUDS) {
    const lap = w + cw + 12;
    const x = ((start + seconds * speed) % lap) - cw - 6;
    stampSprite(img, cloud(cw, tone), x, Math.round(cy * h), false, sky.night > 0.6 ? 0.85 : 1);
  }

  if (still) return img;

  // A few birds, by day.
  const flock = birdsAt(timeMs, sky.night);
  if (flock) {
    const left = hash(flock.seed, 8) < 0.5;
    const baseY = h * (0.2 + hash(flock.seed, 9) * 0.4);
    for (let i = 0; i < flock.count; i++) {
      const lead = (left ? 1 - flock.t : flock.t) * (w + 40) - 20;
      const x = lead + (left ? 1 : -1) * i * 7, y = baseY + (i % 2 ? 3 : 0) + i * 1.5 + Math.sin(seconds * 2 + i) * 1.2;
      stampSprite(img, bird(Math.floor(seconds * 4 + i) % 2 === 0), x, y);
    }
  }

  // And, now and then, something worth looking up for.
  for (const event of events ?? skyEvents(timeMs)) {
    const from = hash(event.seed, 3) < 0.5;
    if (event.kind === "dragon") {
      // Right across the sky, rising and falling on its wingbeats.
      const x = (from ? 1 - event.t : event.t) * (w + 44) - 39;
      const y = h * (0.16 + hash(event.seed, 4) * 0.3) + Math.sin(event.t * Math.PI * 6) * 3;
      stampSprite(img, dragon(Math.floor(event.t * 30) % 2 === 0), x, y, !from);
    } else if (event.kind === "star") {
      // A streak down the sky, bright at its head.
      const sx = w * (0.15 + hash(event.seed, 4) * 0.7), sy = h * 0.08;
      const dir = from ? 1 : -1;
      const head = event.t * 46;
      for (let k = 0; k < 14; k++) {
        const d = head - k * 1.6;
        if (d < 0) break;
        put(img, sx + dir * d, sy + d * 0.55, k < 2 ? [255, 255, 255] : [255, 227, 107], Math.max(0, 1 - k / 14) * (1 - event.t * 0.5));
      }
    } else if (event.kind === "balloon") {
      // Up from the horizon, across and away, swaying.
      const x = (from ? 1 - event.t : event.t) * (w + 30) - 15;
      const y = h * (0.62 - Math.sin(event.t * Math.PI) * 0.5) + Math.sin(event.t * Math.PI * 9) * 1.2;
      stampSprite(img, balloon(), x, y);
    }
  }
  return img;
};

/**
 * What changes the picture at a moment, as a short string: the scene redraws
 * only when this does, so a still sky costs nothing.
 */
export const skySignature = (w, h, timeMs, events, still = false) => {
  const seconds = timeMs / 1000;
  const parts = [Math.floor(hourOf(timeMs) * 30)];
  for (const [cw, , speed, start] of CLOUDS) parts.push(Math.floor((start + seconds * speed) % (w + cw + 12)));
  const night = skyColours(hourOf(timeMs)).night;
  if (night > 0.35) parts.push(Math.floor(seconds * 2));
  if (still) return parts.join(",");
  if (birdsAt(timeMs, night)) parts.push("b" + Math.floor(seconds * 12));
  const rare = events ?? skyEvents(timeMs);
  if (rare.length > 0) parts.push("e" + Math.floor(seconds * 12));
  return parts.join(",");
};
