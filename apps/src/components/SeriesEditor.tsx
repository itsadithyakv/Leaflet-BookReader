import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useLibraryStore } from "../store/libraryStore";
import { guessSeries, librarySeries, seriesNumberLabel } from "../library/series";

/**
 * Where the reader corrects a book's series: names it and its number, says it
 * is in none, or hands it back to the library's own guess.
 *
 * Opened from anywhere (`openSeriesEditor`) and mounted once, at the top of
 * the app: book cards move and transform, which would carry a dialog with them.
 */
const useSeriesEditorStore = create<{ bookId: string | null }>(() => ({ bookId: null }));

export const openSeriesEditor = (bookId: string) => useSeriesEditorStore.setState({ bookId });
const close = () => useSeriesEditorStore.setState({ bookId: null });

export const SeriesEditorDialog = () => {
  const bookId = useSeriesEditorStore((state) => state.bookId);
  const books = useLibraryStore((state) => state.books);
  const setSeries = useLibraryStore((state) => state.setSeries);
  const book = books.find((item) => item.id === bookId) ?? null;
  const series = librarySeries(books);
  const current = book ? series.byBook.get(book.id) ?? null : null;
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  // The names already in the library, so one series is typed the same way twice.
  const knownNames = useMemo(() => [...new Set(series.groups.map((group) => group.name))].sort(), [series]);

  useEffect(() => {
    if (!bookId) {
      return;
    }
    setName(current?.name ?? "");
    setNumber(current?.index != null ? String(current.index) : "");
    setError(null);
    window.setTimeout(() => nameRef.current?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // Filled once per opening, not on every library change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  if (!book) {
    return null;
  }

  const guess = guessSeries(book);
  const saidByReader = book.series !== null && book.series !== undefined;
  const source =
    book.series === ""
      ? "You said this book is not in a series."
      : saidByReader
        ? "Saved on the book."
        : current
          ? `Leaflet's guess${guess && guess !== "none" && guess.strength === "weak" ? ", from titles like it" : ", from the title"}.`
          : "Leaflet did not find a series for this book.";

  const run = async (nextName: string | null, nextIndex: number | null) => {
    setSaving(true);
    setError(null);
    try {
      await setSeries(book.id, nextName, nextIndex);
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name the series, or choose “Not in a series”.");
      return;
    }
    const parsed = number.trim() === "" ? null : Number(number);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed >= 10000)) {
      setError("The number is a book's place in the series, like 3 or 2.5.");
      return;
    }
    void run(trimmed, parsed);
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="series-editor-title"
        className="modal-surface confirm-pop dialog-fit w-full max-w-md rounded-2xl p-6"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Series</p>
        <h2 id="series-editor-title" className="page-title mt-1 line-clamp-3 break-words text-xl text-on-surface" title={book.title}>
          {book.title}
        </h2>
        <p className="mt-1 text-xs text-on-surface-variant">
          {current ? `${current.name}${current.index != null ? ` · ${seriesNumberLabel(current.index)}` : ""}. ` : ""}
          {source}
        </p>

        <div className="mt-5 grid grid-cols-[1fr_6rem] gap-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-on-surface-variant">Series name</span>
            <input
              ref={nameRef}
              className="inset-field mt-1 w-full px-3 py-2 text-sm text-on-surface"
              value={name}
              list="series-editor-names"
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
            />
            <datalist id="series-editor-names">
              {knownNames.map((known) => (
                <option key={known} value={known} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-on-surface-variant">Number</span>
            <input
              className="inset-field mt-1 w-full px-3 py-2 text-sm text-on-surface"
              value={number}
              inputMode="decimal"
              placeholder="—"
              onChange={(event) => setNumber(event.target.value)}
            />
          </label>
        </div>
        {error && (
          <p className="mt-3 text-xs text-error" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="tactile-button tactile-button-primary px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em]"
          >
            Save
          </button>
          <button
            type="button"
            disabled={saving}
            className="tactile-button px-4 py-2 text-xs font-semibold"
            onClick={() => void run("", null)}
          >
            Not in a series
          </button>
          {saidByReader && (
            <button
              type="button"
              disabled={saving}
              className="tactile-button px-4 py-2 text-xs font-semibold"
              onClick={() => void run(null, null)}
              title="Forget this and use what the book itself says, or Leaflet's guess from the title"
            >
              Let Leaflet decide
            </button>
          )}
          <button type="button" className="ml-auto px-2 py-2 text-xs text-on-surface-variant hover:text-on-surface" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};
