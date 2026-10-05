import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, EyeOff, Flame } from "lucide-react";
import type { Book } from "@shared/models/book";
import { PipSprite } from "../PipSprite";
import { SectionHeader } from "../ui/SectionHeader";
import { SegmentedTabs, panelId, tabId } from "../ui/SegmentedTabs";
import { COPY, streakText } from "./copy";
import type { BoardEntry, BoardScope, CommunityBoard } from "../../services/socialService";
import { useAccountStore } from "../../store/accountStore";
import { useHabitStore } from "../../store/habitStore";
import { useCommunityStore } from "./communityStore";
import { CountUp } from "./CountUp";
import { PipAvatar } from "./PipAvatar";
import { at, localWeekEnd, minutesText, nameOf, prefersReducedMotion, readJson, timeLeftText, writeJson } from "./format";
import { emptyBoardText, ownCaption, ownRow, weekKeyOf, weekMinutesOf, type OwnRow } from "./ownRow";

const SHOWN_AT_FIRST = 10;
const PODIUM = ["#d4a73a", "#9aa3ad", "#c07d4c"];

type LeaderboardProps = {
  signedIn: boolean;
  /** Signed in with a public profile: can appear on and use the board. */
  canJoin: boolean;
  goalMinutes: number;
  sessionActive: boolean;
  /** The book "keep reading" opens. */
  nowReading: Book | null;
  /** Starts a session of this many minutes on that book and opens it. */
  onReadNow: (minutes: number) => void;
  /** Shares the reader's profile, from their own row: the profile card's own switch. */
  onShare: () => void;
  /** A share is being saved. */
  shareBusy: boolean;
};

const BOARD_ID = "board";

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
    return <span className="hidden w-8 shrink-0 [@media(min-width:480px)]:block" aria-hidden />;
  }
  const up = delta > 0;
  return (
    <span
      className={`hidden w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums [@media(min-width:480px)]:block ${up ? "text-primary" : "text-on-surface-variant"}`}
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
        // Under 480 px the streak and the arrow give way, so the name keeps
        // some width: with all six columns it had none at all.
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-container-high/60 sm:gap-3 sm:px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
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
        <span className="hidden w-10 shrink-0 items-center justify-end gap-0.5 text-xs tabular-nums text-on-surface-variant [@media(min-width:480px)]:flex" title={`Streak: ${streakText(entry.streak)}`}>
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

type MineRowProps = {
  row: OwnRow;
  leader: number;
  caption: string | null;
  onShare: () => void;
  shareBusy: boolean;
  /** Sends the minutes again, when the last try failed. */
  onSendAgain: (() => void) | null;
};

/**
 * The reader's own row when the server sent none: they have not shared their
 * profile (the default), or their minutes have not reached it. Drawn from
 * this device's ledger, dashed so it does not pass for a row everyone sees,
 * and not a button: there is no public card behind it to open.
 */
const MineRow = ({ row, leader, caption, onShare, shareBusy, onSendAgain }: MineRowProps) => {
  const share = leader > 0 ? Math.max(2, Math.round((row.weekMinutes / leader) * 100)) : 0;
  const name = row.displayName || (row.handle ? at(row.handle) : "You");
  const hidden = row.kind === "private";
  return (
    <li className="list-none">
      <div
        className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-dashed border-primary/50 bg-primary/10 px-3 py-2.5"
        aria-label={`You, ${minutesText(row.weekMinutes)} this week${hidden ? ", visible only to you" : ""}`}
      >
        {hidden ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-on-surface-variant" title={COPY.onlyYouHint}>
            <EyeOff size={15} aria-hidden />
          </span>
        ) : (
          <span className="w-7 shrink-0 text-center font-headline text-sm font-bold tabular-nums text-on-surface-variant" aria-hidden>
            {row.rank ?? "–"}
          </span>
        )}
        <PipAvatar seed={row.pipSeed} avatar={row.avatar} size={40} play="idle" />
        <span className="min-w-0 flex-1 basis-40">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-on-surface">{name}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">you</span>
            {hidden && (
              <span
                className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant"
                title={COPY.onlyYouHint}
              >
                {COPY.onlyYou}
              </span>
            )}
          </span>
          <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
            <span
              className="block h-full rounded-full bg-primary/50 transition-[width] duration-700 ease-out"
              style={{ width: `${share}%` }}
            />
          </span>
          {caption && <span className="mt-1.5 block text-[11px] leading-4 text-on-surface-variant">{caption}</span>}
        </span>
        <span className="flex w-10 shrink-0 items-center justify-end gap-0.5 text-xs tabular-nums text-on-surface-variant" title={`Streak: ${streakText(row.streak)}`}>
          {row.streak > 0 && (
            <>
              <Flame size={13} className="text-[#d9886e]" aria-hidden />
              {row.streak}
            </>
          )}
        </span>
        <span className="w-16 shrink-0 text-right font-headline text-base font-bold tabular-nums text-on-surface">
          <CountUp value={Math.round(row.weekMinutes)} format={minutesText} />
        </span>
        {hidden && (
          <button
            type="button"
            className="tactile-button tactile-button-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onShare}
            disabled={shareBusy}
            title={row.handle ? "Puts this row on the board for other readers" : COPY.pickHandleFirst}
          >
            {shareBusy ? "Sharing…" : COPY.shareFromRow}
          </button>
        )}
        {onSendAgain && (
          <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={onSendAgain}>
            Send again
          </button>
        )}
      </div>
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
 * follow, a podium, your own row always there, and how far to the next
 * place. Refreshed by the Social page every minute.
 *
 * The server lists only readers who share their profile. A signed-in reader
 * who does not (the default) still sees their own row, drawn from this
 * device's minutes and marked as theirs alone, with the switch to share on it.
 */
export const Leaderboard = ({
  signedIn,
  canJoin,
  goalMinutes,
  sessionActive,
  nowReading,
  onReadNow,
  onShare,
  shareBusy
}: LeaderboardProps) => {
  const chosen = useCommunityStore((state) => state.scope);
  // Following needs an account; signed out, the board is Everyone's.
  const scope: BoardScope = chosen === "following" && !signedIn ? "everyone" : chosen;
  const setScope = useCommunityStore((state) => state.setScope);
  const board = useCommunityStore((state) => state.boards[scope]);
  const loading = useCommunityStore((state) => state.boardLoading[scope]);
  const error = useCommunityStore((state) => state.boardError[scope]);
  const openReader = useCommunityStore((state) => state.openReader);
  const loadBoard = useCommunityStore((state) => state.loadBoard);
  const me = useCommunityStore((state) => state.me);
  const publishError = useCommunityStore((state) => state.publishError);
  const publish = useCommunityStore((state) => state.publish);
  const account = useAccountStore((state) => state.status.account);
  const days = useHabitStore((state) => state.snapshot.days);
  const streak = useHabitStore((state) => state.snapshot.streak);
  const [expanded, setExpanded] = useState(false);
  const [ownVisible, setOwnVisible] = useState(true);
  const ownRowElement = useRef<HTMLElement | null>(null);
  const now = useNow(60_000);

  const entries = useMemo(() => board?.entries ?? [], [board]);
  const shown = expanded ? entries : entries.slice(0, SHOWN_AT_FIRST);
  const baseline = useRankBaseline(board);
  const flipRef = useFlip(shown.map((entry) => entry.handle).join("|"));

  // The reader's own row. The server's when it sent one; otherwise made here
  // from the day ledger, so nobody signed in looks at a board without them.
  const weekMinutes = useMemo(() => weekMinutesOf(days, now), [days, now]);
  const own = ownRow({ signedIn, scope, board, weekKey: weekKeyOf(now), profile: me, account, weekMinutes, streak });
  // The server's row for whoever is signed in now. Taken from `own`, not
  // straight from the board: a board kept from before a sign-out still names
  // the reader who left as "you".
  const you = own?.entry ?? null;
  const youShown = Boolean(you && shown.some((entry) => entry.handle === you.handle));
  // Not before the board has answered (or failed): a row that then jumps to
  // its place, or turns out to be on the board after all, helps nobody.
  const mine = own && own.kind !== "shared" && (board || error) ? own : null;
  const mineRead = Boolean(mine && Math.round(mine.weekMinutes) >= 1);
  const leader = Math.max(entries[0]?.weekMinutes ?? 0, mine?.weekMinutes ?? 0);
  // Where the device-made row sits among the rows shown: at its would-be
  // place, or after them when that place is further down than what is listed.
  const mineAt = mine ? (mine.rank !== null && mine.rank - 1 <= shown.length ? mine.rank - 1 : shown.length) : -1;
  const sendAgain = () =>
    void publish({ force: true }).then((sent) => {
      if (sent) {
        void loadBoard(scope);
      }
    });

  // Pin your own row to the bottom while it is scrolled out of view.
  useEffect(() => {
    const element = ownRowElement.current;
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
  // Enough to pass the next reader, and never less than a day's goal.
  const sessionMinutes = Math.max(goalMinutes > 0 ? goalMinutes : 20, Math.ceil(gap / 5) * 5);
  const offerReading = canJoin && (!you || you.rank > 1);
  const readLabel = sessionActive ? "Back to your book" : nowReading ? "Keep reading" : "Pick a book";
  const readHint = sessionActive
    ? "A session is running; this opens your book"
    : nowReading
      ? `A ${sessionMinutes}-minute session on ${nowReading.title}`
      : "Your library, to pick something to read";

  return (
    <section className="paper-surface rounded-xl p-4 sm:p-6" aria-labelledby="board-title">
      <SectionHeader
        eyebrow="This week"
        title="Leaderboard"
        id="board-title"
        actions={
          <>
            <span className="text-xs text-on-surface-variant" title={COPY.boardResets}>
              Resets in {timeLeftText(localWeekEnd(now), now)}
            </span>
            <SegmentedTabs
              label="Board"
              idPrefix={BOARD_ID}
              value={scope}
              onChange={(next) => {
                setScope(next);
                setExpanded(false);
              }}
              tabs={[
                { id: "everyone", label: "Everyone" },
                { id: "following", label: "Following", disabled: !signedIn, hint: signedIn ? undefined : COPY.signIn }
              ]}
            />
          </>
        }
      />

      {/* Where you stand, and the next step up. Only for readers on the board;
          the card above already says how to join. */}
      {canJoin && (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-container/60 px-4 py-3">
        <p className="text-sm text-on-surface">
          {!you
                ? mineRead
                  ? "Your minutes this week haven't reached the board yet."
                  : "Read a few minutes this week and you're on the board."
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
        {offerReading && (
          <button
            type="button"
            className="tactile-button tactile-button-primary flex items-center gap-1.5 px-4 py-2 text-xs"
            title={readHint}
            onClick={() => onReadNow(sessionMinutes)}
          >
            <BookOpen size={13} aria-hidden />
            {readLabel}
          </button>
        )}
      </div>
      )}

      {/* A shared reader whose latest minutes were refused or could not be
          sent: their row is there but behind, and this says why. */}
      {canJoin && you && publishError && (
        <p className="mt-2 text-xs text-on-surface-variant">
          Your latest minutes couldn't be sent, so your row may be behind. {publishError}
        </p>
      )}

      {/* A failed request is said as one, and never as an empty board: with
          rows from an earlier load still below, it says they may be stale. */}
      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">
          <span>
            {board ? COPY.boardStale : COPY.boardFailed} {error}
          </span>
          <button
            type="button"
            className="tactile-button px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void loadBoard(scope)}
            disabled={loading}
          >
            {loading ? "Trying…" : "Try again"}
          </button>
        </div>
      )}

      <div id={panelId(BOARD_ID, scope)} role="tabpanel" aria-labelledby={tabId(BOARD_ID, scope)}>
      {loading && !board && !error && <PipNote move="look">Checking who's reading…</PipNote>}

      {board && entries.length === 0 && !error && (
        <PipNote move={scope === "following" ? "welcome" : "read"}>
          {emptyBoardText({
            scope,
            signedIn,
            // Not known while the profile is still loading, or could not be read.
            sharing: signedIn && me ? canJoin : signedIn ? null : false,
            sharedReaders: board.sharedReaders
          })}
        </PipNote>
      )}

      {(entries.length > 0 || mine) && (
        <ol className="relative mt-3 flex flex-col gap-1" aria-label={`${scope === "following" ? "Following" : "Everyone"}, this week`}>
          {shown.map((entry, index) => (
            <Fragment key={entry.handle}>
              {mine && mineAt === index && (
                <MineRow
                  row={mine}
                  leader={leader}
                  caption={ownCaption(mine, publishError)}
                  onShare={onShare}
                  shareBusy={shareBusy}
                  onSendAgain={mine.kind === "waiting" && mineRead && publishError ? sendAgain : null}
                />
              )}
              <Row
                entry={entry}
                leader={leader}
                delta={deltaFor(entry)}
                onOpen={openReader}
                rowRef={(element) => {
                  flipRef(entry.handle)(element);
                  if (entry.handle === you?.handle) {
                    ownRowElement.current = element;
                  }
                }}
              />
            </Fragment>
          ))}
          {mine && mineAt >= shown.length && (
            <MineRow
              row={mine}
              leader={leader}
              caption={ownCaption(mine, publishError)}
              onShare={onShare}
              shareBusy={shareBusy}
              onSendAgain={mine.kind === "waiting" && mineRead && publishError ? sendAgain : null}
            />
          )}
        </ol>
      )}

      {entries.length > SHOWN_AT_FIRST && (
        <button type="button" className="mt-2 py-1 text-xs font-semibold text-primary hover:underline" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show the top 10" : `Show all ${entries.length}`}
        </button>
      )}

      {/* Why a friend may be missing: the board lists only readers who share. */}
      {signedIn && me && !canJoin && entries.length > 0 && (
        <p className="mt-3 max-w-prose text-xs leading-5 text-on-surface-variant">{COPY.onlySharers}</p>
      )}
      </div>

      {/* Your row, pinned while it is out of view (or beyond the list). */}
      {you && (!youShown || !ownVisible) && (
        <ol className="sticky bottom-3 z-10 mt-2" aria-label="Your place">
          <Row entry={you} leader={leader} delta={deltaFor(you)} onOpen={openReader} pinned />
        </ol>
      )}
    </section>
  );
};
