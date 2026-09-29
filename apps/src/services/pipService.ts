import { invoke, isTauri } from "@tauri-apps/api/core";
import { getDateKey } from "./habitService";
import type { ShopKind } from "../pip/shop";
import { DEFAULT_SIGNATURE, DEFAULT_VARIANT, GOALS, SETS, STARTER_CHEST, catalogue, roomItems } from "../pip/shop";

/** Where a reader's seeds came from (see `habit/seeds.rs`). */
export type SeedEarnings = {
  /** Picked in the garden. */
  harvests: number;
  goalDays: number;
  streakBonus: number;
  welcome: number;
  /** Paid straight from minutes, before the garden. */
  earlier: number;
  /** Pip's rewards (pip/rewards.rs): first steps done... */
  goals: number;
  /** ...the starter chest... */
  chest: number;
  /** ...sets finished... */
  sets: number;
  /** ...and daily wishes granted. */
  wishes: number;
  total: number;
};

/** One of a new reader's first steps (shop.js GOALS has its name and hint). */
export type GoalStatus = { id: string; done: boolean; seeds: number };
/** The starter chest: opens with the first focus session of `minutes`. */
export type ChestStatus = { open: boolean; seeds: number; minutes: number };
/** A set (shop.js SETS has its name and pieces): `have` of its `of` pieces owned. */
export type SetStatus = { id: string; kind: ShopKind; have: number; of: number; done: boolean; seeds: number; level: string | null };
/** Owned out of all there are, for one kind of thing. */
export type CollectionCount = { owned: number; total: number };
/**
 * Today's wish: a thing (`kind` "treat" | "plant" | "room" | "move", and its
 * id), whether it was granted today, and what granting it gives.
 */
export type WishStatus = { day: string; kind: "treat" | "plant" | "room" | "move"; id: string; granted: boolean; seeds: number; mood: number };

/** One planting in Pip's garden, grown by reading (replayed in Rust). */
export type PlantState = {
  id: string;
  plot: number;
  plant: string;
  water: number;
  need: number;
  ripe: boolean;
  harvested: boolean;
  seeds: number;
};

export type GardenView = { plots: number; plants: PlantState[]; barrel: number; barrelCap: number; water: number };

export type PipWallet = { balance: number; earned: SeedEarnings; spent: number };

/** Pip's look, home and mood, as Rust keeps it. */
export type PipState = {
  variant: string;
  outfit: string[];
  /** Room spot id -> room item id. */
  room: Record<string, string>;
  /** "" for the room's default style. */
  roomStyle: string;
  /** 0..100, already drifted to now. */
  mood: number;
  moodUpdatedAt: string;
  signature: string;
  updatedAt: string;
};

/** The part of the state the reader chooses. */
export type PipLook = Pick<PipState, "variant" | "outfit" | "room" | "roomStyle" | "signature">;

/** The arcade's record on this device: best scores, and today's mood from games. */
export type PipArcade = { best: Record<string, number>; day: string; moodToday: number };

export type PipOverview = {
  wallet: PipWallet;
  owned: Array<{ kind: ShopKind; id: string }>;
  state: PipState;
  garden: GardenView;
  /** Focus sessions done, for floors that open after so many. */
  sessionsDone: number;
  arcade: PipArcade;
  /** A new reader's first steps, in the order Pip suggests them. */
  goals: GoalStatus[];
  chest: ChestStatus;
  /** Every set, and how far along it is. */
  sets: SetStatus[];
  /** Owned out of all there are, by catalogue kind: `collection.accessory` is "Wardrobe 5/42". */
  collection: Partial<Record<ShopKind, CollectionCount>>;
  /** Today's wish (the reader's local day); null before the first wish list's day. */
  wish: WishStatus | null;
};

/**
 * Outside Tauri (the browser dev server) there is no ledger to earn from, so
 * the Pip tab shows the starting state: the welcome gift and the free things.
 */
const browserOverview = (): PipOverview => {
  const now = new Date().toISOString();
  const items = catalogue();
  // Free things, and the starter pieces of the floors everyone has.
  const freeFloors = new Set(items.filter((item) => item.kind === "level" && item.price === 0).map((item) => item.id));
  const owned = items
    .filter((item) => (item.price === 0 && !item.earnedOnly && !item.consumable && !item.freeWith) || (item.freeWith && freeFloors.has(item.freeWith)))
    .map((item) => ({ kind: item.kind, id: item.id }));
  const collection: Partial<Record<ShopKind, CollectionCount>> = {};
  for (const item of items.filter((entry) => !entry.consumable)) {
    const count = (collection[item.kind] ??= { owned: 0, total: 0 });
    count.total += 1;
    if (owned.some((entry) => entry.kind === item.kind && entry.id === item.id)) count.owned += 1;
  }
  return {
    wallet: {
      balance: 50,
      spent: 0,
      earned: { harvests: 0, goalDays: 0, streakBonus: 0, welcome: 50, earlier: 0, goals: 0, chest: 0, sets: 0, wishes: 0, total: 50 }
    },
    owned,
    state: {
      variant: DEFAULT_VARIANT,
      outfit: [],
      // The starter things are out, as Rust does for a new room.
      room: Object.fromEntries(roomItems().filter((item) => item.price === 0).map((item) => [item.id, item.id])),
      roomStyle: "",
      mood: 70,
      moodUpdatedAt: now,
      signature: DEFAULT_SIGNATURE,
      updatedAt: now
    },
    garden: { plots: 3, plants: [], barrel: 0, barrelCap: 120, water: 0 },
    sessionsDone: 0,
    arcade: { best: {}, day: "", moodToday: 0 },
    goals: GOALS.map((goal) => ({ id: goal.id, done: false, seeds: goal.seeds })),
    chest: { open: false, seeds: STARTER_CHEST.seeds, minutes: STARTER_CHEST.minutes },
    sets: SETS.map((set) => {
      const have = set.items.filter((id) => owned.some((entry) => entry.kind === set.kind && entry.id === id)).length;
      return { id: set.id, kind: set.kind, have, of: set.items.length, done: have === set.items.length, seeds: set.seeds, level: set.level ?? null };
    }),
    collection,
    // Rust chooses the wish (pip/rewards.rs); with no Rust there is none.
    wish: null
  };
};

/**
 * Pip's shop. The app names what to buy; the price is Rust's, from its copy
 * of the catalogue, and a refusal comes back as a readable message.
 */
export const pipService = {
  async overview(): Promise<PipOverview> {
    if (!isTauri()) {
      return browserOverview();
    }
    return invoke<PipOverview>("pip_state_get");
  },
  async buy(kind: ShopKind, id: string): Promise<PipOverview> {
    if (!isTauri()) {
      throw new Error("The shop needs the desktop app.");
    }
    return invoke<PipOverview>("pip_buy", { kind, id });
  },
  async setLook(look: PipLook): Promise<PipOverview> {
    if (!isTauri()) {
      throw new Error("The shop needs the desktop app.");
    }
    return invoke<PipOverview>("pip_state_set", { look });
  },
  /** Plants a seed packet in an empty plot (the packet is bought at the catalogue's price). */
  async plant(plot: number, plant: string): Promise<PipOverview> {
    if (!isTauri()) {
      throw new Error("The garden needs the desktop app.");
    }
    return invoke<PipOverview>("pip_plant", { plot, plant });
  },
  /** Picks a ripe plant for its seeds. Rust refuses one the reading has not ripened. */
  async harvest(plantingId: string): Promise<PipOverview> {
    if (!isTauri()) {
      throw new Error("The garden needs the desktop app.");
    }
    return invoke<PipOverview>("pip_harvest", { plantingId });
  },
  /** A finished arcade game: best score, and a little mood (capped a day). Never seeds. */
  async gamePlayed(game: string, score: number): Promise<PipOverview> {
    if (!isTauri()) {
      throw new Error("Scores are kept in the desktop app.");
    }
    return invoke<PipOverview>("pip_game_played", { game, score: Math.floor(score), todayKey: getDateKey() });
  },
  async feed(treatId: string): Promise<PipOverview> {
    if (!isTauri()) {
      throw new Error("The shop needs the desktop app.");
    }
    return invoke<PipOverview>("pip_feed", { treatId });
  }
};

/** A Tauri error (a plain string) or an Error, as a sentence. */
export const shopError = (cause: unknown) =>
  typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "That didn't work. Try again.";
