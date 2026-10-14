/**
 * Finding one of the reader's own books to post about, by typing. A library
 * is hundreds of books, where a drop-down of every title (as the post dialog
 * had) is a long scroll for the one wanted (the owner, 2026-10-14: "Let me
 * search up a book").
 */

export type BookChoice = { title: string; author: string | null };

/** At most this many are listed at once: typing more narrows it. */
export const SHOWN_MOST = 8;

/** Lower case, without accents, and with anything that is not a letter or a figure as a space: "Brontë's" finds "brontes". */
const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The books that match what is typed, best first, as indexes into `choices`
 * (which come most recently read first). Every word typed must be in the
 * title or the author. A title that starts with it comes first, then one
 * with a word that does, then the rest; within each, as recently read as
 * `choices` has them. Nothing typed: the most recent.
 */
export const findBooks = (choices: readonly BookChoice[], query: string, most = SHOWN_MOST): number[] => {
  const words = plain(query).split(" ").filter(Boolean);
  if (words.length === 0) {
    return choices.slice(0, most).map((_, index) => index);
  }
  const typed = words.join(" ");
  const ranked: Array<{ index: number; rank: number }> = [];
  choices.forEach((choice, index) => {
    const title = plain(choice.title);
    const all = `${title} ${plain(choice.author ?? "")}`;
    if (!words.every((word) => all.includes(word))) {
      return;
    }
    const rank = title.startsWith(typed) ? 0 : ` ${all}`.includes(` ${words[0]}`) ? 1 : 2;
    ranked.push({ index, rank });
  });
  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, most)
    .map((entry) => entry.index);
};
