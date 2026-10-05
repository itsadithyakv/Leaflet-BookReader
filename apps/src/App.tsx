import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { ProfileButton, type SyncMode } from "./components/ProfileButton";
import { AccountDialog, accountOffered, markAccountOffered, useAccountDialog } from "./components/account/AccountDialog";
import { WelcomeModal } from "./components/WelcomeModal";
import { SessionWrapUp } from "./components/SessionWrapUp";
import { usePipReactions } from "./hooks/usePipReactions";
import { useCommunityPulse } from "./hooks/useCommunityPulse";
import { PipHome } from "./components/PipHome";
import { PipReaderPeek } from "./components/PipReaderPeek";
import { PipWorld, type PipAction } from "./components/PipWorld";
import { usePipStore } from "./store/pipStore";
import { usePipWardrobeStore } from "./store/pipWardrobeStore";
import { pickBeat } from "./pip/moments";
import { nodFor, nodOdds } from "./pip/bookNods";
import { loadBookScenes } from "./pip/core";

/** A book untouched this long gets dusted off when it is opened again. */
const DUSTY_BOOK_DAYS = 30;
import { MobileNav } from "./components/MobileNav";
import { UiIcon } from "./components/UiIcon";
import { LibraryPage } from "./pages/LibraryPage";
import { useLibraryStore } from "./store/libraryStore";
import { FEATURES } from "./constants/features";
import { ALIVE_EVERY_MS, AWAY_FREE_MS, flowerGrowing, useHabitStore } from "./store/habitStore";
import { setAppFullscreen, watchForeground } from "./services/windowService";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SeriesEditorDialog } from "./components/SeriesEditor";
import { useHighlightsStore } from "./components/highlights/highlightsStore";
import { RatePrompt, openStoreReview } from "./components/RatePrompt";
import { ReminderOptIn } from "./components/ReminderOptIn";
import { useReminders } from "./hooks/useReminders";
import { useAppearanceStore, watchSystemTheme } from "./store/appearanceStore";
import { bookService } from "./services/bookService";
import { converterOffer, converterService, type ConverterOffer } from "./services/converterService";
import { getPlatform, pickSyncFolder } from "./platform";
import type { Book } from "@shared/models/book";
import { requestSettingsSection } from "./pages/settingsSection";
import {
  findBookFormat,
  getBookExtension,
  isImportableExtension,
  needsConversion
} from "./constants/bookFormats";

type Tab = "library" | "collections" | "social" | "pip" | "settings";

const ReaderView = lazy(() =>
  import("./pages/ReaderView").then((module) => ({ default: module.ReaderView }))
);

const PageReaderView = lazy(() =>
  import("./pages/PageReaderView").then((module) => ({ default: module.PageReaderView }))
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
const HighlightsDialog = lazy(() =>
  import("./components/highlights/HighlightsDialog").then((module) => ({ default: module.HighlightsDialog }))
);

/** Books whose scene Pip has already shown once (see showBookNod). */
const NODS_SEEN_KEY = "leaflet.pip.nodsSeen";

/** Marks the first-run choice as made, so it is never asked twice. */
const WELCOME_KEY = "leaflet.welcomed";

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
    loadStats,
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
      loadStats: state.loadStats,
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

  // Which transport is carrying sync, if any. There is no account tier: sync
  // runs against the reader's own storage, so there is nothing to sign up for.
  const syncMode: SyncMode = sync.driveConnected ? "drive" : sync.folderPath ? "folder" : "off";

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
  const highlightsOpen = useHighlightsStore((state) => state.view !== null);
  const toggleTheme = useAppearanceStore((state) => state.toggleTheme);

  useEffect(() => {
    loadBooks();
    loadStats();
    loadSyncStatus();
    // Lazy streak evaluation: the app may have been closed for days, so a break
    // is discovered on open rather than by a timer that was never running.
    // Then a focus session left running on an earlier day ends, with the
    // minutes actually read (not the days it sat open).
    void loadHabit().then(() => useHabitStore.getState().resumeSession());
    // What Pip wears everywhere (the roaming Pip, the reader peek, the wrap-up).
    void loadWardrobe();
  }, [loadBooks, loadStats, loadSyncStatus, loadHabit, loadWardrobe]);

  // Left open past midnight, today's minutes and "goal met" on screen would
  // be yesterday's until something was read: the ledger is asked again.
  useEffect(() => {
    const timer = window.setInterval(() => void useHabitStore.getState().refreshForNewDay(), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => watchSystemTheme(), []);

  usePipReactions(selected !== null);
  // Community news (kudos, followers, duels): polled while signed in; the
  // count becomes a dot on the Social nav item.
  const communityUnread = useCommunityPulse();
  const navBadge = useMemo(() => ({ Social: communityUnread }), [communityUnread]);

  // Back up on launch. The app may have been closed mid-session, and on a new
  // computer this same pass is what restores the library from Drive.
  useEffect(() => {
    if (sync.driveConnected) {
      syncNow().catch(() => {
        // startup backup failure is fine; it is recorded and retried later
      });
    }
  }, [sync.driveConnected, syncNow]);

  // Closing a book is the moment progress and the habit ledger have changed, so
  // it is when a backup is worth taking. Imports and deletes schedule their own.
  const closeReader = useCallback(() => {
    setSelected(null);
    setOpenAt(null);
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
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2600);
  }, []);

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
    // After the page has had a moment to appear.
    const ready = loadBookScenes();
    window.setTimeout(() => void ready.then(() => usePipStore.getState().showPeek(nod.move, nod.line, 1)), 2200);
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
    setSelected(book);
    setOpenAt(at);
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
  const handleOpenBook = (book: Book, at: string | null = null) => {
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

    bookService
      .needsConverter(book.id)
      .then(async (required) => {
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
  const lastScrollRef = useRef(0);

  const handleMainScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    const top = event.currentTarget.scrollTop;
    const previous = lastScrollRef.current;
    // Ignore jitter, and never hide it while still near the top -- there the
    // header is the only thing identifying where you are.
    if (Math.abs(top - previous) > 6) {
      // The account panel is anchored to the header, so sliding the header away
      // would take the panel with it.
      setHeaderHidden(!accountPanelOpen && top > previous && top > 72);
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
    if (syncMode === "off") {
      showToast("Connect Google Drive in Settings to back up your library.");
      return;
    }
    syncNow()
      .then(() => {
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

  // A clicked reading reminder: pick up the last book, once the library has
  // loaded (a click can be what launched the app). Never over an open book.
  const [reminderRoute, setReminderRoute] = useState<string | null>(null);
  useReminders(selected !== null, setReminderRoute);
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

  // Pip's idle time sometimes plays the current book's scene.
  useEffect(() => {
    usePipStore.getState().setBookNod(
      nowReading && nodFor(nowReading) ? { title: nowReading.title, author: nowReading.author ?? null, genres: nowReading.genres ?? null } : null
    );
  }, [nowReading?.id, nowReading?.title, nowReading?.author, nowReading?.genres?.join("|")]);
  const [nowReadingFallback, setNowReadingFallback] = useState<string | null>(null);
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
  // Page-image formats (PDF, comics) use the page reader; everything else is
  // reflowable text.
  const selectedDelivery = selected
    ? findBookFormat(getBookExtension(selected.localPath))?.delivery
    : undefined;

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
    const minutes = goalMinutes > 0 ? goalMinutes : 20;
    pipActions.push({
      id: "start-session",
      label: `Start a ${minutes}-minute session`,
      run: () => {
        setActiveTab("library");
        startSession({ startedAt: new Date().toISOString(), durationMinutes: minutes });
      }
    });
  }
  if (sync.driveConnected) {
    pipActions.push({ id: "backup", label: "Back up now", run: handleSync });
  }
  pipActions.push({ id: "rate", label: "Rate Leaflet ★", run: () => void openStoreReview() });

  return (
    <div className="app-shell flex flex-col font-body text-on-surface selection:bg-primary-container selection:text-on-primary-container">
      <header
        className={`app-header paper-toolbar sticky top-0 z-50 flex w-full shrink-0 items-center justify-between gap-2 border-x-0 border-t-0 py-3 md:gap-4 ${
          headerHidden ? "app-header-hidden" : ""
        }`}
      >
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
        <div className="hidden min-w-0 flex-1 md:block md:px-6">
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
          <button
            type="button"
            className="key-button"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <UiIcon name={theme === "dark" ? "sun" : "moon"} size={19} />
          </button>
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
          {/* Pip stands in here while it is on a card, so it scrolls with the
              card natively instead of chasing it a frame behind. */}
          <div className="pip-scroll-layer" data-pip-scroll-layer />
          {activeTab === "library" && (
            <LibraryPage
              onOpenBook={openBookFromLibrary}
              onNavigate={setActiveTab}
              showToast={showToast}
            />
          )}
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
            {activeTab === "pip" && <PipPage showToast={showToast} openSocial={() => setActiveTab("social")} />}
            {activeTab === "settings" && <SettingsPage showToast={showToast} />}
          </Suspense>
        </main>
      </div>

      {nowReading && (
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
                <div className="flex h-full w-full items-center justify-center bg-surface-container-high text-on-surface-variant">
                  <UiIcon name="book-open" size={19} strokeWidth={1.7} />
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
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="paper-surface fixed bottom-8 right-8 z-50 rounded-lg px-4 py-3 text-sm text-on-surface">
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-6">
          <div
            className="modal-surface w-full max-w-md p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="converter-dialog-title"
          >
            <div className="flex items-start gap-4">
              <div className="paper-surface-raised flex h-12 w-12 shrink-0 items-center justify-center text-primary">
                <UiIcon name="book-open" size={23} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                  {converterOfferKind === "install" ? "Optional download" : "Needs Calibre"}
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
                  “{converterPromptBook.title}” needs Calibre, which has no version for this
                  device — so it is not built into the app here. Open it once on a desktop and the
                  converted book syncs back to this device like any other.
                </>
              )}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="tactile-button px-4 py-2 text-sm"
                onClick={() => {
                  setConverterPromptBook(null);
                  showToast(
                    `“${converterPromptBook.title}” stays in your library. Open it once the converter is available.`
                  );
                }}
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

      {selected && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90">
              <div className="paper-surface flex items-center gap-3 rounded-xl px-5 py-4 text-sm">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Opening book…
              </div>
            </div>
          }
        >
          {selectedDelivery === "pdf" || selectedDelivery === "comic" ? (
            <PageReaderView
              key={selected.id}
              book={selected}
              kind={selectedDelivery === "comic" ? "comic" : "pdf"}
              onClose={closeReader}
            />
          ) : (
            <ReaderView key={selected.id} book={selected} onClose={closeReader} openAt={openAt} />
          )}
        </Suspense>
      )}

      {/* Pip lives over the app; while a book is open it waits (hidden) and
          celebrations come through the reader peek instead. */}
      <PipWorld actions={pipActions} />
      {selected && <PipReaderPeek />}

      {/* After the reader, so a session that ends mid-book wraps up on top. */}
      <SessionWrapUp />
      <ConfirmDialog />
      <SeriesEditorDialog />
      {highlightsOpen && (
        <Suspense fallback={null}>
          <HighlightsDialog onOpenInBook={openBookAt} />
        </Suspense>
      )}
      <RatePrompt />
      <ReminderOptIn />

      <MobileNav
        activeItem={tabLabels[activeTab]}
        onNavigate={handleSidebarNavigate}
        onStartReading={() => nowReading && handleOpenBook(nowReading)}
        startDisabled={!nowReading}
        badge={navBadge}
      />

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

    </div>
  );
};

export default App;
