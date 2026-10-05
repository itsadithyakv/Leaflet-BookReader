import { SelectionBar } from "../SelectionBar";
import { pagesViewerMaxWidth } from "../readerTypes";
import { ChapterDock } from "../ChapterDock";
import { NotePopover } from "../NotePopover";
import { ProgressBar } from "../ProgressBar";
import { LookupCard } from "../LookupCard";
import { selectedTextBox } from "../lookupPlacement";
import { SpeedReadStage } from "./SpeedReadStage";
import type { ReaderScope } from "./scope";

/** The page: the book itself, and what sits over its foot (the selection bar, a note, the dock). */
export const ReaderPage = ({ reader }: { reader: ReaderScope }) => {
  const {
    book, bookAtFraction, bookMarks, bookRef, canSeek, chapterAtFraction, chapterDockRef, chapterInBook,
    clearSelection, closeNoteRef, copySelection, dockAbovePace, dockAwake, dockNear, fontSize, formatChapterDisplay,
    goBack, goForward, goNextSection, goPrevSection, goToNote, highlightSelection, jumps, lastCfiProgressRef,
    loadError, loading, lookUpShowing, measure, note, onClose, outlook, paged, pageOf, people, renditionRef,
    searchBookFor, seekHoldRef, seekTo, selection, selectionChapter, selectionDockBottom, selectionDockRef,
    setDockNear, setLookUpCfi, setReloadKey, sidebarOpen, toggleContents, turnPage, viewerRef
  } = reader;
  return (
    <main className="reader-main overflow-hidden">
      {loadError && (
        <div className="mx-auto mt-28 max-w-lg rounded-xl border reader-border reader-panel p-6 text-center" role="alert">
          <p className="text-sm leading-relaxed reader-text-color">{loadError}</p>
          <div className="mt-5 flex justify-center gap-3">
            <button type="button" className="rounded-lg border px-4 py-2 text-xs uppercase tracking-widest reader-border reader-pill reader-icon" onClick={onClose}>
              Back to library
            </button>
            <button
              type="button"
              className="rounded-lg border px-4 py-2 text-xs uppercase tracking-widest reader-border reader-pill reader-accent"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Try again
            </button>
          </div>
        </div>
      )}
      {!loadError && (
        <div className="reader-page-frame relative h-full overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm reader-panel-soft reader-muted">
              Loading book...
            </div>
          )}
          <div
            ref={viewerRef}
            className={`reader-container ${paged ? "reader-pages" : "reader-scroll"} h-full w-full overflow-hidden overscroll-x-none`}
            style={
              paged && pagesViewerMaxWidth(measure, fontSize) !== null
                ? { maxWidth: pagesViewerMaxWidth(measure, fontSize) ?? undefined, marginInline: "auto" }
                : undefined
            }
          />
          <SpeedReadStage reader={reader} />
          {(selection || people.card) && (
            <div
              ref={selectionDockRef}
              className={`reader-selection-dock ${dockAbovePace ? "is-above-pace" : ""}`}
              style={selection && selectionDockBottom !== null ? { bottom: selectionDockBottom } : undefined}
            >
              {/* The cards first: each places itself against the dock, above the bar. */}
              {selection && lookUpShowing && (
                <LookupCard
                  term={selection.text}
                  language={(bookRef.current as any)?.packaging?.metadata?.language}
                  avoid={() => selectedTextBox(renditionRef.current?.getContents?.() ?? [])}
                  place={{ bookId: book.id, cfi: selection.cfi, chapter: selectionChapter(), progress: lastCfiProgressRef.current ?? book.progress ?? 0 }}
                  onClose={() => setLookUpCfi(null)}
                />
              )}
              {people.card}
              {selection && (
                <SelectionBar
                  text={selection.text}
                  onHighlight={(color) => highlightSelection(color)}
                  onNote={() => highlightSelection("yellow", true)}
                  onCopy={copySelection}
                  onDismiss={clearSelection}
                  onLookUp={() => {
                    people.closeCard();
                    setLookUpCfi((open) => (open === selection.cfi ? null : selection.cfi));
                  }}
                  lookUpOpen={lookUpShowing}
                  onWhoIs={
                    people.enabled
                      ? () => {
                          setLookUpCfi(null);
                          if (people.cardOpen) {
                            people.closeCard();
                          } else {
                            people.askWhoIs(selection.text, selection.cfi);
                          }
                        }
                      : undefined
                  }
                  whoIsOpen={people.cardOpen}
                  onSearchBook={() => searchBookFor(selection.text)}
                />
              )}
            </div>
          )}
          {/* A footnote, in the selection bar's place: the two are never up together. */}
          {note && !selection && !people.card && (
            <div className={`reader-selection-dock ${dockAbovePace ? "is-above-pace" : ""}`}>
              <NotePopover
                marker={note.marker}
                paragraphs={note.paragraphs}
                truncated={note.truncated}
                onGoTo={goToNote}
                onClose={closeNoteRef.current}
              />
            </div>
          )}
          {/* Before the dock: while its handle is held the dock steps aside (see progressBar.css). */}
          {canSeek && outlook.progress !== null && !loading && (
            <ProgressBar
              value={outlook.progress}
              chapterAt={chapterAtFraction}
              bookAt={bookAtFraction}
              marks={bookMarks}
              onSeek={seekTo}
              shown={dockNear || dockAwake}
              holdRef={seekHoldRef}
            />
          )}
          <ChapterDock
            ref={chapterDockRef}
            paged={paged}
            pageOf={paged ? pageOf : null}
            label={formatChapterDisplay()}
            inBook={chapterInBook}
            onContents={toggleContents}
            contentsOpen={sidebarOpen}
            onPrev={paged ? () => turnPage(-1) : goPrevSection}
            onNext={paged ? () => turnPage(1) : goNextSection}
            onPrevChapter={goPrevSection}
            onNextChapter={goNextSection}
            outlook={outlook}
            canGoBack={jumps.back > 0}
            canGoForward={jumps.forward > 0}
            onBack={goBack}
            onForward={goForward}
            awake={dockAwake}
            onNearChange={setDockNear}
          />
        </div>
      )}
    </main>
  );
};
