import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EpubCFI } from "epubjs";
import { comparePlaces, isPdfPlace } from "../../readers/pdfHighlights";
import type { Book } from "@shared/models/book";
import { annotationService, type Annotation } from "../../services/annotationService";
import { HIGHLIGHT_COLORS } from "../../readers/highlightColors";
import { highlightsMarkdown } from "../../readers/useAnnotations";
import { useCoverSrc } from "../../hooks/useCoverSrc";
import { useLibraryStore } from "../../store/libraryStore";
import { UiIcon, type UiIconName } from "../UiIcon";
import { EYEBROW } from "../ui/SectionHeader";
import { SegmentedTabs, panelId, tabId } from "../ui/SegmentedTabs";
import { showHighlightsView, useHighlightsStore } from "./highlightsStore";
import { booksWithHighlights, countLabel, groupByChapter, orderHighlights } from "./highlightsView";
import { KINDLE_TAG_ABOUT, isKindlePlace } from "../../library/kindleClippings";
import { KindleImport } from "./KindleImport";

type Tab = "highlights" | "bookmarks";
const TABS_ID = "book-notes";

/** A line at the foot of the dialog: what just happened, and Undo after a removal. */
type Notice = { text: string; undo?: Annotation };

const close = () => showHighlightsView(null);

const dateLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

/** Enough of a highlight to tell its buttons from the next one's, for a screen reader. */
const snippet = (text: string | null | undefined) => {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
};

const iconButton =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

const Header = ({
  eyebrow,
  title,
  detail,
  onBack
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  onBack?: () => void;
}) => (
  <div className="flex items-start gap-2">
    {onBack && (
      <button type="button" className={`${iconButton} -ml-2`} onClick={onBack} aria-label="All highlights" title="All highlights" data-autofocus>
        <UiIcon name="back" size={18} />
      </button>
    )}
    <div className="min-w-0 flex-1">
      <p className={EYEBROW}>{eyebrow}</p>
      {/* Two lines at most: a very long title used to take the whole dialog
          in a small window and leave the list no height at all. */}
      <h2 id="highlights-dialog-title" className="page-title mt-1 line-clamp-2 break-words text-xl text-on-surface" title={title}>
        {title}
      </h2>
      {detail && <p className="mt-1 truncate text-xs text-on-surface-variant">{detail}</p>}
    </div>
    <button
      type="button"
      className={`${iconButton} -mr-2 -mt-1`}
      onClick={close}
      aria-label="Close"
      title="Close"
      data-autofocus={onBack ? undefined : true}
    >
      <UiIcon name="close" size={18} />
    </button>
  </div>
);

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-xl border border-dashed border-outline-variant/60 px-5 py-8 text-center text-sm leading-relaxed text-on-surface-variant">
    {children}
  </p>
);

const RowAction = ({
  icon,
  label,
  about,
  danger = false,
  onClick
}: {
  icon: UiIconName;
  label: string;
  about: string;
  danger?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
      danger ? "text-on-surface-variant hover:text-error" : "text-on-surface-variant hover:text-on-surface"
    }`}
    onClick={onClick}
    aria-label={about ? `${label}: ${about}` : label}
  >
    <UiIcon name={icon} size={14} />
    {label}
  </button>
);

/** The books that have highlights, with how many each. Picking one shows them. */
const BooksView = () => {
  const books = useLibraryStore((state) => state.books);
  const counts = useHighlightsStore((state) => state.counts);
  const loadCounts = useHighlightsStore((state) => state.loadCounts);

  // Highlights can arrive with a sync since the library last counted them.
  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  const listed = useMemo(() => booksWithHighlights(books, counts), [books, counts]);
  const total = listed.reduce((sum, item) => sum + item.count, 0);

  return (
    <>
      <Header
        eyebrow="Your library"
        title="Highlights"
        detail={listed.length > 0 ? `${countLabel(total, "highlight")} in ${countLabel(listed.length, "book")}` : undefined}
      />
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {listed.length === 0 ? (
          <Empty>
            No highlights yet. Select some text while reading a book and Leaflet offers to highlight it or add a
            note. Everything you highlight is gathered here.
          </Empty>
        ) : (
          <ul className="space-y-1">
            {listed.map(({ book, count }) => (
              <li key={book.id}>
                <BookEntry book={book} count={count} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <KindleImport />
    </>
  );
};

const BookEntry = ({ book, count }: { book: Book; count: number }) => {
  const { src, onError } = useCoverSrc(book, { thumb: true });
  return (
    <button
      type="button"
      className="flex w-full items-center gap-4 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      onClick={() => showHighlightsView({ kind: "book", bookId: book.id, fromList: true })}
    >
      <span className="book-cover-frame block h-14 w-10 shrink-0 overflow-hidden bg-surface-container-high">
        {src && <img src={src} alt="" className="h-full w-full object-cover" onError={onError} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="book-title block truncate text-base text-on-surface">{book.title}</span>
        <span className="block truncate text-xs text-on-surface-variant">{book.author ?? "Unknown author"}</span>
      </span>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-on-surface-variant">{countLabel(count, "highlight")}</span>
    </button>
  );
};

/** One book's highlights, in reading order under their chapters, and its bookmarks. */
const BookView = ({
  book,
  fromList,
  onOpenInBook
}: {
  book: Book;
  fromList: boolean;
  onOpenInBook: (book: Book, cfi: string) => void;
}) => {
  const [items, setItems] = useState<Annotation[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("highlights");
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const requestBackup = useLibraryStore((state) => state.requestBackup);
  const loadCounts = useHighlightsStore((state) => state.loadCounts);

  useEffect(() => {
    let live = true;
    annotationService.list(book.id).then(
      (loaded) => live && setItems(loaded),
      () => live && setFailed(true)
    );
    return () => {
      live = false;
    };
  }, [book.id]);

  useEffect(
    () => () => {
      if (noticeTimer.current) {
        window.clearTimeout(noticeTimer.current);
      }
    },
    []
  );

  // The same order as the reader's own list: by place in the book.
  const highlights = useMemo(() => {
    const cfi = new EpubCFI();
    // A PDF's places are pages and lines, not CFIs (readers/pdfHighlights.ts).
    return orderHighlights(
      (items ?? []).filter((item) => item.kind === "highlight"),
      (a, b) => (isPdfPlace(a) || isPdfPlace(b) ? comparePlaces(a, b) : cfi.compare(a, b))
    );
  }, [items]);
  const groups = useMemo(() => groupByChapter(highlights), [highlights]);
  const bookmarks = useMemo(
    () => (items ?? []).filter((item) => item.kind === "bookmark").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [items]
  );

  const say = (text: string, undo?: Annotation) => {
    if (noticeTimer.current) {
      window.clearTimeout(noticeTimer.current);
    }
    setNotice({ text, undo });
    // An offer to undo stays until something else happens; a plain message leaves by itself.
    noticeTimer.current = undo ? null : window.setTimeout(() => setNotice(null), 2600);
  };

  // Removing takes the button that was pressed with it; Undo is where to go next.
  useEffect(() => {
    if (notice?.undo) {
      undoRef.current?.focus();
    }
  }, [notice]);

  const copy = (text: string, done: string) => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => say(done),
        () => say("Couldn't copy.")
      );
  };

  // Like a change made in the reader: it goes into the next backup, and the library's counts follow.
  const changed = () => {
    requestBackup();
    void loadCounts();
  };

  const nameOf = (item: Annotation) => (item.kind === "highlight" ? "Highlight" : "Bookmark");

  /** Removed at once (a tombstone, so it reaches the other devices), with Undo beside the news. */
  const remove = async (item: Annotation) => {
    try {
      await annotationService.remove(item.id);
    } catch {
      say(`Couldn't remove that ${nameOf(item).toLowerCase()}.`);
      return;
    }
    setItems((current) => current?.filter((other) => other.id !== item.id) ?? current);
    changed();
    say(`${nameOf(item)} removed.`, item);
  };

  /** Saving it again under the same id clears the tombstone. */
  const putBack = async (item: Annotation) => {
    const { createdAt: _c, updatedAt: _u, deletedAt: _d, ...input } = item;
    try {
      const saved = await annotationService.save(input);
      setItems((current) => [...(current ?? []).filter((other) => other.id !== saved.id), saved]);
      changed();
      say(`${nameOf(item)} put back.`);
    } catch {
      say(`Couldn't put the ${nameOf(item).toLowerCase()} back.`);
    }
  };

  const open = (item: Annotation) => {
    close();
    onOpenInBook(book, item.cfi);
  };

  return (
    <>
      <Header
        eyebrow="Highlights"
        title={book.title}
        detail={book.author ?? undefined}
        onBack={fromList ? () => showHighlightsView({ kind: "books" }) : undefined}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          label="Highlights and bookmarks"
          idPrefix={TABS_ID}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "highlights", label: `Highlights (${highlights.length})` },
            { id: "bookmarks", label: `Bookmarks (${bookmarks.length})` }
          ]}
        />
        {tab === "highlights" && (
          <button
            type="button"
            className="tactile-button flex items-center gap-2 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={highlights.length === 0}
            onClick={() => copy(highlightsMarkdown(book.title, book.author, highlights), "Highlights copied as Markdown.")}
            title="Copies every highlight and note, under its chapter, as Markdown"
          >
            <UiIcon name="copy" size={14} />
            Copy all as Markdown
          </button>
        )}
      </div>

      <div
        role="tabpanel"
        id={panelId(TABS_ID, tab)}
        aria-labelledby={tabId(TABS_ID, tab)}
        className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
      >
        {failed ? (
          <Empty>Leaflet couldn't read this book's highlights. Close this and try again.</Empty>
        ) : items === null ? (
          <p className="py-8 text-center text-sm text-on-surface-variant">Loading…</p>
        ) : tab === "highlights" ? (
          highlights.length === 0 ? (
            <Empty>
              No highlights in this book yet. Select some text while reading it and Leaflet offers to highlight it
              or add a note.
            </Empty>
          ) : (
            <div className="space-y-5">
              {groups.map((group, index) => (
                <section
                  key={`${index}-${group.chapter ?? ""}`}
                  aria-label={group.chapter ? (group.book ? `${group.book}: ${group.chapter}` : group.chapter) : "Before the first chapter"}
                >
                  {/* In a set of books, the book is named once, above its chapters. */}
                  {group.book && group.opensBook && <h3 className="mb-3 text-sm font-semibold text-on-surface">{group.book}</h3>}
                  {group.chapter &&
                    (group.book ? <h4 className={`${EYEBROW} mb-2`}>{group.chapter}</h4> : <h3 className={`${EYEBROW} mb-2`}>{group.chapter}</h3>)}
                  <ul className="space-y-2">
                    {group.items.map((item) => {
                      const color = HIGHLIGHT_COLORS[item.color ?? "yellow"] ?? HIGHLIGHT_COLORS.yellow;
                      const about = snippet(item.text || item.note);
                      const fromKindle = isKindlePlace(item.cfi);
                      return (
                        <li key={item.id} className="flex gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/70 p-4">
                          <span className="w-1 shrink-0 rounded-full" style={{ background: color.swatch }} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <span className="sr-only">{color.name} highlight</span>
                            <blockquote className="whitespace-pre-wrap break-words text-sm leading-relaxed text-on-surface">
                              {item.text}
                            </blockquote>
                            {item.note && (
                              <p className="mt-2 flex gap-2 text-sm leading-relaxed text-on-surface-variant">
                                <UiIcon name="note" size={14} className="mt-1 shrink-0" />
                                <span className="sr-only">Note:</span>
                                <span className="min-w-0 whitespace-pre-wrap break-words italic">{item.note}</span>
                              </p>
                            )}
                            <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1">
                              {fromKindle && (
                                <span
                                  className="mr-1 rounded border border-outline-variant px-1.5 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant"
                                  title={KINDLE_TAG_ABOUT}
                                >
                                  Kindle
                                </span>
                              )}
                              <time dateTime={item.createdAt} className="mr-auto pr-2 text-[11px] text-on-surface-variant">
                                {dateLabel(item.createdAt)}
                              </time>
                              {/* One brought from a Kindle has no place in the book to open it at. */}
                              {!fromKindle && <RowAction icon="book-open" label="Open in book" about={about} onClick={() => open(item)} />}
                              <RowAction icon="copy" label="Copy" about={about} onClick={() => copy(item.text || item.note || "", "Copied.")} />
                              <RowAction icon="trash" label="Remove" about={about} danger onClick={() => void remove(item)} />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )
        ) : bookmarks.length === 0 ? (
          <Empty>No bookmarks in this book. The bookmark button in the reader marks the page you are on.</Empty>
        ) : (
          <ul className="space-y-2">
            {bookmarks.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-xl border border-outline-variant/30 bg-surface-container-low/70 px-4 py-3"
              >
                <div className="mr-auto min-w-0 pr-2">
                  <p className="truncate text-sm font-semibold text-on-surface">{item.chapter || "Bookmark"}</p>
                  <time dateTime={item.createdAt} className="text-[11px] text-on-surface-variant">
                    {dateLabel(item.createdAt)}
                  </time>
                </div>
                <RowAction icon="book-open" label="Open in book" about={item.chapter ?? ""} onClick={() => open(item)} />
                <RowAction icon="trash" label="Remove" about={item.chapter ?? ""} danger onClick={() => void remove(item)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Always here, so a screen reader hears what is put into it. */}
      <div role="status" aria-live="polite" className={notice ? "mt-3 flex min-h-[2rem] items-center gap-3 text-xs text-on-surface-variant" : "sr-only"}>
        {notice && (
          <>
            <span>{notice.text}</span>
            {notice.undo && (
              <button
                ref={undoRef}
                type="button"
                className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
                onClick={() => notice.undo && void putBack(notice.undo)}
              >
                <UiIcon name="undo" size={14} />
                Undo
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
};

type HighlightsDialogProps = {
  /** "Open in book": the app opens the book the usual way, at this place. */
  onOpenInBook: (book: Book, cfi: string) => void;
};

/**
 * Highlights, read from the library without opening a book: one book's (from
 * its menu), or the list of books that have any (from the Library's
 * Highlights button), which leads to the same view.
 *
 * Opened from anywhere (`openHighlights`, `openHighlightsList`) and mounted
 * once, at the top of the app, like the series editor.
 */
export const HighlightsDialog = ({ onOpenInBook }: HighlightsDialogProps) => {
  const view = useHighlightsStore((state) => state.view);
  const books = useLibraryStore((state) => state.books);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const open = view !== null;
  const book = view?.kind === "book" ? books.find((item) => item.id === view.bookId) ?? null : null;
  // A book removed (here or by a sync) while its highlights are showing.
  const bookGone = view?.kind === "book" && !book;

  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    // Capture phase, as the app's other dialogs do, so nothing under this one sees the Escape.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]);

  // Focus moves into the dialog, and again when the list gives way to a book
  // (the row that was pressed is gone by then).
  const viewKey = view ? (view.kind === "book" ? `book:${view.bookId}` : "books") : null;
  useEffect(() => {
    if (viewKey) {
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
  }, [viewKey]);

  useEffect(() => {
    if (bookGone) {
      close();
    }
  }, [bookGone]);

  if (!view || bookGone) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="highlights-dialog-title"
        // One height for the list and for a book, long or short: the dialog
        // does not jump under the pointer as highlights are removed.
        className="modal-surface confirm-pop flex h-[min(85vh,44rem)] w-full max-w-2xl flex-col rounded-2xl p-5"
      >
        {view.kind === "book" && book ? (
          <BookView key={book.id} book={book} fromList={view.fromList} onOpenInBook={onOpenInBook} />
        ) : (
          <BooksView />
        )}
      </div>
    </div>
  );
};
