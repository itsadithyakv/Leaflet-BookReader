/**
 * Pip's list as a ladder: the burrow is the spine. The list (`QUESTS` in
 * `rules.ts`) is cut into groups, one for each level of the burrow, and
 * raising the burrow is the last step of each. The camp shows the group it
 * is on as one chip ("Burrow 2 · 2/5 · next: Lookout"), and the list itself
 * when the chip is tapped: that group's steps, why a step cannot be done yet,
 * and at most three named things the next level brings.
 *
 * What a level has not brought yet is held back: the list never shows a
 * later group, and what a level brings is said in plain words (a bigger
 * clearing, visitors from the wood), not by the names it has once it is here.
 * Nothing here has a clock: progress goes forward by reading, or by acorns
 * that reading earned, and being away loses nothing.
 */
import { ANIMALS } from "./guards";
import {
  MAX_LEVEL,
  QUESTS,
  blocked,
  burrowFor,
  campOpens,
  charm,
  costOf,
  holds,
  jobLeft,
  jobOn,
  levelOf,
  raidsReady,
  restIn,
  rewardOf,
  type BaseState,
  type OpenKind,
  type Quest,
  type Site
} from "./rules";

/** A group of the list: the steps that take the burrow to `to` (null for the last group, after level 5). */
export type LadderGroup = { to: number | null; from: number; end: number };

/** The list cut at each raising of the burrow: index `from` up to (not including) `end`. */
export const ladderGroups = (quests: readonly Quest[] = QUESTS): LadderGroup[] => {
  const groups: LadderGroup[] = [];
  let from = 0;
  quests.forEach((quest, index) => {
    if (quest.raise === undefined) return;
    groups.push({ to: quest.raise, from, end: index + 1 });
    from = index + 1;
  });
  if (from < quests.length) groups.push({ to: null, from, end: quests.length });
  return groups;
};

/** The group a place on the list is in; past the end of the list, null. */
export const groupAt = (index: number, quests: readonly Quest[] = QUESTS): LadderGroup | null =>
  ladderGroups(quests).find((group) => index >= group.from && index < group.end) ?? null;

export type StepState = "done" | "now" | "later";
export type LadderStep = {
  quest: Quest;
  index: number;
  state: StepState;
  /** What it pays this camp (nothing for what an older list already paid). */
  reward: number;
  /** Why it cannot be done yet, or how long it has to go, in a line; null when it can be done now. */
  why: string | null;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The plot of the camp a step is built on, for the steps that are a building's level. */
const siteFor = (state: BaseState, quest: Quest): Site | null => {
  if (quest.raise !== undefined) return "burrow";
  if (quest.id === "larder") return "store";
  if (quest.id === "hut") return "hut";
  if (quest.id === "lookout") return "tower";
  if (quest.id === "fence") return state.levels.fence === 0 ? "fence" : null;
  if (quest.id === "yard") return state.yard.every((slot) => slot.level === 0) ? "yard0" : null;
  return null;
};

/**
 * Why a step cannot be done now, in plain words (for its (i) and its
 * title): what is building and how much reading it wants, what the larder
 * would have to hold, how many acorns are missing, what level it waits for.
 */
export const stepWhy = (state: BaseState, quest: Quest, minutesRead: number): string | null => {
  if (quest.done(state)) return null;
  const site = siteFor(state, quest);
  if (site) {
    const job = jobOn(state, site);
    if (job) {
      const left = jobLeft(job, minutesRead);
      return left > 0 ? `Going up: ${plural(left, "more minute")} of reading` : null;
    }
    const to = levelOf(state, site) + 1;
    const cost = costOf(site, to);
    switch (blocked(state, site)) {
      case "room":
        return `Needs a larder that holds ${cost}: it holds ${holds(state)}`;
      case "acorns":
        return `${plural(cost - state.acorns, "more acorn")}`;
      case "burrow":
        return `Needs the burrow at level ${burrowFor(state, site)}`;
      case "busy":
        return "Pip is building something else";
      case "harm":
        return "Fix it first";
      case "mend":
        return "Pip is mending the fence";
      default:
        return null;
    }
  }
  if (quest.at === "raids" && raidsReady(state, minutesRead) === 0) return `The scouts are resting: ${plural(restIn(state, minutesRead), "more minute")} of reading`;
  if (quest.id === "strongholds5" || quest.id === "strongholds10") return `${state.camps} of ${quest.id === "strongholds5" ? 5 : 10} taken`;
  if (quest.id === "animal") {
    const first = [...ANIMALS].sort((a, b) => a.charm - b.charm)[0];
    return first && charm(state) < first.charm ? `Charm ${charm(state)} of ${first.charm}` : null;
  }
  return null;
};

/** A thing a level brings, named in plain words, for the list. */
export type Brought = { kind: OpenKind; name: string; says: string; which?: number };

/** Which kinds come first when a level brings more than three. */
const FIRST: readonly OpenKind[] = ["ground", "guards", "plot", "meadow", "fence", "decor", "foe", "work", "postcard", "top"];
const SAYS: Record<OpenKind, string> = {
  ground: "More ground to build on",
  plot: "Room for one more building in the yard",
  decor: "Decorations, ponds and knolls",
  meadow: "A second clearing, for animals",
  guards: "Someone to keep watch at each building",
  paths: "New ways through the wood",
  work: "More ways to defend the camp",
  foe: "Now and then, visitors come out of the wood",
  top: "The yard's buildings go a level higher",
  fence: "To keep visitors out",
  postcard: "A picture of your camp to share"
};

/**
 * At most three things a level brings, each with a name, in plain words:
 * the constructs are one thing ("New defences") and so are whoever comes out
 * of the wood ("Visitors from the wood"), and none is named before its level.
 */
export const levelBrings = (level: number, most = 3): Brought[] => {
  if (level < 2 || level > MAX_LEVEL) return [];
  const seen = new Set<OpenKind>();
  const all: Brought[] = [];
  for (const entry of campOpens(level)) {
    if (seen.has(entry.kind)) continue;
    seen.add(entry.kind);
    const name =
      entry.kind === "ground"
        ? entry.name === "The whole clearing"
          ? "The whole clearing"
          : "A bigger clearing"
        : entry.kind === "foe"
          ? "Visitors from the wood"
          : entry.kind === "work"
            ? "New defences"
            : entry.kind === "fence"
              ? "A fence"
              : entry.kind === "top"
                ? "Bigger yard buildings"
                : entry.name;
    all.push({ kind: entry.kind, name, says: SAYS[entry.kind], which: entry.which });
  }
  return all.sort((a, b) => FIRST.indexOf(a.kind) - FIRST.indexOf(b.kind)).slice(0, most);
};

export type Ladder = {
  /** The camp's level: the burrow's. */
  level: number;
  /** The group the camp is on; null once the whole list is done. */
  group: LadderGroup | null;
  steps: LadderStep[];
  /** Of the group's steps, how many are done. */
  done: number;
  total: number;
  /** The step the list is on. */
  next: LadderStep | null;
  /** The step is done, but the larder has no room for what it pays: it waits. */
  full: boolean;
  /** What the level the group raises the burrow to brings: three named things at most. */
  brings: Brought[];
};

/** Where the camp is on the ladder: the group it is on, each step's state, and what the next level brings. */
export const ladderOf = (state: BaseState, minutesRead: number): Ladder => {
  const group = groupAt(state.quest);
  const steps: LadderStep[] = group
    ? QUESTS.slice(group.from, group.end).map((quest, offset) => {
        const index = group.from + offset;
        const done = index < state.quest || quest.done(state);
        return {
          quest,
          index,
          state: index === state.quest && !done ? "now" : done ? "done" : "later",
          reward: rewardOf(state, quest),
          why: done ? null : stepWhy(state, quest, minutesRead)
        };
      })
    : [];
  const now = steps.find((step) => step.index === state.quest) ?? null;
  const full = Boolean(now && now.quest.done(state) && now.reward > 0);
  return {
    level: state.levels.burrow,
    group,
    steps,
    done: steps.filter((step) => step.state === "done").length,
    total: steps.length,
    next: now,
    full,
    brings: group?.to ? levelBrings(group.to) : []
  };
};

/** The chip's words: "Burrow 2 · 2/5 · next: Lookout" (the reward goes beside it, with an acorn). */
export const chipLine = (ladder: Ladder): string =>
  ladder.next ? `Burrow ${ladder.level} · ${ladder.done}/${ladder.total} · next: ${ladder.next.quest.short}` : `Burrow ${ladder.level}`;

/**
 * Whether Pip's guided first session is running in this camp (`welcome` is
 * kept with the camp from 1.5.5): while it is, the chip keeps quiet.
 */
export const tutorialRunning = (state: BaseState | null | undefined): boolean =>
  (state as { welcome?: { tutorial?: { done?: boolean } } } | null | undefined)?.welcome?.tutorial?.done === false;
