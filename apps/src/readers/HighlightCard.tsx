import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Image as ImageIcon } from "lucide-react";
import { UiIcon } from "../components/UiIcon";
import type { Annotation } from "../services/annotationService";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_IDS } from "./highlightColors";
import { CARD_GAP, placeCard, type Box } from "./lookupPlacement";
import "./lookupCard.css";
import "./notes.css";

type HighlightCardProps = {
  highlight: Annotation;
  /** Opened to write: the note has the keyboard. (Tapping a highlight that has none also writes.) */
  writing?: boolean;
  onSaveNote: (note: string) => void;
  onRecolor: (color: string) => void;
  onRemove: () => void;
  onCopy: () => void;
  /** The passage as a picture to share (components/share). The button is there only when this is. */
  onShare?: () => void;
  /** The whole list, with this highlight in it. */
  onShowAll: () => void;
  onClose: () => void;
  /** Where the highlighted words are in the window, so the card can keep off them. */
  avoid?: () => Box | null;
};

/** The tallest the card gets before the quote scrolls. */
const MAX_HEIGHT = 380;

export const noteDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

/**
 * A highlight, opened where it is: its words, its colour, and the note that
 * goes with it. It opens when a highlight in the page is tapped and when
 * "Highlight and add a note" is pressed, in the selection bar's place above
 * the chapter dock, as the lookup card and the character card do.
 *
 * A note used to be written in the list of all notes, in a popover in the far
 * corner of the toolbar: away from the words it was about, and looking like
 * what it was, a field added to a list.
 *
 * What is typed is kept however the card goes (Done, Escape, a click
 * elsewhere, another highlight tapped): nothing typed is ever thrown away.
 * Emptying the note removes it.
 */
export const HighlightCard = ({
  highlight,
  writing = false,
  onSaveNote,
  onRecolor,
  onRemove,
  onCopy,
  onShare,
  onShowAll,
  onClose,
  avoid
}: HighlightCardProps) => {
  const [draft, setDraft] = useState(highlight.note ?? "");
  const [place, setPlace] = useState({ height: MAX_HEIGHT, lift: CARD_GAP, shift: 0 });
  const card = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const titleId = useId();
  const fieldId = useId();

  // What is typed, and what to do with it, for the way out (which may be an unmount).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef(highlight.note ?? "");
  const saveRef = useRef(onSaveNote);
  saveRef.current = onSaveNote;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const avoidRef = useRef(avoid);
  avoidRef.current = avoid;
  const removedRef = useRef(false);

  const keep = () => {
    const text = draftRef.current.trim();
    if (!removedRef.current && text !== savedRef.current.trim()) {
      savedRef.current = text;
      saveRef.current(text);
    }
  };
  // Kept on the way out, whichever way that is.
  useEffect(() => keep, []);

  const colour = HIGHLIGHT_COLORS[highlight.color ?? "yellow"] ?? HIGHLIGHT_COLORS.yellow;

  // Where it goes: above the dock, off the highlighted words, inside the window.
  useLayoutEffect(() => {
    const measure = () => {
      const node = card.current;
      const dock = node?.parentElement;
      if (!node || !dock) {
        return;
      }
      const bar = dock.getBoundingClientRect();
      const toolbar = node.closest(".reader-scope")?.querySelector(".reader-toolbar")?.getBoundingClientRect();
      setPlace((before) => {
        const next = placeCard({
          barTop: bar.top,
          barCentre: bar.left + bar.width / 2,
          ceiling: Math.max(toolbar?.bottom ?? 0, 0) + CARD_GAP,
          cardWidth: node.offsetWidth,
          windowWidth: window.innerWidth,
          selection: avoidRef.current?.() ?? null
        });
        return next.height === before.height && next.lift === before.lift && next.shift === before.shift ? before : next;
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // The note grows with what is written, up to a point.
  useLayoutEffect(() => {
    const node = field.current;
    if (node) {
      node.style.height = "auto";
      node.style.height = `${Math.min(150, Math.max(62, node.scrollHeight + 2))}px`;
    }
  }, [draft]);

  // Focus comes in, and goes back to where it was on the way out.
  useLayoutEffect(() => {
    const node = card.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (writing || !highlight.note) {
      field.current?.focus({ preventScroll: true });
      const end = field.current?.value.length ?? 0;
      field.current?.setSelectionRange(end, end);
    } else {
      node?.focus({ preventScroll: true });
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Ahead of the reader's own Escape.
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const at = event.target as Node | null;
      if (!at || node?.contains(at)) {
        return;
      }
      closeRef.current();
    };
    // A click in the book lands in the book's own frame and is never seen
    // here; what is seen is this window losing focus to that frame.
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
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The reader turns pages on Space and the arrows; in here they type.
    event.stopPropagation();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={card}
      className="reader-lookup reader-note-card reader-panel reader-border pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{
        maxHeight: Math.min(place.height, MAX_HEIGHT),
        bottom: `calc(100% + ${place.lift}px)`,
        transform: `translateX(calc(-50% + ${place.shift}px))`,
        ["--note-colour" as string]: colour.swatch
      }}
      onKeyDown={onKeyDown}
    >
      <div className="reader-note-card-head">
        <h2 id={titleId} className="reader-lookup-kicker reader-muted">
          Highlight{highlight.chapter ? ` · ${highlight.chapter}` : ""}
        </h2>
        <span className="reader-note-card-tools">
          {onShare && (
            <button type="button" className="reader-mini-control" onClick={onShare} title="Share as a picture" aria-label="Share as a picture">
              <ImageIcon size={15} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="reader-mini-control" onClick={onCopy} title="Copy the highlighted words" aria-label="Copy">
            <UiIcon name="copy" size={15} />
          </button>
          <button
            type="button"
            className="reader-mini-control"
            onClick={() => {
              removedRef.current = true;
              onRemove();
            }}
            title="Remove this highlight"
            aria-label="Remove highlight"
          >
            <UiIcon name="trash" size={15} />
          </button>
          <button type="button" className="reader-mini-control" onClick={onClose} title="Done (Esc)" aria-label="Close">
            <UiIcon name="close" size={16} />
          </button>
        </span>
      </div>

      <blockquote className="reader-note-quote" tabIndex={0}>
        {highlight.text}
      </blockquote>

      <div className="reader-note-card-row">
        <span className="flex items-center gap-1.5" role="group" aria-label="Colour">
          {HIGHLIGHT_COLOR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`reader-selection-swatch reader-note-swatch ${(highlight.color ?? "yellow") === id ? "is-current" : ""}`}
              style={{ background: HIGHLIGHT_COLORS[id].swatch }}
              onClick={() => onRecolor(id)}
              title={HIGHLIGHT_COLORS[id].name}
              aria-label={HIGHLIGHT_COLORS[id].name}
              aria-pressed={(highlight.color ?? "yellow") === id}
            />
          ))}
        </span>
        <span className="reader-note-date reader-muted">{noteDate(highlight.createdAt)}</span>
      </div>

      <label className="reader-lookup-visually-hidden" htmlFor={fieldId}>
        Your note on this highlight
      </label>
      <textarea
        ref={field}
        id={fieldId}
        className="reader-note-field"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Write a note…"
        maxLength={8000}
        rows={2}
      />

      <div className="reader-note-card-foot">
        <button type="button" className="reader-lookup-inline" onClick={onShowAll}>
          All notes
        </button>
        <button type="button" className="reader-notes-action is-primary" onClick={onClose} title="Done (Ctrl+Enter)">
          Done
        </button>
      </div>
    </div>
  );
};
