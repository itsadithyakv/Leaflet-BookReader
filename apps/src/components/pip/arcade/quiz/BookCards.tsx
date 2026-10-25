import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { UiIcon } from "../../../UiIcon";
import { openInBook } from "../../../highlights/highlightsStore";
import { dayNumber } from "../../../../pip/diary/seed";
import { MAX_BOX } from "../../../../readers/words/rows";
import { getDateKey } from "../../../../services/habitService";
import { cardService } from "../../../../services/cardService";
import { useLibraryStore } from "../../../../store/libraryStore";
import { MAX_LABEL, MAX_PASSAGE, MAX_QUESTION, askInput, fillInput, inputOf, pictureInput, type CardInput, type PictureCard, type StudyCard } from "../../../../study/cards";
import { saveCardsFile } from "../../../../study/cardFile";
import { cardsCsv, csvName } from "../../../../study/export";
import { isHidden, toggleWord, tokens, type Range } from "../../../../study/fillIn";
import { PictureMissing, type PictureLoader } from "../../../../study/pictureSource";
import { isDue } from "./boxes";
import { FillPassage, KIND_NAMES, PictureFace, cardSummary } from "./CardFace";
import "./quiz.css";
import "./cards.css";

const PictureCardMaker = lazy(() => import("../../../../study/PictureCardMaker").then((module) => ({ default: module.PictureCardMaker })));

type BookCardsProps = {
  bookId: string;
  cards: StudyCard[] | null;
  onChanged: () => void;
  onRevise: (bookId: string) => void;
  onOpened: () => void;
  loader: PictureLoader;
};

type Notice = { text: string; undo?: StudyCard[] };

const standing = (card: StudyCard, today: number) =>
  card.due === null ? "Not asked yet" : card.box >= MAX_BOX ? "Known" : `Box ${card.box + 1} of ${MAX_BOX + 1}${isDue(card, today) ? ", due" : ""}`;

/**
 * One book's cards: what each asks, how well it is known, and a way back to
 * its place. Each can be edited or removed (Undo puts it back as it was,
 * its box too); the book's cards can be revised alone, or saved as a CSV
 * file for another flashcard app.
 */
export const BookCards = ({ bookId, cards, onChanged, onRevise, onOpened, loader }: BookCardsProps) => {
  const book = useLibraryStore((state) => state.books.find((entry) => entry.id === bookId));
  const [editing, setEditing] = useState<string | null>(null);
  const [picturing, setPicturing] = useState<{ cards: PictureCard[]; src: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const today = dayNumber(getDateKey());
  const mine = useMemo(
    () => (cards ?? []).filter((card) => card.bookId === bookId).sort((a, b) => a.at.p - b.at.p || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    [cards, bookId]
  );
  const due = mine.filter((card) => isDue(card, today)).length;
  const title = book?.title ?? "A book no longer in the library";

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice((now) => (now === notice ? null : now)), notice.undo ? 8000 : 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const changed = () => {
    useLibraryStore.getState().requestBackup();
    onChanged();
  };

  const save = async (inputs: CardInput[], remove: string[] = []) => {
    await cardService.save(inputs);
    if (remove.length > 0) await cardService.remove(remove);
    setEditing(null);
    changed();
  };

  const remove = async (gone: StudyCard[]) => {
    try {
      await cardService.remove(gone.map((card) => card.id));
    } catch {
      setNotice({ text: "That card couldn't be removed." });
      return;
    }
    setEditing(null);
    changed();
    setNotice({ text: gone.length > 1 ? `${gone.length} cards removed` : "Card removed", undo: gone });
  };
  const putBack = async (back: StudyCard[]) => {
    setNotice(null);
    try {
      await cardService.restore(back.map((card) => card.id));
      changed();
    } catch {
      setNotice({ text: "That card couldn't be put back." });
    }
  };

  const exportCsv = async () => {
    try {
      const savedTo = await saveCardsFile(csvName(title), cardsCsv(mine, title));
      if (savedTo) setNotice({ text: "Cards saved as CSV" });
    } catch {
      setNotice({ text: "The cards couldn't be saved." });
    }
  };

  const editBoxes = async (card: PictureCard) => {
    const group = mine.filter((other): other is PictureCard => other.kind === "pic" && other.group === card.group);
    try {
      const picture = await loader.load(card.bookId, card.picture, null);
      setPicturing({ cards: group, src: picture.url });
    } catch (failure) {
      setNotice({ text: failure instanceof PictureMissing ? "The book isn't on this device." : "The picture couldn't be found in the book." });
    }
  };

  if (cards === null) {
    return <p className="pip-quiz-note">Fetching the cards…</p>;
  }

  return (
    <div className="pip-quiz">
      <div className="pip-cards-head">
        <p className="pip-cards-title">
          <strong>{title}</strong>
          <span>
            {mine.length} {mine.length === 1 ? "card" : "cards"} · {due} due
          </span>
        </p>
        <div className="pip-quiz-menu">
          <button type="button" className="pip-key pip-key-primary" onClick={() => onRevise(bookId)} disabled={mine.length === 0}>
            <UiIcon name="play" size={15} />
            Revise this book
          </button>
          <button type="button" className="pip-key pip-key-quiet" onClick={() => void exportCsv()} disabled={mine.length === 0} title="Save as a CSV file for Anki, Quizlet and other flashcard apps (picture cards as text)">
            <UiIcon name="upload" size={15} />
            Export CSV
          </button>
        </div>
      </div>

      {mine.length === 0 ? (
        <p className="pip-words-empty">No cards from this book.</p>
      ) : (
        <ul className="pip-words" aria-label={`Cards from ${title}: ${mine.length}`}>
          {mine.map((card) => (
            <li key={card.id} className="pip-word">
              <div className="pip-word-head">
                <span className="pip-word-part">{KIND_NAMES[card.kind]}</span>
                {card.at.chapter && <span className="pip-word-part">{card.at.chapter}</span>}
                <span className="pip-word-box">{standing(card, today)}</span>
              </div>
              {editing === card.id ? (
                <CardEditor card={card} onSave={(input) => save([input])} onCancel={() => setEditing(null)} onBoxes={card.kind === "pic" ? () => void editBoxes(card) : undefined} />
              ) : (
                <>
                  {card.kind === "pic" ? (
                    <div className="pip-card-thumb">
                      <PictureFace card={card} loader={loader} shown />
                    </div>
                  ) : (
                    <p className="pip-word-meaning">{cardSummary(card)}</p>
                  )}
                  {card.kind === "ask" && <p className="pip-word-where">{card.answer}</p>}
                  <div className="pip-word-keys">
                    <button type="button" className="pip-key pip-key-small" onClick={() => setEditing(card.id)} aria-label={`Edit: ${cardSummary(card)}`}>
                      <UiIcon name="edit" size={13} />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="pip-key pip-key-small pip-key-quiet"
                      disabled={!book || book.available === false || !card.at.cfi}
                      onClick={() => {
                        openInBook(card.bookId, card.at.cfi);
                        onOpened();
                      }}
                    >
                      <UiIcon name="book-open" size={13} />
                      Open in book
                    </button>
                    <button type="button" className="pip-key pip-key-small pip-key-quiet" onClick={() => void remove([card])} aria-label={`Remove: ${cardSummary(card)}`}>
                      <UiIcon name="trash" size={13} />
                      Remove
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <div className="pip-quiz-gone" role="status">
          <span className="pip-quiz-gone-text">{notice.text}</span>
          {notice.undo ? (
            <button type="button" className="pip-key pip-key-small" onClick={() => void putBack(notice.undo ?? [])} aria-label="Undo: put the card back">
              <UiIcon name="undo" size={13} />
              Undo
            </button>
          ) : null}
        </div>
      )}

      {picturing && (
        <Suspense fallback={null}>
          <PictureCardMaker
            src={picturing.src}
            alt=""
            picture={picturing.cards[0].picture}
            place={{ bookId, cfi: picturing.cards[0].at.cfi, chapter: picturing.cards[0].at.chapter, p: picturing.cards[0].at.p }}
            existing={picturing.cards}
            onSave={async (inputs, removed) => {
              await save(inputs, removed);
              setPicturing(null);
            }}
            onClose={() => setPicturing(null)}
          />
        </Suspense>
      )}
    </div>
  );
};

/** A card's own words, changed in place: the blanks of a passage, a question and its answer, what is under a box. */
const CardEditor = ({ card, onSave, onCancel, onBoxes }: { card: StudyCard; onSave: (input: CardInput) => Promise<void>; onCancel: () => void; onBoxes?: () => void }) => {
  const [hidden, setHidden] = useState<Range[]>(card.kind === "fill" ? card.hidden : []);
  const [question, setQuestion] = useState(card.kind === "ask" ? card.question : "");
  const [answer, setAnswer] = useState(card.kind === "ask" ? card.answer : "");
  const [label, setLabel] = useState(card.kind === "pic" ? card.label : "");
  const [failed, setFailed] = useState(false);
  const place = { bookId: card.bookId, cfi: card.at.cfi, chapter: card.at.chapter, p: card.at.p };

  const input = (): CardInput | null => {
    if (card.kind === "fill") return hidden.length > 0 ? fillInput(place, card.passage, hidden, card.highlightId, card.id) : null;
    if (card.kind === "ask") return question.trim() && answer.trim() ? askInput(place, question, answer, card.highlightId, card.id) : null;
    return pictureInput(place, card.picture, card.mask, label, card.group, card.crop, card.id);
  };
  const ready = input() !== null && JSON.stringify(input()) !== JSON.stringify(inputOf(card));

  return (
    <div
      className="pip-card-editor"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      {card.kind === "fill" && (
        <>
          <p className="pip-card-edit-words" aria-label="Words of the passage: press one to hide it or show it">
            {(() => {
              const words = tokens(card.passage);
              const out = [];
              let at = 0;
              for (const token of words) {
                if (token.start > at) out.push(<span key={`g${at}`}>{card.passage.slice(at, token.start)}</span>);
                out.push(
                  <button
                    key={token.start}
                    type="button"
                    className="pip-card-edit-word"
                    aria-pressed={isHidden(token, hidden)}
                    onClick={() => setHidden((now) => toggleWord(card.passage, now, token))}
                  >
                    {token.text}
                  </button>
                );
                at = token.end;
              }
              if (at < card.passage.length) out.push(<span key={`g${at}`}>{card.passage.slice(at)}</span>);
              return out;
            })()}
          </p>
          <FillPassage passage={card.passage} hidden={hidden} shown={false} />
        </>
      )}
      {card.kind === "ask" && (
        <>
          <label className="pip-card-edit-label">
            Question
            <textarea className="pip-card-edit-field" rows={2} maxLength={MAX_QUESTION} value={question} onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <label className="pip-card-edit-label">
            Answer
            <textarea className="pip-card-edit-field" rows={3} maxLength={MAX_PASSAGE} value={answer} onChange={(event) => setAnswer(event.target.value)} />
          </label>
        </>
      )}
      {card.kind === "pic" && (
        <label className="pip-card-edit-label">
          What's under the box
          <input className="pip-card-edit-field" maxLength={MAX_LABEL} value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
      )}
      {failed && (
        <p className="pip-quiz-note" role="alert">
          That card couldn't be saved. Try again.
        </p>
      )}
      <div className="pip-word-keys">
        <button
          type="button"
          className="pip-key pip-key-small"
          disabled={!ready}
          onClick={() => {
            const made = input();
            if (made) onSave(made).catch(() => setFailed(true));
          }}
        >
          <UiIcon name="check" size={13} />
          Save
        </button>
        <button type="button" className="pip-key pip-key-small pip-key-quiet" onClick={onCancel}>
          Cancel
        </button>
        {onBoxes && (
          <button type="button" className="pip-key pip-key-small pip-key-quiet" onClick={onBoxes} title="Draw, move or remove this picture's boxes">
            <UiIcon name="grid" size={13} />
            Edit boxes
          </button>
        )}
      </div>
    </div>
  );
};
