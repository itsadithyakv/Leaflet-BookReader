import type { Book } from "@shared/models/book";
import { useReaderCore } from "../readers/text/useReaderCore";
import { useReadingPace, usePaceKeeping } from "../readers/text/useReadingPace";
import { useReaderLook, useThemeChange, useTypeChange } from "../readers/text/useReaderLook";
import { useReaderScroll, useScrollWatch } from "../readers/text/useReaderScroll";
import { useReaderWords } from "../readers/text/useReaderWords";
import { useAutoScroll, useAutoScrollEngine } from "../readers/text/useAutoScroll";
import { useSmartRead, usePillRelease } from "../readers/text/useSmartRead";
import { useReaderDot, useDotSwitch } from "../readers/text/useReaderDot";
import { useReaderPlace, useResizeRelayout } from "../readers/text/useReaderPlace";
import { useChapters } from "../readers/text/useChapters";
import { useReaderOutlook } from "../readers/text/useReaderOutlook";
import { useReaderMarks, useBookAnnotations, useHighlightDrawing, useSelectionDock } from "../readers/text/useReaderMarks";
import { useNotesAndPictures } from "../readers/text/useNotesAndPictures";
import { useContentsList, useContentsListShowing } from "../readers/text/useContentsList";
import { usePageTurning, usePageInput } from "../readers/text/usePageTurning";
import { useReaderPanels, usePanelDismissal, useFirstOpen, useRecapOnReturn } from "../readers/text/useReaderPanels";
import { useReadingModes, useReadingHold, useReadingEngine, useAwakeWhileReading } from "../readers/text/useReadingModes";
import { useReaderPrefs, usePrefsSaving } from "../readers/text/useReaderPrefs";
import { useReaderSession } from "../readers/text/useReaderSession";
import { useReaderKeys } from "../readers/text/useReaderKeys";
import { useCloseBook, useBookChange } from "../readers/text/useReaderLifecycle";
import { useReaderChrome } from "../readers/text/useReaderChrome";
import { useReaderCover } from "../readers/text/useReaderCover";
import { useBookOpening } from "../readers/text/useBookOpening";
import { useKindlePlacing } from "../readers/text/useKindlePlacing";
import { ReaderToolbar } from "../readers/text/ReaderToolbar";
import { ReaderContentsPanel } from "../readers/text/ReaderContentsPanel";
import { ReaderPage } from "../readers/text/ReaderPage";
import { ReaderDialogs } from "../readers/text/ReaderDialogs";
import { ReaderSessionMarks } from "../readers/text/ReaderSessionMarks";
import { ReaderPaceControls } from "../readers/text/ReaderPaceControls";
import type { ReaderScope } from "../readers/text/scope";
import { isKindlePlace } from "../library/kindleClippings";

type ReaderViewProps = {
  book: Book;
  onClose: () => void;
  /** Open at this place (a highlight picked outside the reader) rather than where the reading stopped. */
  openAt?: string | null;
};

/**
 * The text reader (EPUB, and what converts to it). The page itself is a list:
 * its state and behaviour live in the hooks under readers/text, one file a
 * concern, and what is drawn in the components beside them. They share one
 * scope a render (readers/text/scope.ts).
 */
export const ReaderView = ({ book, onClose, openAt = null }: ReaderViewProps) => {
  // One scope a render. Each hook adds what it owns and reads the rest from it.
  // (A highlight brought from a Kindle has no place to open at: the book opens where the reading stopped.)
  const reader = { book, onClose, openAt: isKindlePlace(openAt) ? null : openAt } as ReaderScope;
  // What the reader keeps and can do. These run no effects, so their order is free.
  Object.assign(reader, useReaderCore(reader));
  Object.assign(reader, useReadingPace(reader));
  Object.assign(reader, useReaderLook(reader));
  Object.assign(reader, useReaderScroll(reader));
  Object.assign(reader, useReaderWords(reader));
  Object.assign(reader, useAutoScroll(reader));
  Object.assign(reader, useSmartRead(reader));
  Object.assign(reader, useReaderDot(reader));
  Object.assign(reader, useReaderPlace(reader));
  Object.assign(reader, useChapters(reader));
  Object.assign(reader, useReaderOutlook(reader));
  Object.assign(reader, useReaderMarks(reader));
  Object.assign(reader, useNotesAndPictures(reader));
  Object.assign(reader, useContentsList(reader));
  Object.assign(reader, usePageTurning(reader));
  Object.assign(reader, useReaderPanels(reader));
  Object.assign(reader, useReadingModes(reader));
  Object.assign(reader, useReaderPrefs(reader));

  // The effects, in the order they have always run: keep it.
  Object.assign(reader, useReaderSession(reader));
  Object.assign(reader, useReaderKeys(reader));
  useCloseBook(reader);
  usePillRelease(reader);
  Object.assign(reader, useReaderChrome(reader));
  Object.assign(reader, useReadingHold(reader));
  Object.assign(reader, useBookAnnotations(reader));
  useBookChange(reader);
  usePaceKeeping(reader);
  usePanelDismissal(reader);
  useContentsListShowing(reader);
  usePageInput(reader);
  useHighlightDrawing(reader);
  Object.assign(reader, useReaderCover(reader));
  useBookOpening(reader);
  useResizeRelayout(reader);
  useThemeChange(reader);
  useScrollWatch(reader);
  useAutoScrollEngine(reader);
  useReadingEngine(reader);
  usePrefsSaving(reader);
  useTypeChange(reader);
  useDotSwitch(reader);
  useFirstOpen(reader);
  useRecapOnReturn(reader);
  useAwakeWhileReading(reader);
  Object.assign(reader, useSelectionDock(reader));
  // Last: it waits for the book to be up, and nothing waits on it.
  useKindlePlacing(reader);

  const { chromeVisible, displayMode, focusToast, hoverChrome, isLight, pageStyle, readingMode } = reader;

  return (
    <div
      className={`reader-scope fixed inset-0 z-50 h-full w-full overflow-hidden reader-bg ${
        chromeVisible ? "" : "reader-chrome-hidden"
      } ${
        isLight ? "reader-light" : ""
      } ${displayMode === "paper" ? "reader-paper-finish" : ""} ${
        displayMode === "dark-paper" ? "reader-dark-paper-finish" : ""
      } ${
        displayMode === "true-white" ? "reader-true-white-finish" : ""
      } ${
        displayMode === "true-black" ? "reader-true-black-finish" : ""
      } ${
        readingMode === "speed" ? "reader-speed-active" : ""
      }`}
      style={pageStyle}
    >
      <ReaderToolbar reader={reader} />
      {/* The top edge of the window: resting the pointer here brings the bar
          back. The page is an iframe, so the bar cannot see the pointer
          arrive over the text; this strip can. */}
      {!chromeVisible && (
        <div className="reader-toolbar-hot-zone" aria-hidden="true" onPointerEnter={() => hoverChrome(true)}>
          <span className="reader-toolbar-handle" />
        </div>
      )}

      <div className="reader-shell">
        <ReaderContentsPanel reader={reader} />

        <ReaderPage reader={reader} />
      </div>

      <ReaderDialogs reader={reader} />

      <ReaderSessionMarks reader={reader} />

      <ReaderPaceControls reader={reader} />

      {focusToast && (
        <div className="reader-toast fixed bottom-6 right-6 z-[60]" role="status">
          <div className="rounded-full border px-4 py-2 text-[10px] uppercase tracking-widest shadow-xl reader-panel reader-border reader-muted">
            {focusToast}
          </div>
        </div>
      )}

    </div>
  );
};
