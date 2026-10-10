import { SelectionBar } from "../SelectionBar";
import { pagesViewerMaxWidth } from "../readerTypes";
import { ChapterDock } from "../ChapterDock";
import { NotePopover } from "../NotePopover";
import { ProgressBar } from "../ProgressBar";
import { LookupCard } from "../LookupCard";
import { HighlightCard } from "../HighlightCard";
import { RecapCard } from "../recap/RecapCard";
import { openQuoteCard } from "../../components/share/shareStore";
import { selectedTextBox } from "../lookupPlacement";
import { SpeedReadStage } from "./SpeedReadStage";
import type { ReaderScope } from "./scope";

/** The page: the book itself, and what sits over its foot (the selection bar, a note, the dock). */
export const ReaderPage = ({ reader }: { reader: ReaderScope }) => {
  const {
    annotations, book, bookAtFraction, bookMarks, bookRef, bookmarkPanelOpen, canSeek, chapterAtFraction,
    chapterDockRef, chapterInBook, clearSelection, closeNoteRef, copySelection, copyText, dockAbovePace, dockAwake,
    dockNear, fontSize, formatChapterDisplay, goBack, goForward, goNextSection, goPrevSection, goToNote,
    highlightBox, highlightSelection, highlights, jumps, lastCfiProgressRef, loadError, loading, lookUpShowing, measure,
    note, notesFocus, notesWrite, onClose, outlook, paged, pageOf, people, renditionRef, searchBookFor, seekHoldRef,
    seekTo, selection, selectionChapter, selectionDockBottom, selectionDockRef, setBookmarkPanelOpen, setDockNear,
    setLookUpCfi, setNotesFocus, setReloadKey, sidebarOpen, toggleContents, turnPage, viewerRef
  } = reader;
  // "Where was I?", when nothing else has the foot of the page.
  const recapShown = reader.recap !== null && !selection && !people.card && !note && !(notesFocus && !bookmarkPanelOpen) && bookRef.current;
  // A highlight opened beside the page (tapped, or just made to write a note on).
  const opened = notesFocus && !bookmarkPanelOpen && !selection && !people.card ? (highlights.find((item) => item.id === notesFocus) ?? null) : null;
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
                  inBook={people.inBook(selection.text, selection.cfi)}
                  onClose={() => setLookUpCfi(null)}
                />
              )}
              {people.card}
              {selection && (
                <SelectionBar
                  text={selection.text}
                  onHighlight={(color) => highlightSelection(color)}
                  onNote={() => highlightSelection("yellow", true)}
                  onRemoveHighlight={reader.highlightsUnderSelection(selection.cfi).length > 0 ? reader.removeHighlightsUnder : undefined}
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
          {recapShown && reader.recap && (
            <div className={`reader-selection-dock ${dockAbovePace ? "is-above-pace" : ""}`}>
              <RecapCard
                book={bookRef.current}
                place={{
                  progress: lastCfiProgressRef.current ?? book.progress ?? 0,
                  cfi: reader.readingPlaceCfi() ?? reader.lastCfiRef.current,
                  chapter: reader.chapterLabel
                }}
                days={reader.recap.days}
                chapter={reader.chapterLabel || null}
                progress={lastCfiProgressRef.current ?? book.progress ?? 0}
                highlights={highlights}
                chapterOf={reader.chapterOfSection}
                onName={
                  people.enabled
                    ? (name) => {
                        reader.setRecap(null);
                        people.askWhoIs(name, null);
                      }
                    : undefined
                }
                onOpenHighlight={(cfi) => {
                  reader.setRecap(null);
                  reader.noteJumpFromHere();
                  reader.goToPlace(cfi);
                }}
                onClose={() => reader.setRecap(null)}
              />
            </div>
          )}
          {/* A highlight and its note, in the same place. */}
          {opened && (
            <div className={`reader-selection-dock ${dockAbovePace ? "is-above-pace" : ""}`}>
              <HighlightCard
                key={opened.id}
                highlight={opened}
                writing={notesWrite}
                avoid={() => highlightBox(opened.cfi)}
                onSaveNote={(text) => void annotations.update(opened.id, { note: text || null })}
                onRecolor={(color) => void annotations.update(opened.id, { color })}
                onRemove={() => {
                  setNotesFocus(null);
                  // And any other highlight of exactly these words that has no
                  // note of its own: laid on this one by an older version,
                  // it would take this one's place on the page as if nothing
                  // had been removed.
                  highlights
                    .filter((item) => item.id === opened.id || (item.cfi === opened.cfi && !item.note?.trim()))
                    .forEach((item) => void annotations.remove(item.id));
                }}
                onCopy={() => copyText(opened.text ?? "")}
                onShare={() => openQuoteCard({ text: opened.text ?? "", title: book.title, author: book.author })}
                onShowAll={() => setBookmarkPanelOpen(true)}
                onClose={() => setNotesFocus(null)}
              />
            </div>
          )}
          {/* A footnote, in the selection bar's place: the two are never up together. */}
          {note && !selection && !people.card && !opened && (
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
