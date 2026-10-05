import { useMemo } from "react";
import { useLibraryStore } from "../../../store/libraryStore";
import { latestFinds } from "../../../pip/expedition";
import { AlbumPanel } from "./AlbumPanel";
import { useAlbum } from "./useAlbum";

/**
 * The album as a thing in Pip's room: its panel for the room's card, and
 * what the room's picture and the thing's label need to know. The room owns
 * the frame, the title, Close and the focus (components/pip/RoomCard.tsx);
 * this brings only what is in it.
 */

/** The album for a card over the room, in the HUD's inks. The card closes itself. */
export const AlbumRoomPanel = (_props: { onClose: () => void }) => {
  const album = useAlbum();
  const books = useLibraryStore((state) => state.books);
  const bookTitles = useMemo(() => new Map(books.map((book) => [book.id, book.title])), [books]);
  return <AlbumPanel album={album} bookTitles={bookTitles} skin="hud" />;
};

/** What the room shows of the album: how it stands in a phrase, and the newest finds, newest first. */
export type AlbumRoomData = {
  /** "12 of 44 found", "nothing found yet". */
  status: string;
  /** The ids of the newest three finds (pip/expedition-art.js draws them), newest first. */
  finds: string[];
};

export const useAlbumRoom = (): AlbumRoomData => {
  const album = useAlbum();
  return useMemo(
    () => ({
      status: album.found === 0 ? "nothing found yet" : `${album.found} of ${album.total} found`,
      finds: latestFinds(album, 3).map((found) => found.find.id)
    }),
    [album]
  );
};
