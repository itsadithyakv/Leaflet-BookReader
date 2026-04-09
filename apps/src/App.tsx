import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { AccountBadge } from "./components/AccountBadge";
import { AccountPanel } from "./components/AccountPanel";
import { LoginModal } from "./components/LoginModal";
import { LibraryPage } from "./pages/LibraryPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReaderView } from "./pages/ReaderView";
import { useLibraryStore } from "./store/libraryStore";
import { useAccountStore } from "./store/accountStore";
import { useHabitStore } from "./store/habitStore";
import { bookService } from "./services/bookService";
import { getPlatform } from "./platform";
import Logo from "./assets/LeafletLogo.png";
import type { Book } from "@shared/models/book";

type Tab = "library" | "collections" | "analytics" | "settings";

const tabLabels: Record<Tab, string> = {
  library: "Library",
  collections: "Collections",
  analytics: "Analytics",
  settings: "Settings"
};

const App = () => {
  const {
    books,
    filters,
    syncStatus,
    driveConnected,
    metadataRefreshing,
    metadataTotal,
    metadataDone,
    loadBooks,
    loadStats,
    loadDriveStatus,
    importPaths,
    openBook,
    startDriveAuth,
    syncNow,
    setFilter
  } = useLibraryStore();

  const [activeTab, setActiveTab] = useState<Tab>("library");
  const [selected, setSelected] = useState<Book | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  const {
    loggedIn,
    email,
    premium,
    lastSyncedAt,
    syncState,
    load: loadAccount,
    signIn,
    signOut,
    upgradePremium,
    restorePremium,
    setLastSyncedAt,
    setSyncState,
    tier
  } = useAccountStore();

  const { activeSession, focusSettings, goal, startSession, stopSession, clearSessionShelf } =
    useHabitStore();
  const fullscreenLockRef = useRef(false);

  const platform = getPlatform();

  useEffect(() => {
    loadBooks();
    loadStats();
    loadDriveStatus();
    loadAccount();
  }, [loadBooks, loadStats, loadDriveStatus, loadAccount]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let unlisten: (() => void) | undefined;
    listen<string[]>("tauri://file-drop", (event) => {
      if (Array.isArray(event.payload)) {
        importPaths(event.payload).catch((error) => {
          showToast(resolveErrorMessage(error, "Import failed. Try again."));
        });
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [importPaths]);

  useEffect(() => {
    if (platform === "mobile" && driveConnected) {
      syncNow().catch(() => {
        // startup sync failure is fine; user can retry manually
      });
    }
  }, [platform, driveConnected, syncNow]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2600);
  };

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

  const handleOpenBook = (book: Book) => {
    setSelected(book);
    if (focusSettings.goalBinding && !activeSession) {
      const duration = goal.mode === "minutes" && goal.target > 0 ? goal.target : 20;
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
    startDriveAuth().catch((error) => {
      showToast(resolveErrorMessage(error, "Drive connection failed. Please retry."));
    });
  };

  useEffect(() => {
    if (!loggedIn || !driveConnected) {
      setSyncState("offline");
      return;
    }
    if (syncStatus === "syncing") {
      setSyncState("pending");
    } else if (syncStatus === "success") {
      setSyncState("synced");
    } else if (syncStatus === "error") {
      setSyncState("error");
    }
  }, [syncStatus, driveConnected, loggedIn, setSyncState]);

  useEffect(() => {
    if (!focusSettings.kioskMode) {
      fullscreenLockRef.current = false;
      return;
    }

    if (activeSession) {
      fullscreenLockRef.current = true;
      if (isTauri()) {
        getCurrentWindow().setFullscreen(true).catch(() => {
          // ignore fullscreen errors
        });
      } else if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {
          // ignore
        });
      }
      return;
    }

    if (!fullscreenLockRef.current) {
      return;
    }
    fullscreenLockRef.current = false;
    if (isTauri()) {
      getCurrentWindow().setFullscreen(false).catch(() => {
        // ignore
      });
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // ignore
      });
    }
  }, [activeSession, focusSettings.kioskMode]);

  useEffect(() => {
    if (!focusSettings.kioskMode) {
      return;
    }
    if (!isTauri()) {
      const onFullscreenChange = () => {
        if (activeSession && fullscreenLockRef.current && !document.fullscreenElement) {
          fullscreenLockRef.current = false;
          const confirmed = window.confirm(
            "Exiting fullscreen will clear your sessions bookshelf progress. Continue?"
          );
          if (!confirmed) {
            fullscreenLockRef.current = true;
            document.documentElement.requestFullscreen().catch(() => {
              // ignore
            });
            return;
          }
          stopSession({ reason: "manual_end", cleanSession: false });
          clearSessionShelf();
          showToast("Focus paused");
        }
      };
      document.addEventListener("fullscreenchange", onFullscreenChange);
      return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
    }
    const windowHandle = getCurrentWindow();
    const onResize = () => {
      if (!activeSession || !fullscreenLockRef.current) {
        return;
      }
      windowHandle
        .isFullscreen()
        .then((isFullscreen) => {
          if (!isFullscreen) {
            fullscreenLockRef.current = false;
            const confirmed = window.confirm(
              "Exiting fullscreen will clear your sessions bookshelf progress. Continue?"
            );
            if (!confirmed) {
              fullscreenLockRef.current = true;
              windowHandle.setFullscreen(true).catch(() => {
                // ignore
              });
              return;
            }
            stopSession({ reason: "manual_end", cleanSession: false });
            clearSessionShelf();
            showToast("Focus paused");
          }
        })
        .catch(() => {
          // ignore
        });
    };
    const unlistenPromise = windowHandle.onResized(onResize);
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {
        // ignore
      });
    };
  }, [activeSession, focusSettings.kioskMode, stopSession]);

  const handleSync = () => {
    setSyncState("pending");
    (driveConnected ? syncNow() : startDriveAuth())
      .then(() => {
        setLastSyncedAt(new Date().toISOString());
        setSyncState("synced");
      })
      .catch((error) => {
        setSyncState("error");
        showToast(resolveErrorMessage(error, "Sync failed. Check Drive status."));
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
  const [nowReadingFallback, setNowReadingFallback] = useState<string | null>(null);
  const nowReadingCover =
    nowReading?.coverUrl && nowReading.coverUrl.startsWith("http") ? nowReading.coverUrl : null;
  const nowBookmarked = nowReading ? bookmarks.includes(nowReading.id) : false;

  useEffect(() => {
    setNowReadingFallback(null);
  }, [nowReading?.id, nowReading?.coverUrl]);

  useEffect(() => {
    if (!isTauri() || !nowReading?.coverUrl || nowReading.coverUrl.startsWith("http")) {
      return;
    }
    void bookService.coverData(nowReading.id).then((data) => {
      if (data) {
        setNowReadingFallback(data);
      }
    });
  }, [nowReading?.id, nowReading?.coverUrl]);

  const handleNowReadingError = () => {
    if (!nowReading) {
      return;
    }
    void bookService.coverData(nowReading.id).then((data) => {
      if (data) {
        setNowReadingFallback(data);
      }
    });
  };

  const resolvedNowReadingCover = nowReadingFallback ?? nowReadingCover;
  const accountTier = tier();
  const badgeAnimateRef = useRef<string | null>(null);
  const [badgeAnimate, setBadgeAnimate] = useState(false);

  useEffect(() => {
    if (badgeAnimateRef.current === accountTier) {
      return;
    }
    badgeAnimateRef.current = accountTier;
    setBadgeAnimate(true);
    const timer = window.setTimeout(() => setBadgeAnimate(false), 320);
    return () => window.clearTimeout(timer);
  }, [accountTier]);

  return (
    <div className="min-h-screen bg-background font-body text-on-surface selection:bg-primary-container selection:text-on-primary-container">
      <header className="sticky top-0 z-50 flex w-full items-center justify-between border-b border-white/5 bg-background/80 px-4 py-4 shadow-[0_4px_30px_rgba(142,68,173,0.06)] backdrop-blur-xl md:px-8">
        <div className="flex items-center gap-3">
          <img src={Logo} alt="Leaflet Logo" className="h-8 w-auto" />
          <span className="text-2xl font-semibold tracking-tight text-primary font-['Space_Grotesk']">
            Leaflet
          </span>
        </div>
        <div className="hidden flex-1 px-6 md:block">
          <div className="relative mx-auto max-w-xl">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
              search
            </span>
            <input
              className="w-full rounded-full border border-outline-variant/30 bg-surface-container-lowest py-2.5 pl-12 pr-4 text-sm text-on-surface focus:border-primary/40 focus:outline-none"
              placeholder="Search your archive..."
              type="text"
              value={filters.query}
              onChange={(event) => handleSearchChange(event.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <button
            type="button"
            className="hidden items-center gap-2 rounded-full border border-outline-variant/30 px-3 py-2 text-xs text-on-surface-variant transition hover:text-primary md:flex"
            onClick={handleDriveConnect}
          >
            <span className="material-symbols-outlined text-base">cloud</span>
            {driveConnected ? "Drive Connected" : "Connect Drive"}
          </button>
          <button
            type="button"
            className="hidden items-center gap-2 rounded-full border border-outline-variant/30 px-3 py-2 text-xs text-on-surface-variant transition hover:text-primary md:flex"
            onClick={handleSync}
          >
            <span className="material-symbols-outlined text-base">sync</span>
            {syncStatus === "syncing" ? "Syncing" : "Sync Now"}
          </button>
          <div className="relative">
            <AccountBadge
              tier={accountTier}
              syncState={loggedIn ? (driveConnected ? syncState : "offline") : "offline"}
              onClick={() => setAccountPanelOpen((prev) => !prev)}
              animate={badgeAnimate}
            />
            <AccountPanel
              open={accountPanelOpen}
              tier={accountTier}
              syncState={loggedIn ? (driveConnected ? syncState : "offline") : "offline"}
              email={email}
              lastSyncedAt={lastSyncedAt}
              onSignIn={() => setLoginModalOpen(true)}
              onSignOut={() => {
                signOut();
                setAccountPanelOpen(false);
              }}
              onUpgrade={() => {
                upgradePremium();
                showToast("Premium unlocked — thank you for supporting Leaflet.");
              }}
              onRestore={() => {
                restorePremium();
                showToast("Premium restored.");
              }}
              onSyncNow={handleSync}
            />
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-72px)] overflow-hidden">
        <Sidebar
          activeItem={tabLabels[activeTab]}
          onNavigate={handleSidebarNavigate}
          onStartReading={() => nowReading && handleOpenBook(nowReading)}
          startDisabled={!nowReading}
        />
        <main className="flex-1 overflow-y-auto bg-surface px-4 py-8 pb-28 md:px-8">
          {activeTab === "library" && (
            <LibraryPage onOpenBook={handleOpenBook} onNavigate={setActiveTab} showToast={showToast} />
          )}
          {activeTab === "collections" && (
            <CollectionsPage onNavigate={setActiveTab} showToast={showToast} />
          )}
          {activeTab === "analytics" && <AnalyticsPage />}
          {activeTab === "settings" && <SettingsPage showToast={showToast} />}
        </main>
      </div>

      {nowReading && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 hidden w-full max-w-2xl -translate-x-1/2 px-4 md:block">
          <div className="glass-panel pointer-events-auto flex items-center gap-4 rounded-2xl border border-outline-variant/20 p-3 shadow-2xl">
            <div className="h-12 w-12 overflow-hidden rounded-lg border border-white/10 shadow-lg">
              {resolvedNowReadingCover ? (
                <img
                  src={resolvedNowReadingCover}
                  alt="Now reading"
                  className="h-full w-full object-cover"
                  onError={handleNowReadingError}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-surface-container-high text-[10px] text-on-surface-variant">
                  Cover
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                Currently Reading
              </p>
              <h5 className="truncate text-sm font-headline font-bold">{nowReading.title}</h5>
            </div>
            <div className="flex items-center gap-4 pr-2">
              <button
                className="text-on-surface-variant transition-colors hover:text-on-surface"
                type="button"
                onClick={() => nowReading && toggleBookmark(nowReading.id, nowReading.title)}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontVariationSettings: nowBookmarked ? "'FILL' 1" : "'FILL' 0" }}
                >
                  bookmark
                </span>
              </button>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg shadow-primary/20 transition hover:scale-110 active:scale-95"
                type="button"
                onClick={() => handleOpenBook(nowReading)}
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                  play_arrow
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-8 right-8 z-50 rounded-2xl border border-outline-variant/30 bg-surface-container-high px-4 py-3 text-sm text-on-surface shadow-2xl">
          {toast}
        </div>
      )}

      {metadataRefreshing && books.length >= 60 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-surface-container-high px-6 py-4 text-sm text-on-surface">
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

      {selected && <ReaderView book={selected} onClose={() => setSelected(null)} />}

      <LoginModal
        open={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
        onLogin={(value) => {
          signIn(value);
          setSyncState("pending");
          setLoginModalOpen(false);
          setAccountPanelOpen(false);
          showToast("Your reading is now synced.");
          handleSync();
        }}
        onContinueOffline={() => {
          setLoginModalOpen(false);
          setAccountPanelOpen(false);
        }}
      />
    </div>
  );
};

export default App;
