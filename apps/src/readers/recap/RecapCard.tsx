import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { UiIcon } from "../../components/UiIcon";
import type { Annotation } from "../../services/annotationService";
import { isKindlePlace } from "../../library/kindleClippings";
import { mentionSearch } from "../people/bookText";
import { isContentsPage } from "../people/mentions";
import type { Place } from "../people/model";
import type { NameSuggestion } from "../people/suggest";
import "../lookupCard.css";
import "../notes.css";
import "./recap.css";
import { awayWords, lastLines } from "./recap";

type RecapCardProps = {
  /** The epub.js book. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  book: any;
  /** Where the reading stopped: the top of the screen. */
  place: Place;
  /** How long the book has been left, in days; null when the card was asked for and not offered. */
  days: number | null;
  /** The chapter being read, and how far through the book. */
  chapter: string | null;
  progress: number;
  /** The reader's highlights in this book, any order. */
  highlights: Annotation[];
  chapterOf: (section: number) => string | null;
  /** Says who a name is (the character card); absent with "Characters" switched off. */
  onName?: (name: string) => void;
  onOpenHighlight: (cfi: string) => void;
  onClose: () => void;
};

/** How much of the book before the place is read for the names lately in it: about fifteen pages. */
const LATELY = 30_000;
const NAMES = 6;

/**
 * "Where was I?": for a reader back at a book after some days. How long it
 * has been, the last lines they read, who those pages were about and the
 * last thing they marked. It opens by itself when a book is come back to
 * (`worthRecap`) and from the ··· menu at any time.
 *
 * Everything in it is from before the reader's place, so it cannot spoil,
 * and from this device.
 *
 * A dialog in the selection bar's place, as the other cards are: Escape, a
 * click anywhere else, or "Carry on" closes it.
 */
export const RecapCard = ({ book, place, days, chapter, progress, highlights, chapterOf, onName, onOpenHighlight, onClose }: RecapCardProps) => {
  const [lines, setLines] = useState<string[] | null>(null);
  const [names, setNames] = useState<NameSuggestion[]>([]);
  const card = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const chapterOfRef = useRef(chapterOf);
  chapterOfRef.current = chapterOf;
  const titleId = useId();

  // The book's own words before the place, read once for this card.
  useEffect(() => {
    const search = mentionSearch(book, (section) => isContentsPage(chapterOfRef.current(section)));
    const stop = new AbortController();
    void search.before(place, { signal: stop.signal, chars: 2400 }).then(
      (text) => {
        if (!stop.signal.aborted) {
          setLines(text === null ? [] : lastLines(text));
        }
      },
      () => setLines([])
    );
    void search.recentNames(place, { signal: stop.signal, chars: LATELY, limit: NAMES }).then(
      (found) => {
        if (!stop.signal.aborted && found) {
          setNames(found);
        }
      },
      () => undefined
    );
    return () => {
      stop.abort();
      search.clear();
    };
    // The place is the card's own, fixed while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // The last thing marked: the reader's own way back in. (Not one brought
  // from a Kindle: it has no place to go back to, and may be from further on.)
  const latest = useMemo(
    () => [...highlights].filter((item) => item.kind === "highlight" && !isKindlePlace(item.cfi)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    [highlights]
  );

  useLayoutEffect(() => {
    const node = card.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        // Any of the keys that mean "go on" does, ahead of the reader's own.
        if (event.key !== "Escape" && event.target instanceof HTMLElement && event.target.closest("button")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const at = event.target as Node | null;
      if (at && !node?.contains(at)) {
        closeRef.current();
      }
    };
    // A click in the book lands in the book's own frame: what is seen here is the window losing focus to it.
    const onBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) {
          closeRef.current();
        }
      }, 0);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
      const active = document.activeElement;
      if (opener?.isConnected && (active === document.body || active === null || node?.contains(active))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div
      ref={card}
      className="reader-lookup reader-note-card reader-recap reader-panel reader-border pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{ bottom: "calc(100% + 8px)", transform: "translateX(-50%)" }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="reader-note-card-head">
        <h2 id={titleId} className="reader-lookup-kicker reader-muted">
          {days !== null ? `Welcome back · ${awayWords(days)}` : "Where you are"}
        </h2>
        <button type="button" className="reader-mini-control" onClick={onClose} title="Carry on (Esc)" aria-label="Close">
          <UiIcon name="close" size={16} />
        </button>
      </div>

      <p className="reader-recap-where reader-text-color">
        {chapter ?? "This book"} <span className="reader-muted tabular-nums">· {percent}%</span>
      </p>

      {lines === null ? (
        <p className="reader-muted" role="status">
          Looking back…
        </p>
      ) : (
        lines.length > 0 && (
          <blockquote className="reader-note-quote reader-recap-lines" tabIndex={0} aria-label="The last lines you read">
            {lines.map((line, at) => (
              <p key={at}>{line}</p>
            ))}
          </blockquote>
        )
      )}

      {names.length > 0 && (
        <div className="reader-recap-row" aria-label="Lately in the book">
          <span className="reader-recap-label reader-muted">Lately</span>
          <span className="reader-recap-names">
            {names.map((item) =>
              onName ? (
                <button key={item.name} type="button" className="reader-people-link" onClick={() => onName(item.name)} title={`Who is ${item.name}?`}>
                  {item.name}
                </button>
              ) : (
                <span key={item.name} className="reader-people-link">
                  {item.name}
                </span>
              )
            )}
          </span>
        </div>
      )}

      {latest && (
        <button type="button" className="reader-recap-mark" onClick={() => onOpenHighlight(latest.cfi)} title="Go to this highlight">
          <span className="reader-recap-label reader-muted">You last marked</span>
          <span className="reader-recap-marked">{latest.text}</span>
        </button>
      )}

      <div className="reader-note-card-foot">
        <span />
        <button type="button" className="reader-notes-action is-primary" onClick={onClose}>
          Carry on
        </button>
      </div>
    </div>
  );
};
