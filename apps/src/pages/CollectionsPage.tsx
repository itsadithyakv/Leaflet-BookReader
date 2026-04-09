import { useMemo } from "react";
import { useLibraryStore } from "../store/libraryStore";

export type CollectionsPageProps = {
  onNavigate: (tab: "library" | "collections" | "analytics" | "settings") => void;
  showToast: (message: string) => void;
};

export const CollectionsPage = ({ onNavigate, showToast }: CollectionsPageProps) => {
  const { books, filters, setFilter } = useLibraryStore();

  const genreCollections = useMemo(() => {
    const counts = new Map<string, number>();
    books.forEach((book) => {
      (book.genres ?? []).forEach((genre) => {
        counts.set(genre, (counts.get(genre) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [books]);

  const authorCollections = useMemo(() => {
    const counts = new Map<string, number>();
    books.forEach((book) => {
      if (book.author) {
        counts.set(book.author, (counts.get(book.author) ?? 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [books]);

  const applyGenreFilter = (genre: string) => {
    setFilter({ genre, view: "grid" });
    onNavigate("library");
  };

  const applyAuthorFilter = (author: string) => {
    setFilter({ author, view: "grid" });
    onNavigate("library");
  };

  const clearFilters = () => {
    setFilter({ query: "", author: "all", genre: "all", sort: "recent", view: "grid" });
    showToast("Filters cleared.");
  };

  const activeFilters = useMemo(() => {
    const items: string[] = [];
    if (filters.query.trim().length > 0) {
      items.push(`Search: "${filters.query.trim()}"`);
    }
    if (filters.author !== "all") {
      items.push(`Author: ${filters.author}`);
    }
    if (filters.genre !== "all") {
      items.push(`Genre: ${filters.genre}`);
    }
    return items;
  }, [filters.author, filters.genre, filters.query]);

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-headline font-bold">Collections</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Organize your library by genre or author and jump straight into the archive.
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant transition hover:text-primary"
          onClick={clearFilters}
        >
          Clear Filters
        </button>
      </div>

      <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
        <p className="text-xs uppercase tracking-widest text-on-surface-variant">Active Filters</p>
        <p className="mt-3 text-sm text-on-surface-variant">
          {activeFilters.length === 0 ? "No filters applied." : activeFilters.join(" | ")}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-widest text-on-surface-variant">Genres</p>
            <span className="text-xs text-on-surface-variant">{genreCollections.length}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {genreCollections.length === 0 ? (
              <div className="rounded-xl border border-dashed border-outline-variant/40 p-4 text-xs text-on-surface-variant">
                No genres yet. Import a few books to populate this shelf.
              </div>
            ) : (
              genreCollections.map((collection) => (
                <button
                  key={collection.name}
                  type="button"
                  onClick={() => applyGenreFilter(collection.name)}
                  className="rounded-xl border border-outline-variant/20 bg-surface-container-high p-4 text-left transition hover:border-primary/40 hover:text-primary"
                >
                  <p className="font-headline text-lg font-semibold">{collection.name}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {collection.count} {collection.count === 1 ? "book" : "books"}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-widest text-on-surface-variant">Authors</p>
            <span className="text-xs text-on-surface-variant">{authorCollections.length}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {authorCollections.length === 0 ? (
              <div className="rounded-xl border border-dashed border-outline-variant/40 p-4 text-xs text-on-surface-variant">
                No authors yet. Import a few books to populate this shelf.
              </div>
            ) : (
              authorCollections.map((collection) => (
                <button
                  key={collection.name}
                  type="button"
                  onClick={() => applyAuthorFilter(collection.name)}
                  className="rounded-xl border border-outline-variant/20 bg-surface-container-high p-4 text-left transition hover:border-primary/40 hover:text-primary"
                >
                  <p className="font-headline text-base font-semibold">{collection.name}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {collection.count} {collection.count === 1 ? "book" : "books"}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
