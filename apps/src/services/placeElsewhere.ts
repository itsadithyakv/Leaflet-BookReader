/**
 * "Your other device is further on" (docs/mobile.md, "What hand in hand means").
 *
 * A book's row holds the place every device agrees on, and a sync moves it.
 * The backend also keeps where this device itself last stood
 * (`place_here`). When the two differ, the book opens where this device left
 * it and the other place is offered (components/sync/FurtherOnOffer): a place
 * lost to a sync is worse than one tap, so the reader is never moved silently.
 */
import { create } from "zustand";
import type { Book } from "@shared/models/book";
import { syncService, type Place } from "./syncService";
import { pullBeforeOpen } from "./syncTiming";
import { useLibraryStore } from "../store/libraryStore";

export type { Place };

/** The place offered, for the book being opened. */
export type PlaceOffer = {
  bookId: string;
  there: Place;
  /** The other device's place is further into the book than this one's. */
  ahead: boolean;
};

/** Closer than this (a few lines) is the same place. */
const SAME_PLACE = 0.002;

const samePlace = (a: Place, b: Place) => Math.abs(a.progress - b.progress) < SAME_PLACE;

/**
 * Where to open, and what to offer. `agreed` is the book as the library has it
 * (after a pull); `here` is where this device last stood, null if it never
 * read the book (then the agreed place is the only one, and is simply used).
 */
export const decidePlace = (agreed: Book, here: Place | null): { open: Place; offer: PlaceOffer | null } => {
  const there: Place = { progress: agreed.progress ?? 0, position: agreed.position ?? null };
  if (!here || samePlace(here, there)) {
    return { open: there, offer: null };
  }
  return { open: here, offer: { bookId: agreed.id, there, ahead: there.progress > here.progress } };
};

type OfferState = {
  offer: PlaceOffer | null;
  setOffer: (offer: PlaceOffer | null) => void;
};

export const usePlaceOffer = create<OfferState>((set) => ({
  offer: null,
  setOffer: (offer) => set({ offer })
}));

/** Books already put through `withPlaceHere`, so the open that follows does not do it again. */
const checked = new WeakSet<Book>();

export const placeChecked = (book: Book) => checked.has(book);

/**
 * Pulls (when one is due, a few seconds at most), then answers the book to
 * open: at this device's own place, with the other device's waiting as an
 * offer. Never rejects; anything amiss opens the book as it was.
 */
export const withPlaceHere = async (book: Book): Promise<Book> => {
  let ready = book;
  try {
    await pullBeforeOpen();
    const agreed = useLibraryStore.getState().books.find((candidate) => candidate.id === book.id) ?? book;
    const here = await syncService.placeHere(book.id);
    const { open, offer } = decidePlace(agreed, here);
    usePlaceOffer.getState().setOffer(offer);
    ready = offer ? { ...agreed, progress: open.progress, position: open.position } : agreed;
  } catch {
    usePlaceOffer.getState().setOffer(null);
  }
  checked.add(ready);
  return ready;
};
