import { describe, expect, it } from "vitest";
import {
  ASK_EVERY_MS,
  BETWEEN_VISITS_MS,
  FIRST_KNOCK_MS,
  KNOCK_MS,
  MAX_VISITS_A_DAY,
  NO_ROUTE_QUIET_MS,
  VISIT_MS,
  VISITOR_SPEED,
  WAVE_MS,
  candidatesFrom,
  decideVisit,
  defaultDoor,
  emptyLog,
  hostOf,
  knockLine,
  logFor,
  mayAsk,
  nextKnockAt,
  noteLine,
  noteWaiting,
  parseLog,
  presenceOf,
  quietAfter,
  seeded,
  standAt,
  visitPose,
  visitTimeline,
  visitUnderWay,
  visitingOrder,
  withVisit,
  type Host,
  type VisitInput,
  type VisitLog,
  type VisitorCandidate
} from "./visitors";

const DAY = "2026-10-04";
const OPENED = Date.UTC(2026, 9, 4, 15, 0, 0);
const MINUTE = 60_000;

const friend = (handle: string, extra: Partial<VisitorCandidate> = {}): VisitorCandidate => ({
  handle,
  displayName: null,
  pipSeed: handle,
  avatar: null,
  weekMinutes: 60,
  streak: 3,
  ...extra
});

const MAYA = friend("maya", { avatar: "wizard.magic", weekMinutes: 95, streak: 7 });
const FRIENDS = [MAYA, friend("bo"), friend("ines"), friend("tariq")];

const input = (over: Partial<VisitInput> = {}): VisitInput => ({
  day: DAY,
  now: OPENED,
  openedAt: OPENED,
  enabled: true,
  todayMinutes: 12,
  candidates: FRIENDS,
  log: emptyLog(DAY),
  host: "home",
  ...over
});

/** Walks the day forward: decides, keeps what was decided, and jumps to whenever it says to look again. */
const live = (over: Partial<VisitInput>, until: number, hostAt: (now: number) => Host = () => "home") => {
  let log: VisitLog = over.log ?? emptyLog(DAY);
  let now = over.now ?? OPENED;
  const seen: Array<{ kind: string; handle: string; from: number; until: number }> = [];
  for (let guard = 0; guard < 500 && now <= until; guard += 1) {
    const decision = decideVisit(input({ ...over, now, log, host: hostAt(now) }));
    if (decision.kind === "start" || decision.kind === "note") {
      log = withVisit(log, decision.record);
      seen.push({ kind: decision.kind, handle: decision.record.handle, from: decision.record.from, until: decision.record.until });
      now = decision.record.until + 1;
    } else if (decision.kind === "wait") {
      now = decision.at;
    } else if (decision.kind === "visiting") {
      now = decision.record.until;
    } else {
      break;
    }
  }
  return { log, seen };
};

describe("whether a friend's Pip comes by", () => {
  it("only when community is on, the reader has read today, and a friend has too", () => {
    expect(decideVisit(input({ enabled: false }))).toEqual({ kind: "none", why: "off" });
    expect(decideVisit(input({ todayMinutes: 0 }))).toEqual({ kind: "none", why: "notRead" });
    // A glance at a page is not a day read (the same minute the app publishes by).
    expect(decideVisit(input({ todayMinutes: 0.6 }))).toEqual({ kind: "none", why: "notRead" });
    expect(decideVisit(input({ candidates: [] }))).toEqual({ kind: "none", why: "nobody" });
    // Off wins over everything, a visit under way included.
    const under = withVisit(emptyLog(DAY), { handle: "maya", from: OPENED - MINUTE, until: OPENED + MINUTE, kind: "visit" });
    expect(decideVisit(input({ enabled: false, log: under })).kind).toBe("none");
  });

  it("knocks a little after the tab opens, not at once", () => {
    const first = decideVisit(input());
    expect(first.kind).toBe("wait");
    const at = first.kind === "wait" ? first.at : 0;
    expect(at - OPENED).toBeGreaterThanOrEqual(FIRST_KNOCK_MS[0]);
    expect(at - OPENED).toBeLessThanOrEqual(FIRST_KNOCK_MS[1]);
    expect(decideVisit(input({ now: at - 1 })).kind).toBe("wait");

    const knock = decideVisit(input({ now: at }));
    expect(knock.kind).toBe("start");
    if (knock.kind !== "start") return;
    expect(knock.record.from).toBe(at);
    const stay = knock.record.until - knock.record.from;
    expect(stay).toBeGreaterThanOrEqual(VISIT_MS[0]);
    expect(stay).toBeLessThanOrEqual(VISIT_MS[1]);
    expect(FRIENDS).toContain(knock.visitor);
  });

  it("is the same visit however often it is asked: seeded by the date", () => {
    const at = nextKnockAt(DAY, emptyLog(DAY), OPENED);
    const a = decideVisit(input({ now: at }));
    // The server's list comes back in another order, with another friend on it.
    const b = decideVisit(input({ now: at, candidates: [friend("zed"), ...[...FRIENDS].reverse()] }));
    expect(a.kind).toBe("start");
    expect(b.kind).toBe("start");
    if (a.kind !== "start" || b.kind !== "start") return;
    const order = visitingOrder(DAY, [friend("zed"), ...FRIENDS]).map((c) => c.handle);
    expect(b.visitor.handle).toBe(order[0]);
    expect(visitingOrder(DAY, FRIENDS).map((c) => c.handle)).toEqual(order.filter((handle) => handle !== "zed"));
    // Another day, another order (for some day in a fortnight).
    const days = Array.from({ length: 14 }, (_, index) => `2026-10-${String(index + 5).padStart(2, "0")}`);
    expect(days.some((day) => visitingOrder(day, FRIENDS)[0].handle !== visitingOrder(DAY, FRIENDS)[0].handle)).toBe(true);
    // And the order is not by minutes: the busiest reader is not always first.
    const ranked = [...FRIENDS].sort((x, y) => y.weekMinutes - x.weekMinutes)[0].handle;
    expect(days.some((day) => visitingOrder(day, FRIENDS)[0].handle !== ranked)).toBe(true);
    expect(seeded("a", 1)).toBe(seeded("a", 1));
    expect(seeded("a", 1)).not.toBe(seeded("a", 2));
  });

  it("one visitor at a time, and a visit under way carries on across refreshes", () => {
    const at = nextKnockAt(DAY, emptyLog(DAY), OPENED);
    const knock = decideVisit(input({ now: at }));
    if (knock.kind !== "start") throw new Error("no knock");
    const log = withVisit(emptyLog(DAY), knock.record);
    // Asked again a minute in, with the tab reopened and the list reordered: the same visit.
    const again = decideVisit(input({ now: at + MINUTE, openedAt: at + 50_000, log, candidates: [...FRIENDS].reverse() }));
    expect(again).toEqual({ kind: "visiting", record: knock.record, visitor: knock.visitor });
    expect(visitUnderWay(log, at + MINUTE)).toEqual(knock.record);
    expect(visitUnderWay(log, knock.record.until)).toBeNull();
    // Pip dozing off mid-visit does not throw the visitor out.
    expect(decideVisit(input({ now: at + MINUTE, log, host: "asleep" })).kind).toBe("visiting");
  });

  it("ends a visit at once when the server no longer lists the friend", () => {
    const at = nextKnockAt(DAY, emptyLog(DAY), OPENED);
    const knock = decideVisit(input({ now: at }));
    if (knock.kind !== "start") throw new Error("no knock");
    const log = withVisit(emptyLog(DAY), knock.record);
    const without = FRIENDS.filter((candidate) => candidate.handle !== knock.visitor.handle);
    const gone = decideVisit(input({ now: at + MINUTE, log, candidates: without }));
    expect(gone).toEqual({ kind: "end", record: { ...knock.record, until: at + MINUTE } });
    // Kept, the cut-short visit still counts as one of the day's, and is over.
    const cut = withVisit(log, gone.kind === "end" ? gone.record : knock.record);
    expect(cut.visits).toHaveLength(1);
    expect(visitUnderWay(cut, at + MINUTE)).toBeNull();
  });

  it("a few visits a day, a friend once, with a quiet door between", () => {
    const { seen } = live({}, OPENED + 12 * 60 * MINUTE);
    expect(seen).toHaveLength(MAX_VISITS_A_DAY);
    expect(new Set(seen.map((visit) => visit.handle)).size).toBe(MAX_VISITS_A_DAY);
    expect(seen.every((visit) => visit.kind === "start")).toBe(true);
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index].from - seen[index - 1].until).toBeGreaterThanOrEqual(BETWEEN_VISITS_MS);
      expect(seen[index].from - seen[index - 1].until).toBeLessThanOrEqual(BETWEEN_VISITS_MS + 10 * MINUTE + 1);
    }
    // With two friends, two visits: nobody comes twice.
    expect(live({ candidates: FRIENDS.slice(0, 2) }, OPENED + 12 * 60 * MINUTE).seen).toHaveLength(2);
    // After the day's visits, nobody.
    const full = live({}, OPENED + 12 * 60 * MINUTE).log;
    expect(decideVisit(input({ now: OPENED + 13 * 60 * MINUTE, log: full }))).toEqual({ kind: "none", why: "enough" });
  });

  it("reopening the tab does not bring a knock before the door has been quiet long enough", () => {
    const first = live({}, OPENED + 6 * MINUTE);
    expect(first.seen).toHaveLength(1);
    const reopened = first.seen[0].until + 2 * MINUTE;
    const decision = decideVisit(input({ now: reopened + 2 * MINUTE, openedAt: reopened, log: first.log }));
    expect(decision.kind).toBe("wait");
    if (decision.kind === "wait") {
      expect(decision.at).toBeGreaterThanOrEqual(first.seen[0].until + BETWEEN_VISITS_MS);
    }
  });

  it("leaves a note, once, when Pip is asleep or out; and waits a moment when she is busy", () => {
    const at = nextKnockAt(DAY, emptyLog(DAY), OPENED);
    for (const host of ["asleep", "out"] as const) {
      const decision = decideVisit(input({ now: at, host }));
      expect(decision.kind).toBe("note");
      if (decision.kind !== "note") continue;
      expect(decision.record).toEqual({ handle: decision.visitor.handle, from: at, until: at, kind: "note" });
      expect(noteLine(decision.visitor.handle)).toBe(`@${decision.visitor.handle} came by`);
    }
    // Held, or the room being decorated: the knock is only put off.
    const busy = decideVisit(input({ now: at, host: "busy" }));
    expect(busy.kind).toBe("wait");
    expect(busy.kind === "wait" && busy.at).toBeGreaterThan(at);

    // Asleep all evening: one note, never a visitor, and no second note.
    const night = live({}, OPENED + 4 * 60 * MINUTE, () => "asleep");
    expect(night.seen.map((visit) => visit.kind)).toEqual(["note"]);
    expect(noteWaiting(night.log)?.handle).toBe(night.seen[0].handle);
    expect(visitUnderWay(night.log, night.seen[0].from)).toBeNull();
    // She wakes: the other friends still come, and the one who left a note does not come twice.
    const woken = live({ log: night.log, now: OPENED + 4 * 60 * MINUTE }, OPENED + 12 * 60 * MINUTE);
    expect(woken.seen.map((visit) => visit.kind)).toEqual(["start", "start"]);
    expect(woken.seen.map((visit) => visit.handle)).not.toContain(night.seen[0].handle);
    // Read, the note is off the door.
    const read = withVisit(night.log, { ...night.log.visits[0], read: true });
    expect(noteWaiting(read)).toBeNull();
    expect(read.visits).toHaveLength(1);
  });

  it("reads how Pip is from what the house says of her", () => {
    expect(hostOf(null)).toBe("home");
    expect(hostOf({ phase: "rest" })).toBe("home");
    expect(hostOf({ phase: "doing", away: false })).toBe("home");
    expect(hostOf({ phase: "sleep" })).toBe("asleep");
    expect(hostOf({ phase: "tuck" })).toBe("asleep");
    expect(hostOf({ phase: "rest", away: true })).toBe("out");
    expect(hostOf({ phase: "held" })).toBe("busy");
    expect(hostOf({ phase: "rest" }, true)).toBe("busy");
    // Asleep or out is said before busy: a note is left rather than a knock put off all night.
    expect(hostOf({ phase: "sleep" }, true)).toBe("asleep");
  });

  it("starts each day with a clean log, and reads back only what it wrote", () => {
    const yesterday: VisitLog = { day: "2026-10-03", visits: [{ handle: "maya", from: 1, until: 2, kind: "visit" }] };
    expect(logFor(yesterday, DAY)).toEqual(emptyLog(DAY));
    expect(logFor(null, DAY)).toEqual(emptyLog(DAY));
    expect(decideVisit(input({ log: yesterday })).kind).toBe("wait");
    expect(parseLog(JSON.parse(JSON.stringify(yesterday)), DAY)).toEqual(emptyLog(DAY));
    expect(parseLog(null, DAY)).toEqual(emptyLog(DAY));
    expect(parseLog("nonsense", DAY)).toEqual(emptyLog(DAY));
    const messy = { day: DAY, visits: [{ handle: "maya", from: 5, until: 9, kind: "visit" }, null, { handle: 3 }, { handle: "bo", from: "x", until: 2, kind: "note" }, { handle: "bo", from: 1, until: 2, kind: "party" }] };
    expect(parseLog(messy, DAY)).toEqual({ day: DAY, visits: [{ handle: "maya", from: 5, until: 9, kind: "visit" }] });
  });

  it("takes nobody from an answer that is not a list of friends", () => {
    expect(candidatesFrom(null)).toEqual([]);
    expect(candidatesFrom({})).toEqual([]);
    expect(candidatesFrom({ error: "Not found." })).toEqual([]);
    expect(candidatesFrom({ visitors: "maya" })).toEqual([]);
    expect(candidatesFrom({ visitors: [null, {}, { handle: "" }, { handle: "maya", avatar: "wizard.magic", weekMinutes: 95.4, streak: 7.9, displayName: "Maya", pipSeed: "maya", email: "no" }, { handle: "bo", weekMinutes: "lots", streak: -4 }] })).toEqual([
      { handle: "maya", displayName: "Maya", pipSeed: "maya", avatar: "wizard.magic", weekMinutes: 95.4, streak: 7 },
      { handle: "bo", displayName: null, pipSeed: "bo", avatar: null, weekMinutes: 0, streak: 0 }
    ]);
  });
});

describe("asking the server who read today", () => {
  const NOW = OPENED;

  it("asks once, then every ten minutes, and again when the day turns", () => {
    expect(mayAsk(NOW, DAY, null, 0, false, false)).toBe(true);
    const listed = { day: DAY, at: NOW };
    expect(mayAsk(NOW + 1000, DAY, listed, 0, false, false)).toBe(false);
    expect(mayAsk(NOW + ASK_EVERY_MS - 1, DAY, listed, 0, false, false)).toBe(false);
    expect(mayAsk(NOW + ASK_EVERY_MS, DAY, listed, 0, false, false)).toBe(true);
    expect(mayAsk(NOW + 1000, "2026-10-05", listed, 0, false, false)).toBe(true);
  });

  it("never while a call is out or the window is hidden", () => {
    expect(mayAsk(NOW, DAY, null, 0, true, false)).toBe(false);
    expect(mayAsk(NOW, DAY, null, 0, false, true)).toBe(false);
  });

  it("leaves a server without the route alone for hours, and a failed call for the usual wait: no loop", () => {
    // Today's deployed server answers "no such route": nobody visits, and it is not asked again for six hours.
    const noRoute = quietAfter(NOW, "noRoute");
    expect(noRoute - NOW).toBe(NO_ROUTE_QUIET_MS);
    const empty = { day: DAY, at: NOW };
    for (const later of [1000, ASK_EVERY_MS, 60 * 60_000, NO_ROUTE_QUIET_MS - 1]) {
      expect(mayAsk(NOW + later, DAY, empty, noRoute, false, false)).toBe(false);
    }
    expect(mayAsk(NOW + NO_ROUTE_QUIET_MS, DAY, empty, noRoute, false, false)).toBe(true);
    // Not even a new day brings the question sooner.
    expect(mayAsk(NOW + 60_000, "2026-10-05", empty, noRoute, false, false)).toBe(false);

    const failed = quietAfter(NOW, "failed");
    expect(mayAsk(NOW + 5000, DAY, null, failed, false, false)).toBe(false);
    expect(mayAsk(NOW + ASK_EVERY_MS, DAY, null, failed, false, false)).toBe(true);
    expect(quietAfter(NOW, "list")).toBe(0);
  });
});

describe("a visit, moment by moment", () => {
  const DOOR = 258;
  const SPOT = 192;
  const TOTAL = 4 * MINUTE;
  const timeline = visitTimeline(TOTAL, DOOR - SPOT);

  it("is a knock, a walk in, a wave, a long read, a wave and a walk out, and adds up", () => {
    expect(timeline.knock).toBe(KNOCK_MS);
    expect(timeline.walk).toBe(Math.round(((DOOR - SPOT) / VISITOR_SPEED) * 1000));
    expect(timeline.hello).toBe(WAVE_MS);
    expect(timeline.goodbye).toBe(WAVE_MS);
    expect(timeline.knock + 2 * timeline.walk + timeline.hello + timeline.read + timeline.goodbye).toBe(TOTAL);
    expect(timeline.read).toBeGreaterThan(3 * MINUTE);

    const at = (elapsed: number) => visitPose(elapsed, timeline, DOOR, SPOT, 120);
    expect(at(0)).toMatchObject({ phase: "knock", shown: false, x: DOOR, left: KNOCK_MS });
    expect(at(KNOCK_MS - 1).phase).toBe("knock");

    const walkingIn = at(KNOCK_MS + timeline.walk / 2);
    expect(walkingIn).toMatchObject({ phase: "walkIn", move: "walk", shown: true, facing: -1 });
    expect(walkingIn.x).toBeCloseTo((DOOR + SPOT) / 2, 1);
    expect(at(KNOCK_MS).x).toBe(DOOR);

    const arrived = KNOCK_MS + timeline.walk;
    expect(at(arrived)).toMatchObject({ phase: "hello", move: "welcome", x: SPOT, left: WAVE_MS });
    expect(at(arrived + WAVE_MS)).toMatchObject({ phase: "read", move: "read", x: SPOT, facing: -1 });
    expect(at(arrived + WAVE_MS + timeline.read - 1).phase).toBe("read");
    expect(at(arrived + WAVE_MS + timeline.read)).toMatchObject({ phase: "goodbye", move: "welcome" });

    const walkingOut = at(TOTAL - timeline.walk / 2);
    expect(walkingOut).toMatchObject({ phase: "walkOut", move: "walk", facing: 1 });
    expect(walkingOut.x).toBeCloseTo((DOOR + SPOT) / 2, 1);
    expect(at(TOTAL)).toMatchObject({ phase: "gone", shown: false, left: 0 });
    expect(at(TOTAL + MINUTE).phase).toBe("gone");
    expect(at(-50).phase).toBe("knock");
  });

  it("never goes backwards, and every phase comes once, in order", () => {
    const phases: string[] = [];
    let lastIn = Infinity;
    for (let elapsed = 0; elapsed <= TOTAL; elapsed += 250) {
      const pose = visitPose(elapsed, timeline, DOOR, SPOT);
      if (phases[phases.length - 1] !== pose.phase) phases.push(pose.phase);
      if (pose.phase === "walkIn") {
        expect(pose.x).toBeLessThanOrEqual(lastIn);
        lastIn = pose.x;
      }
      expect(pose.x).toBeGreaterThanOrEqual(SPOT);
      expect(pose.x).toBeLessThanOrEqual(DOOR);
    }
    expect(phases).toEqual(["knock", "walkIn", "hello", "read", "goodbye", "walkOut", "gone"]);
  });

  it("faces Pip while it sits, wherever she is, and the room when nobody says", () => {
    const reading = KNOCK_MS + timeline.walk + WAVE_MS + 1000;
    expect(visitPose(reading, timeline, DOOR, SPOT, 60).facing).toBe(-1);
    expect(visitPose(reading, timeline, DOOR, SPOT, 230).facing).toBe(1);
    expect(visitPose(reading, timeline, DOOR, SPOT).facing).toBe(-1);
    // A door on the left: in to the right, out to the left.
    const left = visitTimeline(TOTAL, 70);
    expect(visitPose(KNOCK_MS + 100, left, -18, 52).facing).toBe(1);
    expect(visitPose(TOTAL - 100, left, -18, 52).facing).toBe(-1);
    expect(visitPose(reading, left, -18, 52).facing).toBe(1);
  });

  it("holds still under reduced motion: a knock, then there, then gone", () => {
    const still = visitTimeline(TOTAL, DOOR - SPOT, true);
    expect(still).toEqual({ knock: KNOCK_MS, walk: 0, hello: 0, read: TOTAL - KNOCK_MS, goodbye: 0, total: TOTAL });
    const phases = new Set<string>();
    for (let elapsed = 0; elapsed <= TOTAL; elapsed += 500) {
      const pose = visitPose(elapsed, still, DOOR, SPOT);
      phases.add(pose.phase);
      if (pose.shown) {
        expect(pose.x).toBe(SPOT);
        expect(pose.move).toBe("read");
      }
    }
    expect([...phases]).toEqual(["knock", "read", "gone"]);
  });

  it("drops the waves from a visit too short for them, and still adds up", () => {
    const short = visitTimeline(12_000, 66);
    expect(short.hello).toBe(0);
    expect(short.goodbye).toBe(0);
    expect(short.knock + 2 * short.walk + short.read).toBe(12_000);
    expect(visitTimeline(1000, 66).knock).toBe(1000);
    // Too short even to stroll in and out: it hurries, and is gone on time.
    const rushed = visitTimeline(5000, 106);
    expect(rushed).toEqual({ knock: KNOCK_MS, walk: 1200, hello: 0, read: 0, goodbye: 0, total: 5000 });
    expect(visitPose(4999, rushed, 258, 152).phase).toBe("walkOut");
    expect(visitPose(5000, rushed, 258, 152).phase).toBe("gone");
  });

  it("tells the house who is at the door, in the room, on the way out", () => {
    expect(presenceOf(null)).toBe("none");
    expect(presenceOf("knock")).toBe("knocking");
    for (const phase of ["walkIn", "hello", "read", "goodbye"] as const) {
      expect(presenceOf(phase)).toBe("present");
    }
    expect(presenceOf("walkOut")).toBe("leaving");
    expect(presenceOf("gone")).toBe("none");
    expect(knockLine("maya")).toBe("knock knock. it's @maya!");
  });
});

describe("a place to stand", () => {
  it("is a little way in from the door, on its side of the room", () => {
    expect(defaultDoor(240)).toEqual({ x: 258, side: "right" });
    expect(standAt(240, defaultDoor(240))).toBe(200);
    expect(standAt(240, { x: -18, side: "left" })).toBe(40);
  });

  it("keeps clear of Pip and of what stands on the floor", () => {
    // Pip is right where the visitor would stand: further in.
    const beside = standAt(240, defaultDoor(240), [{ x: 184, w: 32 }]);
    expect(beside).toBeLessThan(184 - 20);
    expect(beside).toBeGreaterThan(40);
    // A crowded floor: the least crowded place, still inside the room.
    const crowded = standAt(240, defaultDoor(240), [{ x: 0, w: 240 }]);
    expect(crowded).toBeGreaterThanOrEqual(40);
    expect(crowded).toBeLessThanOrEqual(200);
  });
});
