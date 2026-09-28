import type { GameArt, GameSprite } from "./gameArt";

/**
 * The Attic Arcade's three games, as plain simulations: `step` advances one
 * fixed tick, `draw` paints the current state onto a 240 x 120 canvas that CSS
 * scales up with square pixels. No DOM and no clock of their own; the overlay
 * owns the loop, the input and pausing.
 *
 * Difficulty ramps with play time on a fixed curve, and obstacles come from a
 * seeded generator, so a run feels fair and learnable rather than random.
 * None of this mints seeds: seeds grow only from reading in focus.
 *
 * The art is games-art.js (Pip's poses and the games' sprites, with hit
 * boxes); where a sprite is missing the game draws a plain stand-in.
 */

export const GAME_W = 240;
export const GAME_H = 120;

export type GameId = "dash" | "catch" | "flap";

/** What the player is doing this tick. `pressed` counts presses since the last tick. */
export type Controls = { up: boolean; down: boolean; left: boolean; right: boolean; pressed: number; pointerX: number | null };

export interface Game {
  readonly score: number;
  readonly over: boolean;
  /** Waiting for the first press. */
  readonly ready: boolean;
  /** Lives left, for games that have them. */
  readonly lives: number | null;
  /** Seconds of screen shake left (drawn only without reduced motion). */
  readonly shake: number;
  step(dt: number, controls: Controls): void;
  draw(ctx: CanvasRenderingContext2D, art: GameArt, frame: number): void;
}

export type GameInfo = { id: GameId; name: string; blurb: string; controls: string; create: (seed: number) => Game };

type Box = { x: number; y: number; w: number; h: number };

// ---- shared bits ------------------------------------------------------------

/** A small, fast, seeded generator (mulberry32). */
const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** A sprite's hit box, placed with its top-left at (x, y). */
const hitOf = (sprite: GameSprite, x: number, y: number): Box => ({ x: x + sprite.box[0], y: y + sprite.box[1], w: sprite.box[2], h: sprite.box[3] });

/** Where a 32 x 32 Pip goes so its hit box stands on `feetY`, centred on `x`. */
const pipAt = (pose: GameSprite, x: number, feetY: number) => ({
  left: Math.round(x - pose.box[0] - pose.box[2] / 2),
  top: Math.round(feetY - pose.box[1] - pose.box[3])
});

const drawAt = (ctx: CanvasRenderingContext2D, sprite: GameSprite, left: number, top: number, flip = false) => {
  if (!flip) {
    ctx.drawImage(sprite.image, Math.round(left), Math.round(top));
    return;
  }
  ctx.save();
  ctx.translate(Math.round(left) + sprite.w, Math.round(top));
  ctx.scale(-1, 1);
  ctx.drawImage(sprite.image, 0, 0);
  ctx.restore();
};

/** A pose, or a library move standing in for it. */
const poseOr = (art: GameArt, pose: string, move: string, frame: number) => art.pose(pose, frame) ?? art.pip(move, frame);

/** A backdrop that tiles sideways, scrolled for parallax; a plain sky without art. */
const tiled = (ctx: CanvasRenderingContext2D, sprite: GameSprite | null, y: number, scroll: number) => {
  if (!sprite) return false;
  const offset = -(Math.floor(scroll) % sprite.w);
  for (let x = offset; x < GAME_W; x += sprite.w) ctx.drawImage(sprite.image, x, y);
  return true;
};

const plainSky = (ctx: CanvasRenderingContext2D, top: string, bottom: string) => {
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, GAME_W, GAME_H / 2);
  ctx.fillStyle = bottom;
  ctx.fillRect(0, GAME_H / 2, GAME_W, GAME_H / 2);
};

const plainGround = (ctx: CanvasRenderingContext2D, y: number, scroll: number) => {
  ctx.fillStyle = "#9a6b3f";
  ctx.fillRect(0, y, GAME_W, 2);
  ctx.fillStyle = "#6b4a2e";
  ctx.fillRect(0, y + 2, GAME_W, GAME_H - y - 2);
  ctx.fillStyle = "#9a6b3f";
  const off = -(Math.floor(scroll) % 16);
  for (let x = off; x < GAME_W; x += 16) ctx.fillRect(x, y + 6, 6, 1);
};

/** Clouds drifting slowly, placed from a seed so they are the same every run. */
const clouds = (ctx: CanvasRenderingContext2D, art: GameArt, frame: number, scroll: number) => {
  const cloud = art.sprite("cloud", frame);
  if (!cloud) return;
  for (let i = 0; i < 4; i++) {
    const span = GAME_W + cloud.w;
    const x = ((i * 97 - scroll * 0.15) % span + span) % span - cloud.w;
    ctx.drawImage(cloud.image, Math.round(x), 8 + ((i * 13) % 26));
  }
};

// ---- Pip Dash: an endless run over book stacks and under bats -------------------

const DASH_GROUND = 104;

type DashObstacle = { kind: "books" | "bookend" | "bat" | "page"; x: number; y: number; w: number; h: number; box: [number, number, number, number] };

// Stand-in sizes (and hit boxes) for obstacles without art, matching the art's.
const DASH_FALLBACK: Record<DashObstacle["kind"], { w: number; h: number; box: [number, number, number, number] }> = {
  books: { w: 16, h: 20, box: [1, 3, 14, 17] },
  bookend: { w: 14, h: 30, box: [1, 2, 12, 28] },
  bat: { w: 20, h: 14, box: [5, 4, 10, 7] },
  page: { w: 16, h: 12, box: [2, 2, 12, 8] }
};

class Dash implements Game {
  score = 0;
  over = false;
  ready = true;
  lives = null;
  shake = 0;
  private rng: () => number;
  private t = 0;
  private distance = 0;
  private y = DASH_GROUND;
  private vy = 0;
  private ducking = false;
  private nextAt = 170;
  private obstacles: DashObstacle[] = [];
  private art: GameArt | null = null;

  constructor(seed: number) {
    this.rng = seeded(seed);
  }

  private get speed() {
    return Math.min(230, 95 + this.t * 3.2);
  }

  private spawn() {
    // Flyers only after a little warm-up; low ones mean duck.
    const flyer = this.t > 10 && this.rng() < 0.3;
    const tall = !flyer && this.rng() < Math.min(0.45, this.t / 70);
    const kind: DashObstacle["kind"] = flyer ? (this.rng() < 0.5 ? "bat" : "page") : tall ? "bookend" : "books";
    const art = this.art?.sprite(kind, 0);
    const size = art ? { w: art.w, h: art.h, box: art.box } : DASH_FALLBACK[kind];
    // Flyers hang where a standing Pip is hit and a ducking one is not.
    const y = flyer ? 88 - size.box[1] - size.box[3] + 4 : DASH_GROUND - size.h;
    this.obstacles.push({ kind, x: GAME_W + 8, y, ...size });
  }

  step(dt: number, c: Controls) {
    this.shake = Math.max(0, this.shake - dt);
    if (this.over) return;
    if (this.ready) {
      if (c.pressed > 0 || c.up) this.ready = false;
      else return;
    }
    this.t += dt;
    const onGround = this.y >= DASH_GROUND;
    if (onGround && (c.pressed > 0 || c.up) && !c.down) this.vy = -310;
    // Holding jump on the way up goes higher; letting go drops sooner.
    const gravity = this.vy < 0 && c.up ? 700 : 1300;
    this.vy += gravity * dt;
    this.y = Math.min(DASH_GROUND, this.y + this.vy * dt);
    if (this.y >= DASH_GROUND) this.vy = 0;
    this.ducking = c.down && this.y >= DASH_GROUND;

    const move = this.speed * dt;
    this.distance += move;
    this.score = Math.floor(this.distance / 10);
    for (const o of this.obstacles) o.x -= move;
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -10);
    if (this.distance >= this.nextAt) {
      this.spawn();
      // The gap shrinks with speed but never below what a jump can clear.
      this.nextAt = this.distance + this.speed * (0.75 + this.rng() * 0.8) + 40;
    }

    const pip = this.ducking ? { x: 29, y: this.y - 10, w: 17, h: 10 } : { x: 30, y: this.y - 17, w: 12, h: 17 };
    if (this.obstacles.some((o) => overlaps(pip, { x: o.x + o.box[0], y: o.y + o.box[1], w: o.box[2], h: o.box[3] }))) {
      this.over = true;
      this.shake = 0.35;
    }
  }

  draw(ctx: CanvasRenderingContext2D, art: GameArt, frame: number) {
    this.art = art;
    if (!tiled(ctx, art.sprite("sky", frame), 0, 0)) plainSky(ctx, "#7cc8ff", "#ddf2ff");
    clouds(ctx, art, frame, this.distance);
    tiled(ctx, art.sprite("hills", frame), DASH_GROUND - 44, this.distance * 0.35);
    if (!tiled(ctx, art.sprite("ground", frame), DASH_GROUND, this.distance)) plainGround(ctx, DASH_GROUND, this.distance);
    for (const o of this.obstacles) {
      const sprite = art.sprite(o.kind, frame);
      if (sprite) {
        drawAt(ctx, sprite, o.x, o.y);
        continue;
      }
      ctx.fillStyle = o.kind === "bat" ? "#2a1e3a" : o.kind === "page" ? "#f2e4c6" : o.kind === "bookend" ? "#5a4a80" : "#b04a3a";
      ctx.fillRect(Math.round(o.x + o.box[0]), Math.round(o.y + o.box[1]), o.box[2], o.box[3]);
    }
    const pose = this.over ? poseOr(art, "over", "splat", frame) : this.y < DASH_GROUND ? poseOr(art, "jump", "fall", frame) : this.ducking ? poseOr(art, "duck", "land", frame) : poseOr(art, "run", this.ready ? "idle" : "walk", frame);
    const at = pipAt(pose, 36, this.y);
    drawAt(ctx, pose, at.left, at.top);
  }
}

// ---- Leaf Catch: catch what falls, dodge the ink ----------------------------------

const CATCH_FLOOR = 108;
type Drop = { kind: "leaf" | "goldleaf" | "seed" | "letter" | "ink"; x: number; y: number; v: number; glyph: string };
const POINTS: Record<Drop["kind"], number> = { leaf: 1, seed: 1, letter: 3, goldleaf: 5, ink: 0 };

class Catch implements Game {
  score = 0;
  over = false;
  ready = true;
  lives = 3;
  shake = 0;
  private rng: () => number;
  private t = 0;
  private x = GAME_W / 2;
  private facing = 1;
  private moving = false;
  private happy = 0;
  private hurt = 0;
  private spawnIn = 0.6;
  private drops: Drop[] = [];
  private splashes: Array<{ x: number; y: number; life: number; text: string }> = [];

  constructor(seed: number) {
    this.rng = seeded(seed);
  }

  step(dt: number, c: Controls) {
    this.shake = Math.max(0, this.shake - dt);
    this.happy = Math.max(0, this.happy - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.splashes = this.splashes.map((s) => ({ ...s, y: s.y - 18 * dt, life: s.life - dt })).filter((s) => s.life > 0);
    if (this.over) return;
    if (this.ready) {
      if (c.pressed > 0 || c.left || c.right || c.pointerX !== null) this.ready = false;
      else return;
    }
    this.t += dt;
    const before = this.x;
    if (c.pointerX !== null) this.x += (c.pointerX - this.x) * Math.min(1, dt * 12);
    if (c.left) this.x -= 150 * dt;
    if (c.right) this.x += 150 * dt;
    this.x = Math.max(12, Math.min(GAME_W - 12, this.x));
    this.moving = Math.abs(this.x - before) > 0.2;
    if (this.moving) this.facing = this.x < before ? -1 : 1;

    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = Math.max(0.32, 1.05 - this.t * 0.012);
      const roll = this.rng();
      // Ink comes in once the reader has warmed up, and grows more common.
      const ink = this.t < 6 ? 0 : Math.min(0.35, 0.12 + this.t * 0.004);
      const kind: Drop["kind"] =
        roll < ink ? "ink" : roll < ink + 0.05 ? "goldleaf" : roll < ink + 0.2 ? "letter" : roll < ink + 0.55 ? "leaf" : "seed";
      this.drops.push({
        kind,
        x: 10 + this.rng() * (GAME_W - 20),
        y: -8,
        v: Math.min(150, 42 + this.t * 1.6) * (0.85 + this.rng() * 0.3),
        glyph: "PIPREADBOOK"[Math.floor(this.rng() * 11)]
      });
    }
    for (const d of this.drops) d.y += d.v * dt;
    // The basket: the catch pose's box when the art has one, else Pip's middle.
    const basket = { x: this.x - 9, y: CATCH_FLOOR - 20, w: 18, h: 10 };
    const kept: Drop[] = [];
    for (const d of this.drops) {
      if (overlaps(basket, { x: d.x - 4, y: d.y - 4, w: 8, h: 8 })) {
        if (d.kind === "ink") {
          this.lives = Math.max(0, (this.lives ?? 0) - 1);
          this.shake = 0.3;
          this.hurt = 0.6;
          this.splashes.push({ x: d.x, y: d.y, life: 0.5, text: "" });
          if (this.lives === 0) this.over = true;
        } else {
          this.score += POINTS[d.kind];
          this.happy = 0.4;
          this.splashes.push({ x: d.x, y: d.y, life: 0.5, text: `+${POINTS[d.kind]}` });
        }
        continue;
      }
      // Missing a seed costs nothing: only the ink hurts.
      if (d.y < GAME_H + 8) kept.push(d);
    }
    this.drops = kept;
  }

  draw(ctx: CanvasRenderingContext2D, art: GameArt, frame: number) {
    if (!tiled(ctx, art.sprite("bg", frame), 0, 0)) {
      plainSky(ctx, "#27304f", "#3a4470");
      plainGround(ctx, CATCH_FLOOR, 0);
    }
    for (const d of this.drops) {
      const sprite = art.sprite(d.kind, frame, d.kind === "letter" ? { letter: d.glyph } : {});
      if (sprite) {
        drawAt(ctx, sprite, d.x - sprite.w / 2, d.y - sprite.h / 2);
        continue;
      }
      ctx.fillStyle = d.kind === "ink" ? "#141821" : d.kind === "letter" ? "#f2e4c6" : d.kind === "goldleaf" ? "#ffd23f" : "#7bc043";
      ctx.fillRect(Math.round(d.x - 3), Math.round(d.y - 3), 7, 7);
    }
    const pose = this.over || this.hurt > 0 ? poseOr(art, "hurt", "sob", frame) : this.happy > 0 ? poseOr(art, "happy", "cheer", frame) : this.moving ? poseOr(art, "walk", "walk", frame) : poseOr(art, "idle", "idle", frame);
    drawAt(ctx, pose, Math.round(this.x - 16), CATCH_FLOOR - 31, this.facing < 0);
    for (const s of this.splashes) {
      const splash = s.text ? null : art.sprite("splash", Math.floor((0.5 - s.life) * 16));
      if (splash) drawAt(ctx, splash, s.x - splash.w / 2, s.y - splash.h / 2);
      if (s.text) {
        ctx.fillStyle = "#ffd23f";
        ctx.font = "7px monospace";
        ctx.fillText(s.text, Math.round(s.x - 5), Math.round(s.y - 8));
      }
    }
  }
}

// ---- Page Flap: flutter between towers of book spines --------------------------

const FLAP_GROUND = 110;
const PILLAR_W = 24;

class Flap implements Game {
  score = 0;
  over = false;
  ready = true;
  lives = null;
  shake = 0;
  private rng: () => number;
  private t = 0;
  private y = 60;
  private vy = 0;
  private flapping = 0;
  private scroll = 0;
  private bob = 0;
  private pillars: Array<{ x: number; gapY: number; gap: number; passed: boolean; variant: number }> = [];

  constructor(seed: number) {
    this.rng = seeded(seed);
  }

  step(dt: number, c: Controls) {
    this.shake = Math.max(0, this.shake - dt);
    if (this.over) {
      // Pip drops to the ground after a bump.
      this.vy += 500 * dt;
      this.y = Math.min(FLAP_GROUND, this.y + this.vy * dt);
      return;
    }
    if (this.ready) {
      this.bob += dt;
      this.y = 60 + Math.sin(this.bob * 3.3) * 3;
      if (c.pressed > 0 || c.up) this.ready = false;
      else return;
    }
    this.t += dt;
    if (c.pressed > 0) {
      this.vy = -165;
      this.flapping = 0.15;
    }
    this.flapping = Math.max(0, this.flapping - dt);
    this.vy = Math.min(220, this.vy + 520 * dt);
    this.y += this.vy * dt;

    const speed = Math.min(105, 62 + this.t * 0.9);
    this.scroll += speed * dt;
    for (const p of this.pillars) p.x -= speed * dt;
    this.pillars = this.pillars.filter((p) => p.x > -PILLAR_W - 4);
    const last = this.pillars[this.pillars.length - 1];
    if (!last || last.x < GAME_W - 92) {
      const gap = Math.max(40, 58 - this.score * 0.8);
      this.pillars.push({ x: GAME_W + 4, gapY: 18 + gap / 2 + this.rng() * (FLAP_GROUND - 36 - gap), gap, passed: false, variant: Math.floor(this.rng() * 5) });
    }

    const pip = { x: 54, y: this.y - 12, w: 12, h: 11 };
    for (const p of this.pillars) {
      if (!p.passed && p.x + PILLAR_W < pip.x) {
        p.passed = true;
        this.score += 1;
      }
      const top = { x: p.x + 1, y: 0, w: PILLAR_W - 2, h: p.gapY - p.gap / 2 };
      const bottom = { x: p.x + 1, y: p.gapY + p.gap / 2, w: PILLAR_W - 2, h: GAME_H };
      if (overlaps(pip, top) || overlaps(pip, bottom)) this.hit();
    }
    if (this.y >= FLAP_GROUND || this.y < 6) this.hit();
  }

  private hit() {
    if (this.over) return;
    this.over = true;
    this.shake = 0.35;
    this.vy = 0;
  }

  draw(ctx: CanvasRenderingContext2D, art: GameArt, frame: number) {
    if (!tiled(ctx, art.sprite("bg", frame), 0, this.scroll * 0.2)) plainSky(ctx, "#6a4fa8", "#ffb38a");
    clouds(ctx, art, frame, this.scroll);
    for (const p of this.pillars) {
      const topH = Math.max(1, Math.round(p.gapY - p.gap / 2));
      const bottomY = Math.round(p.gapY + p.gap / 2);
      const bottomH = Math.max(1, FLAP_GROUND - bottomY);
      const top = art.sprite("pillar", frame, { h: topH, top: true, variant: p.variant });
      const bottom = art.sprite("pillar", frame, { h: bottomH, variant: p.variant });
      if (top && bottom) {
        drawAt(ctx, top, p.x, 0);
        drawAt(ctx, bottom, p.x, bottomY);
      } else {
        ctx.fillStyle = ["#c8453b", "#2f80e6", "#1fa36a", "#8e5cff", "#e07a3a"][p.variant];
        ctx.fillRect(Math.round(p.x) + 2, 0, PILLAR_W - 4, topH);
        ctx.fillRect(Math.round(p.x) + 2, bottomY, PILLAR_W - 4, bottomH);
      }
    }
    if (!tiled(ctx, art.sprite("ground", frame), FLAP_GROUND, this.scroll)) plainGround(ctx, FLAP_GROUND, this.scroll);
    const pose = this.over ? poseOr(art, "bonk", "tumble", frame) : this.flapping > 0 || this.vy < 0 ? poseOr(art, "fly", "cheer", frame) : poseOr(art, "fall", "fall", frame);
    drawAt(ctx, pose, 44, Math.round(this.y - 24));
  }
}

export const GAMES: GameInfo[] = [
  {
    id: "dash",
    name: "Pip Dash",
    blurb: "Run the shelves. Jump the book stacks, duck the bats.",
    controls: "Space or ↑ to jump (hold to go higher), ↓ to duck. Tap to jump.",
    create: (seed) => new Dash(seed)
  },
  {
    id: "catch",
    name: "Leaf Catch",
    blurb: "Catch leaves, seeds and letters in Pip's basket. Dodge the ink.",
    controls: "← and → to move, or follow the pointer. Three ink blots and it's over.",
    create: (seed) => new Catch(seed)
  },
  {
    id: "flap",
    name: "Page Flap",
    blurb: "Leaf-copter between towers of book spines.",
    controls: "Space, ↑ or tap to flap.",
    create: (seed) => new Flap(seed)
  }
];
