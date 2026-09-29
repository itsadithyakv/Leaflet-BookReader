/**
 * The Pip tab's first-visit walkthrough: Pip points out the four things to
 * know, in the scene itself, in four short lines. Shown once (a preference
 * of this device); "Show me around" in the HUD plays it again.
 */
export const WALK_KEY = "leaflet.pip.houseTour";

export type WalkTarget = "resources" | "shop" | "decorate" | "plot";

export type WalkStep = {
  /** What it points at: the element marked data-walk with this name. */
  target: WalkTarget;
  line: string;
  /** Where the bubble goes, when it fits there. */
  side: "above" | "below";
};

export const WALK: WalkStep[] = [
  { target: "resources", line: "these are your seeds. reading in focus grows them. the hearts are my mood.", side: "below" },
  { target: "shop", line: "spend seeds in the shop: looks, decor, treats, moves.", side: "above" },
  { target: "decorate", line: "decorate to move things about. make it cosy!", side: "above" },
  { target: "plot", line: "plant a seed in a plot up here. your reading waters it; pick it when it's ripe.", side: "above" }
];

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
