import { useEffect } from "react";
import { FEATURES } from "../constants/features";
import { useAccountStore } from "../store/accountStore";
import { useLibraryStore } from "../store/libraryStore";
import { usePipStore } from "../store/pipStore";
import { pickBeat, type PipMoment } from "../pip/moments";
import { selectUnread, useCommunityStore, type InboxItem } from "../components/community/communityStore";
import { at, readJson, writeJson } from "../components/community/format";
import type { CommunityBoard } from "../services/socialService";

/**
 * The community's heartbeat, mounted once in App.
 *
 * Every five minutes while signed in (and the window is visible) it fetches new
 * inbox events and the Following board, notices when someone on that board
 * has just passed the reader, and lets Pip react — once per poll at most, to
 * the most interesting thing that happened. Returns the unread count for the
 * nav badge.
 */

const POLL_MS = 5 * 60_000;
const REACTED_KEY = "leaflet.community.pipReactedAt";

/** What deserves Pip's one reaction, most first. */
const PRIORITY: Record<InboxItem["type"], number> = {
  duel_result: 6,
  duel_invite: 5,
  duel_accepted: 4,
  passed: 3,
  kudos: 2,
  follow: 1
};

const momentFor = (item: InboxItem): PipMoment => {
  switch (item.type) {
    case "kudos":
      return "kudosReceived";
    case "follow":
      return "newFollower";
    case "duel_invite":
      return "duelInvite";
    case "duel_accepted":
      return "duelAccepted";
    case "passed":
      return "passedBy";
    case "duel_result":
      return item.duel?.result === "won" ? "duelWon" : item.duel?.result === "lost" ? "duelLost" : "duelTie";
  }
};

type RankSnapshot = { weekKey: string; ranks: Map<string, number>; myRank: number };

const snapshotOf = (board: CommunityBoard): RankSnapshot | null =>
  board.you
    ? {
        weekKey: board.weekKey,
        ranks: new Map(board.entries.map((entry) => [entry.handle, entry.rank])),
        myRank: board.you.rank
      }
    : null;

/** Whoever was behind the reader last time and is ahead now; the nearest one. */
const passedBy = (before: RankSnapshot | null, board: CommunityBoard) => {
  const now = board.you;
  if (!before || !now || before.weekKey !== board.weekKey) {
    return null;
  }
  const overtakers = board.entries.filter((entry) => {
    const was = before.ranks.get(entry.handle);
    return !entry.isYou && was !== undefined && was > before.myRank && entry.rank < now.rank;
  });
  return overtakers.sort((a, b) => b.rank - a.rank)[0] ?? null;
};

export const useCommunityPulse = () => {
  const signedIn = useAccountStore((state) => state.status.signedIn);
  const apiBase = useLibraryStore((state) => state.sync.apiBase);
  const enabled = FEATURES.community && signedIn && Boolean(apiBase);
  const unread = useCommunityStore(selectUnread);

  useEffect(() => {
    if (!enabled) {
      useCommunityStore.getState().reset();
      return;
    }
    let stopped = false;
    let running = false;
    let lastRun = 0;
    let snapshot: RankSnapshot | null = null;
    // Events older than this have had their moment (or predate the app);
    // a first run starts a day back so a fresh install is not a parade.
    let reactedAt = readJson<string>(REACTED_KEY, new Date(Date.now() - 86_400_000).toISOString());

    const tick = async () => {
      if (stopped || running || document.hidden) {
        return;
      }
      running = true;
      lastRun = Date.now();
      try {
        await pulse();
      } finally {
        running = false;
      }
    };

    const pulse = async () => {
      const store = useCommunityStore.getState();
      const candidates: InboxItem[] = [];
      try {
        candidates.push(...(await store.pollInbox()));
      } catch {
        // Offline or signed out server-side; try again next time.
      }
      try {
        const board = await store.loadBoard("following");
        if (board) {
          const rival = passedBy(snapshot, board);
          if (rival) {
            const event = {
              id: `passed:${board.weekKey}:${rival.handle}:${Date.now()}`,
              type: "passed" as const,
              createdAt: new Date().toISOString(),
              actor: { handle: rival.handle, displayName: rival.displayName, pipSeed: rival.pipSeed, avatar: rival.avatar ?? null },
              weekKey: board.weekKey
            };
            store.addPassed(event);
            candidates.push(event);
          }
          snapshot = snapshotOf(board) ?? snapshot;
        }
      } catch {
        // The board is a nicety here.
      }
      if (candidates.some((item) => item.type.startsWith("duel_"))) {
        void store.loadDuels();
      }

      // One reaction per poll, to the best of what is new.
      const fresh = candidates.filter((item) => item.createdAt > reactedAt);
      if (!stopped && fresh.length > 0) {
        const best = [...fresh].sort((a, b) => PRIORITY[b.type] - PRIORITY[a.type] || b.createdAt.localeCompare(a.createdAt))[0];
        const beat = pickBeat(momentFor(best), best.id, { name: at(best.actor.handle) });
        usePipStore.getState().react(beat.move, { loops: 2, line: beat.line });
        reactedAt = fresh.reduce((latest, item) => (item.createdAt > latest ? item.createdAt : latest), reactedAt);
        writeJson(REACTED_KEY, reactedAt);
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    // Back from another window: catch up, but not more often than every minute.
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastRun > 60_000) {
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return enabled ? unread : 0;
};
