import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PipSprite } from "../../../PipSprite";
import { UiIcon } from "../../../UiIcon";
import { openInBook } from "../../../highlights/highlightsStore";
import { dayNumber } from "../../../../pip/diary/seed";
import type { SavedWord } from "../../../../readers/words/rows";
import { getDateKey } from "../../../../services/habitService";
import { cardService } from "../../../../services/cardService";
import { wordService } from "../../../../services/wordService";
import { useLibraryStore } from "../../../../store/libraryStore";
import type { StudyCard } from "../../../../study/cards";
import type { PictureLoader } from "../../../../study/pictureSource";
import { buildStudyRound, cardsInScope, dueTotals, wordsInScope, type ReviseScope, type StudyItem } from "../../../../study/round";
import { answered } from "./boxes";
import { FillPassage, PictureFace } from "./CardFace";
import "./quiz.css";
import "./cards.css";

type CardQuizProps = {
  words: SavedWord[] | null;
  cards: StudyCard[] | null;
  scope: ReviseScope;
  /** Something was answered, removed or put back: the lists are asked for again. */
  onChanged: () => void;
  /** A card's place was opened in its book: Revise steps aside. */
  onOpened: () => void;
  /** The cards of the book in scope, to look through. */
  onBookCards?: (bookId: string) => void;
  loader: PictureLoader;
  skin: string;
  outfit: readonly string[];
};

type Round = { items: StudyItem<SavedWord>[]; at: number; shown: boolean; picked: number | null; right: number; last: boolean | null };
type Gone = { card: StudyCard; failed?: "remove" | "back" };

const UNDO_MS = 8000;

/** What Pip says. Lower case, short, and the drama is hers. */
const ASKS: Record<StudyCard["kind"], string[]> = {
  fill: ["fill in the gaps.", "what goes in there?", "you highlighted this. what's missing?"],
  ask: ["you wrote this one.", "go on then.", "your question, not mine."],
  pic: ["what's under the box?", "name it.", "i covered one. which is it?"]
};
const RIGHT = ["yes. that rests now.", "good. see you in a few days.", "knew it."];
const WRONG = ["back in the first box. no shame.", "we'll see that one again soon.", "tricky one. again tomorrow."];
const RIGHT_MOVES = ["cheer", "kudos", "goal"];
const WRONG_MOVES = ["nervous", "melt"];
const pick = <T,>(items: T[], seed: number) => items[Math.abs(seed) % items.length];

/**
 * A round of study cards (and of words, in "All"), on the word quiz's pixel
 * paper with Pip asking. A card shows its front; Reveal (Space) shows the
 * back; the reader says whether they had it, which moves it up a box or back
 * to the first (boxes.ts, the same rest days as words) and is saved as it
 * happens. A word is asked as the word quiz asks it, from four.
 *
 * Keys: Space or Enter reveals, then 1 missed it and 2 had it; for a word,
 * 1 to 4 and Enter.
 */
export const CardQuiz = ({ words, cards, scope, onChanged, onOpened, onBookCards, loader, skin, outfit }: CardQuizProps) => {
  const library = useLibraryStore((state) => state.books);
  const [round, setRound] = useState<Round | null>(null);
  const [done, setDone] = useState<{ right: number; of: number } | null>(null);
  const [gone, setGone] = useState<Gone | null>(null);
  const [hint, setHint] = useState(false);
  const plays = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const removing = useRef<Promise<unknown>>(Promise.resolve());
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const today = dayNumber(getDateKey());

  // A new choice of what to revise is a new start.
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    setRound(null);
    setDone(null);
  }, [scopeKey]);

  useEffect(() => {
    if (!gone || gone.failed) return undefined;
    const timer = window.setTimeout(() => setGone((now) => (now === gone ? null : now)), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [gone]);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, [round?.at, round?.shown, round === null]);

  if (words === null || cards === null) {
    return <p className="pip-quiz-note">Fetching your cards…</p>;
  }

  const inScope = cardsInScope(cards, scope);
  const wordsAsked = wordsInScope(words, scope);
  const totals = dueTotals(wordsAsked, inScope, today);
  const playable = inScope.length > 0 || wordsAsked.length > 0;

  const start = () => {
    plays.current += 1;
    const items = buildStudyRound(words, cards, scope, today, (Date.now() ^ (plays.current * 7919)) >>> 0);
    if (items.length === 0) return;
    setDone(null);
    setRound({ items, at: 0, shown: false, picked: null, right: 0, last: null });
  };

  const item = round ? round.items[round.at] : null;

  const next = (now: Round, right: boolean) => {
    const total = now.right + (right ? 1 : 0);
    if (now.at + 1 < now.items.length) {
      setRound({ ...now, at: now.at + 1, shown: false, picked: null, right: total, last: right });
      return;
    }
    setRound(null);
    setDone({ right: total, of: now.items.length });
    useLibraryStore.getState().requestBackup();
    changedRef.current();
  };

  /** A card answered: up a box or back to the first, saved now. */
  const grade = (right: boolean) => {
    if (!round || !item || item.type !== "card" || !round.shown) return;
    // A save that fails costs one answer's memory, not the round.
    void cardService.review([answered(item.card, right, today)]).catch(() => undefined);
    next(round, right);
  };

  /** A word's answer picked (it is saved as in the word quiz); Next goes on. */
  const choose = (index: number) => {
    if (!round || !item || item.type !== "word" || round.picked !== null) return;
    const right = index === item.question.answer;
    void wordService.review([answered(item.word, right, today)]).catch(() => undefined);
    setRound({ ...round, picked: index });
  };

  /** "Don't ask this again": the card goes (a tombstone, so from the other copies too), with Undo after. */
  const removeAsked = () => {
    if (!round || !item || item.type !== "card") return;
    const card = item.card;
    const rest = round.items.filter((_, index) => index !== round.at);
    if (round.at < rest.length) {
      setRound({ ...round, items: rest, shown: false, picked: null });
    } else {
      setRound(null);
      setDone(round.at > 0 ? { right: round.right, of: rest.length } : null);
    }
    setGone({ card });
    const removal = cardService.remove([card.id]);
    removing.current = removal.catch(() => undefined);
    removal.then(
      () => {
        useLibraryStore.getState().requestBackup();
        changedRef.current();
      },
      () => setGone({ card, failed: "remove" })
    );
  };
  const undo = (which: Gone) => {
    setGone(null);
    void removing.current
      .then(() => cardService.restore([which.card.id]))
      .then(
        () => {
          useLibraryStore.getState().requestBackup();
          changedRef.current();
        },
        () => setGone({ card: which.card, failed: "back" })
      );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!round || !item || event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.target as HTMLElement).closest("button") && (event.key === "Enter" || event.key === " ")) return;
    if (item.type === "card") {
      if (!round.shown && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        setRound({ ...round, shown: true });
      } else if (round.shown && (event.key === "1" || event.key === "2")) {
        event.preventDefault();
        grade(event.key === "2");
      }
      return;
    }
    const number = Number(event.key);
    if (round.picked === null && Number.isInteger(number) && number >= 1 && number <= item.question.options.length) {
      event.preventDefault();
      choose(number - 1);
    } else if (round.picked !== null && event.key === "Enter") {
      event.preventDefault();
      next(round, round.picked === item.question.answer);
    }
  };

  const goneNote = gone && (
    <div className="pip-quiz-gone" role="status" data-failed={gone.failed ? "" : undefined}>
      <span className="pip-quiz-gone-text">
        {gone.failed === "remove" ? "That card couldn't be removed." : gone.failed === "back" ? "That card couldn't be put back." : "Card removed"}
      </span>
      {gone.failed ? (
        <button type="button" className="pip-key pip-key-small pip-key-quiet" onClick={() => setGone(null)} aria-label="Dismiss">
          <UiIcon name="close" size={13} />
        </button>
      ) : (
        <button type="button" className="pip-key pip-key-small" onClick={() => undo(gone)} aria-label="Undo: put the card back">
          <UiIcon name="undo" size={13} />
          Undo
        </button>
      )}
    </div>
  );

  // ---- one card, or one word ------------------------------------------------------------------
  if (round && item) {
    const seed = plays.current * 31 + round.at;
    const answeredWord = item.type === "word" && round.picked !== null;
    const wordRight = item.type === "word" && round.picked === item.question.answer;
    const says =
      item.type === "word"
        ? answeredWord
          ? pick(wordRight ? RIGHT : WRONG, seed)
          : item.question.way === "meaning"
            ? "what does this one mean?"
            : "which word was that?"
        : round.last === null || round.shown
          ? pick(ASKS[item.card.kind], seed)
          : `${pick(round.last ? RIGHT : WRONG, seed)} ${pick(ASKS[item.card.kind], seed + 1)}`;
    const move = item.type === "word" ? (!answeredWord ? "pointup" : wordRight ? pick(RIGHT_MOVES, seed) : pick(WRONG_MOVES, seed)) : round.last === null ? "pointup" : round.last ? pick(RIGHT_MOVES, seed) : pick(WRONG_MOVES, seed);
    const bookId = item.type === "card" ? item.card.bookId : item.word.bookId;
    const book = library.find((entry) => entry.id === bookId);
    return (
      <div ref={rootRef} className="pip-quiz pip-card-round" tabIndex={-1} onKeyDown={onKeyDown}>
        <p className="pip-quiz-count">
          {scope.what === "all" ? "Revise" : "Cards"}: {round.at + 1} of {round.items.length}
          <span className="pip-quiz-marks" aria-hidden="true">
            {round.items.map((entry, index) => (
              <span key={(entry.type === "card" ? entry.card.id : entry.word.id) + index} data-at={index === round.at || undefined} data-done={index < round.at || undefined} />
            ))}
          </span>
        </p>
        <div className="pip-quiz-stage">
          <PipSprite move={move} size={96} skin={skin} outfit={outfit} playKey={`${plays.current}-${round.at}-${round.shown}-${round.picked}`} />
          <div className="pip-quiz-card pip-card" data-droppable={item.type === "card" ? "" : undefined}>
            <p className="pip-quiz-says">{says}</p>
            {item.type === "card" ? (
              <CardFront card={item.card} shown={round.shown} loader={loader} />
            ) : (
              <p className="pip-quiz-prompt" data-long={item.question.way === "word" || undefined}>
                {item.question.prompt}
              </p>
            )}
            {book && (
              <p className="pip-quiz-from">
                from {book.title}
                {item.type === "card" && item.card.at.chapter ? ` · ${item.card.at.chapter}` : ""}
              </p>
            )}
            {item.type === "card" && (
              <button type="button" className="pip-quiz-drop" onClick={removeAsked} aria-label="Remove this card" title="Remove this card (you can undo)">
                <UiIcon name="trash" size={15} />
              </button>
            )}
          </div>
        </div>

        {item.type === "word" && (
          <ol className="pip-quiz-options" aria-label={item.question.way === "meaning" ? `What does “${item.question.prompt}” mean?` : "Which word means this?"}>
            {item.question.options.map((option, index) => (
              <li key={option}>
                <button
                  type="button"
                  className="pip-quiz-option"
                  data-state={answeredWord ? (index === item.question.answer ? "right" : index === round.picked ? "wrong" : "other") : undefined}
                  aria-disabled={answeredWord || undefined}
                  onClick={() => choose(index)}
                >
                  <kbd aria-hidden="true">{index + 1}</kbd>
                  <span>{option}</span>
                  {answeredWord && index === item.question.answer && <UiIcon name="check" size={16} />}
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="pip-quiz-foot">
          {item.type === "card" ? (
            !round.shown ? (
              <>
                {book && item.card.at.cfi ? (
                  <button
                    type="button"
                    className="pip-key pip-key-small pip-key-quiet"
                    onClick={() => {
                      openInBook(item.card.bookId, item.card.at.cfi);
                      onOpened();
                    }}
                    disabled={book.available === false}
                    title="Open the place in the book this card was made from"
                  >
                    <UiIcon name="book-open" size={13} />
                    Open in book
                  </button>
                ) : (
                  <span />
                )}
                <button type="button" className="pip-key pip-key-primary" onClick={() => setRound({ ...round, shown: true })} title="Reveal (Space)">
                  <UiIcon name="preview" size={15} />
                  Reveal
                </button>
              </>
            ) : (
              <div className="pip-card-grades" role="group" aria-label="Did you have it?">
                <button type="button" className="pip-key pip-card-missed" onClick={() => grade(false)} title="Missed it (1): back to the first box">
                  <kbd aria-hidden="true">1</kbd>
                  Missed it
                </button>
                <button type="button" className="pip-key pip-key-primary" onClick={() => grade(true)} title="Had it (2): up a box, and it rests longer">
                  <kbd aria-hidden="true">2</kbd>
                  Had it
                </button>
              </div>
            )
          ) : (
            <>
              <p role="status" className="pip-quiz-result">
                {answeredWord ? (wordRight ? "Right." : `Not quite. It is: ${item.question.options[item.question.answer]}`) : ""}
              </p>
              {answeredWord && (
                <button type="button" className="pip-key pip-key-primary" onClick={() => next(round, wordRight)}>
                  {round.at + 1 < round.items.length ? "Next" : "Finish"}
                </button>
              )}
            </>
          )}
        </div>
        {goneNote}
      </div>
    );
  }

  // ---- between rounds ------------------------------------------------------------------------
  const due = scope.what === "all" ? totals.total : totals.cards;
  const oneBook = scope.what === "cards" && scope.bookId ? library.find((entry) => entry.id === scope.bookId) : null;
  const closing = done
    ? done.right === done.of
      ? "every one. go and read something."
      : done.right * 2 >= done.of
        ? "good round. those are settling in."
        : "a hard round. they'll come back first."
    : null;
  return (
    <div ref={rootRef} className="pip-quiz" tabIndex={-1}>
      <div className="pip-quiz-stage">
        <PipSprite move={done ? (done.right === done.of ? "champ" : done.right * 2 >= done.of ? "kudos" : "tea") : "idea"} size={96} skin={skin} outfit={outfit} playKey={plays.current} />
        <div className="pip-quiz-card">
          {done ? (
            <>
              <p className="pip-quiz-says">{closing}</p>
              <p className="pip-quiz-prompt" role="status">
                {done.right} of {done.of}
              </p>
            </>
          ) : playable ? (
            <>
              <p className="pip-quiz-says">{due > 0 ? "some of these are due. shall we?" : "nothing's due. we can go early."}</p>
              <p className="pip-quiz-prompt" data-long="">
                {due} due
                <span className="pip-card-of">
                  {" "}
                  of {scope.what === "all" ? inScope.length + wordsAsked.length : inScope.length}
                  {oneBook ? ` · ${oneBook.title}` : ""}
                </span>
              </p>
            </>
          ) : (
            <>
              <p className="pip-quiz-says">
                no cards yet.
                <button
                  type="button"
                  className="pip-card-hint"
                  onClick={() => setHint((open) => !open)}
                  aria-expanded={hint}
                  aria-label="How to make a card"
                  title="How to make a card"
                >
                  <UiIcon name="info" size={14} />
                </button>
              </p>
              {hint && <p className="pip-quiz-from">In a book, tap a highlight (or select words) and press Make a card. A picture can be made into cards from its viewer.</p>}
            </>
          )}
        </div>
      </div>
      <div className="pip-quiz-menu">
        <button type="button" className="pip-key pip-key-primary" onClick={start} disabled={!playable}>
          <UiIcon name="play" size={15} />
          {done ? "Another round" : "Start"}
        </button>
        {oneBook && onBookCards && (
          <button type="button" className="pip-key pip-key-quiet" onClick={() => onBookCards(oneBook.id)}>
            <UiIcon name="list" size={15} />
            This book's cards ({inScope.length})
          </button>
        )}
      </div>
      {goneNote}
    </div>
  );
};

/** The front of a card, and its back once shown. */
const CardFront = ({ card, shown, loader }: { card: StudyCard; shown: boolean; loader: PictureLoader }) => {
  if (card.kind === "fill") {
    return <FillPassage passage={card.passage} hidden={card.hidden} shown={shown} />;
  }
  if (card.kind === "ask") {
    return (
      <>
        <p className="pip-quiz-prompt" data-long="">
          {card.question}
        </p>
        {shown && <p className="pip-card-answer">{card.answer}</p>}
      </>
    );
  }
  return <PictureFace card={card} loader={loader} shown={shown} />;
};
