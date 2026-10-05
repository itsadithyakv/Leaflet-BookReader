/**
 * Visitors: a friend's Pip knocks and reads beside the reader's own, on a day
 * they have both read.
 *
 * A friend is a reader this one follows who follows them back (the server
 * decides that; a follow one way is not a visit). The server says which of them read
 * today (`GET /v1/visitors`: public profiles only, at most a handful, and only
 * to a signed-in reader whose own profile is public); this file decides, from
 * that list and the reader's own day, whether anyone comes, who, when and for
 * how long, and where a visitor is at any moment of a visit.
 *
 * All of it pure, and all of it by the clock and the date: a visit is a
 * record (who, from when, until when), so it does not flicker when the list
 * is fetched again, and one under way is still under way when the reader
 * leaves the Pip tab and comes back. Nothing here earns seeds or moves mood:
 * a visit is company, for show.
 */

/** A friend who read today, as the server lists them: only what their public profile already shows. */
export type VisitorCandidate = {
  handle: string;
  displayName: string | null;
  /** Picks the skin when they have no avatar (see `community/PipAvatar`). */
  pipSeed: string;
  /** Their Pip's look, `skin.move` or `skin.move.acc+acc`; null for none. */
  avatar?: string | null;
  weekMinutes: number;
  streak: number;
};

/**
 * A day counts as read from this many minutes on its ledger. The same number
 * is `READ_DAY_MINUTES` in `commands/social.rs`, which is what publishes the
 * reader's own "read today" for their friends.
 */
export const READ_TODAY_MINUTES = 1;
/** A few visits a day, and a friend comes once. */
export const MAX_VISITS_A_DAY = 3;
/** The first knock comes this long after the Pip tab opens (somewhere between). */
export const FIRST_KNOCK_MS: readonly [number, number] = [20_000, 90_000];
/** After a visit, the door stays quiet at least this long (and up to ten minutes more). */
export const BETWEEN_VISITS_MS = 25 * 60_000;
const BETWEEN_SPREAD_MS = 10 * 60_000;
/** How long a visitor stays, knock to gone (somewhere between). */
export const VISIT_MS: readonly [number, number] = [3 * 60_000, 5 * 60_000];
/** While Pip cannot have company (in the reader's hand, the room being decorated), look again this soon. */
const BUSY_RETRY_MS = 15_000;
/** While she is asleep or out and a note is already on the door. */
const AWAY_RETRY_MS = 60_000;

/** One visit of the day: who, and from when until when (epoch ms). A note is a visit nobody was home for. */
export type VisitRecord = { handle: string; from: number; until: number; kind: "visit" | "note"; read?: boolean };
/** Today's visits, oldest first. Kept on this device only. */
export type VisitLog = { day: string; visits: VisitRecord[] };

export const emptyLog = (day: string): VisitLog => ({ day, visits: [] });

/**
 * Whether Pip can have company: at home and awake, asleep, out (an
 * expedition), or busy for a moment (held, the room being decorated, the
 * arcade open), which only puts a knock off.
 */
export type Host = "home" | "asleep" | "out" | "busy";

/**
 * How Pip is, from what the house says of her (`RoomFrame.pip()`: her phase,
 * and whether she is away), and whether the room is taken up with something
 * else (decorating, the arcade). With no house to ask, she is at home.
 */
export const hostOf = (pip: { phase?: string; away?: boolean } | null | undefined, roomBusy = false): Host => {
  if (pip?.away) {
    return "out";
  }
  if (pip?.phase === "sleep" || pip?.phase === "tuck") {
    return "asleep";
  }
  if (roomBusy || pip?.phase === "held" || pip?.phase === "fall" || pip?.phase === "land" || pip?.phase === "carry") {
    return "busy";
  }
  return "home";
};

export type VisitInput = {
  /** The reader's local date, `YYYY-MM-DD`. */
  day: string;
  now: number;
  /** When the Pip tab was opened this time. */
  openedAt: number;
  /** Community on, signed in, and the reader's own profile public. */
  enabled: boolean;
  /** Minutes on today's ledger. */
  todayMinutes: number;
  /** The friends the server says read today. */
  candidates: readonly VisitorCandidate[];
  log: VisitLog;
  host: Host;
};

export type VisitDecision =
  /** Nobody comes. */
  | { kind: "none"; why: "off" | "notRead" | "nobody" | "enough" }
  /** Nobody yet: look again at `at`. */
  | { kind: "wait"; at: number }
  /** A visit under way (begun earlier, or before the tab was last left). */
  | { kind: "visiting"; record: VisitRecord; visitor: VisitorCandidate }
  /** The visitor under way is no longer on the server's list (unfollowed, gone private): the visit ends now. */
  | { kind: "end"; record: VisitRecord }
  /** A knock: this visit starts now. */
  | { kind: "start"; record: VisitRecord; visitor: VisitorCandidate }
  /** Nobody home: the friend leaves a note. */
  | { kind: "note"; record: VisitRecord; visitor: VisitorCandidate };

/** FNV-1a with an avalanche: a number in [0, 1) that is always the same for the same words. */
export const seeded = (...words: Array<string | number>) => {
  const text = words.join("|");
  let h = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

const between = ([low, high]: readonly [number, number], at: number) => Math.round(low + (high - low) * at);

/** Today's part of a log; a log from another day is an empty one. */
export const logFor = (log: VisitLog | null | undefined, day: string): VisitLog =>
  log && log.day === day && Array.isArray(log.visits) ? log : emptyLog(day);

/** The visit under way at `now`, if there is one. */
export const visitUnderWay = (log: VisitLog, now: number) =>
  log.visits.find((visit) => visit.kind === "visit" && visit.from <= now && now < visit.until) ?? null;

/** The note on the door: the newest one not yet read. */
export const noteWaiting = (log: VisitLog) => [...log.visits].reverse().find((visit) => visit.kind === "note" && !visit.read) ?? null;

/** The friends in the order they would come today: by the date and their handle, never by their minutes. */
export const visitingOrder = (day: string, candidates: readonly VisitorCandidate[]) =>
  [...candidates].sort((a, b) => seeded(day, "who", a.handle) - seeded(day, "who", b.handle) || a.handle.localeCompare(b.handle));

/** When the next knock may come, given today's visits so far and when the tab was opened. */
export const nextKnockAt = (day: string, log: VisitLog, openedAt: number) => {
  const count = log.visits.length;
  const afterOpening = openedAt + between(FIRST_KNOCK_MS, seeded(day, "knock", count));
  const last = log.visits[count - 1];
  if (!last) {
    return afterOpening;
  }
  const afterLast = last.until + BETWEEN_VISITS_MS + Math.round(BETWEEN_SPREAD_MS * seeded(day, "gap", count));
  return Math.max(afterOpening, afterLast);
};

/**
 * What happens at the door now. The caller keeps the record of a `start`,
 * `note` or `end` in the log (see `withVisit`), and looks again at `wait.at`.
 */
export const decideVisit = (input: VisitInput): VisitDecision => {
  const { day, now, enabled, candidates, host } = input;
  if (!enabled) {
    return { kind: "none", why: "off" };
  }
  if (input.todayMinutes < READ_TODAY_MINUTES) {
    return { kind: "none", why: "notRead" };
  }
  const log = logFor(input.log, day);

  // One under way carries on, whatever else has changed, as long as the
  // server still lists the friend: a list that no longer does is the server
  // saying they are not to be shown (unfollowed, or their profile private).
  const current = visitUnderWay(log, now);
  if (current) {
    const visitor = candidates.find((candidate) => candidate.handle === current.handle);
    return visitor ? { kind: "visiting", record: current, visitor } : { kind: "end", record: { ...current, until: now } };
  }

  if (candidates.length === 0) {
    return { kind: "none", why: "nobody" };
  }
  if (log.visits.length >= MAX_VISITS_A_DAY) {
    return { kind: "none", why: "enough" };
  }
  const been = new Set(log.visits.map((visit) => visit.handle));
  const visitor = visitingOrder(day, candidates).find((candidate) => !been.has(candidate.handle));
  if (!visitor) {
    return { kind: "none", why: "enough" };
  }

  const at = nextKnockAt(day, log, input.openedAt);
  if (now < at) {
    return { kind: "wait", at };
  }
  if (host === "busy") {
    return { kind: "wait", at: now + BUSY_RETRY_MS };
  }
  if (host !== "home") {
    // One note a day: after that the friends wait for her to be home.
    if (log.visits.some((visit) => visit.kind === "note")) {
      return { kind: "wait", at: now + AWAY_RETRY_MS };
    }
    return { kind: "note", record: { handle: visitor.handle, from: now, until: now, kind: "note" }, visitor };
  }
  const stay = between(VISIT_MS, seeded(day, "stay", visitor.handle));
  return { kind: "start", record: { handle: visitor.handle, from: now, until: now + stay, kind: "visit" }, visitor };
};

/** The log with a record added, or replaced when it is one already there (same friend, same start). */
export const withVisit = (log: VisitLog, record: VisitRecord): VisitLog => {
  const same = (visit: VisitRecord) => visit.handle === record.handle && visit.from === record.from;
  return log.visits.some(same)
    ? { ...log, visits: log.visits.map((visit) => (same(visit) ? record : visit)) }
    : { ...log, visits: [...log.visits, record] };
};

/** A log read back from storage: only today's, only well-formed records. */
export const parseLog = (raw: unknown, day: string): VisitLog => {
  const value = raw as Partial<VisitLog> | null;
  if (!value || value.day !== day || !Array.isArray(value.visits)) {
    return emptyLog(day);
  }
  const visits = value.visits.filter(
    (visit): visit is VisitRecord =>
      Boolean(visit) &&
      typeof visit.handle === "string" &&
      Number.isFinite(visit.from) &&
      Number.isFinite(visit.until) &&
      (visit.kind === "visit" || visit.kind === "note")
  );
  return { day, visits: visits.slice(0, MAX_VISITS_A_DAY) };
};

/** The candidates in a server answer, whatever its shape: an older server, or an answer gone wrong, is nobody. */
export const candidatesFrom = (answer: unknown): VisitorCandidate[] => {
  const rows = (answer as { visitors?: unknown } | null)?.visitors;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row) => {
    const entry = row as Partial<VisitorCandidate> | null;
    if (!entry || typeof entry.handle !== "string" || entry.handle.length === 0) {
      return [];
    }
    return [
      {
        handle: entry.handle,
        displayName: typeof entry.displayName === "string" ? entry.displayName : null,
        pipSeed: typeof entry.pipSeed === "string" ? entry.pipSeed : entry.handle,
        avatar: typeof entry.avatar === "string" ? entry.avatar : null,
        weekMinutes: Number.isFinite(entry.weekMinutes) ? Math.max(0, Number(entry.weekMinutes)) : 0,
        streak: Number.isFinite(entry.streak) ? Math.max(0, Math.trunc(Number(entry.streak))) : 0
      }
    ];
  });
};

// ---- asking the server -------------------------------------------------------------

/** The list of friends who read today is asked for again this often, while the Pip tab is open. */
export const ASK_EVERY_MS = 10 * 60_000;
/** A server with no such route (one deployed before visitors) is left alone this long. */
export const NO_ROUTE_QUIET_MS = 6 * 60 * 60_000;

/** No asking before this, after an answer: a list (ask as usual), "no such route", or a call that failed. */
export const quietAfter = (now: number, answered: "list" | "noRoute" | "failed") =>
  answered === "noRoute" ? now + NO_ROUTE_QUIET_MS : answered === "failed" ? now + ASK_EVERY_MS : 0;

/**
 * Whether to ask now: not while a call is out, not while the window is
 * hidden, not before `quietUntil`, and not while today's list is fresh.
 */
export const mayAsk = (
  now: number,
  day: string,
  listed: { day: string; at: number } | null,
  quietUntil: number,
  asking: boolean,
  hidden: boolean
) => !asking && !hidden && now >= quietUntil && !(listed !== null && listed.day === day && now - listed.at < ASK_EVERY_MS);

// ---- a visit, moment by moment ---------------------------------------------------

/** The knock, before anyone is seen. */
export const KNOCK_MS = 2600;
/** The wave on arriving and the wave goodbye: one loop of `welcome` each (36 frames at 12 a second). */
export const WAVE_MS = 3000;
/** As fast as Pip strolls, in floor pixels a second. */
export const VISITOR_SPEED = 22;

export type VisitPhase = "knock" | "walkIn" | "hello" | "read" | "goodbye" | "walkOut" | "gone";

/** How long each part of a visit lasts, in ms. `total` is the whole visit, knock to gone. */
export type VisitTimeline = { knock: number; walk: number; hello: number; read: number; goodbye: number; total: number };

/**
 * A visit of `total` ms with `distance` floor pixels between the door and the
 * place to stand. `still` (reduced motion) has no travel and no waving: a
 * knock, then the visitor is there reading, then gone. The reading takes
 * whatever the rest leaves; a visit too short for all of it loses its waves,
 * and one too short even to cross the floor at a stroll crosses it faster.
 */
export const visitTimeline = (total: number, distance: number, still = false): VisitTimeline => {
  const knock = Math.min(KNOCK_MS, total);
  if (still) {
    return { knock, walk: 0, hello: 0, read: total - knock, goodbye: 0, total };
  }
  const walk = Math.min(Math.round((Math.abs(distance) / VISITOR_SPEED) * 1000), Math.floor((total - knock) / 2));
  const waves = total - knock - 2 * walk >= 2 * WAVE_MS ? WAVE_MS : 0;
  return { knock, walk, hello: waves, read: Math.max(0, total - knock - 2 * walk - 2 * waves), goodbye: waves, total };
};

export type VisitPose = {
  phase: VisitPhase;
  /** Where the visitor's feet are, in floor pixels. */
  x: number;
  facing: 1 | -1;
  move: "walk" | "welcome" | "read" | "idle";
  /** In the room to be seen (not behind the door). */
  shown: boolean;
  /** Ms until this phase gives way to the next. */
  left: number;
};

/**
 * Where the visitor is `elapsed` ms into a visit: behind the door knocking,
 * walking in to the place to stand, waving, reading there, waving goodbye,
 * walking out. Sitting, the visitor faces `towards` (Pip, or the room).
 */
export const visitPose = (elapsed: number, timeline: VisitTimeline, doorX: number, spotX: number, towards = spotX + (spotX - doorX)): VisitPose => {
  const inward: 1 | -1 = spotX >= doorX ? 1 : -1;
  const company: 1 | -1 = towards === spotX ? inward : towards > spotX ? 1 : -1;
  const outward: 1 | -1 = inward === 1 ? -1 : 1;
  const stages: Array<[VisitPhase, number]> = [
    ["knock", timeline.knock],
    ["walkIn", timeline.walk],
    ["hello", timeline.hello],
    ["read", timeline.read],
    ["goodbye", timeline.goodbye],
    ["walkOut", timeline.walk]
  ];
  let start = 0;
  const time = Math.max(0, elapsed);
  for (const [phase, length] of stages) {
    if (length > 0 && time < start + length) {
      const done = (time - start) / length;
      const left = start + length - time;
      switch (phase) {
        case "knock":
          return { phase, x: doorX, facing: inward, move: "idle", shown: false, left };
        case "walkIn":
          return { phase, x: doorX + (spotX - doorX) * done, facing: inward, move: "walk", shown: true, left };
        case "walkOut":
          return { phase, x: spotX + (doorX - spotX) * done, facing: outward, move: "walk", shown: true, left };
        case "read":
          return { phase, x: spotX, facing: company, move: "read", shown: true, left };
        default:
          return { phase, x: spotX, facing: company, move: "welcome", shown: true, left };
      }
    }
    start += length;
  }
  return { phase: "gone", x: doorX, facing: outward, move: "idle", shown: false, left: 0 };
};

/** What the house should know of a visit: someone at the door, someone in the room, someone on the way out. */
export type VisitorPresence = "none" | "knocking" | "present" | "leaving";

export const presenceOf = (phase: VisitPhase | null): VisitorPresence =>
  phase === null || phase === "gone" ? "none" : phase === "knock" ? "knocking" : phase === "walkOut" ? "leaving" : "present";

/** Where the door is: just past one side wall, out of sight (the room clips there). */
export type Door = { x: number; side: "left" | "right" };

/** The door a room has when nobody says otherwise: beyond the right-hand wall. */
export const defaultDoor = (roomWidth: number): Door => ({ x: roomWidth + 18, side: "right" });

/**
 * A place for the visitor to stand: a little way in from the door, clear of
 * Pip and of whatever else is on the floor line (`taken`: left edge and
 * width, floor pixels). The first free place walking in from the door, or
 * the one that crowds the least.
 */
export const standAt = (roomWidth: number, door: Door, taken: ReadonlyArray<{ x: number; w: number }> = [], clear = 26) => {
  const inward = door.side === "right" ? -1 : 1;
  const wall = door.side === "right" ? roomWidth : 0;
  const crowding = (x: number) =>
    taken.reduce((worst, box) => {
      const nearest = Math.max(box.x, Math.min(x, box.x + box.w));
      return Math.max(worst, clear - Math.abs(x - nearest));
    }, 0);
  let best = wall + inward * 40;
  let least = Infinity;
  for (let offset = 40; offset <= Math.max(40, roomWidth - 40); offset += 12) {
    const x = wall + inward * offset;
    const crowd = crowding(x);
    if (crowd <= 0) {
      return x;
    }
    if (crowd < least) {
      least = crowd;
      best = x;
    }
  }
  return best;
};

/** What the door says while a friend knocks, and what a note left on it reads. */
export const knockLine = (handle: string) => `knock knock. it's @${handle}!`;
export const noteLine = (handle: string) => `@${handle} came by`;
