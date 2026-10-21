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
/** Under this is the start of the book: never a place to be offered. */
const AT_START = 0.01;

const samePlace = (a: Place, b: Place) => Math.abs(a.progress - b.progress) < SAME_PLACE;

const time = (iso: string | null | undefined) => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? at : null;
};

/**
 * Where to open, and what to offer. `agreed` is the book as the library has it
 * (after a pull); `here` is where this device last stood (and when), null if
 * it never read the book (then the agreed place is the only one, and is simply
 * used).
 *
 * Offered only when it is worth a tap: another device's place further into
 * the book than this one's, past its start, and set after this device last
 * stood in it. A books row that merely differs is not that: a book removed
 * and imported again had a fresh row at 0% beside this device's old place,
 * and offered "Your other device was last at Chapter 1 · 0%", which would
 * have taken the reader to the start of the book.
 */
export const decidePlace = (agreed: Book, here: (Place & { at?: string | null }) | null): { open: Place; offer: PlaceOffer | null } => {
  const there: Place = { progress: agreed.progress ?? 0, position: agreed.position ?? null };
  if (!here || samePlace(here, there)) {
    return { open: there, offer: null };
  }
  const open: Place = { progress: here.progress, position: here.position };
  const ahead = there.progress > here.progress;
  const pastStart = there.progress >= AT_START;
  const movedSince = time(agreed.progressUpdatedAt);
  const stoodAt = time(here.at);
  const newer = movedSince === null || stoodAt === null || movedSince > stoodAt;
  return { open, offer: ahead && pastStart && newer ? { bookId: agreed.id, there, ahead: true } : null };
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
    // The book waits for the pull only briefly (1.5.10: a pull at start-up held
    // a tap for up to five seconds). A pull that takes longer goes on, and the
    // other device's place is offered in the open book when it lands: the offer
    // is a card in the reader, and the place opened is this device's own anyway.
    const pull = pullBeforeOpen();
    const pulled = await Promise.race([pull.then(() => true), wait(OPEN_WAITS_FOR_PULL_MS).then(() => false)]);
    const agreed = useLibraryStore.getState().books.find((candidate) => candidate.id === book.id) ?? book;
    const here = await syncService.placeHere(book.id);
    const { open, offer } = decidePlace(agreed, here);
    usePlaceOffer.getState().setOffer(offer);
    // Where this device left it, whether or not there is anything to offer:
    // a place that is not offered is never gone to either.
    ready = open.progress !== (agreed.progress ?? 0) || open.position !== (agreed.position ?? null) ? { ...agreed, progress: open.progress, position: open.position } : agreed;
    if (!pulled) void offerAfterPull(pull, book.id);
  } catch {
    usePlaceOffer.getState().setOffer(null);
  }
  checked.add(ready);
  return ready;
};

/** How long a tap on a book waits for a pull under way before the book opens without it. */
export const OPEN_WAITS_FOR_PULL_MS = 1200;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Once a late pull lands, offers the other device's place for the book now open, if it is further on. */
const offerAfterPull = async (pull: Promise<void>, bookId: string) => {
  try {
    await pull;
    const agreed = useLibraryStore.getState().books.find((candidate) => candidate.id === bookId);
    if (!agreed) return;
    const here = await syncService.placeHere(bookId);
    const { offer } = decidePlace(agreed, here);
    if (offer) usePlaceOffer.getState().setOffer(offer);
  } catch {
    // Nothing to offer: the book is open where this device left it.
  }
};
