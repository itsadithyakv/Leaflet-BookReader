import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import { useHabitStore } from "../store/habitStore";
import { useLibraryStore } from "../store/libraryStore";
import { getDateKey, type DayRecord, type FocusSessionRecord } from "../services/habitService";

/**
 * The Session Bookshelf. Every visual property of a spine is read from the
 * session it stands for, so the shelf can be read like a chart:
 *
 * - a row is a week (Monday to Sunday, local time), newest at the top
 * - height and width grow with the minutes read
 * - colour is the book; runs of one colour are runs on one book
 * - a gold band means the session ran to the end, cleanly
 * - a ribbon means the reader left a note
 * - a charred spine was lost when a streak broke; it stays where it stood
 * - a gold bookend closes a week where the goal was met every day
 * - the wood itself levels up with the number of spines still standing
 */

// ---- Constants -------------------------------------------------------------

const VISIBLE_WEEKS = 8;
const LAST_SEEN_KEY = "leaflet.shelf.lastSeen";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Bookcloth colours. Twelve, so a reader's regular books rarely share one. */
const CLOTH = [
  "#6e1f24", // oxblood
  "#2f5039", // forest
  "#24345a", // navy
  "#b8842f", // ochre
  "#5a2f52", // plum
  "#1f5b5e", // teal
  "#9a4a26", // rust
  "#4d5868", // slate
  "#6b6a2e", // olive
  "#8da47e", // sage
  "#b56d78", // rose
  "#3f4046" // charcoal
];
const PARCHMENT = "#eadfc4";

type Wood = { id: string; name: string; at: number };
const WOODS: Wood[] = [
  { id: "pine", name: "Pine", at: 0 },
  { id: "oak", name: "Oak", at: 50 },
  { id: "walnut", name: "Walnut", at: 120 },
  { id: "mahogany", name: "Mahogany", at: 250 },
  { id: "ebony", name: "Ebony", at: 400 },
  { id: "gilded", name: "Gilded", at: 600 }
];

// ---- Helpers ---------------------------------------------------------------

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hash = (value: string) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Relative luminance, to pick spine lettering that stays legible. */
const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
};
const DARK_INK = "#2a2016";
const LIGHT_INK = "#f4ead8";
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** Whichever lettering has the higher contrast ratio against the cloth. */
const inkFor = (hex: string) => {
  const cloth = luminance(hex);
  return contrast(cloth, luminance(DARK_INK)) >= contrast(cloth, luminance(LIGHT_INK)) ? DARK_INK : LIGHT_INK;
};

const parseDateKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const mondayOf = (date: Date) => addDays(date, -((date.getDay() + 6) % 7));

const shortDate = (date: Date, withYear = false) =>
  `${date.getDate()} ${MONTHS[date.getMonth()]}${withYear ? ` ${date.getFullYear()}` : ""}`;

const formatDuration = (minutes: number) => {
  const total = Math.round(minutes);
  if (total < 60) {
    return `${total}m`;
  }
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};
const minutesText = (minutes: number) => {
  const rounded = Math.round(minutes);
  return rounded < 1 ? "under a minute" : `${rounded} min`;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const readLastSeen = () => {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
};
const writeLastSeen = (id: string) => {
  try {
    localStorage.setItem(LAST_SEEN_KEY, id);
  } catch {
    // A missed drop animation is harmless.
  }
};

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

// ---- Model -----------------------------------------------------------------

type Spine = {
  session: FocusSessionRecord;
  title: string;
  freeRead: boolean;
  cloth: string;
  ink: string;
  height: number;
  width: number;
  completed: boolean;
  burned: boolean;
  start: Date;
  label: string;
};

type WeekRow = {
  kind: "week";
  key: string;
  label: string;
  spines: Spine[];
  minutes: number;
  lost: number;
  perfect: boolean;
};
type GapRow = { kind: "gap"; key: string; weeks: number };
type Row = WeekRow | GapRow;

const spineHeight = (minutes: number) => Math.round(clamp(56 + minutes * 1.4, 64, 132));
const spineWidth = (minutes: number) => Math.round(clamp(14 + minutes * 0.34, 18, 34));

const isMet = (day: DayRecord) =>
  day.freezeUsed || day.graceUsed || (day.goalMinutes > 0 && day.minutes >= day.goalMinutes);

/**
 * Colours go to books in order of first appearance: each book starts at its
 * hashed slot and takes the next free one, so the first twelve books never
 * collide and a book keeps its colour for as long as its first session exists.
 */
const assignColours = (sessions: FocusSessionRecord[]) => {
  const byBook = new Map<string, string>();
  const used = new Set<number>();
  for (const session of sessions) {
    const key = session.bookId ?? (session.title ? `title:${session.title.trim().toLowerCase()}` : null);
    if (!key || byBook.has(key)) {
      continue;
    }
    const start = hash(key) % CLOTH.length;
    let slot = start;
    if (used.size < CLOTH.length) {
      while (used.has(slot)) {
        slot = (slot + 1) % CLOTH.length;
      }
      used.add(slot);
    }
    byBook.set(key, CLOTH[slot]);
  }
  return byBook;
};

const buildRows = (
  sessions: FocusSessionRecord[],
  days: DayRecord[],
  bookTitles: Map<string, string>,
  today: Date
): Row[] => {
  const sorted = [...sessions].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const colours = assignColours(sorted);
  const dayMap = new Map(days.map((day) => [day.dateKey, day]));

  const weeks = new Map<string, Spine[]>();
  for (const session of sorted) {
    const weekKey = getDateKey(mondayOf(parseDateKey(session.dateKey)));
    const bookKey = session.bookId ?? (session.title ? `title:${session.title.trim().toLowerCase()}` : null);
    const freeRead = !bookKey;
    const cloth = freeRead ? PARCHMENT : colours.get(bookKey) ?? CLOTH[0];
    const title = (session.bookId && bookTitles.get(session.bookId)) || session.title || "Free read";
    const start = new Date(session.startedAt);
    const completed = session.endedReason === "completed" && session.clean;
    const burned = Boolean(session.burnedAt);
    const parts = [
      title,
      minutesText(session.minutes),
      `${WEEKDAYS[start.getDay()]} ${shortDate(start)}`,
      completed ? "completed" : "ended early"
    ];
    if (burned) {
      parts.push(`lost when a streak broke on ${shortDate(new Date(session.burnedAt as string), true)}`);
    }
    if (session.notes) {
      parts.push("has a note");
    }
    const spine: Spine = {
      session,
      title,
      freeRead,
      cloth,
      ink: inkFor(cloth),
      height: spineHeight(session.minutes),
      width: spineWidth(session.minutes),
      completed,
      burned,
      start,
      label: parts.join(", ")
    };
    const list = weeks.get(weekKey);
    if (list) {
      list.push(spine);
    } else {
      weeks.set(weekKey, [spine]);
    }
  }

  const weekMinutes = new Map<string, number>();
  let earliest = mondayOf(today);
  for (const day of days) {
    const monday = mondayOf(parseDateKey(day.dateKey));
    const key = getDateKey(monday);
    weekMinutes.set(key, (weekMinutes.get(key) ?? 0) + day.minutes);
    if (monday < earliest) {
      earliest = monday;
    }
  }
  for (const key of weeks.keys()) {
    const monday = parseDateKey(key);
    if (monday < earliest) {
      earliest = monday;
    }
  }

  const todayKey = getDateKey(today);
  const thisMonday = mondayOf(today);
  const rows: Row[] = [];
  let gap = 0;
  let gapKey = "";
  for (let monday = thisMonday, index = 0; monday >= earliest; monday = addDays(monday, -7), index += 1) {
    const key = getDateKey(monday);
    const spines = weeks.get(key) ?? [];
    const minutes = weekMinutes.get(key) ?? 0;
    if (index > 0 && spines.length === 0 && minutes <= 0) {
      if (gap === 0) {
        gapKey = key;
      }
      gap += 1;
      continue;
    }
    if (gap > 0) {
      rows.push({ kind: "gap", key: `gap-${gapKey}`, weeks: gap });
      gap = 0;
    }
    const sunday = addDays(monday, 6);
    const finished = getDateKey(sunday) < todayKey;
    let perfect = finished;
    for (let d = 0; perfect && d < 7; d += 1) {
      const day = dayMap.get(getDateKey(addDays(monday, d)));
      perfect = Boolean(day && isMet(day));
    }
    rows.push({
      kind: "week",
      key,
      label:
        index === 0
          ? "This week"
          : index === 1
            ? "Last week"
            : `Week of ${shortDate(monday, monday.getFullYear() !== today.getFullYear())}`,
      spines,
      minutes,
      lost: spines.filter((spine) => spine.burned).length,
      perfect
    });
  }
  return rows;
};

// ---- Popover ---------------------------------------------------------------

type Tip =
  | { kind: "spine"; spine: Spine; x: number; y: number; below: boolean }
  | { kind: "bookend"; label: string; x: number; y: number; below: boolean };

type ShowTip = (target: HTMLElement, content: { spine: Spine } | { bookend: string }) => void;

const TipCard = ({ tip }: { tip: Tip }) => {
  const style = { left: tip.x, top: tip.y } as CSSProperties;
  const className = `ss-tip${tip.below ? " is-below" : ""}`;
  if (tip.kind === "bookend") {
    return (
      <div className={className} style={style} aria-hidden="true">
        <p className="ss-tip-title">Perfect week</p>
        <p className="ss-tip-meta">Goal met all seven days, {tip.label.toLowerCase()}.</p>
      </div>
    );
  }
  const { spine } = tip;
  const { session } = spine;
  const burnedOn = session.burnedAt ? shortDate(new Date(session.burnedAt), true) : "";
  return (
    <div className={className} style={style} aria-hidden="true">
      <p className="ss-tip-title">{spine.title}</p>
      <p className="ss-tip-meta">
        {WEEKDAYS[spine.start.getDay()]} {shortDate(spine.start, true)} ·{" "}
        {spine.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </p>
      <p className="ss-tip-meta">
        {minutesText(session.minutes)} ·{" "}
        <span className={spine.completed ? "ss-tip-ok" : undefined}>
          {spine.completed ? "Completed" : "Ended early"}
        </span>
      </p>
      {session.notes && <p className="ss-tip-note">{session.notes}</p>}
      {spine.burned && <p className="ss-tip-burned">Lost when a streak broke · {burnedOn}</p>}
    </div>
  );
};

// ---- Rows ------------------------------------------------------------------

const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
  const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
  const step = keys[event.key];
  if (step === undefined) {
    return;
  }
  const row = event.currentTarget.closest(".ss-books");
  const buttons = row ? Array.from(row.querySelectorAll<HTMLButtonElement>(".ss-spine")) : [];
  const index = buttons.indexOf(event.currentTarget);
  const next = Number.isFinite(step)
    ? buttons[clamp(index + step, 0, buttons.length - 1)]
    : buttons[step < 0 ? 0 : buttons.length - 1];
  if (next && next !== event.currentTarget) {
    event.preventDefault();
    buttons.forEach((button) => (button.tabIndex = -1));
    next.tabIndex = 0;
    next.focus();
  }
};

type WeekProps = {
  row: WeekRow;
  dropId: string | null;
  showTip: ShowTip;
  hideTip: () => void;
};

const WeekShelf = memo(({ row, dropId, showTip, hideTip }: WeekProps) => {
  const reveal = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, spine: Spine) =>
    showTip(event.currentTarget, { spine });
  const last = row.spines.length - 1;
  return (
    <li className="ss-row">
      <div className="ss-row-head">
        <span className="ss-row-label">{row.label}</span>
        <span className="ss-row-stats">
          {formatDuration(row.minutes)} read · {plural(row.spines.length, "spine")}
          {row.lost > 0 && <span className="ss-row-lost"> · {row.lost} lost</span>}
        </span>
      </div>
      <div className="ss-books" role="group" aria-label={`${row.label}: ${plural(row.spines.length, "session")}`}>
        {row.spines.map((spine, index) => {
          const { session } = spine;
          const classes = ["ss-spine"];
          if (spine.burned) classes.push("is-burned");
          if (spine.freeRead) classes.push("is-free");
          if (session.id === dropId) classes.push("is-dropping");
          const tall = spine.height >= 84;
          return (
            <button
              key={session.id}
              type="button"
              className={classes.join(" ")}
              style={
                {
                  "--h": `${spine.height}px`,
                  "--w": `${spine.width}px`,
                  "--cloth": spine.cloth,
                  "--ink": spine.ink
                } as CSSProperties
              }
              aria-label={spine.label}
              tabIndex={index === last ? 0 : -1}
              onMouseEnter={(event) => reveal(event, spine)}
              onMouseLeave={hideTip}
              onFocus={(event) => reveal(event, spine)}
              onBlur={hideTip}
              onKeyDown={moveFocus}
            >
              <span className="ss-cloth">
                {spine.completed && !spine.burned && <span className="ss-band" />}
                <span className="ss-title">{spine.title}</span>
                {tall && <span className="ss-day">{spine.start.getDate()}</span>}
              </span>
              {session.notes && !spine.burned && <span className="ss-ribbon" />}
              {spine.burned && <span className="ss-ember" />}
            </button>
          );
        })}
        {row.spines.length === 0 && <span className="ss-quiet">Nothing shelved yet</span>}
        {row.perfect && (
          <span
            className="ss-bookend"
            role="img"
            tabIndex={0}
            aria-label={`Perfect week: goal met all seven days, ${row.label}`}
            onMouseEnter={(event) => showTip(event.currentTarget, { bookend: row.label })}
            onMouseLeave={hideTip}
            onFocus={(event) => showTip(event.currentTarget, { bookend: row.label })}
            onBlur={hideTip}
          />
        )}
      </div>
    </li>
  );
});
WeekShelf.displayName = "WeekShelf";

// ---- Shelf -----------------------------------------------------------------

export const SessionShelf = () => {
  const sessions = useHabitStore((state) => state.snapshot.sessions);
  const days = useHabitStore((state) => state.snapshot.days);
  const books = useLibraryStore((state) => state.books);
  const [showAll, setShowAll] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  const bookTitles = useMemo(() => new Map(books.map((book) => [book.id, book.title])), [books]);
  const rows = useMemo(() => buildRows(sessions, days, bookTitles, new Date()), [sessions, days, bookTitles]);

  const stats = useMemo(() => {
    let standing = 0;
    let shelvedMinutes = 0;
    let longest = 0;
    let lost = 0;
    let newest: FocusSessionRecord | null = null;
    for (const session of sessions) {
      longest = Math.max(longest, session.minutes);
      if (session.burnedAt) {
        lost += 1;
        continue;
      }
      standing += 1;
      shelvedMinutes += session.minutes;
      if (!newest || Date.parse(session.endedAt) > Date.parse(newest.endedAt)) {
        newest = session;
      }
    }
    return { standing, shelvedMinutes, longest, lost, newestId: newest?.id ?? null };
  }, [sessions]);

  // The newest spine drops in if it arrived since the shelf was last looked at.
  useEffect(() => {
    const newestId = stats.newestId;
    if (!newestId) {
      return;
    }
    if (readLastSeen() !== newestId) {
      writeLastSeen(newestId);
      if (!prefersReducedMotion()) {
        setDropId(newestId);
      }
    }
  }, [stats.newestId]);

  const woodIndex = WOODS.reduce((found, wood, index) => (stats.standing >= wood.at ? index : found), 0);
  const wood = WOODS[woodIndex];
  const nextWood = WOODS[woodIndex + 1] ?? null;
  const woodProgress = nextWood ? (stats.standing - wood.at) / (nextWood.at - wood.at) : 1;

  const showTip = useCallback<ShowTip>((target, content) => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const box = root.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const below = rect.top < 190;
    const x = clamp(rect.left + rect.width / 2 - box.left, 124, box.width - 124);
    const y = below ? rect.bottom - box.top + 10 : rect.top - box.top - 14;
    setTip(
      "spine" in content
        ? { kind: "spine", spine: content.spine, x, y, below }
        : { kind: "bookend", label: content.bookend, x, y, below }
    );
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  const visibleRows = useMemo(() => {
    if (showAll) {
      return rows;
    }
    const out: Row[] = [];
    let weeks = 0;
    for (const row of rows) {
      if (row.kind === "week") {
        if (weeks >= VISIBLE_WEEKS) break;
        weeks += 1;
      }
      out.push(row);
    }
    // A "quiet weeks" divider with nothing under it would read as the end of history.
    if (out[out.length - 1]?.kind === "gap") {
      out.pop();
    }
    return out;
  }, [rows, showAll]);
  const hiddenWeeks = rows.filter((row) => row.kind === "week").length - visibleRows.filter((row) => row.kind === "week").length;
  const empty = sessions.length === 0;

  return (
    <section ref={rootRef} className="ss paper-surface rounded-xl p-6" data-wood={wood.id} onScrollCapture={hideTip}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-on-surface-variant">Your reading shelf</p>
          <h2 className="page-title mt-2 text-2xl">Session Bookshelf</h2>
        </div>
        <div className="ss-wood-meter" title="The shelf wood improves as spines accumulate. Burned spines don't count.">
          <span className="ss-wood-swatch" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-on-surface">{wood.name} shelf</p>
            <div className="ss-wood-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(woodProgress * 100)}%` }} />
            </div>
            <p className="text-[11px] tabular-nums text-on-surface-variant">
              {nextWood ? `${stats.standing} / ${nextWood.at} to ${nextWood.name}` : "The finest wood there is"}
            </p>
          </div>
        </div>
      </div>

      <dl className="ss-stats">
        <div>
          <dt>On the shelf</dt>
          <dd>{plural(stats.standing, "spine")}</dd>
        </div>
        <div>
          <dt>Shelved time</dt>
          <dd>{formatDuration(stats.shelvedMinutes)}</dd>
        </div>
        <div>
          <dt>Longest session</dt>
          <dd>{stats.longest > 0 ? minutesText(stats.longest) : "None yet"}</dd>
        </div>
        {stats.lost > 0 && (
          <div className="is-lost">
            <dt>Lost to broken streaks</dt>
            <dd>{plural(stats.lost, "book")}</dd>
          </div>
        )}
      </dl>

      <div className="ss-case">
        {empty ? (
          <div className="ss-row">
            <div className="ss-books ss-empty">
              <span className="ss-ghost" aria-hidden="true" />
              <span className="ss-empty-line">Your first focus session puts the first book here.</span>
            </div>
          </div>
        ) : (
          <ul className="ss-rows">
            {visibleRows.map((row) =>
              row.kind === "gap" ? (
                <li key={row.key} className="ss-gap">
                  {row.weeks === 1 ? "A quiet week" : `${row.weeks} quiet weeks`}
                </li>
              ) : (
                <WeekShelf key={row.key} row={row} dropId={dropId} showTip={showTip} hideTip={hideTip} />
              )
            )}
          </ul>
        )}
      </div>

      {hiddenWeeks > 0 && (
        <button type="button" className="tactile-button mt-4 px-4 py-2 text-xs" onClick={() => setShowAll(true)}>
          Show older weeks ({hiddenWeeks})
        </button>
      )}

      {!empty && (
        <ul className="ss-legend" aria-label="How to read the shelf">
          <li><span className="ss-key ss-key-size" />Size: minutes read</li>
          <li><span className="ss-key ss-key-cloth" />Colour: the book</li>
          <li><span className="ss-key ss-key-band" />Gold band: completed</li>
          <li><span className="ss-key ss-key-ribbon" />Ribbon: has a note</li>
          <li><span className="ss-key ss-key-burned" />Charred: lost to a broken streak</li>
          <li><span className="ss-key ss-key-bookend" />Bookend: perfect week</li>
        </ul>
      )}

      {tip && <TipCard tip={tip} />}
    </section>
  );
};
