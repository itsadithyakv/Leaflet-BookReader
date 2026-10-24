import { useEffect, useState, type ReactNode } from "react";
import { SlidersHorizontal, Timer } from "lucide-react";
import type { BookFilter } from "@shared/models/book";
import { UiIcon } from "../../components/UiIcon";
import { PhoneSheet, SheetChoice } from "../../components/ui/PhoneSheet";
import { getSessionProgress, sessionElapsedMs, type ActiveSession } from "../../store/habitStore";
import { useLongPress } from "../../hooks/useLongPress";
import { CloseWhenHidden } from "../../hooks/pageShown";
import { FocusDouble } from "../../components/focus/FocusDouble";
import { FOCUS_LENGTHS, focusLengthsWith } from "../../components/focus/focusDeal";

/**
 * The Library's top on a phone: the focus session as one key beside the search (a tap starts it at the
 * usual length; held, or right-clicked, its choices in a sheet; a running session is a slim card), and the shelf's filters behind one key (in a sheet too), so the
 * first screen shows books.
 * The desktop keeps its large card and its row of selects (LibraryPage).
 */

export const SESSION_LENGTHS = FOCUS_LENGTHS;

type FocusStripProps = {
  streakTitle: string;
  session: ActiveSession | null;
  /** A book is open in the session (the timer runs). */
  reading: boolean;
  duration: number;
  setDuration: (minutes: number) => void;
  fullScreen: boolean;
  toggleFullScreen: () => void;
  onStart: () => void;
  onEnd: () => void;
};

/** Minutes left in a session, counted again every few seconds while it runs. */
const useMinutesLeft = (session: ActiveSession | null) => {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!session) return undefined;
    const timer = window.setInterval(() => tick((value) => value + 1), 5000);
    return () => window.clearInterval(timer);
  }, [session]);
  if (!session) return null;
  const left = session.durationMinutes * 60 - Math.round(sessionElapsedMs(session) / 1000);
  return Math.max(0, Math.ceil(left / 60));
};

export const PhoneFocusStrip = ({
  streakTitle,
  session,
  reading,
  duration,
  setDuration,
  fullScreen,
  toggleFullScreen,
  onStart,
  onEnd
}: FocusStripProps) => {
  const [open, setOpen] = useState(false);
  const hold = useLongPress(() => setOpen(true));
  const left = useMinutesLeft(session);
  const progress = session ? Math.min(100, Math.round(getSessionProgress(session) * 100)) : 0;

  if (session) {
    return (
      <div className="phone-focus-strip paper-surface rounded-xl">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-on-surface">Session running</p>
          <p className="truncate text-xs text-on-surface-variant" title={reading ? undefined : "The timer runs while you read."}>
            {left === null ? "" : `${left} min left`}
            {reading ? "" : " · open a book"}
          </p>
          <span className="phone-focus-bar" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </span>
        </div>
        <button type="button" className="tactile-button phone-focus-key" onClick={onEnd}>
          End
        </button>
      </div>
    );
  }

  return (
    <>
      {/* At rest, one key at the end of the search row: the streak is said under the Library's heading.
          A tap starts the session; held (or right-clicked), the sheet picks its length. */}
      <button
        type="button"
        className="tactile-button phone-focus-key"
        data-tour="session"
        {...hold}
        onClick={onStart}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        title={`${streakTitle} Focus for ${duration} min. Hold to change.`}
      >
        <Timer size={16} aria-hidden />
        Focus
        <FocusDouble />
      </button>
      {open && (
        <PhoneSheet title="Focus session" onClose={() => setOpen(false)}>
          <CloseWhenHidden onClose={() => setOpen(false)} />
          <div className="sheet-choices" role="group" aria-label="Session length">
            {focusLengthsWith(duration).map((minutes) => (
              <SheetChoice key={minutes} chosen={duration === minutes} onClick={() => setDuration(minutes)}>
                {minutes} min
              </SheetChoice>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={fullScreen}
            className="focus-fullscreen-switch mt-3"
            onClick={toggleFullScreen}
            title="Read in full screen and grow a focus flower. It blooms if you stay until the session ends."
          >
            <span className="focus-fullscreen-track" aria-hidden="true" />
            Full screen
          </button>
          <button
            type="button"
            className="tactile-button tactile-button-primary sheet-action mt-4 w-full"
            onClick={() => {
              setOpen(false);
              onStart();
            }}
          >
            Start {duration}-minute session
            <FocusDouble />
          </button>
        </PhoneSheet>
      )}
    </>
  );
};

type ShelfToolsProps = {
  filters: Pick<BookFilter, "author" | "genre" | "sort" | "view">;
  setFilter: (patch: Partial<BookFilter>) => void;
  authors: string[];
  genres: Array<{ key: string; name: string }>;
  /** The genre chosen, as a key of `genres`, or "all". */
  genreValue: string;
  sortOptions: Array<{ value: BookFilter["sort"]; label: string }>;
  /** Highlights in the library: the key to them shows only when there are some. */
  highlightTotal: number;
  openHighlights: () => void;
  /** Keys of their own ahead of the highlights' (the word quiz's: ReviseWordsKey). */
  lead?: ReactNode;
};

/** One key for sort, filters and grid or list (a sheet), and the highlights (and the word quiz) as icons beside it. */
export const PhoneShelfTools = ({
  filters,
  setFilter,
  authors,
  genres,
  genreValue,
  sortOptions,
  highlightTotal,
  openHighlights,
  lead
}: ShelfToolsProps) => {
  const [open, setOpen] = useState(false);
  const narrowed = filters.author !== "all" || filters.genre !== "all";
  return (
    <div className="flex shrink-0 items-center gap-2">
      {lead}
      {highlightTotal > 0 && (
        <button
          type="button"
          className="key-button relative"
          onClick={openHighlights}
          aria-label={`Highlights: ${highlightTotal}`}
          title="The text you have highlighted, book by book"
        >
          <UiIcon name="highlight" size={18} />
        </button>
      )}
      <button
        type="button"
        className="tactile-button phone-shelf-key relative"
        onClick={() => setOpen(true)}
        aria-label={narrowed ? "Sort and filter (filtered)" : "Sort and filter"}
      >
        <SlidersHorizontal size={16} aria-hidden />
        Sort &amp; filter
        {narrowed && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-surface" aria-hidden="true" />}
      </button>
      {open && (
        <PhoneSheet title="Sort and filter" onClose={() => setOpen(false)}>
          <CloseWhenHidden onClose={() => setOpen(false)} />
          <div className="sheet-choices" role="group" aria-label="Show as">
            <SheetChoice chosen={filters.view === "grid"} onClick={() => setFilter({ view: "grid" })}>
              <UiIcon name="grid" size={17} /> Covers
            </SheetChoice>
            <SheetChoice chosen={filters.view === "list"} onClick={() => setFilter({ view: "list" })}>
              <UiIcon name="list" size={17} /> List
            </SheetChoice>
          </div>
          <label className="sheet-field">
            <span>Sort by</span>
            <select
              className="inset-field"
              value={filters.sort}
              onChange={(event) => setFilter({ sort: event.target.value as BookFilter["sort"] })}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="sheet-field">
            <span>Author</span>
            <select className="inset-field" value={filters.author} onChange={(event) => setFilter({ author: event.target.value })}>
              <option value="all">All authors</option>
              {authors.map((author) => (
                <option key={author} value={author}>
                  {author}
                </option>
              ))}
            </select>
          </label>
          <label className="sheet-field">
            <span>Genre</span>
            <select className="inset-field" value={genreValue} onChange={(event) => setFilter({ genre: event.target.value })}>
              <option value="all">All genres</option>
              {genres.map((genre) => (
                <option key={genre.key} value={genre.key}>
                  {genre.name}
                </option>
              ))}
            </select>
          </label>
          {narrowed && (
            <button type="button" className="tactile-button sheet-action mt-4 w-full" onClick={() => setFilter({ author: "all", genre: "all" })}>
              Show all books
            </button>
          )}
        </PhoneSheet>
      )}
    </div>
  );
};
