import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialProfile } from "@shared/sync/types";
import { socialService, type BoardEntry, type CommunityBoard, type Duel, type InboxEvent } from "../../services/socialService";
import { useCommunityStore } from "./communityStore";

const EMPTY_BOARD: CommunityBoard = { weekKey: "2026-W40", scope: "everyone", entries: [], you: null, sharedReaders: 0 };
const UNREACHABLE = "Could not reach the Leaflet server. Check your connection.";

const shared: SocialProfile = {
  handle: "adi",
  displayName: "Adi",
  visibility: "public",
  weekMinutes: 135,
  streak: 4,
  booksFinished: 2,
  shelf: []
};

describe("the community store, when the server cannot be reached", () => {
  beforeEach(() => {
    useCommunityStore.setState({
      me: null,
      meError: null,
      publishError: null,
      boards: { everyone: null, following: null },
      boardError: { everyone: null, following: null },
      boardLoading: { everyone: false, following: false }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a failed board load as a failure, never as an empty board", async () => {
    vi.spyOn(socialService, "board").mockRejectedValueOnce(new Error(UNREACHABLE));
    expect(await useCommunityStore.getState().loadBoard("everyone")).toBeNull();
    const failed = useCommunityStore.getState();
    // No board at all: the page has an error to show and nothing to call empty.
    expect(failed.boards.everyone).toBeNull();
    expect(failed.boardError.everyone).toBe(UNREACHABLE);
    expect(failed.boardLoading.everyone).toBe(false);

    vi.spyOn(socialService, "board").mockResolvedValueOnce(EMPTY_BOARD);
    await useCommunityStore.getState().loadBoard("everyone");
    expect(useCommunityStore.getState().boards.everyone).toEqual(EMPTY_BOARD);
    expect(useCommunityStore.getState().boardError.everyone).toBeNull();

    // A later refresh fails: the earlier board stays, and so does the error,
    // so the page can say what is shown may be out of date.
    vi.spyOn(socialService, "board").mockRejectedValueOnce(new Error(UNREACHABLE));
    await useCommunityStore.getState().loadBoard("everyone");
    expect(useCommunityStore.getState().boards.everyone).toEqual(EMPTY_BOARD);
    expect(useCommunityStore.getState().boardError.everyone).toBe(UNREACHABLE);
  });

  it("does not turn a profile that failed to load into a private one", async () => {
    vi.spyOn(socialService, "profile").mockRejectedValueOnce(new Error(UNREACHABLE));
    await useCommunityStore.getState().loadMe();
    expect(useCommunityStore.getState().me).toBeNull();
    expect(useCommunityStore.getState().meError).toBe(UNREACHABLE);

    vi.spyOn(socialService, "profile").mockResolvedValueOnce(shared);
    await useCommunityStore.getState().loadMe();
    expect(useCommunityStore.getState()).toMatchObject({ me: shared, meError: null });

    // One failed refresh keeps the profile already read.
    vi.spyOn(socialService, "profile").mockRejectedValueOnce(new Error(UNREACHABLE));
    await useCommunityStore.getState().loadMe();
    expect(useCommunityStore.getState()).toMatchObject({ me: shared, meError: UNREACHABLE });
  });

  it("keeps why the reader's minutes could not be sent, and forgets it once they are", async () => {
    vi.spyOn(socialService, "publishStats").mockResolvedValue(false);
    const problem = vi.spyOn(socialService, "publishProblem").mockReturnValue("weekKey must be the current ISO week, like 2026-W39.");
    expect(await useCommunityStore.getState().publish({ force: true })).toBe(false);
    expect(useCommunityStore.getState().publishError).toBe("weekKey must be the current ISO week, like 2026-W39.");

    vi.spyOn(socialService, "publishStats").mockResolvedValue(true);
    problem.mockReturnValue(null);
    expect(await useCommunityStore.getState().publish()).toBe(true);
    expect(useCommunityStore.getState().publishError).toBeNull();
  });

  it("forgets what was personal on sign-out", () => {
    useCommunityStore.setState({ me: shared, meError: "x", publishError: "y" });
    useCommunityStore.getState().reset();
    expect(useCommunityStore.getState()).toMatchObject({ me: null, meError: null, publishError: null });
  });
});

const row = (handle: string, rank: number, isYou = false): BoardEntry => ({
  handle,
  displayName: null,
  pipSeed: handle,
  avatar: null,
  rank,
  weekMinutes: 100 - rank,
  streak: 0,
  booksFinished: 0,
  isYou
});

/** A promise to settle by hand, for an answer that is still on its way. */
const pending = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const kudos = (id: string, handle: string, createdAt: string): InboxEvent => ({
  id,
  type: "kudos",
  createdAt,
  actor: { handle, displayName: handle.toUpperCase(), pipSeed: handle, avatar: null }
});

describe("the community store, across a sign-out", () => {
  const adisBoard: CommunityBoard = {
    weekKey: "2026-W40",
    scope: "everyone",
    entries: [row("maya", 1), row("adi", 2, true)],
    you: row("adi", 2, true),
    sharedReaders: 2
  };

  beforeEach(() => {
    useCommunityStore.getState().reset();
    useCommunityStore.setState({
      boards: { everyone: null, following: null },
      boardError: { everyone: null, following: null },
      boardLoading: { everyone: false, following: false }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the public board but not who 'you' were on it", () => {
    useCommunityStore.setState({
      me: shared,
      boards: { everyone: adisBoard, following: { ...adisBoard, scope: "following" } },
      boardError: { everyone: null, following: "Sign in to your Leaflet account first." }
    });
    useCommunityStore.getState().reset();
    const state = useCommunityStore.getState();
    // The rows are public and stay; the reader who left is one of them, unmarked.
    expect(state.boards.everyone?.entries.map((entry) => entry.handle)).toEqual(["maya", "adi"]);
    expect(state.boards.everyone?.entries.some((entry) => entry.isYou)).toBe(false);
    expect(state.boards.everyone?.you).toBeNull();
    // Following was theirs alone, and so was its error.
    expect(state.boards.following).toBeNull();
    expect(state.boardError.following).toBeNull();
  });

  it("drops answers that were asked for before the sign-out", async () => {
    const profile = pending<SocialProfile>();
    const everyone = pending<CommunityBoard>();
    const following = pending<CommunityBoard>();
    const duels = pending<Duel[]>();
    const inbox = pending<{ events: InboxEvent[]; now: string }>();
    vi.spyOn(socialService, "profile").mockReturnValueOnce(profile.promise);
    vi.spyOn(socialService, "board").mockImplementation((scope) => (scope === "following" ? following.promise : everyone.promise));
    vi.spyOn(socialService, "duels").mockReturnValueOnce(duels.promise);
    vi.spyOn(socialService, "inbox").mockReturnValueOnce(inbox.promise);

    const store = useCommunityStore.getState();
    const asked = [store.loadMe(), store.loadBoard("everyone"), store.loadBoard("following"), store.loadDuels(), store.pollInbox()];
    // Adi signs out while all five are on their way, and they land afterwards.
    store.reset();
    profile.resolve(shared);
    everyone.resolve(adisBoard);
    following.resolve({ ...adisBoard, scope: "following" });
    duels.resolve([{ id: "d1" } as Duel]);
    inbox.resolve({ events: [kudos("e1", "maya", "2026-10-03T10:00:00.000Z")], now: "2026-10-03T10:00:01.000Z" });
    await Promise.all(asked);

    const state = useCommunityStore.getState();
    // Nothing of Adi's is left for whoever signs in next.
    expect(state.me).toBeNull();
    expect(state.duels).toEqual([]);
    expect(state.inbox).toEqual([]);
    expect(state.boards.following).toBeNull();
    // The public board is still worth showing, without "you".
    expect(state.boards.everyone?.entries).toHaveLength(2);
    expect(state.boards.everyone?.you).toBeNull();
    expect(state.boards.everyone?.entries.some((entry) => entry.isYou)).toBe(false);
    expect(state.boardLoading).toEqual({ everyone: false, following: false });
  });

  it("drops a failure that was asked for before the sign-out, too", async () => {
    const profile = pending<SocialProfile>();
    vi.spyOn(socialService, "profile").mockReturnValueOnce(profile.promise);
    const asked = useCommunityStore.getState().loadMe();
    useCommunityStore.getState().reset();
    profile.reject(new Error("Your Leaflet sign-in has ended. Sign in again in Settings."));
    await asked;
    expect(useCommunityStore.getState().meError).toBeNull();
  });
});

describe("the inbox", () => {
  beforeEach(() => {
    useCommunityStore.getState().reset();
    useCommunityStore.setState({ boards: { everyone: null, following: null } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets go of a reader who has made their profile private", async () => {
    const fromShy = kudos("e1", "shy", "2026-10-03T09:00:00.000Z");
    const fromMaya = kudos("e2", "maya", "2026-10-03T10:00:00.000Z");
    const asked = vi.spyOn(socialService, "inbox").mockResolvedValueOnce({ events: [fromMaya, fromShy], now: "" });
    expect(await useCommunityStore.getState().pollInbox()).toHaveLength(2);
    expect(useCommunityStore.getState().inbox.map((item) => item.actor.handle)).toEqual(["maya", "shy"]);

    // Shy makes their profile private. The server stops listing their kudos;
    // asking only for what was newer, this list never found out.
    asked.mockResolvedValueOnce({ events: [fromMaya], now: "" });
    expect(await useCommunityStore.getState().pollInbox()).toEqual([]);
    expect(useCommunityStore.getState().inbox.map((item) => item.actor.handle)).toEqual(["maya"]);
    // The whole inbox is asked for each time.
    expect(asked.mock.calls.every((args) => args[0] === undefined || args[0] === null)).toBe(true);
  });

  it("tells what is new from what was already listed, and keeps this device's own notes", async () => {
    const first = kudos("e1", "maya", "2026-10-03T09:00:00.000Z");
    const second = kudos("e2", "noor", "2026-10-03T11:00:00.000Z");
    const passedBy = (handle: string) => ({
      id: `passed:2026-W40:${handle}:1`,
      type: "passed" as const,
      createdAt: "2026-10-03T10:00:00.000Z",
      actor: { handle, displayName: null, pipSeed: handle, avatar: null },
      weekKey: "2026-W40"
    });
    const asked = vi.spyOn(socialService, "inbox").mockResolvedValueOnce({ events: [first], now: "" });
    await useCommunityStore.getState().pollInbox();
    useCommunityStore.getState().addPassed(passedBy("maya"));
    useCommunityStore.getState().addPassed(passedBy("shy"));

    // Maya is still on the Following board; Shy has gone private and is not.
    useCommunityStore.setState({
      boards: { everyone: null, following: { weekKey: "2026-W40", scope: "following", entries: [row("maya", 1)], you: null } }
    });
    asked.mockResolvedValueOnce({ events: [second, first], now: "" });
    const fresh = await useCommunityStore.getState().pollInbox();
    expect(fresh.map((event) => event.id)).toEqual(["e2"]);
    expect(useCommunityStore.getState().inbox.map((item) => item.id)).toEqual(["e2", "passed:2026-W40:maya:1", "e1"]);
  });
});
