import type { CSSProperties } from "react";
import type { Book } from "@shared/models/book";
import { useCoverSrc } from "../../hooks/useCoverSrc";
import { inkFor } from "../shelf/spine";

const TiltedCover = ({ book }: { book: Book }) => {
  const { src, onError } = useCoverSrc(book, { thumb: true });
  return (
    <span className="genre-tile-cover" aria-hidden="true">
      {src ? (
        <img src={src} alt="" onError={onError} />
      ) : (
        <span className="genre-tile-untitled">{book.title}</span>
      )}
    </span>
  );
};

/**
 * A genre as a block of colour with its name on it and one of its covers
 * leaning out of the corner: the wall of them is how the library is browsed
 * by genre. The colour is one of the session shelf's cloths
 * (library/genres.ts hands them out so that neighbours differ).
 */
export const GenreTile = ({
  name,
  count,
  face,
  colour,
  onClick
}: {
  name: string;
  count: number;
  face: Book | null;
  colour: string;
  onClick: () => void;
}) => {
  return (
    <button
      type="button"
      className="genre-tile"
      style={{ "--genre": colour, "--genre-ink": inkFor(colour) } as CSSProperties}
      onClick={onClick}
      aria-label={`${name}, ${count} ${count === 1 ? "book" : "books"}`}
    >
      <span className="genre-tile-name font-headline">{name}</span>
      <span className="genre-tile-count">
        {count} {count === 1 ? "book" : "books"}
      </span>
      {face && <TiltedCover book={face} />}
    </button>
  );
};
