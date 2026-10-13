import type { Duel } from "../../services/socialService";

/**
 * Seeds on a duel: what this device still has to tell its own ledger.
 *
 * The server only carries the number each side agreed to put up; the seeds
 * are each reader's own, on their own device (`pip/stakes.rs`). So each app
 * does two things for a staked duel, each once: puts its stake down when the
 * duel is on (accepted, by either side: a challenge nobody took up costs
 * nothing), and says how it went when it is over. What has been done is kept
 * here by duel id, so a duel is not staked or settled twice from this device
 * (Rust refuses a second time anyway; this saves the asking).
 */

/** Where a duel stands with this device's ledger. */
export type StakeStep =
  /** The stake is down. */
  | "staked"
  /** The stake could not be put down (too few seeds by then): nothing rides on it here. */
  | "skipped"
  /** Staked, and the ledger has been told how it ended. */
  | "settled";

export type StakeBook = Record<string, StakeStep>;

export const STAKES_KEY = "leaflet.duels.stakes";

/** How many duels are remembered: far more than are ever on screen at once. */
const KEPT = 60;

export const readStakeBook = (stored: string | null): StakeBook => {
  try {
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, StakeStep] => entry[1] === "staked" || entry[1] === "skipped" || entry[1] === "settled")
    );
  } catch {
    return {};
  }
};

/** The book with one duel's step noted, and only the latest duels kept. */
export const withStep = (book: StakeBook, duelId: string, step: StakeStep): StakeBook => {
  const rest = Object.entries(book).filter(([id]) => id !== duelId);
  return Object.fromEntries([...rest.slice(-(KEPT - 1)), [duelId, step]]);
};

/** What a finished duel is to the ledger. */
const outcomeOf = (duel: Duel): "won" | "lost" | "tied" | null =>
  duel.status !== "finished" ? null : duel.result === "won" ? "won" : duel.result === "lost" ? "lost" : duel.result === "tie" ? "tied" : null;

export type StakeJob = { duelId: string } & ({ do: "stake"; seeds: number } | { do: "settle"; outcome: "won" | "lost" | "tied" });

/**
 * What is still to do for the duels on screen: a stake to put down for each
 * staked duel that is on (or already over) and not yet staked here, and an
 * outcome to report for each that is over and staked. One job a duel at a
 * time: a duel that ended while the app was shut is staked now and settled
 * on the next pass.
 */
export const stakeJobs = (duels: Duel[], book: StakeBook): StakeJob[] => {
  const jobs: StakeJob[] = [];
  for (const duel of duels) {
    const seeds = Math.floor(duel.stake ?? 0);
    if (seeds <= 0 || (duel.status !== "accepted" && duel.status !== "finished")) {
      continue;
    }
    const step = book[duel.id];
    if (step === undefined) {
      jobs.push({ duelId: duel.id, do: "stake", seeds });
      continue;
    }
    const outcome = outcomeOf(duel);
    if (step === "staked" && outcome) {
      jobs.push({ duelId: duel.id, do: "settle", outcome });
    }
  }
  return jobs;
};

/** "25 seeds each", for a duel that has a stake; nothing for one that has not. */
export const stakeText = (duel: Pick<Duel, "stake">): string | null => {
  const seeds = Math.floor(duel.stake ?? 0);
  return seeds > 0 ? `${seeds} ${seeds === 1 ? "seed" : "seeds"} each` : null;
};
