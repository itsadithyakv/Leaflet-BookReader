/**
 * What a book's genres put Pip in the mood for.
 *
 * `books.genres` is free-form: whatever the file's metadata, an enrichment or
 * the reader typed ("Horror", "horror fiction", "Detective and mystery
 * stories", "Epic fantasy"). This reads those strings and says which of a few
 * moods the book is, or none. Pure, so the list can be held to its word
 * (genre.test.ts).
 */

/** A book that sets Pip off: under the quilt, on a trail, off on a quest, at the stars, sighing. */
export type GenreMood = "horror" | "mystery" | "fantasy" | "scifi" | "romance";

/** In the order they win when one genre string says two things ("gothic mystery" is the horror). */
const SAYS: ReadonlyArray<[GenreMood, RegExp]> = [
  ["horror", /\bhorror|\bgothic|\bghost|\bhaunt|\bvampir|\bzombie|\boccult|\bmacabre/],
  ["mystery", /\bmyster|\bdetective|\bcrime\b|\bwhodun|\bnoir\b|\bsleuth/],
  ["fantasy", /\bfantas|\bfairy ?tale|\bsword|\bsorcer|\bdragon|\bwizard/],
  ["scifi", /\bscience[ -]fiction|\bsci[ -]?fi\b|\bspace opera|\bcyberpunk|\bdystopi|\btime travel/],
  ["romance", /\bromance\b|\blove stor|\bromantic (comed|fiction|suspense)/]
];
/** Said less surely: a thriller is the horror mood only when nothing above claims the book. */
const HINTS: ReadonlyArray<[GenreMood, RegExp]> = [["horror", /\bthrill|\bsuspense/]];

const firstSaid = (genres: readonly string[], table: ReadonlyArray<[GenreMood, RegExp]>): GenreMood | null => {
  // The genre listed first speaks first: "Fantasy, Romance" is a fantasy.
  for (const genre of genres) {
    const text = genre.toLowerCase();
    for (const [mood, pattern] of table) if (pattern.test(text)) return mood;
  }
  return null;
};

/** The mood a book's genres put her in, or null for a book that is none of them. */
export const genreMood = (genres: readonly unknown[] | null | undefined): GenreMood | null => {
  const named = (genres ?? []).filter((genre): genre is string => typeof genre === "string" && genre.trim().length > 0);
  return firstSaid(named, SAYS) ?? firstSaid(named, HINTS);
};
