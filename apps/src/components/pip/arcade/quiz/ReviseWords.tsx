import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCloseWhenHidden } from "../../../../hooks/pageShown";
import { useBackLayer } from "../../../../platform/back";
import { dayNumber } from "../../../../pip/diary/seed";
import { getDateKey } from "../../../../services/habitService";
import { useEquippedPip } from "../../../../store/pipWardrobeStore";
import { useLibraryStore } from "../../../../store/libraryStore";
import { pictureLoader } from "../../../../study/pictureSource";
import { cardBooks, type ReviseScope } from "../../../../study/round";
import { loadCards, loadWords, useStudyStore, type StudyView } from "../../../../study/studyStore";
import { backdropClose } from "../../../ui/backdrop";
import { UiIcon } from "../../../UiIcon";
import { BookCards } from "./BookCards";
import { CardQuiz } from "./CardQuiz";
import { MyWords } from "./MyWords";
import { MIN_WORDS } from "./round";
import { WordQuiz } from "./WordQuiz";
import "./revise.css";
import "./cards.css";

type ReviseWordsProps = {
  /** Where it opens: a round to choose, or a book's cards. */
  view: StudyView;
  onClose: () => void;
};

type Page = { page: "revise"; scope: ReviseScope } | { page: "words" } | { page: "cards"; bookId: string; back: boolean };

/**
 * "Revise": the word quiz and study cards, over the Library (or wherever a
 * book's cards were asked for), on the Attic Arcade's pixel paper; closed,
 * what was under it is where it was. It chooses what to revise: all of it,
 * the words, or the cards of every book or one. The words alone are the
 * arcade's own quiz (WordQuiz, MyWords); cards, and all, are CardQuiz. A
 * book's cards (BookCards) can be looked through, edited and saved as a file.
 *
 * Loaded on demand (study/StudyOverlay.tsx): none of it, Pip's sprite or a
 * picture's pdf.js, is part of the Library's start.
 */
export const ReviseWords = ({ view, onClose }: ReviseWordsProps) => {
  const look = useEquippedPip();
  const words = useStudyStore((state) => state.words);
  const cards = useStudyStore((state) => state.cards);
  const library = useLibraryStore((state) => state.books);
  const [page, setPage] = useState<Page | null>(() =>
    view.page === "cards" ? { page: "cards", bookId: view.bookId, back: false } : view.scope ? { page: "revise", scope: view.scope } : null
  );
  // The pictures of a review (and pdf.js, for a PDF's) are let go of when Revise closes.
  const loader = useMemo(pictureLoader, []);
  useEffect(() => () => loader.close(), [loader]);

  const load = useCallback(() => {
    void loadWords();
    void loadCards();
  }, []);
  useEffect(load, [load]);

  // Opened without a choice, it starts on what there is: both, or the one there is.
  const ready = words !== null && cards !== null;
  useEffect(() => {
    if (page || !ready) return;
    const scope: ReviseScope = cards.length > 0 ? (words.length >= MIN_WORDS ? { what: "all" } : { what: "cards", bookId: null }) : { what: "words" };
    setPage({ page: "revise", scope });
  }, [page, ready]);

  const toRevise = (scope?: ReviseScope) => {
    setPage((now) => ({ page: "revise", scope: scope ?? (now?.page === "revise" ? now.scope : { what: "cards", bookId: null }) }));
    dialogRef.current?.focus();
  };
  const back = () => {
    if (page?.page === "words") toRevise({ what: "words" });
    else if (page?.page === "cards" && page.back) toRevise({ what: "cards", bookId: page.bookId });
    else onClose();
  };

  // Android's Back: from My words or a book's cards to the round, then out. Another tab up, it closes, as the Library's sheets do.
  useBackLayer(true, back);
  useCloseWhenHidden(onClose);

  // Focus into it, and back where it came from on close.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  const today = dayNumber(getDateKey());
  const books = useMemo(() => cardBooks(cards ?? [], today), [cards, today]);
  const titleOf = (bookId: string) => library.find((book) => book.id === bookId)?.title ?? "A book no longer in the library";
  const scope = page?.page === "revise" ? page.scope : null;
  const offers = { all: (cards?.length ?? 0) > 0 && (words?.length ?? 0) >= MIN_WORDS, words: (words?.length ?? 0) > 0, cards: (cards?.length ?? 0) > 0 };
  const choices = (["all", "words", "cards"] as const).filter((what) => offers[what]);

  const title = page?.page === "words" ? "My words" : page?.page === "cards" ? "Cards" : "Revise";

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
            back();
          }
        }}
      >
        <div className="pip-arcade-page">
          <div className="pip-arcade-head flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Study</p>
              <h2 id="pip-revise-title" className="page-title text-2xl text-on-surface">
                {title}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {page && page.page !== "revise" && (page.page === "words" || page.back) && (
                <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={back}>
                  Revise
                </button>
              )}
              <button type="button" className="tactile-button flex items-center gap-1 px-3 py-1.5 text-xs" onClick={onClose}>
                <UiIcon name="close" size={13} />
                Close
              </button>
            </div>
          </div>

          {scope && choices.length > 1 && (
            <div className="pip-revise-choose" role="group" aria-label="What to revise">
              <span className="pip-revise-what">
                {choices.map((what) => (
                  <button
                    key={what}
                    type="button"
                    className="pip-key pip-key-small"
                    aria-pressed={scope.what === what}
                    onClick={() => toRevise(what === "cards" ? { what, bookId: null } : { what })}
                  >
                    {what === "all" ? "All" : what === "words" ? "Words" : "Cards"}
                  </button>
                ))}
              </span>
              {scope.what === "cards" && books.length > 1 && (
                <select
                  className="pip-revise-book"
                  aria-label="Cards from"
                  value={scope.bookId ?? ""}
                  onChange={(event) => toRevise({ what: "cards", bookId: event.target.value || null })}
                >
                  <option value="">Every book</option>
                  {books.map((book) => (
                    <option key={book.bookId} value={book.bookId}>
                      {titleOf(book.bookId)} ({book.due} due)
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {!page ? (
            <p className="pip-quiz-note">Fetching…</p>
          ) : page.page === "words" ? (
            <MyWords words={words} onChanged={() => void loadWords()} onOpened={onClose} />
          ) : page.page === "cards" ? (
            <BookCards
              bookId={page.bookId}
              cards={cards}
              loader={loader}
              onChanged={() => void loadCards()}
              onRevise={(bookId) => toRevise({ what: "cards", bookId })}
              onOpened={onClose}
            />
          ) : page.scope.what === "words" ? (
            <WordQuiz words={words} onChanged={() => void loadWords()} onMyWords={() => setPage({ page: "words" })} skin={look.skin} outfit={look.outfit} />
          ) : (
            <CardQuiz
              words={words}
              cards={cards}
              scope={page.scope}
              loader={loader}
              onChanged={load}
              onOpened={onClose}
              onBookCards={(bookId) => setPage({ page: "cards", bookId, back: true })}
              skin={look.skin}
              outfit={look.outfit}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
