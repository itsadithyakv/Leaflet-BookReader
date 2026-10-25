import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { UiIcon } from "../components/UiIcon";
import { useBackLayer } from "../platform/back";
import { MAX_PASSAGE, MAX_QUESTION, askInput, clip, fillInput, type CardInput, type CardPlace } from "./cards";
import { isHidden, plainPassage, toggleWord, tokens, type Range } from "./fillIn";
import type { HighlightSource } from "./studyStore";
import "./study.css";

type Kind = "fill" | "ask";

type CardMakerProps = {
  highlight: HighlightSource;
  place: CardPlace;
  /** The kind to start on. */
  kind?: Kind;
  /** Keeps the card; rejects when it could not be. */
  onSave: (card: CardInput) => Promise<void>;
  onClose: () => void;
};

/**
 * "Make a card" from a highlight, in the reader: a sheet over the page with
 * the two kinds. Fill in: the passage's words are buttons, and those tapped
 * are hidden in review. Question: the reader writes a question, and the
 * highlight (or the note on it) is the answer.
 *
 * Loaded when asked for (study/CardMakerHost.tsx), never with the book.
 */
export const CardMaker = ({ highlight, place, kind: startKind = "fill", onSave, onClose }: CardMakerProps) => {
  const [kind, setKind] = useState<Kind>(startKind);
  const full = useMemo(() => plainPassage(highlight.text), [highlight.text]);
  // A card is a passage, not a page: a long highlight gives its start.
  const passage = useMemo(() => clip(full, MAX_PASSAGE), [full]);
  const cut = passage.length < full.length;
  const words = useMemo(() => tokens(passage), [passage]);
  const [hidden, setHidden] = useState<Range[]>([]);
  const [question, setQuestion] = useState("");
  const note = plainPassage(highlight.note ?? "");
  const [answerFrom, setAnswerFrom] = useState<"text" | "note">("text");
  const [info, setInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const titleId = useId();
  const infoId = useId();

  useBackLayer(true, onClose);

  // The keyboard comes to the sheet (or the question), and goes back where it was.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (kind === "ask") field.current?.focus({ preventScroll: true });
  }, [kind]);

  const answer = answerFrom === "note" && note ? clip(note, MAX_PASSAGE) : passage;
  const ready = !busy && (kind === "fill" ? hidden.length > 0 : question.trim().length > 0 && answer.length > 0);

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setFailed(null);
    try {
      await onSave(kind === "fill" ? fillInput(place, passage, hidden, highlight.id) : askInput(place, question, answer, highlight.id));
    } catch {
      setFailed("That card couldn't be kept. Try again.");
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The reader turns pages on Space and the arrows; in here they type and press.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <div className="study-maker-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={sheet}
        className="study-maker reader-panel reader-border"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="study-maker-head">
          <h2 id={titleId} className="study-maker-title reader-text-color">
            Make a card
          </h2>
          <button
            type="button"
            className="reader-mini-control"
            onClick={() => setInfo((open) => !open)}
            aria-expanded={info}
            aria-controls={infoId}
            title="About cards"
            aria-label="About cards"
          >
            <UiIcon name="info" size={15} />
          </button>
          <button type="button" className="reader-mini-control" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <UiIcon name="close" size={16} />
          </button>
        </div>

        <div className="study-maker-kinds" role="radiogroup" aria-label="Kind of card">
          {(
            [
              ["fill", "Fill in"],
              ["ask", "Question"]
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={kind === id} className="study-maker-kind" onClick={() => setKind(id)}>
              {label}
            </button>
          ))}
        </div>

        {info && (
          <p id={infoId} className="study-maker-info reader-muted">
            {kind === "fill"
              ? "Tap the words to hide. Review shows the passage with them blank; you reveal, then say whether you had them."
              : "Write a question; the highlight, or your note on it, is the answer."}{" "}
            Cards are revised from the Library (Revise), and keep their own copy of the words{cut ? `: the first ${MAX_PASSAGE} characters of a long highlight` : ""}.
          </p>
        )}

        <div className="study-maker-body">
          {kind === "fill" ? (
            <p className="study-fill-words" aria-label="Words of the passage: press one to hide it">
              {renderWords(passage, words, hidden, (token) => setHidden((now) => toggleWord(passage, now, token)))}
              {cut && <span className="reader-muted">…</span>}
            </p>
          ) : (
            <>
              <label className="study-maker-label reader-muted" htmlFor={`${titleId}-q`}>
                Question
              </label>
              <textarea
                ref={field}
                id={`${titleId}-q`}
                className="study-maker-field reader-border"
                rows={2}
                maxLength={MAX_QUESTION}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What should this answer?"
              />
              <div className="study-maker-answer-head">
                <span className="study-maker-label reader-muted">Answer</span>
                {note && (
                  <span className="study-maker-kinds is-small" role="radiogroup" aria-label="The answer is">
                    <button type="button" role="radio" aria-checked={answerFrom === "text"} className="study-maker-kind" onClick={() => setAnswerFrom("text")}>
                      Highlight
                    </button>
                    <button type="button" role="radio" aria-checked={answerFrom === "note"} className="study-maker-kind" onClick={() => setAnswerFrom("note")}>
                      My note
                    </button>
                  </span>
                )}
              </div>
              <blockquote className="study-maker-quote reader-border">{answer}</blockquote>
            </>
          )}
        </div>

        <div className="study-maker-foot">
          <span className="study-maker-status reader-muted" role="status">
            {failed ?? (kind === "fill" ? (hidden.length === 0 ? "" : `${hidden.length} ${hidden.length === 1 ? "blank" : "blanks"}`) : "")}
          </span>
          <button type="button" className="reader-notes-action" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="reader-notes-action is-primary" onClick={() => void save()} disabled={!ready} title="Make the card (Ctrl+Enter)">
            Make card
          </button>
        </div>
      </div>
    </div>
  );
};

/** The passage's words as buttons, the hidden ones marked, the text between them as it is. */
const renderWords = (passage: string, words: ReturnType<typeof tokens>, hidden: Range[], toggle: (token: ReturnType<typeof tokens>[number]) => void) => {
  const out: ReactNode[] = [];
  let at = 0;
  words.forEach((token) => {
    if (token.start > at) out.push(<span key={`g${at}`}>{passage.slice(at, token.start)}</span>);
    const on = isHidden(token, hidden);
    out.push(
      <button key={token.start} type="button" className="study-fill-word" aria-pressed={on} onClick={() => toggle(token)}>
        {token.text}
      </button>
    );
    at = token.end;
  });
  if (at < passage.length) out.push(<span key={`g${at}`}>{passage.slice(at)}</span>);
  return out;
};
