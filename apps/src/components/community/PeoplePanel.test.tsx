import { StrictMode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, setMiniDom, type MiniElement } from "../../testing/miniDom";
import type { PeoplePage, PersonCard } from "../../services/socialService";

vi.mock("../../constants/features", async (original) => {
  const actual = await original<typeof import("../../constants/features")>();
  return { ...actual, FEATURES: { ...actual.FEATURES, accounts: true, community: true } };
});

const document = installMiniDom();

const card = (handle: string, extra: Partial<PersonCard> = {}): PersonCard => ({
  handle,
  displayName: `Reader ${handle}`,
  pipSeed: handle,
  avatar: null,
  visibility: "public",
  locked: false,
  weekMinutes: 42,
  streak: 3,
  followState: "none",
  followsYou: false,
  ...extra
});

describe("the People tab, mounted", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let PeoplePanel: typeof import("./PeoplePanel").PeoplePanel;
  let useCommunityStore: typeof import("./communityStore").useCommunityStore;
  let socialService: typeof import("../../services/socialService").socialService;
  let container: MiniElement;
  let root: import("react-dom/client").Root;
  let errors: string[];

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ PeoplePanel } = await import("./PeoplePanel"));
    ({ useCommunityStore } = await import("./communityStore"));
    ({ socialService } = await import("../../services/socialService"));
    const { useAccountStore } = await import("../../store/accountStore");
    const { useLibraryStore } = await import("../../store/libraryStore");
    useAccountStore.setState((state) => ({
      status: { ...state.status, signedIn: true, account: { id: "a1", email: "me@example.com", displayName: "Me", avatar: null, emailConfirmed: true, createdAt: null } }
    }));
    useLibraryStore.setState((state) => ({ sync: { ...state.sync, apiBase: "https://api.example.com" } }));
    useCommunityStore.setState({
      me: { handle: "me", displayName: "Me", visibility: "public", weekMinutes: 0, streak: 0, booksFinished: 0, shelf: [] },
      loadBoard: async () => null
    });
    const original = console.error;
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
      original(...args);
    });
  }, 30_000);

  afterAll(() => {
    vi.restoreAllMocks();
  });

  const settle = async () => {
    for (let round = 0; round < 6; round += 1) {
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
          <PeoplePanel showToast={() => undefined} onNavigate={() => undefined} />
        </StrictMode>
      );
    });
    await settle();
  };
  const buttons = (test: (element: MiniElement) => boolean) => container.findAll((element) => element.tagName === "BUTTON" && test(element));
  const shown = () => container.textContent;

  beforeEach(() => {
    errors = [];
    setMiniDom({ matching: [], userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    useCommunityStore.setState({ peopleView: "everyone" });
  });

  it("lists suggestions and every public reader, with Follows you, counts and a follow that takes", async () => {
    const page: PeoplePage = { people: [card("ana", { followsYou: true }), card("ben", { followState: "following" })], next: "c1" };
    vi.spyOn(socialService, "people").mockResolvedValue(page);
    vi.spyOn(socialService, "suggested").mockResolvedValue([card("cleo", { reason: { kind: "book", title: "Dune" } })]);
    vi.spyOn(socialService, "followList").mockImplementation(async (which) => ({ people: [], next: null, count: which === "followers" ? 7 : 12 }));
    const follow = vi.spyOn(socialService, "setFollowing").mockResolvedValue({ following: true, requested: false });
    await mount();

    expect(shown()).toContain("Suggested for you");
    expect(shown()).toContain("Posted about Dune");
    expect(shown()).toContain("Reader ana");
    expect(shown()).toContain("Follows you");
    expect(shown()).toContain("Followers 7");
    expect(shown()).toContain("Following 12");
    expect(shown()).toContain("Active this week");
    expect(buttons((element) => element.textContent.trim() === "Show more")).toHaveLength(1);
    expect(buttons((element) => element.getAttribute("aria-label") === "Unfollow @ben")).toHaveLength(1);

    const [ana] = buttons((element) => element.getAttribute("aria-label") === "Follow @ana");
    await React.act(async () => {
      ana.dispatchEvent(makeEvent("click", ana));
    });
    await settle();
    expect(follow).toHaveBeenCalledWith("ana", true);
    expect(buttons((element) => element.getAttribute("aria-label") === "Unfollow @ana")).toHaveLength(1);
    expect(shown()).toContain("Following 13");
    expect(errors).toEqual([]);
    await React.act(async () => root.unmount());
    vi.mocked(socialService.people).mockRestore();
  });

  it("against an older server: one quiet line, no error, and Following from the old list", async () => {
    vi.spyOn(socialService, "people").mockResolvedValue(null);
    vi.spyOn(socialService, "suggested").mockResolvedValue(null);
    vi.spyOn(socialService, "followList").mockResolvedValue(null);
    vi.spyOn(socialService, "following").mockResolvedValue({ following: [{ handle: "old", displayName: "Old Friend", pipSeed: "old" }], followerCount: 2 });
    // What the last test's tab kept was another server's.
    (await import("./PeoplePanel")).forgetPeople();
    await mount();
    expect(shown()).toContain("More arrives with the next server update.");
    expect(shown()).not.toContain("Suggested for you");
    await React.act(async () => useCommunityStore.getState().setPeopleView("following"));
    await settle();
    expect(shown()).toContain("Old Friend");
    expect(shown()).not.toContain("this week");
    expect(errors).toEqual([]);
    await React.act(async () => root.unmount());
  });
});
