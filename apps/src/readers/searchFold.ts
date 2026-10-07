/**
 * Search that does not need the accents typed.
 *
 * epub.js's own `find` lowers the case and nothing else, so "Piraha" found
 * nothing in a book that says "Pirahã" 1,231 times, "facade" missed
 * "façade", and "naive" missed "naïve". The words typed are matched against
 * the text with its marks taken off; typed WITH a mark, they are matched as
 * typed ("résumé" does not find "resume").
 */

const MARK = /\p{M}/u;

/** Whether the words carry an accent or another mark of their own. */
export const hasMarks = (text: string) => text.normalize("NFD") !== text.normalize("NFC") || MARK.test(text);

/**
 * A text lowered and with its marks taken off, and where each of its
 * characters came from: `from[i]` is the place in the original of the
 * character at `i`, and `from[length]` the original's length. (Taking a mark
 * off can shorten the text, and lowering one or two letters lengthens it.)
 */
export const foldText = (text: string, keepMarks = false): { text: string; from: number[] } => {
  const from: number[] = [];
  let folded = "";
  for (let index = 0; index < text.length; ) {
    const code = text.codePointAt(index) ?? 0;
    const size = code > 0xffff ? 2 : 1;
    // A typed apostrophe finds a curly one, as in the library's search
    // (src-tauri/src/search.rs), which sends the reader here to find a match
    // again. One character for one, so the places hold.
    let piece = text.slice(index, index + size).toLowerCase().replace(/[‘’‚‛ʼ]/g, "'").replace(/[“”„‟]/g, '"');
    if (!keepMarks) {
      piece = piece.normalize("NFD").replace(/\p{M}/gu, "");
    }
    for (let at = 0; at < piece.length; at += 1) {
      from.push(index);
    }
    folded += piece;
    index += size;
  }
  from.push(text.length);
  return { text: folded, from };
};

/** Where the words are found in a text: `[start, end)` in the text as it is written. */
export const findFolded = (text: string, query: string): Array<[number, number]> => {
  const marks = hasMarks(query);
  const wanted = foldText(query, marks).text;
  const found: Array<[number, number]> = [];
  if (!wanted) {
    return found;
  }
  const folded = foldText(text, marks);
  let at = folded.text.indexOf(wanted);
  while (at !== -1) {
    const start = folded.from[at];
    // To the end of the last character matched, marks and all ("Piraha" covers "Pirahã" whole).
    let end = folded.from[at + wanted.length];
    while (end < text.length && MARK.test(text[end])) {
      end += 1;
    }
    found.push([start, end]);
    at = folded.text.indexOf(wanted, at + 1);
  }
  return found;
};

// epub.js has no types for these internals.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** A match's words with what stands round them, as epub.js gives them. */
const EXCERPT = 150;

/**
 * The matches in a section that has been loaded: epub.js's `find`, but
 * through `findFolded`. Falls back to epub.js's own when the section's
 * document cannot be walked.
 */
export const findInSection = (section: any, query: string): Array<{ cfi: string; excerpt: string }> => {
  const doc: Document | undefined = section?.document;
  const root = doc?.body ?? doc?.documentElement;
  if (!doc || !root || typeof section.cfiFromRange !== "function") {
    return section?.find?.(query) ?? [];
  }
  const matches: Array<{ cfi: string; excerpt: string }> = [];
  const walker = doc.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node as Text).data;
    if (!text.trim()) {
      continue;
    }
    for (const [start, end] of findFolded(text, query)) {
      try {
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const excerpt = text.length < EXCERPT ? text : `...${text.substring(start - EXCERPT / 2, start + EXCERPT / 2)}...`;
        matches.push({ cfi: section.cfiFromRange(range), excerpt });
      } catch {
        // A place that cannot be written down is passed over.
      }
    }
  }
  return matches;
};
