import {
  lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties
} from "react";
import { useShallow } from "zustand/react/shallow";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { ProfileButton, type SyncMode } from "./components/ProfileButton";
import { StreakButton } from "./components/streak/StreakButton";
import { StreakMoments } from "./components/streak/StreakMoments";
import { AccountDialog, accountOffered, markAccountOffered, useAccountDialog } from "./components/account/AccountDialog";
import { WelcomeModal } from "./components/WelcomeModal";
import { useShareStore } from "./components/share/shareStore";
import { usePipReactions } from "./hooks/usePipReactions";
import { useCommunityPulse } from "./hooks/useCommunityPulse";
import { usePipTabDot } from "./hooks/usePipTabDot";
import { PipHome } from "./components/PipHome";
import { PipReaderPeek } from "./components/PipReaderPeek";
// Pip out in the app comes once the library is up (below); her stylesheet stays here, in its place among the app's.
import type { PipAction } from "./components/PipWorld";
import "./components/pip/touch.css";
import { FocusDouble } from "./components/focus/FocusDouble";
import { usualFocusMinutes } from "./components/focus/focusDeal";
import { usePipStore } from "./store/pipStore";
import { usePipWardrobeStore } from "./store/pipWardrobeStore";
import { pickBeat } from "./pip/moments";
import { loadNods } from "./pip/nods";
import { loadBookScenes } from "./pip/core";

/** A book untouched this long gets dusted off when it is opened again. */
const DUSTY_BOOK_DAYS = 30;
import { MobileNav } from "./components/MobileNav";
import { UiIcon } from "./components/UiIcon";
import { clothStyle } from "./components/shelf/spine";
import { LibraryPage } from "./pages/LibraryPage";
import { PageShownContext } from "./hooks/pageShown";
import { settleStartup, settleStartupWhenIdle, useStartupSettled } from "./platform/afterStartup";
import { useLibraryStore } from "./store/libraryStore";
import { watchSyncMoments } from "./services/syncTiming";
import { pushHold } from "./services/pushHold";
import { placeChecked, withPlaceHere } from "./services/placeElsewhere";
import { useAccountStore } from "./store/accountStore";
import { connectLibraryOwner, useLibraryOwnerStore } from "./store/libraryOwnerStore";
import { LibraryOwnerSheet } from "./components/sync/LibraryOwnerSheet";
import { AccountHoldsSheet } from "./components/sync/AccountHoldsSheet";
import { StoreHoldsSheet } from "./components/sync/StoreHoldsSheet";
import { OWNER_COPY } from "./components/sync/ownerCopy";
import { FEATURES } from "./constants/features";
import { ALIVE_EVERY_MS, AWAY_FREE_MS, flowerGrowing, useHabitStore } from "./store/habitStore";
import { setAppFullscreen, watchForeground } from "./services/windowService";
import { ConfirmDialog, askConfirm } from "./components/ConfirmDialog";
import { PostDialog } from "./components/community/Posts";
import { DiscussDialogs } from "./components/discuss/DiscussDialogs";
import { SeriesEditorDialog } from "./components/SeriesEditor";
import { useHighlightsStore } from "./components/highlights/highlightsStore";
import { useLibrarySearchStore } from "./components/search/librarySearchStore";
import { RatePrompt, noteBookClosed, noteBookOpened, openStoreReview } from "./components/RatePrompt";
import { UpdateBanner } from "./components/UpdateBanner";
import { AdminHost } from "./components/admin/AdminHost";
import { AnnouncementHost } from "./components/announcements/AnnouncementHost";
import { ReminderOptIn } from "./components/ReminderOptIn";
import { useLargeBookPrompt } from "./hooks/useLargeBookPrompt";
import { usePageCovers } from "./hooks/usePageCovers";
import { useReminders } from "./hooks/useReminders";
import { useContinueShortcut } from "./platform/continueShortcut";
import { followAppTheme } from "./platform/android";
import { useAppearanceStore, watchSystemTheme } from "./store/appearanceStore";
import { bookService } from "./services/bookService";
import { converterOffer, converterService, type ConverterOffer } from "./services/converterService";
import { toastMs } from "./library/importSummary";
import { getPlatform, pickSyncFolder } from "./platform";
import type { Book } from "@shared/models/book";
import { requestSettingsSection } from "./pages/settingsSection";
import { useBackFallback } from "./platform/back";
import { useVolumePageTurns } from "./platform/volumeKeys";
import { useTouchInput } from "./platform/device";
import { watchHeaderRoom } from "./platform/headerRoom";
import { useBackClose } from "./hooks/useBackClose";
import { TouchTips } from "./components/TouchTipLayer";
import { SheetHandle } from "./components/ui/SheetHandle";
import GradualBlur from "./components/ui/GradualBlur";
import ScrollEdge, { PAGE_TINT } from "./components/ui/ScrollEdge";
import LiquidGlassDefs from "./components/ui/LiquidGlassDefs";
import { requestAddBooks } from "./hooks/useAddBooksRequest";
import {
  findBookFormat,
  getBookExtension,
  isImportableExtension,
  needsConversion
} from "./constants/bookFormats";

type Tab = "library" | "collections" | "social" | "pip" | "settings";

// Memoised: the open book, `closeReader` and `openAt` hold still while it is
// open, so the rest of the app changing (a progress save, a sync, Pip) no
// longer draws the whole reader again.
const ReaderView = lazy(() =>
  import("./pages/ReaderView").then((module) => ({ default: memo(module.ReaderView) }))
);

const PageReaderView = lazy(() =>
  import("./pages/PageReaderView").then((module) => ({ default: memo(module.PageReaderView) }))
);

// The Library is the start screen; the other tabs load the first time they
// are opened, which keeps them (and the community components) out of startup.
const CollectionsPage = lazy(() =>
  import("./pages/CollectionsPage").then((module) => ({ default: module.CollectionsPage }))
);
const SocialPage = lazy(() => import("./pages/SocialPage").then((module) => ({ default: module.SocialPage })));
const PipPage = lazy(() => import("./pages/PipPage").then((module) => ({ default: module.PipPage })));
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage }))
);
// Highlights outside the reader. It sorts them with epub.js, so it loads the
// first time it is opened rather than putting epub.js into startup.
// Pictures to share (a passage, the year): drawn only when asked for.
const QuoteCardDialog = lazy(() =>
  import("./components/share/QuoteCardDialog").then((module) => ({ default: module.QuoteCardDialog }))
);
const YearReviewDialog = lazy(() =>
  import("./components/share/YearReviewDialog").then((module) => ({ default: module.YearReviewDialog }))
);
const HighlightsDialog = lazy(() =>
  import("./components/highlights/HighlightsDialog").then((module) => ({ default: module.HighlightsDialog }))
);
// "Search inside books", from the library's search box.
const LibrarySearchDialog = lazy(() =>
  import("./components/search/LibrarySearchDialog").then((module) => ({ default: module.LibrarySearchDialog }))
);
// Pip out in the app: she comes out once the library is on screen (platform/afterStartup.ts), not with it.
const PipWorld = lazy(() => import("./components/PipWorld").then((module) => ({ default: module.PipWorld })));
// The card after a focus session: it draws the camp and her finds, so it brings
// most of the Hollow's art with it. Fetched when a session ends, not at start.
const SessionWrapUp = lazy(() =>
  import("./components/SessionWrapUp").then((module) => ({ default: module.SessionWrapUp }))
);

/** Books whose scene Pip has already shown once (see showBookNod). */
const NODS_SEEN_KEY = "leaflet.pip.nodsSeen";

/** Marks the first-run choice as made, so it is never asked twice. */
const WELCOME_KEY = "leaflet.welcomed";
/** Whether the bar at the foot of the page (the book being read) is made small. */
const DOCK_SMALL_KEY = "leaflet.nowReading.small";
/** The dock's cover with no picture: the book's cloth on a phone, as in the library. */
const DOCK_CLOTH_CLASS =
  "cloth-cover flex h-full w-full items-center justify-center " +
  "bg-surface-container-high text-on-surface-variant";

const tabLabels: Record<Tab, string> = {
  library: "Library",
  collections: "Collections",
  social: "Social",
  pip: "Pip",
  settings: "Settings"
};

const App = () => {
  const {
    books,
    filters,
    syncStatus,
    syncError,
    sync,
    metadataRefreshing,
    metadataTotal,
    metadataDone,
    loadBooks,
    loadSyncStatus,
    importPaths,
    openBook,
    startDriveAuth,
    disconnectDrive,
    setSyncFolder,
    syncNow,
    requestBackup,
    ensureBookFile,
    setFilter
  } = useLibraryStore(
    useShallow((state) => ({
      books: state.books,
      filters: state.filters,
      syncStatus: state.syncStatus,
      syncError: state.syncError,
      sync: state.sync,
      metadataRefreshing: state.metadataRefreshing,
      metadataTotal: state.metadataTotal,
      metadataDone: state.metadataDone,
      loadBooks: state.loadBooks,
      loadSyncStatus: state.loadSyncStatus,
      importPaths: state.importPaths,
      openBook: state.openBook,
      startDriveAuth: state.startDriveAuth,
      disconnectDrive: state.disconnectDrive,
      setSyncFolder: state.setSyncFolder,
      syncNow: state.syncNow,
      requestBackup: state.requestBackup,
      ensureBookFile: state.ensureBookFile,
      setFilter: state.setFilter
    }))
  );

  const [activeTab, setActiveTab] = useState<Tab>("library");
  const [selected, setSelected] = useState<Book | null>(null);
  // Where the reader opens instead of the saved place: a highlight picked in
  // the library ("Open in book"). Set together with `selected` and cleared when
  // the reader closes, so the next ordinary open resumes where reading stopped.
  const [openAt, setOpenAt] = useState<string | null>(null);
  // For long-lived listeners that need to know whether a book is open.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // A book on its way in (a pull, a converter check): shown at once, and further taps wait for it.
  const [openingBook, setOpeningBook] = useState<Book | null>(null);
  const openingRef = useRef(openingBook);
  openingRef.current = openingBook;
  // The reader's code is fetched once the app has settled, so the first book opens without waiting for it:
  // after 2.5 s, in a moment when nothing else is running (it is a long task on a slow phone).
  useEffect(() => {
    const warm = () => void import("./pages/ReaderView").catch(() => undefined);
    let idle: number | null = null;
    const handle = window.setTimeout(() => {
      // Not every WebView has idle callbacks; then it goes at once, as it used to.
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(warm, { timeout: 1500 });
      } else {
        warm();
      }
    }, 2500);
    return () => {
      window.clearTimeout(handle);
      if (idle !== null) window.cancelIdleCallback(idle);
    };
  }, []);
  // When the app started, for Pip's first coming out (she comes later than the app now, at the same time as before).
  const [startedAt] = useState(() => performance.now());
  // The start is over once the library has been read and drawn, and the page is idle (platform/afterStartup.ts):
  // then Pip comes out into the app, the Hollow's dot is worked out, the backup on launch and the lookups run.
  const startupSettled = useStartupSettled();
  const listedRef = useRef(false);
  const libraryListing = useLibraryStore((state) => state.loading);
  useEffect(() => {
    if (libraryListing) {
      listedRef.current = true;
    } else if (listedRef.current) {
      settleStartupWhenIdle();
    }
  }, [libraryListing]);
  // Whatever happens to the library, nothing waits longer than this.
  useEffect(() => {
    const timer = window.setTimeout(settleStartup, 5000);
    return () => window.clearTimeout(timer);
  }, []);
  const openingVeil = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90" role="status" aria-live="polite">
      <div className="paper-surface flex items-center gap-3 rounded-xl px-5 py-4 text-sm">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Opening book…
      </div>
    </div>
  );

  // With a book open, the library underneath is out of reach: Tab no longer
  // walks its hidden buttons, and Enter on one cannot reopen a book behind
  // the reader. Focus goes back to where it was when the book closes.
  const readingOpen = selected !== null;
  useEffect(() => {
    if (!readingOpen) {
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    const layers = Array.from(document.querySelectorAll<HTMLElement>(".app-header, .app-body"));
    layers.forEach((layer) => layer.setAttribute("inert", ""));
    previous?.blur?.();
    return () => {
      layers.forEach((layer) => layer.removeAttribute("inert"));
      if (previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [readingOpen]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  // Shown once, on the first launch that has no sync set up. The key is checked
  // eagerly so the modal never flashes for someone who has already answered.
  const [welcomeOpen, setWelcomeOpen] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) === null;
    } catch {
      return false;
    }
  });
  const [converterPromptBook, setConverterPromptBook] = useState<Book | null>(null);
  // Where the book waiting on the converter was to open, if at a highlight.
  const converterOpenAtRef = useRef<string | null>(null);
  // The converter is compiled out of mobile builds, so the prompt must explain
  // rather than offer a download that cannot succeed.
  const converterSupported = getPlatform() === "desktop";
  // Whether Leaflet may install Calibre itself. Never in the Microsoft Store
  // build, where the prompt used to offer a download that could only fail.
  const [converterOfferKind, setConverterOfferKind] = useState<ConverterOffer>("get");
  const [converterBusy, setConverterBusy] = useState(false);
  const touch = useTouchInput();

  // Which transport is carrying sync, if any. There is no account tier: sync
  // runs against the reader's own storage, so there is nothing to sign up for.
  const syncMode: SyncMode = sync.driveConnected ? "drive" : sync.folderPath ? "folder" : sync.accountBackup ? "account" : "off";

  const { activeSession, focusSettings, goalMinutes, startSession, stopSession, loadHabit } =
    useHabitStore(
      useShallow((state) => ({
        activeSession: state.activeSession,
        focusSettings: state.focusSettings,
        goalMinutes: state.snapshot.goalMinutes,
        startSession: state.startSession,
        stopSession: state.stopSession,
        loadHabit: state.load
      }))
    );
  const loadWardrobe = usePipWardrobeStore((state) => state.load);
  const fullscreenLockRef = useRef(false);
  const theme = useAppearanceStore((state) => state.theme);
  const followSystem = useAppearanceStore((state) => state.followSystem);
  const highlightsOpen = useHighlightsStore((state) => state.view !== null);
  const librarySearchOpen = useLibrarySearchStore((state) => state.query !== null);
  const quoteOpen = useShareStore((state) => state.quote !== null);
  const wrapUpOpen = useHabitStore((state) => state.wrapUp !== null);
  const yearOpen = useShareStore((state) => state.year !== null);
  const toggleTheme = useAppearanceStore((state) => state.toggleTheme);

  useEffect(() => {
    loadBooks();
    loadSyncStatus();
    // Lazy streak evaluation: the app may have been closed for days, so a break
    // is discovered on open rather than by a timer that was never running.
    // Then a focus session left running on an earlier day ends, with the
    // minutes actually read (not the days it sat open).
    void loadHabit().then(() => useHabitStore.getState().resumeSession());
    // What Pip wears everywhere (the roaming Pip, the reader peek, the wrap-up).
    void loadWardrobe();
  }, [loadBooks, loadSyncStatus, loadHabit, loadWardrobe]);

  // Left open past midnight, today's minutes and "goal met" on screen would
  // be yesterday's until something was read: the ledger is asked again.
  useEffect(() => {
    const timer = window.setInterval(() => void useHabitStore.getState().refreshForNewDay(), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => watchSystemTheme(), []);
  // Android draws its bars and its pickers by the phone's dark mode: told the app's instead.
  useEffect(() => followAppTheme(theme, followSystem), [theme, followSystem]);

  usePipReactions(selected !== null);
  // On Android, the volume keys turn the open book's pages (platform/volumeKeys.ts).
  useVolumePageTurns(selected !== null);
  usePageCovers(selected?.id ?? null);
  useLargeBookPrompt(selected !== null);
  // Community news (kudos, followers, duels): polled while signed in; the
  // count becomes a dot on the Social nav item.
  const communityUnread = useCommunityPulse();
  // Something waiting in the Hollow (a parcel, Pip's basket, the oak full): a dot on the Pip item, as on Social.
  const pipWaits = usePipTabDot();
  const navBadge = useMemo(() => ({ Social: communityUnread, Pip: pipWaits ? 1 : 0 }), [communityUnread, pipWaits]);

  // Back up on launch. The app may have been closed mid-session, and on a new
  // computer this same pass is what restores the library from Drive. Signed
  // in (`accountBackup`), the reading goes to the account whatever else is set
  // up; never for another account's library, whose sync is paused.
  const ownerPaused = sync.library?.standing === "other";
  // Once the library is on screen (`startupSettled`): the run's answer draws the library again.
  useEffect(() => {
    if ((sync.driveConnected || sync.accountBackup) && !ownerPaused && startupSettled) {
      syncNow().catch(() => {
        // startup backup failure is fine; it is recorded and retried later
      });
    }
  }, [sync.driveConnected, sync.accountBackup, ownerPaused, syncNow, startupSettled]);

  // Signed in at launch: whose this library is decides what follows (a
  // switch to the account's own, or the question). Signing in asks by itself
  // (store/accountStore.ts).
  useEffect(() => {
    void (async () => {
      const account = useAccountStore.getState();
      if (!account.loaded) await account.load(false);
      if (useAccountStore.getState().status.signedIn) await useLibraryOwnerStore.getState().resolve({ launch: true });
    })();
  }, []);

  // And as the app goes to the background (a phone may stop it any time
  // after) and comes back (services/syncTiming).
  useEffect(() => watchSyncMoments(), []);

  // Backing up to the Leaflet account ends with the session (signing out, or
  // the account deleted), and what the backup's state says has to follow.
  const signedIn = useAccountStore((state) => state.status.signedIn);
  useEffect(() => {
    void useLibraryStore.getState().loadSyncStatus();
  }, [signedIn]);

  // Closing a book is the moment progress and the habit ledger have changed, so
  // it is when a backup is worth taking. Imports and deletes schedule their own.
  const closeReader = useCallback(() => {
    noteBookClosed();
    setSelected(null);
    setOpenAt(null);
    // Highlights and notes made while it was open waited for this (services/pushHold).
    pushHold.setReading(false);
    requestBackup();
    // Highlights made or removed while reading show in the library's counts.
    void useHighlightsStore.getState().loadCounts();
  }, [requestBackup]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    // Long enough to read: a file's name and why it was not added is a paragraph.
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, toastMs(message));
  }, []);

  // Opening another library says why it can't with a toast, and closes the
  // book first so its place is saved.
  useEffect(() => connectLibraryOwner({ showToast, closeReader }), [showToast, closeReader]);

  const resolveErrorMessage = (error: unknown, fallback: string) => {
    if (typeof error === "string" && error.trim().length > 0) {
      return error;
    }
    if (error && typeof error === "object") {
      const maybeMessage = (error as { message?: unknown }).message;
      if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
        return maybeMessage;
      }
      if (typeof (error as { toString?: () => string }).toString === "function") {
        const text = (error as { toString: () => string }).toString();
        if (text && text !== "[object Object]") {
          return text;
        }
      }
    }
    return fallback;
  };

  /**
   * A book Pip knows gets a little scene from her when it is opened: always
   * the first time, then about one open in four, so it stays a surprise. One
   * she knows only by its genre gets that genre's scene, less often (NOD_ODDS).
   */
  const showBookNod = (book: Book) => {
    // The table of who gets which scene is fetched now, the first time (pip/nods.ts): it does not load with the app.
    const opened = performance.now();
    void loadNods().then(
      (nods) => playBookNod(book, nods, opened),
      () => undefined
    );
  };
  const playBookNod = (book: Book, { nodFor, nodOdds }: Awaited<ReturnType<typeof loadNods>>, opened: number) => {
    const nod = nodFor(book);
    if (!nod) {
      return;
    }
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(NODS_SEEN_KEY) ?? "[]") as string[];
    } catch {
      seen = [];
    }
    const first = !seen.includes(book.id);
    const odds = nodOdds(nod);
    const show = Math.random() < (first ? odds.first : odds.again);
    if (first) {
      try {
        localStorage.setItem(NODS_SEEN_KEY, JSON.stringify([...seen, book.id].slice(-500)));
      } catch {
        // Only means the first-time scene may play again.
      }
    }
    if (!show) {
      return;
    }
    // After the page has had a moment to appear: 2.2 s from the book's opening, whatever of that the table took to come.
    const ready = loadBookScenes();
    const wait = Math.max(0, 2200 - (performance.now() - opened));
    window.setTimeout(() => void ready.then(() => usePipStore.getState().showPeek(nod.move, nod.line, 1)), wait);
  };

  const openPreparedBook = (book: Book, at: string | null = null) => {
    const lastOpened = book.lastOpened ? Date.parse(book.lastOpened) : NaN;
    const idleDays = Number.isFinite(lastOpened) ? Math.floor((Date.now() - lastOpened) / 86_400_000) : 0;
    // Book scenes and "welcome back" lines are chatter: Quiet keeps Pip to
    // celebrations, so it skips them.
    const chatty = usePipStore.getState().mode === "chatty";
    if (!chatty) {
      // Nothing to say on opening a book.
    } else if (idleDays >= DUSTY_BOOK_DAYS) {
      const beat = pickBeat("dustyBook", `${book.id}:${book.lastOpened}`, { days: idleDays });
      usePipStore.getState().showPeek(beat.move, beat.line);
    } else {
      showBookNod(book);
    }
    noteBookOpened();
    pushHold.setReading(true);
    setSelected(book);
    setOpenAt(at);
    // A session started on no book is of the one now opened.
    useHabitStore.getState().nameSession(book);
    // Read from the store, not this render: a caller may have started a
    // session a moment ago (the board's "keep reading" does), and starting a
    // second one here would replace its length with the daily goal.
    if (focusSettings.goalBinding && !useHabitStore.getState().activeSession) {
      const duration = goalMinutes > 0 ? goalMinutes : 20;
      startSession({
        startedAt: new Date().toISOString(),
        durationMinutes: duration,
        bookId: book.id,
        title: book.title
      });
    }
    openBook(book).catch((error) => {
      showToast(resolveErrorMessage(error, "Unable to update reading progress."));
    });
  };

  /** `at` is a place to open at (a highlight's) rather than the saved one; it rides along every way in. */
  const handleOpenBook = (book: Book, at: string | null = null, resumed = false) => {
    // A second tap while a book is still on its way in would open it twice.
    if (openingRef.current && !resumed) {
      return;
    }
    // A pull first; then the book opens where this device left it, with
    // another device's place offered, never taken silently (services/placeElsewhere).
    // The page shows the book opening at once: the pull can take a moment, and a
    // tap with nothing to show for it looked missed (the owner, 2026-10-21).
    if (at === null && !placeChecked(book)) {
      setOpeningBook(book);
      void withPlaceHere(book).then((ready) => {
        setOpeningBook(null);
        handleOpenBookRef.current(ready, null, true);
      });
      return;
    }
    // Listed here (the account brought it) but with nowhere to fetch its file
    // from: the way on is the Drive the other device backs up to, so that is
    // offered, and the book opens once it is connected. It used to say only
    // that the book was "not on this computer", on a phone too.
    if (book.available === false && !sync.driveConnected && !sync.folderPath && sync.driveAvailable) {
      void askConfirm({
        title: `${book.title} isn't on this device yet`,
        body: "Its file is with your other device. Connect the Google Drive that device backs up to, and the book comes down when you open it.",
        confirmLabel: "Connect Google Drive",
        cancelLabel: "Not now"
      }).then((ok) => {
        if (!ok) return;
        showToast("Finish signing in to Google in your browser.");
        startDriveAuth()
          .then(() => handleOpenBookRef.current(book, at))
          .catch((error) => showToast(resolveErrorMessage(error, "Drive connection failed. Please retry.")));
      });
      return;
    }
    // Sync carries the library index everywhere but leaves the files where they
    // are, so a book can be listed on this device with nothing to open yet.
    if (book.available === false) {
      showToast(`Downloading ${book.title}…`);
      ensureBookFile(book)
        .then((ready) => {
          // The download can finish after another book was opened; it must
          // not swap that book out from under the reader.
          if (selectedRef.current) {
            showToast(`${ready.title} is downloaded and ready.`);
            return;
          }
          handleOpenBookRef.current(ready, at);
        })
        .catch((error) =>
          showToast(resolveErrorMessage(error, "Could not download that book."))
        );
      return;
    }

    // Every convertible format needs this gate, not just Kindle ones; and the
    // backend answers false when a cached conversion already exists.
    if (!needsConversion(getBookExtension(book.localPath))) {
      openPreparedBook(book, at);
      return;
    }

    setOpeningBook(book);
    bookService
      .needsConverter(book.id)
      .then(async (required) => {
        setOpeningBook(null);
        if (required) {
          // Asked before the prompt opens, so it never shows the wrong offer.
          const info = await converterService.status().catch(() => null);
          setConverterOfferKind(converterOffer(converterSupported, info));
          converterOpenAtRef.current = at;
          setConverterPromptBook(book);
        } else {
          openPreparedBook(book, at);
        }
      })
      .catch(() => {
        setOpeningBook(null);
        // Let the reader surface the backend's specific reason instead of
        // guessing that the converter is the problem.
        openPreparedBook(book, at);
      });
  };

  const handleOpenBookRef = useRef(handleOpenBook);
  handleOpenBookRef.current = handleOpenBook;
  // Stable identity so BookCard/BookRow memoisation is not defeated every render.
  const openBookFromLibrary = useCallback((target: Book) => {
    handleOpenBookRef.current(target);
  }, []);
  // "Open in book" on a highlight: the usual way in (download, converter),
  // and the reader opens at the highlight.
  const openBookAt = useCallback((target: Book, cfi: string) => {
    handleOpenBookRef.current(target, cfi);
  }, []);
  // The same, asked for from somewhere with no way in of its own (a note on
  // Pip's fridge, a spine in her bookcase: `openInBook`).
  const opening = useHighlightsStore((state) => state.opening);
  useEffect(() => {
    if (!opening) {
      return;
    }
    useHighlightsStore.setState({ opening: null });
    const target = useLibraryStore.getState().books.find((book) => book.id === opening.bookId);
    if (target) {
      handleOpenBookRef.current(target, opening.cfi);
    }
  }, [opening]);

  const openAssociatedPaths = useCallback(
    async (paths: string[]) => {
      const supportedPaths = Array.from(
        new Set(paths.filter((path) => isImportableExtension(getBookExtension(path))))
      );
      if (supportedPaths.length === 0) {
        // Shared to Leaflet from another app, a file it cannot read used to vanish without a word.
        if (paths.length > 0) {
          showToast(paths.length === 1 ? "Leaflet can't open that kind of file." : "Leaflet can't open those kinds of file.");
        }
        return;
      }

      try {
        const imported = await importPaths(supportedPaths);
        if (imported.length === 0) {
          return;
        }
        setActiveTab("library");
        handleOpenBookRef.current(imported[0]);
        if (imported.length > 1) {
          showToast(
            `Opened ${imported[0].title}; ${imported.length - 1} more ${
              imported.length === 2 ? "book was" : "books were"
            } added to your library.`
          );
        }
      } catch (error) {
        showToast(resolveErrorMessage(error, "Leaflet could not open that book."));
      }
    },
    [importPaths, showToast]
  );

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const drainPendingPaths = () => {
      void bookService
        .takePendingOpenPaths()
        .then((paths) => {
          if (!disposed) {
            void openAssociatedPaths(paths);
          }
        })
        .catch((error) => {
          if (!disposed) {
            showToast(resolveErrorMessage(error, "Leaflet could not receive the opened book."));
          }
        });
    };

    void listen("open-book-files", drainPendingPaths).then((stopListening) => {
      if (disposed) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      drainPendingPaths();
    }).catch((error) => {
      if (!disposed) {
        showToast(resolveErrorMessage(error, "Leaflet could not watch for opened books."));
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openAssociatedPaths, showToast]);

  const declineConverter = () => {
    if (!converterPromptBook || converterBusy) {
      return false;
    }
    setConverterPromptBook(null);
    showToast(`“${converterPromptBook.title}” stays in your library. Open it once the converter is available.`);
    return true;
  };
  useBackClose(converterPromptBook !== null, declineConverter);

  const handleConverterDownload = () => {
    if (!converterPromptBook || converterBusy) {
      return;
    }
    const book = converterPromptBook;
    setConverterBusy(true);
    converterService
      .install()
      .then(() => {
        setConverterPromptBook(null);
        showToast("Book converter ready.");
        openPreparedBook(book, converterOpenAtRef.current);
      })
      .catch((error) => {
        showToast(resolveErrorMessage(error, "Converter download failed. Check your connection and retry."));
      })
      .finally(() => {
        setConverterBusy(false);
      });
  };

  const toggleBookmark = (bookId: string, title: string) => {
    setBookmarks((prev) => {
      if (prev.includes(bookId)) {
        showToast(`Removed ${title} from bookmarks.`);
        return prev.filter((id) => id !== bookId);
      }
      showToast(`Bookmarked ${title}.`);
      return [...prev, bookId];
    });
  };

  const handleSidebarNavigate = (label: string) => {
    const entry = Object.entries(tabLabels).find(([, value]) => value === label);
    if (entry) {
      setActiveTab(entry[0] as Tab);
    }
  };

  const handleSearchChange = (value: string) => {
    setFilter({ query: value });
    if (value.trim().length > 0 && activeTab !== "library") {
      setActiveTab("library");
    }
  };

  const handleDriveConnect = () => {
    showToast("Finish signing in to Google in your browser.");
    startDriveAuth()
      .then(() => showToast("Drive connected. Your library is backed up."))
      .catch((error) => {
        // The backend distinguishes cancelled, timed out and refused, so the
        // reason reaches the reader instead of a generic failure.
        showToast(resolveErrorMessage(error, "Drive connection failed. Please retry."));
      });
  };

  const handleChooseFolder = async () => {
    try {
      const picked = await pickSyncFolder();
      if (!picked) {
        return;
      }
      await setSyncFolder(picked);
      showToast("Folder sync is on. Your library will follow this folder.");
    } catch (error) {
      showToast(resolveErrorMessage(error, "Could not use that folder."));
    }
  };

  const handleClearFolder = () => {
    setSyncFolder(null)
      .then(() => showToast("Folder sync stopped. Nothing was deleted."))
      .catch((error) => showToast(resolveErrorMessage(error, "Could not stop folder sync.")));
  };

  // The header follows the scroll on a phone: reading a long shelf should not
  // cost a permanent strip of screen. It comes straight back on any upward
  // scroll, and the CSS confines all of this to small or short viewports, so a
  // desktop window keeps its fixed header.
  const [headerHidden, setHeaderHidden] = useState(false);
  const headerHiddenRef = useRef(false);
  const lastScrollRef = useRef(0);
  // There the header lies over the page, which scrolls up through its room
  // (index.css): the shell is told how tall the header's body is, before the
  // first paint; the status bar's part of it is CSS's (platform/headerRoom.ts).
  const shellRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const header = headerRef.current;
    if (!shell || !header) {
      return;
    }
    return watchHeaderRoom(shell, header);
  }, []);

  const handleMainScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    const top = event.currentTarget.scrollTop;
    const previous = lastScrollRef.current;
    // Ignore jitter, and never hide it while still near the top -- there the
    // header is the only thing identifying where you are.
    if (Math.abs(top - previous) > 6) {
      // The account panel is anchored to the header, so sliding the header away
      // would take the panel with it.
      // Set only when it changes: this runs on every scroll event, and App is the whole shell.
      // Only where the header floats over the page (a phone's shapes): beside the rail it never
      // moves, and the shell drawn again at each turn of the wheel was work for nothing.
      const floats = document.documentElement.dataset.shape !== "wide";
      const hide = floats && !accountPanelOpen && top > previous && top > 72;
      if (hide !== headerHiddenRef.current) {
        headerHiddenRef.current = hide;
        setHeaderHidden(hide);
      }
      lastScrollRef.current = top;
    }
  }, [accountPanelOpen]);

  const dismissWelcome = useCallback(() => {
    setWelcomeOpen(false);
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      // Refusing to remember the answer is better than refusing to start.
    }
    // First run: then, once, an account (skippable), when there is a server
    // to have one on; Pip's tour waits for both.
    if (FEATURES.accounts && useLibraryStore.getState().sync.apiBase && !accountOffered()) {
      markAccountOffered();
      useAccountDialog.getState().show("signup", true);
      return;
    }
    // Pip shows the new reader around, once it has come out.
    window.setTimeout(() => usePipStore.getState().startTour(), 2200);
  }, []);

  // The first-run account step closing (done or skipped) starts Pip's tour.
  const accountStepOpen = useAccountDialog((state) => state.open && state.firstRun);
  const accountStepWasOpen = useRef(false);
  useEffect(() => {
    if (accountStepOpen) {
      accountStepWasOpen.current = true;
      return;
    }
    if (accountStepWasOpen.current) {
      accountStepWasOpen.current = false;
      const timer = window.setTimeout(() => usePipStore.getState().startTour(), 1400);
      return () => window.clearTimeout(timer);
    }
  }, [accountStepOpen]);

  const closeProfile = useCallback(() => setAccountPanelOpen(false), []);

  // Android's Back, once nothing is open over the page: another tab goes back
  // to the Library; the Library itself lets Leaflet go to the background.
  // (A book open has the reader's own, asked first while it is open.)
  useBackFallback(() => {
    if (selectedRef.current || activeTab === "library") {
      return false;
    }
    setActiveTab("library");
    return true;
  });

  // First launch shows one thing at a time: the welcome screen alone, then
  // Pip comes out and starts the tour.
  const welcomeShowing = welcomeOpen && !sync.driveConnected && !sync.folderPath;
  useEffect(() => {
    usePipStore.getState().setWaiting(welcomeShowing || accountStepOpen);
  }, [welcomeShowing, accountStepOpen]);

  // The tour points at the Library, so it starts there.
  const tourRunning = usePipStore((state) => state.tour !== null);
  useEffect(() => {
    if (tourRunning) {
      setActiveTab("library");
    }
  }, [tourRunning]);

  const handleDisconnectDrive = () => {
    disconnectDrive()
      .then(() => showToast("Drive disconnected. Your books stay on this device."))
      .catch((error) => showToast(resolveErrorMessage(error, "Could not disconnect Drive.")));
  };

  // Focus lock: the window goes fullscreen for the length of a session. Keyed
  // on "a session is running" rather than the session object, which changes
  // whenever it is extended or its away time is updated.
  const sessionRunning = activeSession !== null;
  const focusLocked = focusSettings.kioskMode && sessionRunning;
  useEffect(() => {
    if (fullscreenLockRef.current === focusLocked) {
      return;
    }
    fullscreenLockRef.current = focusLocked;
    void setAppFullscreen(focusLocked);
  }, [focusLocked]);

  // Switching to another app during a session. Leaflet does not try to stop
  // it (it cannot, and should not), but the session clock stops while you are
  // away, and Pip notices when you come back.
  useEffect(() => {
    if (!sessionRunning) {
      return;
    }
    return watchForeground((inFront) => {
      const growing = flowerGrowing(useHabitStore.getState().activeSession);
      const stint = useHabitStore.getState().setForeground(inFront);
      if (!inFront || stint < AWAY_FREE_MS) {
        return;
      }
      const minutes = Math.max(1, Math.round(stint / 60_000));
      // A flower that wilted while Leaflet was away is the news; else the time.
      const flower = useHabitStore.getState().activeSession?.flower;
      const beat =
        growing && flower?.wilted
          ? pickBeat("flowerWilted", Date.now(), { name: flower.kind })
          : pickBeat("awayReturn", Date.now(), { minutes });
      if (selectedRef.current) {
        usePipStore.getState().showPeek(beat.move, beat.line);
      } else {
        usePipStore.getState().react(beat.move, { loops: 1, line: beat.line });
      }
    });
  }, [sessionRunning]);

  // A session growing a flower notes that Leaflet is running, so a relaunch can
  // tell a quick restart from a long absence (see resumeSession).
  const flowerAlive = useHabitStore((state) => flowerGrowing(state.activeSession));
  useEffect(() => {
    if (!flowerAlive) {
      return;
    }
    const keepAlive = () => useHabitStore.getState().keepAlive();
    keepAlive();
    const timer = window.setInterval(keepAlive, ALIVE_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [flowerAlive]);

  const handleSync = () => {
    if (ownerPaused) {
      showToast(OWNER_COPY.pausedToast);
      return;
    }
    if (syncMode === "off") {
      showToast("Connect Google Drive in Settings to back up your library.");
      return;
    }
    syncNow({ manual: true })
      .then((report) => {
        if (report.ownerPaused) {
          showToast(OWNER_COPY.pausedToast);
          return;
        }
        // The account held a library from before: the question is up instead.
        if (typeof report.accountHolds === "number") return;
        showToast("Library backed up.");
        const beat = pickBeat("backup", Date.now());
        usePipStore.getState().react(beat.move, { loops: 1, line: beat.line });
      })
      .catch((error) => {
        // The backend names the cause -- full Drive, rate limit, expired
        // session -- rather than reporting an unexplained failure.
        showToast(resolveErrorMessage(error, "Backup failed."));
      });
  };

  const lastOpenedBook = useMemo(() => {
    if (books.length === 0) {
      return null;
    }
    return [...books].sort((a, b) => {
      const aTime = Date.parse(a.lastOpened ?? a.createdAt);
      const bTime = Date.parse(b.lastOpened ?? b.createdAt);
      return bTime - aTime;
    })[0];
  }, [books]);
  const nowReading = lastOpenedBook ?? books[0] ?? null;

  // The board's "keep reading": a session long enough to pass the next reader,
  // on the book you were last reading. With no books yet, the library.
  const readNow = useCallback(
    (minutes: number) => {
      if (!nowReading) {
        setActiveTab("library");
        return;
      }
      if (!useHabitStore.getState().activeSession) {
        startSession({
          startedAt: new Date().toISOString(),
          durationMinutes: minutes,
          bookId: nowReading.id,
          title: nowReading.title
        });
      }
      handleOpenBookRef.current(nowReading);
    },
    [nowReading, startSession]
  );

  // One-tap Focus (the Library's key and card, Pip's menu): a session at the
  // usual length on the book being read; with no book, on none, in the library.
  const startFocus = (minutes: number = usualFocusMinutes(goalMinutes)) => {
    if (nowReading) {
      readNow(minutes);
      return;
    }
    setActiveTab("library");
    if (!useHabitStore.getState().activeSession) {
      startSession({ startedAt: new Date().toISOString(), durationMinutes: minutes });
    }
  };
  // The same, with one identity for the Library (memoised: it is not drawn again with the shell).
  const startFocusRef = useRef(startFocus);
  startFocusRef.current = startFocus;
  const startFocusFromLibrary = useCallback((minutes?: number) => startFocusRef.current(minutes), []);

  // A clicked reading reminder: pick up the last book, once the library has
  // loaded (a click can be what launched the app). Never over an open book.
  const [reminderRoute, setReminderRoute] = useState<string | null>(null);
  useReminders(selected !== null, setReminderRoute);
  // The icon's "Continue <book>" shortcut (Android): that book, at its place;
  // the library when it is gone (an open book stays open then).
  useContinueShortcut((book) => {
    if (!book) {
      if (!selectedRef.current) setActiveTab("library");
      return;
    }
    if (selectedRef.current?.id === book.id) return;
    if (selectedRef.current) closeReader();
    setActiveTab("library");
    handleOpenBookRef.current(book);
  });
  const libraryLoading = useLibraryStore((state) => state.loading);
  useEffect(() => {
    if (!reminderRoute || libraryLoading) {
      return;
    }
    setReminderRoute(null);
    if (selectedRef.current) {
      return;
    }
    setActiveTab("library");
    if (reminderRoute === "continue" && nowReading) {
      handleOpenBookRef.current(nowReading);
    }
  }, [reminderRoute, libraryLoading, nowReading]);
  // The book scenes arrive in their own chunk once the app is up.
  useEffect(() => {
    const load = () => void loadBookScenes();
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(load, { timeout: 8000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(load, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  // Pip's idle time sometimes plays the current book's scene. She is told the
  // book, not whether she knows it: she looks it up herself when the moment
  // comes (PipWorld), which is when the table of nods is first fetched.
  useEffect(() => {
    usePipStore.getState().setBookNod(
      nowReading ? { title: nowReading.title, author: nowReading.author ?? null, genres: nowReading.genres ?? null } : null
    );
  }, [nowReading?.id, nowReading?.title, nowReading?.author, nowReading?.genres?.join("|")]);
  const [nowReadingFallback, setNowReadingFallback] = useState<string | null>(null);
  // The bar at the foot of the page, made small: the reader's choice, kept.
  const [dockSmall, setDockSmall] = useState(() => {
    try {
      return localStorage.getItem(DOCK_SMALL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const shrinkDock = (small: boolean) => {
    setDockSmall(small);
    try {
      localStorage.setItem(DOCK_SMALL_KEY, small ? "1" : "0");
    } catch {
      // It is small until the app is closed.
    }
  };
  const nowReadingCover =
    nowReading?.coverUrl && nowReading.coverUrl.startsWith("http") ? nowReading.coverUrl : null;
  const nowBookmarked = nowReading ? bookmarks.includes(nowReading.id) : false;
  const nowReadingProgress = Math.round(
    Math.min(1, Math.max(0, nowReading?.progress ?? 0)) * 100
  );

  useEffect(() => {
    setNowReadingFallback(null);
  }, [nowReading?.id, nowReading?.coverUrl]);

  useEffect(() => {
    if (!isTauri() || !nowReading?.coverUrl || nowReading.coverUrl.startsWith("http")) {
      return;
    }
    void bookService
      .coverData(nowReading.id)
      .then((data) => {
        if (data) {
          setNowReadingFallback(data);
        }
      })
      .catch(() => undefined);
  }, [nowReading?.id, nowReading?.coverUrl]);

  const handleNowReadingError = () => {
    if (!nowReading) {
      return;
    }
    void bookService
      .coverData(nowReading.id)
      .then((data) => {
        if (data) {
          setNowReadingFallback(data);
        }
      })
      .catch(() => undefined);
  };

  const resolvedNowReadingCover = nowReadingFallback ?? nowReadingCover;
  const nowReadingCloth = clothStyle(nowReading?.id || nowReading?.title || "") as CSSProperties;
  // Page-image formats (PDF, comics) use the page reader; everything else is
  // reflowable text.
  const selectedDelivery = selected
    ? findBookFormat(getBookExtension(selected.localPath))?.delivery
    : undefined;

  // The streak's "read today": the book being read, with a session on it, or a session from the Library.
  const streakRead = () => {
    const minutes = goalMinutes > 0 ? goalMinutes : 20;
    if (nowReading) {
      readNow(minutes);
      return;
    }
    setActiveTab("library");
    if (!useHabitStore.getState().activeSession) {
      startSession({ startedAt: new Date().toISOString(), durationMinutes: minutes });
    }
  };
  const streakReadLabel = nowReading ? "Read now" : "Start a session";
  // The month's calendar is on Social's Stats tab.
  const openStreakCalendar = () => {
    try {
      localStorage.setItem("leaflet.social.view", "stats");
    } catch {
      // The tab opens on whichever view it kept.
    }
    setActiveTab("social");
  };

  // Pip's right-click menu: the few things worth a shortcut from anywhere.
  const pipActions: PipAction[] = [];
  if (nowReading) {
    pipActions.push({ id: "continue", label: `Continue ${nowReading.title}`, run: () => handleOpenBook(nowReading) });
  }
  if (activeSession) {
    pipActions.push({
      id: "end-session",
      label: "End focus session",
      run: () => void stopSession({ reason: "manual_end", cleanSession: false })
    });
  } else {
    const minutes = usualFocusMinutes(goalMinutes);
    pipActions.push({
      id: "start-session",
      label: `Start a ${minutes}-minute session`,
      badge: <FocusDouble />,
      run: () => startFocus(minutes)
    });
  }
  if (sync.driveConnected) {
    pipActions.push({ id: "backup", label: "Back up now", run: handleSync });
  }
  pipActions.push({ id: "rate", label: "Rate Leaflet ★", run: () => void openStoreReview() });

  return (
    <div
      ref={shellRef}
      className="app-shell flex flex-col font-body text-on-surface selection:bg-primary-container selection:text-on-primary-container"
      // What the shell's rules key on (not `:has()`, which made every insertion restyle the whole page:
      // styles/hasSelectors.test.ts): the book being read's bar at the foot, and the header away.
      data-dock={nowReading && activeTab !== "pip" ? (dockSmall ? "small" : "full") : undefined}
      data-header-hidden={headerHidden ? "" : undefined}
    >
      <header
        ref={headerRef}
        className={`app-header paper-toolbar sticky top-0 z-50 flex w-full shrink-0 items-center justify-between gap-2 border-x-0 border-t-0 py-3 md:gap-4 ${
          headerHidden ? "app-header-hidden" : ""
        }`}
      >
        {/* Where the header floats over the page (a phone, a narrow window), this is its glass:
            the page going up under it blurs and fades in a ramp, and only while some is there
            (styles/glass.css, `.app-header-edge`; not drawn beside the rail on a desktop). */}
        <GradualBlur
          className="app-header-edge"
          position="top"
          height="calc(100% + 1.75rem)"
          strength={2}
          layers={6}
          touchLayers={3}
          curve="ease-out"
          tint="rgb(var(--color-background) / 0.9)"
          autoHide
          container=".app-main-scroll"
          duration={0.2}
          zIndex={-1}
          style={{ top: "-1px", left: "-1px", right: "-1px" }}
        />
        <div className="flex shrink-0 items-center gap-3">
          {/* Pip is the logo, and the logo is Pip's home: it hops out of here
              into the app and comes back here to rest. */}
          <PipHome />
          {/* Hidden only in the band where the header also carries search and
              space is genuinely contested. Below `md` the page owns search, and
              at `lg` there is room for both. */}
          <span className="leaflet-wordmark text-2xl sm:text-3xl md:hidden lg:inline">
            Leaflet
          </span>
        </div>
        {/* Below `md` the Library page carries search itself, full width and in
            context, which is a better home for it than a squeezed header. */}
        <div className="header-search hidden min-w-0 flex-1 md:block md:px-6">
          <div className="relative mx-auto max-w-xl" data-tour="search">
            <UiIcon
              name="search"
              size={19}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              className="inset-field w-full py-2.5 pl-12 pr-4 text-sm text-on-surface focus:border-primary/50 focus:outline-none"
              placeholder="Search your library…"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              value={filters.query}
              onChange={(event) => handleSearchChange(event.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          {/* On a phone by a finger the Library's + is up here, either way up (a + floating over the
              shelf lay over its controls); and in a window short of height. */}
          {activeTab === "library" && (
            <button
              type="button"
              className="key-button header-add-books"
              data-tour="import"
              onClick={requestAddBooks}
              title="Add books"
              aria-label="Add books"
            >
              <UiIcon name="plus" size={20} />
            </button>
          )}
          {/* Not on a phone: Settings has the theme (and following the system's), and the header has less in it. */}
          <button
            type="button"
            className="key-button header-theme-key"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <UiIcon name={theme === "dark" ? "sun" : "moon"} size={19} />
          </button>
          <StreakButton onRead={streakRead} readLabel={streakReadLabel} onOpenCalendar={openStreakCalendar} />
          <ProfileButton
            open={accountPanelOpen}
            onToggle={() => setAccountPanelOpen((prev) => !prev)}
            onClose={closeProfile}
            mode={syncMode}
            status={syncStatus}
            sync={sync}
            error={syncError}
            onConnectDrive={() => {
              closeProfile();
              handleDriveConnect();
            }}
            onDisconnectDrive={() => {
              closeProfile();
              handleDisconnectDrive();
            }}
            onChooseFolder={() => {
              closeProfile();
              void handleChooseFolder();
            }}
            onClearFolder={() => {
              closeProfile();
              handleClearFolder();
            }}
            onSyncNow={handleSync}
            onOpenSettings={() => {
              closeProfile();
              setActiveTab("settings");
            }}
            onOpenProfile={() => {
              closeProfile();
              setActiveTab("social");
            }}
          />
        </div>
      </header>

      <div className="app-body flex min-h-0 flex-1 overflow-hidden">
        {/* The rail carries navigation on anything but an upright phone —
            including a phone in landscape, where a bottom bar would eat the
            one dimension that is already scarce. */}
        <div className="sidebar-stage relative hidden h-full w-[78px] shrink-0 md:block short:block">
          <Sidebar
            activeItem={tabLabels[activeTab]}
            onNavigate={handleSidebarNavigate}
            onStartReading={() => nowReading && handleOpenBook(nowReading)}
            startDisabled={!nowReading}
            badge={navBadge}
          />
        </div>
        <main
          className="app-main-scroll relative min-w-0 flex-1 overflow-y-auto overscroll-y-contain bg-transparent px-4 py-6 md:px-8 md:py-8"
          onScroll={handleMainScroll}
        >
          {/* The page meets the toolbar beside the rail in a ramp of blur, not a hard line
              (not on Pip's own page, which keeps its paper). */}
          {activeTab !== "pip" && <ScrollEdge edge="top" className="app-main-edge" height="3rem" strength={1.25} tint={PAGE_TINT} />}
          {/* Pip stands in here while it is on a card, so it scrolls with the
              card natively instead of chasing it a frame behind. */}
          <div className="pip-scroll-layer" data-pip-scroll-layer />
          {/* Kept while another tab is up, out of the layout and at rest (hooks/pageShown.ts): coming back
              to it used to build the whole shelf again. */}
          <PageShownContext.Provider value={activeTab === "library"}>
            <LibraryPage
              onOpenBook={openBookFromLibrary}
              onNavigate={setActiveTab}
              showToast={showToast}
              onStartFocus={startFocusFromLibrary}
            />
          </PageShownContext.Provider>
          <Suspense fallback={null}>
            {activeTab === "collections" && (
              <CollectionsPage onNavigate={setActiveTab} onOpenBook={openBookFromLibrary} showToast={showToast} />
            )}
            {activeTab === "social" && (
              <SocialPage
                showToast={showToast}
                nowReading={nowReading}
                onReadNow={readNow}
                onNavigate={(tab) => {
                  // The Social page sends readers to Settings to sign in.
                  if (tab === "settings") {
                    requestSettingsSection("account");
                  }
                  setActiveTab(tab);
                }}
              />
            )}
            {activeTab === "pip" && (
              <PipPage
                showToast={showToast}
                openSocial={() => setActiveTab("social")}
                onNavigate={setActiveTab}
                onOpenProfile={() => setAccountPanelOpen(true)}
              />
            )}
            {activeTab === "settings" && <SettingsPage showToast={showToast} />}
          </Suspense>
          {activeTab !== "pip" && (
            <ScrollEdge edge="bottom" className="app-main-edge" height="4.5rem" strength={1.75} touchLayers={2} tint={PAGE_TINT} />
          )}
        </main>
      </div>

      {/* Not on Pip's page: it sat over her own row of buttons, and "Continue" is among those. */}
      {nowReading && activeTab !== "pip" && dockSmall && (
        <div className="now-reading-dock is-small pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 px-4">
          <div className="now-reading-bar is-small pointer-events-auto">
            <button
              type="button"
              className="now-reading-cover"
              onClick={() => shrinkDock(false)}
              aria-label={`Show ${nowReading.title}`}
              title={`${nowReading.title} · ${nowReadingProgress}%`}
            >
              {resolvedNowReadingCover ? (
                <img src={resolvedNowReadingCover} alt="" className="h-full w-full object-cover" onError={handleNowReadingError} />
              ) : (
                <span className={DOCK_CLOTH_CLASS} style={nowReadingCloth}>
                  <UiIcon name="book-open" size={15} strokeWidth={1.7}
                    className="cloth-cover-note" />
                </span>
              )}
            </button>
            <button
              className="now-reading-action now-reading-action-primary"
              type="button"
              onClick={() => handleOpenBook(nowReading)}
              aria-label={`Continue reading ${nowReading.title}`}
              title={`Continue ${nowReading.title}`}
            >
              <UiIcon name="play" size={15} fill="currentColor" />
            </button>
          </div>
        </div>
      )}
      {nowReading && activeTab !== "pip" && !dockSmall && (
        <div className="now-reading-dock pointer-events-none fixed bottom-6 left-1/2 z-50 w-full max-w-xl -translate-x-1/2 px-4">
          <div className="now-reading-bar pointer-events-auto">
            <div className="now-reading-cover">
              {resolvedNowReadingCover ? (
                <img
                  src={resolvedNowReadingCover}
                  alt={`${nowReading.title} cover`}
                  className="h-full w-full object-cover"
                  onError={handleNowReadingError}
                />
              ) : (
                <div className={DOCK_CLOTH_CLASS} style={nowReadingCloth}>
                  <UiIcon name="book-open" size={19} strokeWidth={1.7}
                    className="cloth-cover-note" />
                </div>
              )}
            </div>
            <div className="now-reading-details">
              <div className="flex items-center justify-between gap-3">
                <h5 className="truncate font-headline text-base font-bold text-on-surface">
                  {nowReading.title}
                </h5>
                <span className="now-reading-percent">{nowReadingProgress}%</span>
              </div>
              <p className="truncate text-xs text-on-surface-variant">
                {nowReading.author ?? "Unknown author"}
              </p>
              <div
                className="now-reading-progress"
                role="progressbar"
                aria-label={`${nowReading.title} reading progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={nowReadingProgress}
              >
                <span style={{ width: `${nowReadingProgress}%` }} />
              </div>
            </div>
            <div className="now-reading-actions">
              <button
                className="now-reading-action"
                type="button"
                onClick={() => nowReading && toggleBookmark(nowReading.id, nowReading.title)}
                aria-label={nowBookmarked ? "Remove bookmark" : "Bookmark book"}
              >
                <UiIcon name="bookmark" size={18} fill={nowBookmarked ? "currentColor" : "none"} />
              </button>
              <button
                className="now-reading-action now-reading-action-primary"
                type="button"
                onClick={() => handleOpenBook(nowReading)}
                aria-label={`Continue reading ${nowReading.title}`}
              >
                <UiIcon name="play" size={17} fill="currentColor" />
              </button>
              <button
                className="now-reading-shrink"
                type="button"
                onClick={() => shrinkDock(true)}
                aria-label="Make this bar small"
                title="Make this bar small"
              >
                <UiIcon name="down" size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="app-toast paper-surface rounded-lg px-4 py-3 text-sm text-on-surface" role="status">
          {toast}
        </div>
      )}

      {metadataRefreshing && books.length >= 60 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="modal-surface flex flex-col items-center gap-3 rounded-xl px-6 py-4 text-sm text-on-surface">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <div className="text-center">
              <p className="text-sm font-semibold text-on-surface">Refreshing library metadata</p>
              <p className="text-xs text-on-surface-variant">
                {metadataDone}/{metadataTotal} books
              </p>
            </div>
          </div>
        </div>
      )}

      {converterPromptBook && (
        <div className="sheet-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-6">
          <div
            className="modal-surface dialog-fit sheet-panel w-full max-w-md p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="converter-dialog-title"
          >
            <SheetHandle onClose={declineConverter} />
            <div className="flex items-start gap-4">
              <div className="paper-surface-raised flex h-12 w-12 shrink-0 items-center justify-center text-primary">
                <UiIcon name="book-open" size={23} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                  {converterOfferKind === "install" ? "Optional download" : converterOfferKind === "none" ? "Needs a computer" : "Needs Calibre"}
                </p>
                <h2 id="converter-dialog-title" className="page-title mt-1 text-2xl">
                  Open {getBookExtension(converterPromptBook.localPath).toUpperCase()} books
                </h2>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-on-surface-variant">
              {converterOfferKind === "install" ? (
                <>
                  “{converterPromptBook.title}” needs the Calibre conversion tools. Downloading
                  them uses about 200 MB plus installation space. Leaflet will keep the installer
                  out of the app package and remove the downloaded installer after setup. If
                  Calibre is already installed on this computer, Leaflet will use it instead.
                </>
              ) : converterOfferKind === "get" ? (
                <>
                  “{converterPromptBook.title}” needs Calibre, a free app. Get it from
                  calibre-ebook.com and install it, then open this book again. Leaflet finds
                  Calibre by itself; there is no need to restart.
                </>
              ) : (
                <>
                  “{converterPromptBook.title}” needs Calibre to open, and Calibre has no version for
                  this device. Convert it to EPUB on a computer and add that instead.
                </>
              )}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="tactile-button px-4 py-2 text-sm"
                onClick={declineConverter}
                disabled={converterBusy}
              >
                {converterSupported ? "Not now" : "Close"}
              </button>
              {converterOfferKind === "install" && (
                <button
                  type="button"
                  className="tactile-button tactile-button-primary min-w-36 px-4 py-2 text-sm font-bold"
                  onClick={handleConverterDownload}
                  disabled={converterBusy}
                >
                  {converterBusy ? "Downloading…" : "Download & install"}
                </button>
              )}
              {converterOfferKind === "get" && (
                <button
                  type="button"
                  className="tactile-button tactile-button-primary min-w-36 px-4 py-2 text-sm font-bold"
                  onClick={() => {
                    setConverterPromptBook(null);
                    converterService
                      .openDownloadPage()
                      .catch(() => showToast("Couldn't open your browser. Calibre is at calibre-ebook.com."));
                  }}
                >
                  Get Calibre
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {openingBook && !selected && openingVeil}

      {selected && (
        <Suspense fallback={openingVeil}>
          {selectedDelivery === "pdf" || selectedDelivery === "comic" ? (
            <PageReaderView
              key={selected.id}
              book={selected}
              kind={selectedDelivery === "comic" ? "comic" : "pdf"}
              onClose={closeReader}
              openAt={openAt}
            />
          ) : (
            <ReaderView key={selected.id} book={selected} onClose={closeReader} openAt={openAt} />
          )}
        </Suspense>
      )}

      {/* Pip lives over the app; while a book is open it waits (hidden) and
          celebrations come through the reader peek instead. */}
      {startupSettled && (
        <Suspense fallback={null}>
          <PipWorld actions={pipActions} startedAt={startedAt} />
        </Suspense>
      )}
      {selected && <PipReaderPeek />}

      {/* The streak's moments (a goal met, a day saved, a milestone, a streak lost), once each, never over a book. */}
      <StreakMoments paused={selected !== null || wrapUpOpen} onRead={streakRead} />

      {/* After the reader, so a session that ends mid-book wraps up on top. */}
      {wrapUpOpen && (
        <Suspense fallback={null}>
          <SessionWrapUp />
        </Suspense>
      )}
      <PostDialog showToast={showToast} />
      <DiscussDialogs showToast={showToast} />
      <ConfirmDialog />
      <SeriesEditorDialog />
      {highlightsOpen && (
        <Suspense fallback={null}>
          <HighlightsDialog onOpenInBook={openBookAt} />
        </Suspense>
      )}
      {librarySearchOpen && (
        <Suspense fallback={null}>
          <LibrarySearchDialog onOpenInBook={openBookAt} />
        </Suspense>
      )}
      {quoteOpen && (
        <Suspense fallback={null}>
          <QuoteCardDialog />
        </Suspense>
      )}
      {yearOpen && (
        <Suspense fallback={null}>
          <YearReviewDialog />
        </Suspense>
      )}
      <RatePrompt />
      <UpdateBanner />
      {/* The owner's one-time messages: in the Library only, never over a book or the welcome. */}
      <AnnouncementHost
        ready={activeTab === "library" && selected === null && openingBook === null && !welcomeShowing}
        driveConnected={sync.driveConnected}
        showToast={showToast}
        onAction={(action) => {
          if (action === "reconnect_drive") {
            handleDriveConnect();
          } else {
            requestSettingsSection("library");
            setActiveTab("settings");
          }
        }}
      />
      {/* The owner's admin page, from the profile menu: loaded the first time it opens. */}
      <AdminHost showToast={showToast} />
      <ReminderOptIn />

      <MobileNav activeItem={tabLabels[activeTab]} onNavigate={handleSidebarNavigate} badge={navBadge} />

      <WelcomeModal
        open={welcomeShowing}
        driveAvailable={sync.driveAvailable}
        onChooseFolder={() => {
          dismissWelcome();
          void handleChooseFolder();
        }}
        onConnectDrive={() => {
          dismissWelcome();
          handleDriveConnect();
        }}
        onDismiss={dismissWelcome}
      />
      <AccountDialog showToast={showToast} />
      <LibraryOwnerSheet />
      <AccountHoldsSheet />
      <StoreHoldsSheet />
      {/* A held finger reads any tooltip (docs/android.md, rule 3). */}
      {touch && <TouchTips />}
      {/* The lenses every liquid-glass surface bends what is behind it through. */}
      <LiquidGlassDefs />

    </div>
  );
};

export default App;
