/**
 * A PDF's printed page numbers.
 *
 * A book's pages are numbered as the book prints them: a cover and a few
 * unnumbered leaves, a preface in roman numerals, then 1 on the first page of
 * the text. A PDF can say so ("page labels"), and most made from a book do.
 * The page reader counted the file's pages instead, so the dock said "Page 20
 * of 321" on the page that has 6 printed on it, the printed contents page's
 * numbers led nowhere, and "go to page 6" went to the copyright page.
 *
 * With labels, the printed number is what is shown and what is typed; the
 * count of the file's pages stays beside it, since that is what "how far
 * through" is measured in. A PDF without labels, or whose labels only say 1,
 * 2, 3, is as it was. Pure, so the rules are tested without a PDF.
 */

/** One label a page (index 0 is page 1); "" where the page has none. */
export type PageLabels = readonly string[];

/**
 * A document's labels, if they are worth showing: one a page, and saying
 * something the page's place in the file does not. Null otherwise.
 */
export const usefulLabels = (labels: unknown, pageCount: number): string[] | null => {
  if (!Array.isArray(labels) || labels.length !== pageCount || pageCount <= 0) {
    return null;
  }
  const cleaned = labels.map((label) => (typeof label === "string" ? label.replace(/\s+/g, " ").trim().slice(0, 24) : ""));
  return cleaned.some((label, index) => label !== "" && label !== String(index + 1)) ? cleaned : null;
};

/** The number printed on a page (1-based), or null where it is no different from its place in the file. */
export const printedNumber = (labels: PageLabels | null | undefined, page: number): string | null => {
  const label = labels?.[page - 1];
  return label && label !== String(page) ? label : null;
};

/** A page as a list names it: its printed number, or its place in the file. */
export const pageName = (labels: PageLabels | null | undefined, page: number) => printedNumber(labels, page) ?? String(page);

/**
 * A page by name: "Page 6", "Page xiv", "Page A-3". A label that is a word
 * ("Cover", "title") is the page's name by itself: "Page Cover" is not said.
 */
export const pageTitle = (labels: PageLabels | null | undefined, page: number) => {
  const name = pageName(labels, page);
  return /\d/.test(name) || name.length <= 4 || /^[ivxlcdm]+$/i.test(name) ? `Page ${name}` : name;
};

/**
 * The dock's words for the page in view: "Page 6 (20 of 321)" where 6 is
 * printed on the twentieth page of the file, "Page 20 of 321" where the two
 * agree or the document has no labels.
 */
export const placeLabel = (page: number, pageCount: number, labels: PageLabels | null | undefined) =>
  printedNumber(labels, page) ? `${pageTitle(labels, page)} (${page} of ${pageCount})` : `Page ${page} of ${pageCount}`;

/**
 * What is typed into "go to page", as a page of the document (1-based), or
 * null when it is not one. In order:
 *
 * 1. `#20` is the twentieth page of the file, whatever is printed on it.
 * 2. `40%` goes that far through the document.
 * 3. A printed number ("6", "xiv", "A-3"), in either case, goes to the page
 *    that has it: the first, where two parts of a book both count from 1.
 *    So a plain number that is also printed on a page goes to that page.
 * 4. Any other plain number is a page of the file (past the last printed
 *    number, say), kept within the document.
 *
 * Without labels only 2 and 4 apply, as before, and `#20` is 20.
 */
export const parsePageEntry = (entry: string, pageCount: number, labels?: PageLabels | null): number | null => {
  const text = entry.replace(/\s+/g, " ").trim();
  if (pageCount <= 0 || text.length === 0) {
    return null;
  }
  const within = (page: number) => Math.min(pageCount, Math.max(1, page));
  const ofFile = /^#\s*(\d+)$/.exec(text);
  if (ofFile) {
    return within(Number(ofFile[1]));
  }
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(text);
  if (percent) {
    const share = Math.min(100, Number(percent[1])) / 100;
    return within(Math.round(share * (pageCount - 1)) + 1);
  }
  if (labels) {
    const wanted = text.toLowerCase();
    const index = labels.findIndex((label) => label !== "" && label.toLowerCase() === wanted);
    if (index >= 0) {
      return index + 1;
    }
  }
  return /^\d+$/.test(text) ? within(Number(text)) : null;
};

/**
 * What "go to page" opens holding: the page in view, written so that Enter
 * stays on it. Its printed number where that leads back here; `#` and its
 * place in the file where it has none, or shares one with an earlier page;
 * the plain number for a document without labels.
 */
export const entryFor = (page: number, pageCount: number, labels: PageLabels | null | undefined): string => {
  if (!labels) {
    return String(page);
  }
  const name = pageName(labels, page);
  return parsePageEntry(name, pageCount, labels) === page ? name : `#${page}`;
};

/** What the "go to page" field says it takes, for a screen reader and as its hint. */
export const goToHint = (pageCount: number, labels: PageLabels | null | undefined) => {
  if (!labels) {
    return `Go to page, 1 to ${pageCount}. Enter goes, Escape cancels`;
  }
  const printed = labels.filter((label) => label !== "");
  const span = printed.length > 1 ? ` (${printed[0]} to ${printed[printed.length - 1]})` : "";
  return `Go to page: a printed page number${span}, or # and a number for a page of the file, 1 to ${pageCount}. Enter goes, Escape cancels`;
};
