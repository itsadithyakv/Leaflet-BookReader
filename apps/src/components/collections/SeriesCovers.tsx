import { useEffect, useState } from "react";
import type { Book } from "@shared/models/book";
import { bookService, type CoverSet } from "../../services/bookService";
import { titleToLookUp, type SeriesGroup } from "../../library/series";
import { useLibraryStore } from "../../store/libraryStore";

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

const Preview = ({ coverId, label }: { coverId: number; label: string }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    preview(coverId)
      .then((data) => live && setSrc(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [coverId]);
  return (
    <span className="book-cover-frame block h-28 w-[4.7rem] shrink-0 overflow-hidden bg-surface-container-high" title={label}>
      {src ? (
        <img src={src} alt={label} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center p-1 text-center text-[9px] leading-tight text-on-surface-variant">{failed ? "No picture" : "…"}</span>
      )}
    </span>
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
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const byId = new Map(group.members.map((member) => [member.book.id, member]));

  useEffect(() => {
    let live = true;
    bookService
      .seriesCoverSets(group.members.map((member) => ({ bookId: member.book.id, title: titleToLookUp(group, member), author: member.book.author ?? null })))
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
      window.removeEventListener("keydown", onKey, true);
    };
    // The series as it was when the dialog opened: its books do not change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.key]);

  const use = async (set: CoverSet) => {
    setApplying(set.name);
    let done = 0;
    for (const cover of set.covers) {
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
    showToast(done === set.covers.length ? `${set.name}: ${done} ${done === 1 ? "cover" : "covers"} changed.` : `${done} of ${set.covers.length} covers changed; the rest could not be fetched.`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-surface flex max-h-full w-full max-w-3xl flex-col p-6" role="dialog" aria-modal="true" aria-labelledby="series-covers-title">
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
            <p className="text-sm text-on-surface-variant">Asking Open Library for this series' editions…</p>
          ) : sets.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Open Library has no other covers for these books.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {sets.map((set) => (
                <li key={set.name} className="rounded-xl border border-outline-variant/30 bg-surface-container/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold text-on-surface">
                      {set.name}{" "}
                      <span className="text-xs font-normal text-on-surface-variant">
                        {set.covers.length} of {group.members.length}
                      </span>
                    </p>
                    <button
                      type="button"
                      className="tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                      disabled={applying !== null}
                      onClick={() => void use(set)}
                    >
                      {applying === set.name ? "Changing…" : "Use these"}
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {set.covers.map((cover) => (
                      <Preview key={cover.coverId} coverId={cover.coverId} label={byId.get(cover.bookId)?.book.title ?? "A book of the series"} />
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
