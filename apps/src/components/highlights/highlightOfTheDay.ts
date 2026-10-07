/**
 * One of the reader's own highlights, handed back once a day.
 *
 * Which one is settled by the date, so it is the same all day and on every
 * visit to the library, and another tomorrow. It prefers a passage marked a
 * week or more ago: the point is to meet again what has been forgotten, not
 * what was marked this morning. Chosen and kept on this device.
 */
const DISMISSED_KEY = "leaflet.dailyHighlight.dismissed";
/** A highlight younger than this is passed over while there is an older one. */
export const SETTLED_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The reader's own date, `YYYY-MM-DD`. */
export const dayKey = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** A number from some words, the same for the same words (FNV-1a). */
export const seedOf = (words: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < words.length; index += 1) {
    hash ^= words.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * The book the day's highlight comes from: one of those with any, each as
 * likely as it has highlights, so a book marked fifty times is not as rare as
 * one marked once. Null when there are none.
 */
export const pickBook = (counts: Record<string, number>, day: string): string | null => {
  // Sorted: the same book for the same day whatever order the counts arrived in.
  const books = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const total = books.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) {
    return null;
  }
  let at = seedOf(`book ${day}`) % total;
  for (const [id, count] of books) {
    if (at < count) {
      return id;
    }
    at -= count;
  }
  return books[books.length - 1][0];
};

type Marked = { id: string; text?: string | null; createdAt: string };

/** The day's highlight among one book's: an older one when there is one. */
export const pickHighlight = <T extends Marked>(highlights: T[], day: string, now: Date): T | null => {
  const worded = highlights.filter((item) => (item.text ?? "").trim().length > 0).sort((a, b) => a.id.localeCompare(b.id));
  const settled = worded.filter((item) => now.getTime() - new Date(item.createdAt).getTime() >= SETTLED_DAYS * DAY_MS);
  const from = settled.length > 0 ? settled : worded;
  return from.length > 0 ? from[seedOf(`highlight ${day}`) % from.length] : null;
};

/** Whether the reader has put today's away. */
export const dismissedOn = (day: string) => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === day;
  } catch {
    return false;
  }
};

export const dismiss = (day: string) => {
  try {
    localStorage.setItem(DISMISSED_KEY, day);
  } catch {
    // Put away for this visit, then.
  }
};
