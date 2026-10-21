import { useSyncExternalStore } from "react";

/**
 * How much of the glass Leaflet draws on this device: `html[data-perf]`, read by
 * styles/perf.css (the one place the lighter looks are written) and by the few
 * components that draw blur themselves (the lens, the scroll edges).
 *
 *   full     the whole look: the lens at the rim, ramps of blur, frosted bars and sheets.
 *   lite     "Smooth": no lens, no backdrop blur at all, edges fade by tint alone; bars,
 *            sheets and menus are near-opaque tints with the inset rim, lighter shadows,
 *            no endless decoration. The same shapes, radii and motion.
 *   minimal  lite, solid (the old `.no-glass`): for the weakest phones.
 *
 * Chosen once at start (`installPerfTier`, main.tsx) from the reader's choice in
 * Settings (Visual effects: Auto, Full, Smooth) and, on Auto, from the device:
 *
 *   - Android: Smooth on every phone (the owner's call, 2026-10-21: a phone scrolling
 *     under a blurred bar redraws the blur every frame, and an entry phone's GPU, an
 *     Adreno 619, dropped frames scrolling and throwing Pip). Minimal for 2 GB or less,
 *     or a weak or software GPU with little memory or few cores. Full only by choice.
 *   - Elsewhere (the Windows app): Full, but Smooth on a software renderer (no GPU),
 *     and minimal at 2 GB or less.
 *
 * What the device was judged to be is kept (`leaflet.perf.auto.v1`), so a launch does
 * not open a WebGL context to ask again. Then, on Auto only, two checks can step the
 * tier down for the session: a short probe of frame times a few seconds after start,
 * and a watchdog over scrolling and dragging (15% of frames over 25 ms across 3 s of
 * movement: one step down).
 */

export type PerfTier = "full" | "lite" | "minimal";
export type EffectsChoice = "auto" | "full" | "lite";
export type GpuClass = "high" | "mid" | "low" | "software" | "unknown";

export type DeviceSignals = {
  android: boolean;
  /** The GPU as WebGL names it (unmasked where the browser allows), or null. */
  renderer: string | null;
  /** GB, `navigator.deviceMemory` (Chromium caps it at 8). */
  memory?: number;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
};

/** At or under this much memory (GB) the glass is solid: minimal. */
export const MINIMAL_MEMORY_GB = 2;
/** The watchdog: a frame slower than this is a slow one (ms). */
export const SLOW_FRAME_MS = 25;
/** The watchdog: this share of slow frames steps the tier down. */
export const SLOW_SHARE = 0.15;
/** The watchdog: across this much movement (ms of frames while scrolling or dragging). */
export const WATCH_WINDOW_MS = 3000;

const CHOICE_KEY = "leaflet.effects.v1";
const AUTO_KEY = "leaflet.perf.auto.v1";
/** Bumped when the rules below change, so a judgement kept under the old ones is made again. */
export const RULES_VERSION = 2;

export const TIERS: readonly PerfTier[] = ["full", "lite", "minimal"];

/** One step lighter (minimal stays minimal). */
export const stepDown = (tier: PerfTier): PerfTier => (tier === "full" ? "lite" : "minimal");

/** The lighter of two tiers. */
export const lighter = (a: PerfTier, b: PerfTier): PerfTier => (TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b);

/**
 * What kind of GPU a WebGL renderer string names. Adreno 7xx and 8xx (and 650 and up of
 * the 6xx, the Snapdragon 865/888 class), Mali G7xx and G77/G78, Immortalis and Xclipse
 * are high; the rest of the 6xx (the Nord CE4 Lite's 619) and Mali G5x/G6x mid; older
 * ones low; SwiftShader, llvmpipe and Windows' basic driver draw on the CPU.
 */
export const gpuClass = (renderer: string | null | undefined): GpuClass => {
  if (!renderer) return "unknown";
  const name = renderer.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|basic render|software/.test(name)) return "software";
  const adreno = /adreno[^0-9]*(\d{3})/.exec(name);
  if (adreno) {
    const n = Number(adreno[1]);
    if (n >= 700) return "high";
    if (n >= 650) return "high";
    if (n >= 600) return "mid";
    return "low";
  }
  if (/immortalis|xclipse|mali-g1-|mali g1-/.test(name)) return "high";
  const mali = /mali-?\s?g(\d{2,3})/.exec(name);
  if (mali) {
    const n = Number(mali[1]);
    // Three digits: G310 to G725 (the first digit is the class). Two: G31 to G78.
    const tier = n >= 100 ? Math.floor(n / 100) : Math.floor(n / 10);
    if (tier >= 7) return "high";
    if (tier >= 5) return "mid";
    return "low";
  }
  if (/mali-t|mali-4|powervr|sgx|vivante|videocore/.test(name)) return "low";
  if (/apple|nvidia|geforce|radeon|amd|intel|arc|adreno x|qualcomm/.test(name)) return "high";
  return "unknown";
};

/** The tier the device itself calls for (Auto, before the frame checks). */
export const autoTier = ({ android, renderer, memory, cores }: DeviceSignals): PerfTier => {
  if (typeof memory === "number" && memory <= MINIMAL_MEMORY_GB) return "minimal";
  const gpu = gpuClass(renderer);
  const little = (typeof memory === "number" && memory <= 3) || (typeof cores === "number" && cores <= 4);
  if (android) {
    if ((gpu === "low" || gpu === "software") && little) return "minimal";
    return "lite";
  }
  if (gpu === "software") return "lite";
  return "full";
};

/** The tier drawn: the reader's choice, or on Auto the device's, stepped down by the session's checks. */
export const resolveTier = (choice: EffectsChoice, auto: PerfTier, session: PerfTier | null = null): PerfTier => {
  if (choice === "full") return "full";
  if (choice === "lite") return "lite";
  return session ? lighter(auto, session) : auto;
};

/**
 * Frames while something moves (a scroll, a drag), in a rolling window of
 * WATCH_WINDOW_MS: `add` answers true once SLOW_SHARE of them took longer than
 * SLOW_FRAME_MS, and starts the window over.
 */
export class FrameWatch {
  private frames: number[] = [];
  private total = 0;
  private slow = 0;

  constructor(
    private readonly windowMs = WATCH_WINDOW_MS,
    private readonly slowMs = SLOW_FRAME_MS,
    private readonly share = SLOW_SHARE,
  ) {}

  /** One frame's time (ms, rAF to rAF). A gap of a second or more (the app put away) is not a frame. */
  add(delta: number): boolean {
    if (!Number.isFinite(delta) || delta <= 0 || delta >= 1000) return false;
    this.frames.push(delta);
    this.total += delta;
    if (delta > this.slowMs) this.slow += 1;
    while (this.frames.length > 1 && this.total - this.frames[0] >= this.windowMs) {
      const first = this.frames.shift()!;
      this.total -= first;
      if (first > this.slowMs) this.slow -= 1;
    }
    if (this.total < this.windowMs * 0.9) return false;
    if (this.slow / this.frames.length < this.share) return false;
    this.reset();
    return true;
  }

  reset() {
    this.frames = [];
    this.total = 0;
    this.slow = 0;
  }

  /** The share of slow frames in the window now. */
  get slowShare() {
    return this.frames.length ? this.slow / this.frames.length : 0;
  }
}

/**
 * The start-up probe's verdict on a second or so of frame times: too slow when half
 * the frames miss 40 a second, or a third take longer than 33 ms. (Few frames: no verdict.)
 */
export const probeSaysSlow = (deltas: number[]): boolean => {
  const frames = deltas.filter((d) => Number.isFinite(d) && d > 0 && d < 1000);
  if (frames.length < 20) return false;
  const sorted = [...frames].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const over33 = frames.filter((d) => d > 33.4).length / frames.length;
  return median > 24 || over33 >= 1 / 3;
};

// ---- The page ----------------------------------------------------------------

const storage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const readChoice = (): EffectsChoice => {
  try {
    const raw = storage()?.getItem(CHOICE_KEY);
    return raw === "full" || raw === "lite" ? raw : "auto";
  } catch {
    return "auto";
  }
};

type Judged = { v: number; tier: PerfTier; renderer: string | null; memory?: number; cores?: number; android: boolean };

/** The GPU's name from a throwaway WebGL context (unmasked where allowed). */
export const readRenderer = (): string | null => {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "") || null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return null;
  }
};

const isAndroidUa = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/** The device's own tier, as judged before (kept) or now. */
const judgeDevice = (): Judged => {
  const android = isAndroidUa();
  const nav = (typeof navigator === "undefined" ? {} : navigator) as Navigator & { deviceMemory?: number };
  const memory = typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined;
  const cores = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined;
  try {
    const kept = JSON.parse(storage()?.getItem(AUTO_KEY) ?? "null") as Judged | null;
    if (kept && kept.v === RULES_VERSION && kept.android === android && kept.memory === memory && kept.cores === cores && TIERS.includes(kept.tier)) {
      return kept;
    }
  } catch {
    // Judged again.
  }
  const renderer = readRenderer();
  const judged: Judged = { v: RULES_VERSION, tier: autoTier({ android, renderer, memory, cores }), renderer, memory, cores, android };
  try {
    storage()?.setItem(AUTO_KEY, JSON.stringify(judged));
  } catch {
    // Judged again next time.
  }
  return judged;
};

type State = { choice: EffectsChoice; auto: PerfTier; session: PerfTier | null; tier: PerfTier; renderer: string | null };

let state: State = { choice: "auto", auto: "full", session: null, tier: "full", renderer: null };
const listeners = new Set<() => void>();

const apply = () => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.dataset.perf !== state.tier) root.dataset.perf = state.tier;
  // Everything written for `.no-glass` (solid tints) is the minimal look.
  root.classList.toggle("no-glass", state.tier === "minimal");
};

const update = (next: Partial<State>) => {
  const merged = { ...state, ...next };
  merged.tier = resolveTier(merged.choice, merged.auto, merged.session);
  const changed = merged.tier !== state.tier || merged.choice !== state.choice;
  state = merged;
  apply();
  if (changed) for (const listener of listeners) listener();
};

/** The tier drawn now. */
export const currentTier = (): PerfTier => state.tier;
/** The reader's choice (Settings). */
export const currentChoice = (): EffectsChoice => state.choice;
/** For a problem report or a look in DevTools. */
export const perfDetails = () => ({ ...state });

export const onTier = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Settings: Auto, Full or Smooth. A choice clears the session's step-downs. */
export const setEffectsChoice = (choice: EffectsChoice) => {
  try {
    if (choice === "auto") storage()?.removeItem(CHOICE_KEY);
    else storage()?.setItem(CHOICE_KEY, choice);
  } catch {
    // It holds until the app is closed.
  }
  update({ choice, session: null });
};

/** One step lighter for the rest of the session (Auto only). */
export const stepDownForSession = (why: string) => {
  if (state.choice !== "auto" || state.tier === "minimal") return false;
  const next = stepDown(state.tier);
  update({ session: next });
  if (typeof console !== "undefined") console.info(`[leaflet] visual effects: ${next} (${why})`);
  return true;
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** A second or so of frames, a few seconds after start: a device that cannot keep up steps down. */
const startProbe = (delayMs = 2500, lengthMs = 1200) => {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") return;
  window.setTimeout(() => {
    if (state.choice !== "auto" || state.tier !== "full" || document.visibilityState === "hidden") return;
    const deltas: number[] = [];
    let last = 0;
    const started = now();
    const tick = (t: number) => {
      if (last) deltas.push(t - last);
      last = t;
      if (t - started < lengthMs) requestAnimationFrame(tick);
      else if (probeSaysSlow(deltas)) stepDownForSession("slow frames at start");
    };
    requestAnimationFrame(tick);
  }, delayMs);
};

/**
 * Watches frames only while something moves (a scroll anywhere, a finger or a pressed
 * pointer moving): no frame loop at rest.
 */
const startWatchdog = () => {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") return;
  const watch = new FrameWatch();
  let frame = 0;
  let last = 0;
  let movedAt = 0;
  const tick = (t: number) => {
    frame = 0;
    if (last && document.visibilityState !== "hidden" && watch.add(t - last)) stepDownForSession("slow frames while moving");
    last = t;
    if (now() - movedAt < 250 && state.choice === "auto" && state.tier !== "minimal") frame = requestAnimationFrame(tick);
    else last = 0;
  };
  const moved = () => {
    movedAt = now();
    if (!frame && state.choice === "auto" && state.tier !== "minimal") frame = requestAnimationFrame(tick);
  };
  const pointer = (event: PointerEvent) => {
    if (event.pointerType === "touch" || event.buttons !== 0) moved();
  };
  document.addEventListener("scroll", moved, { capture: true, passive: true });
  window.addEventListener("pointermove", pointer, { passive: true });
  onTier(() => watch.reset());
};

let installed = false;
/** Called once, from `main.tsx`, before anything draws glass. */
export const installPerfTier = () => {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const judged = judgeDevice();
  update({ choice: readChoice(), auto: judged.tier, renderer: judged.renderer });
  apply();
  startProbe();
  startWatchdog();
  (window as Window & { __leafletPerf?: () => State }).__leafletPerf = () => ({ ...state });
};

/** The tier drawn, kept as it changes. */
export const usePerfTier = (): PerfTier => useSyncExternalStore(onTier, currentTier, () => "full");
/** The reader's choice, kept as it changes. */
export const useEffectsChoice = (): EffectsChoice => useSyncExternalStore(onTier, currentChoice, () => "auto");
