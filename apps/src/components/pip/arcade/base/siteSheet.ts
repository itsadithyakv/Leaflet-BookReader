/**
 * What a building's sheet says (BaseScreen: a building tapped in the
 * picture, or chosen from a list): its name and level, what it does now in
 * a line, and its next level: what that brings, what it needs (the acorns,
 * as have / need, and the chapter it waits for), and the one key that builds
 * it, with the reason it cannot yet when it cannot.
 *
 * Read off the rules (`pip/base/rules.ts`), so the sheet cannot promise one
 * thing and the camp do another. Since 1.5.8 acorns are the only thing a
 * building costs, and it stands as soon as it is paid for. Since 1.5.10 the
 * burrow is never bought: it grows with the chapters (`pip/base/chapters.ts`),
 * and a level is said as what it lets you see ("Reaches the oak"), not as a
 * bare number.
 */
import { chapterBrings, chapterOfBurrow, opened, type Unlock } from "../../../../pip/base/chapters";
import { TRAIL_Y, trailOf, wallXAt } from "../../../../pip/base/front";
import { offBy } from "./wave";
import {
  BUILDING_NAMES,
  YARD_KINDS,
  YARD_NAMES,
  blocked,
  burrowFor,
  campStructures,
  chapterFor,
  does,
  fencePieces,
  hides,
  leftWoodOf,
  levelOf,
  oakDrops,
  plotOpen,
  priceOf,
  scoutsOf,
  siteName,
  topOf,
  yardDoes,
  type BaseState,
  type BuildingId,
  type Placed,
  type Site,
  type YardKind
} from "../../../../pip/base/rules";

/** One thing the next level needs, and whether the camp has it. */
export type Need = {
  id: "acorns" | "chapter" | "fix" | "free" | "mend";
  /** As the sheet shows it: "55 / 80", "Chapter 3". */
  label: string;
  ok: boolean;
  have?: number;
  need?: number;
};

export type NextLevel = {
  to: number;
  /** What the next level does that can be seen, in a line ("Reaches the oak", "2 more scouts"). */
  brings: string;
  price: number;
  needs: Need[];
};

export type SiteSheet = {
  site: Site;
  name: string;
  level: number;
  top: number;
  /** What it does as it is, in one short line. */
  now: string;
  /** Null at the top level, and for the burrow (it grows by itself: `grows`). */
  next: NextLevel | null;
  /** The burrow: the chapter that raises it next, and what that chapter brings. */
  grows: { chapter: number; level: number; title: string } | null;
  /** The key: "Build" or "Upgrade", its price, and why not (null when it can). Null at the top, for the burrow, and on an empty plot (it has a key for each thing it could be). */
  action: { label: "Build" | "Upgrade"; price: number; why: string | null } | null;
};

const yardOf = (base: BaseState, site: Site) => (site === "yard0" ? base.yard[0] : site === "yard1" ? base.yard[1] : null);
const atLevel = (base: BaseState, site: Site, level: number): BaseState =>
  site === "yard0" || site === "yard1"
    ? { ...base, yard: base.yard.map((slot, index) => (index === (site === "yard0" ? 0 : 1) ? { ...slot, level } : slot)) as BaseState["yard"] }
    : { ...base, levels: { ...base.levels, [site]: level } };

/** Before prowlers have come out of the wood (chapter 3), nothing on a sheet speaks of them. */
const prowlersOpen = (base: BaseState) => opened(base, undefined, "prowlers" as Unlock);

/**
 * (1.5.11) Where a building stands to the trail: a thrower whose reach takes in the trail in front of the wall "covers
 * the trail"; one that does not is "too far from the trail"; and anything standing on the trail's side of the wall is
 * "outside the wall" (a camp brought onto the front keeps its buildings where they were).
 */
export const trailWord = (base: BaseState, site: Placed): "covers" | "far" | "outside" | null => {
  if (!prowlersOpen(base) || levelOf(base, site) === 0) return null;
  const [x, y] = base.spots[site];
  if (x < wallXAt(base.front.x, y)) return "outside";
  const me = campStructures(base, false).find((entry) => entry.look?.name === site);
  if (!me || me.range <= 0) return null;
  const trail = trailOf(leftWoodOf(base), base.front.x);
  for (let at = 1; at < trail.length; at++) {
    const [ax, ay] = trail[at - 1];
    const [bx, by] = trail[at];
    for (let step = 0; step <= 10; step++) {
      const px = ax + ((bx - ax) * step) / 10;
      const py = ay + ((by - ay) * step) / 10;
      if (px < 0) continue;
      if (offBy(px - me.x, py - me.y) <= me.range + me.r) return "covers";
    }
  }
  return "far";
};
const TRAIL_WORDS = { covers: "covers the trail", far: "too far from the trail", outside: "outside the wall" } as const;
const withTrail = (base: BaseState, site: Site, line: string) => {
  if (site === "yard0" || site === "yard1" || site === "fence") return line;
  const word = trailWord(base, site as Placed);
  return word ? `${line} · ${TRAIL_WORDS[word]}` : line;
};
void TRAIL_Y;

/** What a site does at a level, in a line. */
export const doesAt = (base: BaseState, site: Site, level: number): string => withTrail(base, site, doesPlain(base, site, level));
const doesPlain = (base: BaseState, site: Site, level: number): string => {
  const yard = yardOf(base, site);
  if (yard) return yard.kind ? yardDoes(yard.kind, level) : "Room for a workshop, the bees, or a well";
  if (site === "burrow") return level >= topOf("burrow") ? "Pip's home. Everything can reach its top level" : `Pip's home. Everything else can reach level ${Math.max(1, level)}`;
  if (site === "store" && !prowlersOpen(base)) return level === 0 ? "Keeps the camp's acorns" : "Keeps the camp's acorns";
  if (site === "tower" && level > 0) {
    const sees = [...reached(atLevel(base, site, level), "tower")];
    return sees.length > 0 ? `Throws at prowlers; reaches ${named(base, sees)}` : "Keeps watch, and throws at prowlers";
  }
  if (site === "hut" && !prowlersOpen(base)) return level === 0 ? "Scouts to raid with" : `${scoutsOf(atLevel(base, site, level))} scouts to raid with`;
  return does(site as BuildingId, level);
};

/** The buildings a thrower standing where it is reaches, at the camp as given. */
const reached = (camp: BaseState, from: Placed): Set<Placed> => {
  const all = campStructures(camp, false);
  const me = all.find((entry) => entry.look?.name === from);
  const out = new Set<Placed>();
  if (!me || me.range <= 0) return out;
  for (const site of ["burrow", "oak", "store", "tower", "hut", "yard0", "yard1"] as const) {
    if (site === from || levelOf(camp, site) === 0) continue;
    const [x, y] = camp.spots[site];
    if (Math.hypot(x - me.x, y - me.y) <= me.range + me.r) out.add(site);
  }
  return out;
};
const named = (base: BaseState, sites: Placed[]) => {
  const names = sites.map((site) => `the ${siteName(base, site).toLowerCase()}`);
  if (names.length > 3) return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/** How far a thrower reaches now and a level up, in art pixels from its foot, for the ring drawn on the picture. */
export const reachOf = (base: BaseState, site: Placed, level: number): { x: number; y: number; r: number } | null => {
  const entry = campStructures(atLevel(base, site, level), false).find((one) => one.look?.name === site);
  return entry && entry.range > 0 ? { x: entry.x, y: entry.y, r: entry.range + entry.r } : null;
};

/**
 * What the next level brings, said as what can be seen or counted in the camp: "Reaches the oak and the larder",
 * "2 more scouts, and slingers", "6 more pieces of fence", "Drops 13 acorns every 10 minutes read (now 8)".
 */
export const levelSays = (base: BaseState, site: Site, to: number): string => {
  const from = levelOf(base, site);
  if (yardOf(base, site)) return doesAt(base, site, to);
  const up = atLevel(base, site, to);
  switch (site) {
    case "tower": {
      if (from === 0) return "Keeps watch, and throws at prowlers";
      const before = reached(base, "tower");
      const after = [...reached(up, "tower")].filter((one) => !before.has(one));
      return after.length > 0 ? `Throws further: reaches ${named(base, after)}` : "Throws further and harder";
    }
    case "hut": {
      if (from === 0) return "Scouts to raid with";
      const more = scoutsOf(up) - scoutsOf(base);
      const now = does("hut", from);
      const then = does("hut", to);
      const joins = then.includes("moles") && !now.includes("moles") ? ", and moles join them" : then.includes("slingers") && !now.includes("slingers") ? ", and slingers join them" : "";
      return `${more} more ${more === 1 ? "scout" : "scouts"}, each stronger${joins}`;
    }
    case "oak":
      if (from === 0) return "Drops acorns as you read";
      return `Drops ${Math.round(oakDrops(up))} acorns every 10 minutes read (now ${Math.round(oakDrops(base))})`;
    case "store":
      if (from === 0) return prowlersOpen(base) ? `Keeps ${hides(up)} acorns safe from prowlers` : "Keeps the camp's acorns";
      return prowlersOpen(base) ? `Keeps ${hides(up)} acorns safe from prowlers (now ${hides(base)})` : "A bigger larder";
    case "fence": {
      if (from === 0) return "A wall across the trail, a few stakes to begin with";
      const more = fencePieces(up) - fencePieces(base);
      const gate = from < 2 && to >= 2 ? ", with a gatehouse that throws" : "";
      const stone = from < 4 && to >= 4 ? ", in stone" : "";
      return more > 0 ? `${more} more ${more === 1 ? "section" : "sections"}${gate}${stone}, tougher` : `Tougher${stone}${level5(to)}${to > 2 ? ", and its gatehouse throws quicker" : ""}`;
    }
    default:
      return doesAt(base, site, to);
  }
};

const level5 = (to: number) => (to >= 5 ? ", with battlements" : "");

/**
 * The needs of a site's next level, in the order they are met: the chapter it waits for, the acorns themselves.
 * Things a camp seldom meets (a prowler's knocks, something still going up) are only listed when they are in the way.
 */
export const needsOf = (base: BaseState, site: Site, kind?: YardKind, mood?: number): Need[] => {
  const to = levelOf(base, site) + 1;
  const price = priceOf(base, site, to, mood);
  const why = blocked(base, site, kind, mood);
  const needs: Need[] = [];
  if (why === "harm") needs.push({ id: "fix", label: "Fix it first", ok: false });
  if (why === "mend") needs.push({ id: "mend", label: "The fence is being mended", ok: false });
  if (why === "busy") needs.push({ id: "free", label: "Pip is busy building", ok: false });
  const chapter = chapterFor(base, site);
  if (chapter > 1) needs.push({ id: "chapter", label: `Chapter ${chapter}`, ok: why !== "chapter", need: chapter });
  needs.push({ id: "acorns", label: `${base.acorns} / ${price}`, ok: base.acorns >= price, have: base.acorns, need: price });
  return needs;
};

/** Why the key cannot be pressed, in a few words; null when it can. */
export const whyNot = (base: BaseState, site: Site, kind?: YardKind, mood?: number): string | null => {
  const why = blocked(base, site, kind, mood);
  const to = levelOf(base, site) + 1;
  const price = priceOf(base, site, to, mood);
  switch (why) {
    case null:
      return null;
    case "top":
      return "It is as good as it gets";
    case "harm":
      return "A prowler knocked it about: fix it first";
    case "mend":
      return "Pip is mending the fence";
    case "busy":
      return "Pip is busy building";
    case "chapter":
      return `Comes with chapter ${chapterFor(base, site)}: keep reading`;
    case "taken":
      return "Choose what to build here";
    case "acorns":
      return `${price - base.acorns} more ${price - base.acorns === 1 ? "acorn" : "acorns"}`;
    default:
      return null;
  }
};

/** The sheet for a site, as the camp stands. */
export const sheetOf = (base: BaseState, site: Site, mood?: number): SiteSheet => {
  const level = levelOf(base, site);
  const top = topOf(site);
  const yard = yardOf(base, site);
  const name = yard ? siteName(base, site) : BUILDING_NAMES[site as BuildingId];
  const now = level === 0 ? (yard && !yard.kind ? doesAt(base, site, 1) : "Not built yet") : doesAt(base, site, level);
  if (site === "burrow") {
    // It grows with the reading, by itself: the chapter that raises it next, and what that chapter is.
    if (level >= top) return { site, name, level, top, now, next: null, grows: null, action: null };
    const chapter = chapterOfBurrow(level + 1);
    return { site, name, level, top, now, next: null, grows: { chapter, level: level + 1, title: chapterBrings(chapter).title }, action: null };
  }
  if (level >= top) return { site, name, level, top, now, next: null, grows: null, action: null };
  const to = level + 1;
  const empty = yard !== null && !yard.kind;
  const price = priceOf(base, site, to, mood);
  const next: NextLevel = {
    to,
    brings: empty ? "Choose what goes up here" : levelSays(base, site, to),
    price,
    needs: empty ? [] : needsOf(base, site, undefined, mood)
  };
  return { site, name, level, top, now, next, grows: null, action: empty ? null : { label: level === 0 ? "Build" : "Upgrade", price, why: whyNot(base, site, undefined, mood) } };
};

/** What can go up on an empty plot of the yard: each thing it could be, what it does, its price, and why not. */
export type PlotChoice = { kind: YardKind; name: string; does: string; price: number; why: string | null };
export const plotChoices = (base: BaseState, site: Site, mood?: number): PlotChoice[] => {
  const yard = yardOf(base, site);
  if (!yard || yard.kind || !plotOpen(base, site)) return [];
  // (The market stall paid the arcade's games more: not offered since 2026-10-15. One already built stays.)
  return YARD_KINDS.filter((kind) => kind !== "stall" && !base.yard.some((slot) => slot.kind === kind)).map((kind) => ({
    kind,
    name: YARD_NAMES[kind],
    does: yardDoes(kind, 1),
    price: priceOf(base, site, 1, mood),
    why: whyNot(base, site, kind, mood)
  }));
};

/** A plot of the yard that has not come yet: the chapter that brings it. Null for any other site, or one that is there. */
export const plotComesAt = (base: BaseState, site: Site): number | null =>
  (site === "yard0" || site === "yard1") && !plotOpen(base, site) ? chapterFor(base, site) : null;

/** (Kept for older callers: the burrow level a site waits for.) */
export const burrowNeeded = (base: BaseState, site: Site) => burrowFor(base, site);
