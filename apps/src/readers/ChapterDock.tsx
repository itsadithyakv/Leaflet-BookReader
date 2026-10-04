import { forwardRef, useEffect, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { ReadingOutlook, type Outlook } from "./ReadingOutlook";

type ChapterDockProps = {
  /** Pages layout: the arrows turn pages rather than chapters. */
  paged: boolean;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  outlook: Outlook;
  /** Places to go back and forward to (readers/jumpHistory.ts). */
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** Awake for a moment (a jump was just made, and "Back" should be seen). */
  awake: boolean;
  /** The pointer or the keyboard is on the dock, or it was opened: the progress bar below it shows too. */
  onNearChange?: (near: boolean) => void;
};

/**
 * The chapter dock at the foot of the page: previous and next, the chapter's
 * name, how far through the book and how long is left, and the way back after
 * a jump. Small and faint until the pointer or the keyboard reaches it. It
 * is one row and grows sideways: auto-scroll's and Smart Read's controls and
 * the selection bar sit just above it, and the progress bar just below.
 */
export const ChapterDock = forwardRef<HTMLDivElement, ChapterDockProps>(
  ({ paged, label, onPrev, onNext, outlook, canGoBack, canGoForward, onBack, onForward, awake, onNearChange }, ref) => {
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const near = open || hovered || focused;
    useEffect(() => {
      onNearChange?.(near);
    }, [near]);
    return (
      <div
        ref={ref}
        className={`reader-chapter-dock pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center ${
          open ? "is-open" : ""
        } ${awake ? "is-awake" : ""}`}
      >
        <div
          className="pointer-events-auto flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs uppercase tracking-widest reader-pill reader-border"
          role="group"
          aria-label="Chapter and progress"
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setFocused(false);
            }
          }}
        >
          {canGoBack && (
            <button
              type="button"
              className="reader-mini-control reader-dock-back"
              onClick={onBack}
              title="Back to where you were (Alt+Left)"
              aria-label="Back to where you were"
            >
              <Undo2 size={14} aria-hidden="true" />
              <span>Back</span>
            </button>
          )}
          {canGoForward && (
            <button
              type="button"
              className="reader-mini-control"
              onClick={onForward}
              title="Forward again (Alt+Right)"
              aria-label="Forward again"
            >
              <Redo2 size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="reader-mini-control"
            onClick={onPrev}
            title={paged ? "Previous page (Left arrow)" : "Previous chapter"}
            aria-label={paged ? "Previous page" : "Previous chapter"}
          >
            <span className="material-symbols-outlined text-base">chevron_left</span>
          </button>
          <span className="reader-dock-label text-[10px] reader-muted">{label}</span>
          <button
            type="button"
            className="reader-mini-control"
            onClick={onNext}
            title={paged ? "Next page (Right arrow or Space)" : "Next chapter"}
            aria-label={paged ? "Next page" : "Next chapter"}
          >
            <span className="material-symbols-outlined text-base">chevron_right</span>
          </button>
          <ReadingOutlook outlook={outlook} open={open} onToggle={() => setOpen((value) => !value)} />
        </div>
      </div>
    );
  }
);
ChapterDock.displayName = "ChapterDock";
