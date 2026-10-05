import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useLibraryStore } from "../../../store/libraryStore";
import type { Album } from "../../../pip/expedition";
import { AlbumPanel } from "./AlbumPanel";
import { useAlbum } from "./useAlbum";

type AlbumDialogProps = {
  onClose: () => void;
  /** The album to show; the reader's own (worked out from their shelf) when none is given. */
  album?: Album;
  /** The find to open on; the newest when none is given. */
  initial?: string | null;
};

/** What Tab stops at: not the grid's other keys, which the arrows reach. */
const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Pip's album as a dialog over the house, like the shop. Escape, Close or a
 * click outside shuts it, and focus goes back to whatever opened it.
 */
export const AlbumDialog = ({ onClose, album, initial }: AlbumDialogProps) => {
  const own = useAlbum();
  const books = useLibraryStore((state) => state.books);
  const bookTitles = useMemo(() => new Map(books.map((book) => [book.id, book.title])), [books]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    // Tab stays in the dialog: off either end it comes round to the other.
    const stops = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = stops[0];
    const last = stops[stops.length - 1];
    const at = document.activeElement;
    if (first && last && (event.shiftKey ? at === first || at === headingRef.current : at === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  return (
    <div className="pip-shop-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="pip-album-dialog modal-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pip-album-title"
        onKeyDown={onKeyDown}
      >
        <header className="pip-album-head">
          <div className="min-w-0">
            <h2 id="pip-album-title" ref={headingRef} tabIndex={-1} className="page-title text-3xl text-on-surface outline-none">
              Pip's album
            </h2>
            <p className="text-xs text-on-surface-variant">What she brought back from her expeditions, one for every focus session.</p>
          </div>
          <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={onClose}>
            Close
          </button>
        </header>
        <AlbumPanel album={album ?? own} bookTitles={bookTitles} initial={initial} />
      </div>
    </div>
  );
};
