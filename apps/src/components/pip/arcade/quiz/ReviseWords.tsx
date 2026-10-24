import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCloseWhenHidden } from "../../../../hooks/pageShown";
import { useBackLayer } from "../../../../platform/back";
import type { SavedWord } from "../../../../readers/words/rows";
import { wordService } from "../../../../services/wordService";
import { useEquippedPip } from "../../../../store/pipWardrobeStore";
import { backdropClose } from "../../../ui/backdrop";
import { UiIcon } from "../../../UiIcon";
import { MyWords } from "./MyWords";
import { WordQuiz } from "./WordQuiz";
import "./revise.css";

type ReviseWordsProps = {
  onClose: () => void;
  /** The words as they stand after a change (a round, a removal, an undo): the Library's key counts them again. */
  onWords?: (words: SavedWord[]) => void;
};

/**
 * "Revise words": the word quiz opened from the Library, without the walk
 * through the Attic Arcade. The same quiz and the same "My words" as in the
 * arcade (WordQuiz, MyWords), on the same pixel paper, over the Library; closed,
 * the Library is where it was (it is not left, only covered).
 *
 * Loaded on demand (pages/library/ReviseWordsKey.tsx): the quiz and Pip's
 * sprite are no part of the Library's start.
 */
export const ReviseWords = ({ onClose, onWords }: ReviseWordsProps) => {
  const look = useEquippedPip();
  const [page, setPage] = useState<"quiz" | "words">("quiz");
  const [words, setWords] = useState<SavedWord[] | null>(null);
  const onWordsRef = useRef(onWords);
  onWordsRef.current = onWords;
  const load = useCallback(() => {
    wordService.list().then(
      (list) => {
        setWords(list);
        onWordsRef.current?.(list);
      },
      () => setWords((now) => now ?? [])
    );
  }, []);
  useEffect(load, [load]);

  // Android's Back: from My words to the quiz, then out. The Library hidden (another tab), it closes, as its sheets do.
  useBackLayer(true, () => (page === "words" ? setPage("quiz") : onClose()));
  useCloseWhenHidden(onClose);

  // Focus into it, and back where it came from (the Library's key) on close.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  const toQuiz = () => {
    setPage("quiz");
    dialogRef.current?.focus();
  };

  return createPortal(
    <div className="pip-arcade-backdrop pip-revise-backdrop" role="presentation" {...backdropClose(onClose)}>
      <div
        ref={dialogRef}
        className="pip-arcade pip-revise modal-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pip-revise-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (page === "words") toQuiz();
            else onClose();
          }
        }}
      >
        <div className="pip-arcade-page">
          <div className="pip-arcade-head flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Word Quiz</p>
              <h2 id="pip-revise-title" className="page-title text-2xl text-on-surface">
                {page === "quiz" ? "Revise words" : "My words"}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {page === "words" && (
                <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={toQuiz}>
                  Quiz
                </button>
              )}
              <button type="button" className="tactile-button flex items-center gap-1 px-3 py-1.5 text-xs" onClick={onClose}>
                <UiIcon name="close" size={13} />
                Close
              </button>
            </div>
          </div>
          {page === "quiz" ? (
            <WordQuiz words={words} onChanged={load} onMyWords={() => setPage("words")} skin={look.skin} outfit={look.outfit} />
          ) : (
            <MyWords words={words} onChanged={load} onOpened={onClose} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
