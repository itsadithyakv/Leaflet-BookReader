/**
 * Brightness and warmth without leaving the book (docs/android.md, "The
 * reader"). By finger, a swipe up or down that starts at the left edge of the
 * page sets the brightness, one at the right edge the warmth; a swipe across
 * from either edge still turns the page, and a swipe anywhere else is what it
 * was. In the Android app the brightness is the window's own (Brightness.kt),
 * and below the least the screen gives, a dark veil over the page goes on
 * dimming it; anywhere else the veil is all there is. The warmth is an amber
 * wash over the page, everywhere. Both are kept per device.
 *
 * This file is the arithmetic: where a swipe may start, when it is ours, and
 * what a level does. The state is in readingLightStore.ts, the gesture in
 * edgeLight.ts, and what is drawn in ReadingLight.tsx.
 */

export type LightKind = "brightness" | "warmth";

/** What is kept: the brightness (0 to 1, or null to follow the system) and the warmth (0 to 1). */
export type LightLevels = { brightness: number | null; warmth: number };

export const LIGHT_KEY = "leaflet.reader.light";
export const NO_LIGHT: LightLevels = { brightness: null, warmth: 0 };

/** Each edge strip is this share of the page's width. */
export const EDGE_SHARE = 0.12;
/** A page narrower than this has no strips (a sliver of a window). */
export const EDGE_MIN_PAGE_PX = 240;
/** The finger's first this-many pixels decide whether a swipe is ours. */
export const DECIDE_PX = 12;
/** Ours only when it runs this many times as far up or down as across. */
export const UPRIGHT_RATIO = 1.2;
/** A finger still for this long before moving is holding (a selection), not swiping. */
export const HOLD_MS = 450;
/** A swipe this share of the page's height goes from none to all. */
export const DRAG_SPAN = 0.55;
/** With the window's own brightness, the foot of the scale (below this) is the veil's. */
export const VEIL_SHARE = 0.2;
/** The darkest the veil goes. */
export const VEIL_MAX = 0.6;
/** The warmth at its strongest: the amber wash's opacity. */
export const WARM_MAX = 0.35;
/** The least window brightness asked of Android (Brightness.kt, `MIN`). */
export const SCREEN_MIN = 0.01;

export type Box = { left: number; top: number; width: number; height: number };

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
/** Levels move in whole percents, so the pill never shows a step it did not take. */
export const roundLevel = (value: number) => Math.round(clamp01(value) * 100) / 100;

const inside = (x: number, y: number, box: Box) => x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;

/**
 * Which strip a press at window point (x, y) began in: the left edge's
 * brightness, the right edge's warmth, or neither. Not in a box kept for
 * something else (the bookmark corner, the footer).
 */
export const edgeAt = (x: number, y: number, page: Box, keep: readonly Box[] = []): LightKind | null => {
  if (!(page.width >= EDGE_MIN_PAGE_PX) || !(page.height > 0) || !inside(x, y, page)) {
    return null;
  }
  if (keep.some((box) => box.width > 0 && box.height > 0 && inside(x, y, box))) {
    return null;
  }
  const strip = page.width * EDGE_SHARE;
  if (x < page.left + strip) {
    return "brightness";
  }
  if (x > page.left + page.width - strip) {
    return "warmth";
  }
  return null;
};

export type SwipeCall = "wait" | "light" | "other";

/**
 * Whether a finger that began in a strip is setting the light: not until it
 * has gone `DECIDE_PX`; then if it went up or down rather than across, and
 * did not rest first (a press and hold is the reader's selection).
 */
export const classifySwipe = (dx: number, dy: number, ms: number): SwipeCall => {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) {
    return ms >= HOLD_MS ? "other" : "wait";
  }
  if (ms >= HOLD_MS) {
    return "other";
  }
  return Math.abs(dy) >= Math.abs(dx) * UPRIGHT_RATIO ? "light" : "other";
};

/** The level a swipe has come to: up is more, `DRAG_SPAN` of the page's height the whole way. */
export const dragLevel = (start: number, dy: number, pageHeight: number) =>
  pageHeight > 0 ? roundLevel(start - dy / (pageHeight * DRAG_SPAN)) : roundLevel(start);

/**
 * What a brightness level does. With the window's own brightness (`screen`):
 * the top of the scale is the window's, from its least to full, and the foot
 * (below `VEIL_SHARE`) holds it at its least and darkens the veil instead.
 * Without one (a computer), the veil alone. Null follows the system: neither.
 */
export const brightnessOutput = (level: number | null, screen: boolean): { screen: number | null; veil: number } => {
  if (level === null) {
    return { screen: null, veil: 0 };
  }
  const at = clamp01(level);
  if (!screen) {
    return { screen: null, veil: round3(VEIL_MAX * (1 - at)) };
  }
  if (at >= VEIL_SHARE) {
    return { screen: round3(SCREEN_MIN + (1 - SCREEN_MIN) * ((at - VEIL_SHARE) / (1 - VEIL_SHARE))), veil: 0 };
  }
  return { screen: SCREEN_MIN, veil: round3(VEIL_MAX * ((VEIL_SHARE - at) / VEIL_SHARE)) };
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Where a first swipe starts while the brightness follows the system: the
 * phone's own setting on the scale (the window's share of it), or the top
 * where there is no window brightness to start from.
 */
export const levelFromSystem = (system: number | null | undefined, screen: boolean) => {
  if (!screen || typeof system !== "number" || !Number.isFinite(system)) {
    return 1;
  }
  return roundLevel(VEIL_SHARE + (1 - VEIL_SHARE) * ((Math.max(SCREEN_MIN, clamp01(system)) - SCREEN_MIN) / (1 - SCREEN_MIN)));
};

/** The amber wash's opacity for a warmth. */
export const warmOpacity = (warmth: number) => round3(WARM_MAX * clamp01(warmth));

/** A level as the pill shows it. */
export const percent = (level: number) => `${Math.round(clamp01(level) * 100)}%`;

/** The kept levels; anything unreadable is the default (the system's brightness, no warmth). */
export const parseLight = (raw: string | null): LightLevels => {
  if (!raw) {
    return NO_LIGHT;
  }
  try {
    const kept = JSON.parse(raw) as { brightness?: unknown; warmth?: unknown };
    const brightness = typeof kept.brightness === "number" && Number.isFinite(kept.brightness) ? roundLevel(kept.brightness) : null;
    const warmth = typeof kept.warmth === "number" && Number.isFinite(kept.warmth) ? roundLevel(kept.warmth) : 0;
    return { brightness, warmth };
  } catch {
    return NO_LIGHT;
  }
};

export const readLight = (): LightLevels => {
  try {
    return parseLight(localStorage.getItem(LIGHT_KEY));
  } catch {
    return NO_LIGHT;
  }
};

export const writeLight = (levels: LightLevels) => {
  try {
    if (levels.brightness === null && levels.warmth === 0) {
      localStorage.removeItem(LIGHT_KEY);
    } else {
      localStorage.setItem(LIGHT_KEY, JSON.stringify({ brightness: levels.brightness ?? "system", warmth: levels.warmth }));
    }
  } catch {
    // ignore
  }
};
