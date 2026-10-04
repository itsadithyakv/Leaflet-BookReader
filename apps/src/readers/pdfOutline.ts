/**
 * A PDF's own table of contents (its "outline"), made ready for the sidebar.
 *
 * pdf.js hands the outline over as a tree whose entries point at
 * destinations, not pages: a destination is either a name to look up or an
 * array whose first member is a reference to a page object (or, rarely, a
 * page index). Here the tree is flattened into the rows the sidebar shows and
 * each destination is turned into a page number. The two lookups are passed
 * in, so the rules can be tested without a PDF.
 */

/** An outline entry as pdf.js gives it; only what is read here. */
export type OutlineNode = {
  title?: string | null;
  dest?: string | unknown[] | null;
  items?: OutlineNode[] | null;
};

/** One row of the contents list. `page` is 1-based; `depth` is 0 for a top entry. */
export type OutlineEntry = { title: string; page: number; depth: number };

export type OutlineLookups = {
  /** A named destination's array, or null when the name is unknown. */
  getDestination: (name: string) => Promise<unknown[] | null>;
  /** The 0-based index of the page a reference points at. */
  getPageIndex: (ref: { num: number; gen: number }) => Promise<number>;
};

type FlatNode = { title: string; dest: string | unknown[]; depth: number };

/** No outline is this long; a file that claims to be is cut short rather than followed. */
const MAX_ENTRIES = 5000;
const MAX_DEPTH = 12;
/** How many destinations are looked up at once. */
const BATCH = 24;

const cleanTitle = (title: unknown) =>
  typeof title === "string"
    ? title
        // Control characters turn up in titles copied out of old files.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";

/**
 * The outline tree as rows in reading order, each with its depth. An entry
 * with nowhere to go (a link to a web page, a bare heading) is left out; its
 * children are kept.
 */
export const flattenOutline = (nodes: OutlineNode[] | null | undefined): FlatNode[] => {
  const rows: FlatNode[] = [];
  const walk = (list: OutlineNode[], depth: number) => {
    for (const node of list) {
      if (rows.length >= MAX_ENTRIES) {
        return;
      }
      const dest = node?.dest;
      if (typeof dest === "string" ? dest.length > 0 : Array.isArray(dest) && dest.length > 0) {
        rows.push({ title: cleanTitle(node.title) || "Untitled", dest: dest as string | unknown[], depth });
      }
      if (Array.isArray(node?.items) && node.items.length > 0 && depth + 1 < MAX_DEPTH) {
        walk(node.items, depth + 1);
      }
    }
  };
  if (Array.isArray(nodes)) {
    walk(nodes, 0);
  }
  return rows;
};

const isRef = (value: unknown): value is { num: number; gen: number } =>
  typeof value === "object" &&
  value !== null &&
  Number.isInteger((value as { num?: unknown }).num) &&
  Number.isInteger((value as { gen?: unknown }).gen);

/**
 * Flattens an outline and finds each entry's page. Entries whose destination
 * cannot be found, or points outside the document, are skipped. `stillWanted`
 * is asked between batches: when the reader has closed the book the rest of
 * the lookups are not made, and null is returned.
 */
export const resolveOutline = async (
  nodes: OutlineNode[] | null | undefined,
  lookups: OutlineLookups,
  pageCount: number,
  stillWanted: () => boolean = () => true
): Promise<OutlineEntry[] | null> => {
  const rows = flattenOutline(nodes);
  // Chapters' sections often share a page: one lookup serves them all.
  const pages = new Map<string, Promise<number | null>>();

  const pageOf = async (dest: string | unknown[]): Promise<number | null> => {
    try {
      const target = typeof dest === "string" ? await lookups.getDestination(dest) : dest;
      const first = Array.isArray(target) ? target[0] : null;
      let index: number | null = null;
      if (isRef(first)) {
        const key = `${first.num}R${first.gen}`;
        let known = pages.get(key);
        if (!known) {
          known = lookups.getPageIndex(first).then(
            (found) => found,
            () => null
          );
          pages.set(key, known);
        }
        index = await known;
      } else if (Number.isInteger(first)) {
        index = first as number;
      }
      return index !== null && Number.isInteger(index) && index >= 0 && index < pageCount ? index + 1 : null;
    } catch {
      return null;
    }
  };

  const entries: OutlineEntry[] = [];
  for (let at = 0; at < rows.length; at += BATCH) {
    if (!stillWanted()) {
      return null;
    }
    const batch = rows.slice(at, at + BATCH);
    const found = await Promise.all(batch.map((row) => pageOf(row.dest)));
    batch.forEach((row, index) => {
      const page = found[index];
      if (page !== null) {
        entries.push({ title: row.title, page, depth: row.depth });
      }
    });
  }
  return stillWanted() ? entries : null;
};

/**
 * Which entry the page in view belongs to: the one that starts nearest before
 * it (or on it). Where several start on the same page, the last of them, which
 * is the most specific (a chapter and its first section share a page). -1
 * before the first entry.
 */
export const currentOutlineIndex = (entries: OutlineEntry[], page: number) => {
  let best = -1;
  let bestPage = -1;
  entries.forEach((entry, index) => {
    if (entry.page <= page && entry.page >= bestPage) {
      best = index;
      bestPage = entry.page;
    }
  });
  return best;
};
