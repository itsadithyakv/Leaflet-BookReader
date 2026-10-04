import { useEffect, useRef } from "react";
import { UiIcon } from "../components/UiIcon";
import type { NoteRun } from "./footnotes";
import "./notePopover.css";

type NotePopoverProps = {
  /** The marker that was tapped ("3", "*"), for the heading. */
  marker: string;
  paragraphs: NoteRun[][];
  /** The note runs on past what is shown. */
  truncated: boolean;
  onGoTo: () => void;
  onClose: () => void;
};

/**
 * A footnote, shown where the reader is rather than at the back of the book.
 * The words are the note's own; the elements are built here (never the book's
 * HTML). "Go to note" jumps there, and Back returns. Escape, the close button
 * or a click anywhere else closes it.
 */
export const NotePopover = ({ marker, paragraphs, truncated, onGoTo, onClose }: NotePopoverProps) => {
  const root = useRef<HTMLDivElement | null>(null);

  // Focus comes out of the book and into the note, so Escape and Tab act on it.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [paragraphs]);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node | null)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  const label = /^\s*[\[(]?[\d*†‡§¶‖#ivxlca-z]{1,6}[\])]?\.?\s*$/i.test(marker) ? `Note ${marker.trim().replace(/^[\[(]|[\])]$/g, "")}` : "Note";
  return (
    <div
      ref={root}
      className="reader-note-popover pointer-events-auto"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="reader-note-head">
        <span className="reader-note-label reader-muted">{label}</span>
        <button type="button" className="reader-mini-control" onClick={onClose} title="Close (Esc)" aria-label="Close note">
          <UiIcon name="close" size={16} />
        </button>
      </div>
      <div className="reader-note-body">
        {paragraphs.map((paragraph, index) => (
          <p key={index}>
            {paragraph.map((run, at) => {
              const words = run.strong ? <strong>{run.text}</strong> : run.text;
              return run.em ? <em key={at}>{words}</em> : <span key={at}>{words}</span>;
            })}
          </p>
        ))}
      </div>
      <div className="reader-note-foot">
        {truncated && <span className="reader-muted">The note goes on.</span>}
        <button type="button" className="reader-notes-action is-primary" onClick={onGoTo}>
          Go to note
        </button>
      </div>
    </div>
  );
};
