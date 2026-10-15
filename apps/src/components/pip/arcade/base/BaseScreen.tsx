import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Flower2,
  Hammer,
  Heart,
  House,
  Info,
  Lightbulb,
  ListChecks,
  Lock,
  Moon,
  Move,
  Nut,
  Send,
  Shield,
  ShieldAlert,
  Signpost,
  BedDouble,
  Camera,
  DoorOpen,
  Package,
  Sparkles,
  Star,
  Swords,
  Tent,
  TreePine,
  Trees,
  UserX,
  Users,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import {
  BUILDINGS,
  GUARDS_FROM,
  bladeOf,
  bladesWon,
  drillLeft,
  landBlocked,
  workBlocked,
  guardAt,
  guardBlocked,
  guardCost,
  guardMinutes,
  guardOf,
  meadowOpen,
  DECOR,
  PLACED,
  PLOT_FROM,
  POST_REACH,
  WOUNDS_MOST,
  asleepUntil,
  postSpotOf,
  sleepers,
  woundsOf,
  FRIEND_PRIZE,
  HARM_MOST,
  fixCost,
  footOf,
  isBroken,
  TROPHY_MINUTES,
  trophyWaits,
  GATE_FROM,
  gateOf,
  parcelGives,
  wallMoveBlocked,
  BROKEN_DOES,
  WORN_DOES,
  SEASONS,
  hasBed,
  lodgers,
  friendBlocked,
  harmOf,
  harmed,
  wreckLeft,
  type FriendRaid,
  DECOR_FROM,
  MEADOW_FROM,
  FENCE_FROM,
  KING_NEEDS_CAMPS,
  POSTCARD_FROM,
  PROWLERS_FROM,
  TALES,
  gatherBrings,
  litTonight,
  nextStep,
  PARCELS_MOST,
  QUESTS,
  campOpens,
  decorOpen,
  plotOpen,
  MAX_LEVEL,
  standing as sitesStanding,
  type Opened,
  RAIDS_IN_HAND,
  RAID_EVERY,
  SENT_SHARE,
  SITES,
  TROPHY_GIVES,
  YARD_KINDS,
  YARD_NAMES,
  blocked,
  burrowFor,
  campStructures,
  championName,
  charm,
  clubBoss,
  clubClaimed,
  costOf,
  decorBlocked,
  does,
  fencePieces,
  heroHere,
  holds,
  jobLeft,
  jobOn,
  kingClosed,
  levelOf,
  minutesOf,
  monthName,
  monthOf,
  nextCamp,
  oakHolds,
  oakReady,
  raidBlocked,
  raidsReady,
  restIn,
  scoutsOf,
  scoutsSay,
  seasonOf,
  siteName,
  spotBlocked,
  streakAdds,
  theKing,
  topOf,
  wallAt,
  wallBlocked,
  moodQuicker,
  oakDrops,
  residents,
  yardDoes,
  type BaseState,
  type Blocked,
  type GuardBlocked,
  type Place,
  type Now,
  type Placed,
  type QuestAt,
  type Raid,
  type RaidBlocked,
  type RaidEnd,
  type RaidKind,
  type RaidPlan,
  type Site,
  type YardKind
} from "../../../../pip/base/rules";
import { ANIMALS, BLADES, GUARDIANS, GUARD_MOST, SCENERY, WORKS, bladeSays, type Guardian } from "../../../../pip/base/guards";
import { HEROES, heroWants } from "../../../../pip/base/heroes";
import { TROPHY_KINDS, toRaise, trophyKind, trophyRow } from "../../../../pip/base/trophies";
import { tipNow } from "../../../../pip/base/tips";
import { finishedOn, hasFinished } from "../../../../constants/books";
import { FEATURES } from "../../../../constants/features";
import { socialService, type RaidTarget } from "../../../../services/socialService";
import { friendsService, type Club } from "../../../../services/friendsService";
import { useAccountStore } from "../../../../store/accountStore";
import { useCommunityStore } from "../../../community/communityStore";

// The postcard is its own piece: nobody pays for it who never asks for one.
const HollowPostcard = lazy(() => import("./HollowPostcard").then((module) => ({ default: module.HollowPostcard })));
import { nowFrom, useBaseStore } from "../../../../store/baseStore";
import { useBackFallback } from "../../../../platform/back";
import { useHabitStore } from "../../../../store/habitStore";
import { useLibraryStore } from "../../../../store/libraryStore";
import { weekKeyOf } from "../../../community/ownRow";
import { askConfirm } from "../../../ConfirmDialog";
import { playSound, useSoundOn } from "../../../../pip/sound";
import { gameArt } from "../gameArt";
import { GAME_H, GAME_W } from "../games";
import { BattleScreen } from "./BattleScreen";
import { drawAt, fitPicture, screenRatio, type Fit } from "./fit";
import { PipFace, Sprite } from "./Sprite";
import { ART_FPS, AWAKE_SECONDS, GENRE_FOE, PROWLER_NAMES, PROWL_EVERY, parcelAtPoint, prowlPlanOf, trophyAtPoint, BANNERS_SHOWN, RESIDENTS_SHOWN, TROPHIES_SHOWN, animalAt, decorAt, duskAt, gardenAt, guardAtPoint, postAtPoint, landAt, paintCamp, paintGround, paintSky, siteAt, workAt, type CampExtras, type CampLook } from "./scene";

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** How long the burst over a finished building takes. */
const BURST_FRAMES = 8;

const WHY_NOT: Record<Blocked, (base: BaseState, site: Site) => string> = {
  top: () => "As good as it gets",
  mend: (base) => `Pip is mending the fence after ${base.wreck?.by ?? "a friend"}'s raid`,
  harm: () => "Fix what the prowler did first",
  busy: (base, site) => (jobOn(base, site) ? "Going up" : base.jobs.length > 1 ? "Both builders are busy" : `Pip is busy with the ${siteName(base, base.jobs[0].site).toLowerCase()}`),
  burrow: (base, site) => `Needs a level ${burrowFor(base, site)} burrow`,
  taken: () => "Choose what to build",
  room: () => "Needs a bigger larder",
  acorns: (base, site) => `${costOf(site, levelOf(base, site) + 1) - base.acorns} more acorns`
};

const WHY_NO_GUARD: Record<GuardBlocked, (base: BaseState, guard: number) => string> = {
  top: () => "",
  post: (base, guard) =>
    base.levels.burrow < GUARDS_FROM ? `Comes to a level ${GUARDS_FROM} burrow` : GUARDIANS[guard].post === "fence" ? "Put a piece of fence down first" : "Needs this at level 2",
  busy: (base) => `${GUARDIANS[base.drill?.guard ?? 0].short} is in training`,
  acorns: (base, guard) => `${guardCost(guardOf(base, guard) + 1) - base.acorns} more acorns`
};

const WHY_NO_RAID: Record<RaidBlocked, (base: BaseState, plan: RaidPlan, now: Now) => string> = {
  hut: () => "Needs a scouts' hut",
  rest: (base, _plan, now) => `Scouts rested after ${restIn(base, now.minutes)} more min of reading`,
  acorns: (base, plan) => `${plan.cost - base.acorns} more acorns`,
  camps: () => `After ${KING_NEEDS_CAMPS} strongholds`,
  won: (_base, _plan, now) => `${monthName(monthOf(now.day))}'s banner is won`,
  today: () => "Once a day",
  done: () => "Raided today"
};

/** An amount of acorns, as the acorn and a number. */
const acorns = (count: number | string, size = 12) => (
  <span className="pip-base-acorns">
    <Nut size={size} aria-hidden />
    {count}
    <span className="sr-only"> acorns</span>
  </span>
);


const stars = (count: number, size = 14) => (
  <span className="pip-base-stars" aria-label={`${count} of 3 stars`}>
    {[0, 1, 2].map((index) => (
      <Star key={index} size={size} aria-hidden fill={index < count ? "currentColor" : "none"} className={index < count ? "is-won" : ""} />
    ))}
  </span>
);

type Tab = "camp" | "raids" | "journal";
/** What the card under the picture is about: the chosen plot, who lives here, things to set down, a guardian, or the garden. */
type Panel = "site" | "people" | "decor" | "guard" | "garden";

/**
 * The picture is the page. Where Pip's tab is at least this wide and tall,
 * the clearing fills it and everything else (what the camp has, Pip's word,
 * the row of keys, whatever is opened) is laid over the picture; in a
 * smaller window the picture is hung first and the rest follows under it.
 */
const STAGE_WIDE = 820;
const STAGE_TALL = 460;
/** A phone on its side: a window at most this tall, and a page at least this wide and tall, is a stage too. */
const PHONE_TALL = 520;
const PHONE_WIDE = 480;
const PHONE_MIN_TALL = 220;
/** Sideways (a phone on its side): the column down the right of the picture, for Pip's word and the keys, is at least this wide (less on a small phone)... */
const SIDE_COLUMN = 236;
const SIDE_COLUMN_SMALL = 204;
/** ...and the picture and the column have this between them, and the frame round the picture this much (touch.css). */
const SIDE_GAP = 12;
const SIDE_FRAME_X = 16;
const SIDE_FRAME_Y = 22;

/**
 * The room for the picture on a page wider than tall and too short for the
 * stage: the height of the scrolling page it is on, less what is above it, and
 * the width less the column beside it. Null where the page is not that shape
 * (upright, or too narrow for a column beside a picture worth having).
 */
const sidewaysRoom = (root: HTMLElement): { wide: number; tall: number } | null => {
  if (typeof window === "undefined" || window.innerWidth <= window.innerHeight || window.innerHeight >= STAGE_TALL + 120) return null;
  let scroller: HTMLElement | null = root.parentElement;
  while (scroller && scroller !== document.body) {
    const flow = getComputedStyle(scroller).overflowY;
    if (flow === "auto" || flow === "scroll") break;
    scroller = scroller.parentElement;
  }
  if (!scroller || scroller === document.body) return null;
  const own = getComputedStyle(scroller);
  const mine = getComputedStyle(root);
  const box = scroller.getBoundingClientRect();
  // Where the page begins in the scroller's content, and what of its height the padding (its own, and the scroller's) takes.
  const above = Math.max(0, root.getBoundingClientRect().top - box.top + scroller.scrollTop - parseFloat(own.paddingTop));
  const tall = scroller.clientHeight - parseFloat(own.paddingTop) - parseFloat(own.paddingBottom) - above - parseFloat(mine.paddingTop) - parseFloat(mine.paddingBottom) - SIDE_FRAME_Y;
  const across = root.clientWidth - parseFloat(mine.paddingLeft) - parseFloat(mine.paddingRight);
  const wide = across - (across < 600 ? SIDE_COLUMN_SMALL : SIDE_COLUMN) - SIDE_GAP - SIDE_FRAME_X;
  if (wide < 260 || tall < 120) return null;
  return { wide, tall };
};
/** Art pixels of sky there may be above the clearing: more than this is not a sky but a gap. */
const SKY_MOST = 90;
/** Screen pixels the row of keys takes at the foot of the picture: that much more ground is laid for it to stand on, where the page is tall enough. */
const DOCK_TALL = 88;

/** The garden, as the camp is told of it: how many beds, how many growing and how many ripe, and the way to it. */
export type CampGarden = { plots: number; growing: number; ripe: number; onOpen: () => void };

/**
 * Everything there is to build, post or buy is on one of four shelves, by
 * what it is for: what the camp runs on, what keeps the night out, who
 * lives here, and what is there only to be looked at. Which shelf is open
 * follows from what is chosen, so a building tapped in the picture opens
 * its own.
 */
type Shelf = "camp" | "defence" | "heroes" | "decor";
const SHELVES: ReadonlyArray<{ id: Shelf; name: string; says: string; icon: typeof House }> = [
  { id: "camp", name: "Camp", says: "What the camp runs on: the burrow, the oak, the larder and the yard", icon: House },
  { id: "defence", name: "Defence", says: "What keeps the night out: the fence, the lookout and the constructs", icon: Shield },
  { id: "heroes", name: "People", says: "Everyone in the camp, and what each is for: the scouts who raid, the heroes who lead them, and the guardians who hold a post", icon: Users },
  { id: "decor", name: "Decorate", says: "Things for their own sake, and the lie of the land", icon: Flower2 }
];
const SHELF_SITES: Record<Shelf, readonly Site[]> = { camp: ["burrow", "oak", "store", "yard0", "yard1"], defence: ["fence", "tower"], heroes: ["hut"], decor: [] };
const shelfOfSite = (site: Site): Shelf => (SHELF_SITES.defence.includes(site) ? "defence" : site === "hut" ? "heroes" : "camp");

/** Five hearts, as many of them full as there are steps (or half-steps of mood) to show. */
const hearts = (full: number, label: string) => (
  <span className="pip-base-hearts" role="img" aria-label={label} title={label}>
    {Array.from({ length: 5 }, (_, index) => (
      <Heart key={index} size={12} aria-hidden fill={index < Math.round(full) ? "currentColor" : "none"} className={index < Math.round(full) ? "is-full" : ""} />
    ))}
  </span>
);

/** The frame the picture hangs in, in CSS pixels a side (index.css). */
const FRAME = 8;
/** From this width the picture has the page's left and the cards its right (index.css). */
const WIDE = 1040;
/** How long an acorn takes from the oak to the larder, the hedgehog to trundle in, and a chosen building to settle. */
const FLIGHT_MS = 650;
const ARRIVE_MS = 1500;
const BOUNCE_MS = 600;

/*
 * (There was a three-bubble introduction here, and a hedgehog with a daily
 * offer. Both went on 2026-10-15: the first said things a new camp does not
 * have yet, and Pip's tips (`pip/base/tips.ts`) say each when it comes.)
 */

/** Acorns into the larder: a patter of them, more for more. */
const acornsSound = (count: number) => {
  const drops = Math.min(4, 1 + Math.floor(count / 12));
  for (let drop = 0; drop < drops; drop++) playSound("coin", { delay: drop * 85, pitch: 1 + drop * 0.1 });
};

/**
 * The Hollow, Pip's camp: the arcade's building game (`pip/base/rules.ts`).
 *
 * Three pages. The camp: the clearing as a picture to pick things from, and
 * over it a card for whatever is chosen. "Arrange" turns the picture into
 * the place where the camp is laid out: fence goes down a piece at a time,
 * and every reach is shown. The raids: who goes, the next stronghold (and,
 * after ten, the month's King), with what the scouts say of it. The (i):
 * how the camp works, and what happened lately. A raid takes the whole
 * screen (BattleScreen).
 *
 * The camp page is three things and no more: Pip's bubble, the picture, and
 * one card for whatever is chosen. The bubble has three lines at most: a
 * tip when one is due, the one next thing (always there: `nextStep`, or a
 * finished book's trophy to raise), and the parcels when there are any.
 * The next thing is marked on the key where it is done, and a tap on its
 * line goes there: that is the way a new reader is walked through the camp.
 *
 * The picture is for looking and pointing; everything it does is also on the
 * buttons under it, so none of it needs a pointer. What a thing means is in
 * its tooltip, not written on the page: a pointer rests on it, a finger is
 * held on it (Tips.tsx).
 */
export const BaseScreen = ({
  skin,
  outfit,
  onInside,
  onArcade,
  corner,
  garden
}: {
  skin: string;
  outfit: readonly string[];
  /** Into the burrow, where the camp is the place Pip's tab opens on: her rooms are through its door. */
  onInside?: () => void;
  /** To the arcade's games, for a thing on the list that is done there. */
  onArcade?: () => void;
  /** Keys for the top corner of the picture: the ways out of the clearing. */
  corner?: React.ReactNode;
  /** The garden, where there is one: it has a bed by the burrow. */
  garden?: CampGarden;
}) => {
  const base = useBaseStore((state) => state.base);
  const snapshot = useHabitStore((state) => state.snapshot);
  // How Pip is at home, as the page her house is on has said: she brings it with her.
  const mood = useBaseStore((state) => state.mood);
  const now = useMemo(() => ({ ...nowFrom(snapshot), ...(mood === undefined ? {} : { mood }) }), [snapshot, mood]);
  /** The tale the last parcel opened had in it, until the reader has heard it. */
  const [told, setTold] = useState<number | null>(null);
  const books = useLibraryStore((state) => state.books);
  const [tab, setTab] = useState<Tab>("camp");
  const [selected, setSelected] = useState<Site>("burrow");
  const [panel, setPanelTo] = useState<Panel>("site");
  /** What is chosen opens in a panel inside the picture. It is shut until something is, so the whole clearing is seen. */
  const [panelOpen, setPanelOpen] = useState(false);
  const setPanel = (to: Panel) => {
    setPanelTo(to);
    setPanelOpen(true);
  };
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** The picture as the page (and how much sky there is above the clearing), or hung at the top of it. */
  /**
   * How the page is laid out: the picture is the page (`stage`); it is hung at the top and the rest follows under it
   * (`stack`: a small window, an upright phone); or it fills the height and the rest goes down its right (`side`: a
   * phone turned sideways, where hung at the top it was 175 px of camp).
   */
  const [lay, setLay] = useState<{ mode: "stage" | "stack" | "side"; sky: number; ground: number }>({ mode: "stack", sky: 0, ground: 0 });
  /** Which clearing the picture shows: the camp, or the meadow beyond it. */
  const [area, setArea] = useState<Place>("camp");
  /** What the list just paid, for a moment, over the acorns. */
  const [gained, setGained] = useState<{ acorns: number; at: number } | null>(null);
  const petted = useRef<{ x: number; y: number; at: number } | null>(null);
  const [sound, setSound] = useSoundOn();
  const [chosenDecor, setChosenDecor] = useState(-1);
  /** What the next tap on the picture does: sets a new thing down, or moves the chosen one. */
  const [placing, setPlacing] = useState<{ kind: number; moving: boolean; what?: "land" | "work" } | null>(null);
  /** A piece of landscape chosen in the picture: which, in the clearing looked at. */
  const [chosenLand, setChosenLand] = useState(-1);
  /** The guardian whose card is open. */
  const [chosenGuard, setChosenGuard] = useState(0);
  /** Putting fence down, the next tap on a piece makes the gate of it. */
  const [gating, setGating] = useState(false);
  /** The trophy last tapped: the book it stands for is said. */
  const [shownTrophy, setShownTrophy] = useState<string | null>(null);
  /** The postcard of the camp is being looked at. */
  const [postcard, setPostcard] = useState(false);
  /** Something is being carried off a shelf onto the picture just now (see `offShelf`): the shelf stays where it is until it is set down. */
  const [carriedOff, setCarriedOff] = useState(false);
  /** The wall clock, to the minute: who is asleep, and for how much longer, is told by it. */
  const [minute, setMinute] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setMinute(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  /** Laying the camp out: moving buildings, or putting fence down. Null when not. */
  const [arrange, setArrange] = useState<"move" | "fence" | null>(null);
  const [carrying, setCarrying] = useState<Placed | null>(null);
  const [watching] = useState(false);
  const [raid, setRaid] = useState<Raid | null>(null);
  const [end, setEnd] = useState<RaidEnd | null>(null);
  const [sent, setSent] = useState<RaidEnd | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fit, setFit] = useState<Fit>({ css: 2, backing: 2, crisp: true });
  // By what Pip wears, not by which list holds it: the art is drawn once and kept.
  const wornKey = outfit.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const art = useMemo(() => gameArt("base", skin, outfit), [skin, wornKey]);
  const loaded = base !== null;
  const store = useBaseStore.getState();

  useEffect(() => {
    void useBaseStore.getState().open();
  }, []);
  // Reading done with the arcade open, or a day turning: the camp catches up.
  useEffect(() => {
    useBaseStore.getState().refresh();
  }, [now.minutes, now.day]);

  const finished = useMemo(() => books.filter(hasFinished), [books]);
  const waiting = useMemo(() => (base ? toRaise(finished, base) : []), [finished, base]);
  const standing = useMemo(() => (base ? trophyRow(finished, base, TROPHIES_SHOWN) : []), [finished, base]);

  const night = useMemo(() => {
    const hour = new Date().getHours();
    return hour >= 20 || hour < 6;
    // Looked at again whenever the camp changes: often enough for dusk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  const season = seasonOf(now.day);
  // The book being read: the one last opened that is begun and not finished. Its kind has a say in who comes out of the wood.
  const readingNow = useMemo(
    () =>
      books
        .filter((book) => !hasFinished(book) && (book.progress ?? 0) > 0 && Boolean(book.lastOpened))
        .sort((a, b) => (b.lastOpened ?? "").localeCompare(a.lastOpened ?? ""))[0] ?? null,
    [books]
  );
  const readingKind = readingNow ? trophyKind(readingNow.genres) : null;
  const look: CampLook | null = useMemo(
    () =>
      base && {
        levels: base.levels,
        yard: base.yard,
        spots: base.spots,
        walls: base.walls,
        jobs: base.jobs.map((job) => job.site),
        season,
        night,
        garden: garden ? (garden.ripe > 0 ? 2 : garden.growing > 0 ? 1 : 0) : null,
        harm: base.harm,
        posts: base.posts,
        asleep: sleepers(base, minute),
        // The lantern is lit on a day the reading goal is met: the lookout throws further at prowlers for it.
        lit: litTonight(base, now.day, now.goalMet === true),
        banners: base.banners.slice(-BANNERS_SHOWN).map((month) => seasonOf(`${month}-15`)),
        trophies: standing.map((trophy) => trophy.kind),
        decor: base.decor,
        // The hedgehog does not call since 2026-10-15.
        visitor: false,
        oakReady: oakReady(base, now.minutes) > 0,
        // Those with a bed in the hut: whoever goes raiding first, then the ones who know the camp best.
        residents: lodgers(base)
          .map((hero) => hero.id)
          .slice(0, RESIDENTS_SHOWN),
        rainbow: (now.streak ?? 0) >= 7,
        guards: base.guards,
        area,
        animals: base.animals,
        meadow: base.meadow,
        land: base.land,
        meadowLand: base.meadowLand,
        works: base.works,
        towerPath: base.forks.tower ?? null,
        gate: gateOf(base),
        parcels: base.parcels,
        reading: readingKind
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, season, night, now, standing, area, garden?.ripe, garden?.growing, garden === undefined, minute, readingKind]
  );

  // A building that went up while the camp is on screen: a burst over it.
  const levelsSeen = useRef<string | null>(null);
  const [burst, setBurst] = useState<{ site: Site; at: number } | null>(null);
  useEffect(() => {
    if (!base) return;
    const key = SITES.map((site) => levelOf(base, site)).join();
    if (levelsSeen.current !== null && levelsSeen.current !== key) {
      const before = levelsSeen.current.split(",").map(Number);
      const risen = SITES.find((site, index) => levelOf(base, site) > before[index]);
      if (risen) {
        setBurst({ site: risen, at: performance.now() });
        playSound("chime");
      }
    }
    levelsSeen.current = key;
  }, [base]);
  // The list moved on: what it paid is heard, and seen over the acorns for a moment.
  const listSeen = useRef<{ quest: number; acorns: number } | null>(null);
  useEffect(() => {
    if (!base) return;
    const was = listSeen.current;
    if (was && base.quest > was.quest) {
      // What the list paid: its rewards for the steps just ticked off (the oak's own acorns, gathered by the same tap, are not counted).
      const paid = Math.min(base.acorns - was.acorns, QUESTS.slice(was.quest, base.quest).reduce((sum, quest) => sum + quest.reward, 0));
      if (paid > 0) {
        setGained({ acorns: paid, at: performance.now() });
        acornsSound(paid);
      }
      playSound("chime");
    }
    listSeen.current = { quest: base.quest, acorns: base.acorns };
  }, [base]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const host = rootRef.current?.parentElement ?? null;
      const wide = host?.clientWidth ?? 0;
      const tall = host?.clientHeight ?? 0;
      // A phone on its side (Pip's tab holds the screen so there) has the page's whole width for the picture: it is
      // the page there too, with the rest laid over it as on a large screen, smaller (touch.css).
      const phone = window.innerHeight <= PHONE_TALL && wide >= PHONE_WIDE && tall >= PHONE_MIN_TALL && wide >= tall * 1.3;
      if ((wide >= STAGE_WIDE && tall >= STAGE_TALL) || phone) {
        // The picture is the page: as large as the page lets it be, and what height is left over the clearing is sky.
        const next = fitPicture(GAME_W, GAME_H, wide, tall, screenRatio(), 0);
        // To the canvas pixel. The first of it is ground at the foot, for the row of keys to stand on; the rest is sky.
        const spare = Math.max(0, Math.floor((tall / next.css - GAME_H) * next.backing) / next.backing);
        const ground = Math.min(spare, Math.ceil((DOCK_TALL / next.css) * next.backing) / next.backing);
        const sky = Math.min(SKY_MOST, spare - ground);
        setFit((was) => (was.css === next.css && was.backing === next.backing ? was : next));
        setLay((was) => (was.mode === "stage" && was.sky === sky && was.ground === ground ? was : { mode: "stage", sky, ground }));
        return;
      }
      // Not on show (another page of a small window): there is nothing to measure.
      const root = rootRef.current;
      const side = root ? sidewaysRoom(root) : null;
      if (side) {
        setLay((was) => (was.mode === "side" ? was : { mode: "side", sky: 0, ground: 0 }));
        const next = fitPicture(GAME_W, GAME_H, side.wide, side.tall, screenRatio(), 0.08);
        setFit((was) => (was.css === next.css && was.backing === next.backing ? was : next));
        return;
      }
      setLay((was) => (was.mode === "stack" ? was : { mode: "stack", sky: 0, ground: 0 }));
      if (wrap.clientWidth === 0) return;
      // The picture hangs in a frame: the room for it is the wrap's, less the frame on each side.
      const room = Math.max(window.innerHeight * 0.45, window.innerHeight - 440);
      // (Across an upright phone a whole-pixel size left a quarter of the width empty: there it fills the width.)
      const next = fitPicture(GAME_W, GAME_H, wrap.clientWidth - FRAME * 2, Math.max(170, room), screenRatio(), wrap.clientWidth < 600 ? 0.08 : undefined);
      setFit((was) => (was.css === next.css && was.backing === next.backing ? was : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    if (rootRef.current?.parentElement) observer.observe(rootRef.current.parentElement);
    // A phone turned: the window's new size comes before the page under it is laid out again, so it is measured
    // again once it has been (sideways, the room is the height of the page it scrolls in).
    let settle = 0;
    const turned = () => {
      measure();
      cancelAnimationFrame(settle);
      settle = requestAnimationFrame(() => {
        settle = requestAnimationFrame(measure);
      });
    };
    window.addEventListener("resize", turned);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(settle);
      window.removeEventListener("resize", turned);
    };
    // The scene is only there once the camp has been read, on its own page, with no raid on.
  }, [loaded, tab, raid, watching]);

  // The lantern: lit on a day the reading goal is met.
  const litNow = base ? litTonight(base, now.day, now.goalMet === true) : false;
  // Everything in the camp that throws, and how far: shown while things are moved about, so a layout can be reasoned about.
  const defence = useMemo(
    () => {
      if (!base) return null;
      const all = campStructures(base, litNow, minute);
      const larder = all.find((entry) => entry.kind === "hoard") ?? all[0];
      return {
        // What throws, and the ward's ring: each with the building it is, where it is one.
        // (Not the guardians: they are fought with at their signposts, and their ground is the post's.)
        rings: all
          .filter((entry) => entry.look?.name !== "guardian")
          .map((entry) => {
            const work = entry.look?.name === "work" ? (entry.look.variant ?? null) : null;
            const throws = entry.range > 0;
            return {
              x: entry.x,
              y: entry.y,
              r: entry.grounds ?? (throws ? entry.range + entry.r : work !== null ? (WORKS[work]?.reach ?? 0) : 0),
              site: work !== null ? null : (entry.look?.name ?? null),
              work,
              throws,
              // A construct that throws does it its own way: how long between, and how hard.
              ...(work !== null && throws ? { every: entry.every, hurts: Math.max(1, Math.round(entry.hit / 2)) } : {})
            };
          })
          .filter((ring) => ring.r > 0),
        larder: [larder.x, larder.y] as const
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base?.levels, base?.spots, base?.forks, base?.guards, base?.walls, base?.works, litNow]
  );

  // The picture: drawn at once for what changed, then kept moving while it is on screen.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** When the camp came on screen, when each gathered acorn set off, and which building was last chosen and when. */
  const opened = useRef(performance.now());
  const flights = useRef<number[]>([]);
  const bounced = useRef<{ site: Placed; at: number } | null>(null);
  /** When each building was last knocked by a prowler, and which the pointer is resting on: their health is shown on a bar for a moment, and while pointed at. */
  const knockedAt = useRef<Partial<Record<Placed, number>>>({});
  const hovered = useRef<Placed | null>(null);
  /** Where the pointer is resting in the scene, when nothing is in hand. */
  const resting = useRef<{ x: number; y: number } | null>(null);
  /** A press on the picture that may turn into a drag (see `pressDown`). Kept up here with the other hooks: the camp is not always read when this runs. */
  const press = useRef<{ x: number; y: number; grab: Grab | null; off: [number, number]; touch: boolean; free: boolean; dragging: boolean } | null>(null);
  /** When Pip was last woken in the night, by a tap on her burrow. */
  const woken = useRef<number | null>(null);
  /** The construct last tapped: its reach is shown. And the square of ground the fence was last drawn across, while it is being drawn. */
  const chosenWork = useRef<number | null>(null);
  const fenced = useRef<string | null>(null);
  /** The tap on the picture as it is just now, for something dragged off a shelf to be set down by when it is let go. */
  const pickRef = useRef<((event: React.PointerEvent<HTMLCanvasElement>) => void) | null>(null);
  /** What has just happened in the picture, to be seen there: where, when, and the figure to send up from it. */
  const floats = useRef<Array<{ x: number; y: number; at: number; text?: string; bad?: boolean }>>([]);
  const float = (x: number, y: number, text?: string, bad = false) => {
    floats.current = [...floats.current.filter((entry) => performance.now() - entry.at < 1400), { x, y, at: performance.now(), text, bad }];
  };
  /**
   * The oak's acorns taken in: heard, seen flying to the larder, and counted
   * up over the tree. By the Gather button, and by a tap on the oak itself
   * when it has some (the owner, 2026-10-14: "on clicking it collects
   * automatically").
   */
  const gatherOak = () => {
    const live = useBaseStore.getState().base;
    if (!live) return;
    // What will really come in, every bonus counted and as far as the larder has room: that is the figure shown.
    const got = gatherBrings(live, now.minutes, now.streak ?? 0, now.day);
    if (got <= 0) return;
    acornsSound(got);
    // Seen as well as heard: a few acorns from the oak to the larder, one after another.
    const at = performance.now();
    flights.current = Array.from({ length: Math.min(6, 1 + Math.floor(got / 6)) }, (_, index) => at + index * 90);
    float(live.spots.oak[0], live.spots.oak[1] - 6, `+${got}`);
    store.gather();
  };
  const choose = (site: Site) => {
    setSelected(site);
    setPanel("site");
    setChosenDecor(-1);
    if ((PLACED as readonly Site[]).includes(site)) bounced.current = { site: site as Placed, at: performance.now() };
    playSound("click");
  };
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !look) return;
    const draw = (frame: number, seconds: number | null = null) => {
      // Set again each time: a canvas forgets it when its size changes.
      drawAt(ctx, fit);
      const more = extras(frame, seconds);
      if (lay.sky > 0) {
        paintSky(ctx, art, look, lay.sky, more.dusk);
        ctx.translate(0, lay.sky);
      }
      paintCamp(ctx, art, look, frame, more);
      paintGround(ctx, art, look, GAME_H, lay.ground, more.dusk);
    };
    const extras = (frame: number, seconds: number | null): CampExtras => {
      const time = performance.now();
      const burstFrame = burst ? Math.floor(((time - burst.at) / 1000) * ART_FPS) : BURST_FRAMES;
      void frame;
      const at = pointer.current;
      const spotted = (PLACED as readonly Site[]).includes(selected) ? (selected as Placed) : null;
      flights.current = flights.current.filter((from) => time - from < FLIGHT_MS);
      const chosen = bounced.current;
      return {
        px: fit.backing,
        sky: lay.sky,
        ...(seconds === null
          ? {}
          : {
              // By the clock on the wall, so Pip does not start her round again whenever something is chosen.
              time: time / 1000,
              // The clearing's own hours, from the morning it was opened on.
              dusk: duskAt((time - opened.current) / 1000),
              clock: (time - opened.current) / 1000,
              ...(woken.current !== null && time - woken.current < AWAKE_SECONDS * 1000 ? { awake: (time - woken.current) / 1000 } : {}),
              bounce: chosen && time - chosen.at < BOUNCE_MS ? { site: chosen.site, age: (time - chosen.at) / 1000 } : null,
              flying: flights.current.map((from) => (time - from) / FLIGHT_MS),
              arriving: (time - opened.current) / ARRIVE_MS
            }),
        pip: !arrange,
        selected: chosenDecor >= 0 || placing || arrange || !panelOpen || panel !== "site" ? null : spotted,
        selectedDecor: placing?.moving || arrange ? -1 : chosenDecor,
        placing: placing && !placing.what && at ? { kind: placing.kind, ...at } : null,
        setting: placing?.what && at ? { sprite: placing.what, kind: placing.kind, ...at } : null,
        mark: (() => {
          const piece = !placing && base && chosenLand >= 0 ? (area === "meadow" ? base.meadowLand : base.land)[chosenLand] : null;
          return piece ? { x: piece.x, y: piece.y, up: SCENERY[piece.kind]?.flat ? 12 : 28 } : null;
        })(),
        carrying: arrange === "move" && carrying && at && base ? { site: carrying, ...at, ok: spotBlocked(base, carrying, at.x, at.y) === null } : null,
        wall: (() => {
          if (!at || !base) return null;
          const square = { x: Math.round(at.x / 10) * 10, y: Math.round((at.y - 4) / 10) * 10 + 4 };
          // A piece in hand: the square it would go to, and whether it may.
          const drag = press.current;
          if (drag?.dragging && drag.grab?.what === "wall") return { ...square, ok: wallMoveBlocked(base, drag.grab.index, at.x, at.y) === null };
          return arrange === "fence" && wallAt(base, at.x, at.y) < 0 ? { ...square, ok: wallBlocked(base, at.x, at.y) === null } : null;
        })(),
        // While arranging, every reach; otherwise the reach of whatever is chosen, if it throws: how far a lookout looks out.
        rings: (() => {
          const drag = press.current;
          // A signpost in hand: the ground its guardian would keep, where it is now.
          if (drag?.dragging && drag.grab?.what === "post" && at) return [{ x: at.x, y: at.y, r: POST_REACH }];
          if (!defence || area === "meadow") return undefined;
          // A construct in hand: how far it would reach from wherever it is held.
          if (placing?.what === "work") {
            const reach = WORKS[placing.kind]?.reach ?? 0;
            return at && reach > 0 ? [{ x: at.x, y: at.y, r: reach }] : undefined;
          }
          // Arranging, every reach there is; a building in hand takes its own with it.
          if (arrange) return carrying && at ? defence.rings.map((ring) => (ring.site === carrying ? { ...ring, x: at.x, y: at.y } : ring)) : defence.rings;
          if (panelOpen && panel === "guard" && base) {
            const spot = postSpotOf(base, chosenGuard);
            return spot ? [{ x: spot[0], y: spot[1], r: POST_REACH }] : undefined;
          }
          if (panelOpen && chosenWork.current !== null) return defence.rings.filter((ring) => ring.work === chosenWork.current);
          return panelOpen && panel === "site" && chosenDecor < 0 ? defence.rings.filter((ring) => ring.site === selected) : undefined;
        })(),
        // The ground things take, in red: nothing else is built on it. All of it while the camp is laid out; otherwise what is chosen or in hand.
        spaces: (() => {
          if (!base || area === "meadow") return undefined;
          const feet = (skip: Placed | null, more = 0) =>
            sitesStanding(base)
              .filter((site) => site !== skip)
              .map((site) => ({ x: base.spots[site][0], y: base.spots[site][1], r: footOf(site) + more }));
          if (arrange === "move") return carrying && at ? [...feet(carrying), { x: at.x, y: at.y, r: footOf(carrying) }] : feet(null);
          // A piece of fence wants a little more room from a building than its foot.
          if (arrange === "fence") return feet(null, 4);
          const flat = (kind: number) => (kind === 4 || kind === 6 || kind === 8 ? 3 : 5);
          if (placing?.what === "work") return at ? [{ x: at.x, y: at.y, r: flat(placing.kind) }] : undefined;
          if (placing || !panelOpen) return undefined;
          const work = chosenWork.current === null ? null : base.works.find((entry) => entry.kind === chosenWork.current);
          if (work) return [{ x: work.x, y: work.y, r: flat(work.kind) }];
          return panel === "site" && chosenDecor < 0 && spotted && sitesStanding(base).includes(spotted) ? [{ x: base.spots[spotted][0], y: base.spots[spotted][1], r: footOf(spotted) }] : undefined;
        })(),
        posting: (() => {
          const drag = press.current;
          return drag?.dragging && drag.grab?.what === "post" && at ? { guard: drag.grab.guard, x: at.x, y: at.y } : null;
        })(),
        // (While arranging, the line the night's raiders would take to the larder was drawn. There is no such night now.)
        path: null,
        from: null,
        // (And while it is the one chosen: a finger cannot rest on a building to be told, it taps it.)
        bars: base
          ? PLACED.filter((site) => (base.harm[site] ?? 0) > 0 && (hovered.current === site || (panelOpen && panel === "site" && spotted === site) || time - (knockedAt.current[site] ?? -1e9) < 4000))
          : undefined,
        // Between raids the odd prowler comes out of the wood, and what throws sees him off: not while things are being moved about.
        watch: defence && area === "camp" && !arrange && !placing ? defence.rings.filter((ring) => ring.throws) : undefined,
        // The building under the pointer, or the one chosen: a fence in front of it is drawn thin.
        through: placing || arrange ? null : (hovered.current ?? (panelOpen && panel === "site" && chosenDecor < 0 ? spotted : null)),
        peek: placing || arrange || press.current?.dragging ? null : resting.current,
        floats: floats.current.filter((entry) => time - entry.at < 1300).map((entry) => ({ x: entry.x, y: entry.y, age: (time - entry.at) / 1000, text: entry.text, bad: entry.bad })),
        petted: petted.current && time - petted.current.at < 900 ? { x: petted.current.x, y: petted.current.y, age: (time - petted.current.at) / 1000 } : null,
        burst: burst && burstFrame < BURST_FRAMES ? { site: burst.site, frame: burstFrame } : null,
        magpies: null
      };
    };
    // The first drawing is by the camp's clock like every one after it: drawn without it, the picture was the day's for
    // a frame at every tap, which by night was a flash of daylight.
    if (prefersReducedMotion()) {
      draw(0);
      return;
    }
    draw(Math.floor(((performance.now() - opened.current) / 1000) * ART_FPS), (performance.now() - opened.current) / 1000);
    let raf = 0;
    // From when the camp was opened, not from when this picture was last begun again (which is whenever anything in
    // it changes): or everything that turns over would start from its first frame at every tap.
    const started = opened.current;
    // Only this picture's own loop paints it: one begun for an earlier size of the picture stops at once, and cannot
    // go on painting a small one into the corner of this one.
    let live = true;
    const tick = (time: number) => {
      if (!live) return;
      // Every frame the screen gives: what moves across the picture moves by the clock, not by the art's twelve a second.
      draw(Math.floor(((time - started) / 1000) * ART_FPS), (time - started) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
    };
    // `base` and `now` reach the picture through `look`, which changes when they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art, look, selected, chosenDecor, placing, burst, tab, raid, arrange, carrying, watching, defence, panel, fit, chosenLand, area, lay, panelOpen, chosenGuard]);

  // The scouts' word on each raid: worked out when the camp or the day changes, not on every paint.
  const scouting = useMemo(() => {
    if (!base || base.levels.hut < 1) return null;
    // (The road's three camps a day are not shown since 2026-10-15: the strongholds are one ladder to climb.)
    return { camp: scoutsSay(base, nextCamp(base)), king: scoutsSay(base, theKing(base)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.levels.hut, base?.camps, base?.forks.hut, now.day]);

  // The reader's clubs, for their bosses: asked for when the journal is opened.
  const signedIn = useAccountStore((state) => state.status.signedIn);
  const [clubs, setClubs] = useState<Club[] | null>(null);
  useEffect(() => {
    if (tab !== "journal" || !signedIn || !FEATURES.community) return;
    let live = true;
    friendsService.clubs().then(
      (found) => live && setClubs(found),
      () => live && setClubs([])
    );
    return () => {
      live = false;
    };
  }, [tab, signedIn]);

  // Friends whose camps can be raided: asked for when the raids are opened.
  const [targets, setTargets] = useState<RaidTarget[] | null>(null);
  const [mayRaid, setMayRaid] = useState(true);
  useEffect(() => {
    if (tab !== "raids" || !signedIn || !FEATURES.community) return;
    let live = true;
    socialService.raidTargets().then(
      (list) => live && setTargets(list),
      () => live && setTargets([])
    );
    socialService.raidable().then(
      (on) => live && setMayRaid(on),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [tab, signedIn]);
  // Friends' raids on this camp since it was last open: taken in once, and the server told they have been seen.
  const raidsTaken = useRef(false);
  useEffect(() => {
    if (!loaded || !signedIn || !FEATURES.community || raidsTaken.current) return;
    raidsTaken.current = true;
    socialService.raidsOnMe().then(
      (raids) => {
        if (raids.length === 0) return;
        useBaseStore.getState().sufferRaids(raids.map((raid) => ({ name: raid.name, stars: raid.stars })));
        playSound(raids.some((raid) => raid.stars > 0) ? "crumble" : "chime", { volume: 0.7 });
        void socialService.ackRaids(raids.map((raid) => raid.id)).catch(() => undefined);
      },
      () => undefined
    );
  }, [loaded, signedIn]);

  // A prowler nobody stopped knocks about what he came for. Looked for once a second, while the camp is on show and
  // nothing is being moved: only the walks that were there to be watched from their start count.
  const lookRef = useRef(look);
  lookRef.current = look;
  const watchRef = useRef<Array<{ x: number; y: number; r: number; every?: number; hurts?: number }> | null>(null);
  watchRef.current = defence ? defence.rings.filter((ring) => ring.throws) : null;
  const prowlSeen = useRef(-1);
  useEffect(() => {
    if (!loaded || tab !== "camp" || area !== "camp" || arrange || placing || raid || watching) return;
    const slotNow = () => Math.floor((performance.now() - opened.current) / 1000 / PROWL_EVERY);
    prowlSeen.current = Math.max(prowlSeen.current, slotNow());
    const timer = window.setInterval(() => {
      const seen = lookRef.current;
      const rings = watchRef.current;
      if (document.hidden || !seen || !rings) {
        prowlSeen.current = slotNow();
        return;
      }
      const clock = (performance.now() - opened.current) / 1000;
      for (let slot = prowlSeen.current + 1; slot * PROWL_EVERY <= clock; slot++) {
        const plan = prowlPlanOf(seen, rings, slot);
        if (plan) {
          // Not over yet: looked at again in a second.
          if (clock < slot * PROWL_EVERY + (plan.falls ?? plan.harms ?? plan.there)) break;
          if (plan.falls === null && plan.harms !== null) {
            // He got there, and was still at it when he had done: the building is the worse for it.
            useBaseStore.getState().harmSite(plan.site);
            // Fizzwick goes off: it is worth two knocks.
            if (plan.pops) useBaseStore.getState().harmSite(plan.site);
            // And from the larder or the oak, whoever was not stopped makes off with a few acorns.
            else {
              const taken = useBaseStore.getState().robSite(plan.site);
              if (taken > 0) float(seen.spots[plan.site][0], seen.spots[plan.site][1] - 8, `-${taken}`, true);
            }
            if (plan.pops) float(seen.spots[plan.site][0], seen.spots[plan.site][1] - 6, undefined, true);
            knockedAt.current[plan.site] = performance.now();
            playSound(plan.pops ? "pop" : "crumble", { volume: 0.5 });
          }
          // Whoever went out to him and did not finish him has a knock to show for it.
          // (Seen off in the end by what throws, after they had been at him, is seen off: nobody is the worse for it.)
          if (plan.duel && plan.falls === null) useBaseStore.getState().woundFighter(plan.duel.who);
        }
        prowlSeen.current = slot;
      }
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tab, area, arrange, placing, raid, watching]);

  // Android's Back steps out of the camp's own states one at a time, as a hand would: what is being set down, the
  // moving about, the panel, a trophy's line, the raids or the journal, the meadow. With none of them, it is not the
  // camp's (the Pip tab's, then the app's). A raid's own Back is BattleScreen's; the postcard's, its own.
  useBackFallback(() => {
    if (raid) return false;
    if (placing) {
      setPlacing(null);
      return true;
    }
    if (arrange) {
      leaveArrange();
      return true;
    }
    if (panelOpen) {
      setPanelOpen(false);
      return true;
    }
    if (shownTrophy !== null) {
      setShownTrophy(null);
      return true;
    }
    if (tab !== "camp") {
      setTab("camp");
      return true;
    }
    if (area !== "camp") {
      goArea("camp");
      return true;
    }
    return false;
  });

  if (!base || !look) {
    return <p className="mt-4 text-sm text-on-surface-variant">…</p>;
  }

  if (raid) {
    return (
      <BattleScreen
        mode="raid"
        raid={raid}
        skin={skin}
        outfit={outfit}
        season={season}
        end={end}
        onDone={(result) => {
          if ("friend" in raid) {
            // A friend's camp: the prize is the game's, and the friend is told who came and how it went.
            const friendly = raid as FriendRaid;
            setEnd(store.finishFriendRaid(friendly, result));
            void socialService.reportRaid(friendly.friend.handle, result.stars).catch(() => undefined);
            setTargets((list) => list?.map((target) => (target.handle === friendly.friend.handle ? { ...target, raidedToday: true } : target)) ?? list);
          } else setEnd(store.finishRaid(raid, result));
        }}
        onClose={() => {
          // What was brought home is seen going into the larder.
          if (end && end.loot > 0) {
            const from = performance.now() + 250;
            flights.current = Array.from({ length: Math.min(6, 1 + Math.floor(end.loot / 8)) }, (_, index) => from + index * 90);
            acornsSound(end.loot);
          }
          setRaid(null);
          setEnd(null);
        }}
      />
    );
  }
  /** The lookout that has taken a path is another tower to look at: which picture, for its tile and its card. */
  const pathLook = (site: Site, level: number) => (site === "tower" && base.forks.tower && level >= 3 ? { name: base.forks.tower === "a" ? "spire" : "darkwatch", variant: level - 3 } : null);
  /** What is set down in the clearing that is looked at. */
  const things = area === "meadow" ? base.meadow : base.decor;
  const ready = oakReady(base, now.minutes);
  /** What prowlers have knocked about, and what it costs to put all of it right. */
  const hurt = harmed(base);
  const fixAll = hurt.reduce((sum, site) => sum + fixCost(base, site, now.day), 0);
  const nextAnimal = ANIMALS.filter((animal) => !base.animals.includes(animal.id)).sort((a, b) => a.charm - b.charm)[0] ?? null;
  const room = holds(base) - base.acorns;
  const streak = now.streak ?? 0;
  const piecesLeft = fencePieces(base) - base.walls.length;
  const rested = raidsReady(base, now.minutes);
  /** The one next thing: always something (see `nextStep`). */
  const next = nextStep(base, now.minutes);
  /** A finished book whose trophy can be raised now: that comes before anything else on the list. */
  const raisable = waiting.length > 0 && trophyWaits(base, now.minutes) === 0 ? waiting[0] : null;
  /** How many of the parcels waiting the larder has room for, each whole. */
  const opensNow = Math.min(base.parcels, Math.floor(Math.max(0, room) / parcelGives(base)));
  // Where it is done: marked there until it is.
  const nudge: QuestAt | null = next.full ? null : next.at;
  const goTo = (at: QuestAt) => {
    playSound("click");
    if (at === "raids") {
      setTab("raids");
      return;
    }
    setTab("camp");
    setChosenDecor(-1);
    setPlacing(null);
    if (at === "meadow") {
      // Until the path to it is cleared, the burrow is what clears it.
      if (meadowOpen(base)) setArea("meadow");
      else {
        setArea("camp");
        setSelected("burrow");
      }
      setPanel("site");
      return;
    }
    setArea("camp");
    // A plot that is not there yet (a yard plot before its level): the burrow is what brings it.
    setSelected(plotOpen(base, at) ? at : "burrow");
    setPanel("site");
  };
  /**
   * Opens the parcels waiting by the burrow's door: one (a tap on one in the
   * picture) or all that the larder has room for. What came in is heard and
   * seen, and a tale, if one came, is told in Pip's bubble.
   */
  const openParcels = (one: { x: number; y: number } | null = null) => {
    const first = useBaseStore.getState().base;
    if (!first) return;
    for (let count = 0; count < PARCELS_MOST; count++) {
      const before = useBaseStore.getState().base;
      store.openParcel();
      const after = useBaseStore.getState().base;
      if (!before || !after || after.parcels >= before.parcels) break;
      if (after.tales.length > before.tales.length) setTold(after.tales[after.tales.length - 1]);
      if (one) break;
    }
    const got = (useBaseStore.getState().base?.acorns ?? first.acorns) - first.acorns;
    playSound(got > 0 ? "pop" : "womp", { volume: 0.6 });
    if (got > 0) {
      const at = performance.now();
      flights.current = Array.from({ length: Math.min(5, 1 + Math.floor(got / 8)) }, (_, index) => at + index * 90);
      float(one?.x ?? base.spots.burrow[0], one?.y ?? base.spots.burrow[1] + 6, `+${got}`);
      acornsSound(got);
      store.learn("parcel");
    }
  };
  const chosenTile = (what: string) => what === "meadow" && area === "meadow";
  const mark = (at: QuestAt | Panel) => (nudge === at ? <span className="pip-base-nudge" aria-label="Next on Pip's list" /> : null);

  const toScene = (event: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // The clearing begins under whatever sky there is above it.
    return { x: ((event.clientX - rect.left) / rect.width) * GAME_W, y: ((event.clientY - rect.top) / rect.height) * (GAME_H + lay.sky + lay.ground) - lay.sky };
  };
  /** What can be taken hold of and dragged: a building, a thing set down, a piece of the land, a construct; and where its foot is. */
  type Grab = ({ what: "site"; site: Placed } | { what: "decor"; index: number; kind: number } | { what: "land"; index: number; kind: number } | { what: "work"; kind: number } | { what: "post"; guard: number } | { what: "wall"; index: number }) & {
    x: number;
    y: number;
  };
  const grabJust = (at: { x: number; y: number }): Grab | null => {
    if (!base) return null;
    if (area === "meadow") {
      const set = decorAt(base.meadow, at.x, at.y);
      if (set >= 0) return { what: "decor", index: set, kind: base.meadow[set].kind, x: base.meadow[set].x, y: base.meadow[set].y };
      const ground = landAt(base.meadowLand, at.x, at.y);
      return ground >= 0 ? { what: "land", index: ground, kind: base.meadowLand[ground].kind, x: base.meadowLand[ground].x, y: base.meadowLand[ground].y } : null;
    }
    // A guardian's signpost: carried, it takes the guardian with it.
    const post = look ? postAtPoint(look, at.x, at.y) : null;
    const stands = post === null ? null : postSpotOf(base, post);
    if (post !== null && stands) return { what: "post", guard: post, x: stands[0], y: stands[1] };
    const set = decorAt(base.decor, at.x, at.y);
    if (set >= 0) return { what: "decor", index: set, kind: base.decor[set].kind, x: base.decor[set].x, y: base.decor[set].y };
    const work = workAt(base.works, at.x, at.y);
    if (work >= 0) return { what: "work", kind: base.works[work].kind, x: base.works[work].x, y: base.works[work].y };
    const site = siteAt(base.spots, at.x, at.y, sitesStanding(base));
    if (site) return { what: "site", site, x: base.spots[site][0], y: base.spots[site][1] };
    // A piece of fence is taken hold of like anything else.
    const wall = wallAt(base, at.x, at.y);
    if (wall >= 0) return { what: "wall", index: wall, x: base.walls[wall][0], y: base.walls[wall][1] };
    const ground = landAt(base.land, at.x, at.y);
    return ground >= 0 ? { what: "land", index: ground, kind: base.land[ground].kind, x: base.land[ground].x, y: base.land[ground].y } : null;
  };
  /** What is under a point, or as near under it as makes no difference: things are small, and a finger is not. */
  const grabAt = (at: { x: number; y: number }): Grab | null =>
    grabJust(at) ?? grabJust({ x: at.x, y: at.y + 3 }) ?? grabJust({ x: at.x - 3, y: at.y }) ?? grabJust({ x: at.x + 3, y: at.y }) ?? grabJust({ x: at.x, y: at.y - 3 });
  /**
   * Everything in the camp is moved by dragging it: taken hold of, carried,
   * and set down where it is let go. That is so with nothing chosen first,
   * and it is so while arranging too (a building in "Move", a piece of
   * fence in the fence's own mode), where it used to be a tap to pick up
   * and another to put down. The two taps still work, for whoever would
   * rather; a drag is simply what a hand expects.
   *
   * A press on the picture. Let go where it began, it is a tap, and chooses.
   * Moved first, it is a drag: whatever was under it comes along, held by
   * the place it was taken hold of, and is set down where it is let go,
   * with no need to say "arrange" first. A finger swept across open ground
   * goes to the other clearing (a mouse has the tab at the edge for that:
   * with a mouse, a drag that misses is too easily a sweep).
   */
  const pressDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const free = !placing && !arrange;
    const at = toScene(event);
    const underSite = () => {
      const site = base ? siteAt(base.spots, at.x, at.y, sitesStanding(base)) : null;
      return site && base ? ({ what: "site", site, x: base.spots[site][0], y: base.spots[site][1] } as Grab) : null;
    };
    const underWall = () => {
      const wall = base ? wallAt(base, at.x, at.y) : -1;
      return wall >= 0 && base ? ({ what: "wall", index: wall, x: base.walls[wall][0], y: base.walls[wall][1] } as Grab) : null;
    };
    const grab = free ? grabAt(at) : arrange === "move" && !carrying ? underSite() : arrange === "fence" && !gating ? underWall() : null;
    press.current = { x: event.clientX, y: event.clientY, grab, off: grab ? [grab.x - at.x, grab.y - at.y] : [0, 0], touch: event.pointerType !== "mouse", free, dragging: false };
    fenced.current = `${Math.round(at.x / 10)},${Math.round((at.y - 4) / 10)}`;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture: a drag let go outside the picture is simply not set down.
    }
    pick(event);
  };
  /** Where the thing in hand is: under the pointer, by as much as it was taken hold of off its foot. */
  const held = (event: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const at = toScene(event);
    const off = press.current?.dragging ? press.current.off : [0, 0];
    return { x: at.x + off[0], y: at.y + off[1] };
  };
  const pressMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const now = press.current;
    if (now && now.grab && !now.dragging && Math.hypot(event.clientX - now.x, event.clientY - now.y) > 9) {
      now.dragging = true;
      const grab = now.grab;
      if (grab.what === "site") {
        setPlacing(null);
        setArrange("move");
        setCarrying(grab.site);
      } else if (grab.what === "decor") {
        setChosenDecor(grab.index);
        setChosenLand(-1);
        setPlacing({ kind: grab.kind, moving: true });
      } else if (grab.what === "land") {
        setChosenDecor(-1);
        setChosenLand(grab.index);
        setPlacing({ kind: grab.kind, moving: true, what: "land" });
      } else if (grab.what === "work") setPlacing({ kind: grab.kind, moving: true, what: "work" });
      else if (grab.what === "post") {
        // A signpost needs nothing set up: the picture shows it in hand, and the ground its guardian would keep.
        setChosenGuard(grab.guard);
      }
      // (Nor does a piece of fence: the picture shows the square it would go to.)
      playSound("pick");
    }
    if (now && arrange === "fence" && base && !gating && now.grab?.what !== "wall") {
      // Putting fence down, the pointer held and taken across the ground lays a piece on every square it comes to:
      // a wall is drawn, not tapped out a piece at a time. It only ever lays: a piece is taken up by a tap on it.
      const at = toScene(event);
      const square = `${Math.round(at.x / 10)},${Math.round((at.y - 4) / 10)}`;
      if (square !== fenced.current) {
        fenced.current = square;
        if (wallAt(base, at.x, at.y) < 0 && wallBlocked(base, at.x, at.y) === null) {
          store.placeWall(at.x, at.y);
          playSound("place", { volume: 0.6 });
        }
      }
    }
    if (placing || arrange || now?.dragging) pointer.current = held(event);
    // What the pointer rests on, for its health to be shown.
    else if (base && area === "camp") {
      const at = toScene(event);
      hovered.current = siteAt(base.spots, at.x, at.y, sitesStanding(base));
      resting.current = event.pointerType === "mouse" ? at : null;
    }
  };
  const pressUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const now = press.current;
    fenced.current = null;
    if (!now) return;
    if (now.dragging && now.grab && base) {
      // Set down where it is let go, by what was taken hold of and not by whatever the screen has got round to showing:
      // a quick drag is over before it has. Where a building cannot stand, it stays where it was, and says so.
      const at = held(event);
      const grab = now.grab;
      if (grab.what === "site") {
        if (spotBlocked(base, grab.site, at.x, at.y) === null) {
          store.moveSite(grab.site, at.x, at.y);
          store.learn("move");
          playSound("place");
          // Set down with a thump: the dust of it, and the building settling.
          float(at.x, at.y);
          bounced.current = { site: grab.site, at: performance.now() };
        } else playSound("womp", { volume: 0.5 });
        // Dragged with nothing chosen first, that is the end of it; dragged while arranging, the arranging goes on.
        if (now.free) leaveArrange();
        else setCarrying(null);
      } else if (grab.what === "wall") {
        if (wallMoveBlocked(base, grab.index, at.x, at.y) === null) {
          store.moveWall(grab.index, at.x, at.y);
          playSound("place");
          float(at.x, at.y);
        } else playSound("womp", { volume: 0.5 });
      } else if (grab.what === "post") {
        store.movePost(grab.guard, at.x, at.y);
        playSound("place");
        float(at.x, at.y);
      } else {
        if (grab.what === "decor") store.moveDecor(grab.index, at.x, at.y, area);
        else if (grab.what === "land") store.moveLand(grab.index, at.x, at.y, area);
        else store.placeWork(grab.kind, at.x, at.y);
        playSound("place");
        float(at.x, at.y);
        setPlacing(null);
      }
      pointer.current = null;
      press.current = null;
      return;
    }
    // A piece of fence pressed and let go where it was, while fence is being put down: taken up. (Dragged, it was moved, above.)
    if (!now.dragging && now.grab?.what === "wall" && arrange === "fence" && base) {
      store.removeWall(now.grab.index);
      playSound("pick");
    }
    press.current = null;
    const across = event.clientX - now.x;
    if (now.touch && now.free && !now.grab && base && meadowOpen(base) && Math.abs(across) > 70 && Math.abs(across) > Math.abs(event.clientY - now.y) * 2) goArea(area === "camp" ? "meadow" : "camp");
  };
  /**
   * Off the shelf and onto the grass. A thing on a shelf pressed and
   * dragged is carried out over the picture and set down where it is let
   * go; pressed and let go, it is as it was ("where should it go?", and a
   * tap on the picture).
   *
   * With a mouse or a pen, moving is carrying. Under a finger a drag on a
   * shelf is the shelf being scrolled, so there it is held first: a third
   * of a second without moving, and it is in hand (and the page is kept
   * from scrolling under it until it is let go).
   *
   * While it is carried the shelf stays exactly where it is, only faint and
   * out of the pointer's way: taking it away at once made the page close up
   * and the picture move under the hand that was reaching for it.
   */
  const offShelf = (event: React.PointerEvent, what: NonNullable<typeof placing>) => {
    if (event.button !== 0) return;
    const finger = event.pointerType === "touch";
    const from = { x: event.clientX, y: event.clientY };
    let carried = false;
    let timer: number | null = null;
    const still = (touch: Event) => touch.preventDefault();
    const over = (at: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current;
      return canvas && document.elementFromPoint(at.clientX, at.clientY) === canvas ? canvas : null;
    };
    const take = () => {
      carried = true;
      timer = null;
      setChosenDecor(-1);
      setPlacing(what);
      setCarriedOff(true);
      playSound("pick");
      if (finger) {
        // In hand: the page does not scroll under it, and a long press is not asked what else it might mean.
        window.addEventListener("touchmove", still, { passive: false });
        window.addEventListener("contextmenu", still);
        try {
          navigator.vibrate?.(10);
        } catch {
          // No buzz to give.
        }
      }
    };
    const done = () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("touchmove", still);
      window.removeEventListener("contextmenu", still);
    };
    const move = (at: PointerEvent) => {
      if (!carried) {
        const moved = Math.hypot(at.clientX - from.x, at.clientY - from.y) > 9;
        if (!moved) return;
        // A finger that moves before it has held is scrolling the shelf, and is left to.
        if (finger) {
          done();
          return;
        }
        take();
      }
      const canvas = over(at);
      pointer.current = canvas ? toScene({ clientX: at.clientX, clientY: at.clientY, currentTarget: canvas }) : null;
    };
    const up = (at: PointerEvent) => {
      done();
      if (!carried) return;
      const canvas = at.type === "pointerup" ? over(at) : null;
      // Let go over the picture: set down there, by the same tap that would have set it down. Anywhere else: never mind.
      if (canvas) pickRef.current?.({ clientX: at.clientX, clientY: at.clientY, currentTarget: canvas } as unknown as React.PointerEvent<HTMLCanvasElement>);
      // One carried is one set down: the hand is empty again either way.
      setPlacing(null);
      setCarriedOff(false);
      pointer.current = null;
    };
    if (finger) timer = window.setTimeout(take, 320);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  /** Twice on the burrow is the way in to Pip's house; twice on the garden's bed, the way to the garden. */
  const enter = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!base || area !== "camp" || arrange || placing) return;
    const at = toScene(event);
    const found = siteAt(base.spots, at.x, at.y, sitesStanding(base));
    if (found === "burrow") onInside?.();
    else if (!found && garden && gardenAt(base.spots, at.x, at.y)) garden.onOpen();
  };
  pickRef.current = (event) => pick(event);
  const pick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const at = toScene(event);
    // Landscape and constructs being set down: the same in either clearing (a construct only in the camp).
    if (placing?.what) {
      if (placing.what === "work") store.placeWork(placing.kind, at.x, at.y);
      else if (placing.moving) store.moveLand(chosenLand, at.x, at.y, area);
      else store.placeLand(placing.kind, at.x, at.y, area);
      playSound(placing.what === "land" && SCENERY[placing.kind]?.flat ? "splash" : "place", { volume: 0.7 });
      // Landscape goes down a piece after a piece, while there are acorns for it: a stand of trees is several.
      const more = placing.what === "land" && !placing.moving && base.acorns - SCENERY[placing.kind].cost >= SCENERY[placing.kind].cost;
      if (!more) {
        setPlacing(null);
        pointer.current = null;
      }
      return;
    }
    if (area === "meadow") {
      if (placing) {
        if (placing.moving) store.moveDecor(chosenDecor, at.x, at.y, "meadow");
        else store.placeDecor(placing.kind, at.x, at.y, "meadow");
        playSound("place");
        setPlacing(null);
        pointer.current = null;
        return;
      }
      // An animal under the finger is petted: it does nothing but please them both.
      const animal = animalAt(prefersReducedMotion() ? null : performance.now() / 1000, base.animals, at.x, at.y);
      if (animal) {
        petted.current = { x: animal.x, y: animal.y, at: performance.now() };
        playSound(animal.animal === 1 ? "purr" : animal.animal === 0 ? "squeak" : "pop", { pitch: 0.8 + animal.animal * 0.08 });
        return;
      }
      const set = decorAt(base.meadow, at.x, at.y);
      setChosenDecor(set);
      // Nothing set down under the finger: the ground itself, if something was made of it there.
      const ground = set >= 0 ? -1 : landAt(base.meadowLand, at.x, at.y);
      setChosenLand(ground);
      if (set >= 0) setPanel("decor");
      else setPanelOpen(ground >= 0);
      return;
    }
    if (arrange === "move") {
      if (carrying) {
        // Put down where it may stand; anywhere else it stays in the hand.
        if (spotBlocked(base, carrying, at.x, at.y) === null) {
          store.moveSite(carrying, at.x, at.y);
          setCarrying(null);
          playSound("place");
        }
      } else {
        const lifted = siteAt(base.spots, at.x, at.y, sitesStanding(base));
        if (lifted) {
          pointer.current = at;
          setCarrying(lifted);
          playSound("pick");
        }
      }
      return;
    }
    if (arrange === "fence") {
      const piece = wallAt(base, at.x, at.y);
      if (gating) {
        // The piece tapped is made the gate (or, being the gate, a piece again); a tap on the grass is "never mind".
        if (piece >= 0) {
          store.setGate(at.x, at.y);
          playSound("place");
        }
        setGating(false);
        return;
      }
      // A press on a piece is the beginning of taking it up or of moving it: which, is known when it is let go (`pressUp`).
      if (piece < 0 && wallBlocked(base, at.x, at.y) === null) {
        store.placeWall(at.x, at.y);
        playSound("place");
      }
      return;
    }
    if (placing) {
      if (placing.moving) store.moveDecor(chosenDecor, at.x, at.y, "camp");
      else store.placeDecor(placing.kind, at.x, at.y, "camp");
      playSound("place");
      setPlacing(null);
      pointer.current = null;
      return;
    }
    // A parcel that came up the path from the reading: a tap opens it.
    if (parcelAtPoint(look, at.x, at.y)) {
      openParcels(at);
      return;
    }
    // A trophy says which book it is.
    const trophy = trophyAtPoint(look, at.x, at.y);
    if (trophy >= 0 && standing[trophy]) {
      setShownTrophy(standing[trophy].id);
      playSound("click");
      return;
    }
    const thing = decorAt(base.decor, at.x, at.y);
    if (thing >= 0) {
      setChosenDecor(thing);
      setChosenLand(-1);
      setPanelOpen(true);
      return;
    }
    setChosenDecor(-1);
    chosenWork.current = null;
    // A construct under the finger is picked up to be put somewhere else: moving one is free.
    const work = workAt(base.works, at.x, at.y);
    if (work >= 0) {
      // And says what it does where it stands: how far it reaches, and the ground it takes.
      chosenWork.current = base.works[work].kind;
      setPanelOpen(true);
      // A tap on a construct opens the shelf it is on. To move it, it is dragged: a tap used to pick it up, and
      // the next tap anywhere put it down, which nobody could have expected.
      setChosenLand(-1);
      setSelected(base.levels.fence > 0 || base.levels.tower === 0 ? "fence" : "tower");
      setPanel("site");
      playSound("click");
      return;
    }
    // A guardian at their post: a tap is their card, where they are posted and trained.
    const guard = guardAtPoint(look, at.x, at.y);
    if (guard !== null) {
      setChosenLand(-1);
      setChosenGuard(guard);
      setPanel("guard");
      playSound("click");
      return;
    }
    const found = siteAt(base.spots, at.x, at.y, sitesStanding(base));
    if (found) {
      setChosenLand(-1);
      // By night she is in bed in there: a tap on the burrow has her up and about for a while.
      if (found === "burrow" && duskAt((performance.now() - opened.current) / 1000) >= 0.5 && (woken.current === null || performance.now() - woken.current > AWAKE_SECONDS * 1000)) {
        woken.current = performance.now();
        playSound("squeak", { pitch: 1.15 });
      }
      choose(found);
      // A tap on an oak with acorns on it takes them in, without a button.
      if (found === "oak") gatherOak();
      return;
    }
    if (garden && gardenAt(base.spots, at.x, at.y)) {
      setChosenLand(-1);
      setPanel("garden");
      playSound("click");
      return;
    }
    const ground = landAt(base.land, at.x, at.y);
    setChosenLand(ground);
    // Bare ground: whatever was open is put away, and the clearing is all there is to see.
    setPanelOpen(ground >= 0);
  };

  // ---- the guardian whose post the chosen site is ------------------------------------------------
  const guardRow = (guard: Guardian | null = guardAt(selected), alone = false) => {
    if (!guard || (!alone && (levelOf(base, selected) === 0 || base.levels.burrow < GUARDS_FROM))) return null;
    const rank = guardOf(base, guard.id);
    const drilling = base.drill?.guard === guard.id;
    const why = guardBlocked(base, guard.id);
    const to = rank + 1;
    const left = drillLeft(base, now.minutes) ?? 0;
    return (
      <div className={`pip-base-guard ${alone ? "is-alone" : ""}`}>
        <Sprite name="guardian" variant={guard.id} box={alone ? 48 : 40} className={rank === 0 && !drilling ? "is-locked" : ""} />
        <div className="min-w-0 flex-1">
          <p className="pip-base-person" title={`${guard.name}, ${guard.title}. A guardian is posted at a building, and trained by reading as a building is built.`}>
            {guard.short}
            <span className="pip-base-hearts" role="img" aria-label={`Rank ${rank} of ${GUARD_MOST}`} title={`Rank ${rank} of ${GUARD_MOST}`}>
              {Array.from({ length: GUARD_MOST }, (_, step) => (
                <Shield key={step} size={12} aria-hidden fill={step < rank ? "currentColor" : "none"} className={step < rank ? "is-rank" : ""} />
              ))}
            </span>
          </p>
          <p className="text-xs text-on-surface-variant">{guard.does}</p>
          {rank > 0 && guard.post !== "store" && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className="pip-base-chip"
                title={`They keep to the ground about their signpost, and go out to whoever comes within it. Drag the signpost anywhere in the clearing to move them. By night they stand there and throw at what comes near.`}
              >
                <Move size={11} aria-hidden /> Drag their signpost
              </span>
              {asleepUntil(base, guard.id, minute) > 0 ? (
                <span className="pip-base-chip is-bad" title="Worn out by fighting: asleep by the post, and no use to anyone until they wake. It mends by itself, whether or not you are here.">
                  <Moon size={11} aria-hidden /> Asleep, {Math.max(1, Math.ceil((asleepUntil(base, guard.id, minute) - minute) / 60_000))} min
                </span>
              ) : woundsOf(base, guard.id, minute) > 0 ? (
                <span className="pip-base-chip" title={`Knocks taken going out to prowlers they did not finish. At ${WOUNDS_MOST} they are worn out and sleep for three hours; an hour without one and they are shaken off. Backed up by what throws, they do not tire.`}>
                  <Heart size={11} aria-hidden /> {WOUNDS_MOST - woundsOf(base, guard.id, minute)} / {WOUNDS_MOST}
                </span>
              ) : null}
            </p>
          )}
          {drilling ? (
            <div className="pip-base-job mt-1" title="Trained by reading, not by waiting">
              <progress max={base.drill?.needs ?? 1} value={(base.drill?.needs ?? 0) - left} aria-label="Reading done toward the training" />
              <span className="text-xs tabular-nums text-on-surface-variant">{left} min of reading to go</span>
            </div>
          ) : rank < GUARD_MOST ? (
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="tactile-button px-2.5 py-1 text-xs disabled:opacity-60"
                disabled={why !== null}
                title={`${guardCost(to)} acorns to begin, and ${guardMinutes(to)} minutes of reading to finish`}
                onClick={() => {
                  store.trainGuard(guard.id);
                  playSound("horn", { volume: 0.6 });
                }}
              >
                <span className="flex items-center gap-2">
                  {rank === 0 ? "Post" : "Train"}
                  {acorns(guardCost(to))}
                  <span className="pip-base-acorns">
                    <BookOpen size={12} aria-hidden />
                    {guardMinutes(to)}m<span className="sr-only"> of reading</span>
                  </span>
                </span>
              </button>
              {why && <span className="text-xs text-on-surface-variant">{WHY_NO_GUARD[why](base, guard.id)}</span>}
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  // ---- the shelves: tiles for what there is, by what it is for -------------------------------------------
  /** Which shelf is open: it follows what is chosen. None in the meadow. */
  const shelf: Shelf | null = area !== "camp" ? null : panel === "decor" ? "decor" : panel === "people" ? "heroes" : panel === "guard" ? "heroes" : panel === "garden" ? "camp" : shelfOfSite(selected);
  const openShelf = (to: Shelf) => {
    // The key of the shelf that is open shuts it: the clearing is all there is to see again.
    if (panelOpen && shelf === to && tab === "camp" && chosenDecor < 0 && chosenLand < 0) {
      setPanelOpen(false);
      playSound("click");
      return;
    }
    setTab("camp");
    setChosenDecor(-1);
    setChosenLand(-1);
    setPlacing(null);
    if (to === "camp") {
      if (shelfOfSite(selected) !== "camp") setSelected("burrow");
      setPanel("site");
    } else if (to === "defence") {
      // The lookout until there is a fence to be had; then the fence.
      setSelected(base.levels.burrow < FENCE_FROM || (base.levels.fence === 0 && base.levels.tower === 0) ? "tower" : "fence");
      setPanel("site");
    } else setPanel(to === "heroes" ? "people" : "decor");
    playSound("click");
  };
  /** A building's tile: its picture, and its level; a plus where there is nothing built yet. */
  const siteTile = (site: Site) => {
    const yard = site === "yard0" ? base.yard[0] : site === "yard1" ? base.yard[1] : null;
    const level = levelOf(base, site);
    const chosen = panel === "site" && site === selected && chosenDecor < 0;
    return (
      <button
        key={site}
        type="button"
        className={`pip-base-tile ${chosen ? "is-chosen" : ""}`}
        aria-pressed={chosen}
        aria-label={`${siteName(base, site)}, ${level === 0 ? "not built" : `level ${level}`}${jobOn(base, site) ? ", being built" : ""}`}
        title={`${siteName(base, site)}${level === 0 ? "" : `, level ${level}`}`}
        onClick={() => choose(site)}
      >
        <Sprite
          name={site === "fence" ? "fencepiece" : yard ? (yard.kind ?? "workshop") : pathLook(site, level)?.name ?? site}
          variant={site === "fence" ? Math.max(1, level) : (pathLook(site, level)?.variant ?? level)}
          box={30}
          className={level === 0 && (site === "fence" || (yard !== null && !yard.kind)) ? "is-locked" : ""}
        />
        <span className="pip-base-tile-level">{level > 0 ? level : "+"}</span>
        {jobOn(base, site) && <Hammer size={11} className="pip-base-tile-mark is-working" aria-hidden />}
        {site === "oak" && ready > 0 && !jobOn(base, site) && <Nut size={11} className="pip-base-tile-mark is-waiting" aria-hidden />}
        {!chosen && mark(site)}
      </button>
    );
  };
  /** A thing a level of the camp has yet to bring: its picture greyed, and the level on it. A tap goes to the burrow, which is what brings it. */
  const shutTile = (key: string, name: string, level: number, picture: React.ReactNode) => (
    <button key={key} type="button" className="pip-base-tile is-shut" aria-label={`${name}: comes when the camp is level ${level}`} title={`${name}. Comes when the camp is level ${level}.`} onClick={() => choose("burrow")}>
      {picture}
      <span className="pip-base-tile-lock">
        <Lock size={9} aria-hidden />
        {level}
      </span>
    </button>
  );
  /** A picture for a thing a level opens. */
  const openPicture = (entry: Opened) =>
    entry.kind === "ground" ? (
      <Trees size={15} aria-hidden />
    ) : entry.kind === "plot" ? (
      <Sprite name="workshop" variant={0} box={22} />
    ) : entry.kind === "decor" ? (
      <Sprite name="decor" variant={0} box={22} />
    ) : entry.kind === "meadow" ? (
      <TreePine size={15} aria-hidden />
    ) : entry.kind === "guards" ? (
      <Sprite name="guardian" variant={0} box={22} />
    ) : entry.kind === "paths" ? (
      <Signpost size={15} aria-hidden />
    ) : entry.kind === "work" ? (
      <Sprite name="work" variant={entry.which ?? 0} box={22} />
    ) : entry.kind === "foe" ? (
      <ShieldAlert size={15} aria-hidden />
    ) : entry.kind === "fence" ? (
      <Sprite name="fencepiece" variant={1} box={22} />
    ) : entry.kind === "postcard" ? (
      <Camera size={15} aria-hidden />
    ) : (
      <Star size={15} aria-hidden />
    );

  const campShelf = () => {
    const level = base.levels.burrow;
    const next = level < MAX_LEVEL ? campOpens(level + 1) : [];
    return (
      <section className="pip-base-card pip-base-shelf" aria-label="Camp">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="pip-base-title" title="The camp has one level, and it is the burrow's. Raise the burrow and the camp is a level up: each level opens more, and lets everything else be built as high.">
            The Hollow
          </h3>
          <p className="pip-base-level">Level {level}</p>
        </div>
        {next.length > 0 && (
          <p className="pip-base-opens">
            <span className="pip-base-opens-at">Level {level + 1} brings</span>
            {next.map((entry) => (
              <span key={entry.name} className={`pip-base-open ${entry.kind === "foe" ? "is-foe" : ""}`} role="img" aria-label={entry.name} title={`${entry.name}. ${entry.says}.`}>
                {openPicture(entry)}
              </span>
            ))}
          </p>
        )}
        <div className="pip-base-shelf-row" role="group" aria-label="Buildings">
          {/* What stands, and of what is still to come only the next: nothing else stands about locked. */}
          {SHELF_SITES.camp
            .filter((site, index, all) => plotOpen(base, site) || all.findIndex((other) => !plotOpen(base, other)) === index)
            .map((site) =>
              plotOpen(base, site) ? siteTile(site) : shutTile(site, site === "yard0" ? "A plot in the yard" : "A second plot", PLOT_FROM[site as "yard0" | "yard1"], <Sprite name="workshop" variant={0} box={30} />)
            )}
          {garden && (
            <button
              type="button"
              className={`pip-base-tile ${panel === "garden" && chosenDecor < 0 ? "is-chosen" : ""}`}
              aria-pressed={panel === "garden" && chosenDecor < 0}
              aria-label={`The garden${garden.ripe > 0 ? `: ${garden.ripe} ripe` : ""}`}
              title="The garden"
              onClick={() => {
                setPanel("garden");
                setChosenDecor(-1);
                setChosenLand(-1);
                playSound("click");
              }}
            >
              <Sprite name="gardenbed" variant={garden.ripe > 0 ? 2 : garden.growing > 0 ? 1 : 0} box={30} />
              {garden.ripe > 0 && <span className="pip-base-tile-dot" aria-hidden="true" />}
            </button>
          )}
        </div>
      </section>
    );
  };

  const defenceShelf = () => {
    // Of the constructs: those this level has, and the next one to come. Nothing else stands about locked.
    const nextWork = WORKS.map((work, kind) => ({ work, kind }))
      .filter((entry) => base.levels.burrow < entry.work.burrow)
      .sort((a, b) => a.work.burrow - b.work.burrow || a.work.cost - b.work.cost)[0];
    const shown = WORKS.map((work, kind) => ({ work, kind })).filter((entry) => base.levels.burrow >= entry.work.burrow || entry.kind === nextWork?.kind);
    return (
      <section className="pip-base-card pip-base-shelf" aria-label="Defence">
        <h3 className="pip-base-title" title="What sees the prowlers off. Where each thing stands decides who gets through: Arrange shows how far everything reaches.">
          Defence
        </h3>
        <div className="pip-base-shelf-row" role="group" aria-label="Walls and watch">
          {siteTile("tower")}
          {base.levels.burrow < FENCE_FROM && base.levels.fence === 0 ? shutTile("fence", "The fence", FENCE_FROM, <Sprite name="fencepiece" variant={1} box={30} />) : siteTile("fence")}
        </div>
        {shown.length > 0 && (
          <>
            <h4 className="pip-base-heading mt-3" title="One of each. Set down where you want it, and moved for nothing: each does one thing to whoever comes near it.">
              Constructs
            </h4>
            <div className="pip-base-shelf-row" role="group" aria-label="Constructs">
              {shown.map(({ work, kind }) => {
                if (base.levels.burrow < work.burrow) return shutTile(`work-${kind}`, work.name, work.burrow, <Sprite name="work" variant={kind} box={30} />);
                const why = workBlocked(base, kind);
                const here = base.works.some((entry) => entry.kind === kind);
                return (
                  <button
                    key={work.name}
                    type="button"
                    className={`pip-base-tile is-wide ${placing?.what === "work" && placing.kind === kind ? "is-chosen" : ""}`}
                    disabled={why !== null}
                    aria-label={`${work.name}${here ? ", move it" : `, ${work.cost} acorns`}`}
                    title={`${work.name}. ${work.does}.`}
                    onPointerDown={(event) => offShelf(event, { kind, moving: here, what: "work" })}
                    onClick={() => {
                      setChosenDecor(-1);
                      setChosenLand(-1);
                      pointer.current = null;
                      setPlacing({ kind, moving: here, what: "work" });
                      playSound("pick");
                    }}
                  >
                    <Sprite name="work" variant={kind} box={32} className={why ? "is-locked" : ""} />
                    {here ? <Move size={11} aria-hidden /> : acorns(work.cost, 10)}
                    {!here && kind === WORKS.findIndex((other, at) => base.levels.burrow >= other.burrow && !base.works.some((entry) => entry.kind === at)) && mark("fence")}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>
    );
  };

  const heroesShelf = () => {
    const here = residents(base).length;
    const blades = bladesWon(base).length;
    return (
      <section className="pip-base-card pip-base-shelf" aria-label="People">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3
            className="pip-base-title"
            title="The scouts' hut trains the scouts who raid. Heroes come for the books you finish: one leads each raid, and they are about the camp for friends to see. Guardians are hired, and hold the camp against prowlers."
          >
            People
          </h3>
          <p className="pip-base-level" title={`${here} of the ${HEROES.length} heroes have come`}>
            {here} of {HEROES.length}
          </p>
          {blades > 0 && (
            <p className="pip-base-chip" title={`Blades won: ${blades} of ${BLADES.length}. Each was a magpie lord's, or a friend's gift. A hero is given one under "Who lives here".`}>
              <Swords size={12} aria-hidden /> {blades} / {BLADES.length}
            </p>
          )}
        </div>
        <div className="pip-base-shelf-row" role="group" aria-label="The hut, and who lives here">
          {siteTile("hut")}
          <button
            type="button"
            className={`pip-base-tile ${panel === "people" && chosenDecor < 0 ? "is-chosen" : ""}`}
            aria-pressed={panel === "people" && chosenDecor < 0}
            aria-label="Who lives here"
            title="Who lives here: Pip, and the heroes your finished books have brought"
            onClick={() => {
              setPanel("people");
              setChosenDecor(-1);
              playSound("click");
            }}
          >
            <Users size={20} aria-hidden />
          </button>
        </div>
        {base.levels.burrow >= GUARDS_FROM && (
          <>
            <h4
              className="pip-base-heading mt-3"
              title="Seven, hired for acorns and trained by reading, each at a building of the camp. Each holds the ground about a signpost you place, and fights whoever comes into it. They never go raiding. They grow by rank, and look it."
            >
              Guardians
            </h4>
            <div className="pip-base-shelf-row" role="group" aria-label="Guardians">
              {GUARDIANS.map((guard) => {
                const rank = guardOf(base, guard.id);
                const drilling = base.drill?.guard === guard.id;
                const chosen = panel === "guard" && chosenGuard === guard.id && chosenDecor < 0;
                return (
                  <button
                    key={guard.id}
                    type="button"
                    className={`pip-base-tile ${chosen ? "is-chosen" : ""}`}
                    aria-pressed={chosen}
                    aria-label={`${guard.name}, ${rank === 0 ? "not posted" : `rank ${rank}`}${drilling ? ", in training" : ""}`}
                    title={`${guard.name}, ${guard.title}`}
                    onClick={() => {
                      setChosenGuard(guard.id);
                      setPanel("guard");
                      setChosenDecor(-1);
                      setChosenLand(-1);
                      playSound("click");
                    }}
                  >
                    <Sprite name="guardian" variant={guard.id} box={30} className={rank === 0 && !drilling ? "is-locked" : ""} />
                    <span className="pip-base-tile-level">{rank > 0 ? rank : "+"}</span>
                    {drilling && <BookOpen size={11} className="pip-base-tile-mark is-working" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>
    );
  };

  /** The garden's card: what is in its beds, and the way to them. */
  const gardenCard = () =>
    garden ? (
      <section className="pip-base-card mt-3" aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="pip-base-portrait is-site">
            <Sprite name="gardenbed" variant={garden.ripe > 0 ? 2 : garden.growing > 0 ? 1 : 0} box={48} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="pip-base-title" title="Seeds grow here, watered by reading in focus. Seeds are what Pip's shop takes: her looks, her things, her rooms.">
                The garden
              </h3>
              <p className="pip-base-level" title="Beds planted, of the beds there are">
                {garden.growing + garden.ripe} of {garden.plots}
              </p>
            </div>
            <p className="text-sm text-on-surface">{garden.ripe > 0 ? `${garden.ripe} ripe to pick` : garden.growing > 0 ? `${garden.growing} growing` : "Nothing planted"}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={`tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold ${garden.ripe > 0 ? "is-ready" : ""}`} onClick={garden.onOpen}>
            {garden.ripe > 0 ? "Pick" : garden.growing > 0 ? "Look in" : "Plant"}
          </button>
        </div>
      </section>
    ) : null;

  /** A guardian's own card, from the shelf. */
  const guardCard = () => (
    <section className="pip-base-card mt-3" aria-live="polite">
      {guardRow(GUARDIANS[chosenGuard] ?? null, true)}
    </section>
  );

  // ---- the chosen site's card ---------------------------------------------------------------
  const siteCard = () => {
    const level = levelOf(base, selected);
    const next = level + 1;
    const top = topOf(selected);
    const yard = selected === "yard0" ? base.yard[0] : selected === "yard1" ? base.yard[1] : null;
    const job = jobOn(base, selected);
    const why = blocked(base, selected);
    const says = yard ? (yard.kind ? yardDoes(yard.kind, level) : "Room for one of four things") : does(selected as (typeof BUILDINGS)[number], level);
    const nextSays = yard ? (yard.kind ? yardDoes(yard.kind, next) : null) : does(selected as (typeof BUILDINGS)[number], next);
    const upgrade = (kind?: YardKind) => (
      <button
        key={kind ?? "next"}
        type="button"
        className="tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
        disabled={blocked(base, selected, kind) !== null}
        title={`${kind ? `${yardDoes(kind, 1)}. ` : ""}${costOf(selected, next)} acorns to begin, and ${minutesOf(base, selected, next, now.mood)} minutes of reading to finish${
          moodQuicker(now.mood) > 0 ? `. Pip is happy at home, so she builds ${Math.round(moodQuicker(now.mood) * 100)}% quicker.` : ""
        }`}
        onClick={() => {
          store.build(selected, kind);
          playSound("hammer");
        }}
      >
        <span className="flex items-center gap-2">
          {kind && <Sprite name={kind} variant={1} box={22} />}
          {kind ? YARD_NAMES[kind] : level === 0 ? "Build" : "Upgrade"}
          {acorns(costOf(selected, next))}
          <span className="pip-base-acorns">
            <BookOpen size={12} aria-hidden />
            {minutesOf(base, selected, next, now.mood)}m<span className="sr-only"> of reading</span>
            {moodQuicker(now.mood) > 0 && <Heart size={10} aria-hidden fill="currentColor" className="pip-base-happy" />}
          </span>
        </span>
      </button>
    );
    return (
      <section className="pip-base-card mt-3" aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="pip-base-portrait is-site">
            <Sprite
              name={selected === "fence" ? "fencepiece" : yard ? (yard.kind ?? "workshop") : pathLook(selected, level)?.name ?? selected}
              variant={selected === "fence" ? Math.max(1, level) : (pathLook(selected, level)?.variant ?? level)}
              box={48}
              className={level === 0 && (selected === "fence" || (yard !== null && !yard.kind)) ? "is-locked" : ""}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="pip-base-title">{siteName(base, selected)}</h3>
              <p className="pip-base-level">{level === 0 ? "Not built" : `Level ${level}`}</p>
            </div>
            <p className="text-sm text-on-surface">{says}</p>
          </div>
        </div>
        {level > 0 && level < top && nextSays && <p className="text-xs text-on-surface-variant">Next: {nextSays}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {job ? (
            <div className="pip-base-job" title="Finished by reading, not by waiting">
              <progress max={job.needs} value={job.needs - jobLeft(job, now.minutes)} aria-label="Reading done toward it" />
              <span className="text-xs tabular-nums text-on-surface-variant">
                {job.needs - jobLeft(job, now.minutes)} of {job.needs} minutes read
              </span>
            </div>
          ) : level >= top ? (
            <p className="text-xs text-on-surface-variant">{WHY_NOT.top(base, selected)}</p>
          ) : yard && !yard.kind ? (
            <>
              {/* (The market stall paid the arcade's games more: not offered since 2026-10-15. One already built stays.) */}
              {YARD_KINDS.filter((kind) => kind !== "stall" && !base.yard.some((slot) => slot.kind === kind)).map((kind) => upgrade(kind))}
              {why && why !== "taken" && <span className="text-xs text-on-surface-variant">{WHY_NOT[why](base, selected)}</span>}
            </>
          ) : (
            <>
              {upgrade()}
              {why && <span className="text-xs text-on-surface-variant">{WHY_NOT[why](base, selected)}</span>}
            </>
          )}
          {harmOf(base, selected) > 0 && (
            <button
              type="button"
              className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60"
              disabled={base.acorns < fixCost(base, selected, now.day)}
              title={
                isBroken(base, selected)
                  ? `Broken by prowlers. Until it is put right, ${BROKEN_DOES[selected as Placed]}, and it is not built on.`
                  : `Knocked about by a prowler: ${harmOf(base, selected)} of ${HARM_MOST}. ${WORN_DOES[selected as Placed] ? `For each knock ${WORN_DOES[selected as Placed]}. ` : ""}At ${HARM_MOST} it is broken: ${BROKEN_DOES[selected as Placed]}. It is not built on until it is put right.`
              }
              onClick={() => {
                store.fixSite(selected as Placed);
                playSound("hammer");
                if ((PLACED as readonly Site[]).includes(selected)) {
                  float(base.spots[selected as Placed][0], base.spots[selected as Placed][1] - 6);
                  bounced.current = { site: selected as Placed, at: performance.now() };
                }
              }}
            >
              <span className="flex items-center gap-2">
                {isBroken(base, selected) ? "Broken: fix" : "Fix"} {acorns(fixCost(base, selected, now.day))}
              </span>
            </button>
          )}
          {selected === "burrow" && onInside && (
            <button type="button" className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs" title="The burrow is Pip's house: her rooms, her things and the shop are inside" onClick={onInside}>
              <House size={13} aria-hidden /> Go inside
            </button>
          )}
          {selected === "fence" && level > 0 && (
            <button type="button" className="tactile-button px-3 py-1.5 text-xs" title="Fence goes down a piece at a time, wherever you want the prowlers held" onClick={() => setArrange("fence")}>
              {piecesLeft > 0 ? `Put down ${piecesLeft} ${piecesLeft === 1 ? "piece" : "pieces"}` : "Move the fence"}
            </button>
          )}
          {selected === "oak" && level > 0 && (
            <button
              type="button"
              className="tactile-button px-3 py-1.5 text-xs disabled:opacity-60"
              disabled={ready === 0 || room === 0}
              title={
                room === 0
                  ? "The larder is full"
                  : `The oak holds ${oakHolds(base)}. ${streakAdds(streak) > 0 ? `Your ${streak}-day streak adds ${Math.round(streakAdds(streak) * 100)}% to what is gathered.` : "A reading streak adds to what is gathered: 10% from 3 days, up to 50% from 30."}`
              }
              onClick={gatherOak}
            >
              Gather {acorns(gatherBrings(base, now.minutes, streak, now.day))}
            </button>
          )}
          {yard?.kind && !job && (
            <button
              type="button"
              className="tactile-button ml-auto px-3 py-1.5 text-xs"
              title="Makes room for something else. Nothing comes back for it."
              onClick={() =>
                void askConfirm({ title: `Clear the ${YARD_NAMES[yard.kind!].toLowerCase()}?`, body: "The plot is free for something else. Nothing comes back for what stood there.", confirmLabel: "Clear it", danger: true }).then(
                  (ok) => ok && store.clearPlot(selected)
                )
              }
            >
              Clear the plot
            </button>
          )}
        </div>
        {/* (Each of the oak, the lookout and the hut used to take one of two paths at level 3. The choice is not offered since
            2026-10-15; a path already taken keeps what it does.) */}
        {guardRow()}
      </section>
    );
  };

  // ---- one raid's card -----------------------------------------------------------------------
  const raidCard = (kind: RaidKind, plan: RaidPlan, said: ReturnType<typeof scoutsSay>, slot = 0) => {
    const why = raidBlocked(base, kind, now, slot);
    const begin = () => {
      setSent(null);
      const begun = store.startRaid(kind, slot, false);
      if (begun) {
        setRaid(begun);
        playSound("horn");
      }
    };
    return (
      <section key={`${kind}-${slot}`} className="pip-base-card min-w-0">
        <div className="flex items-start gap-3">
          <span className="pip-base-portrait">
            <Sprite name={kind === "king" ? "king" : "nest"} variant={kind === "king" ? undefined : plan.tier} box={52} />
            {plan.champion !== null && <Sprite name="champion" variant={plan.champion} box={30} className="pip-base-portrait-foe" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="pip-base-heading">
              <span className="truncate">{plan.name}</span>
              {kind === "camp" && <span className="ml-auto shrink-0 text-xs font-normal tabular-nums text-on-surface-variant">{plan.n + 1}</span>}
            </h3>
            {championName(plan) && <p className="truncate text-xs text-on-surface-variant" title={championName(plan) ?? undefined}>{championName(plan)}</p>}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm tabular-nums text-on-surface">
              <span title={`Up to ${plan.loot} acorns${kind === "king" ? `, and ${monthName(monthOf(now.day))}'s banner` : ""}`}>{acorns(plan.loot, 13)}</span>
              {kind === "king" && <Sprite name="banner" variant={seasonOf(now.day)} box={18} />}
              {said && <span title="How the raid would go if the scouts were left to it. Fought well, it goes at least this well.">{stars(said.stars, 12)}</span>}
            </p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="tactile-button tactile-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            disabled={why !== null}
            title={`Fight it yourself. Provisions: ${plan.cost} acorns.`}
            onClick={begin}
          >
            <Swords size={13} aria-hidden /> Raid {acorns(plan.cost)}
          </button>
          <button
            type="button"
            className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-60"
            disabled={why !== null}
            title={`The scouts go without you, and bring ${Math.round(SENT_SHARE * 100)}% of what they take`}
            onClick={() => {
              const came = store.sendRaid(kind, slot);
              setSent(came);
              if (came) {
                playSound(came.won ? "fanfare" : "womp", { volume: 0.8 });
                if (came.loot > 0) acornsSound(came.loot);
              }
            }}
          >
            <Send size={12} aria-hidden /> Send
          </button>
          {why && <span className="text-xs text-on-surface-variant">{WHY_NO_RAID[why](base, plan, now)}</span>}
        </div>
      </section>
    );
  };

  // ---- who lives here: Pip, and the heroes who have come ------------------------------------------------
  const peopleCard = () => (
    <section className="pip-base-card mt-3" aria-live="polite">
      <h3 className="pip-base-title" title="Pip, and the heroes your finished books have brought. One leads each raid; the ones with a bed in the hut are about the camp.">
        Who lives here
      </h3>
      <ul className="pip-base-people">
        <li>
          <PipFace skin={skin} outfit={outfit} box={40} move={(now.mood ?? 0) >= 75 ? "cheer" : "idle"} />
          <div className="min-w-0 flex-1">
            <p className="pip-base-person">
              Pip
              {now.mood !== undefined &&
                hearts(
                  now.mood / 20,
                  `As happy as she is at home. ${moodQuicker(now.mood) > 0 ? `She builds ${Math.round(moodQuicker(now.mood) * 100)}% quicker for it.` : "Happier, she builds quicker: reading, play and a snack cheer her up."}`
                )}
            </p>
          </div>
        </li>
        {residents(base).map((hero) => {
          return (
            <li key={hero.id}>
              <Sprite name="hero" variant={hero.id} box={40} className={asleepUntil(base, 100 + hero.id, minute) > 0 ? "is-locked" : ""} />
              {!hasBed(base, hero.id) && (
                <span className="pip-base-chip" title="No bed in the hut: on the road, and not about the camp. A bigger hut has more beds; or choose them to lead the raids, and they have the first.">
                  <BedDouble size={11} aria-hidden /> none
                </span>
              )}
              {asleepUntil(base, 100 + hero.id, minute) > 0 && (
                <span className="pip-base-chip is-bad" title="Worn out: put down on a raid. Asleep in the hut, and no use to anyone until they wake. It mends by itself.">
                  <Moon size={11} aria-hidden /> {Math.max(1, Math.ceil((asleepUntil(base, 100 + hero.id, minute) - minute) / 60_000))} min
                </span>
              )}
              {bladesWon(base).length > 0 &&
                (() => {
                  const held = bladeOf(base, hero.id);
                  // The next blade nobody else is carrying, or none: a press goes round them.
                  const free = bladesWon(base).filter((blade) => blade === held || !base.arms.includes(blade));
                  const next = held < 0 ? (free[0] ?? -1) : (free[free.indexOf(held) + 1] ?? -1);
                  return (
                    <button
                      type="button"
                      className={`pip-base-tile ${held >= 0 ? "is-chosen" : ""}`}
                      aria-label={held >= 0 ? `${hero.short} carries ${BLADES[held].name}. Change it.` : `${hero.short} carries no blade. Give one.`}
                      title={held >= 0 ? `${BLADES[held].name}: ${BLADES[held].title}. ${bladeSays(BLADES[held])}. Won from ${BLADES[held].from}.` : "No blade. Press to give one of the camp's."}
                      onClick={() => {
                        store.armHero(hero.id, next);
                        playSound(next >= 0 ? "pick" : "click", { pitch: 1.3 });
                      }}
                    >
                      {held >= 0 ? <Sprite name="blade" variant={held} box={28} /> : <Swords size={16} aria-hidden className="opacity-40" />}
                    </button>
                  );
                })()}
              <div className="min-w-0 flex-1">
                <p className="pip-base-person" title={`${hero.name}, ${hero.title}. ${hero.does}.`}>
                  {hero.short}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {residents(base).length === 0 && (
        <p className="mt-1 text-xs text-on-surface-variant" title="Every book you finish stands in the camp as a trophy, and a trophy of the right kind brings a hero to live here">
          Finish a book, and someone moves in.
        </p>
      )}
    </section>
  );

  // ---- things to set down ---------------------------------------------------------------------------
  const decorCard = (onShelf = false) =>
    !decorOpen(base) ? (
      <section className={`pip-base-card ${onShelf ? "pip-base-shelf" : "mt-3"}`} aria-label="Decorate">
        <h3 className="pip-base-title">Decorate</h3>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-on-surface">
          <Lock size={14} aria-hidden /> Comes when the camp is level {DECOR_FROM}
          <button type="button" className="tactile-button px-2.5 py-1 text-xs" onClick={() => choose("burrow")}>
            The burrow
          </button>
        </p>
      </section>
    ) : (
    <section className={`pip-base-card ${onShelf ? "pip-base-shelf" : "mt-3"}`} aria-label="Decorate">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="pip-base-title" title="Things for the clearing, for their own sake. Each lends the camp a little charm, and charm is what brings the animals.">
          Decorate
        </h3>
        <p className="pip-base-level" title={nextAnimal ? `The camp's charm. ${nextAnimal.name} comes at ${nextAnimal.charm}.` : "The camp's charm. Every animal has come."}>
          <Sparkles size={11} aria-hidden className="mr-1 inline" />
          {charm(base)}
          {nextAnimal ? ` / ${nextAnimal.charm}` : ""}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DECOR.map((thing, kind) => {
          const why = decorBlocked(base, kind, area);
          return (
            <button
              key={thing.name}
              type="button"
              className="pip-base-tile is-wide"
              disabled={why !== null}
              aria-label={`${thing.name}, ${thing.cost} acorns`}
              title={why === "full" ? `${thing.name}. The clearing has all it can take.` : `${thing.name}. Charm +${thing.charm}.`}
              onPointerDown={(event) => offShelf(event, { kind, moving: false })}
              onClick={() => {
                setChosenDecor(-1);
                pointer.current = null;
                setPlacing({ kind, moving: false });
                playSound("pick");
              }}
            >
              <Sprite name="decor" variant={kind} box={30} className={why ? "is-locked" : ""} />
              {acorns(thing.cost, 10)}
            </button>
          );
        })}
      </div>
      <h3 className="pip-base-heading mt-3" title="Ponds, a knoll, trees, flowers: the ground made yours. It does nothing but look as you want it to.">
        The lie of the land
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {SCENERY.map((piece, kind) => {
          const why = landBlocked(base, kind, area);
          return (
            <button
              key={piece.name}
              type="button"
              className={`pip-base-tile is-wide ${placing?.what === "land" && placing.kind === kind ? "is-chosen" : ""}`}
              disabled={why !== null}
              aria-label={`${piece.name}, ${piece.cost} acorns`}
              title={why === "full" ? `${piece.name}. The clearing has all the landscape it can take.` : piece.name}
              onPointerDown={(event) => offShelf(event, { kind, moving: false, what: "land" })}
              onClick={() => {
                setChosenDecor(-1);
                setChosenLand(-1);
                pointer.current = null;
                setPlacing({ kind, moving: false, what: "land" });
                playSound("pick");
              }}
            >
              <Sprite name="land" variant={kind} box={34} className={why ? "is-locked" : ""} />
              {acorns(piece.cost, 10)}
            </button>
          );
        })}
      </div>
    </section>
    );

  // ---- a piece of landscape chosen in the picture --------------------------------------------------------------
  const lands = area === "meadow" ? base.meadowLand : base.land;
  const landCard = () => (
    <section className="pip-base-card mt-3">
      <div className="flex items-center gap-3">
        <span className="pip-base-portrait">
          <Sprite name="land" variant={lands[chosenLand].kind} box={48} />
        </span>
        <h3 className="pip-base-title flex-1">{SCENERY[lands[chosenLand].kind].name}</h3>
        <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={() => setPlacing({ kind: lands[chosenLand].kind, moving: true, what: "land" })}>
          Move it
        </button>
        <button
          type="button"
          className="tactile-button px-3 py-1.5 text-xs"
          title="Nothing comes back for it"
          onClick={() => {
            store.removeLand(chosenLand, area);
            setChosenLand(-1);
            playSound("pick");
          }}
        >
          Take it away
        </button>
      </div>
    </section>
  );

  // ---- the meadow's own card: who lives there, and who might ------------------------------------------------
  const animalsCard = () => (
    <section className="pip-base-card mt-3" aria-live="polite">
      <h3 className="pip-base-title" title="Animals come to a camp that has been made charming, by what is set about it and by the books you have finished. Once here, they stay.">
        The meadow
        <span className="pip-base-chip ml-2 align-middle" title="How charming the camp is">
          <Sparkles size={12} aria-hidden /> {charm(base)}
        </span>
      </h3>
      <ul className="pip-base-people">
        {ANIMALS.map((animal) => {
          const here = base.animals.includes(animal.id);
          return (
            <li key={animal.id}>
              <Sprite name="animal" variant={animal.id} box={36} className={here ? "" : "is-locked"} />
              <div className="min-w-0 flex-1">
                <p className="pip-base-person">
                  {animal.name}
                  {!here && (
                    <span className="pip-base-chip ml-2" title={`Comes when the camp's charm is ${animal.charm}`}>
                      <Sparkles size={11} aria-hidden /> {animal.charm}
                    </span>
                  )}
                </p>
                <p className="text-xs text-on-surface-variant">{animal.does}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );

  /** To the camp, or out to the meadow: nothing chosen is carried across. */
  const goArea = (to: Place) => {
    setArea(to);
    setChosenDecor(-1);
    setChosenLand(-1);
    setPlacing(null);
    setPanel("site");
    setPanelOpen(false);
    leaveArrange();
    playSound("swish");
  };

  const leaveArrange = () => {
    setGating(false);
    setArrange(null);
    setCarrying(null);
    pointer.current = null;
  };
  const beginArrange = (how: "move" | "fence" = "move") => {
    setPlacing(null);
    setChosenDecor(-1);
    setCarrying(null);
    pointer.current = null;
    setArrange(how);
  };

  return (
    <div
      ref={rootRef}
      className="pip-base is-stage"
      data-mode={lay.mode}
      data-tab={tab}
      // Laid over the picture, the page is the picture's size exactly: nothing hangs off its edge.
      style={lay.mode === "stage" ? { width: GAME_W * fit.css, height: (GAME_H + lay.sky + lay.ground) * fit.css } : undefined}
    >
      <div className="pip-base-head">
        <div className="pip-base-head-left">
        <p className="pip-base-stats">
          <span
            className="pip-base-chip"
            title={[
              `The camp's level: the burrow's. ${base.levels.burrow < MAX_LEVEL ? `Level ${base.levels.burrow + 1} brings ${campOpens(base.levels.burrow + 1).map((entry) => entry.name.toLowerCase()).join(", ")}.` : "It is as high as it goes."}`,
              `${SEASONS[season].name}: ${SEASONS[season].does.toLowerCase()}.`,
              streak > 0 ? `A ${streak}-day reading streak${streakAdds(streak) > 0 ? `: ${Math.round(streakAdds(streak) * 100)}% more from the oak` : ""}.` : "",
              base.levels.burrow >= PROWLERS_FROM && readingNow && readingKind !== null && GENRE_FOE[readingKind] !== null && GENRE_FOE[readingKind] !== undefined
                ? `Reading “${readingNow.title}”: ${PROWLER_NAMES[GENRE_FOE[readingKind] as number]} come out of the wood oftener.`
                : ""
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <House size={13} aria-hidden /> Level <strong>{base.levels.burrow}</strong>
          </span>
          <span
            className="pip-base-chip"
            title={`Acorns. The larder holds ${holds(base)}.${base.levels.oak > 0 ? ` Ten minutes of reading drops ${Math.round(oakDrops(base) * (1 + streakAdds(streak)))} from the oak.` : ""}`}
          >
            <Sprite name="acorn" box={16} />
            <strong key={base.acorns} className="pip-base-pop">
              {base.acorns}
            </strong>
            <span className="pip-base-of">/ {holds(base)}</span>
            <span className="sr-only"> acorns</span>
            {gained && gained.acorns > 0 && (
              <span key={gained.at} className="pip-base-gain" aria-hidden="true">
                +{gained.acorns}
              </span>
            )}
          </span>
          {base.levels.burrow >= MEADOW_FROM && charm(base) > 0 && (
            <span className="pip-base-chip" title={`How charming the camp is: what is set about it, its trophies and its banners. Charm brings the animals, and better parcels.${nextAnimal ? ` ${nextAnimal.name} comes at ${nextAnimal.charm}.` : ""}`}>
              <Sparkles size={14} aria-hidden /> <strong>{charm(base)}</strong>
              <span className="sr-only"> charm</span>
            </span>
          )}
        </p>
        {tab === "camp" && (
          <div className="pip-camp-say">
            <PipFace skin={skin} outfit={outfit} box={lay.mode === "side" ? 36 : 52} move={next.full ? "idea" : told !== null ? "idea" : "idle"} className="pip-camp-say-face" />
            {/* Three lines at most: a tip when one is due (or the book a tapped trophy stands for), the one next thing, and the parcels. What has gone wrong is said while it is so. */}
            <div className="pip-camp-say-bubble" role="status">
              {base.wreck && (
                <p className="pip-camp-say-line">
                  <Hammer size={14} className="shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1" title="Mended by reading, like everything here. The fence is not built on until it is.">
                    {base.wreck.by}'s scouts got in. I am mending the fence: {wreckLeft(base, now.minutes)} more {wreckLeft(base, now.minutes) === 1 ? "minute" : "minutes"} of reading.
                  </span>
                </p>
              )}
              {hurt.length > 0 && (
                <p className="pip-camp-say-line">
                  <ShieldAlert size={14} className="shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1" title="A prowler nobody stopped knocks about what he came for. Where enough of the camp reaches the way in, none get through.">
                    A prowler got to {hurt.length === 1 ? `the ${siteName(base, hurt[0]).toLowerCase()}` : `${hurt.length} buildings`}.
                  </span>
                  <button
                    type="button"
                    className="tactile-button flex items-center gap-1.5 px-2.5 py-0.5 text-xs disabled:opacity-50"
                    disabled={base.acorns < fixAll}
                    onClick={() => {
                      hurt.forEach((site) => store.fixSite(site));
                      playSound("hammer");
                    }}
                  >
                    Fix {acorns(fixAll)}
                  </button>
                </p>
              )}
              {shownTrophy
                ? (() => {
                    const book = books.find((entry) => entry.id === shownTrophy);
                    if (!book) return null;
                    const on = finishedOn(book);
                    return (
                      <p className="pip-camp-say-line">
                        <Sprite name="trophy" variant={trophyKind(book.genres)} box={20} />
                        <span className="min-w-0 flex-1 truncate" title={`${book.title}${book.author ? `, by ${book.author}` : ""}`}>
                          <strong>{book.title}</strong>
                          {book.author ? ` · ${book.author}` : ""}
                          {on ? ` · ${new Date(on).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                        </span>
                        <button type="button" className="tactile-button px-2 py-0.5 text-xs" aria-label="Close" onClick={() => setShownTrophy(null)}>
                          <X size={12} aria-hidden />
                        </button>
                      </p>
                    );
                  })()
                : (() => {
                    const tip = tipNow(base);
                    if (!tip) return null;
                    return (
                      <p className="pip-camp-say-line pip-camp-tip">
                        <Lightbulb size={14} className="shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1">{tip.text}</span>
                        <span className="pip-camp-tip-keys">
                          <button
                            type="button"
                            className="tactile-button tactile-button-primary px-2.5 py-0.5 text-xs font-semibold"
                            onClick={() => {
                              store.learn(tip.id);
                              playSound("click");
                            }}
                          >
                            Got it
                          </button>
                          <button type="button" className="pip-camp-tip-off" title="Pip stops giving tips. The (i) at the top still says how the camp works." onClick={() => store.noTips()}>
                            No tips
                          </button>
                        </span>
                      </p>
                    );
                  })()}
              {raisable ? (
                <p className="pip-camp-say-line">
                  <Sprite name="trophy" variant={trophyKind(raisable.genres)} box={20} />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={`Every book you finish, with ${TROPHY_MINUTES} minutes of reading behind it, stands in the camp as a trophy, and may bring a hero.`}
                  >
                    You finished <strong>{raisable.title}</strong>!
                  </span>
                  <button
                    type="button"
                    className="tactile-button tactile-button-primary is-ready flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold"
                    title={room < TROPHY_GIVES ? `The larder has room for ${Math.max(0, room)} of its ${TROPHY_GIVES} acorns` : undefined}
                    onClick={() => {
                      store.raise(raisable.id, raisable.title, raisable.genres);
                      playSound("fanfare", { volume: 0.7 });
                    }}
                  >
                    Raise its trophy {room > 0 && acorns(`+${Math.min(TROPHY_GIVES, room)}`)}
                  </button>
                </p>
              ) : (
                <p className="pip-camp-say-line">
                  <ListChecks size={14} className="shrink-0" aria-hidden />
                  <button type="button" className="pip-camp-say-go min-w-0 flex-1" title="The next thing to do. Tap to be shown where." onClick={() => goTo(next.at)}>
                    {next.text}
                  </button>
                  {next.reward !== null && (
                    <span
                      className={`pip-base-chip ${next.full ? "is-bad" : ""}`}
                      title={next.full ? `${next.reward} acorns wait for room in the larder: spend some, or build the larder up` : `${next.reward} acorns when it is done`}
                    >
                      {acorns(`+${next.reward}`)}
                    </span>
                  )}
                </p>
              )}
              {told !== null ? (
                <p className="pip-camp-say-line">
                  <Package size={14} className="shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1" title="A tale Pip found while you read. Each is found once: they are all in the (i).">
                    {TALES[told]}
                  </span>
                  <button type="button" className="tactile-button px-2.5 py-0.5 text-xs" onClick={() => setTold(null)}>
                    Lovely
                  </button>
                </p>
              ) : (
                base.parcels > 0 && (
                  <p className="pip-camp-say-line">
                    <Package size={14} className="shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title="From your reading: a chapter read sends a parcel, eight minutes of reading for each, and a day's goal met sends one. Six wait by the burrow's door at most.">
                      {base.parcels === 1 ? "A parcel came from your reading" : `${base.parcels} parcels came from your reading`}
                    </span>
                    <button
                      type="button"
                      className="tactile-button tactile-button-primary flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold disabled:opacity-60"
                      disabled={opensNow === 0}
                      title={opensNow === 0 ? "The larder is full: a parcel waits until it has room for the whole of it" : opensNow < base.parcels ? `The larder has room for ${opensNow} of them` : undefined}
                      onClick={() => openParcels()}
                    >
                      {opensNow === 0 ? "Larder full" : <>{opensNow > 1 ? "Open all" : "Open"} {acorns(`+${opensNow * parcelGives(base)}`)}</>}
                    </button>
                  </p>
                )
              )}
            </div>
          </div>
        )}
        </div>
        <span className="pip-base-head-right">
          <button
            type="button"
            className="pip-base-round"
            aria-pressed={sound}
            aria-label="Pip's sounds"
            title={sound ? "Sounds are on" : "Sounds are off"}
            onClick={() => {
              setSound(!sound);
              // Heard at once, so turning them on says what it turned on.
              window.setTimeout(() => playSound("chime"), 0);
            }}
          >
            {sound ? <Volume2 size={16} aria-hidden /> : <VolumeX size={16} aria-hidden />}
          </button>
          <button
            type="button"
            className="pip-base-round"
            aria-expanded={tab === "journal"}
            aria-label="How the Hollow works, and what has happened"
            title="How the Hollow works, and what has happened"
            onClick={() => {
              setTab(tab === "journal" ? "camp" : "journal");
              playSound("click");
            }}
          >
            <Info size={16} aria-hidden />
          </button>
          {base.levels.burrow >= POSTCARD_FROM && (
            <button type="button" className="pip-base-round" aria-label="A postcard of your camp" title="A postcard of your camp, to save or copy" onClick={() => setPostcard(true)}>
              <Camera size={16} aria-hidden />
            </button>
          )}
          {corner}
        </span>
      </div>

      {postcard && look && (
        <Suspense fallback={null}>
          <HollowPostcard
            art={art}
            look={{ ...look, area: "camp" }}
            stats={{
              name: useCommunityStore.getState().me?.displayName || useCommunityStore.getState().me?.handle || null,
              level: base.levels.burrow,
              books: finished.length,
              minutes: now.minutes,
              streak: now.streak ?? 0,
              lately: [...finished]
                .sort((a, b) => (finishedOn(b) ?? "").localeCompare(finishedOn(a) ?? ""))
                .slice(0, 3)
                .map((book) => book.title)
            }}
            onClose={() => setPostcard(false)}
          />
        </Suspense>
      )}

          <div ref={wrapRef} className="pip-arcade-screen pip-base-scene">
            <canvas
              ref={canvasRef}
              width={GAME_W * fit.backing}
              height={Math.round((GAME_H + lay.sky + lay.ground) * fit.backing)}
              className={`${fit.crisp ? "pip-sprite " : ""}pip-arcade-canvas${placing || arrange ? " is-placing" : ""}`}
              style={{ width: GAME_W * fit.css, height: (GAME_H + lay.sky + lay.ground) * fit.css }}
              aria-hidden="true"
              onPointerDown={pressDown}
              onPointerUp={pressUp}
              onPointerCancel={() => {
                press.current = null;
              }}
              onDoubleClick={enter}
              onPointerMove={pressMove}
              onPointerLeave={() => {
                hovered.current = null;
                resting.current = null;
                if (arrange === "fence") pointer.current = null;
              }}
            />
          </div>

          {tab === "camp" && !arrange && !placing && meadowOpen(base) && (
            <button
              type="button"
              className={`pip-base-edge ${area === "camp" ? "is-right" : "is-left"}`}
              aria-label={area === "camp" ? "To the meadow" : "Back to the camp"}
              title={area === "camp" ? "The meadow, where the animals live. A sweep across the grass goes there too." : "Back to the camp"}
              onClick={() => goArea(area === "camp" ? "meadow" : "camp")}
            >
              {area === "camp" ? <ArrowRight size={18} aria-hidden /> : <ArrowLeft size={18} aria-hidden />}
            </button>
          )}
          <div className="pip-base-under">
          {arrange ? (
            <div className="pip-base-dock">
              <span className="flex" role="group" aria-label="What a tap on the picture does">
                <button
                  type="button"
                  className={`tactile-button rounded-r-none px-3 py-1 text-xs ${arrange === "move" ? "tactile-button-primary" : ""}`}
                  aria-pressed={arrange === "move"}
                  title="Drag a building to where it should stand. (Or tap it, then tap where.)"
                  onClick={() => beginArrange("move")}
                >
                  Move
                </button>
                <button
                  type="button"
                  className={`tactile-button rounded-l-none px-3 py-1 text-xs disabled:opacity-60 ${arrange === "fence" ? "tactile-button-primary" : ""}`}
                  aria-pressed={arrange === "fence"}
                  disabled={base.levels.fence === 0}
                  title={base.levels.fence === 0 ? "Build a fence first" : "Drag across the grass to lay fence. Drag a piece to move it; tap a piece to take it up."}
                  onClick={() => beginArrange("fence")}
                >
                  <span className="flex items-center gap-1.5">
                    <Sprite name="fencepiece" variant={Math.max(1, base.levels.fence)} box={16} className={base.levels.fence === 0 ? "is-locked" : ""} />
                    {base.levels.fence > 0 ? piecesLeft : ""}
                  </span>
                </button>
              </span>
              {arrange === "fence" && (
                <button
                  type="button"
                  className={`tactile-button flex items-center gap-1.5 px-3 py-1 text-xs disabled:opacity-60 ${gating ? "tactile-button-primary" : ""}`}
                  aria-pressed={gating}
                  disabled={base.levels.fence < GATE_FROM || base.walls.length === 0}
                  title={
                    base.levels.fence < GATE_FROM
                      ? `A gate comes with the fence's level ${GATE_FROM}`
                      : "Then tap a piece of the fence: it is the gate. Whoever comes on foot and finds the fence in the way goes round to the gate if it is not far, and is twice as long getting through it as over a piece. Your own people walk through it."
                  }
                  onClick={() => setGating((on) => !on)}
                >
                  <DoorOpen size={13} aria-hidden /> {gateOf(base) ? "Move gate" : "Gate"}
                </button>
              )}
              <span className="pip-base-chip" role="status">
                {carrying ? `Where should the ${siteName(base, carrying).toLowerCase()} stand?` : arrange === "fence" ? "Drag across the grass to lay fence" : "Drag a building to move it"}
              </span>
              <button type="button" className="tactile-button tactile-button-primary ml-auto px-3 py-1 text-xs font-semibold" onClick={leaveArrange}>
                Done
              </button>
            </div>
          ) : area === "meadow" ? (
            <div className="pip-base-dock" role="group" aria-label="The meadow">
              <button type="button" className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => goArea("camp")}>
                <Tent size={13} aria-hidden /> Camp
              </button>
              <span className="pip-base-dock-gap" aria-hidden="true" />
              <button
                type="button"
                className={`pip-base-tile ${panel === "site" && chosenDecor < 0 ? "is-chosen" : ""}`}
                aria-pressed={panel === "site" && chosenDecor < 0}
                aria-label={`The animals: ${base.animals.length} of ${ANIMALS.length} here`}
                title="The animals"
                onClick={() => {
                  setPanel("site");
                  setChosenDecor(-1);
                  playSound("click");
                }}
              >
                <Sprite name="animal" variant={base.animals[base.animals.length - 1] ?? 0} box={28} className={base.animals.length === 0 ? "is-locked" : ""} />
                <span className="pip-base-tile-level">{base.animals.length}</span>
              </button>
              <button
                type="button"
                className={`pip-base-tile ${panel === "decor" && chosenDecor < 0 ? "is-chosen" : ""}`}
                aria-pressed={panel === "decor" && chosenDecor < 0}
                aria-label="Set something down"
                title="Set something down"
                onClick={() => {
                  setPanel("decor");
                  setChosenDecor(-1);
                  playSound("click");
                }}
              >
                <Sprite name="decor" variant={10} box={28} />
              </button>
            </div>
          ) : (
            <div className="pip-base-dock" role="group" aria-label="The camp">
              {SHELVES.filter(({ id }) => id !== "decor" || decorOpen(base)).map(({ id, name, says, icon: Icon }) => {
                const chosen = shelf === id && chosenDecor < 0 && panelOpen && tab === "camp";
                const sites = SHELF_SITES[id];
                const pointed = nudge !== null && nudge !== "raids" && nudge !== "meadow" && sites.includes(nudge);
                return (
                  <button key={id} type="button" className={`pip-base-tile is-key ${chosen ? "is-chosen" : ""}`} aria-pressed={chosen} title={says} onClick={() => openShelf(id)}>
                    <Icon size={17} aria-hidden />
                    {name}
                    {id === "camp" && ready > 0 && room > 0 && !chosen && <Nut size={11} className="pip-base-tile-mark is-waiting" aria-hidden />}
                    {id === "camp" && garden && garden.ripe > 0 && !chosen && <span className="pip-base-tile-dot" aria-hidden="true" />}
                    {!chosen && pointed && <span className="pip-base-nudge" aria-label="Next" />}
                  </button>
                );
              })}
              {base.levels.hut > 0 && (
                <>
                  <span className="pip-base-dock-gap" aria-hidden="true" />
                  <button
                    type="button"
                    className={`pip-base-tile is-key ${tab === "raids" ? "is-chosen" : ""}`}
                    aria-pressed={tab === "raids"}
                    title="Send the scouts against the magpies' strongholds"
                    onClick={() => {
                      setTab(tab === "raids" ? "camp" : "raids");
                      playSound("click");
                    }}
                  >
                    <Swords size={17} aria-hidden />
                    Raids
                    {rested > 0 && <span className="pip-base-count">{rested}</span>}
                    {tab !== "raids" && mark("raids")}
                  </button>
                </>
              )}
              {base.levels.burrow >= FENCE_FROM && (
                <button
                  type="button"
                  className="tactile-button ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs"
                  title="Lay the camp out: lay fence, and see how far everything reaches. Anything can be dragged at any time."
                  onClick={() => beginArrange(base.levels.fence > 0 && piecesLeft > 0 ? "fence" : "move")}
                >
                  <Move size={13} aria-hidden /> Arrange
                </button>
              )}
            </div>
          )}
          {placing && !carriedOff && (
            <p className="pip-base-chip mt-2" role="status">
              Where should the {(placing.what === "land" ? SCENERY[placing.kind].name : placing.what === "work" ? WORKS[placing.kind].name : DECOR[placing.kind].name).toLowerCase()} go?
              <button type="button" className="tactile-button ml-2 px-2.5 py-0.5 text-xs" onClick={() => setPlacing(null)}>
                Never mind
              </button>
            </p>
          )}
          </div>

          {tab === "camp" && panelOpen && (!placing || carriedOff) && !arrange && (
          <div
            className={`pip-base-side${carriedOff ? " is-carried" : ""}`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setPanelOpen(false);
              }
            }}
          >
            <button type="button" className="pip-base-round pip-base-side-close" aria-label="Close" title="Close" onClick={() => setPanelOpen(false)}>
              <X size={16} aria-hidden />
            </button>
            <div className="pip-base-side-scroll">
          {!arrange && shelf && (
            <div key={`shelf-${shelf}`} className="pip-base-enter">
              {shelf === "camp" ? campShelf() : shelf === "defence" ? defenceShelf() : shelf === "heroes" ? heroesShelf() : decorCard(true)}
            </div>
          )}
          <div key={arrange ? "arrange" : chosenLand >= 0 ? `land-${chosenLand}` : chosenDecor >= 0 ? `thing-${chosenDecor}` : panel === "site" ? selected : panel === "guard" ? `guard-${chosenGuard}` : panel} className="pip-base-enter">
          {arrange ? null : chosenLand >= 0 && lands[chosenLand] && !placing ? (
            landCard()
          ) : chosenDecor >= 0 && things[chosenDecor] ? (
            <section className="pip-base-card mt-3">
              <div className="flex items-center gap-3">
                <span className="pip-base-portrait is-site">
                  <Sprite name="decor" variant={things[chosenDecor].kind} box={40} />
                </span>
                <h3 className="pip-base-title flex-1">{DECOR[things[chosenDecor].kind].name}</h3>
                <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={() => setPlacing({ kind: things[chosenDecor].kind, moving: true })}>
                  Move it
                </button>
                <button
                  type="button"
                  className="tactile-button px-3 py-1.5 text-xs"
                  title="Nothing comes back for it"
                  onClick={() => {
                    store.removeDecor(chosenDecor, area);
                    setChosenDecor(-1);
                    playSound("pick");
                  }}
                >
                  Take it away
                </button>
              </div>
            </section>
          ) : panel === "decor" ? (
            // In the camp the shelf above is the whole of it; the meadow has no shelves, so there it is a card.
            area === "meadow" ? decorCard() : null
          ) : panel === "garden" && area === "camp" ? (
            gardenCard()
          ) : panel === "guard" && area === "camp" ? (
            guardCard()
          ) : area === "meadow" ? (
            animalsCard()
          ) : panel === "people" ? (
            peopleCard()
          ) : (
            siteCard()
          )}
          </div>
            </div>
          </div>
          )}

      {tab === "raids" && (
        <div className="pip-base-enter pip-base-sheet">
          <button type="button" className="pip-base-round pip-base-sheet-close" aria-label="Back to the camp" title="Back to the camp" onClick={() => setTab("camp")}>
            <X size={16} aria-hidden />
          </button>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-on-surface" title={`${RAID_EVERY} minutes of reading rests the scouts for a raid, ${RAIDS_IN_HAND} at most in hand`}>
            {base.levels.hut < 1
              ? "Build a scouts' hut to raid."
              : rested > 0
                ? `Scouts rested for ${rested} ${rested === 1 ? "raid" : "raids"}.`
                : `Scouts rested after ${restIn(base, now.minutes)} more min of reading.`}
          </p>
          {base.levels.hut > 0 && HEROES.some((hero) => heroHere(base, hero.id)) && (
          <div
            className="mt-3 flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="The hero who goes with the scouts"
            title="Heroes come to the camp with the books you finish. One goes on each raid, and does one thing no scout does."
          >

            <button
              type="button"
              className={`pip-base-tile ${base.hero === null ? "is-chosen" : ""}`}
              aria-pressed={base.hero === null}
              aria-label="Nobody"
              title="Nobody goes with them"
              onClick={() => {
                store.chooseHero(null);
                playSound("click");
              }}
            >
              <UserX size={20} aria-hidden />
            </button>
            {HEROES.filter((hero) => heroHere(base, hero.id)).map((hero) => {
              const here = true;
              return (
                <button
                  key={hero.id}
                  type="button"
                  className={`pip-base-tile ${base.hero === hero.id && here ? "is-chosen" : ""}`}
                  aria-pressed={base.hero === hero.id && here}
                  aria-label={`${hero.name}${here ? (asleepUntil(base, 100 + hero.id, minute) > 0 ? ", asleep" : "") : ", not here yet"}`}
                  disabled={!here}
                  title={
                    !here
                      ? `${hero.name}, ${hero.title}. ${heroWants(hero, TROPHY_KINDS)}.`
                      : asleepUntil(base, 100 + hero.id, minute) > 0
                        ? `${hero.name} is worn out and asleep: the scouts go without them until they wake.`
                        : `${hero.name}, ${hero.title}. ${hero.does}. One who is put down on a raid comes home worn out, and sleeps for three hours.`
                  }
                  onClick={() => {
                    store.chooseHero(hero.id);
                    playSound("squeak", { pitch: 0.7 + (hero.id % 5) * 0.12 });
                  }}
                >
                  <Sprite name="hero" variant={hero.id} box={32} className={here && asleepUntil(base, 100 + hero.id, minute) === 0 ? "" : "is-locked"} />
                  {here && asleepUntil(base, 100 + hero.id, minute) > 0 && <Moon size={10} className="pip-base-tile-mark" aria-hidden />}
                </button>
              );
            })}
          </div>
          )}
          {sent && (
            <p className="pip-base-card mt-3 flex flex-wrap items-center gap-2 text-sm text-on-surface" role="status">
              {sent.name}: {sent.won ? "taken" : "beaten back"} {stars(sent.stars)} {sent.loot > 0 ? acorns(`+${sent.loot}`) : ""}
              {sent.fled && <span className="text-xs text-on-surface-variant">The next one emptied at the news.</span>}
            </p>
          )}
          {base.levels.hut > 0 && (
            <>
          <p className="mt-4 text-xs uppercase tracking-[0.18em] text-on-surface-variant" title="One after another, each a little harder and richer than the last. Three stars on one empties the next one too.">
            Strongholds
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {raidCard("camp", nextCamp(base), scouting?.camp ?? null)}
            {kingClosed(base, now.day) !== "camps" && raidCard("king", theKing(base), scouting?.king ?? null)}
          </div>
            </>
          )}
          {signedIn && FEATURES.community && base.levels.hut > 0 && (
            <>
              <h3
                className="pip-base-heading mt-4 flex flex-wrap items-center gap-2"
                title={`Readers you follow, who follow you. The fight is against their camp as they have laid it out. Nothing is taken from them: a star is worth ${FRIEND_PRIZE} acorns to you, their camp wants a little reading to mend, and they are told who it was.`}
              >
                Friends' camps
                <span
                  className="pip-base-chip font-normal"
                  title="What goes on a raid on a friend: the hut's scouts, and the hero you have chosen with whatever blade they carry. They are met by everything in the friend's camp that throws, their fence, their constructs, and their guardians at the signposts the friend has set. A hero who is put down comes home worn out and sleeps for three hours."
                >
                  <Swords size={12} aria-hidden /> {scoutsOf(base)}
                  {base.hero !== null && heroHere(base, base.hero) && asleepUntil(base, 100 + base.hero, minute) === 0 ? ` + ${HEROES.find((hero) => hero.id === base.hero)?.short ?? "a hero"}` : ""}
                </span>
                <label className="ml-auto flex items-center gap-1.5 text-xs font-normal" title="Whether friends may raid your camp. Off, they cannot, and you are not on their list.">
                  <input
                    type="checkbox"
                    checked={mayRaid}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setMayRaid(on);
                      socialService.setRaidable(on).catch(() => setMayRaid(!on));
                    }}
                  />
                  Mine can be raided
                </label>
              </h3>
              {targets === null ? (
                <p className="mt-2 text-xs text-on-surface-variant">…</p>
              ) : targets.length === 0 ? (
                <p className="mt-2 text-xs text-on-surface-variant">Nobody to raid yet.</p>
              ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {targets.map((target) => {
                    const why = target.raidedToday ? "today" : friendBlocked(base, now, target.handle);
                    return (
                      <div key={target.handle} className="pip-base-card flex min-w-0 items-center gap-3">
                        <Sprite name="burrow" variant={Math.max(1, Math.min(5, target.camp.levels.burrow))} box={40} />
                        <div className="min-w-0 flex-1">
                          <p className="pip-base-person truncate">{target.name}</p>
                          <p className="flex flex-wrap items-center gap-x-2 text-xs text-on-surface-variant" title="What you will meet: the level of their camp, how many guardians they have posted, and how many constructs they have set down">
                            Level {target.camp.levels.burrow}
                            <span className="pip-base-acorns">
                              <Shield size={11} aria-hidden /> {(target.camp.guards ?? []).filter((rank) => rank > 0).length}
                              <span className="sr-only"> guardians</span>
                            </span>
                            <span className="pip-base-acorns">
                              <Hammer size={11} aria-hidden /> {(target.camp.works ?? []).length}
                              <span className="sr-only"> constructs</span>
                            </span>
                          </p>
                        </div>
                        <button
                          type="button"
                          className="tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                          disabled={why !== null}
                          title={why === "today" ? "Raided today. More tomorrow." : why === "rest" ? "The scouts are not rested" : undefined}
                          onClick={() => {
                            const begun = store.startFriendRaid(target.camp, { handle: target.handle, name: target.name });
                            if (begun) {
                              setSent(null);
                              setRaid(begun);
                              playSound("horn");
                            }
                          }}
                        >
                          Raid
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "journal" && (
        <div className="pip-base-enter pip-base-sheet">
          <button type="button" className="pip-base-round pip-base-sheet-close" aria-label="Back to the camp" title="Back to the camp" onClick={() => setTab("camp")}>
            <X size={16} aria-hidden />
          </button>
          <ul className="pip-base-how mt-3">
            <li>
              <BookOpen size={14} aria-hidden />
              Reading runs the camp. Ten minutes read drops acorns from the oak, a chapter sends a parcel up the path, and a building is finished by reading, not by waiting.
            </li>
            <li>
              <Hammer size={14} aria-hidden />
              Acorns build things. The burrow is the camp's level: nothing else is built past it, and each level clears more of the wood and brings something new.
            </li>
            <li>
              <ShieldAlert size={14} aria-hidden />
              From level 2, prowlers come out of the wood while you watch. What throws, the fence, constructs and guardians see them off. One who gets through knocks a building about or takes a few acorns: a little, and two knocks and one theft a day at most.
            </li>
            <li>
              <Swords size={14} aria-hidden />
              The scouts raid the magpies' strongholds, led by a hero. Heroes come for the books you finish, with an hour and a half of reading behind each.
            </li>
            <li>
              <Star size={14} aria-hidden />
              Your camp is on your profile for friends to see, and the camera makes a postcard of it.
            </li>
          </ul>
          <p className="pip-base-stats mt-3">
            <span title="Strongholds taken">
              <Swords size={15} aria-hidden /> <strong>{base.camps}</strong> strongholds
            </span>
            <span title="Stars won on raids, in all">
              <Star size={15} aria-hidden /> <strong>{base.stats.stars}</strong>
            </span>
            <span title="Banners won from the Magpie King, one a month">
              <strong>{base.banners.length}</strong> {base.banners.length === 1 ? "banner" : "banners"}
            </span>
            <span title="Trophies: one for every book finished">
              <strong>{base.raised.length}</strong> {base.raised.length === 1 ? "trophy" : "trophies"}
            </span>
          </p>
          {clubs &&
            clubs.map((club) => {
              const week = weekKeyOf();
              const boss = clubBoss(
                club.members.map((member) => member.weekMinutes),
                club.goalMinutes
              );
              const claimed = clubClaimed(base, club.id, week);
              return (
                <section key={club.id} className="pip-base-card mt-3">
                  <h3 className="pip-base-heading" title="The club's reading this week, together, against an hour each. Beaten, every member's camp has a share.">
                    {club.name}: the Rookery
                  </h3>
                  <div className="pip-base-job">
                    <progress max={boss.need} value={boss.done} aria-label="The club's reading against its boss" />
                    <span className="text-xs tabular-nums text-on-surface-variant">
                      {boss.done} of {boss.need} minutes
                    </span>
                    <button
                      type="button"
                      className="tactile-button ml-auto px-3 py-1 text-xs disabled:opacity-50"
                      disabled={!boss.beaten || claimed}
                      title={club.members.length < 2 ? "A club of two or more" : undefined}
                      onClick={() => {
                        store.claimClub(club.id, week, boss.reward);
                        playSound("fanfare", { volume: 0.7 });
                      }}
                    >
                      {claimed ? "Shared" : `+${boss.reward}`}
                    </button>
                  </div>
                </section>
              );
            })}
          {base.tales.length > 0 && (
            <section className="pip-base-card mt-3">
              <h3 className="pip-base-heading" title="What Pip has found while you read: one comes in a parcel now and then. Each is found once.">
                <Package size={14} aria-hidden /> Tales Pip has found
                <span className="ml-auto text-xs font-normal tabular-nums text-on-surface-variant">
                  {base.tales.length} of {TALES.length}
                </span>
              </h3>
              <ul className="pip-base-tales">
                {[...base.tales].reverse().map((tale) => (
                  <li key={tale}>{TALES[tale]}</li>
                ))}
              </ul>
            </section>
          )}
          {base.events.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-on-surface" aria-label="Lately">
              {base.events.map((event, index) => (
                <li key={`${event.day}-${index}`}>
                  <span className="mr-2 text-xs tabular-nums text-on-surface-variant">{event.day.slice(5)}</span>
                  {event.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-on-surface-variant">Nothing yet.</p>
          )}
        </div>
      )}
    </div>
  );
};
