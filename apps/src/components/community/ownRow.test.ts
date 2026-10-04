import { describe, expect, it } from "vitest";
import type { BoardEntry } from "../../services/socialService";
import { BOARD_SIZE, aheadOf, emptyBoardText, ownCaption, ownRow, weekKeyOf, weekMinutesOf, weekStartKey, type OwnInputs } from "./ownRow";

/** Saturday 3 October 2026, the day of the report: the week is Mon 28 Sep to Sun 4 Oct. */
const SATURDAY = new Date(2026, 9, 3, 17, 0);

const entry = (handle: string, weekMinutes: number, rank: number, over: Partial<BoardEntry> = {}): BoardEntry => ({
  handle,
  displayName: null,
  pipSeed: handle,
  avatar: null,
  rank,
  weekMinutes,
  streak: 0,
  booksFinished: 0,
  isYou: false,
  ...over
});

const board = (entries: BoardEntry[], you: BoardEntry | null = null) => ({ entries, you });

/** The reporter: signed in, a profile never shared, two hours read this week. */
const reader = (over: Partial<OwnInputs> = {}): OwnInputs => ({
  signedIn: true,
  scope: "everyone",
  board: board([]),
  profile: { handle: null, displayName: null, visibility: "private" },
  account: { displayName: "Adi", avatar: "wizard.magic" },
  weekMinutes: 135,
  streak: 4,
  ...over
});

describe("this week's minutes", () => {
  it("starts on the local Monday", () => {
    expect(weekStartKey(SATURDAY)).toBe("2026-09-28");
    expect(weekStartKey(new Date(2026, 9, 5, 0, 1))).toBe("2026-10-05");
    // Sunday night still belongs to the week that began six days before.
    expect(weekStartKey(new Date(2026, 9, 4, 23, 59))).toBe("2026-09-28");
  });

  it("sums the ledger from Monday to Sunday, and nothing either side", () => {
    const days = [
      { dateKey: "2026-09-27", minutes: 60 }, // last week's Sunday
      { dateKey: "2026-09-28", minutes: 30 },
      { dateKey: "2026-10-02", minutes: 95.5 }, // "I read a lot yesterday", no session running
      { dateKey: "2026-10-03", minutes: 12 },
      { dateKey: "2026-10-05", minutes: 40 } // next week's Monday
    ];
    expect(weekMinutesOf(days, SATURDAY)).toBe(137.5);
    // Monday morning: a new week, and the board starts from nothing.
    expect(weekMinutesOf(days.slice(0, 4), new Date(2026, 9, 5, 8, 0))).toBe(0);
    expect(weekMinutesOf([], SATURDAY)).toBe(0);
  });
});

describe("the week the board is asked for", () => {
  it("is the ISO week of the reader's own calendar, as Rust names it", () => {
    expect(weekKeyOf(SATURDAY)).toBe("2026-W40");
    // Sunday night is still this week; a minute past midnight is the next.
    expect(weekKeyOf(new Date(2026, 9, 4, 23, 59))).toBe("2026-W40");
    expect(weekKeyOf(new Date(2026, 9, 5, 0, 1))).toBe("2026-W41");
    // The turn of the year belongs to the year holding that week's Thursday
    // (the same dates `iso_week_keys_follow_the_local_date` checks in Rust).
    expect(weekKeyOf(new Date(2026, 11, 31, 12, 0))).toBe("2026-W53");
    expect(weekKeyOf(new Date(2027, 0, 3, 12, 0))).toBe("2026-W53");
    expect(weekKeyOf(new Date(2027, 0, 4, 12, 0))).toBe("2027-W01");
    expect(weekKeyOf(new Date(2025, 11, 29, 12, 0))).toBe("2026-W01");
    // Across a clock change (late March and late October in much of the world).
    expect(weekKeyOf(new Date(2026, 2, 29, 12, 0))).toBe("2026-W13");
    expect(weekKeyOf(new Date(2026, 9, 26, 12, 0))).toBe("2026-W44");
  });
});

describe("the reader's own row", () => {
  it("claims no place among another week's rows", () => {
    const others = [entry("maya", 300, 1), entry("omar", 20, 2)];
    const sameWeek = ownRow(reader({ weekKey: "2026-W40", board: { ...board(others), weekKey: "2026-W40" } }));
    expect(sameWeek?.rank).toBe(2);
    // This computer's date is a month out, so the server answered for its
    // own week; or the board on screen is last week's, a minute into Monday.
    const otherWeek = ownRow(reader({ weekKey: "2026-W44", board: { ...board(others), weekKey: "2026-W40" } }));
    expect(otherWeek).toMatchObject({ kind: "private", weekMinutes: 135, rank: null });
    expect(ownCaption(otherWeek!)).toBe("Only you can see this. Share your profile to be on the board.");
  });

  it("is there for a reader who has not shared, on an empty board", () => {
    const row = ownRow(reader());
    expect(row).toMatchObject({ kind: "private", weekMinutes: 135, streak: 4, rank: 1, entry: null });
    // Named and drawn from the account: no handle is needed to see yourself.
    expect(row).toMatchObject({ displayName: "Adi", avatar: "wizard.magic", handle: null });
    expect(ownCaption(row!)).toBe("Only you can see this. You'd be #1 if you shared your profile.");
  });

  it("is nobody's when signed out", () => {
    expect(ownRow(reader({ signedIn: false }))).toBeNull();
  });

  it("is the server's row once the profile is shared", () => {
    const you = entry("adi", 135, 2, { isYou: true, displayName: "Adi" });
    const row = ownRow(reader({ board: board([entry("maya", 300, 1), you], you) }));
    expect(row).toMatchObject({ kind: "shared", rank: 2, weekMinutes: 135, entry: you });
    expect(ownCaption(row!)).toBeNull();
    // An older server marks the row in the list without a separate `you`.
    expect(ownRow(reader({ board: board([you]) }))?.kind).toBe("shared");
  });

  it("is not drawn a second time when the board lists the reader without marking them", () => {
    // The board was fetched without the session: before signing in, or after
    // the session ended on the server. Adi shares, so Adi is on it, as anyone.
    const unmarked = entry("adi", 135, 2, { displayName: "Adi" });
    const row = ownRow(
      reader({ board: board([entry("maya", 300, 1), unmarked]), profile: { handle: "adi", displayName: "Adi", visibility: "public" } })
    );
    // One row, the server's: not a second "on its way" row beside it.
    expect(row).toMatchObject({ kind: "shared", rank: 2, entry: unmarked });
    // Somebody else's handle is somebody else's row.
    expect(ownRow(reader({ board: board([unmarked]), profile: { handle: "ada", displayName: null, visibility: "public" } }))?.kind).toBe("waiting");
    expect(ownRow(reader({ board: board([unmarked]) }))?.kind).toBe("private");
  });

  it("stands where its minutes would, among the readers who share", () => {
    const others = [entry("maya", 300, 1), entry("noor", 135, 2, { streak: 9 }), entry("omar", 20, 3)];
    const row = ownRow(reader({ board: board(others), profile: { handle: "adi", displayName: null, visibility: "private" } }));
    // Behind maya, and behind noor on streak; ahead of omar.
    expect(row?.rank).toBe(3);
    expect(aheadOf(others, { weekMinutes: 135, streak: 9, handle: "adi" })).toBe(1);
    // With no handle yet, a full tie goes to the reader who has one.
    expect(aheadOf(others, { weekMinutes: 135, streak: 9, handle: null })).toBe(2);
  });

  it("claims no rank it cannot know", () => {
    // Nothing read: Everyone lists only readers with minutes this week.
    const idle = ownRow(reader({ weekMinutes: 0.2 }));
    expect(idle).toMatchObject({ kind: "private", rank: null });
    expect(ownCaption(idle!)).toBe("Only you can see this. Share your profile to be on the board.");
    // Following lists zeros, so there it has a place.
    expect(ownRow(reader({ weekMinutes: 0, scope: "following" }))?.rank).toBe(1);
    // The board did not load: there is nothing to stand among.
    expect(ownRow(reader({ board: null }))).toMatchObject({ kind: "private", weekMinutes: 135, rank: null });
    // Behind all hundred rows of a full board: somewhere past the end.
    const full = Array.from({ length: BOARD_SIZE }, (_, index) => entry(`r${index}`, 500 - index, index + 1));
    expect(ownRow(reader({ board: board(full) }))?.rank).toBeNull();
    expect(ownRow(reader({ board: board(full), weekMinutes: 480 }))?.rank).toBe(21);
  });

  it("says when a shared reader's minutes have not reached the server", () => {
    const shared = reader({ profile: { handle: "adi", displayName: "Adi", visibility: "public" } });
    const row = ownRow(shared);
    expect(row).toMatchObject({ kind: "waiting", weekMinutes: 135, pipSeed: "adi" });
    expect(ownCaption(row!)).toBe("Not on the board yet: your minutes are on their way.");
    expect(ownCaption(row!, "Could not reach the Leaflet server. Check your connection.")).toBe(
      "Not on the board yet: your minutes couldn't be sent. Could not reach the Leaflet server. Check your connection."
    );
    const idle = ownRow({ ...shared, weekMinutes: 0 });
    expect(ownCaption(idle!, "ignored when there is nothing to send")).toBe(
      "Nothing read yet this week. A few minutes and you're on the board."
    );
    // The board itself did not load: they may well be on it, so it does not say they are not.
    expect(ownRow({ ...shared, board: null })).toMatchObject({ kind: "unknown", weekMinutes: 135, rank: null });
  });

  it("does not call a profile private when it could not be read", () => {
    const row = ownRow(reader({ profile: null }));
    expect(row?.kind).toBe("unknown");
    expect(ownCaption(row!)).toBe("Your reading this week, from this device.");
    // "Public" with no handle is not shared with anyone.
    expect(ownRow(reader({ profile: { handle: null, displayName: null, visibility: "public" } }))?.kind).toBe("private");
  });
});

describe("an empty board", () => {
  const everyone = { scope: "everyone", signedIn: true } as const;

  it("says nobody shares yet, and that friends appear once they do", () => {
    // The report: a private reader, a friend who has just signed up, no shared profiles at all.
    const text = emptyBoardText({ ...everyone, sharing: false, sharedReaders: 0 });
    expect(text).toMatch(/^Nobody has shared a profile yet/);
    expect(text).toMatch(/friends appear once their profiles are shared/);
    // True of an old private account and of a new one that is shared from the start.
    expect(text).not.toMatch(/turn on sharing/);
    expect(text).not.toMatch(/A few minutes of reading and you're first/);
  });

  it("tells 'nobody shares' from 'nobody has read yet this week'", () => {
    expect(emptyBoardText({ ...everyone, sharing: true, sharedReaders: 4 })).toBe(
      "4 readers share their profile, and nobody has read yet this week. A few minutes of reading and you're first."
    );
    expect(emptyBoardText({ ...everyone, sharing: true, sharedReaders: 1 })).toBe(
      "You're the only reader sharing a profile so far. A few minutes of reading and you're first."
    );
    const unshared = emptyBoardText({ ...everyone, sharing: false, sharedReaders: 1 });
    expect(unshared).toMatch(/^One reader shares their profile, and nobody has read yet this week\./);
    expect(unshared).toMatch(/you and your friends appear here once your profiles are shared/);
  });

  it("never promises a place for reading alone to a reader who is not sharing", () => {
    for (const sharedReaders of [undefined, null, 0, 1, 12]) {
      for (const sharing of [false, null]) {
        expect(emptyBoardText({ ...everyone, sharing, sharedReaders })).not.toMatch(/you're first\.$/);
      }
    }
  });

  it("still reads sensibly against a server that does not count sharers", () => {
    expect(emptyBoardText({ ...everyone, sharing: true })).toBe(
      "Nobody who shares their profile has read yet this week. A few minutes of reading and you're first."
    );
    expect(emptyBoardText({ ...everyone, sharing: false })).toMatch(/^Nobody who shares their profile has read yet this week\. The board lists only/);
    expect(emptyBoardText({ scope: "everyone", signedIn: false, sharing: false, sharedReaders: 0 })).toBe(
      "Nobody has shared a profile yet, so the board is empty. The board lists only readers who share their profile."
    );
  });

  it("explains Following to a reader who is not sharing", () => {
    expect(emptyBoardText({ scope: "following", signedIn: true, sharing: false })).toMatch(/^Following is for readers who share/);
    expect(emptyBoardText({ scope: "following", signedIn: true, sharing: true })).toMatch(/^Just you so far/);
  });
});
