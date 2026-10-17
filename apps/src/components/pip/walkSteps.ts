/**
 * The house's walkthrough: Pip points out the things to know, in the scene
 * itself, a short line each: the seeds and her mood, herself (she can be
 * poked, stroked and picked up), Play, the shop, decorating and a plot.
 * "Show me around" in the HUD plays it all; the first visit shows the shop
 * alone (`firstWalk`), once (a preference of this device).
 */
export const WALK_KEY = "leaflet.pip.houseTour";

export type WalkTarget = "resources" | "pip" | "play" | "shop" | "decorate" | "plot";

export type WalkStep = {
  /** What it points at: the element marked data-walk with this name. */
  target: WalkTarget;
  line: string;
  /** Where the bubble goes, when it fits there. */
  side: "above" | "below";
};

export const WALK: WalkStep[] = [
  { target: "resources", line: "my seeds: reading grows them, focus doubles it. the hearts are my mood: select them to see why.", side: "below" },
  { target: "pip", line: "this is me! poke me, stroke me, or pick me up by my leaf and let go.", side: "above" },
  { target: "play", line: "play has more: a ball to fetch, a tickle, a dance. it cheers me up.", side: "above" },
  { target: "shop", line: "spend seeds in the shop: looks, decor, treats, moves.", side: "above" },
  { target: "decorate", line: "decorate to move things about. make it cosy!", side: "above" },
  { target: "plot", line: "plant a seed in a plot up here. your reading waters it; pick it when it's ripe.", side: "above" }
];

/**
 * The first visit indoors shows the shop alone (since 1.5.5): Pip's guided
 * first session outside teaches the rest, and "Show me around" still plays
 * all of `WALK`.
 */
export const FIRST_WALK: WalkStep[] = WALK.filter((step) => step.target === "shop");

/** The camp's guided first session, as far as the first visit indoors cares (`CampWelcome.tutorial`). */
export type FirstSession = { step: number; done: boolean; skipped: boolean } | null | undefined;

/**
 * What the first visit indoors shows: null while the guided first session
 * is still running (it takes the reader through the shop itself; wait), none
 * when that session was finished (it showed the shop: only mark it seen),
 * and the shop's step otherwise (the session skipped, or a camp from before it).
 */
export const firstWalk = (session: FirstSession): WalkStep[] | null => {
  if (session && !session.done) return null;
  if (session && session.done && !session.skipped && session.step > 0) return [];
  return FIRST_WALK;
};

/** The next step after `from` whose target can be shown, or null when there is none. */
export const nextStep = (from: number, available: (step: WalkStep) => boolean, steps: readonly WalkStep[] = WALK) => {
  for (let index = from + 1; index < steps.length; index += 1) {
    if (available(steps[index])) return index;
  }
  return null;
};

type Store = Pick<Storage, "getItem" | "setItem">;

export const walkSeen = (store: Store | null | undefined) => {
  try {
    return store?.getItem(WALK_KEY) === "1";
  } catch {
    // Storage blocked: never nag.
    return true;
  }
};

export const markWalkSeen = (store: Store | null | undefined) => {
  try {
    store?.setItem(WALK_KEY, "1");
  } catch {
    // Remembered for this visit only.
  }
};
