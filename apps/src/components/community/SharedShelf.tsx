import type { CSSProperties } from "react";
import type { ShelfBook } from "@shared/sync/types";
import { clothFor, hash, inkFor, spineHeight, spineWidth } from "../shelf/spine";

/**
 * A reader's shelf as others see it, in the same bookcase, cloth and lettering
 * as their own session shelf.
 *
 * No image is ever uploaded or downloaded: a spine's look derives from its seed,
 * so a shared shelf costs a few dozen bytes per book. The shared shelf does
 * not carry minutes, so a spine's size is a steady stand-in from the same seed.
 */
export const SharedShelf = ({ shelf, emptyText = "No books on this shelf yet." }: { shelf: ShelfBook[]; emptyText?: string }) => {
  if (shelf.length === 0) {
    return <p className="text-xs text-on-surface-variant">{emptyText}</p>;
  }
  return (
    <div className="ss ss-mini" data-wood="oak">
      <div className="ss-case">
        <div className="ss-row">
          <div className="ss-books" role="list" aria-label="Shelf">
            {shelf.slice(0, 12).map((book, index) => {
              const key = book.styleSeed || book.title || String(index);
              const cloth = clothFor(key);
              const minutes = 15 + (hash(key) % 40);
              const label = book.author ? `${book.title} by ${book.author}` : book.title;
              return (
                <span
                  key={`${key}-${index}`}
                  role="listitem"
                  aria-label={label}
                  title={label}
                  className="ss-spine"
                  style={
                    {
                      "--h": `${spineHeight(minutes)}px`,
                      "--w": `${spineWidth(minutes)}px`,
                      "--cloth": cloth,
                      "--ink": inkFor(cloth)
                    } as CSSProperties
                  }
                >
                  <span className="ss-cloth">
                    <span className="ss-title">{book.title}</span>
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
