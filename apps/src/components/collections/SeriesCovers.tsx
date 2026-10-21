import { useEffect, useState } from "react";
import type { Book } from "@shared/models/book";
import { bookService, type CoverProgress, type CoverSet } from "../../services/bookService";
import { titleToLookUp, type SeriesGroup } from "../../library/series";
import { useLibraryStore } from "../../store/libraryStore";
import { SheetHandle } from "../ui/SheetHandle";
import { useBackClose } from "../../hooks/useBackClose";
import { backdropClose } from "../ui/backdrop";
import "./covers.css";

/** One cover on offer, fetched small when its row comes up. Kept for the life of the app: a set looked at twice is not fetched twice. */
const previews = new Map<number, Promise<string>>();
const preview = (coverId: number) => {
  let asked = previews.get(coverId);
  if (!asked) {
    asked = bookService.coverPreview(coverId);
    // A failed fetch is asked for again next time, not remembered as a failure.
    asked.catch(() => previews.delete(coverId));
    previews.set(coverId, asked);
  }
  return asked;
};

const NO_PICTURE =
  "flex h-full items-center justify-center p-1 text-center text-[9px] leading-tight " +
  "text-on-surface-variant";

/** One publisher's set, as a card; and the blank ones while the sets are looked for. */
const SET_CARD = "rounded-xl border border-outline-variant/30 bg-surface-container/40 p-3";

type PreviewProps = { coverId: number; label: string; onMissing: (coverId: number) => void };

const Preview = ({ coverId, label, onMissing }: PreviewProps) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    preview(coverId)
      .then((data) => live && setSrc(data))
      .catch(() => {
        if (live) {
          setFailed(true);
          onMissing(coverId);
        }
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverId]);
  return (
    <span className="book-cover-frame block h-28 w-[4.7rem] shrink-0 overflow-hidden bg-surface-container-high" title={label}>
      {src ? (
        <img src={src} alt={label} className="h-full w-full object-cover" />
      ) : (
        <span className={NO_PICTURE}>{failed ? "No picture" : "…"}</span>
      )}
    </span>
  );
};

/**
 * Blank covers while the series is looked up, one a book (a row's worth at
 * most), stamped as each book is done; and how many are done.
 */
const Looking = ({ books, progress }: { books: number; progress: CoverProgress | null }) => {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? books;
  const tiles = Math.min(Math.max(total, 1), 7);
  const row = (found: number, key: string) => (
    <div key={key} className={SET_CARD}>
      <div className="flex items-center justify-between gap-3">
        <span className="cover-ghost-bar w-28" />
        <span className="cover-ghost-bar h-7 w-20 rounded-full" />
      </div>
      <div className="mt-3 flex gap-2 overflow-hidden">
        {Array.from({ length: tiles }, (_, at) => (
          <span
            key={at}
            className={`cover-ghost h-28 w-[4.7rem] shrink-0 ${at < found ? "is-found" : ""}`}
            style={{ ["--ghost-delay" as string]: `${at * 140}ms` }}
          />
        ))}
      </div>
    </div>
  );
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-on-surface">
          Looking through the editions… this can take a minute.
        </p>
        {total > 0 && (
          <p className="mt-0.5 text-xs text-on-surface-variant tabular-nums">
            {Math.min(done, total)} of {total} {total === 1 ? "book" : "books"}
          </p>
        )}
      </div>
      {/* The first row fills in as the books are looked up; the second only waits. */}
      {row(Math.round((done / Math.max(total, 1)) * tiles), "looked")}
      {row(0, "waiting")}
    </div>
  );
};

type Props = {
  group: SeriesGroup;
  onClose: () => void;
  showToast: (message: string) => void;
};

/**
 * The covers a series could wear: each publisher's edition as a row, one
 * cover a book, the publisher with most of the series first. Choosing a row
 * puts its covers on the books it has (the others keep theirs), so a series
 * whose books came from three places can be made to look like one set. Read
 * from Open Library when this opens; nothing is fetched until then.
 */
export const SeriesCovers = ({ group, onClose, showToast }: Props) => {
  const [sets, setSets] = useState<CoverSet[] | null>(null);
  const [progress, setProgress] = useState<CoverProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  // Covers Open Library has no picture for: not counted, and not put on a book.
  const [missing, setMissing] = useState<ReadonlySet<number>>(new Set());
  const onMissing = (coverId: number) => setMissing((held) => new Set(held).add(coverId));
  const byId = new Map(group.members.map((member) => [member.book.id, member]));
  useBackClose(true, onClose);

  useEffect(() => {
    // Closed while looking: the look stops between books, and what comes back late is not shown.
    let live = true;
    const asks = group.members.map((member) => ({
      bookId: member.book.id,
      title: titleToLookUp(group, member),
      author: member.book.author ?? null
    }));
    bookService
      .seriesCoverSets(asks, (told) => live && setProgress(told))
      .then((found) => live && setSets(found))
      .catch((cause) => live && setError(cause instanceof Error ? cause.message : String(cause)));
    // Capture phase, so nothing under the dialog sees its Escape.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      live = false;
      bookService.cancelSeriesCoverSets();
      window.removeEventListener("keydown", onKey, true);
    };
    // The series as it was when the dialog opened: its books do not change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.key]);

  /** A set's covers that have a picture. */
  const shown = (set: CoverSet) => set.covers.filter((cover) => !missing.has(cover.coverId));

  const use = async (set: CoverSet) => {
    setApplying(set.name);
    const covers = shown(set);
    let done = 0;
    for (const cover of covers) {
      try {
        const updated = await bookService.applyCover(cover.bookId, cover.coverId);
        if (updated) {
          // Only the cover is taken: the book may have been read on meanwhile.
          useLibraryStore.setState((state) => ({
            books: state.books.map((book: Book) => (book.id === updated.id ? { ...book, coverUrl: updated.coverUrl } : book))
          }));
          done += 1;
        }
      } catch {
        // One cover that will not come does not stop the rest.
      }
    }
    setApplying(null);
    if (done === 0) {
      showToast("Those covers could not be fetched. Try again in a moment.");
      return;
    }
    showToast(
      done === covers.length
        ? `${set.name}: ${done} ${done === 1 ? "cover" : "covers"} changed.`
        : `${done} of ${covers.length} covers changed; the rest could not be fetched.`
    );
    onClose();
  };

  return (
    <div className="sheet-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-6" {...backdropClose(() => onClose())}>
      <div className="modal-surface sheet-panel sheet-inner-scroll flex max-h-full w-full max-w-3xl flex-col p-6" role="dialog" aria-modal="true" aria-labelledby="series-covers-title">
        <SheetHandle onClose={onClose} />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Covers</p>
            <h2 id="series-covers-title" className="page-title mt-1 truncate text-2xl">
              {group.name}
            </h2>
          </div>
          <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={onClose} disabled={applying !== null}>
            Close
          </button>
        </div>

        <div className="mt-4 min-h-[8rem] flex-1 overflow-y-auto pr-1">
          {error ? (
            <p className="text-sm text-on-surface-variant">{error}</p>
          ) : sets === null ? (
            <Looking books={group.members.length} progress={progress} />
          ) : sets.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Open Library has no other covers for these books.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {sets.map((set) => (
                <li key={set.name} className={SET_CARD}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold text-on-surface">
                      {set.name}{" "}
                      <span className="text-xs font-normal text-on-surface-variant">
                        {shown(set).length} of {group.members.length}
                      </span>
                    </p>
                    <button
                      type="button"
                      className="tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                      disabled={applying !== null || shown(set).length === 0}
                      onClick={() => void use(set)}
                    >
                      {applying === set.name ? "Changing…" : "Use these"}
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {set.covers.map((cover) => (
                      <Preview
                        key={cover.coverId}
                        coverId={cover.coverId}
                        label={byId.get(cover.bookId)?.book.title ?? "A book of the series"}
                        onMissing={onMissing}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
