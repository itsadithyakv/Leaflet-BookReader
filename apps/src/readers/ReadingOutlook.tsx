import { describeMinutes, describeMinutesShort } from "./timeLeft";
import "./readingOutlook.css";

export type Outlook = {
  /** How far through the book, 0 to 1; null until it is known. */
  progress: number | null;
  /** Minutes left in the chapter and in the book, rounded (readers/timeLeft.ts); null with no pace to go on. */
  chapter: number | null;
  book: number | null;
};

export const outlookSentence = (outlook: Outlook) => {
  const parts: string[] = [];
  if (outlook.progress !== null) {
    parts.push(`${Math.round(outlook.progress * 100)}% through the book`);
  }
  if (outlook.chapter !== null) {
    parts.push(`${describeMinutes(outlook.chapter)} left in the chapter`);
  }
  if (outlook.book !== null) {
    parts.push(`${describeMinutes(outlook.book)} left in the book`);
  }
  return parts.join(" · ");
};

/**
 * Where the reader is and how much is left, in the chapter dock: the
 * percentage always, the time left when the dock is under the pointer, has
 * focus, or was opened with the percentage (which is a button, so a finger or
 * the keyboard can ask too).
 */
export const ReadingOutlook = ({ outlook, open, onToggle }: { outlook: Outlook; open: boolean; onToggle: () => void }) => {
  if (outlook.progress === null) {
    return null;
  }
  const timed = outlook.chapter !== null || outlook.book !== null;
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
        {Math.round(outlook.progress * 100)}%
      </button>
      {timed && (
        <span className="reader-outlook-time reader-muted" aria-hidden="true">
          <span className="reader-outlook-long">
            {[
              outlook.chapter !== null ? `${describeMinutes(outlook.chapter)} left in the chapter` : null,
              outlook.book !== null ? `${describeMinutes(outlook.book)} left in the book` : null
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
