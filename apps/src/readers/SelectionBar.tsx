import { useState } from "react";
import { Share2 } from "lucide-react";
import { UiIcon } from "../components/UiIcon";
import { useTouchInput } from "../platform/device";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_IDS } from "./highlightColors";
import { useReaderShape } from "./touchLayout";

type SelectionBarProps = {
  text: string;
  onHighlight: (color: string) => void;
  onNote: () => void;
  /** Takes off the highlight the selection lies over. The button is there only when this is. */
  onRemoveHighlight?: () => void;
  onCopy: () => void;
  onDismiss: () => void;
  /** Looks the selection up (its meaning, a summary). The button is there only when this is. */
  onLookUp?: () => void;
  /** The lookup card is showing: the button says so, and pressing it again closes the card. */
  lookUpOpen?: boolean;
  /** Searches the book for the selection. The button is there only when this is. */
  onSearchBook?: () => void;
  /** Says who the selected name is (the character card). The button is there only when this is. */
  onWhoIs?: () => void;
  /** The character card is showing: the button says so, and pressing it again closes the card. */
  whoIsOpen?: boolean;
  /** The phone's share sheet for the words (Android). The button is there only when this is. */
  onShare?: () => void;
  /** Dotty reads on from the selection (Smart Read). The button is there only when this is. */
  onReadFromHere?: () => void;
};

/** The colour last highlighted in: a finger's one-tap highlight uses it. */
const LAST_COLOR_KEY = "leaflet.reader.lastHighlightColor";

export const lastHighlightColor = (): string => {
  try {
    const kept = localStorage.getItem(LAST_COLOR_KEY);
    return kept && (HIGHLIGHT_COLOR_IDS as readonly string[]).includes(kept) ? kept : HIGHLIGHT_COLOR_IDS[0];
  } catch {
    return HIGHLIGHT_COLOR_IDS[0];
  }
};

const keepHighlightColor = (color: string) => {
  try {
    localStorage.setItem(LAST_COLOR_KEY, color);
  } catch {
    // This session only.
  }
};

/**
 * What to do with selected text: highlight it (in a colour), highlight it with
 * a note, copy it, look it up, ask who it is, or find it elsewhere in the book. Sits above
 * the chapter dock rather than beside the selection, which lives inside the
 * book's own frame.
 *
 * By finger (docs/android.md, "Selecting, looking up, notes") it is one row of
 * the five most used, at 44 px: look up, highlight in the last colour, a
 * note, "Who is this?", copy; and a ··· for the rest (the other colours, at
 * 32 px, share, "Read from here", search, remove a highlight).
 */
export const SelectionBar = (props: SelectionBarProps) => {
  const touch = useTouchInput();
  const highlight = (color: string) => {
    keepHighlightColor(color);
    props.onHighlight(color);
  };
  return touch ? <TouchSelectionBar {...props} onHighlight={highlight} /> : <MouseSelectionBar {...props} onHighlight={highlight} />;
};

const MouseSelectionBar = ({
  text,
  onHighlight,
  onNote,
  onRemoveHighlight,
  onCopy,
  onDismiss,
  onLookUp,
  lookUpOpen = false,
  onSearchBook,
  onWhoIs,
  whoIsOpen = false
}: SelectionBarProps) => (
  <div className="reader-selection-bar pointer-events-auto" role="toolbar" aria-label="Selected text">
    <span className="reader-selection-text reader-muted" title={text}>
      “{text.length > 60 ? `${text.slice(0, 57)}…` : text}”
    </span>
    <span className="flex items-center gap-1" aria-label="Highlight">
      {HIGHLIGHT_COLOR_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className="reader-selection-swatch"
          style={{ background: HIGHLIGHT_COLORS[id].swatch }}
          onClick={() => onHighlight(id)}
          title={`Highlight in ${HIGHLIGHT_COLORS[id].name.toLowerCase()}`}
          aria-label={`Highlight in ${HIGHLIGHT_COLORS[id].name.toLowerCase()}`}
        />
      ))}
    </span>
    <button type="button" className="reader-mini-control" onClick={onNote} title="Highlight and add a note">
      <UiIcon name="note" size={16} />
    </button>
    {onRemoveHighlight && (
      <button type="button" className="reader-mini-control" onClick={onRemoveHighlight} title="Remove highlight" aria-label="Remove highlight">
        <UiIcon name="trash" size={16} />
      </button>
    )}
    <button type="button" className="reader-mini-control" onClick={onCopy} title="Copy">
      <UiIcon name="copy" size={15} />
    </button>
    {onLookUp && (
      <button
        type="button"
        className="reader-mini-control"
        style={lookUpOpen ? { color: "var(--reader-accent)", borderColor: "var(--reader-accent)" } : undefined}
        onClick={onLookUp}
        title="Look up"
        aria-label="Look up"
        aria-haspopup="dialog"
        aria-expanded={lookUpOpen}
      >
        <UiIcon name="dictionary" size={16} />
      </button>
    )}
    {onWhoIs && (
      <button
        type="button"
        className="reader-mini-control"
        style={whoIsOpen ? { color: "var(--reader-accent)", borderColor: "var(--reader-accent)" } : undefined}
        onClick={onWhoIs}
        title="Who is this?"
        aria-label="Who is this?"
        aria-haspopup="dialog"
        aria-expanded={whoIsOpen}
      >
        <UiIcon name="who" size={16} />
      </button>
    )}
    {onSearchBook && (
      <button
        type="button"
        className="reader-mini-control"
        onClick={onSearchBook}
        title="Search in this book"
        aria-label="Search in this book"
      >
        <UiIcon name="search" size={15} />
      </button>
    )}
    <button type="button" className="reader-mini-control" onClick={onDismiss} title="Close" aria-label="Close">
      <UiIcon name="close" size={16} />
    </button>
  </div>
);

const lit = (on: boolean) => (on ? { color: "var(--reader-accent)", borderColor: "var(--reader-accent)" } : undefined);

const TouchSelectionBar = ({
  onHighlight,
  onNote,
  onRemoveHighlight,
  onCopy,
  onLookUp,
  lookUpOpen = false,
  onSearchBook,
  onWhoIs,
  whoIsOpen = false,
  onShare,
  onReadFromHere
}: SelectionBarProps) => {
  const [moreOpen, setMore] = useState(false);
  // A phone on its side has the width for all of it in one row: the colours,
  // share and the rest are out, not behind "More".
  const wide = useReaderShape() === "sideways";
  const more = moreOpen || wide;
  const color = lastHighlightColor();
  const colorName = HIGHLIGHT_COLORS[color as keyof typeof HIGHLIGHT_COLORS]?.name.toLowerCase() ?? "yellow";
  return (
    <div className={`reader-selection-bar is-touch pointer-events-auto ${wide ? "is-wide" : ""}`} role="toolbar" aria-label="Selected text">
      {more && (
        <div className="reader-selection-more" role="group" aria-label="More for the selection">
          <span className="reader-selection-swatches" aria-label="Highlight">
            {HIGHLIGHT_COLOR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="reader-selection-swatch"
                style={{ background: HIGHLIGHT_COLORS[id].swatch }}
                onClick={() => onHighlight(id)}
                aria-label={`Highlight in ${HIGHLIGHT_COLORS[id].name.toLowerCase()}`}
                aria-pressed={id === color}
              />
            ))}
          </span>
          {onRemoveHighlight && (
            <button type="button" className="reader-mini-control" onClick={onRemoveHighlight} title="Remove highlight" aria-label="Remove highlight">
              <UiIcon name="trash" size={18} />
            </button>
          )}
          {onShare && (
            <button type="button" className="reader-mini-control" onClick={onShare} title="Share" aria-label="Share">
              <Share2 size={18} aria-hidden="true" />
            </button>
          )}
          {onReadFromHere && (
            <button type="button" className="reader-mini-control" onClick={onReadFromHere} title="Read from here" aria-label="Read from here">
              <UiIcon name="play" size={18} />
            </button>
          )}
          {onSearchBook && (
            <button type="button" className="reader-mini-control" onClick={onSearchBook} title="Search in this book" aria-label="Search in this book">
              <UiIcon name="search" size={18} />
            </button>
          )}
        </div>
      )}
      <div className="reader-selection-row">
        {onLookUp && (
          <button
            type="button"
            className="reader-mini-control"
            style={lit(lookUpOpen)}
            onClick={onLookUp}
            title="Look up"
            aria-label="Look up"
            aria-haspopup="dialog"
            aria-expanded={lookUpOpen}
          >
            <UiIcon name="dictionary" size={19} />
          </button>
        )}
        {!wide && (
        <button
          type="button"
          className="reader-mini-control reader-selection-quick"
          onClick={() => onHighlight(color)}
          title={`Highlight in ${colorName}`}
          aria-label={`Highlight in ${colorName}`}
        >
          <UiIcon name="highlight" size={19} />
          <span className="reader-selection-quick-dot" style={{ background: HIGHLIGHT_COLORS[color as keyof typeof HIGHLIGHT_COLORS]?.swatch }} aria-hidden="true" />
        </button>
        )}
        <button type="button" className="reader-mini-control" onClick={onNote} title="Highlight and add a note" aria-label="Highlight and add a note">
          <UiIcon name="note" size={19} />
        </button>
        {onWhoIs && (
          <button
            type="button"
            className="reader-mini-control"
            style={lit(whoIsOpen)}
            onClick={onWhoIs}
            title="Who is this?"
            aria-label="Who is this?"
            aria-haspopup="dialog"
            aria-expanded={whoIsOpen}
          >
            <UiIcon name="who" size={19} />
          </button>
        )}
        <button type="button" className="reader-mini-control" onClick={onCopy} title="Copy" aria-label="Copy">
          <UiIcon name="copy" size={18} />
        </button>
        {!wide && (
        <button
          type="button"
          className="reader-mini-control"
          style={lit(more)}
          onClick={() => setMore((open) => !open)}
          title="More"
          aria-label="More: colours, share, search"
          aria-expanded={more}
        >
          <UiIcon name="more" size={19} />
        </button>
        )}
      </div>
    </div>
  );
};
