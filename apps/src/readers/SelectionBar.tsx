import { UiIcon } from "../components/UiIcon";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_IDS } from "./highlightColors";

type SelectionBarProps = {
  text: string;
  onHighlight: (color: string) => void;
  onNote: () => void;
  onCopy: () => void;
  onDismiss: () => void;
};

/**
 * What to do with selected text: highlight it (in a colour), highlight it with
 * a note, or copy it. Sits above the chapter dock rather than beside the
 * selection, which lives inside the book's own frame.
 */
export const SelectionBar = ({ text, onHighlight, onNote, onCopy, onDismiss }: SelectionBarProps) => (
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
    <button type="button" className="reader-mini-control" onClick={onCopy} title="Copy">
      <UiIcon name="copy" size={15} />
    </button>
    <button type="button" className="reader-mini-control" onClick={onDismiss} title="Close" aria-label="Close">
      <UiIcon name="close" size={16} />
    </button>
  </div>
);
