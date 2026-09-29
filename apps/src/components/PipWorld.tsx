import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { usePipStore } from "../store/pipStore";
import { ownedPremiumMoves, useEquippedPip, usePipWardrobeStore } from "../store/pipWardrobeStore";
import { useHabitStore } from "../store/habitStore";
import { pickBeat } from "../pip/moments";
import { nodFor } from "../pip/bookNods";
import { hasMove } from "../pip/core";
import { TOUR, type TourStop } from "../pip/tour";
import { usePipPresence } from "../pip/usePipPresence";
import { PipSprite, pipCssSize } from "./PipSprite";
import { PipSay, type PipSayTail } from "./PipSay";

/**
 * Where Pip lives: a layer over the whole window.
 *
 * There is one Pip, and its home is the logo in the header. It flips out of the
 * logo and drops into the app, walks along the bottom of the window and along
 * the tops of cards (riding them as the page scrolls), and can be picked up by
 * the leaf and thrown. It tumbles, bounces off the edges of the window, clings
 * to a wall if it hits one hard, splats if it lands hard, and goes home if it
 * is thrown back up into the logo. Right-click it for shortcuts. It also gives
 * the tour: it jumps from thing to thing, stands on each, and points.
 *
 * While a book or a session wrap-up is open, Pip is there instead (the reader
 * peek, the wrap-up card), so this one steps aside: one Pip on screen, always.
 *
 * Physics runs in a requestAnimationFrame loop on refs and writes transforms
 * straight to the DOM; React state only changes when Pip changes what it is
 * doing, so a thrown Pip never re-renders the app sixty times a second.
 *
 * Two layers, chosen by what Pip is doing:
 * - Standing or walking on a card, Pip lives inside the page's scroll area,
 *   so it scrolls with the card on the compositor. Positioned from script, it
 *   always trailed a scroll by a frame, which read as lag.
 * - Anywhere else it lives in a fixed layer over the window. That layer sits
 *   below the sidebar and header while Pip is at rest (the sidebar opens over
 *   it), and above everything while Pip is carried, flying, or giving the tour.
 */

export type PipAction = { id: string; label: string; run: () => void };

const SPRITE = 64;
const GRAVITY = 2600;
const WALK_SPEED = 46;
/** Collision half-width and height of Pip's body at 64px, in CSS pixels. */
const HALF_W = 18;
const HEIGHT = 50;
/** Where the hand holds Pip: by the leaf, so Pip dangles below the cursor. */
const HOLD_DROP = 44;
/** The collapsed sidebar's width (index.css). Pip's left wall. */
const SIDEBAR_COLLAPSED = 78;
const MAX_THROW = 2800;
const SPLAT_SPEED = 1300;
const BOUNCE_SPEED = 520;
const CLING_SPEED = 950;
/**
 * Held by the leaf, Pip is a pendulum hanging from the cursor. This is the
 * effective length in CSS pixels: longer than the sprite, so the swing has
 * weight (a period of about a second) rather than a nervous wobble.
 */
const SWING_LENGTH = 70;
const SWING_DAMPING = 1.1;
/** How quickly a spin carried into a throw dies away, per second. */
const SPIN_DAMPING = 0.9;
/** Web-slinging: reeling in toward a card, and the shortest rope before the hop. */
const WEB_REEL = 170;
const WEB_MIN = 26;
/** The web flies out this long before Pip is pulled along it. */
const WEB_SHOT_MS = 260;
/** Between things to do while resting. */
const IDLE_MIN_MS = 3500;
const IDLE_JITTER_MS = 5500;
/**
 * Dizziness. Spinning and shaking Pip fills a meter; at 1 it staggers about
 * once it is back on its feet. About three full turns, or a second or two of
 * hard shaking, gets there. The meter drains slowly while Pip is left alone.
 */
const DIZZY_PER_RADIAN = 1 / (6 * Math.PI);
/** Cursor acceleration (px/s²) above this counts as shaking. */
const SHAKE_FLOOR = 8000;
const DIZZY_PER_SHAKE = 0.35 / SHAKE_FLOOR;
const DIZZY_DRAIN = 0.15;
const DIZZY_MAX = 2.5;
const WOOZY = [
  "the room is spinning.",
  "which way is up?",
  "i see three of you.",
  "whoa. whoa. whoaaa.",
  "never again. (again?)",
  "my leaf is on backwards."
];

/** Quick, one-loop things Pip does in place. */
const FIDGETS = ["look", "stretch", "tap", "idea", "hydrate", "yawn"];
/**
 * What the hour suggests: coffee in the morning, lunch, tea at dusk, and a bed
 * pulled out of thin air late at night.
 */
const hourlyPastime = (hour = new Date().getHours()) =>
  hour >= 5 && hour < 10
    ? "coffee"
    : hour >= 12 && hour < 14
      ? "sandwich"
      : hour >= 18 && hour < 22
        ? "tea"
        : hour >= 22 || hour < 5
          ? "bedtime"
          : null;

/**
 * Longer pastimes, played for a couple of loops. These are free; the cooler
 * moves (cycling, surfing, air guitar, disco, magic...) are sold on the Pip tab
 * and join this list once owned (see `hobbies`). Celebrations still use any
 * move: a reader never pays for Pip to cheer them on.
 */
const FREE_HOBBIES = ["jog", "rope", "tree", "read", "speedread"];

type Phase =
  | "home"
  | "emerging"
  | "going-home"
  | "idle"
  | "walking"
  | "held"
  | "flying"
  | "clinging"
  | "landing"
  | "splat"
  | "recover"
  | "reacting"
  | "traveling"
  | "guiding"
  | "playing"
  | "webbing"
  | "perched"
  | "napping"
  | "waking";

/**
 * Phases in which Pip's position changes from frame to frame. Only these (and
 * a hop in progress, or a drag) run the loop at the display's frame rate; at
 * rest, perched, home or hidden, it checks in a few times a second instead.
 * It used to run at 60 Hz or more whenever Pip was on, measuring the page on
 * every frame even while he slept in the logo.
 */
const MOVING = new Set<Phase>([
  "held",
  "flying",
  "walking",
  "clinging",
  "traveling",
  "guiding",
  "webbing",
  "emerging",
  "going-home"
]);
/** How often the loop checks in while nothing moves. */
const REST_MS = 250;

/**
 * A web: where it is stuck (read each frame, since a card can scroll), the
 * rope's length and angle from straight down, and the card to climb onto, or
 * null for a swing from the header that ends in a leap.
 */
type Web = {
  anchor: () => { x: number; y: number } | null;
  target: Element | null;
  length: number;
  phi: number;
  omega: number;
  shotAt: number;
  startedAt: number;
  halfSwings: number;
};

type Ground = { kind: "floor" } | { kind: "ledge"; el: Element };
type Bounds = { left: number; right: number; top: number; floor: number };
type View = { move: string; loops?: number; key: string | number; flip: boolean; visible: boolean; still?: boolean };

/**
 * The quiet perch: set Pip down over the logo corner of the header and it
 * sits in its own spot in the logo, perfectly still and silent, until picked up again. Remembered
 * across launches. For readers who want Pip around but not doing anything.
 */
const PERCH_KEY = "leaflet.pip.perched";
const readPerched = () => {
  try {
    return localStorage.getItem(PERCH_KEY) === "1";
  } catch {
    return false;
  }
};
const writePerched = (on: boolean) => {
  try {
    if (on) {
      localStorage.setItem(PERCH_KEY, "1");
    } else {
      localStorage.removeItem(PERCH_KEY);
    }
  } catch {
    // Only means the perch is forgotten on the next launch.
  }
};

/**
 * Where Pip sits on the perch: its own spot in the logo, the outline it jumped
 * out of, standing exactly where the logo draws it. (It used to sit to the
 * right of the wordmark, which read as "somewhere else", not "back in its spot".)
 * `zone` is the brand corner a drop counts over: the logo and the wordmark.
 */
const readPerch = () => {
  const home = readHome();
  if (!home) {
    return null;
  }
  const mark = document.querySelector<HTMLElement>(".leaflet-wordmark");
  const markRect = mark && mark.offsetParent !== null ? mark.getBoundingClientRect() : null;
  const zone =
    markRect && markRect.width > 0
      ? new DOMRect(
          Math.min(home.rect.left, markRect.left),
          Math.min(home.rect.top, markRect.top),
          Math.max(home.rect.right, markRect.right) - Math.min(home.rect.left, markRect.left),
          Math.max(home.rect.bottom, markRect.bottom) - Math.min(home.rect.top, markRect.top)
        )
      : home.rect;
  return { x: home.x, y: home.y, zone };
};
/**
 * Whether letting go with the pointer at (x, y) sets Pip on the perch.
 *
 * The whole brand corner counts: the logo, the wordmark and a little to their
 * right, from the top of the window to a finger's width below the header.
 * Pip hangs below the pointer, so a reader aiming his body at the spot has the
 * pointer above it; with no top edge, that always lands. It used to be a thin
 * box around the wordmark alone, and a drop on the logo missed it entirely.
 */
const overPerch = (x: number, y: number) => {
  const perch = readPerch();
  if (!perch) {
    return false;
  }
  return x >= perch.zone.left - 24 && x <= perch.zone.right + 40 && y <= perch.zone.bottom + 44;
};
/**
 * Faster than this at release is a throw, not a placing. People let go while
 * still moving (a steady drag reads 1000+ px/s), so the bar sits well above
 * that; it was 700, which turned most real drops into throws.
 */
const PLACE_SPEED = 1600;
type Say = { text: string; id: number; kind: "line" | "tour" | "menu" };
type Perch = { x: number; y: number; pose: string; facing: number; rect: DOMRect | null };
type Tween = { x0: number; y0: number; t0: number; dur: number; arc: number; target: () => { x: number; y: number }; done: () => void };

/** What Pip can be doing when the sidebar opens on it and still be flung clear. */
const FLINGABLE = new Set<Phase>([
  "idle",
  "walking",
  "landing",
  "reacting",
  "playing",
  "splat",
  "recover",
  "clinging",
  "flying",
  "webbing"
]);

const OUCH = ["ow.", "i'm okay!", "totally meant to do that.", "ten out of ten landing.", "the floor came out of nowhere."];
const WHEE = ["wheee!", "put me down!", "whoa whoa whoa.", "i can see my house from here."];

const readBounds = (): Bounds => {
  const header = document.querySelector(".app-header")?.getBoundingClientRect();
  const main = document.querySelector<HTMLElement>(".app-main-scroll");
  const mainRect = main?.getBoundingClientRect();
  const scrollbar = main ? main.offsetWidth - main.clientWidth : 0;
  const sidebar = document.querySelector<HTMLElement>(".leaflet-sidebar");
  const sidebarShown = sidebar !== null && sidebar.offsetParent !== null;
  return {
    left: sidebarShown ? sidebar.getBoundingClientRect().left + SIDEBAR_COLLAPSED : mainRect?.left ?? 0,
    right: (mainRect?.right ?? window.innerWidth) - scrollbar,
    top: header ? Math.max(0, header.bottom) : 0,
    floor: mainRect?.bottom ?? window.innerHeight
  };
};

/** Card tops Pip can stand on: any paper card in the page, or anything marked. */
const readLedges = (b: Bounds) =>
  Array.from(document.querySelectorAll(".app-main-scroll .paper-surface, [data-pip-ledge]"))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(
      ({ el, r }) =>
        r.width >= (isBook(el) ? BOOK_MIN_WIDTH : 140) &&
        r.top > b.top + HEIGHT &&
        r.top < b.floor - 12 &&
        r.right > b.left &&
        r.left < b.right
    );

/**
 * Book covers in the library grid are ledges too (`data-pip-ledge="book"`):
 * Pip lands on them, strolls along the top, and hops from book to book. A cover
 * is narrower than a panel, so the width it needs is only room to stand.
 */
const isBook = (el: Element) => (el as HTMLElement).dataset?.pipLedge === "book";
const BOOK_MIN_WIDTH = 72;
/** How far a hop reaches: sideways, up (negative) and down. */
const HOP_REACH_X = 380;
const HOP_REACH_UP = 280;
const HOP_REACH_DOWN = 520;

/** Pip's home: the logo in the header. */
const readHome = () => {
  const home = document.querySelector("[data-pip-home] canvas") ?? document.querySelector("[data-pip-home]");
  const r = home?.getBoundingClientRect();
  if (!r || r.width === 0) {
    return null;
  }
  return { x: r.left + r.width / 2, y: r.top + (r.height * 31) / 32, rect: r };
};

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * Where Pip stands to show a tour stop: on top of the thing, pointing down at
 * it, or below it pointing up when there is no room above (header controls).
 */
const perchFor = (stop: TourStop, b: Bounds, size: number): Perch | null => {
  if (!stop.target) {
    return { x: (b.left + b.right) / 2, y: b.floor, pose: "backflip", facing: 1, rect: null };
  }
  const el = document.querySelector(stop.target);
  const r = el?.getBoundingClientRect();
  if (!el || !r || r.width === 0 || r.height === 0) {
    return null;
  }
  const facing = r.left + size * 1.6 > window.innerWidth ? -1 : 1;
  if (r.top - size > 8 && r.top > b.top - 4) {
    const inset = Math.min(34, r.width / 2);
    return { x: facing > 0 ? r.left + inset : r.right - inset, y: r.top, pose: "point", facing, rect: r };
  }
  const reach = size * 0.36;
  return { x: r.left + r.width / 2 - facing * reach, y: r.bottom + size * 0.95 + 4, pose: "pointup", facing, rect: r };
};

type PipWorldProps = {
  /** Shortcuts the app offers from Pip's right-click menu. */
  actions: PipAction[];
};

export const PipWorld = ({ actions }: PipWorldProps) => {
  const {
    mode,
    suspended,
    home,
    homeRequest,
    reaction,
    tour,
    setHome,
    setInside,
    setDoorSwinging,
    finishReaction,
    react,
    startTour,
    setTourStop
  } = usePipStore(
    useShallow((state) => ({
      mode: state.mode,
      suspended: state.suspended,
      home: state.home,
      homeRequest: state.homeRequest,
      reaction: state.reaction,
      tour: state.tour,
      setHome: state.setHome,
      setInside: state.setInside,
      setDoorSwinging: state.setDoorSwinging,
      finishReaction: state.finishReaction,
      react: state.react,
      startTour: state.startTour,
      setTourStop: state.setTourStop
    }))
  );
  const { base, line } = usePipPresence();
  const wrapUpOpen = useHabitStore((state) => state.wrapUp !== null);
  const onStage = usePipStore((state) => state.onStage);
  const waiting = usePipStore((state) => state.waiting);
  // Covered by a book, performing in the wrap-up, at home in its room on the
  // Pip tab, or waiting for the welcome screen: in each case, not out here.
  const away = suspended || wrapUpOpen || onStage || waiting;
  // Pip wears what the reader equipped on the Pip tab, and its free time
  // includes the moves they bought.
  const equipped = useEquippedPip();
  const premium = usePipWardrobeStore((state) => ownedPremiumMoves(state.overview).join(","));
  // The signature idle goes in once more, so it comes up a little more often
  // than the rest: it is the move the reader picked as Pip's own.
  const hobbies = useRef<string[]>(FREE_HOBBIES);
  hobbies.current = [...FREE_HOBBIES, ...(premium ? premium.split(",") : []), equipped.signature];

  // The pointer is followed on the window, not captured by the element: Pip
  // moves between layers mid-drag, which remounts it and would drop a capture.
  const drag = useRef<null | { id: number; x: number; y: number; moved: boolean; samples: Array<{ t: number; x: number; y: number }> }>(null);

  const [view, setView] = useState<View>({ move: "idle", key: 0, flip: false, visible: false });
  const [say, setSay] = useState<Say | null>(null);
  /** Where the perch seat glows while Pip is held over it; null otherwise. */
  const [perchHint, setPerchHint] = useState<{ x: number; y: number } | null>(null);
  const perchHintOn = useRef(false);
  const bodyRef = useRef<HTMLButtonElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<"world" | "scroll">("world");
  const hostRef = useRef<"world" | "scroll">("world");
  const sayRef = useRef<HTMLSpanElement | null>(null);
  const spotRef = useRef<HTMLDivElement | null>(null);
  const cssSize = useRef(pipCssSize(SPRITE));

  const st = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    phase: "home" as Phase,
    ground: null as Ground | null,
    facing: 1,
    walkTo: 0,
    nextWander: 0,
    bounced: false,
    /** Pip has been clear of its home since coming out, so it may re-enter. */
    leftHome: true,
    spinUntil: 0,
    tempOut: false,
    tween: null as Tween | null,
    reactionId: 0,
    greeted: false,
    stop: null as TourStop | null,
    bubble: "above" as "above" | "side",
    /** Rotation drawn on the body, in radians (CSS: clockwise). */
    angle: 0,
    /** Angular velocity of the held pendulum, or of a spin carried into flight. */
    omega: 0,
    /** Where the body rotates about: the leaf when hanging, the middle otherwise. */
    origin: "center" as "pivot" | "center",
    /** The cursor's smoothed velocity while holding Pip, for the swing. */
    pivot: { x: 0, y: 0, vx: 0, vy: 0 },
    web: null as Web | null,
    /** Flung clear of the opening sidebar once; again only after it closes. */
    sidebarFling: false,
    /** A leap Pip chose (off a web) lands on its feet; only throws splat. */
    softLanding: false,
    /** The dizziness meter (see DIZZY_*), and when a stagger ends (0: none). */
    dizzy: 0,
    staggerUntil: 0,
    /** A wall grab ends at this time; one deadline, so an old grab can't cut a new one short. */
    clingUntil: 0,
    clingSide: 1 as -1 | 1,
    /** After the bedtime scene Pip stays tucked in until then (or until woken). */
    napUntil: 0,
    nextStumble: 0
  });
  const webRef = useRef<SVGSVGElement | null>(null);
  // Latest values for the loop and handlers, without re-subscribing them.
  /** Starts full-speed frames at once (see the loop below). */
  const wakeRef = useRef<() => void>(() => undefined);
  const wake = () => wakeRef.current();
  const live = useRef({ mode, away, home, base, line, reaction });
  live.current = { mode, away, home, base, line, reaction };

  // Called every frame while Pip flies, so identical requests stop here rather
  // than queueing state updates for React to discard.
  const lastShown = useRef("");
  const show = useCallback((move: string, loops?: number, key: string | number = move, still = false) => {
    const flip = st.current.facing < 0;
    const signature = `${move}|${loops}|${key}|${flip}|${still}`;
    if (signature === lastShown.current) {
      return;
    }
    lastShown.current = signature;
    setView({ move, loops, key, flip, visible: true, still });
  }, []);

  const sayTimer = useRef(0);
  const speak = useCallback((text: string, kind: Say["kind"] = "line") => {
    if (st.current.phase === "perched" && kind === "line") {
      return;
    }
    window.clearTimeout(sayTimer.current);
    st.current.bubble = kind === "line" ? "above" : "side";
    setSay({ text, id: Date.now(), kind });
    if (kind === "line") {
      sayTimer.current = window.setTimeout(() => setSay(null), 2600 + text.length * 45);
    }
  }, []);
  const hush = () => {
    window.clearTimeout(sayTimer.current);
    setSay(null);
  };

  // ---------------------------------------------------------------- states

  const toIdle = () => {
    const s = st.current;
    s.phase = "idle";
    s.vx = 0;
    s.vy = 0;
    s.nextWander = performance.now() + IDLE_MIN_MS + Math.random() * IDLE_JITTER_MS;
    const pending = usePipStore.getState().reaction;
    if (pending && pending.id !== s.reactionId) {
      startReaction(pending.id, pending.move, pending.loops, pending.line);
      return;
    }
    if (s.dizzy >= 1 && !prefersReducedMotion()) {
      startStagger();
      return;
    }
    if (s.tempOut && live.current.home) {
      // Came out only to celebrate: back inside after a moment.
      window.setTimeout(() => {
        if (st.current.phase === "idle" && live.current.home) {
          goHome();
        }
      }, 1500);
    }
    show(live.current.base);
  };

  const startReaction = (id: number, move: string, loops: number, text: string | null) => {
    const s = st.current;
    s.phase = "reacting";
    s.reactionId = id;
    show(move, loops, id);
    if (text) {
      speak(text);
    }
  };

  /**
   * Too much spinning: Pip staggers about with stars round its head for a few
   * seconds (longer the dizzier it got), lurching this way and that.
   */
  const startStagger = () => {
    const s = st.current;
    const now = performance.now();
    s.staggerUntil = now + 2500 + Math.min(DIZZY_MAX, s.dizzy) * 2200;
    s.dizzy = 0;
    s.nextStumble = 0;
    s.phase = "walking";
    s.walkTo = s.x;
    show("dizzywalk");
    speak(pick(WOOZY));
  };

  /** Sits Pip on the quiet perch: still, silent, above the header. */
  const perch = () => {
    const s = st.current;
    const spot = readPerch();
    if (!spot) {
      return false;
    }
    s.web = null;
    s.tween = null;
    s.vx = 0;
    s.vy = 0;
    s.omega = 0;
    s.angle = 0;
    s.origin = "center";
    s.staggerUntil = 0;
    s.ground = null;
    s.x = spot.x;
    s.y = spot.y;
    s.facing = 1;
    s.phase = "perched";
    writePerched(true);
    hush();
    show("idle", undefined, "perched", true);
    return true;
  };

  /** A little hop from wherever Pip is onto the perch (a drop nearby, the menu, a launch). */
  const hopToPerch = () => {
    const s = st.current;
    const spot = readPerch();
    if (!spot) {
      return false;
    }
    if (Math.hypot(spot.x - s.x, spot.y - s.y) < 24) {
      return perch();
    }
    s.web = null;
    s.vx = 0;
    s.vy = 0;
    s.omega = 0;
    s.angle = 0;
    setOrigin("center");
    s.ground = null;
    s.phase = "traveling";
    jumpTo(() => readPerch() ?? { x: s.x, y: s.y }, () => void perch(), false);
    return true;
  };

  /** Off the perch: a small hop down into the app, and the perch forgotten. */
  const leavePerch = () => {
    const s = st.current;
    if (s.phase !== "perched") {
      return;
    }
    writePerched(false);
    s.vx = 160;
    s.vy = -260;
    s.leftHome = true;
    s.bounced = false;
    s.phase = "flying";
    show("fall");
    wake();
  };

  /** Something to pass the time with: plays, then back to resting. */
  const lastPlayed = useRef("");
  const play = (move: string, loops: number) => {
    const s = st.current;
    lastPlayed.current = move;
    s.phase = "playing";
    show(move, loops, `play-${performance.now()}`);
  };

  /**
   * Moves the rotation origin without the body jumping on screen. Hanging, Pip
   * turns about the leaf; flying or standing, about its middle. Switching with
   * the body tilted would teleport it, so the position absorbs the difference.
   */
  const setOrigin = (origin: "pivot" | "center") => {
    const s = st.current;
    if (s.origin === origin) {
      return;
    }
    const size = cssSize.current;
    const pivotY = (size * 31) / 32 - HOLD_DROP;
    const centerY = size * 0.55;
    // d = old origin - new origin (x is the middle in both), then
    // position += (I - R) d, which keeps every drawn point where it was.
    const dy = origin === "center" ? pivotY - centerY : centerY - pivotY;
    s.x += Math.sin(s.angle) * dy;
    s.y += dy - Math.cos(s.angle) * dy;
    s.origin = origin;
  };

  /**
   * Shoots a web and climbs it: onto a card above when one is in reach, or up
   * to the header for a swing that ends in a leap across the window.
   */
  const startWeb = (now: number) => {
    const s = st.current;
    const b = readBounds();
    const pivotY = s.y - HOLD_DROP;
    const reachable = readLedges(b).filter(
      ({ r }) => r.top < s.y - 70 && r.top > b.top + HEIGHT + 10 && s.y - r.top < 560 && Math.abs((r.left + r.right) / 2 - s.x) < r.width / 2 + 320
    );
    let anchor: Web["anchor"];
    let target: Element | null = null;
    if (reachable.length > 0) {
      const { el, r } = pick(reachable);
      // The corner nearest Pip, so the line runs up the card's side rather
      // than through it.
      const nearLeft = Math.abs(r.left - s.x) < Math.abs(r.right - s.x);
      const inset = nearLeft ? 22 : r.width - 22;
      anchor = () => {
        const rr = el.getBoundingClientRect();
        return el.isConnected ? { x: rr.left + inset, y: rr.top } : null;
      };
      target = el;
    } else {
      const dir = s.x < (b.left + b.right) / 2 ? 1 : -1;
      const x = Math.max(b.left + 40, Math.min(b.right - 40, s.x + dir * (140 + Math.random() * 160)));
      if (s.y - b.top < 160) {
        return false;
      }
      anchor = () => ({ x, y: readBounds().top + 1 });
    }
    const a = anchor();
    if (!a) {
      return false;
    }
    const length = Math.hypot(s.x - a.x, pivotY - a.y);
    s.web = {
      anchor,
      target,
      length,
      phi: Math.atan2(s.x - a.x, pivotY - a.y),
      omega: 0,
      shotAt: now,
      startedAt: now,
      halfSwings: 0
    };
    s.phase = "webbing";
    s.ground = null;
    s.facing = a.x < s.x ? -1 : 1;
    show("pointup");
    return true;
  };

  /** Lets go of the web: onto the card, or flying on with the swing's speed. */
  const endWeb = (fly: boolean) => {
    const s = st.current;
    const web = s.web;
    s.web = null;
    setOrigin("center");
    if (!web) {
      return;
    }
    if (fly) {
      s.vx = web.length * web.omega * Math.cos(web.phi);
      s.vy = -web.length * web.omega * Math.sin(web.phi);
      s.omega = -web.omega * 0.5;
      s.bounced = false;
      s.softLanding = true;
      s.phase = "flying";
      return;
    }
    const el = web.target;
    if (!el) {
      startFall();
      return;
    }
    // A last hop up and over the edge, onto the card.
    s.phase = "traveling";
    jumpTo(
      () => {
        const r = el.getBoundingClientRect();
        return { x: Math.max(r.left + 30, Math.min(r.right - 30, s.facing > 0 ? r.left + 40 : r.right - 40)), y: r.top };
      },
      () => {
        const r = el.getBoundingClientRect();
        land({ kind: "ledge", el }, r.top, 0);
      },
      false
    );
  };

  /** The sidebar opened on top of Pip: off it goes, across the window. */
  const flingFromSidebar = () => {
    const s = st.current;
    s.tween = null;
    s.web = null;
    setOrigin("center");
    s.phase = "flying";
    s.ground = null;
    s.bounced = false;
    s.leftHome = true;
    s.facing = 1;
    s.vx = 1500 + Math.random() * 500;
    s.vy = -780 - Math.random() * 240;
    s.omega = 12;
    speak(pick(["whoa, coming through!", "sidebar! sidebar!", "evicted!", "i'll take the scenic route."]));
  };

  const startFall = () => {
    const s = st.current;
    s.phase = "flying";
    s.ground = null;
    s.bounced = true;
    s.vy = 0;
    show("fall");
  };

  const land = (ground: Ground, y: number, impact: number) => {
    const s = st.current;
    s.y = y;
    s.ground = ground;
    const soft = s.softLanding;
    s.softLanding = false;
    if (soft) {
      impact = 0;
    }
    if (impact > SPLAT_SPEED) {
      s.vx = 0;
      s.vy = 0;
      s.phase = "splat";
      show("splat", 1, `splat-${performance.now()}`);
      speak(pick(OUCH));
      return;
    }
    if (impact > BOUNCE_SPEED && !s.bounced) {
      s.vy = -impact * 0.32;
      s.vx *= 0.6;
      s.bounced = true;
      s.ground = null;
      return;
    }
    s.vx = 0;
    s.vy = 0;
    s.bounced = false;
    s.phase = "landing";
    show("land", 1, `land-${performance.now()}`);
  };

  const hide = () => {
    const s = st.current;
    s.phase = "home";
    s.ground = null;
    s.tempOut = false;
    s.web = null;
    s.angle = 0;
    s.omega = 0;
    s.origin = "center";
    lastShown.current = "";
    setView((current) => ({ ...current, visible: false }));
    hush();
    setInside(true);
    window.setTimeout(() => setDoorSwinging(false), 300);
  };

  /** Out of the logo: a hop and a flip, then down into the app. */
  const emerge = (tempOut: boolean) => {
    const s = st.current;
    if (s.phase !== "home") {
      return;
    }
    const homeSpot = readHome();
    s.tempOut = tempOut;
    s.phase = "emerging";
    setDoorSwinging(true);
    window.setTimeout(() => {
      const b = readBounds();
      s.x = homeSpot ? homeSpot.x : b.left + 40;
      s.y = homeSpot ? homeSpot.y : b.top;
      s.facing = 1;
      // Left on the perch last time: straight back onto it.
      if (!tempOut && readPerched()) {
        setInside(false);
        s.leftHome = true;
        if (hopToPerch()) {
          return;
        }
      }
      s.vx = 230;
      s.vy = -420;
      s.bounced = true;
      s.leftHome = false;
      s.spinUntil = performance.now() + 520;
      s.phase = "flying";
      s.ground = null;
      setInside(false);
      show("tumble");
      wake();
      if (!s.greeted) {
        s.greeted = true;
        window.setTimeout(() => {
          if (usePipStore.getState().tour === null) {
            speak(live.current.line);
          }
        }, 900);
      }
    }, 160);
    window.setTimeout(() => setDoorSwinging(false), 700);
  };

  /** A jump along an arc to a (possibly moving) point, then `done`. */
  const jumpTo = (target: () => { x: number; y: number }, done: () => void, spin: boolean) => {
    const s = st.current;
    const to = target();
    const dist = Math.hypot(to.x - s.x, to.y - s.y);
    s.facing = to.x < s.x ? -1 : 1;
    s.tween = { x0: s.x, y0: s.y, t0: performance.now(), dur: Math.min(1100, 420 + dist * 0.6), arc: Math.min(170, 50 + dist * 0.3), target, done };
    show(spin && dist > 140 ? "tumble" : "fall");
    wake();
  };

  const goHome = () => {
    const s = st.current;
    if (s.phase === "home" || s.phase === "going-home" || s.phase === "held") {
      return;
    }
    writePerched(false);
    const homeSpot = readHome();
    if (!homeSpot) {
      hide();
      return;
    }
    s.web = null;
    setOrigin("center");
    s.phase = "going-home";
    hush();
    jumpTo(
      () => readHome() ?? homeSpot,
      () => {
        setDoorSwinging(true);
        hide();
      },
      true
    );
  };

  // ---------------------------------------------------------------- the tour

  const tourControls = (index: number) => {
    const last = index >= TOUR.length - 1;
    return (
      <>
        {index > 0 && (
          <button type="button" className="pip-say-button" onClick={() => setTourStop(index - 1)}>
            Back
          </button>
        )}
        <button type="button" className="pip-say-button pip-say-button-primary" onClick={() => setTourStop(last ? null : index + 1)}>
          {last ? "Done" : "Next"}
        </button>
        {!last && (
          <button type="button" className="pip-say-button pip-say-button-quiet" onClick={() => setTourStop(null)}>
            Skip tour
          </button>
        )}
        <span className="pip-say-count">
          {index + 1} / {TOUR.length}
        </span>
      </>
    );
  };

  const goToStop = (index: number) => {
    const s = st.current;
    const stop = TOUR[index];
    const b = readBounds();
    const el = stop.target ? document.querySelector(stop.target) : null;
    const perch = perchFor(stop, b, cssSize.current);
    if (!perch) {
      // Not on screen here (a narrow window hides the search box): skip it.
      setTourStop(index + 1 < TOUR.length ? index + 1 : null);
      return;
    }
    if (el && perch.rect && (perch.rect.bottom < b.top || perch.rect.top > b.floor)) {
      el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
    hush();
    if (s.phase === "home") {
      const homeSpot = readHome();
      s.x = homeSpot?.x ?? b.left + 40;
      s.y = homeSpot?.y ?? b.top;
      setInside(false);
      setDoorSwinging(true);
      window.setTimeout(() => setDoorSwinging(false), 500);
    }
    s.stop = stop;
    s.web = null;
    setOrigin("center");
    s.phase = "traveling";
    s.ground = null;
    jumpTo(
      () => perchFor(stop, readBounds(), cssSize.current) ?? { x: s.x, y: s.y },
      () => {
        const at = perchFor(stop, readBounds(), cssSize.current) ?? perch;
        s.phase = "guiding";
        s.facing = at.facing;
        show(at.pose, undefined, `tour-${index}`);
        speak(stop.line, "tour");
      },
      true
    );
  };

  const endTour = () => {
    const s = st.current;
    s.stop = null;
    if (s.phase === "traveling" || s.phase === "guiding") {
      hush();
      s.tween = null;
      s.vx = 0;
      startFall();
    }
  };

  // ---------------------------------------------------------------- physics

  const step = (dt: number, now: number) => {
    const s = st.current;
    if (live.current.away) {
      return;
    }
    const b = readBounds();

    // The sidebar opens over the app on hover. Pip under it would be stuck
    // behind the leather, so it gets flung clear, once per opening.
    const sidebar = document.querySelector<HTMLElement>(".leaflet-sidebar");
    const sidebarRect = sidebar && sidebar.offsetParent !== null ? sidebar.getBoundingClientRect() : null;
    if (!sidebarRect || sidebarRect.width < SIDEBAR_COLLAPSED + 60) {
      s.sidebarFling = false;
    } else if (!s.sidebarFling && s.x - HALF_W < sidebarRect.right && FLINGABLE.has(s.phase)) {
      s.sidebarFling = true;
      if (s.phase === "reacting") {
        finishReaction(s.reactionId);
      }
      flingFromSidebar();
    }

    if (s.phase === "held") {
      swingHeld(dt);
      return;
    }
    if (s.phase === "napping" && now > s.napUntil) {
      s.phase = "waking";
      show("stretch", 1, `wake-${now}`);
    }
    if (s.phase === "perched") {
      const spot = readPerch();
      if (spot) {
        s.x = spot.x;
        s.y = spot.y;
      }
      return;
    }
    if (s.phase === "home" || s.phase === "emerging") {
      return;
    }

    if (s.phase === "webbing") {
      swingWeb(dt, now, b);
      return;
    }

    if (s.tween) {
      settleUpright(dt);
      const tw = s.tween;
      const to = tw.target();
      const t = Math.min(1, (now - tw.t0) / tw.dur);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      s.x = tw.x0 + (to.x - tw.x0) * ease;
      s.y = tw.y0 + (to.y - tw.y0) * ease - Math.sin(Math.PI * t) * tw.arc;
      if (t >= 1) {
        s.tween = null;
        tw.done();
      }
      return;
    }

    if (s.phase === "guiding" && s.stop) {
      settleUpright(dt);
      const at = perchFor(s.stop, b, cssSize.current);
      if (at) {
        s.x = at.x;
        s.y = at.y;
      }
      return;
    }

    if (s.phase === "clinging") {
      settleUpright(dt);
      // Pinned to the wall every frame: the window's edges can shift by a
      // scrollbar's width mid-slide, which used to leave Pip hovering or
      // twitching beside the wall.
      s.x = s.clingSide < 0 ? b.left + HALF_W * 0.7 : b.right - HALF_W * 0.7;
      s.y += 34 * dt;
      if (s.y >= b.floor) {
        land({ kind: "floor" }, b.floor, 0);
      } else if (now > s.clingUntil) {
        startFall();
      }
      return;
    }

    if (s.phase === "flying") {
      s.vy += GRAVITY * dt;
      s.vx *= 1 - 0.25 * dt;
      const prevY = s.y;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // Coming out, Pip passes down through the header and the sidebar's
      // edge; only once it is clear of home do the walls and ceiling apply.
      const homeSpot = readHome();
      if (!s.leftHome && (!homeSpot || Math.hypot(s.x - homeSpot.x, s.y - homeSpot.y) > 70) && s.y - HEIGHT > b.top) {
        s.leftHome = true;
      }

      if (s.leftHome && s.x - HALF_W < b.left) {
        if (Math.abs(s.vx) > CLING_SPEED && s.y < b.floor - 60) {
          s.x = b.left + HALF_W * 0.7;
          s.facing = -1;
          s.clingSide = -1;
          s.clingUntil = now + 1400;
          s.phase = "clinging";
          show("cling");
          return;
        }
        s.x = b.left + HALF_W;
        s.vx = Math.abs(s.vx) * 0.45;
      }
      if (s.x + HALF_W > b.right) {
        if (Math.abs(s.vx) > CLING_SPEED && s.y < b.floor - 60) {
          s.x = b.right - HALF_W * 0.7;
          s.facing = 1;
          s.clingSide = 1;
          s.clingUntil = now + 1400;
          s.phase = "clinging";
          show("cling");
          return;
        }
        s.x = b.right - HALF_W;
        s.vx = -Math.abs(s.vx) * 0.45;
      }
      // The header is the ceiling, except over the logo: thrown up into its
      // home, Pip goes in.
      if (s.leftHome && s.y - HEIGHT < b.top) {
        if (homeSpot && Math.abs(s.x - homeSpot.x) < 60 && s.vy < 0) {
          setDoorSwinging(true);
          hide();
          setHome(true);
          return;
        }
        s.y = b.top + HEIGHT;
        s.vy = Math.abs(s.vy) * 0.3;
      }

      if (s.vy > 0) {
        for (const { el, r } of readLedges(b)) {
          if (prevY <= r.top + 1 && s.y >= r.top && s.x > r.left + 8 && s.x < r.right - 8) {
            land({ kind: "ledge", el }, r.top, s.vy);
            return;
          }
        }
        if (s.y >= b.floor) {
          land({ kind: "floor" }, b.floor, s.vy);
          return;
        }
      }

      if (Math.abs(s.vx) > 30) {
        s.facing = s.vx < 0 ? -1 : 1;
      }
      // A spin carried out of a swing keeps turning the whole body; the
      // tumble drawing on top of that would be a spin inside a spin.
      s.angle += s.omega * dt;
      s.dizzy = Math.min(DIZZY_MAX, s.dizzy + Math.abs(s.omega) * dt * DIZZY_PER_RADIAN);
      s.omega *= Math.max(0, 1 - SPIN_DAMPING * dt);
      const spinning = Math.abs(s.omega) > 2;
      show(!spinning && (now < s.spinUntil || Math.hypot(s.vx, s.vy) > 1100) ? "tumble" : "fall");
      return;
    }

    // Anything but hanging or flying: settle upright.
    settleUpright(dt);

    // On a surface: follow it, and fall if it goes away.
    let minX = b.left + HALF_W + 8;
    let maxX = b.right - HALF_W - 8;
    if (s.ground?.kind === "ledge") {
      const r = s.ground.el.getBoundingClientRect();
      if (!s.ground.el.isConnected || r.top < b.top + HEIGHT || r.top > b.floor - 4 || s.x < r.left || s.x > r.right) {
        startFall();
        return;
      }
      s.y = r.top;
      minX = Math.max(minX, r.left + 14);
      maxX = Math.min(maxX, r.right - 14);
    } else {
      s.y = b.floor;
    }
    s.x = Math.max(minX, Math.min(maxX, s.x));

    if (s.staggerUntil > 0) {
      if (now > s.staggerUntil || s.phase !== "walking") {
        s.staggerUntil = 0;
        if (s.phase === "walking") {
          toIdle();
        }
      } else {
        // Lurch toward a new spot every so often, overshoot, lurch back.
        if (now > s.nextStumble || Math.abs(s.walkTo - s.x) < 3) {
          s.nextStumble = now + 500 + Math.random() * 900;
          const lurch = (40 + Math.random() * 90) * (Math.random() < 0.5 ? -1 : 1);
          s.walkTo = Math.max(minX, Math.min(maxX, s.x + lurch));
          s.facing = s.walkTo < s.x ? -1 : 1;
          show("dizzywalk");
        }
        const dir = Math.sign(s.walkTo - s.x);
        const speed = WALK_SPEED * (0.7 + 0.6 * Math.abs(Math.sin(now / 170)));
        s.x = Math.max(minX, Math.min(maxX, s.x + dir * speed * dt));
        s.angle = 0.2 * Math.sin(now / 260);
        return;
      }
    }
    if (s.dizzy > 0) {
      s.dizzy = Math.max(0, s.dizzy - DIZZY_DRAIN * dt);
    }

    if (s.phase === "walking") {
      const dir = Math.sign(s.walkTo - s.x);
      s.x += dir * WALK_SPEED * dt;
      if (Math.abs(s.walkTo - s.x) < 2 || s.x <= minX || s.x >= maxX) {
        toIdle();
      }
      return;
    }

    if (s.phase === "idle" && now > s.nextWander) {
      s.nextWander = now + IDLE_MIN_MS + Math.random() * IDLE_JITTER_MS;
      pastime(now, minX, maxX);
    }
  };

  /**
   * What Pip does with a free moment. Resting is the pose that shows the day
   * (reading along with a session, dozing when you have been away), so those
   * stay put; otherwise Pip keeps itself busy: a stroll, a fidget, a hobby, or
   * a web up to a card. Quiet mode only strolls and glances around.
   */
  const pastime = (now: number, minX: number, maxX: number) => {
    const s = st.current;
    const { mode: currentMode, base: rest } = live.current;
    // Quiet means celebrations only: out for one, Pip stays put and waits to
    // go back in, rather than wandering and playing the hour's scenes.
    if (currentMode !== "chatty" || prefersReducedMotion() || rest === "read" || rest === "sleep" || rest === "bedsleep") {
      return;
    }
    const walk = () => {
      if (maxX - minX <= 80) {
        return false;
      }
      let target = minX + Math.random() * (maxX - minX);
      if (Math.abs(target - s.x) < 50) {
        target = s.x < (minX + maxX) / 2 ? Math.min(maxX, s.x + 90) : Math.max(minX, s.x - 90);
      }
      s.walkTo = target;
      s.facing = target < s.x ? -1 : 1;
      s.phase = "walking";
      show("walk");
      return true;
    };
    // Standing on a book, Pip is often off to the next one; from the floor,
    // now and then up onto one.
    const onBook = s.ground?.kind === "ledge" && isBook(s.ground.el);
    if (Math.random() < (onBook ? 0.45 : 0.18) && hopToBook()) {
      return;
    }
    const roll = Math.random();
    // Now and then, a scene from the book being read (a dragon for the
    // dragon book), with its line.
    const reading = usePipStore.getState().bookNod;
    const nod = reading && roll < 0.12 ? nodFor(reading) : null;
    if (nod && hasMove(nod.move)) {
      play(nod.move, 1);
      speak(nod.line);
      return;
    }
    // A third of the time, whatever the hour suggests.
    const hourly = hourlyPastime();
    if (hourly && roll < 0.33) {
      play(hourly, 1);
      return;
    }
    if (roll < 0.34) {
      if (!walk()) {
        play(pick(FIDGETS), 1);
      }
    } else if (roll < 0.58) {
      play(pick(FIDGETS), 1);
    } else if (roll < 0.8) {
      if (!startWeb(now)) {
        play(pick(hobbies.current), 2);
      }
    } else {
      play(pick(hobbies.current), 2);
    }
  };

  /**
   * A hop onto a nearby book cover: one of the nearest few within reach (so
   * mostly the neighbours on the same shelf row), landing a little off its
   * middle. Returns false when no book is in reach.
   */
  const hopToBook = () => {
    const s = st.current;
    const b = readBounds();
    const here = s.ground?.kind === "ledge" ? s.ground.el : null;
    const options = readLedges(b)
      .filter(({ el }) => isBook(el) && el !== here)
      .map(({ el, r }) => ({ el, dx: (r.left + r.right) / 2 - s.x, dy: r.top - s.y }))
      .filter(({ dx, dy }) => Math.abs(dx) <= HOP_REACH_X && dy >= -HOP_REACH_UP && dy <= HOP_REACH_DOWN && Math.hypot(dx, dy) > 40)
      .sort((a, c) => Math.hypot(a.dx, a.dy) - Math.hypot(c.dx, c.dy));
    if (options.length === 0) {
      return false;
    }
    const { el } = options[Math.floor(Math.random() * Math.min(3, options.length))];
    const along = 0.3 + Math.random() * 0.4;
    const aim = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width * along, y: r.top };
    };
    s.web = null;
    s.vx = 0;
    s.vy = 0;
    s.ground = null;
    s.phase = "traveling";
    jumpTo(
      aim,
      () => {
        // The book scrolled away or was filtered out mid-hop: just fall.
        if (!el.isConnected) {
          startFall();
          return;
        }
        const spot = aim();
        s.x = spot.x;
        land({ kind: "ledge", el }, spot.y, 0);
      },
      false
    );
    return true;
  };

  /** Eases a leftover tilt away once Pip is standing again. */
  const settleUpright = (dt: number) => {
    const s = st.current;
    s.omega = 0;
    if (s.angle !== 0) {
      s.angle = Math.atan2(Math.sin(s.angle), Math.cos(s.angle)) * Math.exp(-18 * dt);
      if (Math.abs(s.angle) < 0.002) {
        s.angle = 0;
      }
    }
  };

  /**
   * Held by the leaf: a pendulum whose pivot is the cursor. The pivot's own
   * acceleration drives it (in the cursor's frame, gravity leans the other
   * way), so a flick sends Pip swinging and a circle can loop it right over.
   */
  const swingHeld = (dt: number) => {
    const s = st.current;
    const p = s.pivot;
    const px = s.x;
    const py = s.y - HOLD_DROP;
    // Pointer events arrive unevenly; a light low-pass keeps the swing from
    // twitching at every sample.
    const vx = p.vx + ((px - p.x) / dt - p.vx) * 0.35;
    const vy = p.vy + ((py - p.y) / dt - p.vy) * 0.35;
    const ax = Math.max(-60000, Math.min(60000, (vx - p.vx) / dt));
    const ay = Math.max(-60000, Math.min(60000, (vy - p.vy) / dt));
    Object.assign(p, { x: px, y: py, vx, vy });
    // theta from straight down, positive with the body to the right; CSS
    // rotation is clockwise, so the drawn angle is -theta.
    let theta = -s.angle;
    const alpha = -(ax * Math.cos(theta) + (GRAVITY - ay) * Math.sin(theta)) / SWING_LENGTH;
    s.omega = (s.omega + alpha * dt) * Math.max(0, 1 - SWING_DAMPING * dt);
    const shake = Math.max(0, Math.hypot(ax, ay) - SHAKE_FLOOR);
    s.dizzy = Math.min(DIZZY_MAX, s.dizzy + (Math.abs(s.omega) * DIZZY_PER_RADIAN + shake * DIZZY_PER_SHAKE) * dt);
    theta += s.omega * dt;
    s.angle = -Math.atan2(Math.sin(theta), Math.cos(theta));
  };

  /** On the web: a pendulum from the anchor, reeling in as it goes. */
  const swingWeb = (dt: number, now: number, b: Bounds) => {
    const s = st.current;
    const web = s.web;
    const a = web?.anchor();
    if (!web || !a || now - web.startedAt > 7000) {
      endWeb(false);
      return;
    }
    if (now - web.shotAt < WEB_SHOT_MS) {
      // The web is still flying out; Pip waits for it to stick.
      return;
    }
    if (s.origin !== "pivot") {
      setOrigin("pivot");
      show("held");
    }
    // Climbing a card reels all the way in. A header swing reels to a
    // comfortable length and then just swings.
    const minLength = web.target ? WEB_MIN : 150;
    const before = web.length;
    web.length = Math.max(minLength, web.length - (web.target ? WEB_REEL : WEB_REEL * 2) * dt);
    const reel = (web.length - before) / dt;
    // Shortening the rope conserves angular momentum, so reeling in pumps the
    // swing, the way a kid on a swing stands up at the bottom.
    const alpha = -(GRAVITY / web.length) * Math.sin(web.phi) - (2 * reel * web.omega) / web.length;
    const previous = web.omega;
    web.omega = (web.omega + alpha * dt) * Math.max(0, 1 - 0.15 * dt);
    web.phi += web.omega * dt;
    if (Math.sign(previous) !== Math.sign(web.omega) && previous !== 0) {
      web.halfSwings += 1;
    }
    let pivotY = a.y + web.length * Math.cos(web.phi);
    // The rope cannot drag Pip through the floor: it skids along it instead.
    if (pivotY + HOLD_DROP > b.floor) {
      pivotY = b.floor - HOLD_DROP;
      web.omega *= 1 - Math.min(1, 6 * dt);
    }
    s.x = a.x + web.length * Math.sin(web.phi);
    s.y = pivotY + HOLD_DROP;
    s.angle = -web.phi;
    s.facing = web.omega > 0 ? 1 : web.omega < 0 ? -1 : s.facing;

    if (web.target && web.length <= WEB_MIN + 0.5) {
      endWeb(false);
    } else if (!web.target && web.halfSwings >= 1 && web.phi * web.omega > 0 && Math.abs(web.phi) > 0.4) {
      // Past the bottom and rising: the best moment to let go and fly.
      endWeb(true);
    }
  };

  /** Offset from window coordinates to the element's own layer. */
  const layerOffset = (el: HTMLElement) => {
    const layer = el.parentElement;
    if (layer?.hasAttribute("data-pip-scroll-layer")) {
      const scroller = layer.parentElement as HTMLElement;
      const r = scroller.getBoundingClientRect();
      return { x: r.left - scroller.scrollLeft, y: r.top - scroller.scrollTop };
    }
    return { x: 0, y: 0 };
  };

  // Place Pip, its bubble and the tour spotlight straight on the DOM.
  const place = () => {
    const s = st.current;
    const size = cssSize.current;

    const onCard =
      s.ground?.kind === "ledge" &&
      (s.phase === "idle" ||
        s.phase === "walking" ||
        s.phase === "landing" ||
        s.phase === "reacting" ||
        s.phase === "playing" ||
        s.phase === "napping" ||
        s.phase === "waking" ||
        s.phase === "splat" ||
        s.phase === "recover");
    const wanted = onCard && !drag.current ? "scroll" : "world";
    if (wanted !== hostRef.current) {
      hostRef.current = wanted;
      setHost(wanted);
    }
    const raised =
      s.phase === "held" || s.phase === "flying" || s.phase === "emerging" || s.phase === "going-home" ||
      s.phase === "traveling" || s.phase === "guiding" || s.phase === "clinging" || s.phase === "webbing" ||
      s.phase === "perched" || s.bubble === "side";
    if (worldRef.current) {
      worldRef.current.style.zIndex = raised ? "57" : "35";
    }

    const body = bodyRef.current;
    if (body) {
      const o = layerOffset(body);
      const originY = s.origin === "pivot" ? (size * 31) / 32 - HOLD_DROP : size * 0.55;
      body.style.transformOrigin = `${size / 2}px ${originY}px`;
      body.style.transform = `translate3d(${s.x - size / 2 - o.x}px, ${s.y - (size * 31) / 32 - o.y}px, 0) rotate(${s.angle}rad)`;
    }
    const web = webRef.current;
    if (web) {
      const a = s.phase === "webbing" && s.web ? s.web.anchor() : null;
      if (a && s.web) {
        // Pip's end of the line is the leaf, where it hangs from.
        const px = s.x;
        const py = s.y - HOLD_DROP;
        // Shooting, the line grows from Pip to the anchor.
        const t = Math.min(1, (performance.now() - s.web.shotAt) / WEB_SHOT_MS);
        const ex = px + (a.x - px) * t;
        const ey = py + (a.y - py) * t;
        web.style.display = "block";
        web.querySelectorAll("line").forEach((line) => {
          line.setAttribute("x1", String(px));
          line.setAttribute("y1", String(py));
          line.setAttribute("x2", String(ex));
          line.setAttribute("y2", String(ey));
        });
      } else {
        web.style.display = "none";
      }
    }
    const bubble = sayRef.current;
    if (bubble) {
      const bw = bubble.offsetWidth;
      const bh = bubble.offsetHeight;
      let left: number;
      let top: number;
      let tail: PipSayTail;
      let tailAt: number;
      if (s.bubble === "side") {
        // Beside Pip, so the bubble never covers what Pip is pointing at.
        const right = s.x + size * 0.46;
        const fitsRight = right + bw < window.innerWidth - 8;
        left = fitsRight ? right + 8 : s.x - size * 0.46 - bw - 8;
        top = Math.max(8, Math.min(window.innerHeight - bh - 8, s.y - size * 0.62 - bh / 2));
        tail = fitsRight ? "left" : "right";
        tailAt = Math.max(15, Math.min(85, ((s.y - size * 0.62 - top) / bh) * 100));
      } else {
        left = Math.max(8, Math.min(window.innerWidth - bw - 8, s.x - bw / 2));
        top = s.y - size * 0.92 - bh - 12;
        tail = "down";
        if (top < 8) {
          top = s.y + 10;
          tail = "up";
        }
        tailAt = Math.max(12, Math.min(88, ((s.x - left) / bw) * 100));
      }
      const o = layerOffset(bubble);
      bubble.style.transform = `translate3d(${left - o.x}px, ${top - o.y}px, 0)`;
      bubble.dataset.tail = tail;
      bubble.style.setProperty("--tail-at", `${tailAt}%`);
    }
    const spot = spotRef.current;
    if (spot) {
      const r = s.phase === "guiding" && s.stop?.target ? document.querySelector(s.stop.target)?.getBoundingClientRect() : null;
      if (r) {
        spot.style.opacity = "1";
        spot.style.transform = `translate3d(${r.left - 6}px, ${r.top - 6}px, 0)`;
        spot.style.width = `${r.width + 12}px`;
        spot.style.height = `${r.height + 12}px`;
      } else {
        spot.style.opacity = "0";
      }
    }
  };

  // Moving between the page's layer and a card's scrolling layer re-creates
  // Pip's element, which starts with no transform: the browser drew it at the
  // layer's top-left corner until the loop next placed it, a frame when picked
  // up, up to REST_MS on landing. Place it before anything is drawn.
  useLayoutEffect(() => {
    if (mode !== "off") {
      place();
    }
    // `place` reads everything through refs; only the host swap matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, mode]);

  useEffect(() => {
    if (mode === "off") {
      return;
    }
    let raf = 0;
    let timer = 0;
    let last = performance.now();
    // Frames while something moves; a slow check-in otherwise.
    const schedule = () => {
      const s = st.current;
      const moving = MOVING.has(s.phase) || s.tween !== null || s.web !== null || drag.current !== null;
      if (moving && !document.hidden) {
        raf = requestAnimationFrame(loop);
      } else {
        timer = window.setTimeout(() => loop(performance.now()), REST_MS);
      }
    };
    const loop = (now: number) => {
      raf = 0;
      timer = 0;
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      step(dt, now);
      place();
      schedule();
    };
    // Something just started moving (a drag, a hop, a leap out of the logo):
    // frames now, not at the next check-in.
    wakeRef.current = () => {
      if (raf) {
        return;
      }
      window.clearTimeout(timer);
      timer = 0;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // Development only: lets a console (or a test driving the app) ask for a
    // move that otherwise happens at random.
    if (import.meta.env.DEV) {
      (window as unknown as { __pipDebug?: unknown }).__pipDebug = {
        web: () => st.current.phase === "idle" && startWeb(performance.now()),
        hop: () => (st.current.phase === "idle" || st.current.phase === "walking") && hopToBook(),
        dizzy: (amount = 1.5) => {
          st.current.dizzy = amount;
        },
        state: () => ({ ...st.current, web: Boolean(st.current.web) })
      };
    }
    const onResize = () => {
      cssSize.current = pipCssSize(SPRITE);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      wakeRef.current = () => undefined;
      window.removeEventListener("resize", onResize);
    };
    // The loop reads everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Out on launch if Pip lives out; home and away as the logo is used.
  useEffect(() => {
    if (mode === "off" || usePipStore.getState().tour !== null) {
      return;
    }
    const s = st.current;
    // Held back while the welcome screen is up: out once it closes.
    if (!home && s.phase === "home" && !waiting) {
      const timer = window.setTimeout(() => emerge(false), s.greeted ? 0 : 1400);
      return () => window.clearTimeout(timer);
    }
    if (home && s.phase !== "home") {
      goHome();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home, homeRequest, mode, waiting]);

  // The tour: each stop is a jump to a new perch.
  useEffect(() => {
    if (mode === "off" || away) {
      return;
    }
    if (tour === null) {
      endTour();
      return;
    }
    const timer = window.setTimeout(() => goToStop(tour), 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, mode, away]);

  // Celebrations: play now if Pip is free, come out for them if Pip is home.
  useEffect(() => {
    if (!reaction || mode === "off" || away || tour !== null) {
      return;
    }
    const s = st.current;
    if (s.phase === "perched") {
      finishReaction(reaction.id);
      return;
    }
    if (s.phase === "home") {
      emerge(true);
      return;
    }
    if (
      (s.phase === "idle" || s.phase === "walking" || s.phase === "landing" || s.phase === "playing" || s.phase === "napping" || s.phase === "waking") &&
      reaction.id !== s.reactionId
    ) {
      startReaction(reaction.id, reaction.move, reaction.loops, reaction.line);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reaction, mode, away, tour]);

  // The resting pose follows the day: asleep, reading, idle, sunbathing. A
  // change of pose gets a small transition rather than a cut: a yawn on the
  // way to sleep, a stretch on waking.
  const previousBase = useRef(base);
  useEffect(() => {
    const was = previousBase.current;
    previousBase.current = base;
    const s = st.current;
    if (s.phase !== "idle" || was === base) {
      if (s.phase === "idle") {
        show(base);
      }
      return;
    }
    const asleep = (pose: string) => pose === "sleep" || pose === "bedsleep";
    if (!asleep(was) && asleep(base) && !prefersReducedMotion()) {
      s.phase = "waking";
      show("yawn", 1, `doze-${Date.now()}`);
      return;
    }
    if (asleep(was) && !asleep(base) && !prefersReducedMotion()) {
      s.phase = "waking";
      show("stretch", 1, `wake-${Date.now()}`);
      return;
    }
    show(base);
  }, [base, show]);

  useEffect(() => {
    setInside(st.current.phase === "home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSpriteDone = () => {
    const s = st.current;
    if (s.phase === "landing") {
      toIdle();
    } else if (s.phase === "splat") {
      s.phase = "recover";
      show("dizzy", 1, `dizzy-${performance.now()}`);
    } else if (s.phase === "playing" && lastPlayed.current === "bedtime") {
      // Tucked in: stay asleep in the bed for a while rather than hopping
      // straight back out of it.
      s.phase = "napping";
      s.napUntil = performance.now() + 60_000 + Math.random() * 60_000;
      show("bedsleep");
    } else if (s.phase === "napping" || s.phase === "waking") {
      toIdle();
    } else if (s.phase === "recover" || s.phase === "playing") {
      toIdle();
    } else if (s.phase === "reacting") {
      finishReaction(s.reactionId);
      toIdle();
    }
  };

  // ---------------------------------------------------------------- menu

  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = () => {
    const s = st.current;
    if (s.phase === "home" || s.phase === "traveling" || s.phase === "guiding" || s.phase === "held") {
      return;
    }
    setMenuOpen(true);
    speak(live.current.line, "menu");
  };
  const closeMenu = () => {
    setMenuOpen(false);
    hush();
  };

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sayRef.current?.contains(target) && !bodyRef.current?.contains(target)) {
        closeMenu();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        bodyRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  const menuItems: PipAction[] = [
    ...actions,
    { id: "tour", label: "Show me around", run: () => startTour() },
    st.current.phase === "perched"
      ? { id: "perch", label: "Hop down", run: () => leavePerch() }
      : { id: "perch", label: "Sit by the logo", run: () => void hopToPerch() },
    { id: "home", label: "Go home", run: () => setHome(true) }
  ];

  // ---------------------------------------------------------------- hands


  const poke = () => {
    const s = st.current;
    if (s.phase === "reacting" || s.phase === "flying" || s.phase === "home" || s.phase === "traveling" || s.phase === "guiding") {
      return;
    }
    const beat = pickBeat("poke", `${Date.now()}`);
    react(beat.move, { loops: 1, line: beat.line });
  };

  const busyWithTour = () => st.current.phase === "traveling" || st.current.phase === "guiding";

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const s = st.current;
    if (s.phase === "home" || s.phase === "emerging" || s.phase === "going-home" || busyWithTour() || event.button !== 0) {
      return;
    }
    event.preventDefault();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, samples: [{ t: performance.now(), x: event.clientX, y: event.clientY }] };
    wake();
    const move = (e: PointerEvent) => onPointerMove(e);
    const up = (e: PointerEvent) => finish(e, false);
    const cancel = (e: PointerEvent) => finish(e, true);
    const finish = (e: PointerEvent, cancelled: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      release(e, cancelled);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  const onPointerMove = (event: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) {
      return;
    }
    const now = performance.now();
    d.samples.push({ t: now, x: event.clientX, y: event.clientY });
    while (d.samples.length > 2 && now - d.samples[0].t > 110) {
      d.samples.shift();
    }
    const s = st.current;
    if (!d.moved && Math.hypot(event.clientX - d.x, event.clientY - d.y) > 6) {
      d.moved = true;
      if (menuOpen) {
        closeMenu();
      }
      if (s.phase === "reacting") {
        finishReaction(s.reactionId);
      }
      if (s.phase === "perched") {
        writePerched(false);
      }
      s.web = null;
      setOrigin("pivot");
      s.phase = "held";
      s.ground = null;
      s.tween = null;
      s.pivot = { x: event.clientX, y: event.clientY, vx: 0, vy: 0 };
      s.staggerUntil = 0;
      s.softLanding = false;
      s.omega = 0;
      document.body.classList.add("pip-dragging");
      show("held");
      if (Math.random() < 0.5) {
        speak(pick(WHEE));
      }
    }
    if (d.moved) {
      s.x = event.clientX;
      s.y = event.clientY + HOLD_DROP;
      // Letting go here would set Pip on the perch: light the seat.
      const over = overPerch(event.clientX, event.clientY);
      if (over !== perchHintOn.current) {
        perchHintOn.current = over;
        const spot = over ? readPerch() : null;
        setPerchHint(spot ? { x: spot.x, y: spot.y } : null);
      }
    }
  };

  const clearPerchHint = () => {
    if (perchHintOn.current) {
      perchHintOn.current = false;
      setPerchHint(null);
    }
  };

  const release = (event: PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) {
      return;
    }
    drag.current = null;
    document.body.classList.remove("pip-dragging");
    clearPerchHint();
    if (!d.moved) {
      if (!cancelled) {
        poke();
      }
      return;
    }
    const s = st.current;
    const first = d.samples[0];
    const lastSample = d.samples[d.samples.length - 1];
    const dt = Math.max(0.016, (lastSample.t - first.t) / 1000);
    const clamp = (v: number) => Math.max(-MAX_THROW, Math.min(MAX_THROW, v));
    s.vx = cancelled ? 0 : clamp((lastSample.x - first.x) / dt);
    s.vy = cancelled ? 0 : clamp((lastSample.y - first.y) / dt);
    if (!cancelled && Math.hypot(s.vx, s.vy) < PLACE_SPEED && overPerch(event.clientX, event.clientY) && hopToPerch()) {
      return;
    }
    s.bounced = false;
    s.leftHome = true;
    // The swing's angular speed (of the hanging angle) becomes the drawn spin.
    s.omega = -s.omega;
    setOrigin("center");
    s.phase = "flying";
    wake();
  };

  if (mode === "off") {
    return null;
  }

  const hidden = !view.visible || away;
  const touring = tour !== null;

  const scrollLayer = host === "scroll" ? document.querySelector<HTMLElement>("[data-pip-scroll-layer]") : null;

  const pip = (
    <>
      <button
        ref={bodyRef}
        type="button"
        className="pip-body"
        style={{ visibility: hidden ? "hidden" : "visible" }}
        aria-label="Pip. Drag to pick up and throw, select for a reaction, or open the context menu for shortcuts."
        aria-haspopup="menu"
        onPointerDown={onPointerDown}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            openMenu();
          }
        }}
        onClick={(event) => {
          // Keyboard activation only; pointer clicks are handled on release.
          if (event.detail === 0) {
            poke();
          }
        }}
      >
        <span className="pip-body-flip" style={{ transform: view.flip ? "scaleX(-1)" : undefined }}>
          <PipSprite
            move={view.move}
            size={SPRITE}
            skin={equipped.skin}
            outfit={equipped.outfit}
            loops={view.loops}
            playKey={view.key}
            still={view.still || hidden}
            onDone={onSpriteDone}
          />
        </span>
      </button>
      {say && !hidden && (
        <PipSay key={say.id} ref={sayRef} text={say.text} className="pip-say-world">
          {say.kind === "tour" && tour !== null
            ? tourControls(tour)
            : say.kind === "menu" && menuOpen
              ? menuItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="pip-say-button pip-say-menu-item"
                    onClick={() => {
                      closeMenu();
                      item.run();
                    }}
                  >
                    {item.label}
                  </button>
                ))
              : null}
        </PipSay>
      )}
    </>
  );

  return (
    <div ref={worldRef} className="pip-world" aria-hidden={hidden}>
      {touring && !away && <div ref={spotRef} className="pip-spotlight" aria-hidden="true" />}
      {perchHint && <div className="pip-perch-hint" style={{ left: perchHint.x, top: perchHint.y }} aria-hidden="true" />}
      <svg ref={webRef} className="pip-web" aria-hidden="true">
        <line className="pip-web-edge" />
        <line className="pip-web-core" />
      </svg>
      {scrollLayer ? createPortal(pip, scrollLayer) : pip}
    </div>
  );
};
