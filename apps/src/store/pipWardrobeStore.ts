import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { pipService, shopError, type PipLook, type PipOverview } from "../services/pipService";
import { DEFAULT_SIGNATURE, DEFAULT_VARIANT, PREMIUM_MOVES } from "../pip/shop";
import type { ShopKind } from "../pip/shop";

type WardrobeState = {
  /** Null until the first load answers. */
  overview: PipOverview | null;
  load: () => Promise<void>;
  /** Rejects with a readable message (can't afford, already owned...). */
  buy: (kind: ShopKind, id: string) => Promise<void>;
  /** Changes part of Pip's look or home. Applied at once, undone if Rust refuses. */
  setLook: (patch: Partial<PipLook>) => Promise<void>;
  /** Gives Pip a treat: food is bought on the spot, toys must be owned. */
  feed: (treatId: string) => Promise<void>;
  /** Plants a seed packet in an empty plot. */
  plant: (plot: number, plant: string) => Promise<void>;
  /** Picks a ripe plant. Resolves with the seeds it gave. */
  harvest: (plantingId: string) => Promise<number>;
  /** Records a finished arcade game. Resolves with the mood it added. */
  gamePlayed: (game: string, score: number) => Promise<number>;
  /** Records a bout of play by hand. Resolves with the mood it added (0 once the day's allowance is used). */
  played: (kind: string) => Promise<number>;
};

const lookOf = (overview: PipOverview): PipLook => ({
  variant: overview.state.variant,
  outfit: overview.state.outfit,
  room: overview.state.room,
  roomStyle: overview.state.roomStyle,
  signature: overview.state.signature
});

/**
 * Pip's wardrobe, wallet and home: a live view over the Rust side, like
 * habitStore is over the streak engine. Loaded at startup because every Pip
 * on screen (the one roaming the app, the reader peek, the session wrap-up)
 * wears what is equipped here. The header logo does not: it stays the classic
 * green Pip, the brand.
 */
export const usePipWardrobeStore = create<WardrobeState>((set, get) => {
  const run = async (action: () => Promise<PipOverview>) => {
    try {
      set({ overview: await action() });
    } catch (cause) {
      throw new Error(shopError(cause));
    }
  };

  return {
    overview: null,

    async load() {
      try {
        set({ overview: await pipService.overview() });
      } catch {
        // Pip keeps its defaults; the tab retries when it opens.
      }
    },

    buy: (kind, id) => run(() => pipService.buy(kind, id)),

    async setLook(patch) {
      const before = get().overview;
      if (!before) {
        return;
      }
      const look = { ...lookOf(before), ...patch };
      set({ overview: { ...before, state: { ...before.state, ...look } } });
      try {
        set({ overview: await pipService.setLook(look) });
      } catch (cause) {
        set({ overview: before });
        throw new Error(shopError(cause));
      }
    },

    feed: (treatId) => run(() => pipService.feed(treatId)),

    plant: (plot, plant) => run(() => pipService.plant(plot, plant)),

    async harvest(plantingId) {
      const before = get().overview?.wallet.earned.harvests ?? 0;
      await run(() => pipService.harvest(plantingId));
      return Math.max(0, (get().overview?.wallet.earned.harvests ?? 0) - before);
    },

    async gamePlayed(game, score) {
      const before = get().overview?.arcade.moodToday ?? 0;
      try {
        const overview = await pipService.gamePlayed(game, score);
        set({ overview });
        const after = overview.arcade.moodToday;
        return Math.max(0, after < before ? after : after - before);
      } catch (cause) {
        throw new Error(shopError(cause));
      }
    },

    async played(kind) {
      const before = get().overview?.arcade.moodToday ?? 0;
      try {
        const overview = await pipService.played(kind);
        set({ overview });
        const after = overview.arcade.moodToday;
        // A new day's allowance starts from nothing, so less than before means all of it is new.
        return Math.max(0, after < before ? after : after - before);
      } catch {
        // Play is never refused out loud: Pip still had fun.
        return 0;
      }
    }
  };
});

// One empty outfit, so a Pip with nothing on does not re-render on every load.
const EMPTY: string[] = [];

/** What every Pip in the app wears: the equipped variant, outfit and signature move. */
export const useEquippedPip = () =>
  usePipWardrobeStore(
    useShallow((state) => ({
      skin: state.overview?.state.variant ?? DEFAULT_VARIANT,
      outfit: state.overview?.state.outfit ?? EMPTY,
      signature: state.overview?.state.signature ?? DEFAULT_SIGNATURE
    }))
  );

export const ownsItem = (overview: PipOverview | null, kind: ShopKind, id: string) =>
  Boolean(overview?.owned.some((item) => item.kind === kind && item.id === id));

/** The premium moves this reader owns, for Pip's free-time hobbies. */
export const ownedPremiumMoves = (overview: PipOverview | null) =>
  PREMIUM_MOVES.filter((move) => ownsItem(overview, "move", move.id)).map((move) => move.id);
