import type { BoardEntry, BoardScope, CommunityBoard } from "../../services/socialService";

/**
 * The reader's own place on the board, and what an empty board should say.
 *
 * The server lists only readers who share their profile, so a private reader
 * (the default) and a friend who has just signed up were both invisible, and
 * the board read "nobody's on the board yet" to someone who had read for
 * hours. The reader's own row is therefore drawn here, from the minutes on
 * this device, whether or not they share: nothing about a private profile has
 * to be on the server for its owner to see it. Pure, so the rules are tested
 * without a server or a screen.
 */

type LedgerDay = { dateKey: string; minutes: number };

const keyOf = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

/** The local Monday that starts the week holding `now`, as a ledger date key. */
export const weekStartKey = (now = new Date()) =>
  keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));

/**
 * Minutes read this week: the day ledger (every minute the reading heartbeat
 * counted, in a focus session or not), Monday to Sunday on the reader's own
 * calendar. The same sum Rust publishes (`build_profile_update`), so the row
 * drawn here and the row the server ranks cannot disagree.
 */
export const weekMinutesOf = (days: LedgerDay[], now = new Date()) => {
  const monday = weekStartKey(now);
  const nextMonday = weekStartKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  return days
    .filter((day) => day.dateKey >= monday && day.dateKey < nextMonday)
    .reduce((sum, day) => sum + day.minutes, 0);
};

/**
 * The ISO week (`2026-W40`) holding `now` on the reader's own calendar: the
 * week the app asks the board for (Rust's `iso_week_key`), and the one
 * `weekMinutesOf` sums.
 */
export const weekKeyOf = (now = new Date()) => {
  // An ISO week belongs to the year holding its Thursday.
  const thursday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + 3);
  const newYear = new Date(thursday.getFullYear(), 0, 1);
  // Rounded: a day is an hour short or long when the clocks change.
  const dayOfYear = Math.round((thursday.getTime() - newYear.getTime()) / 86_400_000);
  return `${thursday.getFullYear()}-W${String(Math.floor(dayOfYear / 7) + 1).padStart(2, "0")}`;
};

/** How many rows the Everyone board holds at most (the server's limit). */
export const BOARD_SIZE = 100;

export type OwnKind =
  /** On the board as everyone sees it: the server's own row. */
  | "shared"
  /** Not shared: drawn from this device, and shown to nobody else. */
  | "private"
  /** Shared, but the server has no minutes of theirs for this week (yet). */
  | "waiting"
  /** Signed in, but the profile could not be read: shared or not is not known. */
  | "unknown";

export type OwnRow = {
  kind: OwnKind;
  handle: string | null;
  displayName: string | null;
  pipSeed: string | null;
  avatar: string | null;
  weekMinutes: number;
  streak: number;
  /**
   * Where these minutes stand among the rows shown (or would, if shared).
   * Null when that cannot be said: nothing read yet on a board that lists
   * only readers with minutes, or past the end of a full board.
   */
  rank: number | null;
  /** The server's row, when there is one, for the board's usual row. */
  entry: BoardEntry | null;
};

type Standing = Pick<BoardEntry, "weekMinutes" | "streak"> & { handle: string | null };

/**
 * How many of `entries` are ahead of `mine`, by the board's own order: most
 * minutes, then longest streak, then handle. A reader with no handle yet goes
 * after everyone they tie with.
 */
export const aheadOf = (entries: BoardEntry[], mine: Standing) => {
  const minutes = Math.round(mine.weekMinutes);
  return entries.filter((entry) => {
    if (entry.isYou) {
      return false;
    }
    if (entry.weekMinutes !== minutes) {
      return entry.weekMinutes > minutes;
    }
    if (entry.streak !== mine.streak) {
      return entry.streak > mine.streak;
    }
    return mine.handle === null || entry.handle < mine.handle;
  }).length;
};

export type OwnInputs = {
  signedIn: boolean;
  scope: BoardScope;
  /** The board as last loaded, or null before the first answer (or when it failed). */
  board: (Pick<CommunityBoard, "entries" | "you"> & { weekKey?: string }) | null;
  /** The week this device's figures are for (see `weekKeyOf`). */
  weekKey?: string;
  /** The reader's profile as the server has it, or null when it is not known. */
  profile: { handle: string | null; displayName: string | null; visibility: "private" | "public" } | null;
  account: { displayName: string | null; avatar: string | null } | null;
  /** This device's own figures (see `weekMinutesOf`). */
  weekMinutes: number;
  streak: number;
};

/**
 * The signed-in reader's row. The server's when it sent one (they share and
 * have minutes this week), otherwise one made from this device's figures, so
 * a reader always finds themselves on the board. Null when signed out.
 */
export const ownRow = ({ signedIn, scope, board, weekKey, profile, account, weekMinutes, streak }: OwnInputs): OwnRow | null => {
  if (!signedIn) {
    return null;
  }
  const entries = board?.entries ?? [];
  const handle = profile?.handle ?? null;
  // A board fetched without the session (before signing in, or after it
  // lapsed) lists a shared reader like anyone else, not marked as "you".
  // Their handle says it is them; without this they got a second row, made
  // here, beside their real one.
  const sent =
    board?.you ??
    entries.find((entry) => entry.isYou) ??
    (handle ? entries.find((entry) => entry.handle === handle) : undefined) ??
    null;
  if (sent) {
    return {
      kind: "shared",
      handle: sent.handle,
      displayName: sent.displayName,
      pipSeed: sent.pipSeed,
      avatar: sent.avatar ?? null,
      weekMinutes: sent.weekMinutes,
      streak: sent.streak,
      rank: sent.rank,
      entry: sent
    };
  }

  const shares = profile?.visibility === "public" && Boolean(handle);
  const minutes = Math.max(0, weekMinutes);
  const ahead = aheadOf(entries, { weekMinutes: minutes, streak, handle });
  // The rows are another week's than these minutes. The server answers for
  // its own week when it does not believe the one asked for (this computer's
  // date is wrong by more than a day), and a board kept on screen across
  // Monday midnight is last week's until it reloads.
  const otherWeek = Boolean(weekKey && board?.weekKey && board.weekKey !== weekKey);
  // No board, no standing: a rank against rows that never loaded would be made up.
  // Everyone lists only readers with minutes this week; Following lists zeros.
  const unranked =
    !board ||
    otherWeek ||
    (scope === "everyone" && Math.round(minutes) < 1) ||
    (entries.length >= BOARD_SIZE && ahead >= entries.length);
  return {
    // A shared reader with no board to look at may well be on it: not "waiting".
    kind: profile === null || (shares && !board) ? "unknown" : shares ? "waiting" : "private",
    handle,
    displayName: profile?.displayName ?? account?.displayName ?? null,
    pipSeed: handle,
    avatar: account?.avatar ?? null,
    weekMinutes: minutes,
    streak,
    rank: unranked ? null : ahead + 1,
    entry: null
  };
};

/** The line under the reader's own row, when the row was made on this device. */
export const ownCaption = (row: OwnRow, publishError: string | null = null) => {
  const read = Math.round(row.weekMinutes) >= 1;
  switch (row.kind) {
    case "private":
      return row.rank !== null
        ? `Only you can see this. You'd be #${row.rank} if you shared your profile.`
        : "Only you can see this. Share your profile to be on the board.";
    case "waiting":
      if (!read) {
        return "Nothing read yet this week. A few minutes and you're on the board.";
      }
      return publishError
        ? `Not on the board yet: your minutes couldn't be sent. ${publishError}`
        : "Not on the board yet: your minutes are on their way.";
    case "unknown":
      return "Your reading this week, from this device.";
    case "shared":
      return null;
  }
};

export type EmptyBoardInputs = {
  scope: BoardScope;
  signedIn: boolean;
  /** Whether the reader shares their profile; null when that is not known. */
  sharing: boolean | null;
  /** Public profiles on the server, read this week or not. Absent from older servers. */
  sharedReaders?: number | null;
};

const ONLY_SHARERS = "The board lists only readers who share their profile";

/**
 * What a board with no rows says. It has to say *why* it is empty: "nobody
 * has shared a profile", "nobody has read yet this week" and "you and your
 * friends are not sharing" are three different things to do next, and one
 * cheerful line for all of them sent a reader looking for a bug.
 * (A board that failed to load is none of these: it shows the error instead.)
 */
export const emptyBoardText = ({ scope, signedIn, sharing, sharedReaders }: EmptyBoardInputs) => {
  if (scope === "following") {
    return sharing
      ? "Just you so far. Follow a few readers — from the board or by handle below — and this becomes your own little league."
      : "Following is for readers who share their profile. Share yours, then follow friends by their handle and they appear here.";
  }

  const others = !signedIn
    ? `${ONLY_SHARERS}.`
    : sharing
      ? "A few minutes of reading and you're first."
      : `${ONLY_SHARERS}: you and your friends appear here once your profiles are shared.`;

  if (sharedReaders === 0 && !sharing) {
    return `Nobody has shared a profile yet, so the board is empty. ${
      signedIn ? "Share yours and you're the first on it; friends appear once their profiles are shared too." : others
    }`;
  }
  if (typeof sharedReaders === "number" && sharedReaders > 0) {
    if (sharing && sharedReaders === 1) {
      return `You're the only reader sharing a profile so far. ${others}`;
    }
    const who = sharedReaders === 1 ? "One reader shares their profile" : `${sharedReaders} readers share their profile`;
    return `${who}, and nobody has read yet this week. ${others}`;
  }
  // An older server does not say how many share.
  return `Nobody who shares their profile has read yet this week. ${others}`;
};
