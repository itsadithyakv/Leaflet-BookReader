/**
 * The screens' view of the 1.5.10 rules (chapters, goals, friends' news), in one place: what the
 * top bar, the chapter card and the news card show, read off `pip/base/chapters.ts` (the contract)
 * and `pip/base/rules.ts`. Nothing here decides anything the rules decide.
 *
 */
import { barLine, chapterBrings, chapterNews, chapterProgress, goalsOf, opened, type ChapterBrings, type ChapterNews, type GoalAt, type GoalState, type Unlock } from "../../../../pip/base/chapters";
import { raidsAsked as askedYet, raidSummary, type BaseState, type RaidEnd, type RaidNews } from "../../../../pip/base/rules";
import { useBaseStore } from "../../../../store/baseStore";
import type { ChapterChip } from "./HollowTop";

export type { RaidNews };

/** The camp with its 1.5.10 fields filled in where an older camp (read before the rules caught up) has none. */
export const chaptered = (base: BaseState): BaseState => ({
  ...base,
  minutes: base.minutes ?? 0,
  legacy: base.legacy ?? null,
  goals: base.goals ?? [],
  chapterSeen: base.chapterSeen ?? -1,
  chapterPaid: base.chapterPaid ?? 0,
  news: base.news ?? []
});

/** Whether a thing is open in this camp (its chapter reached, or opened before chapters). */
export const campOpened = (base: BaseState, minutes: number, thing: Unlock): boolean => opened(chaptered(base), minutes, thing);

/** The chapter bar: the chapter, the hours, and the next goal or the reading to the next chapter. */
export const chapterChipOf = (base: BaseState, minutes: number): ChapterChip => {
  const line = barLine(chaptered(base), minutes);
  const progress = line.progress;
  return { n: progress.chapter, volume: progress.volume, read: progress.read, to: progress.next, part: progress.fraction, next: line.goal ? line.goal.text : line.text, goal: line.goal !== null };
};

/** Where the chapter's next goal is done, for a mark on the key that goes there; null with none left. */
export const chapterGoalAt = (base: BaseState, minutes: number): GoalAt | null => barLine(chaptered(base), minutes).at;

/** What the chapter card shows: where the reading has the camp, what this chapter brought, its goals, what comes next. */
export type ChapterCardView = {
  chapter: number;
  read: number;
  toGo: number;
  current: ChapterBrings;
  next: ChapterBrings;
  goals: GoalState[];
  /** Goals of earlier chapters still open (they keep: nothing expires). */
  older: GoalState[];
};
export const chapterCardOf = (base: BaseState, minutes: number): ChapterCardView => {
  const camp = chaptered(base);
  const progress = chapterProgress(camp, minutes);
  const older: GoalState[] = [];
  for (let chapter = 1; chapter < progress.chapter; chapter++) older.push(...goalsOf(camp, chapter).filter((entry) => !entry.done && !entry.ticked));
  return { chapter: progress.chapter, read: progress.read, toGo: progress.toGo, current: progress.current, next: progress.brings, goals: goalsOf(camp, progress.chapter), older };
};

/** The chapter card's one celebration (or the one-time note to a camp from before chapters); null once it is seen. */
export const chapterNewsOf = (base: BaseState, minutes: number): ChapterNews | null => chapterNews(chaptered(base), minutes);
export { chapterBrings };

/** Friends' raids not yet seen. */
export const newsOf = (base: BaseState): RaidNews[] => base.news ?? [];

/** Whether the reader has been asked if friends may raid their camp. */
export const raidsAsked = (base: BaseState): boolean => askedYet(base);

/** A raid's result in plain words. */
export const raidWords = (end: RaidEnd): string => raidSummary(end);

// ---- the store's 1.5.10 actions ---------------------------------------------------------------------------

const store = () => useBaseStore.getState();
/** The chapter card has been seen. */
export const seeChapter = () => store().seeChapter();
/** Friends' raids have been seen. */
export const seeNews = () => store().seeNews();
/** The fence a friend knocked down, put back. */
export const putBack = () => store().putBack();
/** The question about friends' raids has been asked. */
export const askedRaids = () => store().askedRaids();
/** A prowler was seen off (a chapter 3 goal counts them). */
export const seeOff = () => store().seeOff();
/** Opens every parcel: what it brought. */
export const openAllParcels = (): number => store().openAllParcels();
