import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EpubCFI } from "epubjs";
import { selectedTextBox } from "../lookupPlacement";
import { mentionSearch, sectionOfCfi } from "./bookText";
import { isContentsPage } from "./mentions";
import { CharacterCard, type CardTarget } from "./CharacterCard";
import { peopleMarks } from "./marks";
import { PeoplePanel } from "./PeoplePanel";
import { usePeopleHover, usePeopleSwitch, useWikiMode } from "./peoplePrefs";
import { termHover, type HoverAsk } from "./termHover";
import { TermPeek } from "./TermPeek";
import { isCommonWord } from "../../services/smartReadService";
import { SheetActions } from "./SheetActions";
import { WikiChoice } from "./WikiChoice";
import { castAt, placeOrder, type Place } from "./model";
import { cleanName, namesOf, whoIs } from "./names";
import { usePeople } from "./usePeople";

// epub.js has no types for these internals.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type PeopleReaderOptions = {
  /** False where the feature has no place (the book is not open yet). The reader's own switch is read here. */
  ready?: boolean;
  bookId: string;
  /** What the book is called, for finding its fan wiki when the reader asks for one. */
  about?: { title: string; author?: string | null; series?: string | null };
  /** The epub.js book and rendition, once the book is open. */
  book: any | null;
  rendition: any | null;
  /**
   * The reader's place: its progress through the book, the CFI at the top of
   * the screen, the chapter's name. A function is asked each time a place is
   * needed, so it can read the reader's freshest figures (its refs) without a
   * render in between.
   */
  place: Place | (() => Place);
  /** A chapter's name by its place in the book (its spine index). */
  chapterOf: (section: number) => string | null;
  /** Shows a place in the book. */
  goTo: (cfi: string) => void;
  toast: (message: string) => void;
  /** Something else is over the text (a panel, a dialog): a click on a name there is not for the card. */
  covered?: boolean | (() => boolean);
};

/**
 * Characters in the reader: the card that says who someone is. One hook for
 * the reader to mount; it owns the sheet, the search of the book's own text,
 * and what is open.
 */
export const usePeopleReader = ({
  ready = true,
  bookId,
  about,
  book,
  rendition,
  place,
  chapterOf,
  goTo,
  toast,
  covered = false
}: PeopleReaderOptions) => {
  // The "Characters" switch (Settings, Reading). Off: nothing is read, marked or shown.
  const [switchedOn] = usePeopleSwitch();
  const enabled = switchedOn && ready;
  const { entries, commit } = usePeople(bookId, enabled);
  const [open, setOpen] = useState<{ target: CardTarget; here: Place; at: Place } | null>(null);
  const [panelAt, setPanelAt] = useState<{ here: Place; at: Place } | null>(null);
  // The pointer resting on a name: what the book has said of it (`TermPeek`).
  const [hoverOn] = usePeopleHover();
  const [wiki] = useWikiMode();
  const [peek, setPeek] = useState<{ ask: HoverAsk; here: Place } | null>(null);

  // Places in this edition are told apart exactly, by their CFIs.
  const order = useMemo(() => {
    const cfi = new EpubCFI();
    return placeOrder((a, b) => cfi.compare(a, b));
  }, []);

  // The book's own text, read a chapter at a time when a card asks; dropped with the book.
  // (A contents page is not read for mentions: it lists the chapters' names.)
  const chapterOfRef = useRef(chapterOf);
  chapterOfRef.current = chapterOf;
  const search = useMemo(
    () => (enabled && book ? mentionSearch(book, (section) => isContentsPage(chapterOfRef.current(section))) : null),
    [enabled, book]
  );
  useEffect(() => () => search?.clear(), [search]);

  const placeRef = useRef(place);
  placeRef.current = place;
  const renditionRef = useRef(rendition);
  renditionRef.current = rendition;

  /** The top of the screen, as the rendition last reported it (fresher than the last render). */
  const topNow = useCallback((): Place => {
    const given = placeRef.current;
    const place = typeof given === "function" ? given() : given;
    const start = renditionRef.current?.location?.start?.cfi;
    return {
      progress: Number.isFinite(place.progress) ? place.progress : 0,
      cfi: typeof start === "string" && start ? start : place.cfi ?? null,
      chapter: place.chapter ?? null
    };
  }, []);

  /**
   * Two places, for a card opened now (from a name at `anchor`, if it was).
   *
   * `here` is how far the reader has got: the furthest point on screen, since
   * everything above it has been (or is being) read. The reader's own CFI is
   * the top of the screen; a name lower down must not count as "later".
   *
   * `at` is where what is written gets stamped: the name asked about, or
   * failing one the top of the screen. Not the foot of it: a note stamped
   * there would vanish when the page is nudged back a line.
   */
  const placesNow = useCallback(
    (anchor?: string | null): { here: Place; at: Place } => {
      const top = topNow();
      let end = top.cfi ?? null;
      try {
        const location = renditionRef.current?.currentLocation?.();
        if (typeof location?.end?.cfi === "string" && location.end.cfi) {
          end = location.end.cfi;
        }
      } catch {
        // The top of the screen will do.
      }
      // A name that was clicked has been read, wherever the screen is said to end.
      if (anchor && (!end || !order.known({ p: top.progress, cfi: anchor, chapter: null }, { progress: top.progress, cfi: end }))) {
        end = anchor;
      }
      const section = anchor ? sectionOfCfi(anchor) : null;
      const chapter = (section !== null ? chapterOfRef.current(section) : null) ?? top.chapter ?? null;
      return {
        here: { progress: top.progress, cfi: end, chapter: top.chapter ?? null },
        at: { progress: top.progress, cfi: anchor ?? top.cfi ?? end, chapter }
      };
    },
    [order, topNow]
  );

  // Switched off, or another book: nothing stays open.
  useEffect(() => {
    setOpen(null);
    setPanelAt(null);
    setPeek(null);
  }, [enabled, bookId]);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  /**
   * Opens the card for a selected name: the person it is, or the name itself.
   * `cfi` is where the selection is, when it is known.
   */
  const askWhoIs = useCallback(
    (text: string, cfi?: string | null) => {
      if (!enabled || !cleanName(text)) {
        return;
      }
      const places = placesNow(cfi);
      const person = whoIs(namesOf(castAt(entriesRef.current, places.here, order)), text);
      setOpen({ target: person ? { kind: "person", id: person } : { kind: "name", text }, ...places });
    },
    [enabled, placesNow, order]
  );

  /** Opens someone's card (from a name clicked in the text at `cfi`, or the panel). */
  const openPerson = useCallback(
    (id: string, cfi?: string | null) => {
      if (enabled) {
        setOpen({ target: { kind: "person", id }, ...placesNow(cfi) });
      }
    },
    [enabled, placesNow]
  );

  const closeCard = useCallback(() => setOpen(null), []);

  /** Opens "Characters": everyone met so far, and how they are tied. */
  const openPanel = useCallback(() => {
    if (enabled) {
      setPanelAt(placesNow());
    }
  }, [enabled, placesNow]);
  const closePanel = useCallback(() => setPanelAt(null), []);

  // ---- Names marked in the text -------------------------------------------
  const openPersonRef = useRef(openPerson);
  openPersonRef.current = openPerson;
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  const marks = useMemo(
    () =>
      peopleMarks({
        onOpen: (person, cfi) => openPersonRef.current(person, cfi),
        blocked: () => {
          const over = coveredRef.current;
          return typeof over === "function" ? over() : over;
        }
      }),
    []
  );

  /**
   * The names to mark: those learned by the foot of the screen. Worked out
   * when the reader settles on a place (epub.js `relocated`, which is not
   * sent while scrolling) and when the sheet changes; with nothing on the
   * sheet, nothing is worked out at all.
   */
  const markNames = useCallback(() => {
    const sheet = entriesRef.current;
    if (sheet.length === 0) {
      marks.setNames([]);
      return;
    }
    const top = topNow();
    const end = renditionRef.current?.location?.end?.cfi;
    const here: Place = { progress: top.progress, cfi: typeof end === "string" && end ? end : top.cfi ?? null };
    marks.setNames(namesOf(castAt(sheet, here, order)));
  }, [marks, order, topNow]);

  useEffect(() => {
    if (!enabled || !rendition) {
      return;
    }
    // Chapters come and go as the page scrolls: take on the new, let go of the gone.
    // Every chapter there is a frame for, shown or not: one scrolled out of
    // sight keeps its marks for when it is scrolled back (nothing announces that).
    const sync = () => {
      let all: unknown[] | null = null;
      try {
        const views = rendition.views?.()?.all?.();
        all = Array.isArray(views) ? views.map((view: any) => view?.contents).filter(Boolean) : null;
      } catch {
        all = null;
      }
      marks.sync(all ?? rendition.getContents?.() ?? []);
    };
    sync();
    markNames();
    rendition.on?.("rendered", sync);
    rendition.on?.("removed", sync);
    rendition.on?.("relocated", markNames);
    return () => {
      rendition.off?.("rendered", sync);
      rendition.off?.("removed", sync);
      rendition.off?.("relocated", markNames);
      marks.clear();
    };
  }, [enabled, rendition, marks, markNames]);

  // ---- The pointer resting on a name -------------------------------------
  const placesNowRef = useRef(placesNow);
  placesNowRef.current = placesNow;
  const busyRef = useRef(false);
  // A card or the panel is up: the peek would only be in the way.
  busyRef.current = Boolean(open) || Boolean(panelAt);
  const hover = useMemo(
    () =>
      termHover({
        onAsk: (ask) => setPeek({ ask, here: placesNowRef.current(ask.cfi).here }),
        onLeave: () => setPeek(null),
        blocked: () => {
          const over = coveredRef.current;
          return busyRef.current || (typeof over === "function" ? over() : over);
        },
        isCommon: isCommonWord
      }),
    []
  );

  useEffect(() => {
    if (!enabled || !hoverOn || !rendition) {
      return;
    }
    const sync = () => {
      let all: unknown[] | null = null;
      try {
        const views = rendition.views?.()?.all?.();
        all = Array.isArray(views) ? views.map((view: any) => view?.contents).filter(Boolean) : null;
      } catch {
        all = null;
      }
      hover.sync(all ?? rendition.getContents?.() ?? []);
    };
    sync();
    rendition.on?.("rendered", sync);
    rendition.on?.("removed", sync);
    // The page moving, or a key, takes the peek away: it was about what was under the pointer.
    const container = rendition.manager?.container as HTMLElement | undefined;
    const dismiss = () => hover.dismiss();
    container?.addEventListener("scroll", dismiss, { passive: true });
    window.addEventListener("keydown", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      rendition.off?.("rendered", sync);
      rendition.off?.("removed", sync);
      container?.removeEventListener("scroll", dismiss);
      window.removeEventListener("keydown", dismiss, true);
      window.removeEventListener("resize", dismiss);
      hover.clear();
    };
  }, [enabled, hoverOn, rendition, hover]);

  // A card or the panel opening takes the peek's place.
  useEffect(() => {
    if (open || panelAt) {
      hover.dismiss();
    }
  }, [open, panelAt, hover]);

  // The sheet changed (a name added, something brought in).
  useEffect(() => {
    if (enabled) {
      markNames();
    }
  }, [enabled, entries, markNames]);

  const card: ReactNode =
    enabled && open ? (
      <CharacterCard
        target={open.target}
        bookId={bookId}
        entries={entries}
        here={open.here}
        at={open.at}
        order={order}
        search={search}
        chapterOf={chapterOf}
        commit={commit}
        onTarget={(target) => setOpen((current) => (current ? { ...current, target } : current))}
        onJump={(cfi) => {
          setOpen(null);
          goTo(cfi);
        }}
        onClose={closeCard}
        onToast={toast}
        avoid={() => selectedTextBox(renditionRef.current?.getContents?.())}
      />
    ) : null;

  const peekCard: ReactNode =
    enabled && hoverOn && peek && !open && !panelAt ? (
      <TermPeek
        key={peek.ask.key}
        ask={peek.ask}
        here={peek.here}
        book={{ id: bookId, title: about?.title ?? "", author: about?.author, series: about?.series }}
        entries={entries}
        order={order}
        search={search}
        chapterOf={chapterOf}
        wiki={about?.title ? wiki : "off"}
        onKeep={(on) => hover.keep(on)}
        onMore={(name, person) => {
          const cfi = peek.ask.cfi;
          hover.dismiss();
          if (person) {
            openPerson(person, cfi);
          } else {
            askWhoIs(name, cfi);
          }
        }}
        onJump={(cfi) => {
          hover.dismiss();
          goTo(cfi);
        }}
        onClose={() => hover.dismiss()}
      />
    ) : null;

  const panel: ReactNode =
    enabled && panelAt ? (
      <PeoplePanel
        bookId={bookId}
        entries={entries}
        here={panelAt.here}
        at={panelAt.at}
        order={order}
        search={search}
        commit={commit}
        onOpenPerson={(id) => openPerson(id)}
        onClose={closePanel}
        onToast={toast}
        actions={
          <>
            <SheetActions bookId={bookId} entries={entries} commit={commit} onToast={toast} />
            {about?.title && wiki !== "off" && <WikiChoice book={{ id: bookId, title: about.title, author: about.author, series: about.series }} onToast={toast} />}
          </>
        }
      />
    ) : null;

  return {
    /** The switch is on: the reader shows the "Characters" button and "Who is this?". */
    enabled,
    /** The card, to put in the selection bar's dock; null when nothing is open. */
    card,
    cardOpen: Boolean(card),
    /** "Characters", to put beside the reader's other panels; null when it is shut. */
    panel,
    panelOpen: Boolean(panel),
    /** What the book has said of the name the pointer rests on; null when it rests on none. */
    peek: peekCard,
    openPanel,
    closePanel,
    askWhoIs,
    openPerson,
    closeCard,
    /** How many chapters are held and names marked in them (for tests). */
    marked: marks.size
  };
};
