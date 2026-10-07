/**
 * "Where was I?": what a reader coming back to a book after some days is
 * shown, worked out from the book and their own marks. No summary is written
 * (there is no language model in the app): the last lines they read, the
 * names those pages were about, their latest highlight.
 *
 * Pure: text and dates in, text out.
 */

/** A book left this long is come back to, not carried on with. */
export const RECAP_AFTER_DAYS = 3;
/** Read less than this much of, there is nothing to be reminded of. */
export const RECAP_MIN_PROGRESS = 0.01;
/** As much of the book's words as the card shows. */
export const RECAP_LINES = 420;

const DAY = 86_400_000;

/**
 * How long a book has been left, in whole days; null when it has never been
 * opened or the date cannot be read.
 */
export const daysAway = (lastOpened: string | null | undefined, now: number): number | null => {
  const then = lastOpened ? Date.parse(lastOpened) : NaN;
  if (!Number.isFinite(then) || then > now) {
    return null;
  }
  return Math.floor((now - then) / DAY);
};

/** Whether a book being opened is one to be reminded of. */
export const worthRecap = (lastOpened: string | null | undefined, progress: number, now: number) => {
  const days = daysAway(lastOpened, now);
  return days !== null && days >= RECAP_AFTER_DAYS && progress >= RECAP_MIN_PROGRESS && progress < 0.995;
};

/** "3 days", "2 weeks", "5 months", "over a year": how long, as someone would say it. */
export const awayWords = (days: number): string => {
  if (days < 1) {
    return "today";
  }
  if (days === 1) {
    return "a day";
  }
  if (days < 14) {
    return `${days} days`;
  }
  if (days < 60) {
    return `${Math.round(days / 7)} weeks`;
  }
  if (days < 365) {
    return `${Math.round(days / 30)} months`;
  }
  return days < 550 ? "over a year" : `${Math.round(days / 365)} years`;
};

/**
 * The last lines read: the end of `text` (the book's words up to the
 * reader's place), from the start of a sentence, no more than `limit` long.
 * A paragraph that ends within them is kept as a break, so speech reads as
 * speech. Empty when there is nothing before the place.
 */
export const lastLines = (text: string, limit = RECAP_LINES): string[] => {
  const tail = text.replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").trimEnd();
  if (!tail.trim()) {
    return [];
  }
  let from = Math.max(0, tail.length - limit);
  if (from > 0) {
    // On from the next sentence, or failing one the next whole word.
    const rest = tail.slice(from);
    const sentence = /[.!?…]["”’)]*\s+(?=["“‘(]?\p{Lu})/u.exec(rest);
    const paragraph = rest.indexOf("\n");
    if (paragraph >= 0 && (!sentence || paragraph < sentence.index)) {
      from += paragraph + 1;
    } else if (sentence && sentence.index < rest.length * 0.6) {
      from += sentence.index + sentence[0].length;
    } else {
      from += rest.search(/\s/) + 1;
      return [`…${tail.slice(from)}`].flatMap((part) => part.split("\n")).filter((line) => line.trim());
    }
  }
  return tail
    .slice(from)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};
