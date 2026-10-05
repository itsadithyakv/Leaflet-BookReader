/**
 * Pip's nods to books (./bookNods.ts), fetched when one is first looked up.
 *
 * The table is some ninety kilobytes of titles, writers and lines, and a nod
 * plays only when a book is opened or Pip has an idle moment with one on the
 * go, so it does not load with the app (as the scenes themselves do not:
 * core.js, `loadBookScenes`). Whoever needs to look a book up asks for the
 * table here: `loadNods()` and wait, or `nodsNow()` and do without until it
 * has come.
 */
type Nods = typeof import("./bookNods");

let table: Nods | null = null;
let fetching: Promise<Nods> | null = null;

/** The table, fetched once however many ask. A fetch that failed is tried again by the next to ask. */
export const loadNods = (): Promise<Nods> =>
  (fetching ??= import("./bookNods").then(
    (module) => (table = module),
    (cause: unknown) => {
      fetching = null;
      throw cause;
    }
  ));

/** The table if it is here; null until it has been fetched. For a caller that cannot wait (Pip's idle time). */
export const nodsNow = (): Nods | null => table;
