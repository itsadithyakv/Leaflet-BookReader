import { useRef } from "react";
import { useAutoHideChrome } from "../../hooks/useAutoHideChrome";
import { guessSeries } from "../../library/series";
import { usePeopleReader } from "../people/usePeopleReader";
import { isPhoneShape } from "../touchLayout";
import type { Book } from "@shared/models/book";
import type { WithKeys } from "./scope";

/** The series a book is in, as the library reckons it, or null. */
const seriesName = (book: Book): string | null => {
  const guess = guessSeries(book);
  return guess && guess !== "none" ? guess.name : null;
};

/**
 * The toolbar stepping out of the way while reading, and the characters
 * feature (readers/people), which is asked for when needed.
 */
export const useReaderChrome = (reader: WithKeys) => {
  const {
    book, bookmarkPanelOpen, exitGuard, bookRef, chapterLabel, chapterOfSection, contentsOver, fontPanelOpen, goToPlace,
    lastCfiProgressRef, lastCfiRef, loadError, loading, morePanelOpen, note, noteJumpFromHere, notesFocus, pendingReadingMode,
    picture, renditionRef, searchOpen, selection, shape, shortcutsOpen, showFocusToastRef, soundPanelOpen, tourOpen
  } = reader;
  // By finger (a phone or a tablet) the selection's bar docks at the foot of
  // the screen, where the chapter dock would be: selecting does not hold the
  // chrome up there.
  const finger = shape !== "desktop";
  // A phone: the book opens with no chrome, and only a tap in the middle of
  // the page brings it (hooks/useAutoHideChrome.ts, `immersive`).
  const immersive = isPhoneShape(shape);
  // Characters (readers/people): who is who, as far as the reader has got.
  // Everything it is handed is asked for when needed, so it can sit up here.
  const people = usePeopleReader({
    ready: !loading && loadError === null,
    bookId: book.id,
    about: { title: book.title, author: book.author, series: seriesName(book) },
    book: bookRef.current,
    rendition: renditionRef.current,
    place: () => ({
      progress: lastCfiProgressRef.current ?? book.progress ?? 0,
      cfi: lastCfiRef.current,
      chapter: chapterLabel
    }),
    chapterOf: (section) => chapterOfSection(section),
    // Through the reader's own jump, so Back returns to where the card was opened.
    goTo: (cfi) => {
      noteJumpFromHere();
      goToPlace(cfi);
    },
    toast: (message) => showFocusToastRef.current(message),
    covered: () =>
      searchOpen ||
      bookmarkPanelOpen ||
      notesFocus !== null ||
      contentsOver ||
      tourOpen ||
      fontPanelOpen ||
      note !== null ||
      picture !== null ||
      shortcutsOpen ||
      pendingReadingMode !== null
  });
  // For the development hook on the window (see where the rendition is made).
  const peopleMarkedRef = useRef(people.marked);
  peopleMarkedRef.current = people.marked;
  // The toolbar steps out of the way while reading. It stays put whenever one of
  // its own panels is open, which would otherwise vanish along with it. The
  // chapter list is not one of them: it opens on its own, under a hidden bar.
  const {
    visible: chromeVisible,
    reveal: revealChrome,
    hover: hoverChrome,
    toggle: toggleChrome,
    hide: hideChrome
  } = useAutoHideChrome(
    fontPanelOpen ||
      bookmarkPanelOpen ||
      notesFocus !== null ||
      morePanelOpen ||
      soundPanelOpen ||
      searchOpen ||
      tourOpen ||
      people.cardOpen ||
      people.panelOpen ||
      (selection !== null && !finger) ||
      // Pip at the door with her "Hold to leave", which is under the Back button.
      Boolean(exitGuard.guardShown?.hold) ||
      // (On a phone the page is all there is from the start, the opening included.)
      (loading && !immersive) ||
      loadError !== null,
    immersive
  );
  // The page renders inside an epub.js iframe, and events there do not reach
  // this document — so without binding into it, a tap on the text could never
  // bring the toolbar back on a touch screen.
  const revealChromeRef = useRef(revealChrome);
  revealChromeRef.current = revealChrome;

  return {
    people, peopleMarkedRef, chromeVisible, revealChrome, hoverChrome, toggleChrome, hideChrome,
    revealChromeRef
  };
};
