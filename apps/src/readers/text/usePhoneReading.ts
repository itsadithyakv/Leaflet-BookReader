import { useEffect, useRef, useState } from "react";
import { EpubCFI } from "epubjs";
import { isPhoneShape, systemBarsHidden } from "../touchLayout";
import {
  BACK_CHIP_MS,
  FOOTER_MODE_KEY,
  backChipLabel,
  backChipShown,
  bookmarksShowing,
  readFooterMode,
  type BackChip,
  type FooterMode,
  type JumpedFrom
} from "../phoneReading";
import type { WithSelectionDock } from "./scope";

const readStoredMode = () => {
  try {
    return readFooterMode(localStorage.getItem(FOOTER_MODE_KEY));
  } catch {
    return readFooterMode(null);
  }
};

const clockNow = () => {
  try {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?(AM|PM)$/i, "");
  } catch {
    const now = new Date();
    return `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
};

/**
 * Reading on a phone (readers/phoneReading.ts): the footer's line and the mode
 * it is in, the clock it leads with while the status bar is away, the
 * bookmark corner, and the way back after a jump. Desktop and tablet get
 * nothing from it (`phone` is false there).
 */
export const usePhoneReading = (reader: WithSelectionDock) => {
  const {
    addBookmark, annotations, bookmarks, chapterLabel, chromeVisible, dockAwake, exitGuard, jumps, loading, outlook,
    renditionRef, shape, showFocusToast
  } = reader;
  const phone = isPhoneShape(shape);

  // ---- The footer ----
  const [footerMode, setFooterModeState] = useState<FooterMode>(readStoredMode);
  const setFooterMode = (mode: FooterMode) => {
    setFooterModeState(mode);
    try {
      localStorage.setItem(FOOTER_MODE_KEY, mode);
    } catch {
      // Kept for this visit only.
    }
  };
  const [clock, setClock] = useState(clockNow);
  useEffect(() => {
    if (!phone) {
      return undefined;
    }
    setClock(clockNow());
    const timer = window.setInterval(() => setClock(clockNow()), 15000);
    return () => window.clearInterval(timer);
  }, [phone]);
  const clockLeads = phone && shape === "upright" && systemBarsHidden(shape, exitGuard.locked);

  // ---- The page showing, for the bookmark corner ----
  // Held as whether it is bookmarked, not as where it is: the place changes
  // at every pause of the scrolling, and the whole reader drew again for it.
  const shownRef = useRef<{ start: string | null; end: string | null }>({ start: null, end: null });
  const cfiOrder = useRef(new EpubCFI());
  const compare = (a: string, b: string) => cfiOrder.current.compare(a, b);
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;
  const [shownMarked, setShownMarked] = useState(false);
  const lookAtMarks = () => {
    const { start, end } = shownRef.current;
    setShownMarked(bookmarksShowing(bookmarksRef.current, start, end, compare).length > 0);
  };
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!phone || loading || !rendition) {
      return undefined;
    }
    const take = (location: any) => {
      shownRef.current = {
        start: (location?.start?.cfi as string | undefined) ?? null,
        end: (location?.end?.cfi as string | undefined) ?? null
      };
      lookAtMarks();
    };
    take(rendition.location);
    rendition.on?.("relocated", take);
    return () => rendition.off?.("relocated", take);
  }, [phone, loading, renditionRef.current]);
  // A bookmark made or taken away here shows at once.
  useEffect(() => {
    if (phone) {
      lookAtMarks();
    }
  }, [bookmarks, phone]);
  const pageMarked = phone && shownMarked;

  /** A tap in the bookmark corner: the place is bookmarked, or its bookmark goes. True when it was a phone's to take. */
  const cornerBookmarkRef = useRef<() => boolean>(() => false);
  cornerBookmarkRef.current = () => {
    if (!phone) {
      return false;
    }
    const location = renditionRef.current?.location;
    const here = bookmarksShowing(bookmarks, location?.start?.cfi ?? shownRef.current.start, location?.end?.cfi ?? shownRef.current.end, compare);
    if (here.length > 0) {
      void Promise.all(here.map((mark) => annotations.remove(mark.id)))
        .then(() => showFocusToast("Bookmark removed."))
        .catch(() => showFocusToast("Couldn't remove the bookmark."));
    } else {
      addBookmark();
    }
    return true;
  };

  // ---- Back after a jump ----
  // Where the reader was before the jump: what was being read while no jump was waking the way back.
  const leftRef = useRef<JumpedFrom>({ chapter: null, progress: null });
  const [chip, setChip] = useState<BackChip>(null);
  const awakeBeforeRef = useRef(dockAwake);
  useEffect(() => {
    const rose = dockAwake && !awakeBeforeRef.current;
    awakeBeforeRef.current = dockAwake;
    if (rose && phone) {
      setChip({ at: Date.now(), from: { ...leftRef.current } });
    }
  }, [dockAwake]);
  if (!dockAwake) {
    leftRef.current = { chapter: chapterLabel || null, progress: outlook.progress };
  }
  const chipShown = phone && !chromeVisible && backChipShown(chip, Date.now(), jumps.back > 0);
  const chipLabel = chip ? backChipLabel(chip.from, { chapter: chapterLabel || null }) : "";
  const dismissChip = () => setChip(null);
  // It goes by itself, or as soon as the reader does anything else: a tap, a key (a page turned).
  useEffect(() => {
    if (!chip) {
      return undefined;
    }
    const timer = window.setTimeout(dismissChip, Math.max(0, chip.at + BACK_CHIP_MS - Date.now()));
    const away = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.(".reader-back-chip")) {
        return;
      }
      dismissChip();
    };
    // (Not the press that made the jump: it came before the chip.) The
    // book's pages are documents of their own, and the jump draws new ones.
    const docs = new Set<Document>();
    const bind = () => {
      const all: Document[] = [document];
      ((rendition?.getContents?.() as any[] | undefined) ?? []).forEach((contents) => {
        if (contents?.document) {
          all.push(contents.document as Document);
        }
      });
      all.forEach((doc) => {
        if (!docs.has(doc)) {
          docs.add(doc);
          doc.addEventListener("pointerdown", away, true);
          doc.addEventListener("keydown", away, true);
        }
      });
    };
    const rendition = renditionRef.current;
    bind();
    rendition?.on?.("rendered", bind);
    return () => {
      window.clearTimeout(timer);
      rendition?.off?.("rendered", bind);
      docs.forEach((doc) => {
        doc.removeEventListener("pointerdown", away, true);
        doc.removeEventListener("keydown", away, true);
      });
    };
  }, [chip]);
  const goBackFromChip = () => {
    dismissChip();
    reader.goBack();
  };

  return {
    phoneReading: phone,
    footerMode,
    setFooterMode,
    clock,
    clockLeads,
    pageMarked,
    cornerBookmarkRef,
    backChip: chipShown ? { label: chipLabel } : null,
    goBackFromChip
  };
};
