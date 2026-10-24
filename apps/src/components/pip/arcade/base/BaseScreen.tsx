import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  Flame,
  LocateFixed,
  TreeDeciduous,
  Warehouse,
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
  Shield,
  ShieldAlert,
  BedDouble,
  Camera,
  DoorOpen,
  Package,
  Sparkles,
  Star,
  Swords,
  Tent,
  UserX,
  Users,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import {
  BUILDINGS,
  BUILDING_NAMES,
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
  trophyBudget,
  trophyWaits,
  GATE_FROM,
  gateOf,
  parcelsBring,
  parcelsOpenable,
  basketWaits,
  prowlersCome,
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
  rewardOf,
  RAIDS_IN_HAND,
  RAID_EVERY,
  SITES,
  TROPHY_GIVES,
  YARD_KINDS,
  YARD_NAMES,
  blocked,
  burrowFor,
  campStructures,
  charm,
  clubBoss,
  clubClaimed,
  priceOf,
  decorBlocked,
  does,
  fencePieces,
  heroHere,
  holds,
  jobLeft,
  jobOn,
  levelOf,
  minutesOf,
  monthName,
  monthOf,
  oakHolds,
  oakReady,
  oakStatus,
  raidsReady,
  restIn,
  scoutsOf,
  seasonOf,
  siteName,
  spotBlocked,
  streakAdds,
  topOf,
  wallAt,
  wallBlocked,
  moodQuicker,
  oakDrops,
  residents,
  yardDoes,
  type BaseState,
  type BuildingId,
  type Blocked,
  type GuardBlocked,
  type Place,
  type Now,
  type Placed,
  type QuestAt,
  type RaidBlocked,
  type RaidEnd,
  type RaidPlan,
  type Site,
  type YardKind,
  chapterFor,
  workOpen,
  worksOffered,
  frontChapter,
  frontOpen,
  frontPlaces,
  nightDue,
  wallRange
} from "../../../../pip/base/rules";
import { BELL, COUNTER, ROLES, ROLE_NAMES, TOWERS, TRAPS, WORK_CHAPTER, countRoles, isTrap, padsOpen, spotsOpen, wallXAt, type Role } from "../../../../pip/base/front";
import type { FrontSlot } from "../../../../pip/base/rules";
import { FoeFace, NightCard, NightChip } from "./NightCard";
import { nightHeld } from "./wave";
import { ANIMALS, BLADES, GUARDIANS, GUARD_MOST, SCENERY, WORKS, bladeSays, type Guardian } from "../../../../pip/base/guards";
import { HEROES, heroWants } from "../../../../pip/base/heroes";
import { BLOOM_NAMES, TROPHY_KINDS, bloomsOf, budStage, toRaise, trophyKind, trophyRow } from "../../../../pip/base/trophies";
import { FINERY_NAMES, FOND_DOES, HEARTS_MOST, HOME_NAMES, heartsOf, nextHeartIn } from "../../../../pip/base/fondness";
import { stoneSays } from "../../../../pip/base/stones";
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
import { isTouchInput } from "../../../../platform/device";
import { currentShellShape } from "../../../../platform/shape";
import { coverPicture, drawAt, fitPicture, screenRatio, type Fit } from "./fit";
import { DOUBLE_TAP_MS, DOUBLE_TAP_SLOP, HOLD_MS, PHONE_ZOOM, SLACK_CSS, awayFrom, boundsOf, cardSide, centredOn, easeTo, isDrag, rubber, showIn, stepGlide, velocityOf, type Box as CamBox, type Glide, type Point, type Sample } from "./camera";
import { plotChoices, plotComesAt, reachOf, sheetOf, type Need } from "./siteSheet";
import { acornCard, charmCard, parcelCard, type ChipCard, type CardLine } from "./currency";
import { MAP_COACH, coachDue, coachSteps } from "./mapCoach";
import { siteBox } from "../../onboarding/geometry";
import "./hollow.css";
import { PipFace, Sprite } from "./Sprite";
import { PageTrails, acornsSound, clearOfCovers, bumpCount, shakeFull, type AcornCue, type AcornTrailsHandle, type ClientPoint, type PageSend, type PageTrailsHandle } from "./collect";
import { ARRIVAL_MS, arrivalOf, barFillAt, firstLands, pageStarts, type Arrival } from "./arrival";
import { hoursText } from "./chapterWords";
import { currentTier } from "../../../../platform/perfTier";
import { useBurrowDoor } from "../../onboarding/useBurrowDoor";
import { busyFpsFor, runScene, sceneGate, untilNextArtFrame } from "../frameGate";
import { ReplayTour } from "../../onboarding/ReplayTour";
import { tapKey } from "../../onboarding/tapKey";
import { isGhostClick, type Press } from "./ghostClick";
import { HollowTop } from "./HollowTop";
import { BUILD_TABS, BuildTabs, HollowDock, type BuildTab, type EditMode } from "./HollowDock";
import type { HollowNav } from "./HollowMenu";
import { chapterGoalAt, newsOf, putBack, seeNews, seeOff, askedRaids, campOpened, chapterCardOf, chapterChipOf, chapterNewsOf, raidsAsked, seeChapter } from "./hollowRules";
import { LandsMap } from "./LandsMap";
import { RaidFlow, type RaidAim } from "./RaidFlow";
import { FriendNews } from "./FriendNews";
import { HollowGuide, type GuidePage } from "./HollowGuide";
import { ChapterCard, ChapterThings } from "./ChapterCard";
import { CHAPTER_OF, type GoalAt } from "../../../../pip/base/chapters";
import { STEP } from "../../onboarding/steps";
import { useCoachStore } from "../../onboarding/coachStore";
import { tutorialRunning } from "../../../../pip/base/ladder";
import { levelBrings } from "../../../../pip/base/ladder";
import { meadowTapAt } from "./scene";
import { ART_FPS, AWAKE_SECONDS, GENRE_FOE, PROWLER_NAMES, NIGHT_FROM, nightAt, nightKinds, nightPlanOf, nightStart, walksAt, basketAtPoint, parcelAtPoint, trophyAtPoint, BANNERS_SHOWN, RESIDENTS_SHOWN, TROPHIES_SHOWN, animalAt, decorAt, duskAt, gardenAt, gardenSpot, guardAtPoint, postAtPoint, landAt, oakAcornAt, paintCamp, paintGround, paintSky, siteAt, workAt, type CampExtras, type CampLook } from "./scene";

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * What lies past the clearing's edges, where a phone's camera is dragged past them for a moment (camera.ts's rubber
 * band): Pip's paper, and an ink line at the edge, so the edge is plain to see and the picture springs back to it.
 */
const OUTSIDE = "#ece2c6";
const EDGE_INK = "#24302a";

/** How long the burst over a finished building takes. */
const BURST_FRAMES = 8;

const WHY_NOT: Record<Blocked, (base: BaseState, site: Site) => string> = {
  top: () => "As good as it gets",
  mend: (base) => `Pip is mending the fence after ${base.wreck?.by ?? "a friend"}'s raid`,
  harm: () => "Fix what the prowler did first",
  busy: (base, site) => (jobOn(base, site) ? "Going up" : base.jobs.length > 1 ? "Both builders are busy" : `Pip is busy with the ${siteName(base, base.jobs[0].site).toLowerCase()}`),
  chapter: (base, site) => `Comes with chapter ${chapterFor(base, site)}`,
  taken: () => "Choose what to build",
  acorns: (base, site) => `${priceOf(base, site, levelOf(base, site) + 1) - base.acorns} more acorns`
};

const WHY_NO_GUARD: Record<GuardBlocked, (base: BaseState, guard: number) => string> = {
  top: () => "",
  post: (base, guard) =>
    !campOpened(base, base.minutes, "guards")
      ? `Comes with chapter ${CHAPTER_OF.guards}`
      : GUARDIANS[guard].post === "fence"
        ? "Put a piece of fence down first"
        : `Needs ${GUARDIANS[guard].post === "yard" ? "a yard building" : `the ${BUILDING_NAMES[GUARDIANS[guard].post as BuildingId].toLowerCase()}`} at level 2`,
  busy: (base) => `${GUARDIANS[base.drill?.guard ?? 0].short} is in training`,
  acorns: (base, guard) => `${guardCost(guardOf(base, guard) + 1) - base.acorns} more acorns`
};

const WHY_NO_RAID: Record<RaidBlocked, (base: BaseState, plan: RaidPlan, now: Now) => string> = {
  hut: () => "Needs a scouts' hut",
  rest: (base, _plan, now) => `The scouts rest as you read: ready in ${restIn(base, now.minutes)} min`,
  acorns: (base, plan) => `${plan.cost - base.acorns} more acorns`,
  camps: () => `After ${KING_NEEDS_CAMPS} strongholds`,
  won: (_base, _plan, now) => `${monthName(monthOf(now.day))}'s banner is won`,
  today: () => "Once a day",
  done: () => "Raided today",
  chapter: () => `Comes with chapter ${CHAPTER_OF.raids}`,
  none: () => "Too strong for now"
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
type Panel = "site" | "people" | "decor" | "guard" | "garden" | "blooms";

/**
 * The picture is the page. Where Pip's tab is at least this wide and tall,
 * the clearing fills it and everything else (what the camp has, Pip's word,
 * the row of keys, whatever is opened) is laid over the picture; in a
 * smaller window the picture is hung first and the rest follows under it.
 */
const STAGE_WIDE = 820;
const STAGE_TALL = 460;
/** A phone on its side (platform/shape.ts: a window 520 px tall or less), and a page at least this wide and tall, is a stage too. */
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
/** Art pixels of the clearing's own sky, at its top, that may be cut so the picture fills a phone held sideways edge to edge. */
const CROP_MOST = 20;
/** Screen pixels the row of keys takes at the foot of the picture: that much more ground is laid for it to stand on, where the page is tall enough. */
const DOCK_TALL = 88;
/** And on a phone held sideways, where the row is slimmer and the camera can lift the camp clear of it. */
const PHONE_DOCK = 50;

/** The garden, as the camp is told of it: how many beds, how many growing and how many ripe, and the way to it. */
export type CampGarden = { plots: number; growing: number; ripe: number; onOpen: () => void };

/**
 * Everything there is to build, post or buy is on the Build panel (1.5.10), in four tabs by what it is for: what
 * the camp runs on, what keeps prowlers out and goes raiding (the scouts' hut is here and under Raid, not with the
 * people), who lives here, and what is there only to be looked at. Which tab is open follows from what is chosen,
 * so a building tapped in the picture opens its own.
 */
type Shelf = BuildTab;
const SHELF_SITES: Record<Shelf, readonly Site[]> = { camp: ["burrow", "oak", "store", "yard0", "yard1"], defence: ["tower", "fence", "hut"], people: [], decor: [] };
const shelfOfSite = (site: Site): Shelf => (SHELF_SITES.defence.includes(site) ? "defence" : "camp");

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
/** How long the oak is seen to be shaken after a tap, its leaves falling. */
const OAK_SHOOK_MS = 1000;
const ARRIVE_MS = 1500;
const BOUNCE_MS = 600;
/** How long after the pointer last moved on the picture it is still painted at every frame. */
const STIRRED_MS = 400;

/*
 * (There was a three-bubble introduction here, and a hedgehog with a daily
 * offer. Both went on 2026-10-15: the first said things a new camp does not
 * have yet, and Pip's tips (`pip/base/tips.ts`) say each when it comes.)
 */

/* (Acorns into the larder, heard: `acornsSound`, collect.tsx, with the acorns seen flying to the count.) */

/** How far the camera's home leans to the left of the middle once the Dark Wood has a trail (1.5.11), in art pixels. */
const TRAIL_LEAN = 16;
/** (1.5.11) What came of the reading since the last arrival, in a sentence (the chapter card has it as rows). */
const arrivalWords = (arrival: Arrival): string =>
  [
    `Since you were last here: ${hoursText(arrival.since.minutes)} read`,
    arrival.since.oakFull ? "the oak is full" : arrival.since.oak > 0 ? `the oak has ${arrival.since.oak} more acorns waiting` : null,
    arrival.since.raids > 0 ? `the scouts are rested for ${arrival.since.raids} more ${arrival.since.raids === 1 ? "raid" : "raids"}` : null,
    `${hoursText(arrival.since.toChapter)} to the next chapter`,
    arrival.since.toBloom > 0 ? `${hoursText(arrival.since.toBloom)} to your next bloom` : "your next bloom is ready"
  ]
    .filter(Boolean)
    .join("; ") + ".";
/** (1.5.11) Where the camera is centred, across the meadow, on a phone on its side. */
const MEADOW_HOME_X = 132;
/** A wave setting out takes the camera to the trail only if the screen has not been touched for so long. */
const EASE_UNTOUCHED_MS = 2000;

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
  lead,
  garden,
  nav
}: {
  skin: string;
  outfit: readonly string[];
  /** Into the burrow, where the camp is the place Pip's tab opens on: her rooms are through its door. */
  onInside?: () => void;
  /** To the arcade's games, for a thing on the list that is done there. */
  onArcade?: () => void;
  /** Keys for the top corner of the picture: the ways out of the clearing. */
  corner?: React.ReactNode;
  /** First in the row of what the camp has: the way to the rest of the app, where Pip's tab fills the screen. */
  lead?: React.ReactNode;
  /** The garden, where there is one: its bed by the burrow is a thing to look at (its seeds are the house's). */
  garden?: CampGarden;
  /** The way to the rest of the app, in the menu, where Pip's tab fills a phone on its side. */
  nav?: HollowNav;
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
  /**
   * What the panel shows (1.5.8): a list of what is on a shelf (a key in the row at the foot), or one thing's sheet (a
   * building tapped in the picture, or a row of the list). A sheet opened from the list has a way back to it.
   */
  const [listOpen, setListOpen] = useState(false);
  const [fromList, setFromList] = useState(false);
  /** Which side of the picture the panel is on: away from what was chosen, so it never covers it. */
  const [side, setSide] = useState<"left" | "right">("right");
  /** Why the sheet's key cannot be pressed, said under it when it is pressed anyway. */
  const [whyShown, setWhyShown] = useState<string | null>(null);
  /** A chip along the top whose card is open: what acorns are, what charm is. */
  const [chipOpen, setChipOpen] = useState<"acorns" | "charm" | "parcels" | null>(null);
  /** How far through the three pointers (mapCoach.ts) the reader is. (Since 1.5.10 they are one tip: kept for its marks.) */
  const [coachAt, setCoachAt] = useState(0);
  /** The Build panel's tab last opened, which the Build key opens on again. */
  const [buildTab, setBuildTab] = useState<BuildTab>("camp");
  /** Edit is on its Decorate (the Decor list, with the edit bar kept at the foot). */
  const [decorEdit, setDecorEdit] = useState(false);
  /** The chapter card, from a tap on the chapter bar. */
  const [chapterOpen, setChapterOpen] = useState(false);
  /** Which page of the guide behind the (i) is open (null: its contents). */
  const [guidePage, setGuidePage] = useState<string | null>(null);
  /** The chapter whose celebration has been closed in this visit (the camp keeps it too: `seeChapter`). */
  const [celebrated, setCelebrated] = useState(0);
  /** Friends' raids, said once on opening the Hollow: closed in this visit (the camp keeps it too: `seeNews`). */
  const [newsClosed, setNewsClosed] = useState(false);
  const setPanel = (to: Panel) => {
    setPanelTo(to);
    setPanelOpen(true);
    setListOpen(false);
    setFromList(false);
    setWhyShown(null);
  };
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** The picture as the page (and how much sky there is above the clearing), or hung at the top of it. */
  /**
   * How the page is laid out: the picture is the page (`stage`); it is hung at the top and the rest follows under it
   * (`stack`: a small window, an upright phone); or it fills the height and the rest goes down its right (`side`: a
   * phone turned sideways, where hung at the top it was 175 px of camp).
   */
  // `crop`: art pixels cut from the top of the clearing (its sky), where the picture fills the width of a phone on its side.
  // `pan`: the picture is larger than the page and the camera shows part of it (a phone held sideways, by a finger:
  // camera.ts); `view` is then the page's size, in CSS pixels, which the canvas fills.
  const [lay, setLay] = useState<{ mode: "stage" | "stack" | "side"; sky: number; ground: number; crop: number; pan?: boolean; view?: { w: number; h: number } }>({ mode: "stack", sky: 0, ground: 0, crop: 0 });
  /** Which clearing the picture shows: the camp, or the meadow beyond it. */
  const [area, setArea] = useState<Place>("camp");
  /** What the list just paid, for a moment, over the acorns. */
  const [gained, setGained] = useState<{ acorns: number; at: number } | null>(null);
  const petted = useRef<{ x: number; y: number; at: number; hearts?: number } | null>(null);
  /** (1.5.11) What a tap in the meadow says on Pip's line: a bloom (its book), the bud, a stone; null for nothing. */
  const [meadowSay, setMeadowSay] = useState<{ kind: "bloom"; index: number } | { kind: "bud" } | { kind: "stone"; text: string } | null>(null);
  /** The trophies raised as the meadow was last seen, this visit: one raised since opens the bud, in a burst. */
  const bloomsSeen = useRef<number | null>(null);
  const bloomBurstAt = useRef<number | null>(null);
  /** The Blooms list, thirty at a time. */
  const [bloomsShown, setBloomsShown] = useState(30);
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
  /** (1.5.11) The trap spot or tower pad chosen on the Defence shelf: what may go on it is listed under it, and it is ringed in the picture. */
  const [slotPick, setSlotPick] = useState<FrontSlot | null>(null);
  /** (1.5.11) Tonight's chip, while there is a night to show (from just before dusk to its end), and whether its card is open. */
  const [nightShown, setNightShown] = useState<{ n: number; key: string; counts: ReturnType<typeof countRoles>; left: number } | null>(null);
  const [nightOpen, setNightOpen] = useState(false);
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
  /** A raid under way, from its scouting to its end card (RaidFlow.tsx); `sent` when it opened on a Send's result. */
  const [raid, setRaid] = useState<{ aim: RaidAim; sent: RaidEnd | null } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fit, setFit] = useState<Fit>({ css: 2, backing: 2, crisp: true });
  // By what Pip wears, not by which list holds it: the art is drawn once and kept.
  const wornKey = outfit.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const art = useMemo(() => gameArt("base", skin, outfit), [skin, wornKey]);
  const loaded = base !== null;
  const store = useBaseStore.getState();
  /** The guided first visit's step while it is on screen (onboarding/HollowCoach.tsx): the chapter bar waits for its last. */
  const tourStep = useCoachStore((state) => state.step);

  // ---- the camera (camera.ts): on a phone held sideways, the part of the clearing the screen shows ----------------
  /** The screen, in art pixels, where the canvas is a window onto the clearing; null where it shows the whole of it. */
  const view = lay.pan && lay.view ? { w: lay.view.w / fit.css, h: lay.view.h / fit.css } : null;
  const camBounds = view ? boundsOf({ w: GAME_W, h: GAME_H + lay.sky + lay.ground }, view) : null;
  /** Where the camera sits at home: the camp in the middle (its grass is about 80 art pixels down). */
  // (1.5.11) Once there is a trail, home leans to the left, so the trail's mouth and the whole wall are in view.
  const trailLean = base && campOpened(base, now.minutes, "prowlers") ? TRAIL_LEAN : 0;
  // (1.5.11) The meadow's home is a little to the right, so the Reading Path's newest blooms and the stones are in view.
  const camHome: Point = view && camBounds ? centredOn({ x: area === "meadow" ? MEADOW_HOME_X : GAME_W / 2 - trailLean, y: lay.sky + 80 }, view, camBounds) : { x: 0, y: 0 };
  const cam = useRef<Point>({ x: 0, y: 0 });
  /** Let go with some speed: the glide it is on. Sent somewhere (to show a chosen thing): where to. */
  const glide = useRef<Glide | null>(null);
  const camTo = useRef<Point | null>(null);
  const camStepped = useRef(0);
  /** The camera's figures as this render has them, for the paint loop and the handlers between renders. */
  const camState = useRef({ bounds: camBounds, home: camHome, view });
  camState.current = { bounds: camBounds, home: camHome, view };
  /** The camera is away from home: the key that brings it back is shown. */
  const [away, setAway] = useState(false);
  /** The last tap on open ground: a second one soon after, close by, sends the camera home. */
  const lastTap = useRef<{ x: number; y: number; at: number } | null>(null);
  /** Paints the picture once, now: for a still picture (reduced motion) that the camera has moved. */
  const repaint = useRef<(() => void) | null>(null);
  // A new size of screen (or the other clearing): the camera starts at home.
  useLayoutEffect(() => {
    cam.current = { ...camState.current.home };
    glide.current = null;
    camTo.current = null;
    setAway(false);
  }, [lay.pan, lay.view?.w, lay.view?.h, fit.css, area]);
  /** The camera, one frame on: whether it moved (and so the picture wants painting). */
  const stepCamera = (time: number): boolean => {
    const { bounds, home } = camState.current;
    const dt = camStepped.current ? time - camStepped.current : 16;
    camStepped.current = time;
    if (!bounds) return false;
    if (press.current?.panning) return true;
    const settled = () => setAway(awayFrom(cam.current, home));
    if (glide.current) {
      const next = stepGlide(glide.current, bounds, dt, SLACK_CSS / fit.css);
      cam.current = { x: next.x, y: next.y };
      glide.current = next.done ? null : next;
      if (next.done) settled();
      return true;
    }
    if (camTo.current) {
      const to = camTo.current;
      cam.current = { x: easeTo(cam.current.x, to.x, dt), y: easeTo(cam.current.y, to.y, dt) };
      if (cam.current.x === to.x && cam.current.y === to.y) {
        camTo.current = null;
        settled();
      }
      return true;
    }
    return false;
  };
  /** Sends the camera somewhere: eased there, or put there at once where motion is kept still. */
  const sendCamera = (to: Point) => {
    glide.current = null;
    if (prefersReducedMotion()) {
      cam.current = to;
      camTo.current = null;
      setAway(awayFrom(to, camState.current.home));
      repaint.current?.();
      return;
    }
    camTo.current = to;
    stirred.current = performance.now();
    wakeScene.current();
  };
  const goHome = () => {
    sendCamera({ ...camState.current.home });
    playSound("swish", { volume: 0.5 });
  };
  /**
   * A thing has been chosen (`box`: where it stands, in the clearing's pixels): the panel goes on the other half of
   * the picture from it, and on a phone the camera moves as little as it takes for it to be seen beside the panel,
   * under the row along the top and above the keys at the foot.
   */
  const bring = (box: CamBox) => {
    const root = rootRef.current;
    if (!root || lay.mode !== "stage") return;
    const wide = root.clientWidth;
    const tall = root.clientHeight;
    const middle = (box.x + box.w / 2 - (lay.pan ? cam.current.x : 0)) * fit.css;
    const to = cardSide(middle, wide);
    setSide(to);
    const { bounds } = camState.current;
    if (!lay.pan || !bounds) return;
    // As the panel is laid out (hollow.css): 40 % of the width at most, 300 px at most, 8 px from the edge. And between
    // the row along the top and the keys at the foot, as they stand (they keep clear of the system's bars).
    const card = Math.min(wide * 0.4, 300) + 16;
    const frame = root.getBoundingClientRect();
    const head = root.querySelector(".pip-base-stats")?.getBoundingClientRect();
    const dock = root.querySelector(".pip-base-under")?.getBoundingClientRect();
    const free = {
      left: (to === "left" ? card : 0) / fit.css,
      right: (to === "left" ? wide : wide - card) / fit.css,
      top: ((head ? head.bottom - frame.top : 46) + 4) / fit.css,
      bottom: ((dock ? dock.top - frame.top : tall - 50) - 4) / fit.css
    };
    const target = showIn({ ...box, y: box.y + lay.sky }, cam.current, free, bounds);
    if (target.x !== cam.current.x || target.y !== cam.current.y) sendCamera(target);
  };
  /** Where a building stands, as a box; a small one about a point for anything else. */
  const boxOfSite = (site: Site): CamBox | null =>
    base && (PLACED as readonly Site[]).includes(site) && sitesStanding(base).includes(site as Placed) ? siteBox(site as Placed, base.spots[site as Placed]) : null;
  const boxAt = (x: number, y: number): CamBox => ({ x: x - 8, y: y - 18, w: 16, h: 20 });
  /** The acorns chip: the pointers point at it. */
  const acornChipRef = useRef<HTMLButtonElement | null>(null);
  /** The one tip Pip gives in a visit (1.5.8: they came one after another, each over the picture, until "No tips"). */
  const tipOfVisit = useRef<string | null>(null);
  // A chip's card goes at a tap anywhere else.
  useEffect(() => {
    if (!chipOpen) return undefined;
    const away = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && (target.closest(".pip-hud-card") || target.closest(".pip-hud-chip"))) return;
      setChipOpen(null);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [chipOpen]);

  useEffect(() => {
    void useBaseStore.getState().open();
  }, []);
  // Pip's welcome, once a camp, when the camp is first looked at (and not before the first pull: `welcomeReady`).
  const welcomeReady = useBaseStore((state) => state.welcomeReady);
  useEffect(() => {
    if (welcomeReady && loaded) useBaseStore.getState().giveWelcome();
  }, [welcomeReady, loaded]);
  // Reading done with the arcade open, or a day turning: the camp catches up.
  useEffect(() => {
    useBaseStore.getState().refresh();
  }, [now.minutes, now.day]);

  const finished = useMemo(() => books.filter(hasFinished), [books]);
  const waiting = useMemo(() => (base ? toRaise(finished, base) : []), [finished, base]);
  const standing = useMemo(() => (base ? trophyRow(finished, base, TROPHIES_SHOWN) : []), [finished, base]);
  /** (1.5.11) Every trophy raised as a bloom on the meadow's Reading Path, in the order raised. */
  const blooms = useMemo(() => (base ? bloomsOf(base.raised, finished) : []), [base?.raised, finished]);

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
  // (1.5.11) What makes this visit's nights: the same all visit, and not the same as the last visit's.
  const seedRef = useRef<number | null>(null);
  const visitSeed = (camp: NonNullable<typeof base>) => (seedRef.current ??= (Math.floor(camp.minutes) * 7919 + camp.front.held * 104729 + Math.floor(performance.now())) % 1_000_003);
  const look: CampLook | null = useMemo(
    () =>
      base && {
        levels: base.levels,
        // (1.5.10) The whole clearing comes with chapter 10 (or was had before chapters); until then the wood keeps its last edge.
        clearing: campOpened(base, now.minutes, "clearing") ? base.levels.burrow : Math.min(MAX_LEVEL - 1, base.levels.burrow),
        legacy: base.legacy?.burrow ?? 0,
        yard: base.yard,
        spots: base.spots,
        walls: base.walls,
        jobs: base.jobs.map((job) => job.site),
        season,
        night,
        // (1.5.10) The bed by the burrow is a thing to look at: its seeds are the house's, and grow there.
        garden: garden ? 1 : null,
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
        // What the oak shows is what a tap on it does (`oakStatus`): the bobbing acorn only when a tap takes some in.
        ...(() => {
          const oak = oakStatus(base, now.minutes);
          return { oakReady: oak === "ready", oakFull: false };
        })(),
        // Those with a bed in the hut: whoever goes raiding first, then the ones who know the camp best.
        residents: lodgers(base)
          .map((hero) => hero.id)
          .slice(0, RESIDENTS_SHOWN),
        rainbow: (now.streak ?? 0) >= 7,
        guards: base.guards,
        area,
        animals: base.animals,
        // (1.5.11) The meadow's record of the reading: the animals' hearts, the blooms, the bud, the stones.
        hearts: ANIMALS.map((animal) => heartsOf(base, animal.id, now.minutes)),
        blooms: blooms.map((entry) => entry.kind),
        bud: meadowOpen(base) ? budStage(trophyBudget(base, now.minutes)) : null,
        read: now.minutes,
        meadow: base.meadow,
        land: base.land,
        meadowLand: base.meadowLand,
        works: base.works,
        towerPath: base.forks.tower ?? null,
        gate: gateOf(base),
        parcels: base.parcels,
        basket: basketWaits(base),
        prowlers: prowlersCome(base),
        reading: readingKind,
        // (1.5.11) The wall across the trail, and who comes on this visit's nights (`front.ts`).
        line: base.front.x,
        ...(prowlersCome(base) ? { wave: { seed: visitSeed(base), chapter: frontChapter(base) } } : {})
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, season, night, now, standing, area, garden === undefined, minute, readingKind, blooms]
  );
  // The burrow is the way in: a tap on its door, Pip walking in ahead (onboarding/useBurrowDoor.ts).
  const door = useBurrowDoor({ look, onInside, canvasRef, sky: lay.sky });
  // A finger's tap is taken on the press; the click the phone sends after it, landing on a panel the tap opened under
  // the finger, is a ghost of it and is dropped (ghostClick.ts).
  const fingerPress = useRef<Press | null>(null);
  useEffect(() => {
    const ghost = (event: MouseEvent) => {
      if (!isGhostClick(fingerPress.current, { x: event.clientX, y: event.clientY, at: performance.now(), target: event.target })) return;
      fingerPress.current = null;
      event.stopPropagation();
      event.preventDefault();
    };
    document.addEventListener("click", ghost, true);
    return () => document.removeEventListener("click", ghost, true);
  }, []);

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
      const paid = Math.min(base.acorns - was.acorns, QUESTS.slice(was.quest, base.quest).reduce((sum, quest) => sum + rewardOf(base, quest), 0));
      if (paid > 0) {
        setGained({ acorns: paid, at: performance.now() });
        // From the list's chip (the goal ladder) to the count.
        acornsIn(centreOf(rootRef.current?.querySelector('[data-welcome="goal"]')), paid);
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
      const phone = currentShellShape() === "sideways" && wide >= PHONE_WIDE && tall >= PHONE_MIN_TALL && wide >= tall * 1.3;
      if ((wide >= STAGE_WIDE && tall >= STAGE_TALL) || phone) {
        // The picture is the page: as large as the page lets it be, and what height is left over the clearing is sky.
        // On a phone on its side it is as wide as the screen, edge to edge (no strips of paper beside it): if that
        // makes it taller than the screen, the top of the clearing's sky is cut, up to CROP_MOST.
        // (By a finger only: a short desktop window keeps the whole picture.)
        const cover = phone && isTouchInput();
        if (cover) {
          // By a finger, the picture is a little larger than the screen, and a drag looks about it (camera.ts): the
          // canvas is the screen's size, a window onto the clearing.
          const next = coverPicture(GAME_W, GAME_H, wide, tall, screenRatio(), PHONE_ZOOM);
          setFit((was) => (was.css === next.css && was.backing === next.backing ? was : next));
          // A strip of grass laid below the clearing, the height of the row of keys at the foot: the camera can lift the
          // front of the camp clear of them.
          const ground = Math.ceil((PHONE_DOCK / next.css) * next.backing) / next.backing;
          setLay((was) =>
            was.mode === "stage" && was.pan && was.view?.w === wide && was.view?.h === tall && was.ground === ground
              ? was
              : { mode: "stage", sky: 0, ground, crop: 0, pan: true, view: { w: wide, h: tall } }
          );
          return;
        }
        const next = fitPicture(GAME_W, cover ? GAME_H - CROP_MOST : GAME_H, wide, tall, screenRatio(), 0);
        // To the canvas pixel. The first of it is ground at the foot, for the row of keys to stand on; the rest is sky.
        const over = Math.floor((tall / next.css - GAME_H) * next.backing) / next.backing;
        const spare = Math.max(0, over);
        const crop = cover && over < 0 ? Math.min(CROP_MOST, Math.ceil(-over * next.backing) / next.backing) : 0;
        const ground = Math.min(spare, Math.ceil((DOCK_TALL / next.css) * next.backing) / next.backing);
        const sky = Math.min(SKY_MOST, spare - ground);
        setFit((was) => (was.css === next.css && was.backing === next.backing ? was : next));
        setLay((was) =>
          was.mode === "stage" && !was.pan && was.sky === sky && was.ground === ground && was.crop === crop ? was : { mode: "stage", sky, ground, crop }
        );
        return;
      }
      // Not on show (another page of a small window): there is nothing to measure.
      const root = rootRef.current;
      const side = root ? sidewaysRoom(root) : null;
      if (side) {
        setLay((was) => (was.mode === "side" ? was : { mode: "side", sky: 0, ground: 0, crop: 0 }));
        const next = fitPicture(GAME_W, GAME_H, side.wide, side.tall, screenRatio(), 0.08);
        setFit((was) => (was.css === next.css && was.backing === next.backing ? was : next));
        return;
      }
      setLay((was) => (was.mode === "stack" ? was : { mode: "stack", sky: 0, ground: 0, crop: 0 }));
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
  /**
   * (1.5.11) Seconds the camp's own clock is ahead of the time it has been open: reading brings the night, so a camp
   * opened after some reading since its last night opens late in its day, and dusk falls about half a minute in.
   */
  const shift = useRef(0);
  const clockAt = (time: number) => (time - opened.current) / 1000 + shift.current;
  /** Whether prowlers are about (looked at once a second): the picture is painted at every frame while they are, so they walk and do not step. */
  const prowling = useRef(false);
  const flights = useRef<number[]>([]);
  /** The oak last tapped: shivering as its acorns came down, or shaking its head at a full larder; and when. */
  const oakShook = useRef<{ kind: "gather" | "full"; at: number } | null>(null);
  /** Acorns flying to the count at the top (collect.tsx), and when those on their way land on it. */
  const trailsRef = useRef<AcornTrailsHandle | null>(null);
  /**
   * (1.5.11) Arriving after reading (`arrival.ts`): the pages on their way up the path, the oak's acorn kept back
   * until the first lands, the arrival while it plays (the bar's fill, the chapter card waiting), what the card says
   * came since, and the line a screen reader hears.
   */
  const pagesRef = useRef<PageTrailsHandle | null>(null);
  const pagesComing = useRef(false);
  const arrivalTimers = useRef<number[]>([]);
  const [arriving, setArriving] = useState<{ arrival: Arrival; start: number } | null>(null);
  const [since, setSince] = useState<Arrival["since"] | null>(null);
  const [arrivalSaid, setArrivalSaid] = useState("");
  const [pageShown, setPageShown] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const acornCue = useRef<AcornCue>(null);
  const bounced = useRef<{ site: Placed; at: number } | null>(null);
  /** When the pointer last did anything on the picture: it is painted at every frame for a moment after (frameGate.ts). */
  const stirred = useRef(-Infinity);
  /** When a finger (or the mouse) last went down anywhere in the Hollow: the camera is not taken from a reader using it. */
  const touchedAt = useRef(-Infinity);
  /** The nights the camera has gone over to the trail for, as each set out; and whether a panel is open (for the timer). */
  const nightsEased = useRef(new Set<number>());
  const panelShown = useRef(false);
  panelShown.current = panelOpen;
  /** Brings the camp's frame loop back from a rest between art frames at once (set by the loop below). */
  const wakeScene = useRef<() => void>(() => undefined);
  /** When each building was last knocked by a prowler, and which the pointer is resting on: their health is shown on a bar for a moment, and while pointed at. */
  const knockedAt = useRef<Partial<Record<Placed, number>>>({});
  const hovered = useRef<Placed | null>(null);
  /** Where the pointer is resting in the scene, when nothing is in hand. */
  const resting = useRef<{ x: number; y: number } | null>(null);
  /** A press on the picture that may turn into a drag (see `pressDown`). Kept up here with the other hooks: the camp is not always read when this runs. */
  // On a phone (the camera's): `pan` is set, and a press is a tap, a drag of the camera (`panning`, from where it was,
  // `cam0`, with the finger's last moves in `samples`), or, held still, a hold on what is under it (`hold`, its timer).
  const press = useRef<{
    x: number;
    y: number;
    grab: Grab | null;
    off: [number, number];
    touch: boolean;
    free: boolean;
    dragging: boolean;
    pan?: boolean;
    panning?: boolean;
    cam0?: Point;
    samples?: Sample[];
    hold?: number;
    /** Pressed on the building whose sheet is open: a drag carries it (no hold wanted), as it does once held. */
    ready?: boolean;
  } | null>(null);
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
    wakeScene.current();
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
    // What really came in, every bonus counted and as far as the larder has room, as the store gathered it against
    // the camp as it stands now: that is the figure shown (it used to be worked out here first, on the screen's copy).
    const got = store.gather();
    // (Since 1.5.10 nothing waits for room in the larder: a tap takes in all the oak has.)
    if (got <= 0) return;
    // Seen as well as heard: the oak shivers and lets go a few leaves, its acorns arc into the larder one after
    // another and fly up to the count, which goes up as they land.
    const at = performance.now();
    oakShook.current = { kind: "gather", at };
    playSound("pop", { volume: 0.45 });
    flights.current = Array.from({ length: Math.min(6, 1 + Math.floor(got / 6)) }, (_, index) => at + index * 90);
    wakeScene.current();
    float(live.spots.oak[0], live.spots.oak[1] - 6, `+${got}`);
    const first = oakAcornAt(live.spots);
    acornsIn(sceneToClient(first.x, first.y), got);
  };
  /** A place in the picture, on the screen: where acorns that come from it set off. Kept to what is shown of it. */
  const sceneToClient = (x: number, y: number): ClientPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const point = lay.pan
      ? { x: rect.left + (x - cam.current.x) * fit.css, y: rect.top + (y + lay.sky - cam.current.y) * fit.css }
      : { x: rect.left + (x / GAME_W) * rect.width, y: rect.top + ((y + lay.sky) / (GAME_H + lay.sky + lay.ground)) * rect.height };
    return { x: Math.min(rect.right - 8, Math.max(rect.left + 8, point.x)), y: Math.min(rect.bottom - 8, Math.max(rect.top + 8, point.y)) };
  };
  const centreOf = (element: Element | null | undefined): ClientPoint | null => {
    const rect = element?.getBoundingClientRect();
    return rect && (rect.width > 0 || rect.height > 0) ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  };
  /**
   * Acorns come in, seen and heard, whatever brought them: from where they
   * came, a few in an arc to the count at the top, which goes up as they
   * land, with the patter of them heard as they do (collect.tsx). With
   * nothing to fly (reduced motion, or nowhere to fly from) the count just
   * changes, and they are heard at once.
   */
  const acornsIn = (from: ClientPoint | null, got: number) => {
    if (got <= 0) return;
    const chip = acornChipRef.current;
    const to = centreOf(chip?.querySelector(".pip-sprite") ?? chip);
    const lands = from && to ? (trailsRef.current?.send(from, to, got) ?? null) : null;
    if (lands) {
      const was = acornCue.current;
      acornCue.current = was ? { first: Math.min(was.first, lands.first), last: Math.max(was.last, lands.last) } : lands;
    }
    acornsSound(got, lands ? lands.first - performance.now() : 0);
  };
  const choose = (site: Site) => {
    setSelected(site);
    setPanel("site");
    setChosenDecor(-1);
    chosenWork.current = null;
    if ((PLACED as readonly Site[]).includes(site)) bounced.current = { site: site as Placed, at: performance.now() };
    const box = boxOfSite(site);
    if (box) bring(box);
    // The pointer that said to tap a building has been done as it said.
    if (coachStep?.id === "tap") setCoachAt((at) => at + 1);
    playSound("click");
  };
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !look) return;
    const draw = (frame: number, seconds: number | null = null) => {
      // Set again each time: a canvas forgets it when its size changes.
      if (lay.pan) {
        // A window onto the clearing: what lies past its edges (where the camera's rubber band lets it be seen for a
        // moment) is the wood's own shade, and the clearing is drawn shifted by the camera, to whole canvas pixels.
        const canvas = ctx.canvas;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = OUTSIDE;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const { x, y } = cam.current;
        ctx.setTransform(fit.backing, 0, 0, fit.backing, -Math.round(x * fit.backing), -Math.round(y * fit.backing));
        ctx.imageSmoothingEnabled = false;
        // The clearing's edge, an ink line round it like the edge of a page: dragged past, it is seen to be the edge.
        ctx.fillStyle = EDGE_INK;
        ctx.fillRect(-2, -2, GAME_W + 4, GAME_H + lay.sky + lay.ground + 4);
        // For the guided session and the burrow's door, which find things in the picture by the canvas (geometry.ts).
        const camX = (Math.round(x * fit.backing) / fit.backing).toFixed(3);
        const camY = (Math.round(y * fit.backing) / fit.backing).toFixed(3);
        if (canvas.dataset.camX !== camX) canvas.dataset.camX = camX;
        if (canvas.dataset.camY !== camY) canvas.dataset.camY = camY;
      } else {
        drawAt(ctx, fit);
        delete ctx.canvas.dataset.camX;
        delete ctx.canvas.dataset.camY;
      }
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
              dusk: duskAt(clockAt(time)),
              clock: clockAt(time),
              ...(woken.current !== null && time - woken.current < AWAKE_SECONDS * 1000 ? { awake: (time - woken.current) / 1000 } : {}),
              bounce: chosen && time - chosen.at < BOUNCE_MS ? { site: chosen.site, age: (time - chosen.at) / 1000 } : null,
              flying: flights.current.map((from) => (time - from) / FLIGHT_MS),
              oakShake: oakShook.current && time - oakShook.current.at < OAK_SHOOK_MS ? { kind: oakShook.current.kind, age: (time - oakShook.current.at) / 1000 } : null,
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
        // (Fence was laid a piece at a time until 1.5.11: there is no piece in hand now. The wall is slid, and glows while it may be.)
        wall: null,
        sliding: arrange === "fence",
        front:
          base && area === "camp" && (arrange === "fence" || slotPick !== null)
            ? (() => {
                const places = frontPlaces(base);
                return {
                  spots: places.spots,
                  pads: places.pads,
                  open: frontOpen(base),
                  filled: { spots: base.front.spots.map((kind) => kind >= 0), pads: base.front.pads.map((kind) => kind >= 0) },
                  chosen: slotPick
                };
              })()
            : null,
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
          if (!(panelOpen && panel === "site" && chosenDecor < 0)) return undefined;
          // The chosen building's reach, and (1.5.10) how far its next level would reach: a dashed ring of butter.
          const own = defence.rings.filter((ring) => ring.site === selected);
          const up = base && (selected === "tower" || selected === "hut") && levelOf(base, selected) > 0 && levelOf(base, selected) < MAX_LEVEL ? reachOf(base, selected, levelOf(base, selected) + 1) : null;
          return up ? [...own, { ...up, next: true }] : own;
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
        petted: petted.current && time - petted.current.at < 900 ? { x: petted.current.x, y: petted.current.y, age: (time - petted.current.at) / 1000, hearts: petted.current.hearts } : null,
        bloomBurst: bloomBurstAt.current !== null && time - bloomBurstAt.current < 1000 ? (time - bloomBurstAt.current) / 1000 : null,
        pagesComing: pagesComing.current,
        burst: burst && burstFrame < BURST_FRAMES ? { site: burst.site, frame: burstFrame } : null,
        magpies: null,
        // The burrow's door: glowing to be found, open for Pip going in or coming out.
        ...door.extras(seconds === null ? null : time / 1000)
      };
    };
    // The first drawing is by the camp's clock like every one after it: drawn without it, the picture was the day's for
    // a frame at every tap, which by night was a flash of daylight.
    if (prefersReducedMotion()) {
      draw(0);
      // Still, but the camera can move: it is painted again when it does.
      repaint.current = () => draw(0);
      return () => {
        repaint.current = null;
      };
    }
    repaint.current = null;
    draw(Math.floor(((performance.now() - opened.current) / 1000) * ART_FPS), (performance.now() - opened.current) / 1000);
    // From when the camp was opened, not from when this picture was last begun again (which is whenever anything in
    // it changes): or everything that turns over would start from its first frame at every tap.
    const started = opened.current;
    // Only this picture's own loop paints it: one begun for an earlier size of the picture stops at once, and cannot
    // go on painting a small one into the corner of this one.
    let live = true;
    // Painted when its art turns to a new frame, twelve a second, at rest; every frame while the picture is touched or
    // something in it has just happened (on a lighter device, every other one: frameGate.ts, `busyFpsFor`). Between
    // the art's frames the loop sleeps rather than take frames it would not paint.
    const gate = sceneGate({ artFps: ART_FPS, busyFps: busyFpsFor(document.documentElement.dataset.perf) });
    const busy = (time: number) =>
      time - stirred.current < STIRRED_MS ||
      time - started < ARRIVE_MS ||
      Boolean(press.current?.dragging) ||
      (bounced.current !== null && time - bounced.current.at < BOUNCE_MS) ||
      flights.current.some((from) => time - from < FLIGHT_MS) ||
      (oakShook.current !== null && time - oakShook.current.at < OAK_SHOOK_MS) ||
      floats.current.some((entry) => time - entry.at < 1300) ||
      (petted.current !== null && time - petted.current.at < 900) ||
      (bloomBurstAt.current !== null && time - bloomBurstAt.current < 1000) ||
      (burst !== null && time - burst.at < (BURST_FRAMES / ART_FPS) * 1000) ||
      prowling.current;
    let ticked = 0;
    const tick = (time: number) => {
      // Back from a rest (between art frames, or covered): the camera's step is a frame's, not the whole rest.
      if (time - ticked > 50) camStepped.current = 0;
      ticked = time;
      // The camera moves by the clock (a drag, a flick, being sent to show something): every frame while it does.
      const moving = stepCamera(time);
      const active = moving || busy(time);
      if (!live) return;
      if (gate.due(time, started, active)) {
        // What moves across the picture moves by the clock, not by the art's twelve a second.
        draw(Math.floor(((time - started) / 1000) * ART_FPS), (time - started) / 1000);
      }
      return active ? undefined : untilNextArtFrame(time, started, ART_FPS);
    };
    const canvas = canvasRef.current;
    const stir = () => {
      stirred.current = performance.now();
      wakeScene.current();
    };
    canvas?.addEventListener("pointermove", stir, { passive: true });
    canvas?.addEventListener("pointerdown", stir, { passive: true });
    // Stopped while the window is hidden, the picture is not on the page or something is laid over most of it (a
    // sheet, the battle); drawn at once when it is back.
    const loop = runScene(canvas, tick, { resumed: gate.reset, cover: true });
    wakeScene.current = loop.wake;
    const stop = () => {
      wakeScene.current = () => undefined;
      loop.stop();
    };
    return () => {
      live = false;
      stop();
      canvas?.removeEventListener("pointermove", stir);
      canvas?.removeEventListener("pointerdown", stir);
    };
    // `base` and `now` reach the picture through `look`, which changes when they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art, look, selected, chosenDecor, placing, burst, tab, raid, arrange, carrying, watching, defence, panel, fit, chosenLand, area, lay, panelOpen, chosenGuard, slotPick]);

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
  /** The walks already dealt with (by their ids: `walksAt`), the nights already over, and from when this visit has watched. */
  const prowlSeen = useRef(new Set<string>());
  const nightsSeen = useRef(new Set<number>());
  const watchedFrom = useRef<number | null>(null);
  // Reading brings the night (1.5.11): opened with a night owed, the camp's day is late, and dusk is half a minute off.
  const shifted = useRef(false);
  useEffect(() => {
    if (!loaded || !base || shifted.current) return;
    shifted.current = true;
    if (nightDue(base, now.minutes)) shift.current = Math.max(0, NIGHT_FROM - 40 - (performance.now() - opened.current) / 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, base !== null]);
  // (Development only: the next night, three seconds off, for looking at the front without waiting for dusk.)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const hook = window as unknown as { __hollowNight?: () => number };
    hook.__hollowNight = () => {
      const clock = clockAt(performance.now());
      shift.current += nightStart(nightAt(clock) + 1) - 3 - clock;
      wakeScene.current();
      return nightAt(clock) + 1;
    };
    return () => {
      delete hook.__hollowNight;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!loaded || tab !== "camp" || area !== "camp" || arrange || placing || raid || watching) return;
    const clockNow = () => clockAt(performance.now());
    // Only what sets out from now on counts: what was already on its way when the camp came back on show did its
    // harm (or not) out of sight, and is let be.
    let since = clockNow();
    watchedFrom.current ??= since;
    const timer = window.setInterval(() => {
      const seen = lookRef.current;
      const rings = watchRef.current;
      const clock = clockNow();
      if (document.hidden || !seen || !rings) {
        since = clock;
        prowling.current = false;
        return;
      }
      let about = false;
      for (const walk of walksAt(seen, rings, clock)) {
        if (walk.at < since - 0.01 || prowlSeen.current.has(walk.id)) continue;
        const ends = walk.at + (walk.falls ?? walk.harms ?? walk.there);
        // Not over yet: looked at again in a second.
        if (clock < ends) {
          about = true;
          continue;
        }
        prowlSeen.current.add(walk.id);
        if (walk.falls === null && walk.harms !== null && walk.blew === null) {
          // He got there, and was still at it when he had done: the building is the worse for it.
          useBaseStore.getState().harmSite(walk.site);
          // A bomber goes off: it is worth two knocks.
          if (walk.pops) useBaseStore.getState().harmSite(walk.site);
          // And from the larder or the oak, whoever was not stopped makes off with a few acorns.
          else {
            const taken = useBaseStore.getState().robSite(walk.site);
            if (taken > 0) float(seen.spots[walk.site][0], seen.spots[walk.site][1] - 8, `-${taken}`, true);
          }
          if (walk.pops) float(seen.spots[walk.site][0], seen.spots[walk.site][1] - 6, undefined, true);
          knockedAt.current[walk.site] = performance.now();
          playSound(walk.pops ? "pop" : "crumble", { volume: 0.5 });
          // Pip has a word about what beats his kind, the first time one gets through.
          useBaseStore.getState().gotThrough(walk.role);
        }
        if (walk.blew !== null) {
          // A bomber blew a section of the wall: it lies in a heap until dawn.
          if (seen.line !== undefined) float(seen.line, walk.blew - 4, undefined, true);
          playSound("crumble", { volume: 0.6 });
          useBaseStore.getState().gotThrough("bomber");
        }
        // Whoever went out to him and did not finish him has a knock to show for it.
        if (walk.duel && walk.falls === null) useBaseStore.getState().woundFighter(walk.duel.who);
        // Seen off: the camp counts it (a goal of chapter 3 is to see one off).
        if (walk.falls !== null) seeOff();
      }
      // A night watched to its end, from its start: held (nobody got to anything), or not.
      const night = nightAt(clock);
      for (const n of [night - 1, night]) {
        if (n < 0 || nightsSeen.current.has(n)) continue;
        const plan = nightPlanOf(seen, rings, n, clock);
        if (!plan) continue;
        const from = nightStart(n);
        if (clock < from) continue;
        if (clock < from + plan.end + 1) {
          about = true;
          continue;
        }
        nightsSeen.current.add(n);
        if (from < (watchedFrom.current ?? from) - 0.01) continue;
        const held = nightHeld(plan);
        const paid = useBaseStore.getState().nightOver(held);
        if (seen.line !== undefined) float(seen.line, 70, held ? (paid > 0 ? `+${paid}` : "Held") : undefined, !held);
        if (paid > 0) setGained({ acorns: paid, at: performance.now() });
        playSound(held ? "chime" : "crumble", { volume: 0.6 });
      }
      // A night setting out: the camera eases over to the trail to see it come, unless the reader touched the screen
      // in the last two seconds (or has a panel open, or a finger down).
      const setting = nightAt(clock);
      if (setting >= 0 && !nightsEased.current.has(setting) && clock >= nightStart(setting) && clock < nightStart(setting) + 4) {
        nightsEased.current.add(setting);
        const { bounds, view, home } = camState.current;
        const plan = nightPlanOf(seen, rings, setting, clock);
        if (plan && plan.walks.length > 0 && bounds && view && !panelShown.current && !press.current && performance.now() - touchedAt.current > EASE_UNTOUCHED_MS) {
          const to = centredOn({ x: (seen.line ?? 64) / 2 + 12, y: home.y + view.h / 2 }, view, bounds);
          if (Math.abs(to.x - cam.current.x) > 0.5) sendCamera(to);
        }
      }
      // Tonight's chip: from a little before dusk until the night is over, who is coming, and how many are still to come.
      let showing: typeof nightShown = null;
      for (const n of [night, night + 1]) {
        if (n < 0 || clock < nightStart(n) - 25) continue;
        const plan = nightPlanOf(seen, rings, n, clock);
        if (!plan || clock > nightStart(n) + plan.end + 3) continue;
        const counts = countRoles(nightKinds(seen, n));
        const left = plan.walks.filter((walk) => nightStart(n) + walk.start + (walk.falls ?? walk.harms ?? walk.there) > clock).length;
        showing = { n, key: `${n}:${left}:${counts.map((entry) => entry.count).join()}`, counts, left };
        break;
      }
      setNightShown((was) => (was?.key === showing?.key ? was : showing));
      if (about && !prowling.current) wakeScene.current();
      prowling.current = about;
    }, 1000);
    return () => {
      window.clearInterval(timer);
      prowling.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tab, area, arrange, placing, raid, watching]);

  // Any touch in the Hollow (the picture, a key, a panel): the camera is the reader's for a moment after.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const touched = () => {
      touchedAt.current = performance.now();
    };
    root.addEventListener("pointerdown", touched, { capture: true, passive: true });
    return () => root.removeEventListener("pointerdown", touched, { capture: true });
  }, [loaded]);

  // (1.5.11) A trophy raised since the meadow was last seen, this visit: the bud opens there, in a burst.
  useEffect(() => {
    if (!base) return;
    if (bloomsSeen.current === null) {
      bloomsSeen.current = base.raised.length;
      return;
    }
    if (area !== "meadow" || base.raised.length <= bloomsSeen.current) return;
    bloomsSeen.current = base.raised.length;
    if (prefersReducedMotion()) return;
    bloomBurstAt.current = performance.now();
    playSound("pop", { volume: 0.5 });
    wakeScene.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, base?.raised.length]);
  // A meadow line goes with the meadow.
  useEffect(() => {
    if (area !== "meadow") setMeadowSay(null);
  }, [area]);

  // (1.5.11) Arriving after reading: once the camp is shown (and nothing else is: no tour, no sheet, no battle, the
  // page itself in view), what was read since the last arrival comes up the path. Marked as arrived at as it begins,
  // so it never plays twice; any touch skips to the end, and the touch still does what it was for.
  useEffect(() => {
    const seen = () => setPageShown(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, []);
  const endArrival = () => {
    arrivalTimers.current.forEach((timer) => window.clearTimeout(timer));
    arrivalTimers.current = [];
    pagesRef.current?.skip();
    pagesComing.current = false;
    setArriving(null);
    wakeScene.current();
  };
  useEffect(() => {
    if (!loaded || !base || !pageShown || tab !== "camp" || area !== "camp" || panelOpen || chapterOpen || raid || watching || arriving || tutorialRunning(base)) return;
    const tier = currentTier();
    const arrival = arrivalOf(base, now.minutes, tier, prefersReducedMotion(), meadowOpen(base));
    if (!arrival) return;
    useBaseStore.getState().seeArrival();
    setSince(arrival.since);
    setArrivalSaid(arrivalWords(arrival));
    if (arrival.pages === 0) return;
    const path = sceneToClient(base.spots.burrow[0], 56);
    const oakAt = oakAcornAt(base.spots);
    const root = rootRef.current;
    // Never under Pip's line (on a phone the oak can be behind it): just clear of it, below or beside.
    const oak = clearOfCovers(sceneToClient(oakAt.x, oakAt.y), Array.from(root?.querySelectorAll(".pip-camp-say, .pip-base-stats") ?? []), canvasRef.current);
    if (!path || !oak) return;
    const raidKey = centreOf(Array.from(root?.querySelectorAll(".pip-base-under button") ?? []).find((key) => /Raid/.test(key.textContent ?? "")));
    const meadowKey = centreOf(root?.querySelector(".pip-base-edge"));
    const bar = centreOf(root?.querySelector('[data-hud="chapter"] .pip-chapter-meter'));
    const sends: PageSend[] = pageStarts(arrival.pages).map((delay) => ({ from: path, to: oak, delay, fly: ARRIVAL_MS.fly, acorn: true }));
    if (arrival.toRaid && raidKey) sends.push({ from: path, to: raidKey, delay: ARRIVAL_MS.peel, fly: ARRIVAL_MS.fly });
    if (arrival.toMeadow && meadowKey) sends.push({ from: path, to: meadowKey, delay: ARRIVAL_MS.peel + ARRIVAL_MS.gap, fly: ARRIVAL_MS.fly });
    if (bar) sends.push({ from: oak, to: bar, delay: ARRIVAL_MS.bar, fly: ARRIVAL_MS.fly });
    // On the lighter tier, five things moving at the most.
    pagesRef.current?.send(tier === "lite" ? sends.slice(0, 5) : sends);
    pagesComing.current = true;
    wakeScene.current();
    playSound("swish", { volume: 0.35 });
    const start = performance.now();
    setArriving({ arrival, start });
    arrivalTimers.current = [
      window.setTimeout(() => {
        pagesComing.current = false;
        wakeScene.current();
        acornsSound(Math.max(1, arrival.since.oak));
      }, firstLands(arrival.pages)),
      window.setTimeout(() => {
        arrivalTimers.current = [];
        pagesComing.current = false;
        setArriving(null);
      }, arrival.ends)
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, pageShown, tab, area, panelOpen, chapterOpen, raid, watching, arriving, base?.seenAt, now.minutes]);
  // A touch anywhere while it plays: straight to the end.
  useEffect(() => {
    const root = rootRef.current;
    if (!arriving || !root) return undefined;
    const skip = () => endArrival();
    root.addEventListener("pointerdown", skip, { capture: true, passive: true });
    return () => root.removeEventListener("pointerdown", skip, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arriving]);
  useEffect(() => () => arrivalTimers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const barFrom = useMemo(() => (arriving ? { at: (t: number) => barFillAt(arriving.arrival, t), start: arriving.start, until: arriving.start + arriving.arrival.ends } : null), [arriving]);

  // Android's Back steps out of the camp's own states one at a time, as a hand would: what is being set down, the
  // moving about, the panel, a trophy's line, the raids or the journal, the meadow. With none of them, it is not the
  // camp's (the Pip tab's, then the app's). A raid's own Back is BattleScreen's; the postcard's, its own.
  useBackFallback(() => {
    if (raid) return false;
    if (chipOpen) {
      setChipOpen(null);
      return true;
    }
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
  // (Pieces of fence were laid by hand until 1.5.11: there are never any left to lay now.)
  const piecesLeft = 0;
  void fencePieces;
  const rested = raidsReady(base, now.minutes);
  /** The one next thing: always something (see `nextStep`). */
  const next = nextStep(base, now.minutes);
  const tourOn = tutorialRunning(base);
  /** The chapter bar (1.5.10): the chapter, the hours read, and the next goal (or the reading to the next chapter). */
  const chapterChip = chapterChipOf(base, now.minutes);
  /** The guide behind the (i), on a page (or its contents). */
  const openGuide = (page: string | null) => {
    setGuidePage(page);
    setTab("journal");
    setChipOpen(null);
    setChapterOpen(false);
    setPanelOpen(false);
    playSound("click");
  };
  /** A finished book whose trophy can be raised now: that comes before anything else on the list. */
  const raisable = waiting.length > 0 && trophyWaits(base, now.minutes) === 0 ? waiting[0] : null;
  /** How many of the parcels waiting the larder has room for, each whole. */
  const opensNow = parcelsOpenable(base);
  // Where the chapter's next goal is done: marked there until it is (not while Pip's first visit points the way itself).
  const nudge: GoalAt | null = tourOn ? null : chapterGoalAt(base, now.minutes);
  const goTo = (at: QuestAt | GoalAt) => {
    playSound("click");
    setChapterOpen(false);
    if (at === "decor" || at === "arrange") {
      setArea("camp");
      editMode(at === "decor" ? "decor" : base.levels.fence > 0 ? "fence" : "move");
      return;
    }
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
    const site = plotOpen(base, at) ? at : "burrow";
    setSelected(site);
    setPanel("site");
    chosenWork.current = null;
    const box = boxOfSite(site);
    if (box) bring(box);
  };
  /**
   * Opens the parcels waiting by the burrow's door: one (a tap on one in the
   * picture) or all that the larder has room for. What came in is heard and
   * seen, and a tale, if one came, is told in Pip's bubble.
   */
  const openParcels = (one: { x: number; y: number } | null = null) => {
    const first = useBaseStore.getState().base;
    if (!first) return;
    // Where the acorns come from: the parcel tapped in the picture, or the parcels' chip (it may be gone once they are opened).
    const from = one ? sceneToClient(one.x, one.y) : centreOf(rootRef.current?.querySelector('[data-hud="parcels"]'));
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
      // (They used to be seen flying from the oak to the larder, which is not where a parcel's acorns come from.)
      float(one?.x ?? base.spots.burrow[0], one?.y ?? base.spots.burrow[1] + 6, `+${got}`);
      acornsIn(from, got);
      store.learn("parcel");
    }
  };
  const chosenTile = (what: string) => what === "meadow" && area === "meadow";
  const mark = (at: QuestAt | Panel) => (nudge === at ? <span className="pip-base-nudge" aria-label="Next on Pip's list" /> : null);

  const toScene = (event: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // A window onto the clearing (a phone's camera): where the camera is, and so many CSS pixels to the art pixel.
    if (lay.pan) return { x: (event.clientX - rect.left) / fit.css + cam.current.x, y: (event.clientY - rect.top) / fit.css + cam.current.y - lay.sky };
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
  /** What was pressed is taken hold of: carried from here until it is let go (`pressUp` sets it down). */
  const takeHold = (now: NonNullable<typeof press.current>) => {
    const grab = now.grab;
    if (!grab) return;
    now.dragging = true;
    if (grab.what === "site") {
      setPlacing(null);
      setArrange("move");
      setCarrying(grab.site);
      // Seen to be picked up: it gives a little hop, and a puff where it stood.
      bounced.current = { site: grab.site, at: performance.now() };
      float(grab.x, grab.y);
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
  };
  /**
   * On a phone (the camera's, 1.5.8) a press is one of three things, and none of them is decided on the press: let go
   * where it began, a tap, which chooses what is under it (or sets down what is being placed); moved more than a few
   * pixels, a drag of the camera, which looks about the clearing (and a flick carries on); held still a moment on
   * something, a hold, and it is in hand, to be carried and set down. Fence is still drawn in Arrange, where a drag
   * lays it, and Arrange moves buildings by a drag as before.
   */
  const panDown = (event: React.PointerEvent<HTMLCanvasElement>, free: boolean) => {
    const at = toScene(event);
    glide.current = null;
    camTo.current = null;
    const started = performance.now();
    const now: NonNullable<typeof press.current> = {
      x: event.clientX,
      y: event.clientY,
      grab: null,
      off: [0, 0],
      touch: event.pointerType !== "mouse",
      free,
      dragging: false,
      pan: true,
      panning: false,
      cam0: { ...cam.current },
      samples: [{ t: started, x: event.clientX, y: event.clientY }]
    };
    press.current = now;
    // On the building whose sheet is open, a drag moves it at once (the sheet says what it is; this is where it goes).
    const chosen = panelOpen && panel === "site" && !listOpen && chosenWork.current === null ? selected : null;
    const under = free ? grabAt(at) : null;
    if (under?.what === "site" && under.site === chosen) {
      now.grab = under;
      now.off = [under.x - at.x, under.y - at.y];
      now.ready = true;
    }
    if (free) {
      now.hold = window.setTimeout(() => {
        if (press.current !== now || now.panning || now.dragging) return;
        const grab = grabAt(at);
        if (!grab) return;
        now.grab = grab;
        now.off = [grab.x - at.x, grab.y - at.y];
        takeHold(now);
        pointer.current = { x: grab.x, y: grab.y };
        stirred.current = performance.now();
        try {
          navigator.vibrate?.(12);
        } catch {
          // No buzz to give.
        }
      }, HOLD_MS);
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture: a drag that leaves the picture stops there.
    }
  };
  const pressDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const free = !placing && !arrange;
    fingerPress.current = event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY, at: performance.now(), target: event.currentTarget };
    if (lay.pan && !arrange) {
      panDown(event, free);
      return;
    }
    const at = toScene(event);
    const underSite = () => {
      const site = base ? siteAt(base.spots, at.x, at.y, sitesStanding(base)) : null;
      return site && base ? ({ what: "site", site, x: base.spots[site][0], y: base.spots[site][1] } as Grab) : null;
    };
    const underWall = () => {
      const wall = base ? wallAt(base, at.x, at.y) : -1;
      return wall >= 0 && base ? ({ what: "wall", index: wall, x: base.walls[wall][0], y: base.walls[wall][1] } as Grab) : null;
    };
    void underWall;
    const grab = free ? grabAt(at) : arrange === "move" && !carrying ? underSite() : null;
    // Sliding the wall (1.5.11): a press anywhere takes hold of it, and it follows the pointer along the trail.
    if (arrange === "fence" && base) {
      store.slideWall(at.x - wallXAt(0, at.y));
      playSound("pick");
    }
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
    if (now?.pan && !now.dragging) {
      const dx = event.clientX - now.x;
      const dy = event.clientY - now.y;
      if (!now.panning && isDrag(dx, dy)) {
        if (now.hold !== undefined) window.clearTimeout(now.hold);
        if (now.ready && now.grab) {
          // The chosen building, taken by a drag: carried, not the camera.
          takeHold(now);
          pointer.current = held(event);
          return;
        }
        now.panning = true;
      }
      const { bounds } = camState.current;
      if (now.panning && bounds && now.cam0) {
        const slack = SLACK_CSS / fit.css;
        cam.current = { x: rubber(now.cam0.x - dx / fit.css, bounds.x, slack), y: rubber(now.cam0.y - dy / fit.css, bounds.y, slack) };
        now.samples = [...(now.samples ?? []), { t: performance.now(), x: event.clientX, y: event.clientY }].slice(-8);
        stirred.current = performance.now();
        repaint.current?.();
      }
      return;
    }
    if (now && now.grab && !now.dragging && Math.hypot(event.clientX - now.x, event.clientY - now.y) > 9) takeHold(now);
    if (now && arrange === "fence" && base) {
      // The wall, in hand: it follows the pointer along the trail, as far as the trees one way and the camp the other.
      const at = toScene(event);
      const line = Math.round(at.x - wallXAt(0, at.y));
      const square = `${line}`;
      if (square !== fenced.current) {
        fenced.current = square;
        store.slideWall(line);
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
    if (now.pan && !now.dragging) {
      if (now.hold !== undefined) window.clearTimeout(now.hold);
      press.current = null;
      if (now.panning) {
        if (coachStep?.id === "drag") setCoachAt((at) => at + 1);
        // Let go: a flick carries on and slows, and past an edge it springs back (camera.ts).
        const { bounds, home } = camState.current;
        const speed = velocityOf([...(now.samples ?? []), { t: performance.now(), x: event.clientX, y: event.clientY }]);
        if (bounds && !prefersReducedMotion()) glide.current = { ...cam.current, vx: -speed.vx / fit.css, vy: -speed.vy / fit.css };
        else if (bounds) {
          cam.current = { x: Math.max(bounds.x.min, Math.min(bounds.x.max, cam.current.x)), y: Math.max(bounds.y.min, Math.min(bounds.y.max, cam.current.y)) };
          setAway(awayFrom(cam.current, home));
          repaint.current?.();
        }
        return;
      }
      // A tap. Twice on open ground, close together: the camera goes home.
      const at = toScene(event);
      const open = !placing && grabAt(at) === null && guardAtPoint(look, at.x, at.y) === null && !basketAtPoint(look, at.x, at.y) && !parcelAtPoint(look, at.x, at.y) && trophyAtPoint(look, at.x, at.y) < 0;
      const tapped = performance.now();
      const last = lastTap.current;
      pick(event);
      if (open && last && tapped - last.at < DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) < DOUBLE_TAP_SLOP) {
        lastTap.current = null;
        goHome();
      } else lastTap.current = open ? { x: event.clientX, y: event.clientY, at: tapped } : null;
      return;
    }
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
    // The wall let go, where it is.
    if (arrange === "fence" && base) playSound("place", { volume: 0.6 });
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
    if (found === "burrow") door.go();
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
      // An animal under the finger is petted: it does nothing but please them both (and shows its hearts). Then (1.5.11)
      // the record of the reading: a stone, a bloom, the bud say what they are; the wild ones open the list.
      const tapped = meadowTapAt(look ?? { animals: base.animals }, prefersReducedMotion() ? null : performance.now() / 1000, at.x, at.y);
      if (tapped?.kind === "animal") {
        petted.current = { x: tapped.x, y: tapped.y, at: performance.now(), hearts: heartsOf(base, tapped.animal, now.minutes) };
        playSound(tapped.animal === 1 ? "purr" : tapped.animal === 0 ? "squeak" : "pop", { pitch: 0.8 + tapped.animal * 0.08 });
        return;
      }
      if (tapped?.kind === "wild") {
        setBloomsShown(30);
        setPanel("blooms");
        playSound("click");
        return;
      }
      if (tapped) {
        setMeadowSay(tapped.kind === "stone" ? { kind: "stone", text: stoneSays(tapped.stone) } : tapped.kind === "bloom" ? { kind: "bloom", index: tapped.index } : { kind: "bud" });
        playSound("click");
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
      // (Slid by the press itself: `pressDown`.)
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
    // Pip's welcome basket: a tap opens it, when the larder has room for all of it.
    if (basketAtPoint(look, at.x, at.y)) {
      const before = base.acorns;
      store.openWelcomeBasket();
      const got = (useBaseStore.getState().base?.acorns ?? before) - before;
      playSound(got > 0 ? "pop" : "womp", { volume: 0.6 });
      if (got > 0) {
        float(at.x, at.y, `+${got}`);
        acornsIn(sceneToClient(at.x, at.y), got);
      }
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
      setListOpen(false);
      setFromList(false);
      bring(boxAt(base.decor[thing].x, base.decor[thing].y));
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
      bring(boxAt(base.works[work].x, base.works[work].y));
      playSound("click");
      return;
    }
    // A guardian at their post: a tap is their card, where they are posted and trained.
    const guard = guardAtPoint(look, at.x, at.y);
    if (guard !== null) {
      setChosenLand(-1);
      setChosenGuard(guard);
      setPanel("guard");
      const stands = postSpotOf(base, guard);
      if (stands) bring(boxAt(stands[0], stands[1]));
      playSound("click");
      return;
    }
    // The burrow's door: one tap and in, Pip ahead. (The rest of the burrow chooses it.)
    if (door.tap(at)) {
      playSound("click");
      return;
    }
    const found = siteAt(base.spots, at.x, at.y, sitesStanding(base));
    if (found) {
      setChosenLand(-1);
      // By night she is in bed in there: a tap on the burrow has her up and about for a while.
      if (found === "burrow" && duskAt(clockAt(performance.now())) >= 0.5 && (woken.current === null || performance.now() - woken.current > AWAKE_SECONDS * 1000)) {
        woken.current = performance.now();
        playSound("squeak", { pitch: 1.15 });
      }
      choose(found);
      // A tap on an oak with acorns on it takes them in, without a button.
      if (found === "oak") gatherOak();
      return;
    }
    const ground = landAt(base.land, at.x, at.y);
    setChosenLand(ground);
    // Bare ground: whatever was open is put away, and the clearing is all there is to see.
    setPanelOpen(ground >= 0);
    setListOpen(false);
    setFromList(false);
    if (ground >= 0) bring(boxAt(base.land[ground].x, base.land[ground].y));
  };

  // ---- the guardian whose post the chosen site is ------------------------------------------------
  // (Since 1.5.8 a rank is paid for in acorns, its training and all, and had at once: `guardCost`.)
  const guardRow = (guard: Guardian | null = guardAt(selected), alone = false) => {
    if (!guard || (!alone && (levelOf(base, selected) === 0 || !campOpened(base, now.minutes, "guards")))) return null;
    const rank = guardOf(base, guard.id);
    const why = guardBlocked(base, guard.id);
    const to = rank + 1;
    const price = guardCost(to);
    return (
      <div className={`pip-base-guard ${alone ? "is-alone" : ""}`}>
        <Sprite name="guardian" variant={guard.id} box={alone ? 44 : 36} className={rank === 0 ? "is-locked" : ""} />
        <div className="min-w-0 flex-1">
          <p className="pip-base-person" title={`${guard.name}, ${guard.title}. A guardian is posted at a building, and holds the ground about a signpost.`}>
            {guard.short}
            <span className="pip-base-hearts" role="img" aria-label={`Rank ${rank} of ${GUARD_MOST}`} title={`Rank ${rank} of ${GUARD_MOST}`}>
              {Array.from({ length: GUARD_MOST }, (_, step) => (
                <Shield key={step} size={11} aria-hidden fill={step < rank ? "currentColor" : "none"} className={step < rank ? "is-rank" : ""} />
              ))}
            </span>
          </p>
          <p className="pip-sheet-now">{guard.does}</p>
          {rank > 0 && guard.post !== "store" && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className="pip-base-chip"
                title="They keep to the ground about their signpost, and go out to whoever comes within it. Hold the signpost, then drag it anywhere in the clearing to move them."
              >
                <Move size={11} aria-hidden /> Signpost
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
          {rank < GUARD_MOST && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="tactile-button px-2.5 py-1 text-xs"
                aria-disabled={why !== null}
                title={`${rank === 0 ? "Post them" : `Train them to rank ${to}`}: ${price} acorns`}
                onClick={() => {
                  if (why) {
                    setWhyShown(WHY_NO_GUARD[why](base, guard.id) || null);
                    playSound("womp", { volume: 0.4 });
                    return;
                  }
                  store.trainGuard(guard.id);
                  playSound("horn", { volume: 0.6 });
                }}
              >
                <span className="flex items-center gap-1.5">
                  {rank === 0 ? "Post" : `Train to rank ${to}`} · {acorns(price)}
                </span>
              </button>
              {why && <span className="pip-sheet-why">{WHY_NO_GUARD[why](base, guard.id)}</span>}
            </p>
          )}
        </div>
      </div>
    );
  };

  // ---- the Build panel: what there is, by what it is for, as lists in four tabs --------------------------------
  /** Which tab is open: it follows what is chosen. None in the meadow. */
  const shelf: Shelf | null = area !== "camp" ? null : panel === "decor" ? "decor" : panel === "people" || panel === "guard" ? "people" : panel === "garden" ? "camp" : shelfOfSite(selected);
  /** The Build key is lit while its panel (a list, or a sheet opened from one) is open. */
  const buildOpen = tab === "camp" && panelOpen && (listOpen || fromList) && !decorEdit && area === "camp";
  /** Opens the Build panel on a tab; the Build key with its panel open shuts it (`toggle`). */
  const openShelf = (to: Shelf, toggle = true) => {
    if (toggle && buildOpen) {
      setPanelOpen(false);
      playSound("click");
      return;
    }
    setBuildTab(to);
    setTab("camp");
    setChosenDecor(-1);
    setChosenLand(-1);
    setPlacing(null);
    chosenWork.current = null;
    if (to === "camp") {
      if (shelfOfSite(selected) !== "camp") setSelected("burrow");
      setPanel("site");
    } else if (to === "defence") {
      setSelected(shelfOfSite(selected) === "defence" ? selected : "tower");
      setPanel("site");
    } else setPanel(to === "people" ? "people" : "decor");
    // A list, on the right of the picture (nothing in it is chosen yet).
    setListOpen(true);
    setSide("right");
    playSound("click");
  };
  /** Edit: move, fence or decorate. Decorate is the Decor tab's list with the edit bar kept at the foot. */
  const editMode = (mode: EditMode) => {
    if (mode === "decor") {
      leaveArrange();
      setDecorEdit(true);
      setTab("camp");
      setChosenDecor(-1);
      setChosenLand(-1);
      setPanel("decor");
      setListOpen(true);
      setSide("right");
      playSound("click");
      return;
    }
    setDecorEdit(false);
    setPanelOpen(false);
    beginArrange(mode);
    playSound("click");
  };
  const leaveEdit = () => {
    leaveArrange();
    setDecorEdit(false);
    setPanelOpen(false);
    setPlacing(null);
  };
  /** From a row of a list to its sheet: the sheet has a way back to the list. */
  const fromRow = (open: () => void) => {
    open();
    setFromList(true);
  };
  /** A site's picture, as it stands. */
  const sitePicture = (site: Site, box: number) => {
    const yard = site === "yard0" ? base.yard[0] : site === "yard1" ? base.yard[1] : null;
    const level = levelOf(base, site);
    return (
      <Sprite
        name={site === "fence" ? "fencepiece" : yard ? (yard.kind ?? "workshop") : pathLook(site, level)?.name ?? site}
        variant={site === "fence" ? Math.max(1, level) : (pathLook(site, level)?.variant ?? level)}
        box={box}
        className={level === 0 && (site === "fence" || (yard !== null && !yard.kind)) ? "is-locked" : ""}
      />
    );
  };
  /** One row of a list: a picture, a name, a line of how it stands, and its level. */
  const row = (key: string, parts: { picture: React.ReactNode; name: string; status: React.ReactNode; tone?: "good" | "bad" | "soft"; level?: number | null; site?: Site; onClick: () => void; onPointerDown?: (event: React.PointerEvent) => void; mark?: React.ReactNode; chosen?: boolean }) => (
    <button
      key={key}
      type="button"
      className={`pip-base-row ${parts.chosen ? "is-chosen" : ""}`}
      data-site={parts.site}
      onClick={parts.onClick}
      onPointerDown={parts.onPointerDown}
    >
      <span className="pip-base-row-pic">{parts.picture}</span>
      <span className="pip-base-row-text">
        <span className="pip-base-row-name">{parts.name}</span>
        <span className={`pip-base-row-status is-${parts.tone ?? "soft"}`}>{parts.status}</span>
      </span>
      {parts.level !== undefined && parts.level !== null && <span className="pip-base-row-level">{parts.level === 0 ? "New" : `Lv ${parts.level}`}</span>}
      {parts.mark}
    </button>
  );
  /** How a site stands, in a few words, for its row: what it waits for, or what its next level costs. */
  const siteStatus = (site: Site): { text: React.ReactNode; tone: "good" | "bad" | "soft" } => {
    if (harmOf(base, site) > 0) return { text: isBroken(base, site) ? "Broken: fix it" : "Knocked about: fix it", tone: "bad" };
    // What a tap would really bring in (the oak's card says the same figure): with the larder full, nothing yet.
    if (site === "oak" && ready > 0) {
      const brings = gatherBrings(base, now.minutes, streak, now.day);
      if (brings > 0) return { text: <>Collect {acorns(brings, 10)}</>, tone: "good" };
    }
    const sheet = sheetOf(base, site, now.mood);
    if (sheet.grows) return { text: `Grows with chapter ${sheet.grows.chapter}`, tone: "soft" };
    if (!sheet.next) return { text: "Top level", tone: "soft" };
    if (!sheet.action) return { text: "Empty: choose what to build", tone: "good" };
    const missing = sheet.next.needs.find((need) => !need.ok);
    if (!missing) return { text: <>{sheet.action.label} · {acorns(sheet.next.price, 10)}</>, tone: "good" };
    if (missing.id === "chapter") return { text: `Comes with chapter ${missing.need}`, tone: "soft" };
    if (missing.id === "acorns") return { text: <>{sheet.action.label} · {acorns(`${base.acorns}/${sheet.next.price}`, 10)}</>, tone: "soft" };
    return { text: missing.label, tone: "soft" };
  };
  const siteRow = (site: Site) => {
    const status = siteStatus(site);
    return row(site, {
      picture: sitePicture(site, 28),
      name: siteName(base, site),
      status: status.text,
      tone: status.tone,
      level: levelOf(base, site),
      site,
      onClick: () => fromRow(() => choose(site)),
      mark: mark(site)
    });
  };
  /** A thing the camp has yet to bring: what it is, and the chapter that brings it (a tap is the chapter card). */
  const shutRow = (key: string, name: string, chapter: number, picture: React.ReactNode) =>
    row(key, { picture: <span className="is-locked">{picture}</span>, name, status: `Comes with chapter ${chapter}`, tone: "soft", onClick: () => setChapterOpen(true) });
  const campList = () => {
    const level = base.levels.burrow;
    return (
      <section className="pip-base-card pip-base-shelf pip-sheet" aria-label="Camp">
        <h3 className="pip-sheet-title">Camp</h3>
        <div className="pip-base-rows" role="group" aria-label="Buildings">
          {/* What stands, and of what is still to come only the next: nothing else stands about locked. */}
          {SHELF_SITES.camp
            .filter((site, index, all) => plotOpen(base, site) || all.findIndex((other) => !plotOpen(base, other)) === index)
            .map((site) =>
              plotOpen(base, site)
                ? siteRow(site)
                : shutRow(site, site === "yard0" ? "A plot in the yard" : "A second plot", plotComesAt(base, site) ?? CHAPTER_OF[site === "yard0" ? "yard0" : "yard1"], <Sprite name="workshop" variant={0} box={28} />)
            )}
        </div>
      </section>
    );
  };

  /** (1.5.11) What a construct beats, in a word or two: "Beats runners"; the bell, everything a little. */
  const beatsOf = (kind: number): { role: Role | null; words: string } => {
    const role = ROLES.find((entry) => COUNTER[entry] === kind) ?? null;
    return { role, words: role ? `Beats ${ROLE_NAMES[role].many}` : kind === BELL ? "Everything throws faster" : "" };
  };
  /** What a slot's chapter is, when it is not open yet. */
  const slotChapter = (at: FrontSlot["at"], index: number) => {
    for (let chapter = 1; chapter <= 10; chapter++) if ((at === "spot" ? spotsOpen(chapter) : padsOpen(chapter)) > index) return chapter;
    return 10;
  };
  /**
   * The front (1.5.11): the lookout, the hut and the wall; the trap spots on the trail and the tower pads behind the
   * wall, each with what is on it (a tap on one lists what may go there: from the shed, or bought); and the bell.
   */
  const defenceList = () => {
    const open = frontOpen(base);
    const kinds = (at: FrontSlot["at"]) => (at === "spot" ? TRAPS : TOWERS);
    const slotRow = (at: FrontSlot["at"], index: number) => {
      const key = `${at}-${index}`;
      if (index >= (at === "spot" ? open.spots : open.pads))
        return shutRow(key, at === "spot" ? "A trap spot" : "A tower pad", slotChapter(at, index), <Sprite name="work" variant={at === "spot" ? 8 : 10} box={28} />);
      const kind = (at === "spot" ? base.front.spots : base.front.pads)[index] ?? -1;
      const chosen = slotPick?.at === at && slotPick.index === index;
      const beats = kind >= 0 ? beatsOf(kind) : null;
      return (
        <div key={key} className="pip-front-slot">
          {row(key, {
            picture: kind >= 0 ? <Sprite name="work" variant={kind} box={30} /> : <span className={`pip-front-empty is-${at}`} aria-hidden="true" />,
            name: kind >= 0 ? WORKS[kind].name : at === "spot" ? "Trap spot: empty" : "Tower pad: empty",
            status: beats ? (
              <span className="pip-front-beats">
                {beats.role && <FoeFace kind={beats.role} box={14} />}
                {beats.words}
              </span>
            ) : (
              "Tap to choose"
            ),
            tone: kind >= 0 ? "soft" : "good",
            chosen,
            onClick: () => {
              setSlotPick(chosen ? null : { at, index });
              playSound("click");
            }
          })}
          {chosen && (
            <div className="pip-front-choose" role="group" aria-label={at === "spot" ? "Traps" : "Towers"}>
              {kinds(at).map((choice) => {
                const work = WORKS[choice];
                const inShed = base.front.shed.includes(choice);
                const elsewhere = (at === "spot" ? base.front.spots : base.front.pads).some((entry, other) => other !== index && entry === choice);
                const why = choice === kind ? null : inShed || elsewhere ? null : workBlocked(base, choice);
                const comes = WORK_CHAPTER[choice];
                const beats = beatsOf(choice);
                return row(`choose-${choice}`, {
                  picture: <Sprite name="work" variant={choice} box={26} className={why === "chapter" ? "is-locked" : ""} />,
                  name: work.name,
                  status:
                    choice === kind ? (
                      "Here now"
                    ) : why === "chapter" ? (
                      `Comes with chapter ${comes}`
                    ) : why === "most" ? (
                      "Already on the front"
                    ) : inShed ? (
                      <>From the shed · {beats.words}</>
                    ) : elsewhere ? (
                      <>Move it here · {beats.words}</>
                    ) : why === "acorns" ? (
                      <>Buy · {acorns(`${base.acorns}/${work.cost}`, 10)}</>
                    ) : (
                      <>
                        Buy · {acorns(work.cost, 10)} · {beats.words}
                      </>
                    ),
                  tone: choice === kind || why ? "soft" : "good",
                  onClick: () => {
                    if (choice === kind) {
                      // Here already: taken off, to the shed.
                      store.seatWork({ at, index }, -1);
                      playSound("pick");
                      return;
                    }
                    if (why) {
                      setWhyShown(why === "acorns" ? `${work.cost - base.acorns} more acorns for the ${work.name.toLowerCase()}` : why === "chapter" ? `Comes with chapter ${comes}` : `The camp has as many as it may of the ${work.name.toLowerCase()}`);
                      playSound("womp", { volume: 0.4 });
                      return;
                    }
                    store.seatWork({ at, index }, choice);
                    playSound("place");
                    setSlotPick(null);
                  }
                });
              })}
            </div>
          )}
        </div>
      );
    };
    const bellWhy = base.front.bell ? null : workBlocked(base, BELL);
    const trail = campOpened(base, now.minutes, "prowlers");
    return (
      <section className="pip-base-card pip-base-shelf pip-sheet" aria-label="Defence">
        <h3 className="pip-sheet-title" title="Prowlers come down the trail from the Dark Wood. A wall across it, traps on it and towers behind it keep them out.">
          Defence
        </h3>
        <div className="pip-base-rows" role="group" aria-label="Walls and watch">
          {siteRow("tower")}
          {siteRow("hut")}
          {!campOpened(base, now.minutes, "fence") && base.levels.fence === 0 ? shutRow("fence", "The fence", CHAPTER_OF.fence, <Sprite name="fencepiece" variant={1} box={28} />) : siteRow("fence")}
        </div>
        {trail && (
          <>
            <h4 className="pip-sheet-label" title="Traps lie on the trail in front of the wall. Each beats one kind of prowler: put down the ones tonight's need.">
              On the trail
            </h4>
            <div className="pip-base-rows" role="group" aria-label="Trap spots">
              {[0, 1, 2].filter((index) => index <= open.spots).map((index) => slotRow("spot", index))}
            </div>
            <h4 className="pip-sheet-label" title="Towers stand on pads behind the wall, and throw at whatever comes down the trail.">
              Behind the wall
            </h4>
            <div className="pip-base-rows" role="group" aria-label="Tower pads">
              {[0, 1, 2].filter((index) => index <= open.pads).map((index) => slotRow("pad", index))}
            </div>
            <div className="pip-base-rows" role="group" aria-label="On the gate">
              {base.front.bell || bellWhy !== "chapter"
                ? row("bell", {
                    picture: <Sprite name="work" variant={BELL} box={28} className={bellWhy ? "is-locked" : ""} />,
                    name: WORKS[BELL].name,
                    status: base.front.bell ? "On the gate · everything throws faster" : bellWhy === "acorns" ? <>Buy · {acorns(`${base.acorns}/${WORKS[BELL].cost}`, 10)}</> : <>Buy · {acorns(WORKS[BELL].cost, 10)}</>,
                    tone: base.front.bell || bellWhy ? "soft" : "good",
                    onClick: () => {
                      if (base.front.bell) return;
                      if (bellWhy) {
                        setWhyShown(`${WORKS[BELL].cost - base.acorns} more acorns for the watch bell`);
                        playSound("womp", { volume: 0.4 });
                        return;
                      }
                      store.buyWork(BELL);
                      playSound("place");
                    }
                  })
                : shutRow("bell", WORKS[BELL].name, WORK_CHAPTER[BELL], <Sprite name="work" variant={BELL} box={28} />)}
            </div>
            {base.front.shed.length > 0 && (
              <p className="pip-front-shed" title="Constructs you have that are not on the front. Choose a spot or a pad to put one there.">
                <span className="pip-front-shed-word">Shed</span>
                {base.front.shed.map((kind, index) => (
                  <Sprite key={`${kind}-${index}`} name="work" variant={kind} box={20} />
                ))}
              </p>
            )}
          </>
        )}
      </section>
    );
  };

  const peopleList = () => {
    const here = residents(base).length;
    const blades = bladesWon(base).length;
    return (
      <section className="pip-base-card pip-base-shelf pip-sheet" aria-label="People">
        <h3
          className="pip-sheet-title"
          title="The scouts' hut trains the scouts who raid. Heroes come for the books you finish: one leads each raid, and they are about the camp for friends to see. Guardians are hired, and hold the camp against prowlers."
        >
          People
          {blades > 0 && here > 0 && (
            <span className="pip-base-chip ml-2" title={`Blades won: ${blades} of ${BLADES.length}. Each was a magpie lord's, or a friend's gift. A hero is given one under "Who lives here".`}>
              <Swords size={11} aria-hidden /> {blades} / {BLADES.length}
            </span>
          )}
        </h3>
        <div className="pip-base-rows" role="group" aria-label="Who lives here">
          {row("people", {
            picture: <Users size={20} aria-hidden />,
            name: "Who lives here",
            status: `${here} of ${HEROES.length} heroes, and Pip`,
            onClick: () =>
              fromRow(() => {
                setPanel("people");
                setChosenDecor(-1);
                playSound("click");
              })
          })}
        </div>
        {campOpened(base, now.minutes, "guards") && (
          <>
            <h4
              className="pip-sheet-label"
              title="Seven, hired for acorns, each at a building of the camp. Each holds the ground about a signpost you place, and fights whoever comes into it. They never go raiding. They grow by rank, and look it."
            >
              Guardians
            </h4>
            <div className="pip-base-rows" role="group" aria-label="Guardians">
              {GUARDIANS.map((guard) => {
                const rank = guardOf(base, guard.id);
                const why = guardBlocked(base, guard.id);
                return row(`guard-${guard.id}`, {
                  picture: <Sprite name="guardian" variant={guard.id} box={28} className={rank === 0 ? "is-locked" : ""} />,
                  name: guard.short,
                  status:
                    rank >= GUARD_MOST ? (
                      "Top rank"
                    ) : why === "post" ? (
                      WHY_NO_GUARD.post(base, guard.id)
                    ) : (
                      <>
                        {rank === 0 ? "Post" : "Train"} · {acorns(guardCost(rank + 1), 10)}
                      </>
                    ),
                  tone: rank < GUARD_MOST && why === null ? "good" : "soft",
                  level: rank,
                  onClick: () =>
                    fromRow(() => {
                      setChosenGuard(guard.id);
                      setPanel("guard");
                      setChosenDecor(-1);
                      setChosenLand(-1);
                      const stands = postSpotOf(base, guard.id);
                      if (stands) bring(boxAt(stands[0], stands[1]));
                      playSound("click");
                    })
                });
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
      <section className="pip-base-card pip-sheet" aria-live="polite">
        <header className="pip-sheet-head">
          <span className="pip-sheet-pic">
            <Sprite name="gardenbed" variant={garden.ripe > 0 ? 2 : garden.growing > 0 ? 1 : 0} box={40} />
          </span>
          <span className="min-w-0 flex-1">
            <h3 className="pip-sheet-title" title="Pip's own garden, in her house: seeds grow there as you read, for her shop. Not used in the Hollow.">
              Pip's garden
            </h3>
            <span className="pip-sheet-now">{garden.ripe > 0 ? `${garden.ripe} ripe to pick` : garden.growing > 0 ? `${garden.growing} growing` : "Nothing planted"}</span>
          </span>
          <span className="pip-base-level" title="Beds planted, of the beds there are">
            {garden.growing + garden.ripe}/{garden.plots}
          </span>
        </header>
        <div className="pip-sheet-keys">
          <button type="button" className={`tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold ${garden.ripe > 0 ? "is-ready" : ""}`} onClick={garden.onOpen}>
            {garden.ripe > 0 ? "Pick" : garden.growing > 0 ? "Look in" : "Plant"}
          </button>
        </div>
      </section>
    ) : null;

  /** A guardian's own card, from the list or the picture. */
  const guardCard = () => (
    <section className="pip-base-card pip-sheet" aria-live="polite">
      {guardRow(GUARDIANS[chosenGuard] ?? null, true)}
      {whyShown && <p className="pip-sheet-why is-said">{whyShown}</p>}
    </section>
  );

  /** A construct tapped in the picture: what it does, and the way to move it. */
  const workCard = (kind: number) => {
    const work = WORKS[kind];
    if (!work) return null;
    return (
      <section className="pip-base-card pip-sheet" aria-live="polite">
        <header className="pip-sheet-head">
          <span className="pip-sheet-pic">
            <Sprite name="work" variant={kind} box={40} />
          </span>
          <span className="min-w-0 flex-1">
            <h3 className="pip-sheet-title">{work.name}</h3>
            <span className="pip-sheet-now">{work.does}</span>
          </span>
        </header>
        <div className="pip-sheet-keys">
          <button
            type="button"
            className="tactile-button px-3 py-1.5 text-xs"
            title="Then tap where it should go. (Or hold it in the picture, and drag it.) Moving it is free."
            onClick={() => {
              pointer.current = null;
              setPlacing({ kind, moving: true, what: "work" });
              playSound("pick");
            }}
          >
            <span className="flex items-center gap-1.5">
              <Move size={12} aria-hidden /> Move
            </span>
          </button>
        </div>
      </section>
    );
  };

  /** One need of a sheet's next level: met or not, with its picture. */
  const needLine = (need: Need) => (
    <li key={need.id} className={need.ok ? "is-ok" : "is-short"}>
      <span className="pip-sheet-need-icon" aria-hidden="true">
        {need.id === "acorns" ? <Sprite name="acorn" box={14} /> : need.id === "chapter" ? <BookOpen size={12} /> : need.id === "fix" ? <Hammer size={12} /> : <Lock size={12} />}
      </span>
      <span className="min-w-0 flex-1">
        {need.id === "acorns" ? <span className="sr-only">Acorns: </span> : null}
        {need.label}
      </span>
      <span className="pip-sheet-need-mark" aria-label={need.ok ? "Done" : "Not yet"}>
        {need.ok ? <Check size={12} strokeWidth={3} aria-hidden /> : <X size={12} strokeWidth={3} aria-hidden />}
      </span>
    </li>
  );

  // ---- the chosen site's sheet (siteSheet.ts) ---------------------------------------------------------------
  const siteCard = () => {
    const sheet = sheetOf(base, selected, now.mood);
    const yard = selected === "yard0" ? base.yard[0] : selected === "yard1" ? base.yard[1] : null;
    const job = jobOn(base, selected);
    const happy = moodQuicker(now.mood) > 0;
    const build = (kind?: YardKind) => {
      store.build(selected, kind);
      setWhyShown(null);
      playSound("hammer");
    };
    return (
      <section className="pip-base-card pip-sheet" aria-live="polite">
        <header className="pip-sheet-head">
          <span className="pip-sheet-pic">{sitePicture(selected, 40)}</span>
          <span className="min-w-0 flex-1">
            <h3 className="pip-sheet-title">{sheet.name}</h3>
            <span className="pip-sheet-now">{sheet.now}</span>
          </span>
          <span className="pip-base-level">{sheet.level === 0 ? "New" : `Lv ${sheet.level}`}</span>
        </header>
        {sheet.grows && (
          <div className="pip-sheet-next">
            <p className="pip-sheet-label">Level {sheet.grows.level}</p>
            <p className="pip-sheet-brings">Grows by itself as you read: {sheet.grows.title}</p>
            <ChapterThings chapter={sheet.grows.chapter} />
            <p className="pip-sheet-keys">
              <button type="button" className="tactile-button px-3 py-1.5 text-xs" onClick={() => setChapterOpen(true)}>
                Chapter {chapterChip.n}
              </button>
            </p>
          </div>
        )}
        {sheet.next && (
          <div className="pip-sheet-next">
            <p className="pip-sheet-label">{sheet.level === 0 ? "Build it" : `Level ${sheet.next.to}`}</p>
            <p className="pip-sheet-brings">{sheet.next.brings}</p>
            {sheet.next.needs.length > 0 && <ul className="pip-sheet-needs">{sheet.next.needs.map(needLine)}</ul>}
          </div>
        )}
        <div className="pip-sheet-keys">
          {job ? (
            <span className="pip-base-chip">
              <Hammer size={11} aria-hidden /> Going up
            </span>
          ) : sheet.action ? (
            <button
              type="button"
              data-coach="build"
              data-site={selected}
              className={`tactile-button tactile-button-primary px-3 py-1.5 text-xs font-semibold ${sheet.action.why ? "is-blocked" : ""}`}
              aria-disabled={sheet.action.why !== null}
              title={`${sheet.action.price} acorns${happy ? `. Pip is happy at home, so her work costs ${Math.round(moodQuicker(now.mood) * 100)}% less.` : ""}`}
              onClick={() => {
                if (sheet.action?.why) {
                  setWhyShown(sheet.action.why);
                  playSound("womp", { volume: 0.4 });
                  return;
                }
                build();
              }}
            >
              <span className="flex items-center gap-1.5">
                {sheet.action.label} · {acorns(sheet.action.price)}
                {happy && <Heart size={10} aria-hidden fill="currentColor" className="pip-base-happy" />}
              </span>
            </button>
          ) : null}
          {harmOf(base, selected) > 0 && (
            <button
              type="button"
              className="tactile-button px-3 py-1.5 text-xs"
              aria-disabled={base.acorns < fixCost(base, selected, now.day)}
              title={
                isBroken(base, selected)
                  ? `Broken by prowlers. Until it is put right, ${BROKEN_DOES[selected as Placed]}, and it is not built on.`
                  : `Knocked about by a prowler: ${harmOf(base, selected)} of ${HARM_MOST}. At ${HARM_MOST} it is broken: ${BROKEN_DOES[selected as Placed]}. It is not built on until it is put right.`
              }
              onClick={() => {
                if (base.acorns < fixCost(base, selected, now.day)) {
                  setWhyShown(`${fixCost(base, selected, now.day) - base.acorns} more acorns to fix it`);
                  return;
                }
                store.fixSite(selected as Placed);
                playSound("hammer");
                if ((PLACED as readonly Site[]).includes(selected)) {
                  float(base.spots[selected as Placed][0], base.spots[selected as Placed][1] - 6);
                  bounced.current = { site: selected as Placed, at: performance.now() };
                }
              }}
            >
              <span className="flex items-center gap-1.5">
                {isBroken(base, selected) ? "Broken: fix" : "Fix"} · {acorns(fixCost(base, selected, now.day))}
              </span>
            </button>
          )}
          {selected === "oak" && sheet.level > 0 && (
            <button
              type="button"
              className={`tactile-button px-3 py-1.5 text-xs ${ready > 0 ? "is-ready" : ""}`}
              aria-disabled={ready === 0}
              onClick={() => {
                if (ready === 0) setWhyShown(`Nothing on it yet: it drops ${Math.round(oakDrops(base))} for every 10 minutes you read`);
                else gatherOak();
              }}
            >
              <span className="flex items-center gap-1.5">
                Collect · {acorns(gatherBrings(base, now.minutes, streak, now.day))}
              </span>
            </button>
          )}
          {selected === "fence" && sheet.level > 0 && (
            <button type="button" className="tactile-button px-3 py-1.5 text-xs" title="Slide the wall nearer the trees or nearer the camp" onClick={() => setArrange("fence")}>
              Slide the wall
            </button>
          )}
          {selected === "burrow" && onInside && (
            <button type="button" className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs" title="Pip's rooms, her things and the shop. A tap on the burrow's door goes in too." onClick={door.go}>
              <DoorOpen size={13} aria-hidden /> Pip's house
            </button>
          )}
          {yard?.kind && !job && (
            <button
              type="button"
              className="tactile-button px-3 py-1.5 text-xs"
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
        {whyShown && <p className="pip-sheet-why is-said">{whyShown}</p>}
        {/* An empty plot: each thing it could be, with what it does and costs. */}
        {yard && !yard.kind && (
          <ul className="pip-sheet-choices">
            {plotChoices(base, selected, now.mood).map((choice) => (
              <li key={choice.kind}>
                <Sprite name={choice.kind} variant={1} box={28} />
                <span className="min-w-0 flex-1">
                  <span className="pip-base-row-name">{choice.name}</span>
                  <span className="pip-sheet-now">{choice.does}</span>
                </span>
                <button
                  type="button"
                  className={`tactile-button tactile-button-primary px-2.5 py-1 text-xs font-semibold ${choice.why ? "is-blocked" : ""}`}
                  data-coach="build"
                  data-site={selected}
                  aria-disabled={choice.why !== null}
                  onClick={() => {
                    if (choice.why) {
                      setWhyShown(choice.why);
                      playSound("womp", { volume: 0.4 });
                      return;
                    }
                    build(choice.kind);
                  }}
                >
                  <span className="flex items-center gap-1">Build · {acorns(choice.price)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* (Each of the oak, the lookout and the hut used to take one of two paths at level 3. The choice is not offered since
            2026-10-15; a path already taken keeps what it does.) */}
        {guardRow()}
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
          <Lock size={14} aria-hidden /> Comes with chapter {CHAPTER_OF.decor}
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
  /** (1.5.11) The Blooms list: every finished book's bloom, the newest first, thirty at a time. */
  const bloomsCard = () => {
    const newest = [...blooms].reverse();
    return (
      <section className="pip-base-card mt-3" aria-live="polite">
        <h3 className="pip-base-title">
          Blooms
          <span className="pip-base-chip ml-2 align-middle">{blooms.length}</span>
        </h3>
        <ul className="pip-blooms-list">
          {newest.slice(0, bloomsShown).map((entry, index) => (
            <li key={`${entry.key}-${index}`}>
              <Sprite name="bloom" variant={entry.kind} box={20} />
              <span className="min-w-0 flex-1 truncate">
                <strong>{entry.title ?? "A book you finished"}</strong>
                {entry.author ? ` · ${entry.author}` : ""}
              </span>
              <span className="shrink-0 text-on-surface-variant">{BLOOM_NAMES[entry.kind]}</span>
            </li>
          ))}
        </ul>
        {newest.length > bloomsShown && (
          <button type="button" className="tactile-button mt-2 px-3 py-1 text-xs" onClick={() => setBloomsShown((shown) => shown + 30)}>
            {Math.min(30, newest.length - bloomsShown)} more
          </button>
        )}
      </section>
    );
  };

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
          const hearts = heartsOf(base, animal.id, now.minutes);
          const toNext = nextHeartIn(base, animal.id, now.minutes);
          return (
            <li key={animal.id}>
              <Sprite name="animal" variant={animal.id} box={36} className={here ? "" : "is-locked"} />
              <div className="min-w-0 flex-1">
                <p className="pip-base-person">
                  {animal.name}
                  {here && (
                    <span
                      className="pip-animal-hearts"
                      role="img"
                      aria-label={`${hearts} of ${HEARTS_MOST} hearts${toNext !== null ? `, ${hoursText(toNext)} more reading to the next` : ""}`}
                      title={`${hearts} of ${HEARTS_MOST}${toNext !== null ? ` · ${hoursText(toNext)} more reading` : ` · ${HOME_NAMES[animal.id]}, and ${FINERY_NAMES[animal.id]}`}`}
                    >
                      {Array.from({ length: HEARTS_MOST }, (_, at) => (
                        <span key={at} className={`pip-animal-heart ${at < hearts ? "" : "is-empty"}`} />
                      ))}
                    </span>
                  )}
                  {!here && (
                    <span className="pip-base-chip ml-2" title={`Comes when the camp's charm is ${animal.charm}`}>
                      <Sparkles size={11} aria-hidden /> {animal.charm}
                    </span>
                  )}
                </p>
                <p className="text-xs text-on-surface-variant">{here && hearts >= HEARTS_MOST ? FOND_DOES[animal.id] : animal.does}</p>
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

  // ---- a chip's card: what acorns are, what charm is (currency.ts) ----------------------------------------------------
  const lineIcon = (icon: CardLine["icon"]) =>
    icon === "read" ? <BookOpen size={13} aria-hidden /> :
    icon === "oak" ? <TreeDeciduous size={13} aria-hidden /> :
    icon === "parcel" ? <Package size={13} aria-hidden /> :
    icon === "streak" ? <Flame size={13} aria-hidden /> :
    icon === "list" ? <ListChecks size={13} aria-hidden /> :
    icon === "raid" ? <Swords size={13} aria-hidden /> :
    icon === "build" ? <Hammer size={13} aria-hidden /> :
    icon === "larder" ? <Warehouse size={13} aria-hidden /> :
    icon === "animal" ? <Heart size={13} aria-hidden /> :
    <Sparkles size={13} aria-hidden />;
  const hudCard = (card: ChipCard) => (
    <div className="pip-hud-card" role="dialog" aria-label={card.title}>
      <div className="pip-hud-card-head">
        <span className="pip-sheet-title">{card.title}</span>
        <button type="button" className="pip-ladder-close" aria-label="Close" onClick={() => setChipOpen(null)}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <p className="pip-hud-card-lead">{card.lead}</p>
      <p className="pip-sheet-label">{card.earnLabel ?? (card.spend ? "How you earn them" : "How it grows")}</p>
      <ul className="pip-hud-card-lines">
        {card.earn.map((line) => (
          <li key={line.text}>
            {lineIcon(line.icon)}
            <span>{line.text}</span>
          </li>
        ))}
      </ul>
      {card.spend && (
        <>
          <p className="pip-sheet-label">What they buy</p>
          <p className="pip-hud-card-text">{card.spend}</p>
        </>
      )}
      {!card.cap && card.more && (
        <p className="pip-sheet-keys">
          <button
            type="button"
            className="tactile-button px-2.5 py-1 text-xs"
            onClick={() => {
              setChipOpen(null);
              setTab("camp");
              setArea("camp");
              choose("store");
            }}
          >
            The larder
          </button>
        </p>
      )}
      {card.cap && (
        <p className="pip-hud-card-cap">
          <Warehouse size={13} aria-hidden />
          <span className="min-w-0 flex-1">{card.cap}</span>
          {card.more && (
            <button
              type="button"
              className="tactile-button px-2.5 py-1 text-xs"
              onClick={() => {
                setChipOpen(null);
                setTab("camp");
                setArea("camp");
                choose("store");
              }}
            >
              Larder
            </button>
          )}
        </p>
      )}
    </div>
  );

  // ---- the three pointers, once (mapCoach.ts) -------------------------------------------------------------------
  const coach = tab === "camp" && area === "camp" && !arrange && !placing && coachDue(base) ? coachSteps(Boolean(lay.pan)) : [];
  const coachStep = coach[coachAt] ?? null;
  const coachDone = () => {
    store.learn(MAP_COACH);
    setCoachAt(0);
  };
  const coachMark = () => {
    if (!coachStep) return null;
    const root = rootRef.current;
    if (!root) return null;
    const frame = root.getBoundingClientRect();
    // Where a bubble may go: under the row along the top and above the keys at the foot (both clear of the system's
    // bars already), 8 px from each.
    const head = root.querySelector(".pip-base-stats")?.getBoundingClientRect();
    const dock = root.querySelector(".pip-base-under")?.getBoundingClientRect();
    const roof = (head ? head.bottom - frame.top : 48) + 10;
    const floor = (dock ? dock.top - frame.top : frame.height - 50) - 10;
    const TALL = 92;
    const HALF = 120;
    // "Drag to look around": up in the sky over the trees, where it covers nothing of the camp.
    let left = frame.width / 2;
    let top = Math.max(roof + TALL / 2, frame.height * 0.3);
    let under = false;
    /** Beside the building, where there is no room above it or under it: which side the bubble is on. */
    let beside: "left" | "right" | null = null;
    if (coachStep.id === "tap") {
      // A building that is built and in view, the nearest the middle: the bubble points down at it (or up, from under
      // it, where there is no room above).
      const scale = fit.css;
      const shown = sitesStanding(base)
        .filter((site) => levelOf(base, site) > 0)
        .map((site) => {
          const box = siteBox(site, base.spots[site]);
          const x = (box.x - (lay.pan ? cam.current.x : 0)) * scale;
          const y = (box.y + lay.sky - (lay.pan ? cam.current.y : 0)) * scale;
          return { x, y, w: box.w * scale, h: box.h * scale };
        })
        .filter((box) => box.x >= 0 && box.x + box.w <= frame.width && box.y >= roof && box.y + box.h <= floor)
        .sort((a, b) => Math.hypot(a.x + a.w / 2 - frame.width / 2, a.y - frame.height / 2) - Math.hypot(b.x + b.w / 2 - frame.width / 2, b.y - frame.height / 2));
      // Of the places the bubble could go (above the building, under it, to its right or left), the first that fits
      // the room and covers no other building; failing that, the first that fits.
      type Spot = { left: number; top: number; under: boolean; beside: "left" | "right" | null; rect: { x: number; y: number; w: number; h: number } };
      const spotsFor = (box: (typeof shown)[number]): Spot[] => {
        const middle = box.x + box.w / 2;
        const across = Math.max(HALF + 8, Math.min(frame.width - HALF - 8, middle));
        const mid = Math.max(roof + TALL / 2, Math.min(floor - TALL / 2, box.y + box.h / 2));
        return [
          { left: middle, top: box.y - 10, under: false, beside: null, rect: { x: across - HALF, y: box.y - 10 - TALL, w: HALF * 2, h: TALL } },
          { left: middle, top: box.y + box.h + 10, under: true, beside: null, rect: { x: across - HALF, y: box.y + box.h + 10, w: HALF * 2, h: TALL } },
          { left: box.x + box.w + 12, top: mid, under: false, beside: "right" as const, rect: { x: box.x + box.w + 12, y: mid - TALL / 2, w: HALF * 2, h: TALL } },
          { left: box.x - 12, top: mid, under: false, beside: "left" as const, rect: { x: box.x - 12 - HALF * 2, y: mid - TALL / 2, w: HALF * 2, h: TALL } }
        ].filter((spot) => spot.rect.y >= roof - 0.5 && spot.rect.y + spot.rect.h <= floor + 0.5 && spot.rect.x >= 8 && spot.rect.x + spot.rect.w <= frame.width - 8);
      };
      const hits = (rect: Spot["rect"], others: typeof shown) =>
        others.some((other) => rect.x < other.x + other.w && rect.x + rect.w > other.x && rect.y < other.y + other.h && rect.y + rect.h > other.y);
      let found: Spot | null = null;
      for (const box of shown) {
        const clear = spotsFor(box).find((spot) => !hits(spot.rect, shown.filter((other) => other !== box)));
        if (clear) {
          found = clear;
          break;
        }
      }
      found ??= shown.length > 0 ? (spotsFor(shown[0])[0] ?? null) : null;
      if (found) {
        left = found.left;
        top = found.top;
        under = found.under;
        beside = found.beside;
      }
    } else if (coachStep.id === "acorns" && acornChipRef.current) {
      const chip = acornChipRef.current.getBoundingClientRect();
      left = chip.left + chip.width / 2 - frame.left;
      top = chip.bottom - frame.top + 10;
      under = true;
    }
    // Kept whole inside the room: the top of the bubble never above the roof, its foot never below the floor.
    const placedTop =
      coachStep.id === "drag" || beside
        ? Math.max(roof + TALL / 2, Math.min(floor - TALL / 2, top))
        : under
          ? Math.max(roof - (coachStep.id === "acorns" ? 10 : 0), Math.min(floor - TALL, top))
          : Math.max(roof + TALL, Math.min(floor, top));
    const last = coachAt >= coach.length - 1;
    return (
      <div
        className={`pip-coach-mark ${under ? "is-under" : ""} ${beside ? `is-beside-${beside}` : ""} is-${coachStep.id}`}
        style={{ left: beside ? left : Math.max(HALF + 8, Math.min(frame.width - HALF - 8, left)), top: placedTop }}
        role="status"
      >
        <span className="pip-coach-mark-text">
          {coachStep.id === "drag" && <Move size={13} aria-hidden />}
          {coachStep.text}
        </span>
        <span className="pip-coach-mark-keys">
          <span className="pip-coach-mark-count" aria-hidden="true">
            {coachAt + 1}/{coach.length}
          </span>
          {!last && (
            <button type="button" className="pip-coach-mark-skip" {...tapKey(coachDone)}>
              Skip
            </button>
          )}
          <button
            type="button"
            className="tactile-button tactile-button-primary px-2.5 py-0.5 text-xs font-semibold"
            // Pressed on the finger's release, a long tap too (onboarding/tapKey.ts).
            {...tapKey(() => {
              playSound("click");
              if (last) coachDone();
              else setCoachAt(coachAt + 1);
            })}
          >
            {last ? "Got it" : "Next"}
          </button>
        </span>
      </div>
    );
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
      style={
        lay.pan && lay.view
          ? { width: lay.view.w, height: lay.view.h }
          : lay.mode === "stage"
            ? { width: GAME_W * fit.css, height: (GAME_H + lay.sky + lay.ground - lay.crop) * fit.css }
            : undefined
      }
    >
      <HollowTop
        chapter={chapterChip}
        chapterHidden={tourOn && tourStep !== STEP.bridge}
        chapterOpen={chapterOpen}
        onChapter={() => {
          setChipOpen(null);
          setChapterOpen((was) => !was);
          playSound("click");
        }}
        acorns={base.acorns}
        acornCue={acornCue}
        acornChipRef={acornChipRef}
        trailsRef={trailsRef}
        fillFrom={barFrom}
        gained={gained}
        onAcorns={() => openGuide("acorns")}
        parcels={base.parcels}
        onParcels={() => {
          setChipOpen(null);
          openParcels();
        }}
        guideOpen={tab === "journal"}
        onGuide={() => {
          if (tab === "journal") setTab("camp");
          else openGuide(null);
          playSound("click");
        }}
        sound={sound}
        onSound={setSound}
        onPostcard={campOpened(base, now.minutes, "postcard") ? () => setPostcard(true) : null}
        onArcade={onArcade ?? null}
        onHouse={onInside ? () => useCoachStore.getState().askEnter() : null}
        nav={nav}
        night={
          nightShown && tab === "camp" && area === "camp" ? (
            <NightChip
              counts={nightShown.counts}
              left={nightShown.left}
              open={nightOpen}
              onOpen={() => {
                setChipOpen(null);
                setNightOpen((was) => !was);
                playSound("click");
              }}
            />
          ) : null
        }
      >
        {nightOpen && nightShown && tab === "camp" && (
          <NightCard
            counts={nightShown.counts}
            placed={base.works.map((entry) => entry.kind)}
            onClose={() => setNightOpen(false)}
            onFront={() => {
              setNightOpen(false);
              openShelf("defence");
            }}
          />
        )}
        {tab === "camp" && (
          <div className="pip-camp-say">
            <PipFace skin={skin} outfit={outfit} box={lay.mode === "side" ? 36 : 52} move={next.full ? "idea" : told !== null ? "idea" : "idle"} className="pip-camp-say-face" />
            {/* Three lines at most: a tip when one is due (or the book a tapped trophy stands for), the one next thing, and the parcels. What has gone wrong is said while it is so. */}
            <div className="pip-camp-say-bubble" role="status">
              {/* (A friend's raid used to leave the fence to be mended by reading, said here. Since 1.5.8 there is nothing to mend.) */}
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
              {meadowSay && area === "meadow"
                ? (() => {
                    const bloom = meadowSay.kind === "bloom" ? blooms[meadowSay.index] : null;
                    const waits = trophyWaits(base, now.minutes);
                    const text =
                      meadowSay.kind === "stone"
                        ? meadowSay.text
                        : meadowSay.kind === "bud"
                          ? waits > 0
                            ? `Your next bloom · ${hoursText(waits)} more reading`
                            : "Your next bloom: finish a book and it opens"
                          : null;
                    return (
                      <p className="pip-camp-say-line">
                        {bloom ? <Sprite name="bloom" variant={bloom.kind} box={20} /> : meadowSay.kind === "bud" ? <Sprite name="bud" variant={look?.bud ?? 0} box={20} /> : <Sprite name="standing" variant={1} box={20} />}
                        <span className="min-w-0 flex-1 truncate">
                          {bloom ? (
                            <>
                              <strong>{bloom.title ?? "A book you finished"}</strong>
                              {bloom.author ? ` · ${bloom.author}` : ""}
                              {bloom.on ? ` · ${new Date(bloom.on).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                            </>
                          ) : (
                            text
                          )}
                        </span>
                        <button type="button" className="tactile-button px-2 py-0.5 text-xs" aria-label="Close" onClick={() => setMeadowSay(null)}>
                          <X size={12} aria-hidden />
                        </button>
                      </p>
                    );
                  })()
                : shownTrophy
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
                    // (1.5.10) The map's three pointers are folded into the first tip: one line, said once, with it.
                    const coach = coachDue(base) && !tourOn && Boolean(lay.pan);
                    const tip = tourOn ? null : tipNow(base);
                    if (!tip && !coach) return null;
                    const id = tip?.id ?? MAP_COACH;
                    if (tipOfVisit.current !== null && tipOfVisit.current !== id) return null;
                    tipOfVisit.current = id;
                    const lead = coach ? "Drag to look around." : "";
                    return (
                      <p className="pip-camp-say-line pip-camp-tip">
                        <Lightbulb size={14} className="shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1">{[lead, tip?.text ?? ""].filter(Boolean).join(" ")}</span>
                        <span className="pip-camp-tip-keys">
                          <button
                            type="button"
                            className="tactile-button tactile-button-primary px-2.5 py-0.5 text-xs font-semibold"
                            onClick={() => {
                              if (tip) store.learn(tip.id);
                              if (coach) store.learn(MAP_COACH);
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
                    onClick={(event) => {
                      const from = centreOf(event.currentTarget);
                      const before = useBaseStore.getState().base?.acorns ?? base.acorns;
                      store.raise(raisable.id, raisable.title, raisable.genres);
                      playSound("fanfare", { volume: 0.7 });
                      acornsIn(from, Math.min(TROPHY_GIVES, (useBaseStore.getState().base?.acorns ?? before) - before));
                    }}
                  >
                    Raise its trophy {acorns(`+${TROPHY_GIVES}`)}
                  </button>
                </p>
              ) : (
                // Pip's list is the goal ladder's chip now; once the list is done, what to do next is said here.
                base.quest >= QUESTS.length &&
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
              ) : null}
              {/* (The parcels waiting are a chip along the top since 1.5.8: here they stood over the picture, and came back.) */}
            </div>
          </div>
        )}
      </HollowTop>

      {(() => {
        const news = tab === "camp" && !tourOn ? chapterNewsOf(base, now.minutes) : null;
        // (1.5.11) A chapter crossed while the reading's pages come up the path: its card waits for them (or a tap).
        const shown = news && news.chapter > celebrated && !arriving?.arrival.crossed ? news : null;
        if (!shown && !chapterOpen) {
          const raids = newsOf(base);
          if (tab !== "camp" || tourOn || newsClosed || raids.length === 0 || raid) return null;
          const done = () => {
            seeNews();
            setNewsClosed(true);
          };
          return (
            <FriendNews
              news={raids}
              canPutBack={base.downed.length > 0}
              onPutBack={() => {
                putBack();
                playSound("place");
                done();
              }}
              onRaidBack={
                base.levels.hut > 0
                  ? () => {
                      done();
                      setTab("raids");
                      playSound("click");
                    }
                  : null
              }
              onClose={done}
            />
          );
        }
        return (
          <ChapterCard
            view={chapterCardOf(base, now.minutes)}
            news={shown}
            since={since}
            onGo={(at) => {
              if (shown) {
                setCelebrated(shown.chapter);
                seeChapter();
              }
              goTo(at);
            }}
            onChest={(from, got) => {
              const chip = acornChipRef.current;
              const to = centreOf(chip?.querySelector(".pip-sprite") ?? chip);
              const lands = to ? (trailsRef.current?.send(centreOf(from) ?? to, to, got) ?? null) : null;
              acornsSound(got, lands ? lands.first - performance.now() : 0);
              if (lands) window.setTimeout(() => bumpCount(chip?.querySelector(".pip-acorn-count") ?? null), Math.max(0, lands.first - performance.now()));
            }}
            onClose={() => {
              if (shown) {
                setCelebrated(shown.chapter);
                seeChapter();
              }
              setChapterOpen(false);
            }}
          />
        );
      })()}

      {/* (1.5.11) The reading's pages coming up the path, and what came of it, said for a screen reader. */}
      <PageTrails ref={pagesRef} />
      <p className="sr-only" aria-live="polite">
        {arrivalSaid}
      </p>

      {postcard && look && (
        <Suspense fallback={null}>
          <HollowPostcard
            art={art}
            // (1.5.11) Of the clearing being looked at: the meadow, with its blooms and stones, makes a postcard too.
            look={{ ...look, area }}
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
              // A window onto the clearing, the screen's size (a phone's camera), or the whole of it.
              width={view ? Math.ceil(view.w * fit.backing) : GAME_W * fit.backing}
              height={view ? Math.ceil(view.h * fit.backing) : Math.round((GAME_H + lay.sky + lay.ground) * fit.backing)}
              className={`${fit.crisp ? "pip-sprite " : ""}pip-arcade-canvas${placing || arrange ? " is-placing" : ""}${lay.pan ? " is-camera" : ""}`}
              // A cut sky is above the page's top edge: the canvas keeps the whole clearing, and where a touch lands is read from it.
              style={
                view
                  ? { width: (Math.ceil(view.w * fit.backing) / fit.backing) * fit.css, height: (Math.ceil(view.h * fit.backing) / fit.backing) * fit.css }
                  : { width: GAME_W * fit.css, height: (GAME_H + lay.sky + lay.ground) * fit.css, marginTop: lay.crop ? -lay.crop * fit.css : undefined }
              }
              aria-hidden="true"
              // For the guided session to find things in the picture by (onboarding/geometry.ts): the sky above the clearing,
              // and where the camera is a window onto it, how many CSS pixels to the art pixel (the camera's place is set as it moves).
              data-sky={lay.sky}
              data-scale={view ? fit.css : undefined}
              data-area={area}
              onPointerDown={pressDown}
              onPointerUp={pressUp}
              onPointerCancel={() => {
                const was = press.current;
                press.current = null;
                if (was?.hold !== undefined) window.clearTimeout(was.hold);
                // A drag of the camera taken over by the system: whatever it is past the edge springs back.
                if (was?.panning) glide.current = { ...cam.current, vx: 0, vy: 0 };
              }}
              onDoubleClick={enter}
              // A long press is a hold (to move what is under it), never the system's own menu.
              onContextMenu={(event) => event.preventDefault()}
              onPointerMove={pressMove}
              onPointerLeave={() => {
                hovered.current = null;
                resting.current = null;
                if (arrange === "fence") pointer.current = null;
              }}
            />
          </div>

          {/* The camera has been moved: a key to bring it home (as a double tap on open ground does). */}
          {lay.pan && away && tab === "camp" && (
            <button type="button" className="pip-base-round pip-base-home" aria-label="Back to the middle of the camp" title="Back to the middle of the camp" onClick={goHome}>
              <LocateFixed size={15} aria-hidden />
            </button>
          )}
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
          {!raid && <HollowDock
            dock={
              arrange || decorEdit
                ? {
                    where: "edit",
                    mode: decorEdit ? "decor" : (arrange ?? "move"),
                    onMode: editMode,
                    fence: base.levels.fence,
                    piecesLeft,
                    // (A gate was a piece made a gate by hand until 1.5.11. It is where the trail meets the wall now.)
                    gate: null,
                    decorOpen: decorOpen(base),
                    status: carrying
                      ? `Where should the ${siteName(base, carrying).toLowerCase()} stand?`
                      : decorEdit
                        ? "Drag a decoration onto the grass"
                        : arrange === "fence"
                          ? "Drag the wall along the trail"
                          : "Drag a building to move it",
                    onDone: leaveEdit
                  }
                : area === "meadow"
                  ? {
                      where: "meadow",
                      onCamp: () => goArea("camp"),
                      animals: {
                        count: base.animals.length,
                        of: ANIMALS.length,
                        last: base.animals[base.animals.length - 1] ?? 0,
                        chosen: panelOpen && panel === "site" && chosenDecor < 0,
                        onOpen: () => {
                          setPanel("site");
                          setChosenDecor(-1);
                          playSound("click");
                        }
                      },
                      decor: {
                        chosen: panelOpen && panel === "decor" && chosenDecor < 0,
                        onOpen: () => {
                          setPanel("decor");
                          setChosenDecor(-1);
                          playSound("click");
                        }
                      },
                      blooms: {
                        count: blooms.length,
                        last: blooms[blooms.length - 1]?.kind ?? 0,
                        chosen: panelOpen && panel === "blooms",
                        onOpen: () => {
                          setBloomsShown(30);
                          setPanel("blooms");
                          playSound("click");
                        }
                      }
                    }
                  : {
                      where: "camp",
                      buildOpen: buildOpen,
                      onBuild: () => openShelf(buildTab),
                      buildMark: nudge !== null && nudge !== "raids" && nudge !== "meadow" && nudge !== "arrange" && nudge !== "decor" ? "nudge" : ready > 0 ? "waiting" : null,
                      raid:
                        base.levels.hut > 0
                          ? {
                              open: tab === "raids",
                              rested,
                              nudge: nudge === "raids",
                              onRaid: () => {
                                setTab(tab === "raids" ? "camp" : "raids");
                                playSound("click");
                              }
                            }
                          : null,
                      onEdit: campOpened(base, now.minutes, "arrange") ? () => editMode(base.levels.fence > 0 && piecesLeft > 0 ? "fence" : "move") : null,
                      editMark: nudge === "arrange" || nudge === "decor"
                    }
            }
            after={
              placing && !carriedOff ? (
                <p className="pip-base-chip mt-2" role="status">
                  Where should the {(placing.what === "land" ? SCENERY[placing.kind].name : placing.what === "work" ? WORKS[placing.kind].name : DECOR[placing.kind].name).toLowerCase()} go?
                  <button type="button" className="tactile-button ml-2 px-2.5 py-0.5 text-xs" onClick={() => setPlacing(null)}>
                    Never mind
                  </button>
                </p>
              ) : null
            }
          />}

          {tab === "camp" && panelOpen && (!placing || carriedOff) && !arrange && (
          <div
            className={`pip-base-side${carriedOff ? " is-carried" : ""}`}
            data-side={lay.mode === "stage" ? side : undefined}
            data-list={listOpen && shelf ? "" : undefined}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setPanelOpen(false);
              }
            }}
          >
            <div className="pip-base-side-bar">
              {fromList && !listOpen && shelf && (
                <button
                  type="button"
                  className="pip-base-round pip-base-side-back"
                  aria-label="Back to the list"
                  title="Back to the list"
                  onClick={() => {
                    setListOpen(true);
                    setFromList(false);
                    setChosenDecor(-1);
                    setChosenLand(-1);
                    setWhyShown(null);
                    chosenWork.current = null;
                    playSound("click");
                  }}
                >
                  <ChevronLeft size={16} aria-hidden />
                </button>
              )}
              <button type="button" className="pip-base-round pip-base-side-close" aria-label="Close" title="Close" onClick={() => setPanelOpen(false)}>
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="pip-base-side-scroll">
          {listOpen && shelf ? (
            <div key={`shelf-${shelf}`} className="pip-base-enter">
              {!decorEdit && (
                <BuildTabs
                  tab={shelf}
                  shown={BUILD_TABS.map((entry) => entry.id).filter((id) => id !== "decor" || decorOpen(base))}
                  marks={{
                    camp: nudge !== null && SHELF_SITES.camp.includes(nudge as Site),
                    defence: nudge !== null && SHELF_SITES.defence.includes(nudge as Site)
                  }}
                  onTab={(to) => openShelf(to, false)}
                />
              )}
              {shelf === "camp" ? campList() : shelf === "defence" ? defenceList() : shelf === "people" ? peopleList() : decorCard(true)}
              {whyShown && <p className="pip-sheet-why is-said">{whyShown}</p>}
            </div>
          ) : (
          <div key={chosenLand >= 0 ? `land-${chosenLand}` : chosenDecor >= 0 ? `thing-${chosenDecor}` : panel === "site" ? `${selected}-${chosenWork.current ?? ""}` : panel === "guard" ? `guard-${chosenGuard}` : panel} className="pip-base-enter">
          {chosenLand >= 0 && lands[chosenLand] && !placing ? (
            landCard()
          ) : chosenDecor >= 0 && things[chosenDecor] ? (
            <section className="pip-base-card pip-sheet">
              <header className="pip-sheet-head">
                <span className="pip-sheet-pic">
                  <Sprite name="decor" variant={things[chosenDecor].kind} box={36} />
                </span>
                <span className="min-w-0 flex-1">
                  <h3 className="pip-sheet-title">{DECOR[things[chosenDecor].kind].name}</h3>
                  <span className="pip-sheet-now">Charm +{DECOR[things[chosenDecor].kind].charm}</span>
                </span>
              </header>
              <div className="pip-sheet-keys">
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
            decorCard()
          ) : panel === "garden" && area === "camp" ? (
            gardenCard()
          ) : panel === "guard" && area === "camp" ? (
            guardCard()
          ) : area === "meadow" && panel === "blooms" ? (
            bloomsCard()
          ) : area === "meadow" ? (
            animalsCard()
          ) : panel === "people" ? (
            peopleCard()
          ) : chosenWork.current !== null ? (
            workCard(chosenWork.current)
          ) : (
            siteCard()
          )}
          </div>
          )}
            </div>
          </div>
          )}

      {raid ? (
        // (The Magpie Lands, 2026-10-24) A raid fills the picture as the map does: scout, plan, fight, end.
        <RaidFlow
          key={JSON.stringify(raid.aim.kind === "friend" ? raid.aim.target.handle : raid.aim.target)}
          base={base}
          now={now}
          art={art}
          season={season}
          aim={raid.aim}
          sent={raid.sent}
          why={(blocked, plan) => WHY_NO_RAID[blocked](base, plan, now)}
          onScouted={(n) => store.markScouted(n)}
          onStart={(aim, squad) => (aim.kind === "friend" ? store.startFriendRaid(aim.target.camp, { handle: aim.target.handle, name: aim.target.name }, squad) : store.startRaid(aim.target.kind, aim.target.slot, false, squad))}
          onFinish={(begun, result) => {
            if ("friend" in begun) {
              // A friend's camp: the prize is the game's, and the friend is told who came and how it went.
              const friendly = begun as FriendRaid;
              void socialService.reportRaid(friendly.friend.handle, result.stars).catch(() => undefined);
              setTargets((list) => list?.map((target) => (target.handle === friendly.friend.handle ? { ...target, raidedToday: true } : target)) ?? list);
              return store.finishFriendRaid(friendly, result);
            }
            return store.finishRaid(begun, result);
          }}
          onLoot={(from, loot) => acornsIn(centreOf(from), loot)}
          onClose={() => {
            setRaid(null);
            setTab("raids");
          }}
        />
      ) : tab === "raids" && (
        // (The Magpie Lands, 2026-10-24) The raid key opens the map; it was the raid board (RaidBoard.tsx).
        <LandsMap
          base={base}
          now={now}
          art={art}
          rested={rested}
          restIn={restIn(base, now.minutes)}
          why={(blocked, plan) => WHY_NO_RAID[blocked](base, plan, now)}
          // (What a Send brought is on the raid's end card now.)
          sent={null}
          // The one hand-off to the raid: what the map chose is scouted first; nothing is spent until "Go".
          onRaid={(target) => setRaid({ aim: { kind: "stronghold", target }, sent: null })}
          // Sent without the reader: its result on the raid's own end card (the loot flies home from there).
          onSend={(target) => {
            const came = store.sendRaid(target.kind, target.slot);
            if (came) setRaid({ aim: { kind: "stronghold", target }, sent: came });
          }}
          onHut={() => {
            setTab("camp");
            setArea("camp");
            setBuildTab("defence");
            choose("hut");
          }}
          onClose={() => setTab("camp")}
          heroes={{
            here: (id) => heroHere(base, id),
            asleep: (id) => asleepUntil(base, 100 + id, minute) > 0,
            onChoose: (id) => {
              store.chooseHero(id);
              playSound(id === null ? "click" : "squeak", { pitch: 0.7 + ((id ?? 0) % 5) * 0.12 });
            }
          }}
          friends={
            signedIn && FEATURES.community
              ? {
                  asked: raidsAsked(base),
                  mayRaid,
                  onMayRaid: (on) => {
                    setMayRaid(on);
                    askedRaids();
                    socialService.setRaidable(on).catch(() => setMayRaid(!on));
                  },
                  targets,
                  blocked: (target) => {
                    const why = target.raidedToday ? "today" : friendBlocked(base, now, target.handle);
                    return why === "today" ? "Raided today. More tomorrow." : why === "rest" ? "The scouts are resting" : why ? "Not now" : null;
                  },
                  onRaid: (target) => setRaid({ aim: { kind: "friend", target }, sent: null }),
                  scouts: scoutsOf(base)
                }
              : null
          }
        />
      )}

      {tab === "journal" && (
        <HollowGuide
          base={base}
          minutes={now.minutes}
          page={guidePage as GuidePage | null}
          onPage={(page) => {
            setGuidePage(page);
            playSound("click");
          }}
          onClose={() => setTab("camp")}
          happened={
            <>
          <ReplayTour onStart={() => setTab("camp")} />
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
                      onClick={(event) => {
                        const from = centreOf(event.currentTarget);
                        const before = useBaseStore.getState().base?.acorns ?? base.acorns;
                        store.claimClub(club.id, week, boss.reward);
                        playSound("fanfare", { volume: 0.7 });
                        acornsIn(from, Math.min(boss.reward, (useBaseStore.getState().base?.acorns ?? before) - before));
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
            </>
          }
        />
      )}
    </div>
  );
};
