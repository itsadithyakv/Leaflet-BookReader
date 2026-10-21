import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Image as ImageIcon } from "lucide-react";
import { UiIcon } from "../components/UiIcon";
import { useBackLayer } from "../platform/back";
import { isTouchInput } from "../platform/device";
import type { Annotation } from "../services/annotationService";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_IDS } from "./highlightColors";
import { keyboardIsOpen } from "./keyboardOpen";
import { CARD_GAP, cardCeiling, insetTopNow, placeNoteCard, type Box } from "./lookupPlacement";
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

/** The tallest the card gets before what is in it scrolls; by finger, a little taller. */
const MAX_HEIGHT = 380;
const TOUCH_MAX_HEIGHT = 440;
/** A pause this long in the typing keeps what is typed (the app can be sent away, and closed, at any moment). */
export const NOTE_AUTOSAVE_MS = 700;

/** The note's height: as tall as what is written, to a point; by the keyboard, at most `room`. */
const noteHeight = (field: HTMLTextAreaElement, typing: boolean, room = 150) =>
  Math.min(150, room, Math.max(typing ? 44 : 62, field.scrollHeight + 2));

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
 * elsewhere, another highlight tapped), and as it is typed, at each pause:
 * nothing typed is ever thrown away. Emptying the note removes it.
 *
 * Its words, colours and note scroll between its head and its foot, so Done
 * is always in reach. By finger it opens to read (the keyboard comes when
 * the note is tapped, or when it was opened to write); with the keyboard up
 * it sits on the keyboard in all the room there is, the note in sight, and
 * Back first puts the keyboard away.
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
  const [touch] = useState(isTouchInput);
  const tallest = touch ? TOUCH_MAX_HEIGHT : MAX_HEIGHT;
  const [place, setPlace] = useState({ height: tallest, lift: CARD_GAP, shift: 0 });
  /** The note has the keyboard (a phone's, up). */
  const [typing, setTyping] = useState(false);
  const card = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
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
  // And at each pause in the typing, and when the app is sent away.
  useEffect(() => {
    const timer = window.setTimeout(keep, NOTE_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    const away = () => {
      if (document.visibilityState === "hidden") keep();
    };
    document.addEventListener("visibilitychange", away);
    window.addEventListener("pagehide", keep);
    return () => {
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("pagehide", keep);
    };
  }, []);

  // Back, while the note has the keyboard, puts the keyboard away; the card stays.
  useBackLayer(typing, () => field.current?.blur());

  /**
   * The note in sight in the card's scrolling middle (the caret is at its end,
   * or in its own scroll): while it has the keyboard, or, `always`, once.
   */
  const keepFieldInView = (always = false) => {
    const middle = body.current;
    const note = field.current;
    if (!middle || !note || (!always && document.activeElement !== note)) {
      return;
    }
    const room = middle.getBoundingClientRect();
    const box = note.getBoundingClientRect();
    if (box.bottom > room.bottom) {
      middle.scrollTop += Math.ceil(box.bottom - room.bottom) + 2;
    } else if (box.top < room.top && box.height <= room.height) {
      middle.scrollTop -= Math.ceil(room.top - box.top) + 2;
    }
  };
  const keepFieldInViewRef = useRef(keepFieldInView);
  keepFieldInViewRef.current = keepFieldInView;

  const colour = HIGHLIGHT_COLORS[highlight.color ?? "yellow"] ?? HIGHLIGHT_COLORS.yellow;

  // Where it goes: above the dock, off the highlighted words, inside the
  // window and under the status bar. Again whenever the room changes: the
  // window (a phone's keyboard resizes it), the keyboard, the chrome.
  useLayoutEffect(() => {
    const scope = card.current?.closest(".reader-scope") ?? null;
    // What the page was scrolled to as the note was given the keyboard: a
    // browser brings a field into view by scrolling whatever holds it, and
    // the page behind is not to move.
    let held: { node: Element; top: number; left: number }[] = [];
    const holdPage = () => {
      held = [];
      for (let at = card.current?.parentElement ?? null; at; at = at.parentElement) {
        held.push({ node: at, top: at.scrollTop, left: at.scrollLeft });
      }
    };
    const putPageBack = () => {
      for (const one of held) {
        if (one.node.scrollTop !== one.top) one.node.scrollTop = one.top;
        if (one.node.scrollLeft !== one.left) one.node.scrollLeft = one.left;
      }
    };
    let frame = 0;
    const measure = () => {
      const node = card.current;
      const dock = node?.parentElement;
      if (!node || !dock) {
        return;
      }
      putPageBack();
      const nowTyping = keyboardIsOpen() && document.activeElement === field.current;
      setTyping(nowTyping);
      const bar = dock.getBoundingClientRect();
      const toolbar = scope?.querySelector(".reader-toolbar")?.getBoundingClientRect();
      // All it holds, the note at the height it takes with the keyboard away.
      const middle = body.current;
      const note = field.current;
      const grows = note ? Math.max(0, noteHeight(note, false) - note.offsetHeight) : 0;
      const wanted = middle
        ? node.offsetHeight - middle.clientHeight + middle.scrollHeight + grows
        : undefined;
      setPlace((before) => {
        const next = placeNoteCard({
          barTop: bar.top,
          barCentre: bar.left + bar.width / 2,
          ceiling: cardCeiling(toolbar, window.innerWidth, insetTopNow()),
          cardWidth: node.offsetWidth,
          windowWidth: window.innerWidth,
          selection: avoidRef.current?.() ?? null,
          tallest,
          wanted,
          typing: nowTyping
        });
        return next.height === before.height && next.lift === before.lift && next.shift === before.shift ? before : next;
      });
    };
    const soon = () => {
      measure();
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        measure();
        keepFieldInViewRef.current();
      });
    };
    let keyboardWas = keyboardIsOpen();
    const watched = new MutationObserver(() => {
      const keyboard = keyboardIsOpen();
      // The keyboard put away (Back, or its own key): the note lets it go, and the card stays.
      if (keyboardWas && !keyboard && document.activeElement === field.current) {
        field.current?.blur();
      }
      keyboardWas = keyboard;
      soon();
    });
    watched.observe(document.documentElement, { attributes: true, attributeFilter: ["data-keyboard"] });
    if (scope) watched.observe(scope, { attributes: true, attributeFilter: ["class"] });
    const onFocus = () => {
      holdPage();
      soon();
    };
    const note = field.current;
    note?.addEventListener("focus", onFocus);
    note?.addEventListener("blur", soon);
    measure();
    window.addEventListener("resize", soon);
    window.visualViewport?.addEventListener("resize", soon);
    // (A resize is not always heard as one: the reader's own frame says it too.)
    const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
    if (scope) sized?.observe(scope);
    return () => {
      window.cancelAnimationFrame(frame);
      watched.disconnect();
      sized?.disconnect();
      note?.removeEventListener("focus", onFocus);
      note?.removeEventListener("blur", soon);
      window.removeEventListener("resize", soon);
      window.visualViewport?.removeEventListener("resize", soon);
    };
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The note grows with what is written, up to a point: by the keyboard, no
  // taller than the card's middle, so that it is all in sight. The keyboard
  // put away, the card is placed again for all it holds, and the note just
  // written is brought into sight in it, whole (it was left cut in half).
  const typedRef = useRef(false);
  useLayoutEffect(() => {
    const node = field.current;
    if (node) {
      const room = typing && body.current ? Math.max(44, body.current.clientHeight - 6) : 150;
      node.style.height = "auto";
      node.style.height = `${noteHeight(node, typing, room)}px`;
    }
    const typed = typedRef.current && !typing;
    typedRef.current = typing;
    keepFieldInViewRef.current(typed);
  }, [draft, typing, place.height]);

  // Focus comes in, and goes back to where it was on the way out.
  useLayoutEffect(() => {
    const node = card.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // (By finger, only when opened to write: a tap to look at a highlight does not bring the keyboard.)
    if (writing || (!highlight.note && !touch)) {
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
      className={`reader-lookup reader-note-card reader-panel reader-border pointer-events-auto ${typing ? "is-typing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{
        maxHeight: Math.min(place.height, tallest),
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

      <div ref={body} className="reader-note-card-body">
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
      </div>

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
