/**
 * Finding known names in text: for marking them in a chapter, for telling who
 * a selection is, and for finding where someone was mentioned.
 *
 * Only names learned by the place being read are ever looked for: the list
 * comes from the cast as seen from that place (`castAt`), never from the
 * whole sheet.
 *
 * Pure: strings in, offsets out.
 */
import { nameKey, type CastView } from "./model";

export type NameEntry = {
  text: string;
  person: string;
  /** Matched as written (or in capitals), not in any case. */
  exact: boolean;
};

export type NameHit = { start: number; end: number; person: string };

/** Words before a name that are not the name ("Lord Renoux" is Renoux). */
const TITLES = new Set(
  "lord lady ser sir dame king queen prince princess duke duchess count countess baron baroness master mistress maester captain commander general colonel major sergeant lieutenant admiral doctor dr mr mrs ms miss mx father mother brother sister uncle aunt old young little big the of saint st".split(
    " "
  )
);

/** More names than this in one pattern is a cast no page could be marked with in time. */
const MAX_NAMES = 600;

const isWordChar = (char: string | undefined) => Boolean(char) && /[\p{L}\p{N}_]/u.test(char as string);
const hasCapital = (text: string) => /\p{Lu}/u.test(text);
/** Apostrophes the same, spaces single: a name as it is compared. */
const plain = (text: string) => text.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\s+/g, " ").trim();

/**
 * The names to look for at this place: each person's names as learned so far,
 * and their given name on its own ("Sansa" for "Sansa Stark", "Renoux" for
 * "Lord Renoux") when no one else met so far shares it.
 */
export const namesOf = (cast: CastView): NameEntry[] => {
  const names: NameEntry[] = [];
  const taken = new Set<string>();
  for (const person of cast.people) {
    for (const name of person.names) {
      const key = nameKey(plain(name.text));
      if (key && !taken.has(key)) {
        taken.add(key);
        // A capital in it says it is a name: "Hound" is not every hound.
        names.push({ text: plain(name.text), person: person.id, exact: name.exact || hasCapital(name.text) });
      }
    }
  }
  const given = new Map<string, { text: string; person: string; count: number }>();
  for (const person of cast.people) {
    const seen = new Set<string>();
    for (const name of person.names) {
      const parts = plain(name.text).split(" ");
      const first = parts.find((part) => !TITLES.has(part.toLowerCase().replace(/\.$/, "")));
      if (parts.length < 2 || !first || first.length < 3 || !hasCapital(first) || !/^[\p{L}'-]+$/u.test(first)) {
        continue;
      }
      const key = nameKey(first);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const entry = given.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        given.set(key, { text: first, person: person.id, count: 1 });
      }
    }
  }
  for (const [key, entry] of given) {
    if (entry.count === 1 && !taken.has(key)) {
      taken.add(key);
      names.push({ text: entry.text, person: entry.person, exact: true });
    }
  }
  return names;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A function that finds the names in a text. Whole words only; where two
 * names start at one place the longer wins ("Jon Snow" over "Jon"); a name
 * written with a capital is matched as written or all in capitals (a chapter's
 * opening words), one written small in any case.
 */
export const nameMatcher = (names: NameEntry[]): ((text: string, limit?: number) => NameHit[]) => {
  const byKey = new Map<string, NameEntry>();
  for (const name of names.slice(0, MAX_NAMES)) {
    const key = nameKey(plain(name.text));
    if (key && !byKey.has(key)) {
      byKey.set(key, { ...name, text: plain(name.text) });
    }
  }
  if (byKey.size === 0) {
    return () => [];
  }
  const alternatives = [...byKey.values()]
    .sort((a, b) => b.text.length - a.text.length)
    .map((name) => escape(name.text).replace(/ /g, "\\s+").replace(/'/g, "['\u2018\u2019\u02bc]"));
  // The word must end where the name does; if it does not, a shorter name
  // starting at the same place gets its turn ("Jon" in "Jon Snowfall").
  const pattern = new RegExp(`(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])`, "giu");

  return (text, limit = Infinity) => {
    const hits: NameHit[] = [];
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while (hits.length < limit && (match = pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const found = plain(match[0]);
      const name = byKey.get(nameKey(found));
      const whole = !isWordChar(text[start - 1]);
      const cased = name && (!name.exact || found === name.text || found === name.text.toUpperCase());
      if (name && whole && cased) {
        hits.push({ start, end, person: name.person });
      } else {
        // Not this one: look again from the next letter, where a shorter name may start.
        pattern.lastIndex = start + 1;
      }
    }
    return hits;
  };
};

/** A selection as a name: quotes, brackets and a possessive's tail taken off. */
export const cleanName = (text: string) =>
  plain(text)
    .replace(/^[\s"'\u201c\u201d\u2018([{<\u2014\u2013-]+/u, "")
    .replace(/[\s"\u201c\u201d\u2019)\]}>.,;:!?\u2014\u2013-]+$/u, "")
    .replace(/'s$/i, "")
    .replace(/[\s"'.,;:!?]+$/u, "")
    .trim();

/**
 * Who a selection is, among the people met so far: the one person named in
 * it ("Sansa", "Lady Sansa's"). Null when it names no one, or two people.
 */
export const whoIs = (names: NameEntry[], selection: string): string | null => {
  const text = cleanName(selection);
  if (!text || text.length > 80) {
    return null;
  }
  const people = new Set(nameMatcher(names)(text, 8).map((hit) => hit.person));
  return people.size === 1 ? [...people][0] : null;
};
