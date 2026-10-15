import { forwardRef, useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight, List, Redo2, Undo2 } from "lucide-react";
import { ReadingOutlook, type Outlook } from "./ReadingOutlook";

type ChapterDockProps = {
  /** Pages layout: the arrows turn pages rather than chapters. */
  paged: boolean;
  /** Pages layout of a right-to-left book: the pages turn the other way, so the arrows change sides and point the other way. */
  rtl?: boolean;
  /** Pages layout: the page showing and how many the chapter has ("12 of 50"). */
  pageOf?: { page: number; total: number } | null;
  label: string;
  /** In a set of books (readers/innerBooks.ts): the book being read and the chapter in it, shown apart. `label` is still the whole name. */
  inBook?: { book: string; chapter: string } | null;
  /** Opens (or shuts) the chapter list: the chapter's name is then a button. */
  onContents?: () => void;
  contentsOpen?: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Pages layout only: the chapter before and after, beside the page arrows. */
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
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
 * The chapter dock at the foot of the page: previous and next (chapters when
 * scrolling; pages, with the chapters either side of them, in the pages
 * layout), the chapter's name, how far through the book and how long is left, and the way back after
 * a jump. In a right-to-left book's pages "next" is on the left and points
 * left, as the pages turn. Small and faint until the pointer or the keyboard reaches it. It
 * is one row and grows sideways: auto-scroll's and Smart Read's controls and
 * the selection bar sit just above it, and the progress bar just below.
 */
export const ChapterDock = forwardRef<HTMLDivElement, ChapterDockProps>(
  ({ paged, rtl, pageOf, label, inBook, onContents, contentsOpen, onPrev, onNext, onPrevChapter, onNextChapter, outlook, canGoBack, canGoForward, onBack, onForward, awake, onNearChange }, ref) => {
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const near = open || hovered || focused;
    // In a set of books: the book's name, then the chapter's. The book's gives way first when there is no room for both.
    const name = inBook ? (
      <>
        <span className="reader-dock-book text-[10px] reader-muted">{inBook.book}</span>
        <span className="reader-dock-sep text-[10px] reader-muted" aria-hidden="true">
          ·
        </span>
        <span className="reader-dock-label text-[10px] reader-muted">{inBook.chapter}</span>
      </>
    ) : (
      <span className="reader-dock-label text-[10px] reader-muted">{label}</span>
    );
    // The pages of a right-to-left book turn the other way: going on is to
    // the left. The keys named are the ones that do it (readers/readerKeys.ts);
    // Ctrl with an arrow is not mirrored.
    const mirrored = paged && Boolean(rtl);
    const back = (
      <button
        type="button"
        className={`reader-mini-control ${paged ? "reader-dock-page-step" : ""}`}
        onClick={onPrev}
        title={paged ? `Previous page (${mirrored ? "Right" : "Left"} arrow)` : "Previous chapter (Left arrow)"}
        aria-label={paged ? "Previous page" : "Previous chapter"}
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          {mirrored ? "chevron_right" : "chevron_left"}
        </span>
      </button>
    );
    const on = (
      <button
        type="button"
        className={`reader-mini-control ${paged ? "reader-dock-page-step" : ""}`}
        onClick={onNext}
        title={paged ? `Next page (${mirrored ? "Left" : "Right"} arrow or Space)` : "Next chapter (Right arrow)"}
        aria-label={paged ? "Next page" : "Next chapter"}
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          {mirrored ? "chevron_left" : "chevron_right"}
        </span>
      </button>
    );
    const chapterBack = paged && onPrevChapter && (
      <button type="button" className="reader-mini-control reader-dock-chapter-step" onClick={onPrevChapter} title="Previous chapter (Ctrl+Left)" aria-label="Previous chapter">
        {mirrored ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}
      </button>
    );
    const chapterOn = paged && onNextChapter && (
      <button type="button" className="reader-mini-control reader-dock-chapter-step" onClick={onNextChapter} title="Next chapter (Ctrl+Right)" aria-label="Next chapter">
        {mirrored ? <ChevronsLeft size={16} aria-hidden="true" /> : <ChevronsRight size={16} aria-hidden="true" />}
      </button>
    );
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
              className="reader-mini-control reader-dock-forward"
              onClick={onForward}
              title="Forward again (Alt+Right)"
              aria-label="Forward again"
            >
              <Redo2 size={14} aria-hidden="true" />
            </button>
          )}
          {mirrored ? chapterOn : chapterBack}
          {mirrored ? on : back}
          {onContents ? (
            // The chapter's name is what people press when they want the
            // contents: it opens the chapter list, and says so.
            <button
              type="button"
              className="reader-dock-contents"
              onClick={onContents}
              aria-expanded={Boolean(contentsOpen)}
              aria-label={`Contents. Now reading: ${label}`}
              title={`${label} · open the chapter list (C)`}
            >
              <List size={13} aria-hidden="true" />
              {name}
            </button>
          ) : (
            name
          )}
          {paged && pageOf && (
            <span
              className="reader-dock-pages reader-muted"
              role="img"
              aria-label={`Page ${pageOf.page} of ${pageOf.total} in this chapter`}
              title={`Page ${pageOf.page} of ${pageOf.total} in this chapter`}
            >
              {pageOf.page} of {pageOf.total}
            </span>
          )}
          {mirrored ? back : on}
          {mirrored ? chapterBack : chapterOn}
          <ReadingOutlook outlook={outlook} open={open} onToggle={() => setOpen((value) => !value)} />
        </div>
      </div>
    );
  }
);
ChapterDock.displayName = "ChapterDock";
