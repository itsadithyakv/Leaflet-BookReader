/**
 * The contents of an EPUB 2 book, read from its NCX file by how the entries
 * are nested.
 *
 * epub.js files each entry under its `id` and finds an entry's parent by id.
 * Publishers repeat ids: a boxed set of four novels gave each novel's entry
 * the id of its own first child (its cover), so the child took the parent's
 * slot, every chapter after it was hung on an entry nothing pointed to, and
 * the chapter list lost two of the four novels (167 of 378 entries). Nesting
 * is what the file says; ids are only names.
 */

import type { TocItem } from "./readerTypes";

/** As much of an XML element as is read here (a DOM element is one). */
export type NcxElement = {
  nodeName: string;
  children: ArrayLike<NcxElement>;
  textContent: string | null;
  getAttribute: (name: string) => string | null;
};

/** An element's name without its namespace prefix ("ncx:navPoint" is "navPoint"). */
const nameOf = (element: NcxElement) => element.nodeName.split(":").pop() ?? "";

const childrenNamed = (element: NcxElement, name: string) => Array.from(element.children).filter((child) => nameOf(child) === name);

const itemOf = (point: NcxElement): TocItem | null => {
  const content = childrenNamed(point, "content")[0];
  const label = childrenNamed(point, "navLabel")[0];
  const href = content?.getAttribute("src") ?? "";
  if (!href) {
    return null;
  }
  return {
    id: point.getAttribute("id") ?? undefined,
    label: label?.textContent ?? "",
    href,
    subitems: itemsOf(point)
  };
};

const itemsOf = (parent: NcxElement): TocItem[] =>
  childrenNamed(parent, "navPoint")
    .map(itemOf)
    .filter((item): item is TocItem => item !== null);

const find = (element: NcxElement, name: string): NcxElement | null => {
  if (nameOf(element) === name) {
    return element;
  }
  for (const child of Array.from(element.children)) {
    const found = find(child, name);
    if (found) {
      return found;
    }
  }
  return null;
};

/** The contents tree of an NCX document (its root element, or the document's). Empty when it has no `navMap`. */
export const tocFromNcx = (root: NcxElement | null | undefined): TocItem[] => {
  const map = root ? find(root, "navMap") : null;
  return map ? itemsOf(map) : [];
};

/** How many entries a contents tree holds. An entry reached twice (a tree with a loop in it) is counted once. */
export const countToc = (items: readonly TocItem[]) => {
  const seen = new Set<TocItem>();
  const walk = (list: readonly TocItem[]) => {
    for (const item of list) {
      if (seen.has(item)) {
        continue;
      }
      seen.add(item);
      walk(item.subitems ?? []);
    }
  };
  walk(items);
  return seen.size;
};

/**
 * The tree to show: the one read by nesting when epub.js's has fewer entries
 * (it lost some to a repeated id), and epub.js's own otherwise, so a book it
 * reads correctly is shown exactly as before.
 */
export const fullerToc = (fromEpubjs: TocItem[], byNesting: TocItem[]) =>
  countToc(byNesting) > countToc(fromEpubjs) ? byNesting : fromEpubjs;
