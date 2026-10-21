/**
 * Which of the system's insets (platform/device.ts) to lay the page out by while the screen turns.
 *
 * The Android side sends the insets as they change (MainActivity.kt `watchInsets`), but not with the window: after
 * a turn the WebView has its new size a moment (100 to 300 ms on a phone, more under load) before the insets for
 * it arrive. Coming back upright from Pip, the library was laid out upright with the insets of a phone on its side
 * (the notch at the left, a short status bar at the top), its header 24 px short, and jumped when the right ones
 * came. So the insets are kept with the way the window was when they were laid out (`memory.byAspect`) and:
 *
 *   - a window upright never takes insets with a side in them (a notch or the buttons at a side are a phone on
 *     its side): it keeps the upright ones it had, or, never having had any, the sideways ones turned upright;
 *   - a window on its side does not take the upright ones it had before the turn, still the latest sent, when it
 *     has had sideways ones before;
 *   - the insets are `settled` once ones sent after the turn have come, or ones that are plainly this way up.
 */

export type InsetSides = { top: number; right: number; bottom: number; left: number; keyboard?: number };
export type InsetAspect = "portrait" | "landscape";

export type InsetMemory = {
  /** The last insets sent, and when (a clock or a count: only the order matters). */
  latest: InsetSides | null;
  latestAt: number;
  /** The way the window was last seen, and when that last changed. */
  aspect: InsetAspect | null;
  turnedAt: number;
  /** The insets last laid out each way up. */
  byAspect: Partial<Record<InsetAspect, InsetSides>>;
};

export const insetMemory = (): InsetMemory => ({ latest: null, latestAt: 0, aspect: null, turnedAt: 0, byAspect: {} });

/** A notch or the buttons at a side: a phone on its side (upright, both sides are 0). */
export const sidewaysInsets = (insets: InsetSides) => Math.max(insets.left, insets.right) >= 1;

const sameInsets = (a: InsetSides | undefined, b: InsetSides | undefined) =>
  Boolean(a && b) && a!.top === b!.top && a!.right === b!.right && a!.bottom === b!.bottom && a!.left === b!.left;

/** Sideways insets turned upright, for a first turn with none upright to go by: what was at a side is at the top. */
export const turnedUpright = (insets: InsetSides): InsetSides => ({
  top: Math.max(insets.top, insets.left, insets.right),
  right: 0,
  bottom: insets.bottom,
  left: 0,
  keyboard: insets.keyboard
});

/** The window is `aspect` (at `now`): noted, and when it turned. */
export const seeAspect = (memory: InsetMemory, aspect: InsetAspect | null, now: number) => {
  if (aspect === null || aspect === memory.aspect) return;
  if (memory.aspect !== null) memory.turnedAt = now;
  memory.aspect = aspect;
};

/** Insets sent by the Android side (at `now`). */
export const receiveInsets = (memory: InsetMemory, insets: InsetSides, now: number) => {
  memory.latest = { ...insets };
  memory.latestAt = now;
};

export type InsetChoice = { insets: InsetSides | null; settled: boolean };

/**
 * The insets to lay the page out by, the window being as `memory.aspect` says, and whether they are the ones for
 * it (or the best to be had until those come). Keeps what it lays out, each way up, for the next turn.
 */
export const chooseInsets = (memory: InsetMemory): InsetChoice => {
  const latest = memory.latest;
  const aspect = memory.aspect;
  if (!latest || !aspect) return { insets: latest, settled: true };
  const keyboard = latest.keyboard;
  if (aspect === "portrait" && sidewaysInsets(latest)) {
    // A phone on its side's insets, sent before the turn (or not yet sent again after it).
    const kept = memory.byAspect.portrait;
    return { insets: kept ? { ...kept, keyboard } : turnedUpright(latest), settled: false };
  }
  const fresh = memory.latestAt > memory.turnedAt;
  if (aspect === "landscape" && !fresh && !sidewaysInsets(latest) && memory.byAspect.landscape && sameInsets(latest, memory.byAspect.portrait)) {
    // The upright insets from before the turn, and this phone has had other ones on its side.
    return { insets: { ...memory.byAspect.landscape, keyboard }, settled: false };
  }
  const settled = fresh || (aspect === "landscape" && sidewaysInsets(latest)) || sameInsets(latest, memory.byAspect[aspect]);
  if (settled) memory.byAspect[aspect] = { ...latest };
  return { insets: latest, settled };
};
