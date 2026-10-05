/**
 * Visitors, driven: asks the server which friends read today, keeps today's
 * visits, and says who (if anyone) is in Pip's house right now.
 *
 * The deciding is `visitors.ts`; this is the part with a clock, a store and
 * the network in it. `useVisitors(host)` is mounted while the Pip tab is open
 * (by `components/pip/Visitors.tsx`); anything else reads `useVisitorStore`.
 *
 * The server is asked only when there is something to ask for: community on,
 * signed in, the reader's own profile public, and a minute read today. Then
 * once, and again every ten minutes while the tab stays open and the window
 * is showing. A server from before visitors answers "no such route": taken
 * as nobody, shown as nothing, and not asked again for six hours. A failed
 * call keeps the list it had and waits the same ten minutes. Nothing here
 * ever retries in a loop.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { FEATURES } from "../constants/features";
import { useCommunityStore } from "../components/community/communityStore";
import { getDateKey } from "../services/habitService";
import { socialService } from "../services/socialService";
import { useAccountStore } from "../store/accountStore";
import { useHabitStore } from "../store/habitStore";
import { useLibraryStore } from "../store/libraryStore";
import {
  READ_TODAY_MINUTES,
  candidatesFrom,
  decideVisit,
  emptyLog,
  mayAsk,
  noteWaiting,
  parseLog,
  presenceOf,
  quietAfter,
  withVisit,
  type Host,
  type VisitLog,
  type VisitPhase,
  type VisitRecord,
  type VisitorCandidate,
  type VisitorPresence
} from "./visitors";

/** Today's visits (handle, from, until), on this device only. Removed by Delete All Data and at sign-out. */
export const VISITS_KEY = "leaflet.pip.visits";
/** How often the door is looked at. Deciding is a few comparisons. */
const LOOK_EVERY_MS = 5000;

/** A friend in the house, or the note they left: the day's record and who it is. */
export type Visit = { record: VisitRecord; visitor: VisitorCandidate };

type VisitorState = {
  /** The visit under way, if any. */
  visit: Visit | null;
  /** A note left while Pip was asleep or out, not yet read. */
  note: Visit | null;
  /** The part of the visit the room is showing, as `VisitorPip` reports it. */
  phase: VisitPhase | null;
  /** For Pip's planner: nobody, someone at the door, someone in the room, someone leaving. */
  presence: VisitorPresence;
  /** Where the visitor stands while in the room (floor pixels), for Pip to keep clear of and turn to. */
  standing: { x: number; w: number } | null;
  /** `VisitorPip` says where the visit has got to. */
  report: (phase: VisitPhase | null, x?: number) => void;
  /** The note has been read: it comes off the door. */
  readNote: () => void;
};

/** The friends the server last listed, for which day, and when; null until it has answered this run. */
let listed: { day: string; at: number; candidates: VisitorCandidate[] } | null = null;
/** No asking before this (a failed call, or a server without the route). */
let quietUntil = 0;
let asking = false;
/** Counts sign-outs and un-sharings, so an answer on its way for the reader who left lands nowhere. */
let epoch = 0;
let log: VisitLog | null = null;

const readLog = (day: string): VisitLog => {
  if (log && log.day === day) {
    return log;
  }
  try {
    const raw = localStorage.getItem(VISITS_KEY);
    log = parseLog(raw ? JSON.parse(raw) : null, day);
  } catch {
    log = emptyLog(day);
  }
  return log;
};

const writeLog = (next: VisitLog) => {
  log = next;
  try {
    localStorage.setItem(VISITS_KEY, JSON.stringify(next));
  } catch {
    // Remembered for this run only: a visit may then come again after a restart.
  }
};

const forgetLog = () => {
  log = null;
  try {
    localStorage.removeItem(VISITS_KEY);
  } catch {
    // Nothing kept, nothing to remove.
  }
};

const sameVisit = (a: Visit | null, b: Visit | null) =>
  a === b || (a !== null && b !== null && a.record.handle === b.record.handle && a.record.from === b.record.from && a.record.until === b.record.until && a.visitor === b.visitor);

export const useVisitorStore = create<VisitorState>((set, get) => ({
  visit: null,
  note: null,
  phase: null,
  presence: "none",
  standing: null,

  report(phase, x) {
    const presence = presenceOf(phase);
    // A sprite is 32 floor pixels wide, centred on its feet.
    const standing = presence === "present" && x !== undefined ? { x: x - 16, w: 32 } : null;
    const before = get();
    if (before.phase !== phase || before.standing?.x !== standing?.x) {
      set({ phase, presence, standing });
    }
  },

  readNote() {
    const { note } = get();
    if (!note) {
      return;
    }
    const day = getDateKey();
    writeLog(withVisit(readLog(day), { ...note.record, read: true }));
    set({ note: null });
  }
}));

const nobody = () => {
  const state = useVisitorStore.getState();
  if (state.visit || state.note || state.phase) {
    useVisitorStore.setState({ visit: null, note: null, phase: null, presence: "none", standing: null });
  }
};

/** Asks the server, if it is time to. Never throws. */
const ask = async () => {
  const day = getDateKey();
  if (!mayAsk(Date.now(), day, listed, quietUntil, asking, document.hidden)) {
    return;
  }
  asking = true;
  const asked = epoch;
  try {
    const answer = await socialService.visitors();
    if (asked !== epoch) {
      return;
    }
    if (answer === null) {
      // No such route on this server (or no server to ask, in the preview).
      quietUntil = quietAfter(Date.now(), "noRoute");
      listed = { day, at: Date.now(), candidates: [] };
      return;
    }
    quietUntil = quietAfter(Date.now(), "list");
    listed = { day, at: Date.now(), candidates: candidatesFrom(answer) };
  } catch {
    // Offline, or the session has ended (the community store hears of that
    // itself). What was listed before stands; no sooner than the usual wait.
    if (asked === epoch) {
      quietUntil = quietAfter(Date.now(), "failed");
    }
  } finally {
    asking = false;
  }
};

/** Looks at the door: starts, carries on or ends a visit, or pins a note. */
const look = (openedAt: number, todayMinutes: number, host: Host) => {
  const now = Date.now();
  const day = getDateKey();
  // Until the server has spoken for today there is nobody to show: a visit
  // begun before a restart waits for its friend to be listed again.
  if (!listed || listed.day !== day) {
    nobody();
    return;
  }
  const current = readLog(day);
  const decision = decideVisit({ day, now, openedAt, enabled: true, todayMinutes, candidates: listed.candidates, log: current, host });
  let visit: Visit | null = null;
  if (decision.kind === "start" || decision.kind === "note" || decision.kind === "end") {
    writeLog(withVisit(current, decision.record));
  }
  if (decision.kind === "start" || decision.kind === "visiting") {
    visit = { record: decision.record, visitor: decision.visitor };
  }
  const waiting = noteWaiting(readLog(day));
  const author = waiting ? listed.candidates.find((candidate) => candidate.handle === waiting.handle) : undefined;
  const note = waiting && author ? { record: waiting, visitor: author } : null;

  const before = useVisitorStore.getState();
  if (!sameVisit(before.visit, visit) || !sameVisit(before.note, note)) {
    useVisitorStore.setState(visit ? { visit, note } : { visit, note, phase: null, presence: "none", standing: null });
  }
};

/**
 * Runs the visits while mounted. `host` is how Pip is: at home, asleep, out,
 * or busy for a moment (see `Host`); a function is asked each time the door
 * is looked at.
 */
export const useVisitors = (host: Host | (() => Host)) => {
  const signedIn = useAccountStore((state) => state.status.signedIn);
  const accountKnown = useAccountStore((state) => state.loaded);
  const apiBase = useLibraryStore((state) => state.sync.apiBase);
  const me = useCommunityStore((state) => state.me);
  const todayMinutes = useHabitStore((state) => state.snapshot.todayMinutes);
  const possible = FEATURES.community && signedIn && Boolean(apiBase);
  const enabled = possible && me?.visibility === "public";
  const readToday = todayMinutes >= READ_TODAY_MINUTES;

  const live = useRef({ host, todayMinutes });
  live.current = { host, todayMinutes };

  // Whether the profile is shared is the community store's to know; it is
  // asked once if nothing has asked yet (the Social page usually has).
  useEffect(() => {
    if (possible && !useCommunityStore.getState().me) {
      void useCommunityStore.getState().loadMe();
    }
  }, [possible]);

  // Signed out: the day's visits were that reader's. (Not before the
  // account has been read: every start begins "signed out" for a moment.)
  useEffect(() => {
    if (accountKnown && !signedIn) {
      forgetLog();
    }
  }, [accountKnown, signedIn]);

  useEffect(() => {
    if (!enabled || !readToday) {
      epoch += 1;
      listed = null;
      nobody();
      return;
    }
    const openedAt = Date.now();
    let stopped = false;
    const step = () => {
      if (!stopped) {
        const how = live.current.host;
        look(openedAt, live.current.todayMinutes, typeof how === "function" ? how() : how);
      }
    };
    const refresh = () => void ask().then(step);
    refresh();
    const looking = window.setInterval(step, LOOK_EVERY_MS);
    const refreshing = window.setInterval(refresh, 60_000);
    const onVisible = () => {
      if (!document.hidden) {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(looking);
      window.clearInterval(refreshing);
      document.removeEventListener("visibilitychange", onVisible);
      // The tab is left: nobody is being shown, though a visit under way
      // carries on by the clock and is there again on coming back.
      nobody();
    };
  }, [enabled, readToday]);
};

/**
 * For the preview and for tests of the room, where there is no server: puts a
 * visitor in the house (or a note on the door) without asking anyone. Development builds only.
 */
export const stubVisit = (visitor: VisitorCandidate, stayMs: number, kind: VisitRecord["kind"] = "visit", from = Date.now()) => {
  if (!import.meta.env.DEV) {
    return;
  }
  const record: VisitRecord = { handle: visitor.handle, from, until: kind === "note" ? from : from + stayMs, kind };
  useVisitorStore.setState(
    kind === "note" ? { note: { record, visitor } } : { visit: { record, visitor }, phase: null, presence: "none", standing: null }
  );
};
