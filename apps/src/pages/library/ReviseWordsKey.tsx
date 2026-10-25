import { useEffect } from "react";
import { UiIcon } from "../../components/UiIcon";
import { usePageShown } from "../../hooks/pageShown";
import { dayNumber } from "../../pip/diary/seed";
import { useStartupSettled } from "../../platform/afterStartup";
import { useWordsSwitch } from "../../readers/words/wordPrefs";
import { getDateKey } from "../../services/habitService";
import { dueTotals } from "../../study/round";
import { loadCards, loadWords, openRevise, useStudyStore } from "../../study/studyStore";

/**
 * "Revise" on the Library: the word quiz and study cards one press away. Shown
 * while there is something to revise (words kept, with the switch in Settings
 * on, or cards); it says how many are due across both, and with none due it
 * stays, quietly, since a round can still be played. Desktop: a key in the
 * shelf's toolbar beside Highlights. A phone: an icon beside the highlights'
 * one, the count on it. The overlay itself opens where the app keeps it
 * (study/StudyOverlay.tsx), so a book's menu can open it too.
 *
 * What is kept is read once the start is over, and again each time the
 * Library is shown (it is kept while another tab is up: hooks/pageShown.ts),
 * which is when a book has been closed with new words or cards in it.
 */
export const ReviseWordsKey = ({ compact = false }: { compact?: boolean }) => {
  const [switchOn] = useWordsSwitch();
  const shown = usePageShown();
  const settled = useStartupSettled();
  const words = useStudyStore((state) => state.words);
  const cards = useStudyStore((state) => state.cards);

  useEffect(() => {
    if (!shown || !settled) {
      return;
    }
    if (switchOn) {
      void loadWords();
    }
    void loadCards();
  }, [shown, settled, switchOn]);

  const keptWords = switchOn ? (words ?? []) : [];
  const keptCards = cards ?? [];
  const showKey = keptWords.length > 0 || keptCards.length > 0;
  // Fewer than four words is no game yet: they are not said to be due (study/round.ts).
  const due = showKey ? dueTotals(keptWords, keptCards, dayNumber(getDateKey())).total : 0;
  const label = due > 0 ? `Revise: ${due} due` : "Revise";
  const tip = keptCards.length > 0 ? "Pip asks you your words and study cards" : "Pip asks you the words you looked up";

  if (!showKey) {
    return null;
  }
  return compact ? (
    <button type="button" className="key-button relative" onClick={() => openRevise()} aria-label={label} title={tip}>
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
      onClick={() => openRevise()}
      aria-label={label}
      title={tip}
    >
      <UiIcon name="dictionary" size={16} />
      Revise
      {due > 0 && <span className="tabular-nums text-on-surface-variant">· {due} due</span>}
    </button>
  );
};
