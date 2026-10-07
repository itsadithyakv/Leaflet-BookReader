import { useEffect, useMemo, useRef, useState } from "react";
import { UiIcon } from "../UiIcon";
import { copyPicture, savePicture } from "../pip/diary/picture";
import { annotationService } from "../../services/annotationService";
import { wordService } from "../../services/wordService";
import { useHabitStore } from "../../store/habitStore";
import { useLibraryStore } from "../../store/libraryStore";
import { useBooksRead } from "../../library/finishedBooks";
import { CARD_HEIGHT, CARD_STYLES, CARD_WIDTH } from "./quoteCard";
import { closeYearReview, openYearReview, useShareStore } from "./shareStore";
import { drawYearCard, yearFigures, yearFileName, yearLines } from "./yearCard";
import { timeWords, yearReview, yearsRead } from "./yearReview";
import "./share.css";

const STYLE_KEY = "leaflet.share.yearStyle";
/** Highlights are counted in this many books at most: the ones read in most lately. */
const BOOKS_COUNTED = 60;

const keptStyle = () => {
  try {
    const kept = localStorage.getItem(STYLE_KEY);
    return CARD_STYLES.some((style) => style.id === kept) ? (kept as string) : "night";
  } catch {
    return "night";
  }
};

/**
 * The reader's year in review: one picture of the year's reading, as it will
 * be saved, with the years there is reading in to step between. Opened from
 * Social, Stats.
 *
 * It is the figures the app already keeps, summed on this device; making it
 * sends nothing.
 */
export const YearReviewDialog = () => {
  const year = useShareStore((state) => state.year);
  const days = useHabitStore((state) => state.snapshot.days);
  const sessions = useHabitStore((state) => state.snapshot.sessions);
  const books = useLibraryStore((state) => state.books);
  // With the books finished and since removed: they were read in their year all the same.
  const booksRead = useBooksRead();
  const [styleId, setStyleId] = useState(keptStyle);
  const [counts, setCounts] = useState<{ year: number; highlights: number; words: number } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const style = CARD_STYLES.find((item) => item.id === styleId) ?? CARD_STYLES[0];

  const years = useMemo(() => yearsRead(days), [days]);
  const review = useMemo(
    () =>
      year === null
        ? null
        : yearReview(year, {
            days,
            sessions,
            books: booksRead,
            highlights: counts?.year === year ? counts.highlights : 0,
            words: counts?.year === year ? counts.words : 0
          }),
    [year, days, sessions, booksRead, counts]
  );

  // The year's highlights and looked-up words: counted from the reader's own marks.
  useEffect(() => {
    if (year === null) {
      return undefined;
    }
    let live = true;
    const within = (iso: string | null | undefined) => Boolean(iso) && new Date(iso as string).getFullYear() === year;
    const read = [...books]
      .filter((book) => within(book.progressUpdatedAt ?? book.lastOpened))
      .sort((a, b) => (b.lastOpened ?? "").localeCompare(a.lastOpened ?? ""))
      .slice(0, BOOKS_COUNTED);
    void Promise.all([
      Promise.all(read.map((book) => annotationService.list(book.id).catch(() => []))).then((lists) =>
        lists.flat().filter((item) => item.kind === "highlight" && within(item.createdAt)).length
      ),
      wordService
        .list()
        .then((words) => words.filter((word) => within(word.createdAt)).length)
        .catch(() => 0)
    ]).then(([highlights, words]) => {
      if (live) {
        setCounts({ year, highlights, words });
      }
    });
    return () => {
      live = false;
    };
    // The books as they were when the year was chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  useEffect(() => {
    if (review && !review.empty && canvas.current) {
      drawYearCard(canvas.current, review, style);
    }
  }, [review, style]);

  const open = year !== null;
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeYearReview();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => setSaid(null), [year]);

  if (year === null || !review) {
    return null;
  }

  const choose = (id: string) => {
    setStyleId(id);
    try {
      localStorage.setItem(STYLE_KEY, id);
    } catch {
      // Chosen for now, then.
    }
  };

  const run = async (work: () => Promise<string | null>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const done = await work();
      if (done) {
        setSaid(done);
      }
    } catch (cause) {
      setSaid(cause instanceof Error && cause.message ? cause.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const at = years.indexOf(year);
  const earlier = at >= 0 ? years[at + 1] : years.find((other) => other < year);
  const later = at > 0 ? years[at - 1] : undefined;
  // The picture, in words: for a screen reader, and for a clipboard that takes no pictures.
  const words = review.empty
    ? `Nothing read in ${year}.`
    : [
        `My ${year} in books: ${timeWords(review.minutes)} of reading.`,
        yearFigures(review)
          .map((figure) => `${figure.value} ${figure.label}`)
          .join(", ") + ".",
        ...yearLines(review).map((line) => `${line}.`),
        review.finished.length > 0 ? `Finished: ${review.finished.map((book) => book.title).join("; ")}.` : ""
      ]
        .filter(Boolean)
        .join("\n");

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeYearReview();
        }
      }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-label={`Your ${year} in review`} className="modal-surface confirm-pop share-dialog rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="share-close"
              disabled={earlier === undefined}
              onClick={() => earlier !== undefined && openYearReview(earlier)}
              aria-label={earlier !== undefined ? `${earlier}` : "No earlier year"}
              title={earlier !== undefined ? `${earlier}` : undefined}
            >
              <span className="material-symbols-outlined text-base">chevron_left</span>
            </button>
            <h2 className="min-w-[4.5rem] text-center text-sm font-semibold tabular-nums text-on-surface">{year}</h2>
            <button
              type="button"
              className="share-close"
              disabled={later === undefined}
              onClick={() => later !== undefined && openYearReview(later)}
              aria-label={later !== undefined ? `${later}` : "No later year"}
              title={later !== undefined ? `${later}` : undefined}
            >
              <span className="material-symbols-outlined text-base">chevron_right</span>
            </button>
          </div>
          <button type="button" className="share-close" onClick={closeYearReview} aria-label="Close" title="Close (Esc)" data-autofocus={review.empty ? true : undefined}>
            <UiIcon name="close" size={16} />
          </button>
        </div>

        {review.empty ? (
          <p className="py-16 text-center text-sm text-on-surface-variant">Nothing read in {year}.</p>
        ) : (
          <>
            <canvas
              ref={canvas}
              className="share-canvas"
              width={CARD_WIDTH}
              height={CARD_HEIGHT}
              style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }}
              role="img"
              aria-label={words}
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2" role="group" aria-label="Look">
                {CARD_STYLES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`share-swatch ${item.id === style.id ? "is-on" : ""}`}
                    style={{
                      background: item.background.length === 2 ? `linear-gradient(135deg, ${item.background[0]}, ${item.background[1]})` : item.background[0],
                      color: item.ink
                    }}
                    aria-pressed={item.id === style.id}
                    aria-label={item.name}
                    title={item.name}
                    onClick={() => choose(item.id)}
                  >
                    Aa
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {said && (
                  <span className="text-xs text-on-surface-variant" role="status">
                    {said}
                  </span>
                )}
                <button
                  type="button"
                  className="share-action"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const went = canvas.current ? await copyPicture(canvas.current, words) : "none";
                      return went === "picture" ? "Copied." : went === "words" ? "Copied as words." : "Couldn't copy.";
                    })
                  }
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="share-action is-primary"
                  data-autofocus
                  disabled={busy}
                  onClick={() => void run(async () => (canvas.current && (await savePicture(yearFileName(year), canvas.current)) ? "Saved." : null))}
                >
                  Save picture
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
