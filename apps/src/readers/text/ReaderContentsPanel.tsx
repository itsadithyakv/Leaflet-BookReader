import { isFinished } from "../../constants/books";
import { TOUR_CONTENTS_STEP } from "../ReaderTour";
import { List as ListIcon, X as CloseIcon } from "lucide-react";
import { ContentsList } from "../ContentsList";
import { handleSizeFor } from "../contentsPanel";
import type { ReaderScope } from "./scope";

/** The chapter list and the ways to it: the window's edge, the handle, and the page behind it. */
export const ReaderContentsPanel = ({ reader }: { reader: ReaderScope }) => {
  const {
    book, cancelReaderSidebarOpen, chapterEntry, contents, contentsBeside, contentsOver, contentsPeekRef,
    contentsPlace, goToContentsEntry, handleCoverError, loading, openReaderSidebar, outlook, pinContents,
    resolvedCover, scheduleReaderSidebarClose, scheduleReaderSidebarOpen, setSidebarOpen, sidebarOpen, sidebarPinned,
    sidebarPinnedRef, textMargin, toc, tourOpen, tourStep
  } = reader;
  return (
    <>
      <div
        className="reader-sidebar-hot-zone"
        onMouseEnter={scheduleReaderSidebarOpen}
        onMouseLeave={cancelReaderSidebarOpen}
        aria-hidden="true"
      />
      {/* The way to the chapter list that is always there, toolbar or no
          toolbar: a tab on the left edge with an icon and the word, in the
          margin beside the text and never wider than it
          (readers/contentsPanel.ts). It used to be a 16 px sliver with a
          chevron, and people did not know the list existed. A click opens
          the list to stay; it does not open under a resting pointer, so the
          click meant for it never lands on a chapter instead. */}
      <button
        type="button"
        className={`reader-contents-handle ${sidebarOpen ? "is-hidden" : ""} ${tourStep === TOUR_CONTENTS_STEP && tourOpen ? "is-spotlit" : ""}`}
        data-size={handleSizeFor(textMargin)}
        onClick={() => pinContents(true)}
        onMouseEnter={cancelReaderSidebarOpen}
        aria-label="Contents: show the chapter list"
        aria-expanded={sidebarOpen}
        title="Contents (C)"
        tabIndex={sidebarOpen ? -1 : 0}
      >
        <ListIcon size={16} aria-hidden="true" />
        <span className="reader-contents-handle-word">Contents</span>
      </button>
      <aside
        aria-hidden={!sidebarOpen}
        aria-label="Contents"
        data-beside={contentsBeside ? "true" : undefined}
        data-set={contents.books.length > 0 ? "true" : undefined}
        onMouseEnter={() => {
          // The reader has taken hold of a list that showed itself.
          contentsPeekRef.current.showing = false;
          openReaderSidebar();
        }}
        onMouseLeave={scheduleReaderSidebarClose}
        onFocus={openReaderSidebar}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            scheduleReaderSidebarClose();
          }
        }}
        className={`reader-sidebar leather-surface flex w-72 flex-col border-r px-6 py-6 text-sm reader-border ${
          sidebarOpen
            ? "reader-sidebar-open"
            : "reader-sidebar-closed pointer-events-none"
        }`}
      >
        <div className="mb-6">
          <div>
          {resolvedCover && (
            <div className="book-cover-frame mb-4 h-44 w-32 overflow-hidden border reader-border">
              <img src={resolvedCover} alt={book.title} className="h-full w-full object-cover" onError={handleCoverError} />
            </div>
          )}
          <h2 className="font-headline text-lg font-bold reader-text-color">{book.title}</h2>
          <p className="text-xs uppercase tracking-[0.2em] reader-muted">
            {book.author ?? "Unknown author"}
          </p>
          </div>
        </div>
        <div className="reader-contents-caption">
          <div className="text-xs uppercase tracking-[0.3em] reader-muted">Chapters</div>
          <button
            type="button"
            className="reader-contents-close"
            onClick={() => pinContents(false)}
            aria-label="Hide the chapter list"
            title="Hide the chapter list (C)"
            tabIndex={sidebarOpen ? 0 : -1}
          >
            <CloseIcon size={15} aria-hidden="true" />
          </button>
        </div>
        {/* The list itself (readers/ContentsList.tsx): one run of rows for a
            single work, grouped by book for a set (readers/innerBooks.ts). */}
        <ContentsList
          toc={toc}
          rows={contents.rows}
          books={contents.books}
          bytes={contents.bytes}
          active={chapterEntry}
          place={contentsPlace}
          finished={isFinished(outlook.progress ?? 0)}
          open={sidebarOpen}
          loading={loading}
          made={contents.made}
          onGo={goToContentsEntry}
        />
      </aside>

      {/* Tapping the page is the expected way to dismiss a slide-over, and
          there is no hover-out to close it with on a touch screen. */}
      {/* A list opened to stay, over the text of a wider window: a click
          on the page shuts it too (nothing is dimmed there). */}
      {contentsOver && (
        <button
          type="button"
          className={`reader-sidebar-scrim ${sidebarPinned ? "reader-sidebar-scrim-clear" : "md:hidden"}`}
          aria-label="Close chapters"
          onClick={() => (sidebarPinnedRef.current ? pinContents(false) : setSidebarOpen(false))}
        />
      )}
    </>
  );
};
