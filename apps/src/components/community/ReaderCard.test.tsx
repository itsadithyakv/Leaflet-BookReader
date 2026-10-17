import { Component, StrictMode, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, setMiniDom, type MiniElement } from "../../testing/miniDom";
import type { LockedProfile, ReaderProfile } from "../../services/socialService";
import type { BookPost, ReaderLibrary } from "../../services/friendsService";

// react-dom looks for a document as it loads, so it (and everything that may
// touch `window` as it loads) is imported only once there is one.
const document = installMiniDom();

const TOUCH = "(hover: none) and (pointer: coarse)";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

const full = (handle: string): ReaderProfile => ({
  handle,
  displayName: `Reader ${handle}`,
  pipSeed: handle,
  avatar: "sprout.wave",
  visibility: "public",
  locked: false,
  sharesLibrary: true,
  reading: { title: "Middlemarch", percent: 42 } as ReaderProfile["reading"],
  level: 7,
  badges: ["streak-7", "books-1", "hours-10"],
  arcade: { dash: 120, catch: 40, flap: 9 } as ReaderProfile["arcade"],
  camp: {
    levels: { burrow: 2, oak: 1, store: 1, fence: 1, tower: 0, hut: 1 },
    yard: [{ kind: "well", level: 1 }, { kind: null, level: 0 }],
    camps: 3,
    banners: 1,
    trophies: 2
  },
  weekKey: "2026-W42",
  weekMinutes: 95,
  streak: 6,
  booksFinished: 12,
  shelf: [
    { title: "Middlemarch", author: "George Eliot", styleSeed: "mm" },
    { title: "Persuasion", author: null, styleSeed: "p" }
  ],
  kudosThisWeek: 3,
  followerCount: 10,
  followingCount: 4,
  isYou: false,
  isFollowing: true,
  followsYou: true,
  kudosSentToday: false,
  activeDuel: { id: "duel-1", status: "pending", youChallenged: false }
});

const locked = (handle: string): LockedProfile => ({
  handle,
  displayName: null,
  pipSeed: handle,
  avatar: null,
  visibility: "followers",
  locked: true,
  requested: false
});

const library: ReaderLibrary = {
  books: [
    { key: "a", title: "Middlemarch", author: "George Eliot", state: "reading", percent: 42, inYours: true },
    { key: "b", title: "Persuasion", author: null, state: "finished", percent: 100, inYours: false }
  ],
  updatedAt: null
};

const posts = (handle: string): BookPost[] => [
  {
    id: "post-1",
    person: { handle, displayName: null, pipSeed: handle },
    title: "Persuasion",
    author: "Jane Austen",
    rating: 5,
    line: "Wonderful.",
    createdAt: "2026-10-10T10:00:00.000Z",
    isYou: false,
    kind: "review",
    body: "A long review. ".repeat(40)
  }
];

type Caught = { error: Error; stack: string };

describe("a reader's card, mounted", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let ReaderCard: typeof import("./ReaderCard").ReaderCard;
  let useCommunityStore: typeof import("./communityStore").useCommunityStore;
  let container: MiniElement;
  let root: import("react-dom/client").Root;
  let caught: Caught[];
  let hookWarnings: string[];
  let profiles: Record<string, ReaderProfile | LockedProfile>;

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ ReaderCard } = await import("./ReaderCard"));
    ({ useCommunityStore } = await import("./communityStore"));
    const { socialService } = await import("../../services/socialService");
    const { friendsService } = await import("../../services/friendsService");
    const { usePipWardrobeStore } = await import("../../store/pipWardrobeStore");
    vi.spyOn(socialService, "reader").mockImplementation(async (handle: string) => {
      const found = profiles[handle];
      if (!found) throw new Error("No shared profile with that handle.");
      return structuredClone(found);
    });
    vi.spyOn(friendsService, "library").mockImplementation(async () => structuredClone(library));
    vi.spyOn(friendsService, "postsOf").mockImplementation(async (handle: string) => posts(handle));
    usePipWardrobeStore.setState({ load: async () => undefined });
    const original = console.error;
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (/hook/i.test(text)) hookWarnings.push(text);
      else if (!/The above error occurred/.test(text)) original(...args);
    });
  }, 30_000);

  afterAll(() => {
    vi.restoreAllMocks();
  });

  class Catch extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error: Error, info: { componentStack?: string | null }) {
      caught.push({ error, stack: info.componentStack ?? "" });
    }
    render() {
      return this.state.failed ? null : this.props.children;
    }
  }

  const settle = async () => {
    for (let round = 0; round < 5; round += 1) {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };
  const mount = async () => {
    container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => {
      root.render(
        <StrictMode>
          <Catch>
            <ReaderCard signedIn canJoin showToast={() => undefined} onChanged={() => undefined} />
          </Catch>
        </StrictMode>
      );
    });
  };
  const open = async (handle: string) => {
    await React.act(async () => useCommunityStore.getState().openReader(handle));
    await settle();
  };
  const click = async (test: (element: MiniElement) => boolean) => {
    const target = container.findAll((element) => element.tagName === "BUTTON" && test(element))[0];
    expect(target, "a button to press").toBeTruthy();
    await React.act(async () => {
      target.dispatchEvent(makeEvent("click", target));
    });
    await settle();
  };
  const section = (title: string) => container.findAll((element) => element.tagName === "SECTION" && element.getAttribute("aria-label") === title)[0];
  const shown = () => container.textContent;
  const healthy = () => {
    expect(caught.map((entry) => `${entry.error.message}\n${entry.stack}`)).toEqual([]);
    expect(hookWarnings).toEqual([]);
  };

  beforeEach(async () => {
    caught = [];
    hookWarnings = [];
    profiles = { ana: full("ana"), ben: full("ben"), cleo: locked("cleo") };
    useCommunityStore.setState({ openHandle: null });
    setMiniDom({ matching: [], userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    await mount();
  });

  const walkThrough = async () => {
    await open("ana");
    expect(shown()).toContain("Reader ana");
    expect(container.findAll((element) => element.getAttribute("aria-label") === "@ana's camp: 3 strongholds, 1 banner, 2 trophies")).toHaveLength(1);
    expect(shown()).toContain("Accept their duel");
    // One page: the streak, the books they recommend, their library and their shelf, all at once.
    expect(shown()).toContain("6 days");
    expect(section("Recommends")?.textContent).toContain("Persuasion");
    expect(section("Library")?.textContent).toContain("Yours too");
    expect(section("Shelf")?.textContent).toContain("Middlemarch");
    expect(section("Posts")).toBeUndefined();
    healthy();
    // Back closes it.
    await click((element) => element.textContent.trim() === "Back");
    expect(shown()).toBe("");
    await open("ana");
    expect(shown()).toContain("Reader ana");
    healthy();
    // Another reader while the first is open, then one kept to followers, then back.
    await open("ben");
    expect(shown()).toContain("Reader ben");
    await open("cleo");
    expect(shown()).toContain("Kept to followers");
    await open("ana");
    expect(shown()).toContain("Reader ana");
    healthy();
    // Closed, and opened again.
    await React.act(async () => useCommunityStore.getState().closeReader());
    expect(shown()).toBe("");
    await open("ben");
    expect(shown()).toContain("Reader ben");
    healthy();
    await React.act(async () => root.unmount());
  };

  it("opens with a full profile, its sections, and another reader after it", walkThrough);

  it("recommends what was finished or reviewed with four stars or five, never a quote", async () => {
    const { recommends } = await import("./ReaderCard");
    const post = (kind: BookPost["kind"], rating: number | null) => ({ ...posts("ana")[0], kind, rating });
    expect([post("review", 5), post("finished", 4), post(undefined, 4)].every(recommends)).toBe(true);
    expect([post("review", 3), post("finished", null), post("quote", 5)].some(recommends)).toBe(false);
    await React.act(async () => root.unmount());
  });

  it("does the same on a phone (touch, Android)", async () => {
    setMiniDom({ matching: [TOUCH], userAgent: ANDROID });
    await walkThrough();
  });

  it("sends kudos for a post, which spends the day's kudos on the page too", async () => {
    const { socialService } = await import("../../services/socialService");
    const sent = vi.spyOn(socialService, "sendKudos").mockResolvedValue({ sent: true, kudosThisWeek: 4 });
    useCommunityStore.setState({ kudosSent: {}, me: { handle: "me", displayName: null, visibility: "public", weekMinutes: 0, streak: 0, booksFinished: 0, shelf: [] } });
    profiles.ana = { ...full("ana"), activeDuel: null };
    await open("ana");
    await click((element) => element.getAttribute("aria-label") === "Send @ana kudos for this post");
    expect(sent).toHaveBeenCalledWith("ana", "post-1");
    expect(section("Recommends")?.textContent).toContain("Kudos sent");
    // The page's own button says so as well: one kudos a day, whichever button sent it.
    expect(container.findAll((element) => element.tagName === "BUTTON" && element.textContent.trim() === "Kudos sent")).toHaveLength(2);
    healthy();
    useCommunityStore.setState({ me: null, kudosSent: {} });
    await React.act(async () => root.unmount());
  });

  it("opens a profile kept to followers first, then a full one", async () => {
    await open("cleo");
    expect(shown()).toContain("Kept to followers");
    await open("ana");
    expect(shown()).toContain("Reader ana");
    healthy();
    await React.act(async () => root.unmount());
  });

  it("opens a handle with no profile, then one with", async () => {
    await open("nobody");
    expect(shown()).toContain("No shared profile");
    await open("ana");
    expect(shown()).toContain("Reader ana");
    healthy();
    await React.act(async () => root.unmount());
  });
});
