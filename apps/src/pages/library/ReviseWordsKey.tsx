import { Suspense, lazy, useEffect, useState } from "react";
import { UiIcon } from "../../components/UiIcon";
import { dueCount } from "../../components/pip/arcade/quiz/boxes";
import { MIN_WORDS } from "../../components/pip/arcade/quiz/round";
import { usePageShown } from "../../hooks/pageShown";
import { dayNumber } from "../../pip/diary/seed";
import { useStartupSettled } from "../../platform/afterStartup";
import type { SavedWord } from "../../readers/words/rows";
import { useWordsSwitch } from "../../readers/words/wordPrefs";
import { getDateKey } from "../../services/habitService";
import { wordService } from "../../services/wordService";

// The quiz, Pip's sprite and their paper come only when the key is pressed: none of it is the Library's start.
const ReviseWords = lazy(() => import("../../components/pip/arcade/quiz/ReviseWords").then((module) => ({ default: module.ReviseWords })));

/**
 * "Revise words" on the Library: the word quiz one press away, where it used
 * to be only in the Attic Arcade. Shown while words are kept (the switch in
 * Settings) and there are some; it says how many are due, and with none due
 * it stays, quietly, since a round can still be played and My words is
 * behind it. Desktop: a key in the shelf's toolbar beside Highlights. A
 * phone: an icon beside the highlights' one, the count on it.
 *
 * The words are read once the start is over, and again each time the
 * Library is shown (it is kept while another tab is up: hooks/pageShown.ts),
 * which is when a book has been closed with new words in it.
 */
export const ReviseWordsKey = ({ compact = false }: { compact?: boolean }) => {
  const [switchOn] = useWordsSwitch();
  const shown = usePageShown();
  const settled = useStartupSettled();
  const [words, setWords] = useState<SavedWord[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!shown || !settled || !switchOn) {
      return undefined;
    }
    let live = true;
    wordService.list().then(
      (list) => live && setWords(list),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [shown, settled, switchOn]);

  const overlay = open && (
    <Suspense fallback={null}>
      <ReviseWords onClose={() => setOpen(false)} onWords={setWords} />
    </Suspense>
  );
  // The key and the quiz in the same places whether the key shows or not: open, the quiz stays as it is
  // though its last word was just removed in it.
  const showKey = switchOn && words !== null && words.length > 0;
  // Fewer than four is no game yet: nothing is said to be due.
  const due = showKey && words.length >= MIN_WORDS ? dueCount(words, dayNumber(getDateKey())) : 0;
  const label = due > 0 ? `Revise words: ${due} due` : "Revise words";
  const tip = "Pip asks you the words you looked up";

  return (
    <>
      {!showKey ? null : compact ? (
        <button type="button" className="key-button relative" onClick={() => setOpen(true)} aria-label={label} title={tip}>
          <UiIcon name="dictionary" size={18} />
          {due > 0 && (
            <span
              className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-on-primary ring-2 ring-surface"
              aria-hidden="true"
            >
              {due > 99 ? "99+" : due}
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          className="tactile-button flex items-center gap-2 px-3 py-2 text-xs font-semibold"
          onClick={() => setOpen(true)}
          aria-label={label}
          title={tip}
        >
          <UiIcon name="dictionary" size={16} />
          Revise words
          {due > 0 && <span className="tabular-nums text-on-surface-variant">· {due} due</span>}
        </button>
      )}
      {overlay}
    </>
  );
};
