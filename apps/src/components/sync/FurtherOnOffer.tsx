import { useEffect } from "react";
import { Cloud, X } from "lucide-react";
import { usePlaceOffer, type Place } from "../../services/placeElsewhere";
import { useBackLayer } from "../../platform/back";

type FurtherOnOfferProps = {
  bookId: string;
  /** Takes the reader to the other device's place. */
  onGo: (place: Place) => void;
  /** The chapter a place is in, as the reader names it; the percentage alone when it cannot say. */
  chapterOf?: (place: Place) => string | null;
};

const percent = (progress: number) => `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;

/**
 * "Your other device is further on: Chapter 14 · 62%. Go there / Stay here."
 *
 * The book opened where this device left it (services/placeElsewhere); this
 * offers the place another device reached since. Mounted by the reader with
 * one line; shows nothing unless there is an offer for this book.
 */
export const FurtherOnOffer = ({ bookId, onGo, chapterOf }: FurtherOnOfferProps) => {
  const offer = usePlaceOffer((state) => (state.offer?.bookId === bookId ? state.offer : null));
  const setOffer = usePlaceOffer((state) => state.setOffer);

  // An offer belongs to one opening of the book.
  useEffect(
    () => () => {
      if (usePlaceOffer.getState().offer?.bookId === bookId) setOffer(null);
    },
    [bookId, setOffer]
  );

  // Android's Back is "Stay here".
  useBackLayer(offer !== null, () => setOffer(null));

  if (!offer) {
    return null;
  }
  const chapter = chapterOf?.(offer.there) ?? null;
  const where = chapter ? `${chapter} · ${percent(offer.there.progress)}` : percent(offer.there.progress);
  const stay = () => setOffer(null);

  return (
    <div
      role="status"
      className="further-on-offer modal-surface fixed bottom-[calc(1.5rem+var(--inset-bottom,0px))] left-1/2 z-[70] flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-2xl p-4 shadow-lg"
    >
      <Cloud size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-on-surface">
          {offer.ahead ? "Your other device is further on" : "Your other device was last at"}
        </p>
        <p className="mt-0.5 text-xs text-on-surface-variant [overflow-wrap:anywhere]">{where}</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="tactile-button tactile-button-primary px-3 py-1.5 text-xs"
            onClick={() => {
              setOffer(null);
              onGo(offer.there);
            }}
          >
            Go there
          </button>
          <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={stay}>
            Stay here
          </button>
        </div>
      </div>
      <button type="button" className="touch-hit shrink-0 rounded-full p-1 text-on-surface-variant hover:text-on-surface" aria-label="Stay here" onClick={stay}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
};
