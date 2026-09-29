/**
 * Juice for Pip's house: the short effects that make a harvest, a purchase or
 * a new hat feel like something happened. Seeds scatter and fly to the
 * counter, soil puffs, sparkles burst, a bought thing flies to where it goes.
 *
 * Every effect is a few small elements on one fixed layer over the page,
 * moved with the Web Animations API: transforms and opacity only, so the
 * compositor runs them and nothing is laid out again. Each piece removes
 * itself when its animation ends. Particles are whole squares of the house's
 * pixel size, so they read as part of the pixel art rather than confetti on
 * top of it.
 *
 * Under reduced motion nothing here plays: the change itself (the new plant,
 * the new number) is the feedback, and anything waiting on an effect (the
 * counter waiting for its seeds) is told at once.
 *
 * The moments have sounds too, when the reader turns them on (pip/sound.ts):
 * a pick, a pop into the soil, coins into the counter, a chime, a splash of
 * rain. Those play under reduced motion as well: stillness is not silence.
 */
import { playSound } from "../../pip/sound";

export type Point = { x: number; y: number };
export type Box = { left: number; top: number; width: number; height: number };
/** What some art looked like a moment ago, and where: the start of a flight. */
export type Captured = { rect: Box; canvas: HTMLCanvasElement | null };

export const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export const centerOf = (box: Box): Point => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

const between = (low: number, high: number) => low + Math.random() * (high - low);
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

// ---- the layer -------------------------------------------------------------------

let layer: HTMLDivElement | null = null;
const live = new Set<Animation>();

const fxLayer = () => {
  if (!layer || !layer.isConnected) {
    layer = document.createElement("div");
    layer.className = "pip-fx-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  return layer;
};

/** Stops every effect and clears the layer (the tab closing mid-harvest). */
export const clearEffects = () => {
  live.forEach((animation) => animation.cancel());
  live.clear();
  layer?.replaceChildren();
};

/** Plays an animation on a piece of the layer, which leaves when it ends (or is cancelled). */
const play = (element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> => {
  const animation = element.animate(keyframes, { fill: "both", ...options });
  live.add(animation);
  const done = () => {
    live.delete(animation);
    element.remove();
  };
  return animation.finished.then(done, done);
};

/** A piece placed by transform from the page's top-left corner. */
const piece = (className: string, width: number, height: number) => {
  const element = document.createElement("div");
  element.className = `pip-fx-piece ${className}`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  fxLayer().appendChild(element);
  return element;
};

/** Centred on (x, y), then scaled and turned. */
const at = (x: number, y: number, scale = 1, turn = 0) =>
  `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)}) rotate(${turn.toFixed(1)}deg)`;

// ---- pixel sprites -----------------------------------------------------------------
// Tiny pictures in the house's style, drawn once to a data URL.

type Sprite = { rows: string[]; colors: Record<string, string> };

const SPRITES = {
  seed: {
    rows: ["..##..", ".#hh#.", "#hbbb#", "#bbbb#", "#bbbs#", ".#ss#.", "..##.."],
    colors: { "#": "#5A3A1A", h: "#FBE3A0", b: "#E0A83E", s: "#B07A28" }
  },
  heart: {
    rows: [".##.##.", "#hb#bb#", "#bbbbb#", ".#bbb#.", "..#b#..", "...#..."],
    colors: { "#": "#6B1A2E", h: "#FFC2D1", b: "#E0567A" }
  },
  spark: {
    rows: ["..w..", "..y..", "wyWyw", "..y..", "..w.."],
    colors: { w: "#FFFFFF", y: "#FFE36B", W: "#FFFFFF" }
  }
} satisfies Record<string, Sprite>;

export type SpriteName = keyof typeof SPRITES;

const spriteUrls = new Map<string, string>();
const spriteUrl = (name: SpriteName) => {
  let url = spriteUrls.get(name);
  if (!url) {
    const { rows, colors } = SPRITES[name] as Sprite;
    const canvas = document.createElement("canvas");
    canvas.width = rows[0].length;
    canvas.height = rows.length;
    const context = canvas.getContext("2d");
    rows.forEach((row, y) =>
      [...row].forEach((key, x) => {
        const colour = colors[key];
        if (colour && context) {
          context.fillStyle = colour;
          context.fillRect(x, y, 1, 1);
        }
      })
    );
    url = canvas.toDataURL();
    spriteUrls.set(name, url);
  }
  return url;
};

const spriteSize = (name: SpriteName, pixel: number) => {
  const { rows } = SPRITES[name] as Sprite;
  return { width: rows[0].length * pixel, height: rows.length * pixel };
};

const spritePiece = (name: SpriteName, pixel: number) => {
  const { width, height } = spriteSize(name, pixel);
  const element = piece("pip-fx-sprite", width, height);
  element.style.backgroundImage = `url(${spriteUrl(name)})`;
  return element;
};

/** How big a flying seed's pixels are: a little smaller than the house's own. */
export const seedPixel = (housePixel: number) => Math.max(2, Math.round(housePixel * 0.6));

// ---- effects -------------------------------------------------------------------------

type BurstOptions = {
  /** One art pixel, in CSS pixels. */
  px: number;
  count?: number;
  /** Square colours; ignored for sprites. */
  colors?: readonly string[];
  sprite?: SpriteName;
  spread?: number;
  /** Upward push: the burst leans up, then falls. */
  lift?: number;
  fall?: number;
  duration?: number;
};

/** Sparkles, leaves or crumbs flung out from a point, falling a little as they fade. */
export const burst = (from: Point, { px, count = 10, colors = ["#FFE36B", "#FFFFFF"], sprite, spread = 64, lift = 26, fall = 30, duration = 700 }: BurstOptions) => {
  if (reducedMotion()) return;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + between(-0.35, 0.35);
    const reach = spread * between(0.45, 1);
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach * 0.75 - lift;
    const size = px * (Math.random() < 0.3 ? 2 : 1);
    const element = sprite ? spritePiece(sprite, Math.max(1, Math.round(px * 0.6))) : piece("", size, size);
    if (!sprite) element.style.background = pick(colors);
    const turn = between(-90, 90);
    void play(
      element,
      [
        { transform: at(from.x, from.y, 0.4), opacity: 1 },
        { transform: at(from.x + dx * 0.85, from.y + dy * 0.85, 1, turn * 0.6), opacity: 1, offset: 0.45 },
        { transform: at(from.x + dx, from.y + dy + fall, 0.6, turn), opacity: 0 }
      ],
      { duration: duration * between(0.8, 1.2), easing: "cubic-bezier(0.2, 0.7, 0.35, 1)" }
    );
  }
};

type PuffOptions = { px: number; count?: number; color?: string; edge?: string; spread?: number; rise?: number; duration?: number };

/** Soft round puffs from a point: soil when a seed goes in, smoke for a costume change. */
export const puff = (from: Point, { px, count = 7, color = "#B08050", edge = "#8A5A34", spread = 40, rise = 14, duration = 560 }: PuffOptions) => {
  if (reducedMotion()) return;
  for (let index = 0; index < count; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const dx = side * spread * between(0.35, 1);
    const dy = -rise * between(0.4, 1.2);
    const size = px * Math.round(between(2, 4));
    const element = piece("pip-fx-puff", size, size);
    element.style.background = color;
    element.style.boxShadow = `0 0 0 ${Math.max(1, Math.round(px / 2))}px ${edge}`;
    void play(
      element,
      [
        { transform: at(from.x, from.y, 0.4), opacity: 0.95 },
        { transform: at(from.x + dx, from.y + dy, 1.25), opacity: 0 }
      ],
      { duration: duration * between(0.8, 1.15), delay: index * 12, easing: "cubic-bezier(0.15, 0.8, 0.3, 1)" }
    );
  }
};

/** A ring that swells and fades: the moment a purchase goes through. */
export const ring = (from: Point, size: number, color = "rgb(var(--pip-accent))") => {
  playSound("coin", { pitch: 0.9 });
  if (reducedMotion()) return;
  const element = piece("pip-fx-ring", size, size);
  element.style.borderColor = color;
  void play(
    element,
    [
      { transform: at(from.x, from.y, 0.2), opacity: 1 },
      { transform: at(from.x, from.y, 1), opacity: 0 }
    ],
    { duration: 520, easing: "cubic-bezier(0.1, 0.7, 0.3, 1)" }
  );
};

/**
 * A number or word that floats off and fades: "+20" rises from where seeds
 * came from; "−120" sinks away from the counter it left.
 */
export const floatText = (from: Point, text: string, tone: "gain" | "spend" | "mood" | "water" = "gain") => {
  if (reducedMotion()) return;
  const element = document.createElement("div");
  element.className = "pip-fx-piece pip-fx-float";
  element.dataset.tone = tone;
  element.textContent = text;
  fxLayer().appendChild(element);
  const way = tone === "spend" ? 0.6 : -1;
  void play(
    element,
    [
      { transform: at(from.x, from.y, 0.6), opacity: 0 },
      { transform: at(from.x, from.y + 18 * way, 1.12), opacity: 1, offset: 0.18 },
      { transform: at(from.x, from.y + 34 * way, 1), opacity: 1, offset: 0.62 },
      { transform: at(from.x, from.y + 50 * way, 0.95), opacity: 0 }
    ],
    { duration: 1150, easing: "ease-out" }
  );
};

/**
 * Crumbs spilling from a point down to a floor line, with a little bounce,
 * then gone. Each has a dark pixel edge, so it reads against the treat it
 * fell from and the floor it lands on.
 */
export const spill = (from: Point, floor: number, { px, count = 7, colors }: { px: number; count?: number; colors: readonly string[] }) => {
  // A bite: a low, soft pop.
  playSound("pop", { pitch: 0.7, volume: 0.4 });
  if (reducedMotion()) return;
  const edge = Math.max(1, Math.round(px / 3));
  for (let index = 0; index < count; index += 1) {
    const dx = between(-1, 1) * 34;
    const size = px * (Math.random() < 0.35 ? 1.6 : 1);
    const element = piece("", size, size);
    element.style.background = pick(colors);
    element.style.boxShadow = `0 0 0 ${edge}px rgba(58, 36, 20, 0.75)`;
    const land = Math.max(from.y + 4, floor + between(-2, 4));
    const first = from.x + dx * 0.6;
    const last = from.x + dx;
    void play(
      element,
      [
        // Falls faster and faster, bounces once, settles, then fades where it lay.
        { transform: at(from.x, from.y, 1), opacity: 1, easing: "cubic-bezier(0.5, 0, 1, 0.6)" },
        { transform: at(first, land, 1), opacity: 1, offset: 0.5, easing: "cubic-bezier(0, 0.5, 0.5, 1)" },
        { transform: at((first + last) / 2, land - between(5, 11), 1), opacity: 1, offset: 0.66, easing: "cubic-bezier(0.5, 0, 1, 0.5)" },
        { transform: at(last, land, 1), opacity: 1, offset: 0.8 },
        { transform: at(last, land, 1), opacity: 0 }
      ],
      { duration: between(800, 1050), delay: index * 25, easing: "linear" }
    );
  }
};

/** A point on the curve from a through c to b, at t (0..1). */
const curve = (a: Point, c: Point, b: Point, t: number): Point => ({
  x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
  y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y
});

type CollectOptions = {
  sprite: SpriteName;
  count: number;
  /** One pixel of the flying sprite, in CSS pixels. */
  px: number;
  /** Runs as each one arrives (the counter bumps and counts). */
  onLand?: (index: number) => void;
  /** Between one taking off and the next. */
  stagger?: number;
};

/**
 * Seeds (or hearts) that burst out of `from`, hang for a beat, then zip home
 * to `to` one after another. Resolves when the last has landed.
 */
export const collect = (from: Point, to: Point, { sprite, count, px, onLand: landed, stagger = 55 }: CollectOptions): Promise<void> => {
  // Seeds tick into the counter, a little higher each; the first heart home chimes.
  const onLand = (index: number) => {
    if (sprite === "seed") playSound("coin", { pitch: 1 + Math.min(index, 12) * 0.035, volume: 0.6 });
    else if (sprite === "heart" && index === 0) playSound("chime", { pitch: 1.25, volume: 0.45 });
    landed?.(index);
  };
  if (reducedMotion() || count <= 0) {
    for (let index = 0; index < count; index += 1) onLand(index);
    return Promise.resolve();
  }
  const flights: Array<Promise<void>> = [];
  for (let index = 0; index < count; index += 1) {
    // Out and mostly up, as if the plant had sprung them.
    const angle = -Math.PI / 2 + between(-1.25, 1.25);
    const reach = between(26, 70);
    const scatter = { x: from.x + Math.cos(angle) * reach, y: from.y + Math.sin(angle) * reach };
    const hang = { x: scatter.x + between(-4, 4), y: scatter.y - between(3, 8) };
    const dx = to.x - hang.x;
    const dy = to.y - hang.y;
    const bend = between(-0.3, 0.3);
    const control = { x: hang.x + dx * 0.5 - dy * bend, y: hang.y + dy * 0.5 + dx * bend - Math.abs(dx) * 0.12 };
    const frames: Keyframe[] = [
      { transform: at(from.x, from.y, 0.3), opacity: 0, offset: 0, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" },
      { transform: at(scatter.x, scatter.y, 1.15, between(-30, 30)), opacity: 1, offset: 0.26 },
      { transform: at(hang.x, hang.y, 1.1), opacity: 1, offset: 0.36 }
    ];
    const steps = 10;
    for (let step = 1; step <= steps; step += 1) {
      // Squared: slow off the mark, fast into the counter.
      const t = step / steps;
      const point = curve(hang, control, to, t * t);
      frames.push({ transform: at(point.x, point.y, 1.1 - 0.5 * t), opacity: 1, offset: 0.36 + 0.64 * t });
    }
    const element = spritePiece(sprite, px);
    const duration = Math.min(1350, 780 + Math.hypot(dx, dy) * 0.3);
    flights.push(play(element, frames, { duration, delay: index * stagger, easing: "linear" }).then(() => onLand(index)));
  }
  return Promise.all(flights).then(() => undefined);
};

/** A copy of what an element shows now (its canvas), and where: the start of a flight. */
export const capture = (element: Element | null | undefined): Captured | null => {
  if (!element) return null;
  const source = element instanceof HTMLCanvasElement ? element : element.querySelector("canvas");
  if (source && source.width > 0 && source.height > 0 && source.getBoundingClientRect().width > 0) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.className = "pip-sprite";
    canvas.getContext("2d")?.drawImage(source, 0, 0);
    return { rect: source.getBoundingClientRect(), canvas };
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 ? { rect, canvas: null } : null;
};

type FlyOptions = {
  /** In a little card (a bought outfit on its way to Pip); plain art flies bare (decor). */
  card?: boolean;
  duration?: number;
  /** Shrink into the target and vanish (Pip "puts it on"), or land at its size. */
  vanish?: boolean;
};

/** A captured picture flies in an arc to a box (or point). Resolves on arrival. */
export const fly = (art: Captured | null, to: Box | Point | null, { card = false, duration = 640, vanish = false }: FlyOptions = {}): Promise<void> => {
  if (!art?.canvas || !to || reducedMotion()) return Promise.resolve();
  const from = art.rect;
  const element = piece(card ? "pip-fx-card" : "", from.width, from.height);
  element.appendChild(art.canvas);
  const start = centerOf(from);
  const isBox = "width" in to;
  const end = isBox ? centerOf(to) : to;
  const endScale = isBox ? Math.min(to.width / from.width, to.height / from.height) : 0.35;
  const control = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - Math.max(70, Math.abs(end.x - start.x) * 0.22) };
  const frames: Keyframe[] = [
    { transform: at(start.x, start.y, 1), opacity: 1, offset: 0 },
    { transform: at(start.x, start.y - 10, 1.08, -4), opacity: 1, offset: 0.14 }
  ];
  const steps = 12;
  const lifted = { x: start.x, y: start.y - 10 };
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    // Eased in and out along the arc.
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const point = curve(lifted, control, end, eased);
    const scale = 1.08 + (endScale * (vanish ? 0.4 : 1) - 1.08) * eased;
    frames.push({
      transform: at(point.x, point.y, scale, -4 * (1 - eased)),
      opacity: vanish && t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1,
      offset: 0.14 + 0.86 * t
    });
  }
  return play(element, frames, { duration, easing: "linear" });
};

/**
 * A picture that pops off its spot and is gone: a picked plant springs up,
 * or a piece of decor lifts away. Anchored at its bottom edge, as it stood;
 * `dim` after dark, to match the room it leaves.
 */
export const popOff = (image: ImageData | null, box: Box, style: "pick" | "lift", dim = false) => {
  if (style === "pick") playSound("pick");
  else playSound("place", { pitch: 1.35, volume: 0.45 });
  if (!image || reducedMotion()) return;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.className = "pip-sprite";
  canvas.getContext("2d")?.putImageData(image, 0, 0);
  const element = piece("pip-fx-pop", box.width, box.height);
  if (dim) element.style.filter = "brightness(0.5) saturate(0.85)";
  element.appendChild(canvas);
  const base = `translate(${box.left.toFixed(1)}px, ${box.top.toFixed(1)}px)`;
  const h = box.height;
  const frames: Keyframe[] =
    style === "pick"
      ? [
          { transform: `${base} scale(1, 1)`, opacity: 1 },
          { transform: `${base} scale(1.22, 0.8)`, opacity: 1, offset: 0.16 },
          { transform: `${base} translateY(${(-h * 0.42).toFixed(1)}px) scale(0.9, 1.2)`, opacity: 1, offset: 0.46 },
          { transform: `${base} translateY(${(-h * 0.85).toFixed(1)}px) scale(0.45)`, opacity: 0 }
        ]
      : [
          { transform: `${base} scale(1)`, opacity: 1 },
          { transform: `${base} translateY(${(-h * 0.18).toFixed(1)}px) scale(1.08)`, opacity: 1, offset: 0.4 },
          { transform: `${base} translateY(${(-h * 0.5).toFixed(1)}px) scale(0.7)`, opacity: 0 }
        ];
  void play(element, frames, { duration: style === "pick" ? 560 : 420, easing: "cubic-bezier(0.25, 0.8, 0.4, 1)" });
};

/**
 * Rain over a box, falling onto its soil line: what reading in focus poured
 * into a plot while the garden was out of sight. Resolves as the last drop lands.
 */
export const rain = (box: Box, soilY: number, { px, count = 12, spread = 700 }: { px: number; count?: number; spread?: number }): Promise<void> => {
  playSound("splash", { delay: reducedMotion() ? 0 : 300 });
  if (reducedMotion()) return Promise.resolve();
  const drops: Array<Promise<void>> = [];
  for (let index = 0; index < count; index += 1) {
    const x = box.left + between(0.12, 0.88) * box.width;
    const top = soilY - between(90, 150);
    const element = piece("pip-fx-drop", Math.max(2, px * 0.75), Math.max(4, px * 1.75));
    drops.push(
      play(
        element,
        [
          { transform: at(x, top, 1), opacity: 0 },
          { transform: at(x, top + 12, 1), opacity: 0.95, offset: 0.12 },
          { transform: at(x, soilY - px, 1), opacity: 0.95, offset: 0.9 },
          { transform: at(x, soilY, 0.5), opacity: 0 }
        ],
        { duration: between(380, 480), delay: (index / count) * spread + between(0, 50), easing: "cubic-bezier(0.55, 0, 0.9, 0.65)" }
      )
    );
  }
  return Promise.all(drops).then(() => undefined);
};

/** A seed dropped from `from` onto `to`, falling faster as it goes. Resolves as it lands. */
export const dropSeed = (from: Point, to: Point, px: number): Promise<void> => {
  if (reducedMotion()) {
    playSound("pop");
    return Promise.resolve();
  }
  const element = spritePiece("seed", px);
  return play(
    element,
    [
      { transform: at(from.x, from.y, 1, -20), opacity: 1 },
      { transform: at(to.x, to.y, 0.9, 10), opacity: 1, offset: 0.92 },
      { transform: at(to.x, to.y + px * 2, 0.5, 10), opacity: 0 }
    ],
    { duration: 330, easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" }
  ).then(() => playSound("pop"));
};

/** A seed that arcs from one point to another (a packet to the plot). Resolves on arrival. */
export const tossSeed = (from: Point, to: Point, px: number): Promise<void> => {
  if (reducedMotion()) return Promise.resolve();
  const element = spritePiece("seed", px);
  const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - Math.max(50, Math.abs(to.x - from.x) * 0.2) };
  const frames: Keyframe[] = [];
  const steps = 12;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const point = curve(from, control, to, eased);
    frames.push({ transform: at(point.x, point.y, 1, 360 * eased), opacity: 1, offset: t });
  }
  return play(element, frames, { duration: 480, easing: "linear" });
};

const CONFETTI = ["#FFD23F", "#FF6F8A", "#7CC8FF", "#8FD66A", "#FFFFFF", "#C79BFF"];

/** Pixel confetti drifting down over a box: a floor opened, a plot dug. */
export const confetti = (box: Box, { px, count = 36 }: { px: number; count?: number }) => {
  playSound("chime", { pitch: 0.85 });
  if (reducedMotion()) return;
  for (let index = 0; index < count; index += 1) {
    const x = box.left + between(0.05, 0.95) * box.width;
    const y = box.top + between(-0.02, 0.12) * box.height;
    const fallTo = y + box.height * between(0.45, 0.85);
    const sway = between(-40, 40);
    const size = px * (Math.random() < 0.35 ? 2 : 1.4);
    const element = piece("", size, size * (Math.random() < 0.5 ? 1 : 0.6));
    element.style.background = pick(CONFETTI);
    const turn = between(-360, 360);
    void play(
      element,
      [
        { transform: at(x, y - 20, 0.6), opacity: 0 },
        { transform: at(x + sway * 0.3, y, 1, turn * 0.2), opacity: 1, offset: 0.12 },
        { transform: at(x - sway * 0.4, (y + fallTo) / 2, 1, turn * 0.6), opacity: 1, offset: 0.6 },
        { transform: at(x + sway, fallTo, 0.9, turn), opacity: 0 }
      ],
      { duration: between(1500, 2300), delay: between(0, 350), easing: "cubic-bezier(0.3, 0.2, 0.6, 1)" }
    );
  }
};

/** A title card over a box for a big moment: a new floor. */
export const banner = (box: Box, title: string, note: string) => {
  if (reducedMotion()) return;
  const element = document.createElement("div");
  element.className = "pip-fx-piece pip-fx-banner";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const line = document.createElement("span");
  line.textContent = note;
  element.append(line, heading);
  fxLayer().appendChild(element);
  const x = box.left + box.width / 2;
  const y = box.top + Math.min(box.height * 0.3, 150);
  void play(
    element,
    [
      { transform: at(x, y + 20, 0.6), opacity: 0 },
      { transform: at(x, y - 4, 1.06), opacity: 1, offset: 0.1 },
      { transform: at(x, y, 1), opacity: 1, offset: 0.16 },
      { transform: at(x, y, 1), opacity: 1, offset: 0.82 },
      { transform: at(x, y - 24, 0.96), opacity: 0 }
    ],
    { duration: 2800, easing: "ease-out" }
  );
};

/** A quick squash-and-bounce on something already on the page: the counter taking a seed. */
export const bump = (element: Element | null | undefined, strength = 1) => {
  if (!element || reducedMotion()) return;
  const grow = 1 + 0.16 * strength;
  element.animate(
    [
      { transform: "scale(1)" },
      { transform: `scale(${grow.toFixed(3)})`, offset: 0.35 },
      { transform: `scale(${(1 - 0.04 * strength).toFixed(3)})`, offset: 0.7 },
      { transform: "scale(1)" }
    ],
    { duration: 300, easing: "ease-out" }
  );
};

/** A dip, for seeds going out: the counter gives a little as it pays. */
export const dip = (element: Element | null | undefined) => {
  if (!element || reducedMotion()) return;
  element.animate([{ transform: "scale(1)" }, { transform: "scale(0.9)", offset: 0.4 }, { transform: "scale(1)" }], {
    duration: 260,
    easing: "ease-out"
  });
};
