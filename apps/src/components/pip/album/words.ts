import {
  MIN_FIND_MINUTES,
  RARITY_NAME,
  minutesToReach,
  nearestPlaceFor,
  timesText,
  type AlbumEntry,
  type Found,
  type Rarity,
  type RarityTally
} from "../../../pip/expedition";
import { shortDate } from "../../shelf/rows";

/**
 * The album's sentences. Pure, so what the panel says and what a screen
 * reader is told can be tested without drawing either.
 */

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "A smooth stone": a find's name as a heading. */
export const titleOf = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** The book a find was made with: the library's title for it, else the session's own, else none. */
export const bookOf = (found: Found, bookTitles?: ReadonlyMap<string, string>) =>
  (found.bookId && bookTitles?.get(found.bookId)) || found.title || null;

/** "12 Sep 2026", in the reader's own day; nothing for a time that cannot be read. */
export const dayOf = (stamp: string) => {
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? "" : shortDate(at, true);
};

/** "First found 12 Sep 2026, in a 30-minute session with Mistborn. She got as far as the hills." */
export const firstFoundText = (found: Found, bookTitles?: ReadonlyMap<string, string>) => {
  const day = dayOf(found.at);
  const book = bookOf(found, bookTitles);
  const minutes = Math.max(1, Math.round(found.minutes));
  return `First found${day ? ` ${day}` : ""}, in a ${minutes}-minute session${book ? ` with ${book}` : ""}. She got as far as ${found.place.name}.`;
};

/** "Found 3 times." */
export const countText = (count: number) => (count === 1 ? "Found once." : `Found ${count} times.`);

/** Where a rarity turns up, for a thing not found yet. */
export const whereText = (rarity: Rarity) => {
  const place = nearestPlaceFor(rarity);
  const minutes = minutesToReach(place);
  return minutes <= MIN_FIND_MINUTES
    ? `${RARITY_NAME[rarity]} things turn up on any trip of ${MIN_FIND_MINUTES} minutes or more.`
    : `${RARITY_NAME[rarity]} things are found from ${place.name} on: a session of ${minutes} minutes or more, read to the end. The longer she is out, the likelier.`;
};

/** What a thing's key says to a screen reader. */
export const entryLabel = (entry: AlbumEntry) => {
  const rarity = RARITY_NAME[entry.find.rarity].toLowerCase();
  if (entry.count === 0 || !entry.first) {
    return `Not found yet, ${rarity}`;
  }
  const day = dayOf(entry.first.at);
  return [titleOf(entry.find.name), rarity, entry.count > 1 ? `found ${entry.count} times` : "found once", day ? `first on ${day}` : ""]
    .filter(Boolean)
    .join(", ");
};

/** "9 of 14" and what is left, for a rarity's heading. */
export const tallyText = (tally: RarityTally) =>
  tally.left === 0 ? `All ${tally.total} found` : `${tally.found} of ${tally.total} · ${tally.left} to find`;

/** "Pip found: a smooth stone", and the small print under it, for the end of a session. */
export const broughtBackText = (found: Found, count: number) => ({
  headline: `Pip found: ${found.find.name}`,
  detail: `${RARITY_NAME[found.find.rarity]} · as far as ${found.place.name} · ${
    count <= 1 ? "new in her album" : `her ${ordinal(count)} (${timesText(count)})`
  }`
});

/** Said kindly when a session was too short for her to find anything. */
export const NOTHING_FOUND = `Pip wasn't out long enough to find anything this time. ${MIN_FIND_MINUTES} minutes of reading and she comes back with something.`;

export const ordinal = (count: number) => {
  const tens = count % 100;
  if (tens >= 11 && tens <= 13) return `${count}th`;
  return `${count}${["th", "st", "nd", "rd"][count % 10] ?? "th"}`;
};

export { plural };
