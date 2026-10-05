import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PipSprite } from "../../PipSprite";
import { UiIcon } from "../../UiIcon";
import { diaryEntries, minutesText, type DiaryEntry } from "../../../pip/diary/entry";
import { diaryFacts, type DayFacts } from "../../../pip/diary/facts";
import { dayKey, dayNumber } from "../../../pip/diary/seed";
import { loadDiaryRows, type DiaryRows } from "../../../pip/diary/source";
import { diaryWeeks, weekStart } from "../../../pip/diary/week";
import { getDateKey } from "../../../services/habitService";
import { useHabitStore } from "../../../store/habitStore";
import { useLibraryStore } from "../../../store/libraryStore";
import { useEquippedPip } from "../../../store/pipWardrobeStore";
import { WeekCard } from "./WeekCard";
import "./diary.css";

export type DiaryAt = {
  /** The day to open at ("2026-10-04"); today when left out. */
  initialDay?: string | null;
  /** Open on the week's postcard rather than the day. */
  initialView?: "days" | "week";
};

export type DiaryBookProps = DiaryAt & { onClose: () => void };

type DiaryPagesProps = DiaryAt & {
  /** Shuts the book, where the pages have their own Close (not in a frame that has one). */
  onClose?: () => void;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_HEADS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const dateOf = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};
/** "Sunday 4 October 2026". */
const longDate = (dateKey: string) => {
  const date = dateOf(dateKey);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};
const monthOf = (dateKey: string) => dateKey.slice(0, 7);
const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** The day in a few plain figures, under Pip's line: only what is known. */
const figures = (facts: DayFacts): string[] => {
  const list: string[] = [];
  if (!facts.read) {
    return facts.covered ? [facts.covered === "freeze" ? "A freeze kept the streak" : "Grace kept the streak"] : list;
  }
  list.push(minutesText(facts.minutes));
  facts.books.slice(0, 2).forEach((book) => list.push(book.finished ? `Finished ${book.title}` : book.percent !== null ? `${book.title}, ${book.percent}%` : book.title));
  if (facts.goalMet) {
    list.push(facts.run >= 2 ? `Goal met, day ${facts.run}` : "Goal met");
  }
  if (facts.focus.count > 0) {
    list.push(`${facts.focus.count} focus session${facts.focus.count === 1 ? "" : "s"}`);
  }
  if (facts.highlights.length > 0) {
    list.push(`${facts.highlights.length} highlight${facts.highlights.length === 1 ? "" : "s"}`);
  }
  return list;
};

/**
 * Pip's diary: a little book with a page for each day, written by Pip from
 * what the app already knows about the day (pip/diary/). Nothing in it is
 * typed by the reader and nothing is stored: it is worked out when the book
 * is opened.
 *
 * Today's page first. Earlier and Later turn to the days that were read (the
 * arrow keys too); the month's days are all there to pick, a day off greyed.
 * The other half of the book is the week: a postcard to save or copy.
 *
 * These are the pages alone, for whatever holds them: the dialog below, or
 * the card a thing in the room opens (`DiaryPanel`).
 */
export const DiaryPages = ({ onClose, initialDay = null, initialView = "days" }: DiaryPagesProps) => {
  const snapshot = useHabitStore((state) => state.snapshot);
  const library = useLibraryStore((state) => state.books);
  const look = useEquippedPip();
  const [rows, setRows] = useState<DiaryRows | null>(null);
  const [view, setView] = useState<"days" | "week">(initialView);
  const today = getDateKey();
  const [shown, setShown] = useState(initialDay ?? today);
  const [week, setWeek] = useState<string | null>(null);

  // What the snapshot does not carry: the books' places, and the day's marks.
  useEffect(() => {
    let current = true;
    loadDiaryRows(useLibraryStore.getState().books).then(
      (loaded) => current && setRows(loaded),
      // Without them the diary still has the minutes, the sessions and the streak.
      () => current && setRows({ books: [], marks: [] })
    );
    return () => {
      current = false;
    };
  }, []);

  const facts = useMemo(
    () =>
      diaryFacts(
        {
          days: snapshot.days,
          sessions: snapshot.sessions,
          freeReads: snapshot.freeReads,
          books: rows?.books ?? library.map((book) => ({ id: book.id, title: book.title, author: book.author, progress: book.progress })),
          marks: rows?.marks ?? []
        },
        today
      ),
    [snapshot.days, snapshot.sessions, snapshot.freeReads, rows, library, today]
  );
  const entries = useMemo(() => diaryEntries(facts, today), [facts, today]);
  const byDay = useMemo(() => new Map(entries.map((entry, index) => [entry.dateKey, { entry, facts: facts.days[index] }])), [entries, facts]);
  const weeks = useMemo(() => diaryWeeks(facts), [facts]);

  // The day on show is always one the diary has: the nearest, if it was asked for another.
  const first = facts.first;
  const day = !first ? null : byDay.has(shown) ? shown : shown < first ? first : today;
  const page = day ? byDay.get(day) ?? null : null;
  const readDays = useMemo(() => entries.filter((entry) => !entry.rest).map((entry) => entry.dateKey), [entries]);
  const earlier = day ? [...readDays].reverse().find((key) => key < day) ?? null : null;
  const later = day ? readDays.find((key) => key > day) ?? (day < today ? today : null) : null;

  const months = useMemo(() => {
    if (!first) {
      return [];
    }
    const list: string[] = [];
    for (let month = monthOf(today); month >= monthOf(first); ) {
      list.push(month);
      const [year, number] = month.split("-").map(Number);
      month = number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
    }
    return list;
  }, [first, today]);

  /** Turns to a month: its last day read, or its last day in the diary. */
  const toMonth = useCallback(
    (month: string) => {
      const inMonth = entries.filter((entry) => monthOf(entry.dateKey) === month);
      const pick = [...inMonth].reverse().find((entry) => !entry.rest) ?? inMonth[inMonth.length - 1];
      if (pick) {
        setShown(pick.dateKey);
      }
    },
    [entries]
  );

  const shownWeek = week && weeks.includes(week) ? week : day && weeks.includes(weekStart(day)) ? weekStart(day) : weeks[weeks.length - 1] ?? null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A list or a field has its own use for the arrows.
    const target = event.target as HTMLElement;
    if (view !== "days" || !day || target.tagName === "SELECT" || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const month = months.indexOf(monthOf(day));
    const turn: Record<string, string | null | undefined> = {
      ArrowLeft: earlier,
      ArrowRight: later,
      Home: readDays[0],
      End: today,
      PageUp: null,
      PageDown: null
    };
    if (!(event.key in turn)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "PageUp" && months[month + 1]) {
      toMonth(months[month + 1]);
    } else if (event.key === "PageDown" && months[month - 1]) {
      toMonth(months[month - 1]);
    } else if (turn[event.key]) {
      setShown(turn[event.key] as string);
    }
  };

  // The month on show, laid out Monday first, as the reading calendar is.
  const monthDays = useMemo(() => {
    if (!day) {
      return [];
    }
    const month = monthOf(day);
    const start = dayNumber(`${month}-01`);
    const cells: Array<{ dateKey: string; entry: DiaryEntry | null; minutes: number } | null> = Array.from(
      { length: (dateOf(`${month}-01`).getDay() + 6) % 7 },
      () => null
    );
    for (let offset = 0; offset < 31 && monthOf(dayKey(start + offset)) === month; offset += 1) {
      const dateKey = dayKey(start + offset);
      const known = byDay.get(dateKey);
      cells.push({ dateKey, entry: known?.entry ?? null, minutes: known?.facts.minutes ?? 0 });
    }
    return cells;
  }, [day, byDay]);

  return (
    // Focusable, so the arrows turn the pages before anything in them has been chosen.
    <div className="pip-diary-pages" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="pip-diary-head">
        {onClose && (
          <h2 id="pip-diary-title" className="pip-diary-title">
            Pip's diary
          </h2>
        )}
        <div className="pip-diary-tabs" role="group" aria-label="Which part of the diary">
          <button type="button" className="pip-key pip-key-small" aria-pressed={view === "days"} onClick={() => setView("days")}>
            Days
          </button>
          <button type="button" className="pip-key pip-key-small" aria-pressed={view === "week"} onClick={() => setView("week")} disabled={weeks.length === 0}>
            The week
          </button>
        </div>
        {onClose && (
          <button type="button" className="pip-key pip-key-small pip-key-quiet" onClick={onClose} title="Close (Esc)">
            <UiIcon name="close" size={14} />
            Close
          </button>
        )}
      </div>

      {!page || !day ? (
        <div className="pip-diary-page" data-rest="true">
          <PipSprite move="read" size={64} skin={look.skin} outfit={look.outfit} />
          <p className="pip-diary-entry">the diary starts the first day you read. i've sharpened the pencil.</p>
        </div>
      ) : view === "week" && shownWeek ? (
        <WeekCard facts={facts} entries={entries} weeks={weeks} week={shownWeek} onWeek={setWeek} look={look} />
      ) : (
        <>
          <article className="pip-diary-page" data-rest={page.entry.rest || undefined} aria-live="polite">
            <header className="pip-diary-date">
              <h3>{longDate(day)}</h3>
              {day === today && <span className="pip-diary-today">Today</span>}
            </header>
            <div className="pip-diary-lines">
              <PipSprite move={page.entry.rest ? "idle" : "read"} size={64} skin={look.skin} outfit={look.outfit} />
              <p className="pip-diary-entry">{page.entry.text}</p>
            </div>
            {figures(page.facts).length > 0 && (
              <ul className="pip-diary-figures" aria-label="The day in figures">
                {figures(page.facts).map((figure) => (
                  <li key={figure}>{figure}</li>
                ))}
              </ul>
            )}
          </article>

          <nav className="pip-diary-turn" aria-label="Turn the pages">
            <button type="button" className="pip-key pip-key-small" onClick={() => earlier && setShown(earlier)} disabled={!earlier} title="The day read before this one (Left arrow)">
              <UiIcon name="back" size={14} />
              Earlier
            </button>
            <label className="pip-diary-month">
              <span className="sr-only">Month</span>
              <select value={monthOf(day)} onChange={(event) => toMonth(event.target.value)}>
                {months.map((month) => (
                  <option key={month} value={month}>
                    {monthName(month)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="pip-key pip-key-small" onClick={() => setShown(today)} disabled={day === today}>
              Today
            </button>
            <button type="button" className="pip-key pip-key-small" onClick={() => later && setShown(later)} disabled={!later} title="The day read after this one (Right arrow)">
              Later
              <span className="pip-diary-flip">
                <UiIcon name="back" size={14} />
              </span>
            </button>
          </nav>

          <div className="pip-diary-days" role="group" aria-label={`The days of ${monthName(monthOf(day))}`}>
            {DAY_HEADS.map((head) => (
              <span key={head} className="pip-diary-dayhead" aria-hidden="true">
                {head}
              </span>
            ))}
            {monthDays.map((cell, index) =>
              cell === null ? (
                <span key={`blank-${index}`} />
              ) : (
                <button
                  key={cell.dateKey}
                  type="button"
                  className="pip-diary-day"
                  data-read={cell.entry && !cell.entry.rest ? "true" : undefined}
                  aria-current={cell.dateKey === day ? "date" : undefined}
                  disabled={!cell.entry}
                  onClick={() => setShown(cell.dateKey)}
                  aria-label={`${longDate(cell.dateKey)}: ${!cell.entry ? "not in the diary" : cell.entry.rest ? "nothing read" : `read for ${minutesText(cell.minutes)}`}`}
                >
                  {Number(cell.dateKey.slice(8))}
                </button>
              )
            )}
          </div>
          <p className="pip-diary-note">Pip writes a page for each day from your reading: nothing here is typed, and nothing extra is kept.</p>
        </>
      )}
    </div>
  );
};

/**
 * The diary as a dialog over the window (the rail's key opens it): focus
 * comes in and goes back, Escape or a click outside closes.
 */
export const DiaryBook = ({ onClose, ...at }: DiaryBookProps) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (dialogRef.current?.querySelector<HTMLElement>(".pip-diary-pages") ?? dialogRef.current)?.focus();
    return () => before?.focus?.();
  }, []);

  return (
    <div className="pip-diary-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="pip-diary"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pip-diary-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <DiaryPages onClose={onClose} {...at} />
      </div>
    </div>
  );
};

/**
 * The diary as a panel, for a card that brings its own frame, title and Close
 * (the diary lying in Pip's room): the pages and nothing round them.
 */
export const DiaryPanel = (_: { onClose: () => void }) => (
  <div className="pip-diary pip-diary-panel">
    <DiaryPages />
  </div>
);

/**
 * How the diary stands, for the thing in the room that opens it: a phrase for
 * its label, and the little its art needs. From the ledger alone, so it costs
 * nothing to ask.
 */
export const useDiaryStatus = (): { status: string; data: { pages: number; today: boolean } } => {
  const days = useHabitStore((state) => state.snapshot.days);
  const today = getDateKey();
  const pages = days.filter((day) => day.minutes >= 1 && day.dateKey <= today).length;
  const written = days.some((day) => day.dateKey === today && day.minutes >= 1);
  return {
    status: pages === 0 ? "no pages yet" : written ? "today's page is written" : "today's page is blank so far",
    data: { pages, today: written }
  };
};
