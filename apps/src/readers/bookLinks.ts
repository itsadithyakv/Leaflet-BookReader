/**
 * Links inside a book. A chapter's links are written relative to its own
 * file ("../Text/notes.xhtml#n3", "#fn1"); the reader names sections relative
 * to the package file, as epub.js's spine does.
 */

export type BookLink = {
  /** The file, relative to the package: what the spine knows a section by. */
  path: string;
  /** The element aimed at inside it, without the "#"; empty for the file as a whole. */
  id: string;
  /** Both, as one target to go to. */
  href: string;
};

/** Whether a link leaves the book: it names a scheme (https:, mailto:, tel:). */
export const isOutsideLink = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href.trim());

const decoded = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    // A stray "%": the raw form is all there is.
    return value;
  }
};

/**
 * Where a link in a section leads, or null for one that leaves the book or
 * cannot be read. `sectionHref` is the section the link is in.
 */
export const resolveBookLink = (href: string, sectionHref: string): BookLink | null => {
  const raw = href.trim();
  if (!raw || isOutsideLink(raw)) {
    return null;
  }
  try {
    const root = "http://book.invalid/";
    const url = new URL(raw, new URL(sectionHref.split("#")[0], root));
    if (url.origin !== new URL(root).origin) {
      return null;
    }
    const path = decoded(url.pathname.replace(/^\//, ""));
    const id = decoded(url.hash.replace(/^#/, ""));
    if (!path) {
      return null;
    }
    return { path, id, href: id ? `${path}#${id}` : path };
  } catch {
    return null;
  }
};
