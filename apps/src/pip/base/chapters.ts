/**
 * Chapters of the camp (1.5.10): the Hollow's level is the reading done.
 *
 * Ten chapters, reached by hours read in Leaflet (the same minutes ledger the
 * oak and the trophies count by), then a new volume every fifteen hours with
 * no end. Each chapter brings one new thing (`CHAPTERS`), a chest of acorns
 * (`chestOf`, paid by `settle` the moment the chapter is reached, never for a
 * chapter a camp already had when it was brought onto chapters), and two or
 * three optional goals (`GOALS`) that pay acorns too. The burrow's level
 * follows the chapter by itself (`burrowOfChapter`: it is never bought, and a
 * level a camp already has is never taken away), and every other building can
 * go as high as the burrow.
 *
 * A camp from before chapters keeps everything its burrow had opened
 * (`legacy`, captured once, when it is first read): `opened` is the chapter's
 * gate OR that floor, so nothing closes, whatever the chapter says.
 *
 * This file is the contract the screens build on. Everything here is a plain
 * function of the camp and of the minutes read in all; it imports nothing at
 * run time from `rules.ts` (only its types), so `rules.ts` can use it.
 *
 * ---------------------------------------------------------------------------
 * The rest of the 1.5.10 rules API, in `rules.ts` (and the store's actions,
 * `store/baseStore.ts`), listed here so the contract is in one place:
 *
 * Nothing expires
 *   - `holds(state)` is `Infinity` (no larder cap); `larderRoom(state)` is
 *     `Infinity`. `hides(state)` is still the share prowlers can't take.
 *   - `oakReady(state, minutes)` is everything read since the last gather
 *     (no cap); `oakLooks(state, minutes)`: 0..1, how full the tree looks
 *     (`oakHolds` is now only that). `oakStatus(...)`: "ready" | "bare".
 *   - `PARCELS_MOST` 99; `openParcels(state)` opens them all (store:
 *     `openAllParcels(): number`, the acorns it brought). `RAIDS_IN_HAND` 10,
 *     `PURSE_IN_HAND` 10.
 *   - Acorns have no top. What is saved keeps `acorns` <= `ACORNS_KEPT_MOST`
 *     (1400) and the rest in `bank` (`keptForm(state)`; `readBase` adds them
 *     back): a 1.5.9 build reading a 1.5.10 camp clamps nothing.
 *   - `Blocked` no longer has "room"; it has "chapter" (waits for a chapter:
 *     `chapterFor(state, site)` says which). The burrow is always "chapter"
 *     (or "top"): it follows the chapter.
 *
 * Raids
 *   - Supplies are free (`plan.cost` is 0). `RaidKind` adds "rematch":
 *     `rematchOf(state)`, the last stronghold taken, a sure ★★★ for small loot.
 *   - `raidForecast(state, plan): Forecast` ({ stars, words, canSend, sure }).
 *     `sendRaid` refuses (null) when `canSend` is false (0★); Send brings 75%.
 *   - `raidBoard(state, now): BoardCard[]`: Rematch, Next stronghold, the King.
 *   - 3★ on a stronghold moves the ladder one step and pays `end.bonus`.
 *     `end.fled` is always false (kept for old screens).
 *   - `raidSummary(end): string`, the result in plain words.
 *
 * Friends
 *   - `state.news: RaidNews[]` (5 at most): friends' raids not yet seen.
 *     `sufferRaids` records them and puts nobody to sleep. `seeNews(state)`
 *     (store `seeNews()`); `putBack(state)` (store `putBack()`) lays every
 *     piece of fence a friend knocked down back where it was.
 *   - `raidsAsked(state)` / `askedRaids(state)` (store `askedRaids()`): the
 *     one-time "Let friends raid your camp?" question. The server's
 *     `raidable` is off until the reader turns it on.
 *
 * Prowlers
 *   - `seenOff(state)` (store `seeOff()`): a prowler was seen off; call it
 *     when one falls (`plan.falls !== null`). It is what the chapter 3 goal
 *     "See a prowler off" counts. `prowlersCome(state)` is chapter 3 on.
 *
 * Gates and other changed helpers (all chapter-aware; `state.minutes` is the
 * most minutes the camp was told of, raised by every `settle`)
 *   - `plotOpen(state, site)`; `plotOpenAt(burrow, slot, site, legacyBurrow?)`
 *     (the scene's: pass `look.legacy?.burrow ?? 0`); `PLOT_FROM` is now
 *     { yard0: 3, yard1: 5 } in burrow levels (chapters 5 and 9).
 *   - `decorOpen` (ch 5), `meadowOpen` (ch 7), `postOpen` (ch 6),
 *     `kingClosed` says "chapter" before ch 10. `decorBlocked`/`landBlocked`
 *     can say "chapter". `workBlocked` says "chapter" (was "burrow");
 *     `workOpen(state, kind)`, `worksOpen(state)`, `worksOffered(state)` (the
 *     kinds the Defence shelf lists: `NEW_WORKS` plus whatever an old camp has
 *     or had opened). `DECOR_FROM`, `FENCE_FROM`, `GUARDS_FROM`, `MEADOW_FROM`,
 *     `POSTCARD_FROM`, `PROWLERS_FROM` are deprecated burrow figures: use
 *     `opened(state, minutes, thing)` / `CHAPTER_OF`.
 *   - `campOpens(level)` / ladder's `levelBrings(level)`: what a burrow level
 *     brings, from its two chapters. Prefer `chapterBrings(chapter)`.
 *   - `does("store", n)` says what the larder keeps safe; `hidesAt(level)`.
 *   - The old list (`QUESTS`, `quest`, `questNow`, `ladderOf`, `chipLine`) is
 *     kept up for older builds and pays nothing; `nextStep` now says the
 *     chapter's next goal (its `at` is a `QuestAt`; "decor" and "arrange" goals
 *     are given as "burrow" and "fence" there: use `barLine`/`goalNow` for the
 *     real `GoalAt`). `NextStep.full` and `Ladder.full` are always false.
 *   - `WELCOME_PAWS` is 0 (old camps keep the paws they had).
 * ---------------------------------------------------------------------------
 */
import type { BaseState, QuestAt } from "./rules";

// ---- the chapters --------------------------------------------------------------------

/**
 * Hours read at which each of the ten chapters begins (chapter 1 at 0 h). The first is a quarter of an hour, so the
 * welcome's promise is kept the same day: "read 15 minutes and your first chapter ends: the scouts arrive".
 */
export const CHAPTER_HOURS = [0, 0.25, 3, 6, 10, 15, 21, 28, 36, 45] as const;
/** The chapters with a thing of their own; after the last, a volume every `VOLUME_HOURS`. */
export const CHAPTERS_MOST = CHAPTER_HOURS.length;
export const VOLUME_HOURS = 15;

/** The chapter a camp is on for so many minutes read in all: 1, 2, … 10, then 11, 12, … (volumes 1, 2, …), with no end. */
export const chapterOf = (minutesRead: number): number => {
  const read = Math.max(0, Math.floor(Number.isFinite(minutesRead) ? minutesRead : 0));
  const last = CHAPTER_HOURS[CHAPTERS_MOST - 1] * 60;
  if (read >= last) return CHAPTERS_MOST + Math.floor((read - last) / (VOLUME_HOURS * 60));
  let chapter = 1;
  for (let at = 1; at < CHAPTERS_MOST; at++) if (read >= Math.round(CHAPTER_HOURS[at] * 60)) chapter = at + 1;
  return chapter;
};

/** Minutes read in all at which a chapter begins. */
export const chapterStartsAt = (chapter: number): number => {
  const ch = Math.max(1, Math.floor(chapter));
  return ch <= CHAPTERS_MOST ? Math.round(CHAPTER_HOURS[ch - 1] * 60) : (CHAPTER_HOURS[CHAPTERS_MOST - 1] + VOLUME_HOURS * (ch - CHAPTERS_MOST)) * 60;
};

/** Which volume a chapter is (1 for chapter 11), or null for chapters 1 to 10. */
export const volumeOf = (chapter: number): number | null => (chapter > CHAPTERS_MOST ? chapter - CHAPTERS_MOST : null);

/** The burrow's level (and so every building's top level) a chapter brings: 1 at 1, 2 at 3, 3 at 5, 4 at 7, 5 at 9. */
export const burrowOfChapter = (chapter: number): number => Math.max(1, Math.min(5, 1 + Math.floor((Math.max(1, chapter) - 1) / 2)));

/** The first chapter whose burrow is at least this level. */
export const chapterOfBurrow = (level: number): number => (level <= 1 ? 1 : Math.min(9, 2 * Math.min(5, level) - 1));

/** What a chapter can open. One word per thing. */
export type Unlock =
  | "hut"
  | "raids"
  | "lookout"
  | "prowlers"
  | "postcard"
  | "fence"
  | "arrange"
  | "yard0"
  | "decor"
  | "guards"
  | "meadow"
  | "animals"
  | "works"
  | "yard1"
  | "king"
  | "banners"
  | "clearing"
  | "volumes";

/** The chapter that opens each thing. */
export const CHAPTER_OF: Readonly<Record<Unlock, number>> = {
  hut: 2,
  raids: 2,
  lookout: 3,
  prowlers: 3,
  postcard: 3,
  fence: 4,
  arrange: 4,
  yard0: 5,
  decor: 5,
  guards: 6,
  meadow: 7,
  animals: 7,
  works: 8,
  yard1: 9,
  king: 10,
  banners: 10,
  clearing: 10,
  volumes: 11
};

/** What each thing is called, for the chapter card and the bar. */
export const UNLOCK_NAMES: Readonly<Record<Unlock, string>> = {
  hut: "The scouts' hut",
  raids: "Raids",
  lookout: "The lookout",
  prowlers: "Prowlers",
  postcard: "Postcards",
  fence: "The fence",
  arrange: "Arrange",
  yard0: "A plot in the yard",
  decor: "Decorations",
  guards: "Guardians",
  meadow: "The meadow",
  animals: "Animals",
  works: "Defences",
  yard1: "A second plot",
  king: "The Magpie King",
  banners: "Banners",
  clearing: "The whole clearing",
  volumes: "Volumes"
};

/**
 * The burrow's level at which the rules before chapters opened each thing:
 * a camp from before chapters (`legacy`) keeps whatever its level had
 * opened. (The King was opened by ten strongholds, not by a level: see
 * `legacyOpens`. Animals came by charm alone. A volume never came.)
 */
export const LEGACY_FROM: Readonly<Record<Unlock, number>> = {
  hut: 1,
  raids: 1,
  lookout: 1,
  prowlers: 2,
  postcard: 2,
  fence: 2,
  arrange: 2,
  yard0: 2,
  decor: 2,
  guards: 3,
  meadow: 3,
  animals: 1,
  works: 2,
  yard1: 3,
  king: 99,
  banners: 99,
  clearing: 5,
  volumes: 99
};
/** Strongholds that opened the King before chapters. */
export const LEGACY_KING_CAMPS = 10;

/**
 * The constructs a camp can have (1.5.11, the front): seven, each with one job, by their number in `WORKS`
 * (guards.ts), in the order their chapters bring them (`front.ts` `WORK_CHAPTER`, chapters 4 to 9).
 */
export const NEW_WORKS: readonly number[] = [8, 4, 10, 6, 2, 9, 7];

/** The minutes read the camp knows of: what it was told last (`state.minutes`), or more, if more is handed in. */
const readOf = (state: Pick<BaseState, "minutes">, minutes?: number) => Math.max(state.minutes ?? 0, Math.floor(minutes ?? 0));

/** Whether the old rules had opened a thing for a camp from before chapters. */
export const legacyOpens = (state: Pick<BaseState, "legacy" | "camps">, thing: Unlock): boolean => {
  const legacy = state.legacy;
  if (!legacy) return false;
  if (thing === "king" || thing === "banners") return state.camps >= LEGACY_KING_CAMPS;
  return legacy.burrow >= LEGACY_FROM[thing];
};

/**
 * Whether a thing is open in this camp: its chapter reached (by the minutes
 * handed in, or the most the camp was told of), or opened before chapters.
 * Every gate in the rules goes through this, so the screens and the rules
 * cannot disagree.
 */
export const opened = (state: Pick<BaseState, "legacy" | "camps" | "minutes">, minutes: number | undefined, thing: Unlock): boolean =>
  chapterOf(readOf(state, minutes)) >= CHAPTER_OF[thing] || legacyOpens(state, thing);

/** The chapter the camp is on. */
export const chapterNow = (state: Pick<BaseState, "minutes">, minutes?: number) => chapterOf(readOf(state, minutes));

// ---- what each chapter brings -----------------------------------------------------------

export type ChapterBrings = {
  chapter: number;
  /** "Chapter 4: The Fence", "Volume 2". */
  title: string;
  /** Its name alone: "The Fence". */
  name: string;
  /** The one new thing, in a line: "Fence and Arrange: lay a fence in the prowlers' way". */
  says: string;
  /** What it opens. */
  things: Unlock[];
  /** The burrow's level it raises the camp to (every building's top), or null when it raises none. */
  level: number | null;
  /** The acorns in its chest. */
  chest: number;
};

/** What chapters 1 to 10 bring; 11 on are volumes (`VOLUME`). */
export const CHAPTERS: ReadonlyArray<{ name: string; says: string; things: Unlock[] }> = [
  { name: "The Clearing", says: "The burrow, the oak and a larder", things: [] },
  { name: "The Scouts", says: "The scouts' hut, and raids on the magpies' strongholds", things: ["hut", "raids"] },
  { name: "The Lookout", says: "A lookout, and prowlers come down a trail out of the Dark Wood. Buildings can reach level 2", things: ["lookout", "prowlers", "postcard"] },
  { name: "The Fence", says: "A wall across the trail, a trap before it, and Arrange", things: ["fence", "arrange"] },
  { name: "The Yard", says: "A plot in the yard, and decorations. Buildings can reach level 3", things: ["yard0", "decor"] },
  { name: "The Guardians", says: "Guardians, one to post at each building", things: ["guards"] },
  { name: "The Meadow", says: "The meadow, where animals come to live. Buildings can reach level 4", things: ["meadow", "animals"] },
  { name: "The Defences", says: "A third trap and a second tower on the front, and the stone thrower", things: ["works"] },
  { name: "The Second Plot", says: "A second plot in the yard. Buildings can reach level 5", things: ["yard1"] },
  { name: "The Magpie King", says: "The Magpie King, once a month, and his banners", things: ["king", "banners", "clearing"] }
];
/**
 * What every volume brings (1.5.11): a standing stone in the meadow's ring with the hours carved on it, and for the
 * first six a set Pip puts out by the stones (`VOLUME_SETS`; `stones.ts`). There are no more sets after the sixth.
 */
export const VOLUME = { says: "A standing stone with your hours carved on it" } as const;
export const VOLUME_SETS: readonly string[] = ["Lanterns", "Pip reading, in stone", "Bunting", "A book stall", "The reading tree", "Winter lights"];
/** A volume's set, or null after the sixth. */
export const volumeSet = (volume: number): string | null => {
  const at = Math.max(1, Math.floor(volume));
  return at <= VOLUME_SETS.length ? VOLUME_SETS[at - 1] : null;
};
/** What a volume says it brings: the stone, and Pip's set while there are sets. */
export const volumeSays = (volume: number): string => {
  const set = volumeSet(volume);
  return set ? `${VOLUME.says}, and Pip sets out ${set.charAt(0).toLowerCase()}${set.slice(1)} by the stones` : VOLUME.says;
};

/** The acorns in each chapter's chest (by chapter: 2 to 10), and in every volume's. */
export const CHAPTER_CHESTS: readonly number[] = [0, 0, 40, 60, 90, 120, 150, 180, 220, 260, 300];
export const VOLUME_CHEST = 200;
/** The one chest a camp from before chapters gets when it is brought onto them. */
export const WELCOME_CHEST = 100;
export const chestOf = (chapter: number): number => (chapter <= 1 ? 0 : chapter <= CHAPTERS_MOST ? CHAPTER_CHESTS[chapter] : VOLUME_CHEST);

/** What a chapter brings. */
export const chapterBrings = (chapter: number): ChapterBrings => {
  const ch = Math.max(1, Math.floor(chapter));
  const volume = volumeOf(ch);
  const raises = burrowOfChapter(ch) > burrowOfChapter(ch - 1) ? burrowOfChapter(ch) : null;
  if (volume !== null) return { chapter: ch, title: `Volume ${volume}`, name: `Volume ${volume}`, says: volumeSays(volume), things: ["volumes"], level: null, chest: chestOf(ch) };
  const { name, says, things } = CHAPTERS[ch - 1];
  return { chapter: ch, title: `Chapter ${ch}: ${name}`, name, says, things: [...things], level: ch === 1 ? null : raises, chest: chestOf(ch) };
};

export type ChapterProgress = {
  /** The chapter the camp is on (11 on are volumes). */
  chapter: number;
  volume: number | null;
  /** Minutes read in all. */
  read: number;
  /** Minutes read in all when this chapter began, and when the next does. */
  from: number;
  next: number;
  /** How far through this chapter, 0 to 1. */
  fraction: number;
  /** Minutes still to read before the next. */
  toGo: number;
  /** What this chapter brought, and what the next brings. */
  current: ChapterBrings;
  brings: ChapterBrings;
};

/** Where the reading has the camp: the chapter, how far through it, and what the next brings. */
export const chapterProgress = (state: Pick<BaseState, "minutes"> | null, minutes: number): ChapterProgress => {
  const read = state ? readOf(state, minutes) : Math.max(0, Math.floor(minutes));
  const chapter = chapterOf(read);
  const from = chapterStartsAt(chapter);
  const next = chapterStartsAt(chapter + 1);
  return {
    chapter,
    volume: volumeOf(chapter),
    read,
    from,
    next,
    fraction: Math.max(0, Math.min(1, (read - from) / (next - from))),
    toGo: Math.max(0, next - read),
    current: chapterBrings(chapter),
    brings: chapterBrings(chapter + 1)
  };
};

/** "6 h 20 m", "15 m", "2 h": a stretch of reading in plain words ("1 m" at the least, never "0 m" while any is left). */
export const hoursWords = (minutes: number): string => {
  const total = Math.max(0, Math.ceil(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours === 0 ? `${mins} m` : mins === 0 ? `${hours} h` : `${hours} h ${String(mins).padStart(2, "0")} m`;
};

/** The chapter that opens a thing, for a camp: null when it is open already. */
export const comesAt = (state: Pick<BaseState, "legacy" | "camps" | "minutes">, minutes: number | undefined, thing: Unlock): number | null =>
  opened(state, minutes, thing) ? null : CHAPTER_OF[thing];

// ---- the chapter's goals ---------------------------------------------------------------------

/** Where a goal is done, for the screen to jump to: a site, the raids, the meadow, or Edit (decorate and fence). */
export type GoalAt = QuestAt | "decor" | "arrange";

export type Goal = {
  id: string;
  chapter: number;
  /** What to do, in a line ("Lay 3 pieces of fence"), and in a word or two for the bar ("Fence"). */
  text: string;
  short: string;
  /** Acorns it pays, once. */
  reward: number;
  at: GoalAt;
  /** Whether the camp has done it, as the camp itself shows. */
  done: (state: BaseState) => boolean;
};

/** Two or three optional goals a chapter (none for volumes). Each is something the camp shows it has done. */
export const GOALS: readonly Goal[] = [
  { id: "oak", chapter: 1, text: "Tap the oak to take in its acorns", short: "Tap the oak", reward: 10, at: "oak", done: (s) => s.stats.gathered > 0 },
  { id: "larder", chapter: 1, text: "Build the larder", short: "Larder", reward: 10, at: "store", done: (s) => s.levels.store >= 1 },
  { id: "basket", chapter: 1, text: "Open Pip's welcome basket", short: "Pip's basket", reward: 0, at: "burrow", done: (s) => s.welcome?.basketOpened !== false },
  { id: "hut", chapter: 2, text: "Build the scouts' hut", short: "Scouts' hut", reward: 15, at: "hut", done: (s) => s.levels.hut >= 1 },
  { id: "raid", chapter: 2, text: "Win a raid", short: "A raid", reward: 20, at: "raids", done: (s) => s.stats.raids >= 1 || s.camps >= 1 },
  { id: "lookout", chapter: 3, text: "Build the lookout", short: "Lookout", reward: 20, at: "tower", done: (s) => s.levels.tower >= 1 },
  { id: "prowler", chapter: 3, text: "See a prowler off", short: "A prowler", reward: 20, at: "tower", done: (s) => (s.stats.seenOff ?? 0) > 0 },
  { id: "fence", chapter: 4, text: "Raise the fence across the trail", short: "Fence", reward: 30, at: "fence", done: (s) => s.levels.fence >= 1 },
  { id: "strongholds3", chapter: 4, text: "Take 3 strongholds", short: "3 strongholds", reward: 30, at: "raids", done: (s) => s.camps >= 3 },
  { id: "yard", chapter: 5, text: "Build something in the yard", short: "The yard", reward: 40, at: "yard0", done: (s) => s.yard.some((slot) => slot.level > 0) },
  { id: "decor", chapter: 5, text: "Set down a decoration", short: "A decoration", reward: 20, at: "decor", done: (s) => s.decor.length + s.meadow.length + s.land.length > 0 },
  { id: "guardian", chapter: 6, text: "Post a guardian", short: "A guardian", reward: 60, at: "tower", done: (s) => s.guards.some((rank) => rank > 0) },
  { id: "strongholds6", chapter: 6, text: "Take 6 strongholds", short: "6 strongholds", reward: 50, at: "raids", done: (s) => s.camps >= 6 },
  { id: "animal", chapter: 7, text: "Make the camp charming enough for the hen", short: "The hen", reward: 60, at: "meadow", done: (s) => s.animals.length > 0 },
  { id: "meadow", chapter: 7, text: "Set something down in the meadow", short: "The meadow", reward: 30, at: "meadow", done: (s) => s.meadow.length + s.meadowLand.length > 0 },
  { id: "construct", chapter: 8, text: "Set down a construct", short: "A construct", reward: 60, at: "fence", done: (s) => s.works.length > 0 },
  { id: "strongholds10", chapter: 8, text: "Take 10 strongholds", short: "10 strongholds", reward: 80, at: "raids", done: (s) => s.camps >= 10 },
  { id: "yard2", chapter: 9, text: "Build on the second plot", short: "Second plot", reward: 80, at: "yard1", done: (s) => s.yard.filter((slot) => slot.level > 0).length >= 2 },
  { id: "guardianRank", chapter: 9, text: "Train a guardian to rank 2", short: "Guardian rank 2", reward: 80, at: "tower", done: (s) => s.guards.some((rank) => rank >= 2) },
  { id: "banner", chapter: 10, text: "Take the Magpie King's banner", short: "The King", reward: 150, at: "raids", done: (s) => s.banners.length > 0 },
  { id: "guardians7", chapter: 10, text: "Post all seven guardians", short: "Seven guardians", reward: 150, at: "tower", done: (s) => s.guards.every((rank) => rank > 0) }
];

export type GoalState = {
  goal: Goal;
  /** Done, as the camp shows it. */
  done: boolean;
  /** Ticked off: paid (or marked done without pay when the camp was brought onto chapters). */
  ticked: boolean;
};

/** A chapter's goals, each with how it stands. */
export const goalsOf = (state: BaseState, chapter: number): GoalState[] =>
  GOALS.filter((goal) => goal.chapter === chapter).map((goal) => ({ goal, done: goal.done(state), ticked: state.goals.includes(goal.id) }));

/**
 * The goal the bar shows: the first not done of this chapter and the ones
 * before it (older first); null when every one is done (the bar then reads
 * toward the next chapter: `barLine`).
 */
export const goalNow = (state: BaseState, minutes?: number): GoalState | null => {
  const chapter = chapterNow(state, minutes);
  const goal = GOALS.find((entry) => entry.chapter <= chapter && !state.goals.includes(entry.id) && !entry.done(state));
  return goal ? { goal, done: false, ticked: false } : null;
};

/**
 * The always-visible bar, in words: the next goal ("Lay 3 pieces of fence"),
 * or with none left, the reading to the next chapter ("Read 2 h 10 m:
 * chapter 6 brings guardians").
 */
export const barLine = (state: BaseState, minutes?: number): { text: string; at: GoalAt | null; goal: Goal | null; progress: ChapterProgress } => {
  const progress = chapterProgress(state, minutes ?? state.minutes);
  const now = goalNow(state, minutes);
  if (now) return { text: now.goal.text, at: now.goal.at, goal: now.goal, progress };
  const next = progress.brings;
  const what = next.things.length > 0 && next.things[0] !== "volumes" ? UNLOCK_NAMES[next.things[0]].replace(/^The /, "the ") : next.name;
  const which = next.chapter > CHAPTERS_MOST ? `volume ${next.chapter - CHAPTERS_MOST}` : `chapter ${next.chapter}`;
  const thing = next.chapter > CHAPTERS_MOST ? "a standing stone" : `${what.charAt(0).toLowerCase()}${what.slice(1)}`;
  return { text: `Read ${hoursWords(progress.toGo)}: ${which} brings ${thing}`, at: null, goal: null, progress };
};

// ---- the celebration ------------------------------------------------------------------------

export type ChapterNews = {
  /** "welcome": a camp from before chapters, brought onto them (shown once); "up": a chapter reached since the camp was last looked at. */
  kind: "welcome" | "up";
  /** The chapter reached (the newest, if more than one came at once). */
  chapter: number;
  /** The acorns its chest (or chests) brought: already in the larder. */
  chest: number;
  brings: ChapterBrings;
};

/** What the chapter card has to say once: null when it has been seen. */
export const chapterNews = (state: BaseState, minutes?: number): ChapterNews | null => {
  const chapter = Math.min(chapterNow(state, minutes), Math.max(state.chapterPaid, 1));
  if (state.chapterSeen >= chapter || state.chapterSeen < 0) return null;
  if (state.chapterSeen === 0) return { kind: "welcome", chapter, chest: WELCOME_CHEST, brings: chapterBrings(chapter) };
  let chest = 0;
  for (let ch = state.chapterSeen + 1; ch <= chapter; ch++) chest += chestOf(ch);
  return { kind: "up", chapter, chest, brings: chapterBrings(chapter) };
};

/** The chapter card has been shown: it is not shown again for this chapter. */
export const seeChapter = (state: BaseState): BaseState => {
  const chapter = Math.max(state.chapterSeen, Math.min(chapterNow(state), Math.max(state.chapterPaid, 1)));
  return chapter === state.chapterSeen ? state : { ...state, chapterSeen: chapter };
};
