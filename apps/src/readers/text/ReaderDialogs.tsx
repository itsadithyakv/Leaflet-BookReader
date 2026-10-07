import { SearchPanel } from "../SearchPanel";
import { ReaderTour } from "../ReaderTour";
import { ImageViewer } from "../ImageViewer";
import { bookOfSection } from "../innerBooks";
import { shortcutSections } from "../readerKeys";
import { ShortcutsSheet } from "../ShortcutsSheet";
import type { ReaderScope } from "./scope";

/**
 * What opens over the whole reader: a picture, the shortcuts, characters, search, the
 * walkthrough, and choosing where a mode starts.
 */
export const ReaderDialogs = ({ reader }: { reader: ReaderScope }) => {
  const {
    beginReadingMode, bookRef, chapterInBook, chapterNameOfSection, chapterOfSection, closeSearch, contents,
    innerBooksRef, layout, openSearchHit, paged, pendingReadingMode, people, picture, readingMode, requestReadingMode,
    searchOpen, searchSeed, setPendingReadingMode, setPicture, setReadingPaused, setShortcutsOpen, setTourOpen,
    shortcutsOpen, spotlightDotty, togglePictureInk, tourOpen
  } = reader;
  return (
    <>
      {picture && <ImageViewer picture={picture} onToggleInk={togglePictureInk} onClose={() => setPicture(null)} />}

      {shortcutsOpen && (
        <ShortcutsSheet
          context={`${paged ? "Pages" : "Scrolling"} · ${
            readingMode === "smart" ? "Smart Read" : readingMode === "speed" ? "SpeedRead" : "Standard reading"
          }`}
          sections={shortcutSections({ layout, mode: readingMode })}
          onClose={() => setShortcutsOpen(false)}
        />
      )}

      {people.panel}
      {people.peek}

      {searchOpen && bookRef.current && (
        <SearchPanel
          key={searchSeed}
          initialQuery={searchSeed}
          book={bookRef.current}
          chapterOf={chapterOfSection}
          books={contents.books.map((inner) => inner.label)}
          bookOf={(section) => bookOfSection(innerBooksRef.current, section)}
          chapterNameOf={chapterNameOfSection}
          readingBook={contents.books.findIndex((inner) => inner.label === chapterInBook?.book)}
          onOpen={openSearchHit}
          onClose={closeSearch}
        />
      )}

      {tourOpen && (
        <ReaderTour
          paged={paged}
          onStep={spotlightDotty}
          onClose={() => {
            spotlightDotty(-1);
            setTourOpen(false);
          }}
          onTrySmartRead={() => requestReadingMode("smart")}
        />
      )}

      {pendingReadingMode && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-6">
          <div className="reader-panel reader-border w-full max-w-md rounded-2xl border p-6 shadow-2xl">
            <div className="text-[10px] uppercase tracking-[0.22em] reader-muted">
              {pendingReadingMode === "speed" ? "SpeedRead" : "Smart Read"}
            </div>
            <h2 className="mt-2 font-headline text-xl font-bold reader-text-color">
              Where should reading begin?
            </h2>
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                className="reader-start-choice reader-start-choice-primary"
                onClick={() => beginReadingMode(pendingReadingMode, "dot")}
              >
                <span className="material-symbols-outlined">adjust</span>
                <span>
                  <strong>Start at Dotty</strong>
                  <small>Use the line currently marked in the book</small>
                </span>
              </button>
              <button
                type="button"
                className="reader-start-choice"
                onClick={() => beginReadingMode(pendingReadingMode, "viewport")}
              >
                <span className="material-symbols-outlined">center_focus_strong</span>
                <span>
                  <strong>Start at current view</strong>
                  <small>Use the line near the centre of the page</small>
                </span>
              </button>
              <button
                type="button"
                className="reader-start-choice"
                onClick={() => beginReadingMode(pendingReadingMode, "chapter")}
              >
                <span className="material-symbols-outlined">first_page</span>
                <span>
                  <strong>Start at chapter beginning</strong>
                  <small>Begin from the first indexed word</small>
                </span>
              </button>
            </div>
            <button
              type="button"
              className="reader-start-cancel mt-4 w-full py-2 text-xs uppercase tracking-widest reader-muted transition"
              onClick={() => {
                setPendingReadingMode(null);
                setReadingPaused(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
};
