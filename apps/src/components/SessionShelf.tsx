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
import { sessionElapsedMs, useHabitStore } from "../store/habitStore";
import { useLibraryStore } from "../store/libraryStore";
import type { FocusSessionRecord } from "../services/habitService";
import { clamp } from "./shelf/spine";
import {
  WEEKDAYS,
  buildRows,
  freeReadsBesides,
  minutesText,
  shortDate,
  type Row,
  type Spine,
  type WeekRow
} from "./shelf/rows";
import { FOCUS_FLOWERS, type FocusFlowerKind } from "../pip/focusFlower.js";
import "./SessionShelf.css";

/**
 * The Session Bookshelf. Every visual property of a spine is read from the
 * session it stands for, so the shelf can be read like a chart:
 *
 * - a row is a week (Monday to Sunday, local time), newest at the top
 * - height and width grow with the minutes read
 * - colour is the book; runs of one colour are runs on one book
 * - a gold band means the session ran to the end, cleanly
 * - a ribbon means the reader left a note
 * - a flower peeking out of the head is a focus flower that bloomed
 * - a charred spine was lost when a streak broke; it stays where it stood
 * - loose pages are a day's reading outside any focus session (a free read)
 * - a gold bookend closes a week where the goal was met every day
 * - the wood itself levels up with the number of spines still standing
 *
 * What stands where is worked out in `shelf/rows.ts`.
 */

// ---- Constants -------------------------------------------------------------

const VISIBLE_WEEKS = 8;
const LAST_SEEN_KEY = "leaflet.shelf.lastSeen";

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

const formatDuration = (minutes: number) => {
  const total = Math.round(minutes);
  if (total < 60) {
    return `${total}m`;
  }
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
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
  if (!session) {
    // A day's free reading: there is no start time or ending to report.
    return (
      <div className={className} style={style} aria-hidden="true">
        <p className="ss-tip-title">{spine.title}</p>
        <p className="ss-tip-meta">
          {WEEKDAYS[spine.start.getDay()]} {shortDate(spine.start, true)}
        </p>
        <p className="ss-tip-meta">{minutesText(spine.minutes)} · Read outside a focus session</p>
      </div>
    );
  }
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
      {spine.bloomed && <p className="ss-tip-flower">A {spine.bloomed} bloomed: read to the end in full screen</p>}
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
          {formatDuration(row.minutes)} read · {plural(row.sessions, "spine")}
          {row.freeMinutes > 0 && ` · ${formatDuration(row.freeMinutes)} free reading`}
          {row.lost > 0 && <span className="ss-row-lost"> · {row.lost} lost</span>}
        </span>
      </div>
      <div
        className="ss-books"
        role="group"
        aria-label={`${row.label}: ${plural(row.sessions, "session")}${
          row.freeMinutes > 0 ? `, ${formatDuration(row.freeMinutes)} of free reading` : ""
        }`}
      >
        {row.spines.map((spine, index) => {
          const { session } = spine;
          const classes = ["ss-spine"];
          if (spine.burned) classes.push("is-burned");
          if (spine.freeRead) classes.push("is-free");
          if (spine.loose) classes.push("is-loose");
          if (spine.id === dropId) classes.push("is-dropping");
          const tall = spine.height >= 84;
          return (
            <button
              key={spine.id}
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
              {session?.notes && !spine.burned && <span className="ss-ribbon" />}
              {spine.bloomed && !spine.burned && (
                <span
                  className="ss-flower"
                  style={
                    {
                      "--petal": FOCUS_FLOWERS[spine.bloomed as FocusFlowerKind]?.petal ?? "#E8484F",
                      "--middle": FOCUS_FLOWERS[spine.bloomed as FocusFlowerKind]?.middle ?? "#FFD23F"
                    } as CSSProperties
                  }
                />
              )}
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
  const ledgerFreeReads = useHabitStore((state) => state.snapshot.freeReads);
  const running = useHabitStore((state) => state.activeSession);
  const books = useLibraryStore((state) => state.books);
  const [showAll, setShowAll] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  // What a running session has read is not free reading: it is shelved as a
  // spine when the session ends.
  const freeReads = useMemo(
    () =>
      freeReadsBesides(
        ledgerFreeReads ?? [],
        running ? { startedAt: running.startedAt, minutes: sessionElapsedMs(running) / 60000 } : null,
        new Date()
      ),
    [ledgerFreeReads, running]
  );
  const bookTitles = useMemo(() => new Map(books.map((book) => [book.id, book.title])), [books]);
  const rows = useMemo(
    () => buildRows(sessions, days, bookTitles, new Date(), freeReads),
    [sessions, days, bookTitles, freeReads]
  );
  // Reading outside a focus session: on the shelf as loose pages, not counted
  // among the spines (the wood, and what a broken streak burns, are sessions).
  const freeMinutes = useMemo(() => (freeReads ?? []).reduce((sum, free) => sum + free.minutes, 0), [freeReads]);

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
  const empty = sessions.length === 0 && freeMinutes <= 0;

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
        {freeMinutes > 0 && (
          <div>
            <dt>Free reading</dt>
            <dd>{formatDuration(freeMinutes)}</dd>
          </div>
        )}
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
          <li><span className="ss-key ss-key-loose" />Loose pages: a free read, outside a focus session</li>
          <li><span className="ss-key ss-key-bookend" />Bookend: perfect week</li>
        </ul>
      )}

      {tip && <TipCard tip={tip} />}
    </section>
  );
};
