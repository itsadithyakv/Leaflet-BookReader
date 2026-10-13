import { invoke, isTauri } from "@tauri-apps/api/core";
import { shopError, type PipOverview } from "./pipService";
import { usePipWardrobeStore } from "../store/pipWardrobeStore";

/**
 * What seeds do besides dressing Pip: buy a streak freeze, back a promise to
 * oneself (a stake on the week's goal), ride on a duel, and buy a friend a
 * present.
 *
 * The rules and the prices are Rust's (`pip/freezes.rs`, `pip/stakes.rs`,
 * `pip/gifts.rs`): each call names what the reader wants and takes back the
 * whole overview, which is put in the wardrobe store like any purchase, so
 * the balance on screen is the one Rust worked out. None of it is stored as
 * a number: a stake is a record, and whether it was won is read from the day
 * ledger every time.
 */

/** The reader's level, from the seeds reading has ever earned (spent or not). */
export type Level = { level: number; earned: number; floor: number; next: number };

/** The streak freezes seeds can buy: the price, and how many more may be bought and held. */
export type FreezeShop = { price: number; boughtThisMonth: number; perMonth: number; held: number; cap: number };

/** A stake on a week's goal, as it stands. `payout` is what a win pays (0 once lost). */
export type GoalStake = { weekKey: string; seeds: number; days: number; met: number; state: "open" | "won" | "lost"; payout: number };

export type StakeRules = {
  minSeeds: number;
  maxSeeds: number;
  minDays: number;
  maxDays: number;
  /** The last weekday a goal stake may be placed on: 1 is Monday. */
  lastWeekday: number;
  duelMinSeeds: number;
  duelMaxSeeds: number;
  /** Minutes a day needs to count towards a goal stake. */
  dayMinutes: number;
  /** What a won goal stake adds, in hundredths of it, for each day beyond two. */
  gainPerDay: number;
  duelWinTimes: number;
};

/** What this build's overview carries beyond the wardrobe's own type. */
export type SeedExtras = {
  level?: Level;
  freezes?: FreezeShop;
  goalStake?: GoalStake | null;
  stakeRules?: StakeRules;
};

export const seedExtras = (overview: PipOverview | null): SeedExtras => (overview ?? {}) as SeedExtras;

/**
 * What a goal stake of `seeds` on `days` days pays if won: the stake back and
 * a share on top that grows with the days promised. Rust's rule
 * (`GoalStake::prize`), repeated here only to say it before the bet is placed.
 */
export const goalPrize = (seeds: number, days: number, rules: Pick<StakeRules, "gainPerDay">): number =>
  seeds + Math.max(1, Math.floor((seeds * (days - 2) * rules.gainPerDay) / 100));

const NEEDS_APP = "This needs the desktop app.";

/** Runs a command that answers with the overview, and puts the answer in the store. */
const run = async (command: string, args: Record<string, unknown>): Promise<PipOverview> => {
  if (!isTauri()) {
    throw new Error(NEEDS_APP);
  }
  try {
    const overview = await invoke<PipOverview>(command, args);
    usePipWardrobeStore.setState({ overview });
    return overview;
  } catch (cause) {
    throw new Error(shopError(cause));
  }
};

export const seedService = {
  /** Buys one streak freeze, on the reader's local day. */
  buyFreeze: (todayKey: string) => run("pip_buy_freeze", { todayKey }),

  /** Stakes seeds on meeting the daily goal on so many days of this week. */
  stakeGoal: (seeds: number, days: number, todayKey: string) => run("pip_stake_goal", { seeds, days, todayKey }),

  /** Puts this reader's seeds on a duel. A second call for the same duel changes nothing. */
  stakeDuel: (duelId: string, seeds: number) => run("pip_stake_duel", { duelId, seeds }),

  /** Tells the ledger how a staked duel went. A second call for the same duel changes nothing. */
  settleDuel: (duelId: string, outcome: "won" | "lost" | "tied") => run("pip_settle_duel", { duelId, outcome }),

  /** Pays for a thing sent to a friend; `giftId` is the server's id for the gift. */
  sendGift: (kind: string, id: string, to: string, giftId: string) => run("pip_send_gift", { kind, id, to, giftId }),

  /** Unwraps a thing a friend sent: it is Pip's from now on. */
  receiveGift: (kind: string, id: string, giftId: string) => run("pip_receive_gift", { kind, id, giftId })
};
