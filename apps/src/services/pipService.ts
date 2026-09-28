import { invoke, isTauri } from "@tauri-apps/api/core";
import { getDateKey } from "./habitService";
import type { ShopKind } from "../pip/shop";
import { DEFAULT_SIGNATURE, DEFAULT_VARIANT, catalogue, roomItems } from "../pip/shop";

/** Where a reader's seeds came from (see `habit/seeds.rs`). */
export type SeedEarnings = {
  /** Picked in the garden. */
  harvests: number;
  goalDays: number;
  streakBonus: number;
  welcome: number;
  /** Paid straight from minutes, before the garden. */
  earlier: number;
  total: number;
};

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
};

/**
 * Outside Tauri (the browser dev server) there is no ledger to earn from, so
 * the Pip tab shows the starting state: the welcome gift and the free things.
 */
const browserOverview = (): PipOverview => {
  const now = new Date().toISOString();
  return {
    wallet: {
      balance: 50,
      spent: 0,
      earned: { harvests: 0, goalDays: 0, streakBonus: 0, welcome: 50, earlier: 0, total: 50 }
    },
    owned: catalogue()
      .filter((item) => item.price === 0 && !item.earnedOnly && !item.consumable)
      .map((item) => ({ kind: item.kind, id: item.id })),
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
    arcade: { best: {}, day: "", moodToday: 0 }
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
