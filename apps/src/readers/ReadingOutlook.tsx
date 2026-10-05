import { describeMinutes, describeMinutesShort } from "./timeLeft";
import "./readingOutlook.css";

export type Outlook = {
  /** How far through the book, 0 to 1; null until it is known. */
  progress: number | null;
  /** Minutes left in the chapter and in the book, rounded (readers/timeLeft.ts); null with no pace to go on. */
  chapter: number | null;
  book: number | null;
  /**
   * In a set of books (readers/innerBooks.ts): the book being read and how
   * far through it. `book` is then the time left in that book, which is what
   * "the book" means to someone reading one novel of four, and `set` the time
   * left in the whole file; `progress` stays the whole file's.
   */
  inner?: { label: string; progress: number } | null;
  set?: number | null;
};

const percent = (fraction: number) => Math.round(fraction * 100);

export const outlookSentence = (outlook: Outlook) => {
  const parts: string[] = [];
  if (outlook.inner) {
    parts.push(`${percent(outlook.inner.progress)}% through ${outlook.inner.label}`);
  }
  if (outlook.progress !== null) {
    parts.push(`${percent(outlook.progress)}% through the ${outlook.inner ? "set" : "book"}`);
  }
  if (outlook.chapter !== null) {
    parts.push(`${describeMinutes(outlook.chapter)} left in the chapter`);
  }
  if (outlook.book !== null) {
    parts.push(`${describeMinutes(outlook.book)} left in ${outlook.inner ? "this book" : "the book"}`);
  }
  if (outlook.inner && outlook.set !== null && outlook.set !== undefined) {
    parts.push(`${describeMinutes(outlook.set)} left in the set`);
  }
  return parts.join(" · ");
};

/**
 * Where the reader is and how much is left, in the chapter dock: the
 * percentage always, the time left when the dock is under the pointer, has
 * focus, or was opened with the percentage (which is a button, so a finger or
 * the keyboard can ask too). In a set of books the percentage is the book's
 * own, with the set's beside it.
 */
export const ReadingOutlook = ({ outlook, open, onToggle }: { outlook: Outlook; open: boolean; onToggle: () => void }) => {
  if (outlook.progress === null) {
    return null;
  }
  const timed = outlook.chapter !== null || outlook.book !== null;
  const inBook = outlook.inner ? "this book" : "the book";
  return (
    <>
      <button
        type="button"
        className="reader-outlook-percent reader-muted"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={outlookSentence(outlook)}
        title={outlookSentence(outlook)}
      >
        {outlook.inner ? (
          <>
            {percent(outlook.inner.progress)}%<span className="reader-outlook-set"> · set {percent(outlook.progress)}%</span>
          </>
        ) : (
          <>{percent(outlook.progress)}%</>
        )}
      </button>
      {timed && (
        <span className="reader-outlook-time reader-muted" aria-hidden="true">
          <span className="reader-outlook-long">
            {[
              outlook.chapter !== null ? `${describeMinutes(outlook.chapter)} left in the chapter` : null,
              outlook.book !== null ? `${describeMinutes(outlook.book)} left in ${inBook}` : null
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="reader-outlook-short">
            {[
              outlook.chapter !== null ? `${describeMinutesShort(outlook.chapter)} in chapter` : null,
              outlook.book !== null ? `${describeMinutesShort(outlook.book)} in book` : null
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      )}
    </>
  );
};
