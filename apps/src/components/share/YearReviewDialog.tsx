import { useEffect, useMemo, useState } from "react";
import { useBackClose } from "../../hooks/useBackClose";
import { useBooksRead } from "../../library/finishedBooks";
import { annotationService } from "../../services/annotationService";
import { baseService } from "../../services/baseService";
import { bookService } from "../../services/bookService";
import { cardService } from "../../services/cardService";
import { wordService } from "../../services/wordService";
import { useHabitStore } from "../../store/habitStore";
import { closeYearReview, openYearReview, useShareStore } from "./shareStore";
import { YearStory } from "./year/YearStory";
import { yearReview, yearsRead } from "./yearReview";

/** Highlights are read from this many books at most: the ones read in most lately. */
const BOOKS_COUNTED = 60;
/** The covers on the shelf, at most. */
const COVERS = 9;
/** How long the story waits for the rest of the year's records before it starts without them. */
const WAIT_MS = 1500;

type Extra = {
  year: number;
  marks: Array<{ bookId: string; kind: string; text?: string | null; note?: string | null; createdAt: string }>;
  wordList: Array<{ word: string; meaning: string; count: number; createdAt: string; lookedUpAt: string }>;
  cards: Array<{ createdAt: string; updatedAt: string; box: number }>;
  camp: { minutes: number; camps: number; strongholds: { stars: number[] }; banners: string[] } | null;
};

const picture = (url: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });

/**
 * The reader's year as a story (`year/YearStory.tsx`): opened from Social,
 * Stats, from the Library's key in the last week of the year, and from Admin's
 * preview. The figures are summed here, on this device, from what Leaflet
 * already keeps (`yearReview.ts`); the story sends nothing anywhere, and a
 * picture leaves only when the reader shares one.
 */
export const YearReviewDialog = () => {
  const year = useShareStore((state) => state.year);
  const days = useHabitStore((state) => state.snapshot.days);
  const sessions = useHabitStore((state) => state.snapshot.sessions);
  const freeReads = useHabitStore((state) => state.snapshot.freeReads);
  // With the books finished and since removed: they were read in their year all the same.
  const books = useBooksRead();
  const [extra, setExtra] = useState<Extra | null>(null);
  const [waited, setWaited] = useState(false);
  const [covers, setCovers] = useState<Map<string, CanvasImageSource>>(() => new Map());
  // The day it was opened: "so far" and the year's last days go by it.
  const today = useMemo(() => new Date(), [year]);

  const open = year !== null;
  useBackClose(open, closeYearReview);

  // The rest of the year's records: highlights, words, study cards, the Hollow's camp.
  useEffect(() => {
    if (year === null) {
      return undefined;
    }
    let live = true;
    setWaited(false);
    const timer = window.setTimeout(() => live && setWaited(true), WAIT_MS);
    const within = (iso: string | null | undefined) => Boolean(iso) && new Date(iso as string).getFullYear() === year;
    const read = [...books]
      .filter((book) => within(book.progressUpdatedAt ?? book.lastOpened))
      .sort((a, b) => (b.lastOpened ?? "").localeCompare(a.lastOpened ?? ""))
      .slice(0, BOOKS_COUNTED);
    void Promise.all([
      Promise.all(read.map((book) => annotationService.list(book.id).catch(() => []))).then((lists) => lists.flat()),
      wordService.list().catch(() => []),
      cardService.list().catch(() => []),
      baseService.load().catch(() => null)
    ]).then(([marks, words, cards, base]) => {
      if (!live) return;
      setExtra({
        year,
        marks: marks.map((mark) => ({ bookId: mark.bookId, kind: mark.kind, text: mark.text, note: mark.note, createdAt: mark.createdAt })),
        wordList: words.map((word) => ({ word: word.word, meaning: word.meaning, count: word.count, createdAt: word.createdAt, lookedUpAt: word.lookedUpAt })),
        cards: cards.map((card) => ({ createdAt: card.createdAt, updatedAt: card.updatedAt, box: card.box })),
        camp: base ? { minutes: base.minutes, camps: base.camps, strongholds: { stars: [...base.strongholds.stars] }, banners: [...base.banners] } : null
      });
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // The books as they were when the year was chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const loaded = extra !== null && extra.year === year;
  const review = useMemo(
    () =>
      year === null
        ? null
        : yearReview(year, {
            days,
            sessions,
            freeReads,
            books,
            marks: loaded ? extra.marks : undefined,
            wordList: loaded ? extra.wordList : undefined,
            cards: loaded ? extra.cards : undefined,
            camp: loaded ? extra.camp : null,
            today
          }),
    [year, days, sessions, freeReads, books, extra, loaded, today]
  );

  // The covers of the books on the shelf, where the library has pictures of them (made on this device, so a picture to share may draw them).
  const shelf = review?.finished.slice(0, COVERS).map((book) => book.id).join("|") ?? "";
  useEffect(() => {
    if (!shelf) return undefined;
    let live = true;
    void Promise.all(
      shelf.split("|").map(async (id) => {
        const url = await bookService.coverData(id, { thumb: true }).catch(() => null);
        return [id, url ? await picture(url) : null] as const;
      })
    ).then((found) => {
      if (live) setCovers(new Map(found.filter((entry): entry is readonly [string, HTMLImageElement] => entry[1] !== null)));
    });
    return () => {
      live = false;
    };
  }, [shelf]);

  if (year === null || !review || (!loaded && !waited)) {
    return year === null ? null : <div className="fixed inset-0 z-[95]" style={{ background: "#13261a" }} aria-busy="true" />;
  }
  const years = yearsRead(days);
  const at = years.indexOf(year);
  const earlier = at >= 0 ? years[at + 1] : years.find((other) => other < year);
  const later = at > 0 ? years[at - 1] : undefined;
  return <YearStory key={year} review={review} covers={covers} onClose={closeYearReview} earlier={earlier} later={later} onYear={openYearReview} />;
};
