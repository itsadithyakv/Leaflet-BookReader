import { useEffect, useMemo, useState } from "react";
import type { Book } from "@shared/models/book";
import { useLibraryStore } from "../store/libraryStore";
import { useCollectionStore } from "../store/collectionStore";
import { useLibrarySeries } from "../library/useSeries";
import { buildShelves, type Shelf, type ShelfId } from "../library/shelves";
import type { SeriesGroup } from "../library/series";
import { BookGrid } from "../components/BookGrid";
import type { BookMenuAction } from "../components/BookMenu";
import { CoverStack } from "../components/collections/CoverStack";
import { SeriesDetail } from "../components/collections/SeriesDetail";
import { BookPicker } from "../components/collections/BookPicker";
import { askConfirm } from "../components/ConfirmDialog";
import { UiIcon } from "../components/UiIcon";
import { EYEBROW, SectionHeader } from "../components/ui/SectionHeader";

export type CollectionsPageProps = {
  onNavigate: (tab: "library" | "collections" | "social" | "settings") => void;
  onOpenBook: (book: Book) => void;
  showToast: (message: string) => void;
};

type View = { kind: "series"; key: string } | { kind: "shelf"; id: ShelfId } | { kind: "collection"; id: string };

/** How many authors and genres show before "Show all". */
const BROWSE_PREVIEW = 12;

/**
 * The cards of a section. Four to a row in a desktop window; more past it, so
 * a card on a 4K or ultrawide screen is no wider than one at 1,600 px.
 */
const CARD_GRID =
  "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [@media(min-width:1900px)]:grid-cols-5 [@media(min-width:2300px)]:grid-cols-6";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const Tile = ({
  books,
  title,
  lines,
  progress,
  onClick
}: {
  books: Book[];
  title: string;
  lines: string[];
  progress?: number;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="paper-surface group flex min-w-0 flex-col gap-4 rounded-xl p-4 text-left transition-transform duration-200 hover:-translate-y-1"
  >
    <CoverStack books={books} className="w-full" />
    <div className="min-w-0">
      <p className="book-title truncate text-lg text-on-surface group-hover:text-primary">{title}</p>
      {lines.map((line) => (
        <p key={line} className="truncate text-xs text-on-surface-variant">
          {line}
        </p>
      ))}
      {progress !== undefined && (
        <div className="mt-2 h-1 w-full rounded-full bg-surface-container-highest">
          <div className="h-1 rounded-full bg-tertiary" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  </button>
);

const seriesLines = (group: SeriesGroup) => {
  const total = group.total ?? group.ownedCount;
  const lines = [`${group.finishedCount} of ${total} read`];
  if (group.total !== null && group.ownedCount < group.total) {
    lines.push(`${group.ownedCount} of ${group.total} in your library`);
  } else if (group.missing.length > 0) {
    lines.push(
      group.missing.length <= 4
        ? `Missing ${group.missing.map((entry) => entry.index).join(", ")}`
        : `${group.missing.length} books missing`
    );
  } else if (group.author) {
    lines.push(group.author);
  }
  return lines;
};

export const CollectionsPage = ({ onNavigate, onOpenBook, showToast }: CollectionsPageProps) => {
  const books = useLibraryStore((state) => state.books);
  const setFilter = useLibraryStore((state) => state.setFilter);
  const deleteBook = useLibraryStore((state) => state.deleteBook);
  const refreshMetadata = useLibraryStore((state) => state.refreshMetadata);
  const series = useLibrarySeries();
  const shelves = useMemo(() => buildShelves(books, series), [books, series]);
  const { collections, loaded, load, create, rename, remove, addBooks, removeBook } = useCollectionStore();
  const [view, setView] = useState<View | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [showAllBrowse, setShowAllBrowse] = useState(false);

  useEffect(() => {
    if (!loaded) {
      void load();
    }
  }, [loaded, load]);

  const byId = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);
  const booksOf = (ids: string[]) => ids.map((id) => byId.get(id)).filter((book): book is Book => Boolean(book));

  const authors = useMemo(() => countBy(books.map((book) => (book.author ? [book.author] : []))), [books]);
  const genres = useMemo(() => countBy(books.map((book) => book.genres ?? [])), [books]);

  const createCollection = async () => {
    const name = newName.trim();
    if (!name) {
      return;
    }
    try {
      const made = await create(name);
      setNewName("");
      setCreating(false);
      setView({ kind: "collection", id: made.id });
      setPicking(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not make that collection.");
    }
  };

  const removeFromLibrary = async (book: Book) => {
    const ok = await askConfirm({
      title: `Remove “${book.title}”?`,
      body: "It leaves your library on every synced device. The other copy stays.",
      confirmLabel: "Remove",
      danger: true
    });
    if (ok) {
      await deleteBook(book.id);
      showToast(`Removed ${book.title}.`);
    }
  };

  // ---- one series, shelf or collection ------------------------------------------------
  if (view) {
    const group = view.kind === "series" ? series.groups.find((item) => item.key === view.key) : undefined;
    const shelf = view.kind === "shelf" ? shelves.find((item) => item.id === view.id) : undefined;
    const collection = view.kind === "collection" ? collections.find((item) => item.id === view.id) : undefined;
    // Gone (a shelf emptied, a series split, a collection deleted elsewhere): back to the overview.
    if (!group && !shelf && !collection) {
      return (
        <div className="mx-auto flex min-h-full w-full max-w-[2240px] flex-col items-start gap-4">
          <BackButton onClick={() => setView(null)} />
          <p className="text-sm text-on-surface-variant">This is no longer in your library.</p>
        </div>
      );
    }
    const title = group?.name ?? shelf?.name ?? collection?.name ?? "";
    const collectionBooks = collection ? booksOf(collection.bookIds) : [];

    return (
      <div className="dock-clear mx-auto flex min-h-full w-full max-w-[2240px] flex-col gap-6">
        <div className="flex flex-col gap-3">
          <BackButton onClick={() => setView(null)} />
          <div className="flex flex-wrap items-end justify-between gap-4">
            {collection && renaming === collection.id ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = (new FormData(event.currentTarget).get("name") as string).trim();
                  if (value) {
                    void rename(collection.id, value);
                  }
                  setRenaming(null);
                }}
              >
                <input
                  name="name"
                  autoFocus
                  defaultValue={collection.name}
                  maxLength={80}
                  className="inset-field page-title px-3 py-1 text-3xl"
                  onBlur={(event) => event.currentTarget.form?.requestSubmit()}
                />
              </form>
            ) : (
              <h2 className="page-title text-4xl">{title}</h2>
            )}
            {collection && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold" onClick={() => setPicking(true)}>
                  <span className="flex items-center gap-1.5">
                    <UiIcon name="plus" size={14} /> Add books
                  </span>
                </button>
                <button type="button" className="tactile-button px-3 py-2 text-xs" onClick={() => setRenaming(collection.id)}>
                  <span className="flex items-center gap-1.5">
                    <UiIcon name="edit" size={14} /> Rename
                  </span>
                </button>
                <button
                  type="button"
                  className="tactile-button px-3 py-2 text-xs text-error"
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: `Delete “${collection.name}”?`,
                      body: "Only the collection goes; its books stay in your library.",
                      confirmLabel: "Delete",
                      danger: true
                    });
                    if (ok) {
                      await remove(collection.id);
                      setView(null);
                      showToast(`Deleted ${collection.name}.`);
                    }
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <UiIcon name="trash" size={14} /> Delete
                  </span>
                </button>
              </div>
            )}
          </div>
          {shelf && <p className="text-sm text-on-surface-variant">{shelf.description}</p>}
          {collection && <p className="text-sm text-on-surface-variant">{plural(collectionBooks.length, "book")}</p>}
        </div>

        {group && <SeriesDetail group={group} onOpen={onOpenBook} />}
        {shelf && (
          <BookGrid
            books={shelf.books}
            onRefresh={refreshMetadata}
            onOpen={onOpenBook}
            menuActions={
              shelf.id === "duplicates"
                ? (book) => [{ label: "Remove from library", danger: true, onSelect: () => void removeFromLibrary(book) }]
                : undefined
            }
          />
        )}
        {collection &&
          (collectionBooks.length === 0 ? (
            <div className="paper-surface flex flex-col items-center gap-3 rounded-xl p-10 text-center">
              <p className="text-lg font-semibold text-on-surface">Nothing here yet</p>
              <p className="max-w-sm text-sm text-on-surface-variant">
                Add books here, or from any book's ⋯ menu in your library.
              </p>
              <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-sm font-semibold" onClick={() => setPicking(true)}>
                Add books
              </button>
            </div>
          ) : (
            <BookGrid
              books={collectionBooks}
              onRefresh={refreshMetadata}
              onOpen={onOpenBook}
              menuActions={(book): BookMenuAction[] => [
                { label: "Remove from this collection", onSelect: () => void removeBook(collection.id, book.id) }
              ]}
            />
          ))}
        {collection && picking && (
          <BookPicker
            title={`Add to ${collection.name}`}
            books={books.filter((book) => !collection.bookIds.includes(book.id))}
            onCancel={() => setPicking(false)}
            onDone={(ids) => {
              setPicking(false);
              void addBooks(collection.id, ids).then(() => showToast(`${plural(ids.length, "book")} added.`));
            }}
          />
        )}
      </div>
    );
  }

  // ---- everything ---------------------------------------------------------------------
  const browse = (label: string, items: Array<{ name: string; count: number }>, apply: (name: string) => void) => (
    <div>
      <p className={EYEBROW}>{label}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(showAllBrowse ? items : items.slice(0, BROWSE_PREVIEW)).map((item) => (
          <button
            key={item.name}
            type="button"
            className="tactile-button px-3 py-1.5 text-xs"
            onClick={() => {
              apply(item.name);
              onNavigate("library");
            }}
          >
            {item.name} <span className="text-on-surface-variant">{item.count}</span>
          </button>
        ))}
        {items.length === 0 && <p className="text-xs text-on-surface-variant">None yet.</p>}
      </div>
    </div>
  );

  return (
    <div className="dock-clear mx-auto flex min-h-full w-full max-w-[2240px] flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="page-title text-4xl">Collections</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Series and shelves that sort themselves, and collections of your own.
          </p>
        </div>
        {creating ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void createCollection();
            }}
          >
            <input
              autoFocus
              className="inset-field px-3 py-2 text-sm text-on-surface"
              placeholder="Name, e.g. Book club"
              maxLength={80}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setCreating(false);
                }
              }}
            />
            <button type="submit" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold">
              Create
            </button>
          </form>
        ) : (
          <button type="button" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold" onClick={() => setCreating(true)}>
            <span className="flex items-center gap-1.5">
              <UiIcon name="plus" size={14} /> New collection
            </span>
          </button>
        )}
      </div>

      <section aria-labelledby="series-title" className="flex flex-col gap-4">
        <SectionHeader eyebrow="Found in your library" title="Series" id="series-title" />
        {series.groups.length === 0 ? (
          <p className="paper-surface rounded-xl p-5 text-sm text-on-surface-variant">
            No series yet. When you have two books of one (Harry Potter, The Expanse, Discworld…), they gather here
            in order by themselves.
          </p>
        ) : (
          <div className={CARD_GRID}>
            {series.groups.map((group) => (
              <Tile
                key={group.key}
                books={group.members.map((member) => member.book)}
                title={group.name}
                lines={seriesLines(group)}
                progress={group.finishedCount / Math.max(1, group.total ?? group.ownedCount)}
                onClick={() => setView({ kind: "series", key: group.key })}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="shelves-title" className="flex flex-col gap-4">
        <SectionHeader eyebrow="Kept up to date for you" title="Shelves" id="shelves-title" />
        {shelves.length === 0 ? (
          <p className="paper-surface rounded-xl p-5 text-sm text-on-surface-variant">Import a few books to fill these.</p>
        ) : (
          <div className={CARD_GRID}>
            {shelves.map((shelf: Shelf) => (
              <Tile
                key={shelf.id}
                books={shelf.books}
                title={shelf.name}
                lines={[plural(shelf.books.length, "book"), shelf.description]}
                onClick={() => setView({ kind: "shelf", id: shelf.id })}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="yours-title" className="flex flex-col gap-4">
        <SectionHeader eyebrow="Made by you" title="Your collections" id="yours-title" />
        {collections.length === 0 ? (
          <p className="paper-surface rounded-xl p-5 text-sm text-on-surface-variant">
            None yet. Make one with <strong className="text-on-surface">New collection</strong>, or from any book's ⋯ menu.
          </p>
        ) : (
          <div className={CARD_GRID}>
            {collections.map((collection) => {
              const inIt = booksOf(collection.bookIds);
              return (
                <Tile
                  key={collection.id}
                  books={inIt}
                  title={collection.name}
                  lines={[plural(inIt.length, "book")]}
                  onClick={() => setView({ kind: "collection", id: collection.id })}
                />
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="browse-title" className="paper-surface flex flex-col gap-6 rounded-xl p-5">
        <SectionHeader
          eyebrow="Opens the library, filtered"
          title="Browse by"
          id="browse-title"
          actions={
            authors.length > BROWSE_PREVIEW || genres.length > BROWSE_PREVIEW ? (
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setShowAllBrowse((value) => !value)}>
                {showAllBrowse ? "Show fewer" : "Show all"}
              </button>
            ) : undefined
          }
        />
        {browse("Authors", authors, (author) => setFilter({ author, genre: "all", query: "", view: "grid" }))}
        {browse("Genres", genres, (genre) => setFilter({ genre, author: "all", query: "", view: "grid" }))}
      </section>
    </div>
  );
};

const BackButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="flex items-center gap-1.5 self-start py-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface" onClick={onClick}>
    <UiIcon name="back" size={14} /> Collections
  </button>
);

/** Names with how many books have each, most first. */
const countBy = (lists: string[][]) => {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const name of list) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
};
