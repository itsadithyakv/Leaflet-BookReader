import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { cardService } from "../services/cardService";
import { useLibraryStore } from "../store/libraryStore";
import type { CardInput } from "./cards";
import { closeCardMaker, loadCards, useStudyStore } from "./studyStore";

// Neither is any part of a book's opening: each comes the first time "Make a card" is pressed.
const CardMaker = lazy(() => import("./CardMaker").then((module) => ({ default: module.CardMaker })));
const PictureCardMaker = lazy(() => import("./PictureCardMaker").then((module) => ({ default: module.PictureCardMaker })));

/** How long "Card made" stays. */
const SAID_MS = 2200;

/**
 * Where "Make a card" opens in a reader (both readers mount one): the card
 * maker for a highlight, or the box drawing for a picture, over the page.
 * Nothing is loaded, or listened for, until a card is asked for.
 */
export const CardMakerHost = () => {
  const making = useStudyStore((state) => state.making);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    if (!said) return undefined;
    const timer = window.setTimeout(() => setSaid(null), SAID_MS);
    return () => window.clearTimeout(timer);
  }, [said]);

  // A PDF page drawn for the picture maker goes when it closes, or another card is asked for.
  const owned = useRef<string | null>(null);
  useEffect(() => {
    const now = making?.from === "picture" && making.ownsSrc ? making.src : null;
    if (owned.current && owned.current !== now) URL.revokeObjectURL(owned.current);
    owned.current = now;
  }, [making]);
  // The book closed with a card half made: it is not waiting in the next one.
  useEffect(
    () => () => {
      if (owned.current) URL.revokeObjectURL(owned.current);
      owned.current = null;
      if (useStudyStore.getState().making) closeCardMaker();
    },
    []
  );

  const kept = async (cards: CardInput[], remove: string[] = []) => {
    await cardService.save(cards);
    if (remove.length > 0) await cardService.remove(remove);
    // Like a highlight: it goes up with the next backup, which waits for the book to close.
    useLibraryStore.getState().requestBackup({ whileReading: true });
    void loadCards();
    closeCardMaker();
    setSaid(cards.length > 1 ? `${cards.length} cards made` : "Card made");
  };

  return (
    <>
      {making && (
        <Suspense fallback={null}>
          {making.from === "highlight" ? (
            <CardMaker
              highlight={making.highlight}
              kind={making.kind}
              place={{ bookId: making.bookId, cfi: making.highlight.cfi, chapter: making.highlight.chapter, p: making.p }}
              onSave={(card) => kept([card])}
              onClose={closeCardMaker}
            />
          ) : (
            <PictureCardMaker
              src={making.src}
              alt={making.alt}
              picture={making.picture}
              place={{ bookId: making.bookId, ...making.at }}
              onSave={kept}
              onClose={closeCardMaker}
            />
          )}
        </Suspense>
      )}
      {said && (
        <div className="study-said reader-panel reader-border" role="status">
          {said}
        </div>
      )}
    </>
  );
};
