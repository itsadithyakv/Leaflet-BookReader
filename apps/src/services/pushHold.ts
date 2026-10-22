/**
 * While a book is open, highlights and notes wait to go up.
 *
 * Every sync that has news sends the whole sync document to the account, and
 * a reader who marks twenty lines in a sitting used to send it twenty times:
 * the largest part of what the free server takes in (docs/sync-audit.md, C1).
 * So, while a book is open, a highlight, a note, a character note or a word
 * kept does not start a sync of its own. What it changed goes up when the
 * book is closed, when the app goes out of sight, or five minutes after the
 * first change waited, whichever comes first. Closing and hiding are never
 * held: they are when a phone may stop the app.
 *
 * Nothing waits anywhere but here: every change is in the database before it
 * asks for a sync. An app stopped while something waits loses nothing; the
 * next run (at the next launch) sends it.
 */

/** The longest a change waits while a book is open. */
export const HOLD_LONGEST_MS = 5 * 60_000;

type Timer = ReturnType<typeof setTimeout>;

let reading = false;
let waitingSince: number | null = null;
let deadline: Timer | null = null;

const stopDeadline = () => {
  if (deadline !== null) {
    clearTimeout(deadline);
    deadline = null;
  }
};

export const pushHold = {
  /** A book was opened (`true`) or closed. Closing lets whatever waits go (the caller syncs). */
  setReading(open: boolean) {
    reading = open;
    if (!open) {
      pushHold.carried();
    }
  },

  isReading: () => reading,

  /**
   * A change that may wait while a book is open. True when it waits (the
   * caller starts no sync); false when no book is open and it goes now.
   * `flush` is what runs if five minutes pass first.
   */
  hold(flush: () => void, now = Date.now()): boolean {
    if (!reading) {
      return false;
    }
    if (waitingSince === null) {
      waitingSince = now;
      // From the first change that waited, not the latest: at the latest.
      deadline = setTimeout(() => {
        pushHold.carried();
        flush();
      }, HOLD_LONGEST_MS);
    }
    return true;
  },

  /** Whether something changed is waiting to go up. */
  waiting: () => waitingSince !== null,

  /** When the first change still waiting was made (null: none waits). */
  waitingSince: () => waitingSince,

  /** A sync has started: it carries whatever waited, so nothing waits now. */
  carried() {
    waitingSince = null;
    stopDeadline();
  },

  /** For tests: back to no book open and nothing waiting. */
  reset() {
    reading = false;
    pushHold.carried();
  }
};
