/**
 * The strongholds' record (raids rethought, 2026-10-24: the Magpie Lands): the best stars each stronghold has been
 * taken with, and which have been scouted. Index = the stronghold's number on the ladder (0 is the first).
 *
 * A stronghold taken before this was kept (a camp saved by 1.5.12 or older) has no stars here: 0 below `camps` reads
 * as "taken, stars unknown", shown as taken without stars, and filled in when it is replayed.
 *
 * Kept twice, as the meadow's fields are (`fondness.ts`, `md:`): as a field of the camp, and as a short line of
 * `taught` (`rd:`), which every build keeps whatever it holds. Both only ever go up (a best is a best, and a
 * stronghold once scouted stays scouted), so reading takes the best of the two, and two devices' camps merged
 * (`merge_camp`, src-tauri/src/sync/merge.rs, which reads and writes this same mark) keep the best of each.
 *
 * The mark: two strongholds to a character, each 0 to 7 (its stars, plus 4 once scouted), in a 64-letter alphabet,
 * the zeros at the end left off. A line of `taught` is 80 characters at most, so the record runs over up to four
 * lines, `rd:`, `rd1:`, `rd2:` and `rd3:`, 152 strongholds each; past 608 it is kept in the field alone.
 *
 * Plain functions of plain numbers: no import of the rules at run time.
 */

export type Strongholds = {
  /** Best stars by stronghold, 0 to 3 (0: not taken, or taken before stars were kept). */
  stars: number[];
  /** The strongholds scouted, by number, smallest first. */
  scouted: number[];
};

export const RAIDS_MARK = "rd:";
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
/** Characters after the longest prefix (`rd3:`), so that a line stays within 80. */
const PAGE_CHARS = 76;
const PER_PAGE = PAGE_CHARS * 2;
const PAGES = 4;
/** How many strongholds the mark can carry. */
export const MARKED_MOST = PER_PAGE * PAGES;
/** How many the field keeps (far more than a reader takes). */
export const KEPT_MOST = 2000;

const prefixOf = (page: number) => (page === 0 ? RAIDS_MARK : `rd${page}:`);
/** Whether a line of `taught` is part of this mark. */
export const isRaidsMark = (entry: string) => /^rd[0-3]?:/.test(entry);

export const noStrongholds = (): Strongholds => ({ stars: [], scouted: [] });

const starOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(3, Math.floor(value))) : 0);
const indexOf = (value: unknown, most: number) => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < most ? value : null);

/** A record put right: stars 0 to 3 with no zeros at the end, scouted each once and in order. */
export const cleanStrongholds = (raw: unknown): Strongholds => {
  const from = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const stars = (Array.isArray(from.stars) ? from.stars : []).slice(0, KEPT_MOST).map(starOf);
  while (stars.length > 0 && stars[stars.length - 1] === 0) stars.pop();
  const scouted = [...new Set((Array.isArray(from.scouted) ? from.scouted : []).map((entry) => indexOf(entry, KEPT_MOST)).filter((entry): entry is number => entry !== null))].sort((a, b) => a - b);
  return { stars, scouted };
};

/** The best of two records: the more stars for each stronghold, and every one scouted in either. */
export const bestOf = (a: Strongholds, b: Strongholds): Strongholds =>
  cleanStrongholds({
    stars: Array.from({ length: Math.max(a.stars.length, b.stars.length) }, (_, n) => Math.max(a.stars[n] ?? 0, b.stars[n] ?? 0)),
    scouted: [...a.scouted, ...b.scouted]
  });

/** A stronghold's best stars (0 for none kept). */
export const starsOf = (record: Strongholds, n: number) => record.stars[n] ?? 0;
export const isScouted = (record: Strongholds, n: number) => record.scouted.includes(n);

/** A raid on a stronghold came out with so many stars: kept if it is its best. */
export const withStars = (record: Strongholds, n: number, stars: number): Strongholds => {
  if (!Number.isInteger(n) || n < 0 || n >= KEPT_MOST || starOf(stars) <= starsOf(record, n)) return record;
  const next = [...record.stars];
  while (next.length <= n) next.push(0);
  next[n] = starOf(stars);
  return { ...record, stars: next };
};

/** A stronghold has been scouted (step 3's scout view): it stays so. */
export const withScouted = (record: Strongholds, n: number): Strongholds =>
  !Number.isInteger(n) || n < 0 || n >= KEPT_MOST || record.scouted.includes(n) ? record : { ...record, scouted: [...record.scouted, n].sort((a, b) => a - b) };

/** The record as lines of `taught`: none at all for an empty one. */
export const raidsMark = (record: Strongholds): string[] => {
  const scouted = new Set(record.scouted);
  const one = (n: number) => starOf(record.stars[n]) + (scouted.has(n) ? 4 : 0);
  const lines: string[] = [];
  for (let page = 0; page < PAGES; page++) {
    let body = "";
    for (let k = 0; k < PAGE_CHARS; k++) {
      const n = page * PER_PAGE + k * 2;
      body += ALPHABET[one(n) + one(n + 1) * 8];
    }
    body = body.replace(/0+$/, "");
    if (body) lines.push(`${prefixOf(page)}${body}`);
  }
  return lines;
};

/** The record read back from `taught`; null where there is no mark. A character it does not know reads as nothing. */
export const readRaidsMark = (taught: readonly string[]): Strongholds | null => {
  const stars: number[] = [];
  const scouted: number[] = [];
  let found = false;
  for (let page = 0; page < PAGES; page++) {
    const prefix = prefixOf(page);
    const entry = taught.find((name) => name.startsWith(prefix));
    if (!entry) continue;
    found = true;
    const body = entry.slice(prefix.length, prefix.length + PAGE_CHARS);
    for (let k = 0; k < body.length; k++) {
      const value = Math.max(0, ALPHABET.indexOf(body[k]));
      [value % 8, Math.floor(value / 8)].forEach((part, half) => {
        const n = page * PER_PAGE + k * 2 + half;
        if (part % 4 > 0) {
          while (stars.length < n) stars.push(0);
          stars[n] = part % 4;
        }
        if (part >= 4) scouted.push(n);
      });
    }
  }
  return found ? cleanStrongholds({ stars, scouted }) : null;
};

/** The record as a kept camp has it: the field and the mark, the best of both. */
export const readStrongholds = (field: unknown, taught: readonly string[]): Strongholds => bestOf(cleanStrongholds(field), readRaidsMark(taught) ?? noStrongholds());
