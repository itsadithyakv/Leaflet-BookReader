import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";
import ePub from "epubjs";
import { bookService } from "../services/bookService";

type ReaderViewProps = {
  book: Book;
  onClose: () => void;
};

type Mode = "scroll" | "flip";

type TocItem = {
  id?: string;
  label: string;
  href: string;
  subitems?: TocItem[];
};

const flattenToc = (items: TocItem[]) => {
  const result: TocItem[] = [];
  const walk = (list: TocItem[]) => {
    list.forEach((item) => {
      result.push(item);
      if (item.subitems && item.subitems.length > 0) {
        walk(item.subitems);
      }
    });
  };
  walk(items);
  return result;
};

const normalizeLabel = (label: string) => label.toLowerCase().replace(/\s+/g, " ").trim();

const isFrontMatter = (label: string) => {
  const text = normalizeLabel(label);
  const blocked = [
    "title page",
    "copyright",
    "contents",
    "table of contents",
    "dedication",
    "acknowledgments",
    "acknowledgements",
    "foreword",
    "introduction",
    "preface",
    "glossary",
    "index",
    "about the author",
    "maps",
    "map"
  ];
  return blocked.some((entry) => text === entry || text.startsWith(`${entry} `));
};

const isChapterLike = (label: string) => {
  const text = normalizeLabel(label);
  if (isFrontMatter(text)) {
    return false;
  }
  if (/(chapter|book|section)\b/.test(text)) {
    return true;
  }
  if (/^(prologue|epilogue)\b/.test(text)) {
    return true;
  }
  if (/^[ivxlcdm]+\.?$/.test(text)) {
    return true;
  }
  return false;
};

export const ReaderView = ({ book, onClose }: ReaderViewProps) => {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<ReturnType<typeof ePub> | null>(null);
  const relocateHandlerRef = useRef<((location: { start?: { percentage?: number } }) => void) | null>(null);
  const lastProgressRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const lastMarkerRef = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNextSection();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevSection();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const container = getScrollContainer();
        if (!container) {
          return;
        }
        const delta = Math.max(120, Math.round(container.clientHeight * 0.2));
        const direction = event.key === "ArrowDown" ? 1 : -1;
        smoothScrollBy(container, delta * direction);
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const storageKey = useMemo(() => `dudereader.reader.${book.id}`, [book.id]);
  const readPrefs = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as {
        mode?: Mode;
        fontSize?: number;
        sidebarOpen?: boolean;
        cfi?: string;
        chapterPositions?: Record<string, string>;
      };
    } catch {
      return null;
    }
  };

  const initialPrefs = readPrefs();
  const [mode, setMode] = useState<Mode>(initialPrefs?.mode ?? "scroll");
  const [sidebarOpen, setSidebarOpen] = useState(initialPrefs?.sidebarOpen ?? true);
  const [fontSize, setFontSize] = useState(initialPrefs?.fontSize ?? 18);
  const modeRef = useRef<Mode>(mode);
  const fontSizeRef = useRef(fontSize);
  const sidebarRef = useRef(sidebarOpen);
  const [fontPanelOpen, setFontPanelOpen] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocIndexByHref, setTocIndexByHref] = useState<Record<string, number>>({});
  const [tocLabelByHref, setTocLabelByHref] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastCfiRef = useRef<string | null>(initialPrefs?.cfi ?? null);
  const chapterPositionsRef = useRef<Record<string, string>>(initialPrefs?.chapterPositions ?? {});
  const [chapterIndex, setChapterIndex] = useState<number>(0);
  const [chapterLabel, setChapterLabel] = useState<string>("Chapter");

  const coverSrc = useMemo(() => {
    if (!book.coverUrl) {
      return null;
    }
    if (isTauri()) {
      return convertFileSrc(book.coverUrl);
    }
    return book.coverUrl.startsWith("http") ? book.coverUrl : null;
  }, [book.coverUrl]);

  const [coverFallback, setCoverFallback] = useState<string | null>(null);
  const coverTriedRef = useRef(false);

  const applyReaderInsets = () => {
    const rendition = renditionRef.current;
    if (!rendition?.themes) {
      return;
    }
    rendition.themes.override("padding-left", "0px");
    rendition.themes.override("padding-right", "0px");
    rendition.themes.override("margin-left", "0px");
    rendition.themes.override("margin-right", "0px");
    rendition.themes.override("max-width", "100%");
    rendition.themes.override("width", "100%");
    rendition.themes.override("box-sizing", "border-box");
  };

  const triggerFlipAnimation = (direction: "next" | "prev") => {
    const container = viewerRef.current;
    if (!container) {
      return;
    }
    container.classList.remove("flip-next", "flip-prev");
    void container.offsetWidth;
    container.classList.add(direction === "next" ? "flip-next" : "flip-prev");
    window.setTimeout(() => {
      container.classList.remove("flip-next", "flip-prev");
    }, 320);
  };

  const updateLastReadMarker = (cfi: string) => {
    const rendition = renditionRef.current;
    if (!rendition?.getContents) {
      return;
    }
    if (lastMarkerRef.current === cfi) {
      return;
    }
    const contentsList = rendition.getContents();

    for (const contents of contentsList) {
      try {
        const range = contents.range(cfi);
        if (!range) {
          continue;
        }
        const rects = range.getClientRects();
        if (!rects || rects.length === 0) {
          continue;
        }
        const rect = rects[0];
        const doc = contents.document;
        const win = contents.window;
        if (!doc || !win) {
          continue;
        }
        const existing = doc.getElementById("reader-lastline-marker");
        if (existing) {
          const bodyRect = doc.body.getBoundingClientRect();
          const left = Math.max(6, bodyRect.left + win.scrollX + 2);
          const top = rect.top + win.scrollY + rect.height / 2 - 5;
          existing.dataset.targetLeft = `${left}`;
          existing.dataset.targetTop = `${top}`;
          window.setTimeout(() => {
            if (existing.dataset.targetLeft && existing.dataset.targetTop) {
              existing.style.left = `${existing.dataset.targetLeft}px`;
              existing.style.top = `${existing.dataset.targetTop}px`;
            }
          }, 2000);
          lastMarkerRef.current = cfi;
          return;
        }
        const marker = doc.createElement("div");
        marker.id = "reader-lastline-marker";
        marker.style.position = "absolute";
        marker.style.width = "10px";
        marker.style.height = "10px";
        marker.style.borderRadius = "9999px";
        marker.style.background = "#6ab7ff";
        marker.style.pointerEvents = "none";
        marker.style.transition = "left 0.4s ease, top 0.4s ease";
        const bodyRect = doc.body.getBoundingClientRect();
        const left = Math.max(6, bodyRect.left + win.scrollX + 2);
        const top = rect.top + win.scrollY + rect.height / 2 - 5;
        marker.style.left = `${left}px`;
        marker.style.top = `${top}px`;
        doc.body.appendChild(marker);
        lastMarkerRef.current = cfi;
        break;
      } catch {
        // ignore range errors
      }
    }
  };

  const smoothScrollBy = (element: HTMLElement, delta: number) => {
    const start = element.scrollTop;
    const target = start + delta;
    const duration = 220;
    let startTime: number | null = null;

    const tick = (time: number) => {
      if (startTime === null) {
        startTime = time;
      }
      const progress = Math.min(1, (time - startTime) / duration);
      const eased = progress < 0.5
        ? 2 * progress * progress
        : -1 + (4 - 2 * progress) * progress;
      element.scrollTop = start + (target - start) * eased;
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  };

  const persistReaderState = (override?: Partial<{
    cfi: string;
    chapterPositions: Record<string, string>;
  }>) => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          mode: modeRef.current,
          fontSize: fontSizeRef.current,
          sidebarOpen: sidebarRef.current,
          cfi: override?.cfi ?? lastCfiRef.current ?? undefined,
          chapterPositions: override?.chapterPositions ?? chapterPositionsRef.current
        })
      );
    } catch {
      // ignore
    }
  };

  const displayChapter = (href: string) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    const saved = chapterPositionsRef.current[href];
    if (saved) {
      void rendition.display(saved);
      return;
    }
    void rendition.display(href);
  };

  useEffect(() => {
    coverTriedRef.current = false;
    setCoverFallback(null);
  }, [book.id, book.coverUrl]);

  const localPath =
    (book as { localPath?: string; local_path?: string }).localPath ??
    (book as { localPath?: string; local_path?: string }).local_path ??
    "";

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    setToc([]);

    if (!localPath) {
      setLoadError("Missing book file.");
      setLoading(false);
      return;
    }

    const ext = localPath.split(".").pop()?.toLowerCase();
    if (ext !== "epub") {
      setLoadError("This reader currently supports EPUB files only.");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const source = isTauri() ? convertFileSrc(localPath) : localPath;
        let buffer: ArrayBuffer;
        try {
          const response = await fetch(source);
          if (!response.ok) {
            throw new Error("fetch failed");
          }
          buffer = await response.arrayBuffer();
        } catch {
          const base64 = await bookService.readBookBytes(book.id);
          if (!base64) {
            throw new Error("Unable to read the book file. Make sure you're running the desktop app.");
          }
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          buffer = bytes.buffer;
        }

        if (bookRef.current) {
          bookRef.current.destroy();
          bookRef.current = null;
        }

        const epub = ePub(buffer);
        bookRef.current = epub;

        if (!viewerRef.current) {
          throw new Error("Reader container not ready.");
        }

        const rendition = epub.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%"
        });
        renditionRef.current = rendition;

        rendition.themes.register("dudereader-dark", {
          html: {
            background: "#000000",
            color: "#ffffff",
            overflowX: "hidden"
          },
          body: {
            background: "#000000",
            color: "#ffffff",
            lineHeight: "1.8",
            fontFamily: "'Noto Serif', serif",
            margin: "0 auto",
            width: "100%",
            padding: "0",
            maxWidth: "100%",
            overflowX: "hidden"
          },
          "*": {
            boxSizing: "border-box",
            maxWidth: "100%"
          },
          img: {
            maxWidth: "100%",
            height: "auto"
          },
          svg: {
            maxWidth: "100%",
            height: "auto"
          },
          table: {
            width: "100%",
            maxWidth: "100%",
            display: "block",
            overflowX: "auto"
          },
          pre: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          },
          code: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          },
          p: {
            margin: "0 0 1.4em 0"
          },
          ".reader-lastline": {
            background: "transparent",
            position: "relative",
            display: "inline"
          },
          ".reader-lastline::before": {
            content: "''",
            position: "absolute",
            left: "-12px",
            top: "0.6em",
            width: "6px",
            height: "6px",
            borderRadius: "9999px",
            background: "#6ab7ff"
          }
        });
        rendition.themes.select("dudereader-dark");
        if (rendition.themes?.fontSize) {
          rendition.themes.fontSize(`${fontSize}px`);
        }
        applyReaderInsets();
        rendition.flow(mode === "scroll" ? "scrolled-doc" : "paginated");

        const navigation = await epub.loaded.navigation;
        const flatToc = flattenToc(navigation.toc);
        setToc(flatToc);
        const chapterToc = flatToc.filter((item) => isChapterLike(item.label));
        const indexMap: Record<string, number> = {};
        const labelMap: Record<string, string> = {};
        chapterToc.forEach((item, idx) => {
          indexMap[item.href] = idx;
          labelMap[item.href] = item.label;
        });
        setTocIndexByHref(indexMap);
        setTocLabelByHref(labelMap);

        const onRelocated = (location: any) => {
          const percentage = location?.start?.percentage ?? 0;
          const now = Date.now();

          if (location?.start?.cfi) {
            lastCfiRef.current = location.start.cfi;
            const href = location?.start?.href;
            if (href) {
              chapterPositionsRef.current = {
                ...chapterPositionsRef.current,
                [href]: location.start.cfi
              };
            }
            try {
              localStorage.setItem(
                storageKey,
                JSON.stringify({
                  mode: modeRef.current,
                  fontSize: fontSizeRef.current,
                  sidebarOpen: sidebarRef.current,
                  cfi: location.start.cfi,
                  chapterPositions: chapterPositionsRef.current
                })
              );
            } catch {
              // ignore storage errors
            }
          }

          // no auto-advance in scroll mode

          const shouldUpdateProgress =
            Math.abs(percentage - lastProgressRef.current) >= 0.005 ||
            now - lastProgressAtRef.current >= 10000;

          if (shouldUpdateProgress) {
            lastProgressRef.current = percentage;
            lastProgressAtRef.current = now;
            void bookService.updateProgress(book.id, percentage);
          }

          const href = location?.start?.href;
          if (href && indexMap[href] !== undefined) {
            setChapterIndex(indexMap[href]);
            setChapterLabel(labelMap[href] ?? "Chapter");
          }

          const markerCfi = location?.end?.cfi ?? location?.start?.cfi;
          if (markerCfi) {
            updateLastReadMarker(markerCfi);
          }

        };
        relocateHandlerRef.current = onRelocated;
        rendition.on("relocated", onRelocated);

        if (lastCfiRef.current) {
          await rendition.display(lastCfiRef.current);
        } else {
          await rendition.display();
        }
        applyReaderInsets();
        setLoading(false);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load book.");
        setLoading(false);
      }
    };

    load();

    return () => {
      if (renditionRef.current && relocateHandlerRef.current) {
        renditionRef.current.off("relocated", relocateHandlerRef.current);
      }
      if (lastMarkerRef.current && renditionRef.current?.getContents) {
        const contentsList = renditionRef.current.getContents();
        contentsList.forEach((contents: any) => {
          const doc = contents?.document;
          doc?.getElementById("reader-lastline-marker")?.remove();
        });
        lastMarkerRef.current = null;
      }
      if (renditionRef.current) {
        renditionRef.current.destroy();
        renditionRef.current = null;
      }
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
    };
  }, [book.id, localPath]);

  useEffect(() => {
    if (!renditionRef.current) {
      return;
    }
    renditionRef.current.flow(mode === "scroll" ? "scrolled-doc" : "paginated");
    void renditionRef.current.display();
    applyReaderInsets();
    persistReaderState();
  }, [mode]);

  const getScrollContainer = () => {
    const manager = renditionRef.current?.manager as any;
    if (manager?.settings?.fullsize) {
      return document.scrollingElement ?? document.documentElement;
    }
    if (manager?.container) {
      return manager.container as HTMLElement;
    }
    const root = viewerRef.current;
    if (!root) {
      return null;
    }
    const candidates = [
      root,
      root.querySelector(".epub-container"),
      root.querySelector(".epub-view")
    ].filter(Boolean) as HTMLElement[];

    for (const candidate of candidates) {
      const el = candidate as HTMLElement;
      if (el.scrollHeight > el.clientHeight + 2) {
        return el;
      }
    }

    return root;
  };

  const goNextSection = () => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const location = rendition?.location;
    const index = location?.start?.index ?? location?.end?.index;
    const spineItems = epub?.spine?.items;
    if (Array.isArray(spineItems) && typeof index === "number") {
      const next = spineItems[index + 1];
      if (next?.href) {
        if (modeRef.current === "flip") {
          triggerFlipAnimation("next");
        }
        displayChapter(next.href);
        return;
      }
    }
    if (modeRef.current === "flip") {
      triggerFlipAnimation("next");
    }
    void rendition?.next();
  };

  const goPrevSection = () => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const location = rendition?.location;
    const index = location?.start?.index ?? location?.end?.index;
    const spineItems = epub?.spine?.items;
    if (Array.isArray(spineItems) && typeof index === "number") {
      const prev = spineItems[index - 1];
      if (prev?.href) {
        if (modeRef.current === "flip") {
          triggerFlipAnimation("prev");
        }
        displayChapter(prev.href);
        return;
      }
    }
    if (modeRef.current === "flip") {
      triggerFlipAnimation("prev");
    }
    void rendition?.prev();
  };

  // no auto-advance listeners in scroll mode

  useEffect(() => {
    try {
      persistReaderState();
    } catch {
      // ignore
    }
  }, [mode, fontSize, sidebarOpen, storageKey]);

  useEffect(() => {
    if (!renditionRef.current?.themes?.fontSize) {
      return;
    }
    renditionRef.current.themes.fontSize(`${fontSize}px`);
    applyReaderInsets();
    persistReaderState();
  }, [fontSize]);

  useEffect(() => {
    applyReaderInsets();
    persistReaderState();
  }, [sidebarOpen]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
  }, [fontSize]);

  useEffect(() => {
    sidebarRef.current = sidebarOpen;
  }, [sidebarOpen]);

  const resolvedCover = coverFallback ?? coverSrc;
  const handleCoverError = () => {
    if (coverTriedRef.current) {
      return;
    }
    coverTriedRef.current = true;
    void bookService.coverData(book.id).then((data) => {
      if (data) {
        setCoverFallback(data);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 h-full w-full overflow-hidden bg-black text-white">
      <header className="fixed left-0 right-0 top-0 z-50 flex w-full items-center justify-between bg-black/90 px-6 py-6 md:px-8">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/70 transition hover:text-white"
            onClick={() => setSidebarOpen((prev) => !prev)}
          >
            <span className="material-symbols-outlined">
              {sidebarOpen ? "dock_to_left" : "dock_to_right"}
            </span>
          </button>
          <button
            type="button"
            className="group flex items-center gap-2 text-white/70 transition-all hover:text-white"
            onClick={onClose}
          >
            <span className="material-symbols-outlined text-primary transition-transform group-hover:-translate-x-1">
              arrow_back
            </span>
            <span className="text-xs uppercase tracking-widest group-hover:text-primary">Back to Library</span>
          </button>
        </div>
        <div className="absolute left-1/2 hidden -translate-x-1/2 flex-col items-center text-center md:flex">
          <h1 className="text-glow font-headline text-xl font-bold text-primary">{book.title}</h1>
          <span className="text-xs uppercase tracking-[0.2em] text-white/60">
            {book.author ?? "Unknown author"}
          </span>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <button
            className="text-white/70 transition-colors hover:text-primary"
            type="button"
            onClick={() => setFontPanelOpen((prev) => !prev)}
          >
            <span className="material-symbols-outlined">text_fields</span>
          </button>
          {fontPanelOpen && (
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-xs uppercase tracking-widest text-white/70">
              <button
                type="button"
                className="rounded-full border border-white/20 px-2 py-1 text-white/80 transition hover:text-white"
                onClick={() => setFontSize((size) => Math.max(14, size - 2))}
              >
                A-
              </button>
              <span className="min-w-[40px] text-center">{fontSize}px</span>
              <button
                type="button"
                className="rounded-full border border-white/20 px-2 py-1 text-white/80 transition hover:text-white"
                onClick={() => setFontSize((size) => Math.min(32, size + 2))}
              >
                A+
              </button>
            </div>
          )}
          <button className="text-white/70 transition-colors hover:text-primary" type="button">
            <span className="material-symbols-outlined">bookmark</span>
          </button>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs uppercase tracking-widest text-white/70">
            <button
              type="button"
              className={`rounded-full px-3 py-1 transition ${mode === "scroll" ? "bg-white text-black" : ""}`}
              onClick={() => setMode("scroll")}
            >
              Scroll
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1 transition ${mode === "flip" ? "bg-white text-black" : ""}`}
              onClick={() => setMode("flip")}
            >
              Flip
            </button>
          </div>
        </div>
      </header>

      <div className="flex h-full pt-24">
        <aside
          className={`hidden flex-col border-r border-white/10 bg-black/60 text-sm text-white/80 transition-all duration-200 md:flex ${
            sidebarOpen ? "w-72 px-6 py-6" : "w-0 overflow-hidden px-0 py-0 border-transparent"
          }`}
        >
          <div className="mb-6">
            {resolvedCover && (
              <div className="mb-4 h-44 w-32 overflow-hidden rounded-xl border border-white/10">
                <img src={resolvedCover} alt={book.title} className="h-full w-full object-cover" onError={handleCoverError} />
              </div>
            )}
            <h2 className="font-headline text-lg font-bold text-white">{book.title}</h2>
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">
              {book.author ?? "Unknown author"}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.3em] text-white/40">Chapters</div>
          <div className="mt-4 flex-1 overflow-y-auto pr-2">
            {toc.length === 0 && (
              <div className="text-xs text-white/40">
                {loading ? "Loading chapters..." : "No chapters found."}
              </div>
            )}
            {toc.map((item) => (
              <button
                key={`${item.href}-${item.label}`}
                type="button"
                className="mb-2 w-full rounded-lg px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={() => displayChapter(item.href)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </aside>

        <main className={`flex-1 overflow-hidden ${sidebarOpen ? "" : "px-0"}`}>
          {loadError && (
            <div className="mx-auto mt-24 max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-white/70">
              {loadError}
            </div>
          )}
          {!loadError && (
            <div className="relative h-full">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 text-sm text-white/60">
                  Loading book...
                </div>
              )}
              <div
                ref={viewerRef}
                className={`reader-container h-full w-full overflow-y-auto overflow-x-hidden overscroll-x-none pb-20 ${
                  sidebarOpen ? "px-4 md:px-8" : "px-2 md:px-4"
                }`}
              />
              <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center">
                <div className="pointer-events-auto flex items-center gap-4 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs uppercase tracking-widest text-white/60">
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-3 py-1 text-white/80 transition hover:text-white"
                    onClick={() => goPrevSection()}
                  >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                  </button>
                  <span className="text-[10px] text-white/60">
                    {chapterLabel} {chapterIndex + 1}
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-3 py-1 text-white/80 transition hover:text-white"
                    onClick={() => goNextSection()}
                  >
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
