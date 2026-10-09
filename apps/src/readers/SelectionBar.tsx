import { UiIcon } from "../components/UiIcon";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_IDS } from "./highlightColors";

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
};

/**
 * What to do with selected text: highlight it (in a colour), highlight it with
 * a note, copy it, look it up, ask who it is, or find it elsewhere in the book. Sits above
 * the chapter dock rather than beside the selection, which lives inside the
 * book's own frame.
 */
export const SelectionBar = ({
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
