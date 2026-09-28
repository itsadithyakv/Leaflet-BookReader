import type { ShelfBook } from "@shared/sync/types";

/** The same deterministic hash the session shelf uses, so a spine looks alike everywhere. */
const spineHash = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const spinePalette = ["#d9886e", "#4f9d8c", "#8a78c9", "#d0a44f", "#5d8d59", "#4f7fb7", "#c86a8a", "#c07d4c"];

/**
 * A shelf rendered from seeds alone.
 *
 * No image is ever uploaded or downloaded: a spine's colour, height and width
 * all derive from its seed, so a shared shelf costs a few dozen bytes per book.
 */
export const SharedShelf = ({ shelf, emptyText = "No books on this shelf yet." }: { shelf: ShelfBook[]; emptyText?: string }) => {
  if (shelf.length === 0) {
    return <p className="text-xs text-on-surface-variant">{emptyText}</p>;
  }
  return (
    <div className="flex items-end gap-1.5 overflow-x-auto border-b-4 border-outline-variant/50 pb-0.5">
      {shelf.slice(0, 12).map((book, index) => {
        const seed = spineHash(book.styleSeed || book.title || String(index));
        const colour = spinePalette[seed % spinePalette.length];
        const title = book.author ? `${book.title} — ${book.author}` : book.title;
        return (
          <div
            key={`${book.title}-${index}`}
            className="shrink-0 rounded-t-sm shadow-[0_4px_10px_rgba(0,0,0,0.25)]"
            style={{
              width: 12 + (seed % 7),
              height: 58 + (seed % 34),
              background: `linear-gradient(180deg, ${colour}, ${colour}cc)`
            }}
            title={title}
            aria-label={title}
            role="img"
          />
        );
      })}
    </div>
  );
};
