import type { LargeBook } from "@shared/sync/types";
import type { ConfirmRequest } from "../components/ConfirmDialog";

/**
 * The question asked before a large book's file is backed up.
 *
 * A backup sends a file over 10 MB only with the reader's word (the rule is
 * `sync::large` in the backend, which also keeps the answers). When a backup
 * has held files back, the app asks once about the ones not yet answered
 * (hooks/useLargeBookPrompt.ts); a "no" can be taken back from the book's
 * own menu. Pure: the words only.
 */

/** A file's size as a reader says it: "43 MB", "1.2 GB". */
export const sizeText = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1).replace(/\.0$/, "")} GB`;
  }
  return `${Math.max(1, Math.round(mb))} MB`;
};

const EITHER_WAY = "Your place, notes and highlights are backed up either way, and the file can be added later from the book's ⋯ menu.";

/** How many of the waiting books the question names before "and N more". */
const NAMED = 2;

/** The yes/no question for the books waiting, largest first as the backend lists them. */
export const largeBookQuestion = (waiting: LargeBook[]): ConfirmRequest => {
  if (waiting.length === 1) {
    const [book] = waiting;
    return {
      title: `Back up “${book.title}”?`,
      body: `Its file is ${sizeText(book.bytes)}. ${EITHER_WAY}`,
      confirmLabel: "Back up the file",
      cancelLabel: "Not this one"
    };
  }
  const total = waiting.reduce((sum, book) => sum + book.bytes, 0);
  const named = waiting.slice(0, NAMED).map((book) => `${book.title} (${sizeText(book.bytes)})`);
  const more = waiting.length - named.length;
  const list = more > 0 ? `${named.join(", ")} and ${more} more` : named.join(" and ");
  return {
    title: `Back up ${waiting.length} large books?`,
    body: `${list}: ${sizeText(total)} in all. ${EITHER_WAY.replace("the file can", "a file can")}`,
    confirmLabel: "Back them up",
    cancelLabel: "Not these"
  };
};
