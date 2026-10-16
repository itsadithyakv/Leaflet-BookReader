import { Component, StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../testing/miniDom";

// react-dom looks for a document as it loads: everything is imported once there is one (`testing/miniDom.ts`).
const document = installMiniDom({
  matching: ["(hover: none) and (pointer: coarse)"],
  userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
});

const profile = (handle: string) => ({
  handle,
  displayName: `Reader ${handle}`,
  pipSeed: handle,
  avatar: null,
  visibility: "public",
  locked: false,
  sharesLibrary: true,
  reading: { title: "Middlemarch", percent: 42 },
  level: 7,
  badges: ["streak-7"],
  arcade: { dash: 1, catch: 2, flap: 3 },
  camp: { levels: { burrow: 2, oak: 1, store: 1, fence: 1, tower: 0, hut: 1 }, yard: [], camps: 1, banners: 1, trophies: 1 },
  weekKey: "2026-W42",
  weekMinutes: 95,
  streak: 6,
  booksFinished: 12,
  shelf: [{ title: "Persuasion", author: null, styleSeed: "p" }],
  kudosThisWeek: 3,
  followerCount: 10,
  followingCount: 4,
  isYou: false,
  isFollowing: true,
  followsYou: true,
  kudosSentToday: false,
  activeDuel: { id: "duel-1", status: "pending", youChallenged: false }
});

const entry = (handle: string, rank: number) => ({
  handle,
  displayName: null,
  pipSeed: handle,
  rank,
  weekMinutes: 100 - rank,
  streak: 1,
  booksFinished: 1,
  isYou: false
});

describe("the Social page on a phone", () => {
  it("opens a reader's card from the board, and another after it", async () => {
    vi.stubEnv("VITE_ENABLE_COMMUNITY", "true");
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { SocialPage } = await import("./SocialPage");
    const { useCommunityStore } = await import("../components/community/communityStore");
    const { useLibraryStore } = await import("../store/libraryStore");
    const { useAccountStore } = await import("../store/accountStore");
    const { socialService } = await import("../services/socialService");
    const { friendsService } = await import("../services/friendsService");
    vi.spyOn(socialService, "reader").mockImplementation(async (handle: string) => profile(handle) as never);
    vi.spyOn(friendsService, "postsOf").mockImplementation(async () => []);
    const me = { handle: "me", displayName: "Me", visibility: "public", shelf: [], weekMinutes: 5, streak: 1, booksFinished: 1 } as never;
    const board = { weekKey: "2026-W42", scope: "everyone", entries: [entry("ana", 1), entry("ben", 2)], you: null, sharedReaders: 2 } as never;
    useCommunityStore.setState({
      me,
      boards: { everyone: board, following: board },
      loadBoard: async () => null,
      loadDuels: async () => undefined,
      loadMe: async () => undefined,
      publish: async () => null as never
    });
    useAccountStore.setState((state) => ({ ...state, load: async () => undefined, status: { ...state.status, signedIn: true } }) as never);
    useLibraryStore.setState((state) => ({ ...state, sync: { ...state.sync, apiBase: "https://example.test" } }) as never);
    localStorage.setItem("leaflet.social.view", "community");

    const caught: string[] = [];
    class Catch extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error: Error, info: { componentStack?: string | null }) {
        caught.push(`${error.message}\n${info.componentStack ?? ""}`);
      }
      render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    const hookWarnings: string[] = [];
    const original = console.error;
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (/hook/i.test(text)) hookWarnings.push(text);
      else if (!/The above error occurred/.test(text)) original(...args);
    });

    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    const settle = async () => {
      for (let round = 0; round < 6; round += 1) {
        await React.act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
      }
    };
    const tapRow = async (handle: string) => {
      const row = container.findAll((element) => element.tagName === "BUTTON" && (element.getAttribute("aria-label") ?? "").startsWith(`@${handle}, rank`))[0];
      expect(row, `the board's row for @${handle}`).toBeTruthy();
      await React.act(async () => void row.dispatchEvent(makeEvent("click", row)));
      await settle();
    };

    await React.act(async () => {
      root.render(
        <StrictMode>
          <Catch>
            <SocialPage showToast={() => undefined} nowReading={null} onReadNow={() => undefined} onNavigate={() => undefined} />
          </Catch>
        </StrictMode>
      );
    });
    await settle();
    expect(container.textContent).toContain("Leaderboard");

    await tapRow("ana");
    expect(useCommunityStore.getState().openHandle).toBe("ana");
    expect(container.textContent).toContain("Reader ana");
    await React.act(async () => useCommunityStore.getState().closeReader());
    await tapRow("ben");
    expect(container.textContent).toContain("Reader ben");

    expect(caught).toEqual([]);
    expect(hookWarnings).toEqual([]);
    await React.act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // Loading the page and all it imports is slow when the whole suite runs at once.
  }, 30_000);
});
