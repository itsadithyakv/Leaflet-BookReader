import type { Book } from "@shared/models/book";
import { useCoverSrc } from "../hooks/useCoverSrc";
import { seriesNumberLabel, type SeriesGroup } from "../library/series";
import { useLibrarySeries } from "../library/useSeries";

const MAX_SHOWN = 3;

const UpNextTile = ({ group, onOpen }: { group: SeriesGroup; onOpen: (book: Book) => void }) => {
  const next = group.next as Book;
  const { src, onError } = useCoverSrc(next, { thumb: true });
  const index = group.members.find((member) => member.book.id === next.id)?.index ?? null;
  return (
    <button
      type="button"
      className="paper-surface flex min-w-0 items-center gap-4 rounded-xl p-3 text-left transition-transform hover:-translate-y-0.5"
      onClick={() => onOpen(next)}
    >
      <div className="book-cover-frame h-20 w-14 shrink-0 overflow-hidden bg-surface-container-high">
        {src && <img src={src} alt="" className="h-full w-full object-cover" onError={onError} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          Next in {group.name}
        </p>
        <p className="book-title mt-1 truncate text-base text-on-surface">{next.title}</p>
        <p className="text-xs text-on-surface-variant">
          {[seriesNumberLabel(index), `${group.finishedCount} of ${group.total ?? group.ownedCount} read`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <span className="tactile-button tactile-button-primary shrink-0 px-3 py-1.5 text-xs font-semibold">Start</span>
    </button>
  );
};

/** The next book is not in the library: says which, so the reader can get it. */
const MissingTile = ({ group, onSeeAll }: { group: SeriesGroup; onSeeAll: () => void }) => {
  const missing = group.missingNext as NonNullable<SeriesGroup["missingNext"]>;
  return (
    <button
      type="button"
      className="flex min-w-0 items-center gap-4 rounded-xl border border-dashed border-outline-variant/60 p-3 text-left transition-colors hover:border-primary/50"
      onClick={onSeeAll}
    >
      <div className="h-20 w-14 shrink-0 rounded border border-dashed border-outline-variant/60" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
          Next in {group.name}
        </p>
        <p className="book-title mt-1 truncate text-base text-on-surface">{missing.title ?? `Book ${missing.index}`}</p>
        <p className="text-xs text-on-surface-variant">{seriesNumberLabel(missing.index)} · not in your library</p>
      </div>
    </button>
  );
};

/**
 * "You finished book 2; book 3 is here": the next book of each series the
 * reader is between books of, or the one to get when the library lacks it.
 * Shown above the library, only when there is one.
 */
export const UpNextStrip = ({ onOpen, onSeeAll }: { onOpen: (book: Book) => void; onSeeAll: () => void }) => {
  const { groups } = useLibrarySeries();
  // Books to start first; books to get after.
  const waiting = [
    ...groups.filter((group) => group.upNext && group.next),
    ...groups.filter((group) => group.missingNext)
  ];
  if (waiting.length === 0) {
    return null;
  }
  return (
    <section aria-label="Next in your series" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Next in your series</h2>
        <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={onSeeAll}>
          All series
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {waiting.slice(0, MAX_SHOWN).map((group) =>
          group.missingNext ? (
            <MissingTile key={group.key} group={group} onSeeAll={onSeeAll} />
          ) : (
            <UpNextTile key={group.key} group={group} onOpen={onOpen} />
          )
        )}
      </div>
    </section>
  );
};
