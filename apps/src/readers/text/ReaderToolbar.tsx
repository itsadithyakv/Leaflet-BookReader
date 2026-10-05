import { UiIcon } from "../../components/UiIcon";
import { PipExitGuard } from "../../hooks/useFocusLockExit";
import { AnnotationsPanel } from "../AnnotationsPanel";
import { TypePanel } from "../TypePanel";
import { toolbarTitleClass } from "../titleFit";
import { ReaderAmbience } from "../../ambience";
import { ReaderMoreMenu } from "./ReaderMoreMenu";
import type { ReaderScope } from "./scope";

/** The bar across the top: back to the library, the title, and the panels' buttons. */
export const ReaderToolbar = ({ reader }: { reader: ReaderScope }) => {
  const {
    addBookmark, align, annotations, book, bookmarkPanelOpen, bookmarks, chapterInBook, chooseAlign, chooseMeasure,
    chooseSpacing, chooseTypeface, closeSearch, exitGuard, exportHighlights, fontPanelOpen, fontPanelRef, fontSize,
    hoverChrome, measure, notesFocus, openBookmark, orderedHighlights, people, revealChrome, searchOpen,
    setBookmarkPanelOpen, setFontPanelOpen, setFontSize, setNotesFocus, setSearchOpen, sidebarOpen, sidebarPinned,
    spacing, toggleContents, toolbarRef, typeface
  } = reader;
  return (
    <header
      ref={toolbarRef}
      className="reader-toolbar fixed left-0 right-0 top-0 z-50 flex w-full items-center justify-between px-6 py-5 md:px-8"
      onPointerEnter={() => hoverChrome(true)}
      onPointerLeave={() => hoverChrome(false)}
      onFocus={revealChrome}
    >
      <div className="relative flex items-center gap-2 md:gap-4">
        <button
          type="button"
          className="group flex items-center gap-2 transition-all reader-icon reader-hover-accent"
          onClick={() => void exitGuard.requestClose()}
          onMouseEnter={() => exitGuard.guard()}
          title={exitGuard.locked ? "Focus lock is on: leaving ends the session" : undefined}
        >
          <span className="material-symbols-outlined transition-transform group-hover:-translate-x-1 reader-accent">
            arrow_back
          </span>
          {/* The label is the first thing to drop on a narrow toolbar; the
              arrow carries the meaning on its own. */}
          <span className="hidden text-xs uppercase tracking-widest reader-accent sm:inline">
            Back to Library
          </span>
        </button>
        <PipExitGuard shown={exitGuard.guardShown} onDone={exitGuard.clearGuard} />
        {/* The chapter list otherwise opens only from a 6px hover strip,
            which a finger cannot hit and a touch screen cannot reveal. */}
        <button
          type="button"
          className="reader-chapters-toggle reader-icon transition-colors reader-hover-accent"
          onClick={toggleContents}
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen && sidebarPinned ? "Hide chapters" : "Show chapters"}
          title="Contents (C)"
        >
          <span className="material-symbols-outlined">list</span>
        </button>
      </div>
      <div className="absolute left-1/2 hidden -translate-x-1/2 flex-col items-center text-center md:flex">
        <h1 className={toolbarTitleClass(book.title)} title={book.title}>
          {book.title}
        </h1>
        {/* In a set of books the line under the title names the one being read: the set's own title is long and says nothing of where the reader is. */}
        <span className="max-w-[46vw] truncate text-xs uppercase tracking-[0.2em] reader-muted">
          {chapterInBook ? `${chapterInBook.book} · ` : ""}
          {book.author ?? "Unknown author"}
        </span>
      </div>
      <div className="flex items-center gap-4 md:gap-6">
        <div className="relative" ref={fontPanelRef}>
          <button
            className="reader-icon transition-colors reader-hover-accent"
            type="button"
            onClick={() => setFontPanelOpen((prev) => !prev)}
            title="Text: size, line length, typeface, spacing"
            aria-label="Text settings"
            aria-expanded={fontPanelOpen}
          >
            <span className="material-symbols-outlined">text_fields</span>
          </button>
          {fontPanelOpen && (
            <TypePanel
              fontSize={fontSize}
              onFontSize={setFontSize}
              measure={measure}
              onMeasure={chooseMeasure}
              typeface={typeface}
              onTypeface={chooseTypeface}
              spacing={spacing}
              onSpacing={chooseSpacing}
              align={align}
              onAlign={chooseAlign}
            />
          )}
        </div>
        <button
          className="reader-icon transition-colors reader-hover-accent"
          type="button"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          title="Search in this book (Ctrl+F)"
          aria-label="Search in this book"
        >
          <UiIcon name="search" size={22} />
        </button>
        {people.enabled && (
          <button
            className="reader-icon transition-colors reader-hover-accent"
            type="button"
            onClick={() => {
              if (people.panelOpen) {
                people.closePanel();
              } else {
                // The two panels share a corner.
                closeSearch();
                people.openPanel();
              }
            }}
            title="Characters"
            aria-label="Characters"
            aria-haspopup="dialog"
            aria-expanded={people.panelOpen}
          >
            <UiIcon name="people" size={22} />
          </button>
        )}
        <div className="relative">
          <button
            className="reader-icon transition-colors reader-hover-accent"
            type="button"
            onClick={() => {
              setNotesFocus(null);
              setBookmarkPanelOpen((prev) => !prev);
            }}
            title="Bookmarks and highlights"
            aria-label="Bookmarks and highlights"
          >
            <span className="material-symbols-outlined">bookmark</span>
          </button>
          {bookmarkPanelOpen && (
            <AnnotationsPanel
              key={notesFocus ?? "notes"}
              bookmarks={bookmarks}
              highlights={orderedHighlights}
              focusId={notesFocus}
              onAddBookmark={addBookmark}
              onOpen={openBookmark}
              onRemove={(id) => void annotations.remove(id)}
              onSaveNote={(id, note) => void annotations.update(id, { note: note || null })}
              onExport={exportHighlights}
            />
          )}
        </div>
        <ReaderAmbience />
        <ReaderMoreMenu reader={reader} />
      </div>
    </header>
  );
};
