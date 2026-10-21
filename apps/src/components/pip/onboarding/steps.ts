/**
 * Pip's guided first session in the Hollow: the steps, what Pip says at
 * each, and how each is known to be done.
 *
 * It keeps no state of its own. Where it has got to is the camp's
 * (`welcome.tutorial.step`, synced with the camp), and whether a step is
 * done is read from the camp as it stands (the larder is built, the basket
 * is open), so closing the app mid-step and opening it again carries on
 * from the same place, and a step done some other way is passed over.
 *
 * A replay from the (i) is a demo: every step is a "next", nothing can be
 * built or opened from it, and it grants nothing.
 *
 * Since 1.5.10 it is four steps, all in the Hollow: the oak, the larder, the
 * basket, and the reading that ends the first chapter. Pip's hello is said
 * with the oak; the burrow grows by itself with the chapters, and the door,
 * the hat and the seeds are the house's own first walk (walkSteps.ts). The
 * old steps keep their numbers (a camp keeps where it had got to), and a
 * camp saved on one of them carries on from the next step there is.
 */
import type { CampWelcome } from "./welcomeApi";

export const STEP = { hello: 0, oak: 1, larder: 2, basket: 3, burrow: 4, door: 5, hat: 6, bridge: 7 } as const;
export type StepId = keyof typeof STEP;
export const STEP_COUNT = 8;

/** The steps there are, in order (1.5.10). */
export const ORDER: readonly number[] = [STEP.oak, STEP.larder, STEP.basket, STEP.bridge];

/** What Pip says. Short, in her voice; each goes when its step is done. */
export const LINES: Record<StepId, string> = {
  hello: "this is my hollow! it's a bit bare. let's fix that.",
  oak: "this is my hollow! i shook the oak for you. tap it!",
  larder: "now a larder, for all those acorns. build it here!",
  basket: "oh! a welcome basket. for you.",
  burrow: "now my burrow. make it bigger!",
  door: "come in! wipe your feet.",
  hat: "spend seeds on me? a hat, maybe…",
  bridge: "read a little and your first chapter ends: scouts arrive!"
};

/** The last step's line, with the reading still to do before the first chapter ends ("1 h", "45 m"). */
export const bridgeLine = (toGo: string | null) => (toGo ? `read ${toGo} and your first chapter ends: scouts arrive!` : LINES.bridge);

/**
 * What Pip says in a replay from the (i), on a camp that is built already:
 * what each thing is for, not what to tap (a replay is only shown).
 */
export const REPLAY_LINES: Record<StepId, string> = {
  hello: "let me show you round again!",
  oak: "let me show you round again! reading fills my oak: tap it for acorns.",
  larder: "the larder keeps what the oak gives.",
  basket: "parcels from your reading wait by my door.",
  burrow: "raise my burrow and the clearing grows.",
  door: "tap my door to come inside.",
  hat: "spend seeds on me in the shop.",
  bridge: "every hour you read is a chapter of the camp, and each brings something new."
};

/** Lines for a moment within a step. */
export const MORE = {
  build: "tap build!",
  raise: "raise it!",
  hammer: "my friends are on it…",
  roomier: "look, more room!",
  pickHat: "ooh. that one?",
  buyHat: "buy it for me?",
  outside: "back out. i want to show it off.",
  skip: "skip? your basket will wait by the door.",
  skipLate: "skip the rest? it's in the (i) if you want it."
} as const;

export const stepId = (step: number): StepId => (Object.keys(STEP) as StepId[]).find((id) => STEP[id] === step) ?? "bridge";

/** What the camp and the page say, as far as the steps need to know. */
export type World = {
  /** The first sync pull is over (or there is no sync): the sync guard. */
  ready: boolean;
  welcome: CampWelcome | null;
  /** Acorns ever gathered from the oak. */
  gathered: number;
  store: number;
  burrow: number;
  /** A build going up on the larder or the burrow: where a helping paw goes. */
  job: "store" | "burrow" | null;
  place: "hollow" | "home";
  /** Pip has a hat on (bought in the step inside). */
  hatOn: boolean;
};

/** Whether the guided session is to be shown at all: never before the sync guard, never once it is done. */
export const running = (world: Pick<World, "ready" | "welcome">, demo = false) => {
  if (demo) return true;
  if (!world.ready || !world.welcome) return false;
  return !world.welcome.tutorial.done;
};

/** How a step is left: by Pip's "next" key, or by the reader doing the thing. */
export const advancesBy = (step: number, demo = false): "next" | "doing" => (demo || step === STEP.hello || step === STEP.bridge ? "next" : "doing");

/** Whether a step that is done by doing has been done, as the camp and the page stand. `tapped`: the oak was tapped in its step. */
export const stepDone = (step: number, world: World, tapped = false): boolean => {
  switch (step) {
    case STEP.oak:
      return tapped || world.gathered > 0 || world.store > 0;
    case STEP.larder:
      return world.store > 0;
    case STEP.basket:
      // A camp with no basket to open (the welcome not given) has nothing to wait for here.
      return world.welcome ? world.welcome.basketOpened || !world.welcome.given : true;
    case STEP.burrow:
      return world.burrow >= 2;
    case STEP.door:
      return world.place === "home" || world.hatOn;
    case STEP.hat:
      return world.hatOn && world.place === "hollow";
    default:
      return false;
  }
};

/**
 * Where to carry on from: the saved step, and on past any that are done
 * already. Never back: a step once passed is not asked again.
 */
export const resolveStep = (saved: number, world: World): number => {
  const at = Math.max(0, Math.min(STEP_COUNT - 1, Math.floor(saved)));
  // The first step there is from where the camp had got to (an old step's number goes on to the next one there is).
  let index = ORDER.findIndex((step) => step >= at);
  if (index < 0) index = ORDER.length - 1;
  while (index < ORDER.length - 1 && advancesBy(ORDER[index]) === "doing" && stepDone(ORDER[index], world)) index++;
  return ORDER[index];
};

/** The step after this one, or null after the last. */
export const nextOf = (step: number): number | null => {
  const index = ORDER.findIndex((entry) => entry > step);
  return index < 0 ? null : ORDER[index];
};

/** The steps a demo walks through: the ones out in the camp. (Inside, the house has its own walk.) */
export const DEMO_STEPS: readonly number[] = ORDER;
export const nextDemo = (step: number): number | null => {
  const at = DEMO_STEPS.indexOf(step);
  return at < 0 || at === DEMO_STEPS.length - 1 ? null : DEMO_STEPS[at + 1];
};

/** Something the welcome's store is to be asked to do for a step. */
export type Effect = { kind: "paw"; target: "store" | "burrow" };

/**
 * What a step asks of the welcome as the camp stands: a helping paw on the
 * larder and the burrow while they are going up. (The gift itself is given
 * by the camp's screen once the sync guard is down.) A demo asks for
 * nothing: it grants nothing.
 */
export const effectsOf = (step: number, world: World, demo = false): Effect[] => {
  if (demo || !world.welcome || !world.ready) return [];
  const out: Effect[] = [];
  if (world.welcome.paws > 0 && world.job && ((step === STEP.larder && world.job === "store") || (step === STEP.burrow && world.job === "burrow"))) out.push({ kind: "paw", target: world.job });
  return out;
};

/** The door into the burrow takes one tap: during the tour, only once the tour has got to it. */
export const doorOpen = (step: number | null, demo = false) => step === null || (!demo && step >= STEP.door);
