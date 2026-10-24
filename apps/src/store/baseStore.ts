import { create } from "zustand";
import {
  buyWork,
  gotThrough,
  nightOver,
  seeArrival,
  seatWork,
  slideWall,
  type FrontSlot,
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
  SITES,
  keptForm,
  openParcels,
  putBack,
  seeNews,
  seenOff,
  askedRaids,
  type Place
} from "../pip/base/rules";
import { seeChapter } from "../pip/base/chapters";
import type { Result, Squad } from "../pip/base/battle";
import { markScouted } from "../pip/base/lands";
import { trophyKind } from "../pip/base/trophies";
import { learnt, noTips } from "../pip/base/tips";
import { finishTutorial, giveWelcome, openWelcomeBasket, pawFinish, setTutorialStep } from "../pip/base/welcome";
import { hasFinished } from "../constants/books";
import { baseService } from "../services/baseService";
import { syncService } from "../services/syncService";
import { syncConfigured, syncFor } from "../services/syncTiming";
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
  /** Takes in what the oak has, as far as the larder has room; says how many acorns came in (0: nothing, or no room). */
  gather: () => number;
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
  /** (1.5.11) The front: buy a construct (onto the first free slot of its sort, or the shed), put one on a slot (-1 takes it off), slide the wall. */
  buyWork: (kind: number) => void;
  seatWork: (slot: FrontSlot, kind: number) => void;
  slideWall: (x: number) => void;
  /** A night watched to its end: held or not. What it paid (the first after some reading, held), in acorns. */
  nightOver: (held: boolean) => number;
  /** (1.5.11) The camp has been arrived at, after reading: what came since is not shown again. */
  seeArrival: () => void;
  /** A kind of prowler got through (Pip has a word about it, once). */
  gotThrough: (role: Parameters<typeof gotThrough>[1]) => void;
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
  /** Sets out on a raid the reader will fight; null when it cannot set out. With a squad, planned (the Magpie Lands). */
  startRaid: (kind: RaidKind, slot: number, tip: boolean, squad?: Squad) => Raid | null;
  /** A stronghold has been scouted: the map shows its quirk from now on. */
  markScouted: (n: number) => void;
  /** The raid is over: what came of it. */
  finishRaid: (raid: Raid, result: Result) => RaidEnd | null;
  /** Sets out for a friend's camp; null when the scouts cannot go. And the end of that raid. */
  startFriendRaid: (camp: SharedCamp, friend: Friend, squad?: Squad) => FriendRaid | null;
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
  /** Opens every parcel waiting ("Open all"); says how many acorns they brought. */
  openAllParcels: () => number;
  /** The chapter card was shown (`chapterNews`): not shown again for this chapter. */
  seeChapter: () => void;
  /** The friends'-raids card was shown (`state.news`). */
  seeNews: () => void;
  /** Lays the pieces of fence friends knocked down back where they were. */
  putBack: () => void;
  /** A prowler was seen off while the camp was watched (for the chapter's goal). */
  seeOff: () => void;
  /** "Let friends raid your camp?" has been asked (whatever the answer): it is not asked again. */
  askedRaids: () => void;
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

  /**
   * The sync guard. True once this run has pulled from wherever the library
   * syncs to (Drive, a folder, the account), or there is nowhere: until then
   * a camp not kept on this device is not saved (its stamp would be newer
   * than a camp of months on another device, and win), and the welcome does
   * not begin. A camp kept here saves as ever.
   */
  welcomeReady: boolean;
  /** Pip's welcome (`pip/base/welcome.ts`): the oak shaken and the basket by the door, once a camp; nothing before `welcomeReady`. */
  giveWelcome: () => void;
  /** The basket's acorns, once, when the larder has room for all of them. */
  openWelcomeBasket: () => void;
  /** A helping paw on a site: what is going up there (built first, if nothing is) stands at once. False when no paw was spent. Never adds reading. */
  usePaw: (target: string) => boolean;
  /** The same as `usePaw`, by a name the app's rules-of-hooks check does not take for a hook (`testing/rulesOfHooks.test.ts`). */
  spendPaw: (target: string) => boolean;
  /** The guided first session: where it has got to; and its end, finished or skipped (skipped, the basket still waits, once). */
  setTutorialStep: (step: number) => void;
  finishTutorial: (skipped: boolean) => void;
  /** The session again, from the (i): a demonstration, kept out of the camp; it gives nothing. Over at `finishTutorial`. */
  replayTutorial: () => void;
  /** The replay under way, and its step; null when none is. */
  tutorialReplay: { step: number } | null;
};

let opening: Promise<void> | null = null;
/**
 * The changes made while `opening` reads the kept camp: made to the camp in
 * hand, so done again on the one read. Without them the read put back the
 * camp as it was before them (on a phone the read is slower than the Hollow
 * coming up: the welcome it gave was undone, and the tour's Next did nothing).
 */
let changedWhileOpening: Array<(base: BaseState, now: Now) => BaseState> | null = null;

/** The camp in hand is the one kept on this device (read from it, or saved since). */
let keptHere = false;
/** Changes to a camp not kept here, waiting for the sync guard. */
let heldBack = false;
let guarding: Promise<void> | null = null;
let listening = false;
/** How long after the camp is first opened a pull is asked for, if nothing else has started one: the launch's own sync goes first. */
export const GUARD_PULL_AFTER_MS = 2000;

/**
 * Whether the first pull this run has finished: a sync that ended well. A
 * run that only said the library is another account's, or that the account
 * holds a library still to be brought (`accountHolds`), merged nothing, and
 * ends "idle", not "success".
 */
const pulled = () => useLibraryStore.getState().syncStatus === "success";

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
      keep(next);
      changedWhileOpening?.push(act);
    }
    return next;
  };

  /** Saves the camp, unless it is one not kept here and the guard is still up: then it waits (`ready`). */
  const keep = (base: BaseState) => {
    if (!keptHere && !get().welcomeReady) {
      heldBack = true;
      return;
    }
    keptHere = true;
    heldBack = false;
    // Saved with no more than 1400 in `acorns` and the rest in `bank`, so a 1.5.9 build that reads it cuts nothing.
    void baseService.save(keptForm(base)).catch(() => undefined);
  };

  /** The guard is down: the camp is read again (the pull may have brought one), and what waited is kept if it did not. */
  const ready = () => {
    if (get().welcomeReady) return;
    set({ welcomeReady: true });
    void get().open();
  };

  /** Puts the guard down when it can be: at once with nowhere to sync to, or when the first pull this run has finished. */
  const guard = (): Promise<void> => {
    if (get().welcomeReady) return Promise.resolve();
    if (!listening) {
      listening = true;
      useLibraryStore.subscribe((state, previous) => {
        // Looked at once the run has said all it will: "success" can be followed at once by "idle" (see `pulled`).
        if (state.syncStatus === "success" && previous.syncStatus !== "success") queueMicrotask(() => void guard());
      });
    }
    guarding ??= syncService
      .status()
      .then((status) => {
        if (!syncConfigured(status) || pulled()) {
          ready();
          return;
        }
        // Nothing has pulled yet: a pull, as before a book opens (never two at once, and not again soon after one).
        setTimeout(() => void syncFor("open"), GUARD_PULL_AFTER_MS);
      })
      .catch(() => undefined)
      .finally(() => {
        guarding = null;
      });
    return guarding;
  };

  /** A helping paw on a site (`usePaw`). Settled again at once, so the building stands now (and the list pays for it), not at the next look. */
  const paw = (target: string): boolean => {
    const site = SITES.find((entry) => entry === target);
    const before = get().base?.welcome.paws ?? 0;
    if (!site || before <= 0 || get().tutorialReplay) return false;
    const after = change((base, now) => settle(pawFinish(base, site, now.minutes, now.mood), now));
    return (after?.welcome.paws ?? before) < before;
  };

  return {
    base: null,
    welcomeReady: false,
    tutorialReplay: null,
    open() {
      void guard();
      if (!opening) changedWhileOpening = [];
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
          let base = settle(adopt(from, finished, now.minutes), now);
          // What was done while it was read, done again on the camp read (the camp in hand has it already).
          const since = changedWhileOpening ?? [];
          changedWhileOpening = null;
          if (kept) for (const act of since) base = advanceList(act(settle(base, now), now), now.day);
          set({ base });
          if (kept) {
            keptHere = true;
            heldBack = false;
          }
          // A new camp is not kept until something is done with it: kept at once, its date
          // would be newer than a camp of months on another computer, and the backup would
          // take this empty one for the one to keep. And not before the first pull (`welcomeReady`).
          if ((kept && base !== kept) || (!kept && heldBack)) keep(base);
        })
        .finally(() => {
          opening = null;
          changedWhileOpening = null;
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
      // Paid for and standing at once (1.5.8: a building's work is part of its price), with the camp's news of it.
      change((base, now) => build(base, site, now.minutes, kind, now.mood, now.day));
    },
    giveWelcome() {
      if (!get().welcomeReady) return;
      change((base, now) => giveWelcome(base, now.minutes));
    },
    openWelcomeBasket() {
      change((base, now) => openWelcomeBasket(base, now.day));
    },
    usePaw: (target) => paw(target),
    spendPaw: (target) => paw(target),
    setTutorialStep(step) {
      if (get().tutorialReplay) {
        set({ tutorialReplay: { step: Math.max(0, Math.floor(step)) } });
        return;
      }
      change((base) => setTutorialStep(base, step));
    },
    finishTutorial(skipped) {
      if (get().tutorialReplay) {
        set({ tutorialReplay: null });
        return;
      }
      if (!get().welcomeReady) return;
      change((base, now) => finishTutorial(base, skipped, now.minutes));
    },
    replayTutorial() {
      set({ tutorialReplay: { step: 0 } });
    },
    clearPlot(site) {
      change((base) => clearPlot(base, site));
    },
    gather() {
      // What the oak itself gave, every bonus counted, against the camp as it stands now (settled, as `change` has it):
      // the screen shows this, never a figure worked out on its own copy. (What the list pays for it comes after.)
      let got = 0;
      change((base, now) => {
        const next = gather(base, now.minutes, now.streak ?? 0, now.day);
        got = next.acorns - base.acorns;
        return next;
      });
      return got;
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
      // Trained at once (1.5.8): settled again so the rank is there now.
      change((base, now) => settle(trainGuard(base, guard, now.minutes), now));
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
    buyWork(kind) {
      change((base) => buyWork(base, kind));
    },
    seatWork(slot, kind) {
      change((base) => seatWork(base, slot, kind));
    },
    slideWall(x) {
      change((base) => slideWall(base, x));
    },
    nightOver(held) {
      let paid = 0;
      change((base, now) => {
        const over = nightOver(base, held, now.minutes, now.day);
        paid = over.bounty;
        return over.state;
      });
      return paid;
    },
    gotThrough(role) {
      change((base) => gotThrough(base, role));
    },
    seeArrival() {
      change((base, now) => seeArrival(base, now.minutes));
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
    startRaid(kind, slot, tip, squad) {
      let raid: Raid | null = null;
      change((base, now) => {
        const begun = startRaid(base, kind, now, tip, slot, squad);
        raid = begun?.raid ?? null;
        return begun?.state ?? base;
      });
      return raid;
    },
    markScouted(n) {
      change((base) => markScouted(base, n));
    },
    startFriendRaid(camp, friend, squad) {
      let raid: FriendRaid | null = null;
      change((base, now) => {
        const begun = startFriendRaid(base, camp, friend, now, squad);
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
    openAllParcels() {
      let got = 0;
      change((base) => {
        const next = openParcels(base);
        got = next.acorns - base.acorns;
        return next;
      });
      return got;
    },
    seeChapter() {
      change((base) => seeChapter(base));
    },
    seeNews() {
      change((base) => seeNews(base));
    },
    putBack() {
      change((base) => putBack(base));
    },
    seeOff() {
      change((base) => seenOff(base));
    },
    askedRaids() {
      change((base) => askedRaids(base));
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
