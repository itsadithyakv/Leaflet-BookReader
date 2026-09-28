import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Flame, Play } from "lucide-react";
import { PipSprite } from "../PipSprite";
import type { BoardEntry, BoardScope, CommunityBoard } from "../../services/socialService";
import { useCommunityStore } from "./communityStore";
import { CountUp } from "./CountUp";
import { PipAvatar } from "./PipAvatar";
import { at, localWeekEnd, minutesText, nameOf, prefersReducedMotion, readJson, timeLeftText, writeJson } from "./format";

const SHOWN_AT_FIRST = 10;
const PODIUM = ["#d4a73a", "#9aa3ad", "#c07d4c"];

type LeaderboardProps = {
  signedIn: boolean;
  /** Signed in with a public profile: can appear on and use the board. */
  canJoin: boolean;
  goalMinutes: number;
  sessionActive: boolean;
  onStartSession: (minutes: number) => void;
};

/** Re-renders every `ms`, for countdowns. */
const useNow = (ms: number) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
};

const ranksKey = (scope: BoardScope, weekKey: string) => `leaflet.community.ranks.${scope}.${weekKey}`;

/**
 * Where each reader stood when the reader last looked, per board and week.
 * Read once per visit (the arrows mean "since you last looked", not "since a
 * minute ago"), written on every refresh so the next visit compares to now.
 */
const useRankBaseline = (board: CommunityBoard | null) => {
  const baselines = useRef(new Map<string, Record<string, number>>());
  const key = board?.weekKey ? ranksKey(board.scope, board.weekKey) : null;
  if (key && !baselines.current.has(key)) {
    baselines.current.set(key, readJson<Record<string, number>>(key, {}));
  }
  useEffect(() => {
    if (key && board) {
      writeJson(key, Object.fromEntries(board.entries.map((entry) => [entry.handle, entry.rank])));
    }
  }, [key, board]);
  return key ? baselines.current.get(key) ?? {} : {};
};

/**
 * FLIP: after a refresh reorders the list, each row starts where it was and
 * glides to where it is. Measured with offsetTop inside the list, so scrolling
 * the page between refreshes does not read as movement.
 */
const useFlip = (order: string) => {
  const rows = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const reduce = prefersReducedMotion();
    const next = new Map<string, number>();
    rows.current.forEach((element, handle) => {
      const top = element.offsetTop;
      next.set(handle, top);
      const before = tops.current.get(handle);
      if (reduce || before === undefined || before === top) {
        return;
      }
      element.style.transition = "none";
      element.style.transform = `translateY(${before - top}px)`;
      // Commit the inverted position before animating back to none.
      void element.offsetHeight;
      element.style.transition = "transform 480ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      element.style.transform = "";
    });
    tops.current = next;
  }, [order]);
  return (handle: string) => (element: HTMLElement | null) => {
    if (element) {
      rows.current.set(handle, element);
    } else {
      rows.current.delete(handle);
    }
  };
};

const RankBadge = ({ rank }: { rank: number }) =>
  rank <= 3 ? (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-headline text-sm font-bold text-white shadow-sm"
      style={{ background: PODIUM[rank - 1] }}
      aria-label={`Rank ${rank}`}
    >
      {rank}
    </span>
  ) : (
    <span className="w-7 shrink-0 text-center font-headline text-sm font-bold tabular-nums text-on-surface-variant" aria-label={`Rank ${rank}`}>
      {rank}
    </span>
  );

const Movement = ({ delta }: { delta: number | null }) => {
  if (!delta) {
    return <span className="w-8 shrink-0" aria-hidden />;
  }
  const up = delta > 0;
  return (
    <span
      className={`w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums ${up ? "text-primary" : "text-on-surface-variant"}`}
      title={up ? `Up ${delta} since you last looked` : `Down ${-delta} since you last looked`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
};

type RowProps = {
  entry: BoardEntry;
  leader: number;
  delta: number | null;
  onOpen: (handle: string) => void;
  rowRef?: (element: HTMLElement | null) => void;
  pinned?: boolean;
};

const Row = ({ entry, leader, delta, onOpen, rowRef, pinned }: RowProps) => {
  const share = leader > 0 ? Math.max(2, Math.round((entry.weekMinutes / leader) * 100)) : 0;
  const podium = entry.rank <= 3 && !pinned;
  // Rows hold still; the one under the pointer (or focus) plays its signature
  // move, and your own row breathes so it is easy to spot.
  const [hot, setHot] = useState(false);
  return (
    <li ref={rowRef} className="list-none">
      <button
        type="button"
        onClick={() => onOpen(entry.handle)}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        onFocus={() => setHot(true)}
        onBlur={() => setHot(false)}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-container-high/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
          entry.isYou ? "bg-primary/10 ring-1 ring-primary/40" : podium ? "bg-surface-container-high/35" : ""
        } ${pinned ? "paper-surface shadow-lg" : ""}`}
        aria-label={`${nameOf(entry)}, rank ${entry.rank}, ${minutesText(entry.weekMinutes)} this week`}
      >
        <RankBadge rank={entry.rank} />
        <PipAvatar
          seed={entry.pipSeed}
          avatar={entry.avatar}
          size={podium ? 44 : 40}
          play={hot ? true : entry.isYou ? "idle" : false}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-on-surface">{nameOf(entry)}</span>
            {entry.isYou && <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">you</span>}
            <span className="hidden truncate text-xs text-on-surface-variant sm:inline">{at(entry.handle)}</span>
          </span>
          <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
            <span
              className="block h-full rounded-full bg-primary/80 transition-[width] duration-700 ease-out"
              style={{ width: `${share}%` }}
            />
          </span>
        </span>
        <span className="flex w-10 shrink-0 items-center justify-end gap-0.5 text-xs tabular-nums text-on-surface-variant" title={`${entry.streak}-day streak`}>
          {entry.streak > 0 && (
            <>
              <Flame size={13} className="text-[#d9886e]" aria-hidden />
              {entry.streak}
            </>
          )}
        </span>
        <span className="w-16 shrink-0 text-right font-headline text-base font-bold tabular-nums text-on-surface">
          <CountUp value={Math.round(entry.weekMinutes)} format={minutesText} />
        </span>
        <Movement delta={delta} />
      </button>
    </li>
  );
};

const PipNote = ({ move, children }: { move: string; children: ReactNode }) => (
  <div className="flex items-center gap-4 py-6">
    <PipSprite move={move} size={56} still />
    <p className="max-w-prose text-sm leading-6 text-on-surface-variant">{children}</p>
  </div>
);

/**
 * This week's board, as a friendly league: Everyone or just the readers you
 * follow, a podium, your own row always findable, and how far to the next
 * place. Refreshed by the Social page every minute.
 */
export const Leaderboard = ({ signedIn, canJoin, goalMinutes, sessionActive, onStartSession }: LeaderboardProps) => {
  const chosen = useCommunityStore((state) => state.scope);
  // Following needs an account; signed out, the board is Everyone's.
  const scope: BoardScope = chosen === "following" && !signedIn ? "everyone" : chosen;
  const setScope = useCommunityStore((state) => state.setScope);
  const board = useCommunityStore((state) => state.boards[scope]);
  const loading = useCommunityStore((state) => state.boardLoading[scope]);
  const error = useCommunityStore((state) => state.boardError[scope]);
  const openReader = useCommunityStore((state) => state.openReader);
  const [expanded, setExpanded] = useState(false);
  const [ownVisible, setOwnVisible] = useState(true);
  const ownRow = useRef<HTMLElement | null>(null);
  const now = useNow(60_000);

  const entries = useMemo(() => board?.entries ?? [], [board]);
  const shown = expanded ? entries : entries.slice(0, SHOWN_AT_FIRST);
  const you = board?.you ?? null;
  const youShown = Boolean(you && shown.some((entry) => entry.isYou));
  const leader = entries[0]?.weekMinutes ?? 0;
  const baseline = useRankBaseline(board);
  const flipRef = useFlip(shown.map((entry) => entry.handle).join("|"));

  // Pin your own row to the bottom while it is scrolled out of view.
  useEffect(() => {
    const element = ownRow.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setOwnVisible(youShown);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setOwnVisible(entry.isIntersecting), { threshold: 0.6 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [youShown, board]);

  const deltaFor = (entry: BoardEntry) => {
    const before = baseline[entry.handle];
    return before === undefined ? null : before - entry.rank;
  };

  // The next place up, and what it takes to get there.
  const above = you && you.rank > 1 ? entries.find((entry) => entry.rank === you.rank - 1) ?? entries[entries.length - 1] : null;
  const gap = above && you ? Math.max(1, Math.floor(above.weekMinutes - you.weekMinutes) + 1) : 0;
  const sessionMinutes = Math.max(goalMinutes > 0 ? goalMinutes : 20, Math.ceil(gap / 5) * 5);

  const tab = (value: BoardScope, label: string) => {
    const disabled = value === "following" && !signedIn;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={scope === value}
        disabled={disabled}
        title={disabled ? "Sign in to follow readers" : undefined}
        onClick={() => {
          setScope(value);
          setExpanded(false);
        }}
        className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          scope === value ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <section className="paper-surface rounded-xl p-6" aria-labelledby="board-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">This week</p>
          <h2 id="board-title" className="page-title mt-2 text-2xl">
            Leaderboard
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-on-surface-variant" title="Every Monday, local time">
            Resets in {timeLeftText(localWeekEnd(now), now)}
          </span>
          <div role="tablist" aria-label="Board" className="flex gap-1 rounded-full bg-surface-container p-1">
            {tab("everyone", "Everyone")}
            {tab("following", "Following")}
          </div>
        </div>
      </div>

      {/* Where you stand, and the next step up. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-container/60 px-4 py-3">
        <p className="text-sm text-on-surface">
          {!signedIn
            ? "Sign in (Settings → Account) and make your profile public to join the board."
            : !canJoin
              ? "Make your profile public to join in. Only readers who share appear here."
              : !you
                ? "Read a few minutes this week and you're on the board."
                : you.rank === 1
                  ? "You're leading this week. Enjoy the view."
                  : above
                    ? (
                      <>
                        <span className="font-semibold tabular-nums">{minutesText(gap)}</span> to pass{" "}
                        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => openReader(above.handle)}>
                          {at(above.handle)}
                        </button>
                      </>
                    )
                    : `You're #${you.rank} this week.`}
        </p>
        {canJoin && you && you.rank > 1 && (
          <button
            type="button"
            className="tactile-button tactile-button-primary flex items-center gap-1.5 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            disabled={sessionActive}
            title={sessionActive ? "A session is already running" : `Start a ${sessionMinutes}-minute session`}
            onClick={() => onStartSession(sessionMinutes)}
          >
            <Play size={13} aria-hidden />
            {sessionActive ? "Session running" : "Start a session"}
          </button>
        )}
      </div>

      {error && !board && <p className="mt-4 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">{error}</p>}

      {loading && !board && <PipNote move="look">Checking who's reading…</PipNote>}

      {board && entries.length === 0 && (
        <PipNote move={scope === "following" ? "welcome" : "read"}>
          {scope === "following"
            ? "Just you so far. Follow a few readers — from the board or by handle below — and this becomes your own little league."
            : "Nobody's on the board yet this week. A few minutes of reading and you're first."}
        </PipNote>
      )}

      {entries.length > 0 && (
        <ol className="relative mt-3 flex flex-col gap-1" aria-label={`${scope === "following" ? "Following" : "Everyone"} leaderboard`}>
          {shown.map((entry) => (
            <Row
              key={entry.handle}
              entry={entry}
              leader={leader}
              delta={deltaFor(entry)}
              onOpen={openReader}
              rowRef={(element) => {
                flipRef(entry.handle)(element);
                if (entry.isYou) {
                  ownRow.current = element;
                }
              }}
            />
          ))}
        </ol>
      )}

      {entries.length > SHOWN_AT_FIRST && (
        <button type="button" className="mt-2 text-xs font-semibold text-primary hover:underline" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show the top 10" : `Show all ${entries.length}`}
        </button>
      )}

      {/* Your row, pinned while it is out of view (or beyond the list). */}
      {you && (!youShown || !ownVisible) && (
        <ol className="sticky bottom-3 z-10 mt-2" aria-label="Your place">
          <Row entry={you} leader={leader} delta={deltaFor(you)} onOpen={openReader} pinned />
        </ol>
      )}
    </section>
  );
};
