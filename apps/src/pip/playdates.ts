/**
 * What Pip did with a visiting friend's Pip, day by day, for her diary ("played
 * ball with @maya's Pip"): kept on this device only, like the day's visits
 * (`useVisitors.ts`), never sent anywhere, and gone with Delete All Data and
 * at sign-out. A few months of it at most.
 *
 * The parsing and the adding are pure; `recordPlaydate` and `readPlaydates`
 * are the part with storage in it.
 */
import type { TogetherKind } from "./visitors";

/** One thing done together: the reader's day (`YYYY-MM-DD`), the friend's handle, and what. */
export type Playdate = { day: string; handle: string; kind: TogetherKind };

export const PLAYDATES_KEY = "leaflet.pip.playdates";
/** The most kept: the newest go on, the oldest go. */
export const PLAYDATES_KEPT = 120;

const KINDS: readonly TogetherKind[] = ["highfive", "dance", "ball", "chase"];

/** A stored list, read tolerantly: anything unexpected is dropped. */
export const parsePlaydates = (raw: unknown): Playdate[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is Playdate =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as Playdate).day === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test((entry as Playdate).day) &&
      typeof (entry as Playdate).handle === "string" &&
      (entry as Playdate).handle.length > 0 &&
      KINDS.includes((entry as Playdate).kind)
  );
};

/** The list with this one added: once a day for each friend and each thing, the newest last, at most `PLAYDATES_KEPT`. */
export const withPlaydate = (list: readonly Playdate[], next: Playdate): Playdate[] => {
  const kept = list.filter((entry) => !(entry.day === next.day && entry.handle === next.handle && entry.kind === next.kind));
  return [...kept, next].slice(-PLAYDATES_KEPT);
};

export const readPlaydates = (): Playdate[] => {
  try {
    const raw = localStorage.getItem(PLAYDATES_KEY);
    return parsePlaydates(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
};

export const recordPlaydate = (entry: Playdate) => {
  try {
    localStorage.setItem(PLAYDATES_KEY, JSON.stringify(withPlaydate(readPlaydates(), entry)));
  } catch {
    // Not kept: the diary simply does not mention it.
  }
};

export const forgetPlaydates = () => {
  try {
    localStorage.removeItem(PLAYDATES_KEY);
  } catch {
    // Nothing kept.
  }
};
