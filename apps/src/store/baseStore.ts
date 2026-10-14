import { create } from "zustand";
import {
  adopt,
  advanceList,
  afterGame,
  build,
  chooseHero,
  claimClub,
  clearPlot,
  finishRaid,
  finishFriendRaid,
  fixSite,
  robSite,
  openParcel,
  moveWall,
  setGate,
  storyRead,
  harmSite,
  movePost,
  woundFighter,
  startFriendRaid,
  sufferRaids,
  type Friend,
  type FriendRaid,
  type SharedCamp,
  gather,
  moveDecor,
  moveSite,
  newBase,
  placeDecor,
  placeWall,
  raise,
  removeDecor,
  removeWall,
  sendRaid,
  settle,
  startRaid,
  type BaseState,
  type GameEnd,
  type Now,
  type PayingGame,
  type Placed,
  type Raid,
  type RaidEnd,
  type RaidKind,
  type Site,
  type YardKind,
  trainGuard,
  placeLand,
  moveLand,
  removeLand,
  placeWork,
  armHero,
  type Place
} from "../pip/base/rules";
import type { Result } from "../pip/base/battle";
import { trophyKind } from "../pip/base/trophies";
import { learnt, noTips } from "../pip/base/tips";
import { hasFinished } from "../constants/books";
import { baseService } from "../services/baseService";
import { getDateKey, type HabitSnapshot } from "../services/habitService";
import { useHabitStore } from "./habitStore";
import { useLibraryStore } from "./libraryStore";

/**
 * The Hollow as the app holds it: the camp, brought up to now each time it
 * is looked at or acted on (a building the reading finished goes up, a night
 * that passed is played), and kept after every change.
 *
 * The rules are `pip/base/rules.ts`; this only hands them what they cannot
 * know: the minutes read in all, the day, the streak, and whether the goal
 * was met (today's for tonight's lantern, yesterday's for last night's).
 */

/** Minutes read in focus on every day there is a record of: what buildings, the oak and the scouts' rest count by. */
export const minutesRead = (snapshot: Pick<HabitSnapshot, "days">) => Math.floor(snapshot.days.reduce((sum, day) => sum + Math.max(0, day.minutes), 0));

const dayBefore = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return getDateKey(new Date(year, month - 1, date - 1));
};

/** What the rules are told, from the reading as it stands. */
export const nowFrom = (snapshot: HabitSnapshot, day = getDateKey()): Now => {
  const yesterday = snapshot.days.find((entry) => entry.dateKey === dayBefore(day));
  return {
    minutes: minutesRead(snapshot),
    day,
    lit: Boolean(yesterday && yesterday.goalMinutes > 0 && yesterday.minutes >= yesterday.goalMinutes),
    streak: snapshot.streak,
    today: snapshot.todayMinutes,
    goalMet: snapshot.todayMet
  };
};

/** Pip's mood in her house, 0 to 100, as the arcade was last told it: what she brings to the camp. Not known until then. */
let moodAtHome: number | undefined;
export const campNow = (): Now => ({ ...nowFrom(useHabitStore.getState().snapshot), ...(moodAtHome === undefined ? {} : { mood: moodAtHome }), at: Date.now() });

type BaseStore = {
  /** Null until the camp has been read (or made, the first time). */
  base: BaseState | null;
  /**
   * Reads the camp and brings it up to now; makes one the first time. Read
   * afresh every time the arcade opens: a backup that ran since may have
   * brought a camp from another computer, and writing this one's older copy
   * over it would lose it.
   */
  open: () => Promise<void>;
  /** Pip's mood at home, 0 to 100, for the camp to know: told by the page her house is on. */
  mood: number | undefined;
  setMood: (mood: number | undefined) => void;
  /** Brings the camp up to now: after reading, or a day turning with the arcade open. */
  refresh: () => void;
  build: (site: Site, kind?: YardKind) => void;
  clearPlot: (site: Site) => void;
  gather: () => void;
  /** Things set down, in the camp or in the meadow. */
  placeDecor: (kind: number, x: number, y: number, place?: Place) => void;
  moveDecor: (index: number, x: number, y: number, place?: Place) => void;
  removeDecor: (index: number, place?: Place) => void;
  /** Begins a guardian's training to their next rank. */
  trainGuard: (guard: number) => void;
  /** Landscape, in the camp or the meadow; a construct, bought the first time and moved after; a hero's blade (-1 for none). */
  placeLand: (kind: number, x: number, y: number, place?: Place) => void;
  moveLand: (index: number, x: number, y: number, place?: Place) => void;
  removeLand: (index: number, place?: Place) => void;
  placeWork: (kind: number, x: number, y: number) => void;
  armHero: (hero: number, blade: number) => void;
  /** Where things stand: a building moved, a piece of fence put down or taken up. */
  moveSite: (site: Placed, x: number, y: number) => void;
  placeWall: (x: number, y: number) => void;
  removeWall: (index: number) => void;
  /** Who goes on raids; null for nobody. */
  chooseHero: (id: number | null) => void;
  /** Raises a finished book's trophy: of the kind its genres make it. */
  raise: (bookId: string, title: string, genres?: readonly unknown[] | null) => void;
  claimClub: (clubId: string, week: string, reward: number) => void;
  /** Sets out on a raid the reader will fight; null when it cannot set out. */
  startRaid: (kind: RaidKind, slot: number, tip: boolean) => Raid | null;
  /** The raid is over: what came of it. */
  finishRaid: (raid: Raid, result: Result) => RaidEnd | null;
  /** Sets out for a friend's camp; null when the scouts cannot go. And the end of that raid. */
  startFriendRaid: (camp: SharedCamp, friend: Friend) => FriendRaid | null;
  finishFriendRaid: (raid: FriendRaid, result: Result) => RaidEnd | null;
  /** One of the camp's fighters took a knock from a prowler he did not finish. */
  woundFighter: (who: number) => void;
  /** A guardian's signpost carried somewhere else. */
  movePost: (guard: number, x: number, y: number) => void;
  /** A prowler got to a building; and a building put right for acorns. */
  harmSite: (site: Placed) => void;
  fixSite: (site: Placed) => void;
  /** One of Pip's tips has been seen to (see `tips.ts`). */
  learn: (tip: string) => void;
  /** The reader wants no more of them. */
  noTips: () => void;
  /** The reading has got to another stretch of a book (see `storyFeed.ts`). Opens the camp first if it has not been. */
  storyRead: (bookId: string, stretch: number, title: string) => void;
  /** Opens one of the parcels that came from the reading. */
  openParcel: () => void;
  /** Makes the gate of the piece of fence at a point, or an ordinary piece of it again. */
  setGate: (x: number, y: number) => void;
  /** Moves a piece of fence to another square. */
  moveWall: (index: number, x: number, y: number) => void;
  /** A prowler who was not stopped makes off with a few acorns from the larder or the oak; says how many. */
  robSite: (site: Placed) => number;
  /** Friends' raids on this camp, as the server hands them over. */
  sufferRaids: (raids: ReadonlyArray<{ name: string; stars: number }>) => void;
  /** Sends the scouts without the reader; null when they cannot go. */
  sendRaid: (kind: RaidKind, slot: number) => RaidEnd | null;
  /** A finished arcade game: what it paid (and how a wager placed before wagers were put away went); null before there is a camp. */
  played: (game: PayingGame, score: number) => Pick<GameEnd, "paid" | "wager"> | null;
};

let opening: Promise<void> | null = null;

export const useBaseStore = create<BaseStore>((set, get) => {
  /** Applies a change to the camp as it stands now, and keeps the result if it differs. */
  const change = (act: (base: BaseState, now: Now) => BaseState): BaseState | null => {
    const current = get().base;
    if (!current) return null;
    const now = campNow();
    // Brought up to now first; and after, the list ticks off whatever the change has done (`advanceList`).
    const next = advanceList(act(settle(current, now), now), now.day);
    if (next !== current) {
      set({ base: next });
      void baseService.save(next).catch(() => undefined);
    }
    return next;
  };

  return {
    base: null,
    open() {
      opening ??= baseService
        .load()
        .then((kept) => {
          const now = campNow();
          // A camp not yet kept (looked at, never touched) is carried on with, not made again.
          const from = kept ?? get().base ?? newBase(now.minutes, now.day);
          // The books finished before the camp was made get their trophies without the gift.
          const finished = useLibraryStore
            .getState()
            .books.filter(hasFinished)
            .map((book) => ({ id: book.id, kind: trophyKind(book.genres) }));
          const base = settle(adopt(from, finished, now.minutes), now);
          set({ base });
          // A new camp is not kept until something is done with it: kept at once, its date
          // would be newer than a camp of months on another computer, and the backup would
          // take this empty one for the one to keep.
          if (kept && base !== kept) void baseService.save(base).catch(() => undefined);
        })
        .finally(() => {
          opening = null;
        });
      return opening;
    },
    refresh() {
      change((base) => base);
    },
    mood: undefined,
    setMood(mood) {
      moodAtHome = mood;
      if (get().mood !== mood) set({ mood });
    },
    build(site, kind) {
      change((base, now) => build(base, site, now.minutes, kind, now.mood));
    },
    clearPlot(site) {
      change((base) => clearPlot(base, site));
    },
    gather() {
      change((base, now) => gather(base, now.minutes, now.streak ?? 0, now.day));
    },
    placeDecor(kind, x, y, place = "camp") {
      change((base) => placeDecor(base, kind, x, y, place));
    },
    moveDecor(index, x, y, place = "camp") {
      change((base) => moveDecor(base, index, x, y, place));
    },
    removeDecor(index, place = "camp") {
      change((base) => removeDecor(base, index, place));
    },
    trainGuard(guard) {
      change((base, now) => trainGuard(base, guard, now.minutes));
    },
    placeLand(kind, x, y, place = "camp") {
      change((base) => placeLand(base, kind, x, y, place));
    },
    moveLand(index, x, y, place = "camp") {
      change((base) => moveLand(base, index, x, y, place));
    },
    removeLand(index, place = "camp") {
      change((base) => removeLand(base, index, place));
    },
    placeWork(kind, x, y) {
      change((base) => placeWork(base, kind, x, y));
    },
    armHero(hero, blade) {
      change((base) => armHero(base, hero, blade));
    },
    moveSite(site, x, y) {
      change((base) => moveSite(base, site, x, y));
    },
    placeWall(x, y) {
      change((base) => placeWall(base, x, y));
    },
    removeWall(index) {
      change((base) => removeWall(base, index));
    },
    chooseHero(id) {
      change((base) => chooseHero(base, id));
    },
    raise(bookId, title, genres) {
      change((base, now) => raise(base, bookId, title, now.day, trophyKind(genres), now.minutes));
    },
    claimClub(clubId, week, reward) {
      change((base, now) => claimClub(base, clubId, week, reward, now.day));
    },
    startRaid(kind, slot, tip) {
      let raid: Raid | null = null;
      change((base, now) => {
        const begun = startRaid(base, kind, now, tip, slot);
        raid = begun?.raid ?? null;
        return begun?.state ?? base;
      });
      return raid;
    },
    startFriendRaid(camp, friend) {
      let raid: FriendRaid | null = null;
      change((base, now) => {
        const begun = startFriendRaid(base, camp, friend, now);
        raid = begun?.raid ?? null;
        return begun?.state ?? base;
      });
      return raid;
    },
    finishFriendRaid(raid, result) {
      let end: RaidEnd | null = null;
      change((base, now) => {
        const ended = finishFriendRaid(base, raid, result, now.day, now.at);
        end = ended.end;
        return ended.state;
      });
      return end;
    },
    woundFighter(who) {
      change((base, now) => woundFighter(base, who, Date.now(), now.day));
    },
    movePost(guard, x, y) {
      change((base) => movePost(base, guard, x, y));
    },
    harmSite(site) {
      change((base, now) => harmSite(base, site, now.day));
    },
    robSite(site) {
      let taken = 0;
      change((base, now) => {
        const robbed = robSite(base, site, now.minutes, now.day);
        taken = robbed.taken;
        return robbed.state;
      });
      return taken;
    },
    storyRead(bookId, stretch, title) {
      // The camp may never have been opened this run: reading does not wait for it, and it is read in when it is wanted.
      void (get().base ? Promise.resolve() : get().open()).then(() => {
        change((base, now) => storyRead(base, bookId, stretch, now.minutes, now.day, title));
      });
    },
    openParcel() {
      change((base) => openParcel(base));
    },
    moveWall(index, x, y) {
      change((base) => moveWall(base, index, x, y));
    },
    setGate(x, y) {
      change((base) => setGate(base, x, y));
    },
    learn(tip) {
      change((base) => learnt(base, tip));
    },
    noTips() {
      change((base) => noTips(base));
    },
    fixSite(site) {
      change((base, now) => fixSite(base, site, now.day));
    },
    sufferRaids(raids) {
      change((base, now) => sufferRaids(base, raids, now.minutes, now.day, Date.now()));
    },
    finishRaid(raid, result) {
      let end: RaidEnd | null = null;
      change((base, now) => {
        const ended = finishRaid(base, raid, result, now.day, 1, now.at);
        end = ended.end;
        return ended.state;
      });
      return end;
    },
    sendRaid(kind, slot) {
      let end: RaidEnd | null = null;
      change((base, now) => {
        const sent = sendRaid(base, kind, now, slot);
        end = sent?.end ?? null;
        return sent?.state ?? base;
      });
      return end;
    },
    played(game, score) {
      let came: Pick<GameEnd, "paid" | "wager"> | null = null;
      change((base, now) => {
        const ended = afterGame(base, game, score, now);
        came = { paid: ended.paid, wager: ended.wager };
        return ended.state;
      });
      return came;
    }
  };
});
