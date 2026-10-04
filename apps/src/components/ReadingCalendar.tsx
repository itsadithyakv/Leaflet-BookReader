import { useMemo } from "react";
import { getDateKey, type DayRecord, type FreeReadRecord } from "../services/habitService";
import { EYEBROW } from "./ui/SectionHeader";
import { minutesText } from "./community/format";
import { freeReadsBesides } from "./shelf/rows";
import { sessionElapsedMs, useHabitStore } from "../store/habitStore";

const WEEKS = 12;
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const mondayOf = (date: Date) => addDays(new Date(date.getFullYear(), date.getMonth(), date.getDate()), -((date.getDay() + 6) % 7));

export const isGoalMet = (day: DayRecord | undefined) =>
  Boolean(day && (day.freezeUsed || day.graceUsed || (day.goalMinutes > 0 && day.minutes >= day.goalMinutes)));

const NO_FREE_READS: FreeReadRecord[] = [];

type Cell = {
  key: string;
  date: Date;
  minutes: number;
  /** How full the day is, 0..4 (see `dayLevel`). */
  level: number;
  /** Of those minutes, the ones read outside a focus session. */
  free: number;
  met: boolean;
  kept: boolean;
  future: boolean;
  today: boolean;
};

/** How full a day is, 0..4, against the daily goal. */
const level = (minutes: number, goal: number) => {
  if (minutes <= 0) return 0;
  const share = minutes / Math.max(goal, 1);
  return share >= 1 ? 4 : share >= 0.66 ? 3 : share >= 0.33 ? 2 : 1;
};
/**
 * A day's shade. Against the goal it was read against, which the ledger keeps
 * with the day, so the darkest shade ("Goal met") is on the days that met
 * theirs whatever the goal is now; a day with none of its own uses today's.
 */
export const dayLevel = (day: DayRecord | undefined, goalMinutes: number) =>
  level(day?.minutes ?? 0, day && day.goalMinutes > 0 ? day.goalMinutes : goalMinutes);
const LEVEL_CLASS = [
  "bg-surface-container-highest/70",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary"
];

/**
 * The last twelve weeks as a calendar: a column per week (Monday on top, the
 * same weeks as the session shelf and the board), shaded by minutes against
 * the daily goal. Empty days are drawn, not hidden, so a gap reads as a gap.
 * A day is shaded by everything read on it, in a focus session or not; its
 * label says how much of it was free reading.
 */
export const ReadingCalendar = ({
  days,
  goalMinutes,
  freeReads = NO_FREE_READS
}: {
  days: DayRecord[];
  goalMinutes: number;
  freeReads?: FreeReadRecord[];
}) => {
  const running = useHabitStore((state) => state.activeSession);
  const { weeks, monthLabels, metLast30 } = useMemo(() => {
    const byKey = new Map(days.map((day) => [day.dateKey, day]));
    const now = new Date();
    // What a running session has read is not free reading (as on the shelf).
    const free = freeReadsBesides(
      freeReads,
      running ? { startedAt: running.startedAt, minutes: sessionElapsedMs(running) / 60000 } : null,
      now
    );
    const freeByKey = new Map(free.map((entry) => [entry.dateKey, entry.minutes]));
    const todayKey = getDateKey(now);
    const first = addDays(mondayOf(now), -7 * (WEEKS - 1));
    const weeks: Cell[][] = [];
    const monthLabels: string[] = [];
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w += 1) {
      const monday = addDays(first, w * 7);
      const column: Cell[] = [];
      for (let d = 0; d < 7; d += 1) {
        const date = addDays(monday, d);
        const key = getDateKey(date);
        const day = byKey.get(key);
        const kept = Boolean(day && (day.freezeUsed || day.graceUsed));
        column.push({
          key,
          date,
          minutes: day?.minutes ?? 0,
          level: dayLevel(day, goalMinutes),
          free: freeByKey.get(key) ?? 0,
          met: isGoalMet(day),
          kept,
          future: key > todayKey,
          today: key === todayKey
        });
      }
      weeks.push(column);
      // A month's name above the first week that starts in it.
      const month = monday.getMonth();
      monthLabels.push(month !== lastMonth ? MONTHS[month] : "");
      lastMonth = month;
    }
    let metLast30 = 0;
    for (let i = 0; i < 30; i += 1) {
      if (isGoalMet(byKey.get(getDateKey(addDays(now, -i))))) {
        metLast30 += 1;
      }
    }
    return { weeks, monthLabels, metLast30 };
  }, [days, freeReads, goalMinutes, running]);

  // "45m, all free reading" / "45m, 20m of it free reading": the day counts
  // the same either way, and this says which kind of reading it was.
  const freeText = (cell: Cell) =>
    cell.free < 1 ? "" : Math.round(cell.free) >= Math.round(cell.minutes) ? ", all free reading" : `, ${minutesText(cell.free)} of it free reading`;

  const describe = (cell: Cell) =>
    `${WEEKDAYS[cell.date.getDay()]} ${cell.date.getDate()} ${MONTHS[cell.date.getMonth()]}: ` +
    (cell.minutes > 0 ? minutesText(cell.minutes) + freeText(cell) : "no reading") +
    (cell.kept ? ", streak kept by a freeze" : cell.met ? ", goal met" : "") +
    (cell.today ? " (today)" : "");

  return (
    <section className="paper-surface rounded-xl p-6" aria-labelledby="calendar-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={EYEBROW}>Last 12 weeks</p>
          <h2 id="calendar-title" className="page-title mt-2 text-2xl">
            Reading calendar
          </h2>
        </div>
        <p className="text-sm text-on-surface-variant">
          Goal met on <span className="font-semibold tabular-nums text-on-surface">{metLast30}</span> of the last 30 days
        </p>
      </div>

      <div className="mt-5 overflow-x-auto pb-1">
        <div className="inline-grid gap-1" style={{ gridTemplateColumns: `2.25rem repeat(${WEEKS}, minmax(1.1rem, 2.1rem))` }}>
          <span />
          {monthLabels.map((label, index) => (
            <span key={index} className="text-[10px] text-on-surface-variant">
              {label}
            </span>
          ))}
          {DAY_LABELS.map((label, row) => (
            <div key={row} className="contents">
              <span className="flex items-center justify-end pr-1 text-[10px] text-on-surface-variant">{label}</span>
              {weeks.map((column) => {
                const cell = column[row];
                if (cell.future) {
                  return <span key={cell.key} className="aspect-square" aria-hidden />;
                }
                return (
                  <span
                    key={cell.key}
                    role="img"
                    aria-label={describe(cell)}
                    title={describe(cell)}
                    className={`aspect-square rounded-[4px] ${LEVEL_CLASS[cell.level]} ${
                      cell.today ? "ring-2 ring-on-surface/60 ring-offset-1 ring-offset-surface" : ""
                    }`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-on-surface-variant" aria-hidden>
        <span>None</span>
        {LEVEL_CLASS.map((className, index) => (
          <span key={index} className={`h-3 w-3 rounded-[3px] ${className}`} />
        ))}
        <span>Goal met</span>
      </div>
    </section>
  );
};
