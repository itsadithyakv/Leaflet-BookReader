/**
 * What the page measures for Pip (the header, the rail, the tab bar, the dock,
 * the logo, the cards she can land on), kept for a moment.
 *
 * Measured on every frame of a throw, each measurement made the browser bring
 * its layout up to date, and one made after Pip's transform was written laid
 * the page out again. None of them moves while she flies, so each is kept for
 * `ttlMs` and asked again after; a scroll or a resize forgets them all at once
 * (PipWorld wires that up), since then they have moved.
 */
export type LayoutCache = {
  /** The value kept under `key`, or `read()` (kept from now) when there is none or it is too old. */
  get: <T>(key: string, read: () => T) => T;
  /** Forgets everything kept (a scroll, a resize). */
  forget: () => void;
  /** Forgets one thing kept. */
  drop: (key: string) => void;
};

export const layoutCache = (ttlMs: number, now: () => number = () => performance.now()): LayoutCache => {
  const kept = new Map<string, { at: number; value: unknown }>();
  return {
    get<T>(key: string, read: () => T): T {
      const time = now();
      const found = kept.get(key);
      if (found && time - found.at < ttlMs && time >= found.at) {
        return found.value as T;
      }
      const value = read();
      kept.set(key, { at: time, value });
      return value;
    },
    forget() {
      kept.clear();
    },
    drop(key: string) {
      kept.delete(key);
    }
  };
};

/**
 * Writes a style only when it would change it. A write of the same value is
 * not free: the element is still marked for a style recalculation, and Pip's
 * loop places her four times a second at rest, every frame in the air.
 */
const written = new WeakMap<object, Map<string, string>>();
/**
 * (Compared with what was last written here, not with what the style reads back: the browser
 * writes a value back its own way, `0` as `0px`, so the two would never match.)
 */
export const setStyle = (element: { style: Pick<CSSStyleDeclaration, "setProperty"> }, property: string, value: string) => {
  let last = written.get(element);
  if (!last) {
    last = new Map();
    written.set(element, last);
  }
  if (last.get(property) === value) {
    return false;
  }
  last.set(property, value);
  element.style.setProperty(property, value);
  return true;
};
/** Forgets what was written to an element (something else changed its style). */
export const forgetStyles = (element: object) => {
  written.delete(element);
};
