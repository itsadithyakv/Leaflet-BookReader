import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { itemBox, renderHouseLevel, renderItem, type HouseLevel, type HouseSlot, type LevelDecor } from "../../pip/home.js";
import { BARREL_H, BARREL_W, PLOT_H, PLOT_W, renderBarrel, renderGardenFloor, renderPlant, renderSoil } from "../../pip/garden.js";
import { subscribeTick } from "../../pip/ticker";
import { onPipCue } from "../../pip/life";
import { playSound } from "../../pip/sound";
import { usePipWardrobeStore } from "../../store/pipWardrobeStore";
import { usePipStore } from "../../store/pipStore";
import { PipSprite } from "../PipSprite";
import { PipSay } from "../PipSay";
import { UiIcon } from "../UiIcon";
import { pixelsPerArtPixel } from "./PixelImage";
import { banner, burst, centerOf, confetti, dropSeed, floatText, popOff, puff, rain, seedPixel, tossSeed, type Box, type Captured, type Point } from "./fx";

/**
 * The room loops this many frames (4 s at 12 fps) so lamps flicker and fish
 * swim. The windows show the real time of day, fixed across the loop (they
 * used to run 1.6 hours of sky every loop and snap back). Each frame is drawn
 * once and kept, until the time of day moves on (every 10 minutes).
 */
const ROOM_LOOP = 48;
/** Pip's stroll, in floor pixels per second. */
const WALK_SPEED = 22;
const GRAVITY = 900;
/** A free moment comes every few seconds. */
const FREE_MIN_MS = 3500;
const FREE_JITTER_MS = 5000;
/** How far the pointer moves before a press on Pip becomes a carry. */
const DRAG_SLOP = 4;
/** Where the hand holds Pip: by the leaf, so its feet hang this far below. */
const HOLD_DROP = 26;
/** A piece of decor dropping into its spot, and when it hits the floor (in step with the CSS). */
const DROP_MS = 540;
const DROP_LAND_MS = 330;
/** How far above its spot a piece of decor starts its drop, in floor pixels. */
const DROP_FROM = 26;
/** A seed tossed from a packet to above its plot, then dropped in. */
const TOSS_MS = 480;
const SEED_FALL_MS = 300;
/** The soil's top edge within a plot sprite (garden.js: SOIL_H is 7). */
const SOIL_TOP = PLOT_H - 8;

// ---- Pip's own life in the house ----------------------------------------------------
// In free moments Pip goes and does things: sees a piece just put out, points
// out a plant that is ripe, yawns in the evening and goes to bed at night.
// Now and then, not all the time: most free moments are still a stroll or a
// hobby, so the house stays calm.

/** Bedtime, as the roaming Pip keeps it (PipWorld): late at night. */
const bedtime = (hour: number) => hour >= 22 || hour < 5;
/**
 * Pip in the Snug Bed (room.js, 42 x 24): his middle over the pillow, low
 * enough that his closed eyes sit at the quilt's top edge (the sleep pose's
 * eyes are 8 rows above its feet).
 */
const BED_PIP_X = 11;
const BED_PIP_Y = 17;
/**
 * From the quilt's top row down, the bed is drawn again over Pip, so he is
 * under the covers; except over the pillow, where his head rests on it.
 */
const BED_FRONT = 9;
const BED_PILLOW = { x: 5, w: 11, h: 7 };
/** A hop into bed. */
const HOP_MS = 420;
/** Woken, Pip stays up a while before going back to bed. */
const WOKEN_MS = 45_000;
/** A ripe plant is pointed out no more often than this. */
const POINT_EVERY_MS = 16_000;
/** A line of Pip's own (not the page's) stays up this long. */
const OWN_LINE_MS = 3600;
/** A piece of decor just put out is looked at once it has landed, and a beat. */
const VISIT_AFTER_MS = DROP_MS + 350;

const GREETINGS = ["you're back! good chapter?", "there you are. how was the book?", "welcome back, reader.", "back already? tell me everything."];
const RIPE_LINES = ["that one's ripe!", "ooh, pick that one.", "ripe and ready.", "seeds, right there."];
/** Focus sessions done when Pip last said hello (a preference of this device). */
const GREETED_KEY = "leaflet.pip.greetedSessions";
/** The barrel's water when the garden was last on screen, so new water can rain into it. */
const BARREL_SEEN_KEY = "leaflet.pip.barrelSeen";

const readNumber = (key: string) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  } catch {
    return null;
  }
};
const writeNumber = (key: string, value: number) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Remembered for this visit only.
  }
};

const pickOne = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

/**
 * Something Pip goes and does in a free moment: look at a new piece, point
 * out a ripe plant, go to bed, yawn, or a cue from the page (a wish granted).
 */
type Errand = {
  kind: "visit" | "ripe" | "bed" | "cue" | "yawn";
  /** Where to stand, in floor pixels; null: where he is. */
  x: number | null;
  /** Which way to face there. */
  face?: 1 | -1;
  move: string;
  loops: number;
  line?: string | null;
  /** Not before this (performance.now()). */
  after: number;
  /** Afterwards: into bed. */
  then?: "tuck";
};

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export type SceneAct = { move: string; loops: number; key: number };

/** One garden plot as the scene draws it. */
export type ScenePlot = {
  plot: number;
  /** null: empty soil. */
  plant: string | null;
  /** 0..1 */
  progress: number;
  ripe: boolean;
  /** Not dug yet: shown as a spot to buy. */
  locked?: boolean;
  /** What digging it costs, for the sign on a locked plot. */
  price?: number;
};

/**
 * What the page can ask of the scene: where things are on screen (for effects
 * that fly to them) and the garden's own moments, which need the plot sprites.
 */
export type HouseSceneHandle = {
  /** One art pixel, in CSS pixels. */
  pixel: () => number;
  room: () => DOMRect | null;
  /** Pip's box on screen; null while Pip is away (in a game). */
  pip: () => DOMRect | null;
  /** A point on Pip: the mouth (for food) or the top of the head (hearts rise from it). */
  pipPoint: (part: "mouth" | "head") => Point | null;
  /** Where an item will sit in a slot of this floor, lifted by the drop it lands with. */
  dropStart: (slotId: string, itemId: string) => Box | null;
  /** A just-picked plant springs off its plot. Returns where it stood. */
  reap: (plot: number, plantId: string) => Box | null;
  /** The planting about to land in this plot sprouts in once its seed is down. */
  expectSprout: (plot: number, tossed: boolean) => void;
  /** A seed flies from a packet (if given), drops into the plot, and the soil puffs. */
  sow: (plot: number, from: Captured | null) => void;
  /** Rain on these plots, saying how much water each took. Resolves as the last drop lands. */
  rain: (plots: Array<{ plot: number; gained: number }>) => Promise<void>;
  /** Confetti and a title over the room, for a big moment. */
  celebrate: (title: string, note: string) => void;
};

/** Evenings (and nights) the house dims and its lamps glow. */
const isEvening = (hour: number) => hour >= 19 || hour < 6;

/** Whether this floor is dark now: always-dark floors, and every floor in the evening. */
const nightNow = (level: HouseLevel) => level.night || isEvening(new Date().getHours());

/** A plant's drawn stage from its growth, as garden.js draws it: 0 seed, 1 sprout, 2 young, 3 grown. */
const plantStage = (progress: number) => (progress <= 0.02 ? 0 : progress < 0.34 ? 1 : progress < 0.75 ? 2 : 3);

/** The time of day the windows show: the hour, to the nearest 10 minutes. */
const clockHour = (date = new Date()) => date.getHours() + Math.floor(date.getMinutes() / 10) / 6;

/** Where the garden's plots sit on a floor: spread along the floor, soil on the ground. */
export const plotBoxes = (level: HouseLevel, count: number) => {
  const margin = 18;
  const span = level.w - margin * 2 - PLOT_W;
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(margin + (count > 1 ? (span * index) / (count - 1) : span / 2)),
    y: level.h - PLOT_H - 1,
    w: PLOT_W,
    h: PLOT_H
  }));
};

/** The piece of decor Pip sleeps in. */
const BED_ID = "bed";

/** Where the bed stands on this floor, if it is out: its box in floor pixels. */
const bedBox = (level: HouseLevel, decor: LevelDecor) => {
  const placed = decor.placed.find((entry) => entry.itemId === BED_ID);
  const slot = placed ? level.slots.find((entry) => entry.id === placed.slot) : null;
  return slot ? itemBox(BED_ID, slot) : null;
};

/** Where the rain barrel stands on a garden floor: the right-hand corner, beyond the last plot. */
const barrelBox = (level: HouseLevel) => ({ x: level.w - BARREL_W - 1, y: level.h - BARREL_H - 2, w: BARREL_W, h: BARREL_H });

// The barrel is drawn at a dozen levels of full, each once and kept.
const barrelArt = new Map<number, ImageData>();
const barrelImage = (fill: number) => {
  const step = Math.round(Math.max(0, Math.min(1, fill)) * 12);
  let image = barrelArt.get(step);
  if (!image) {
    image = renderBarrel(step / 12);
    barrelArt.set(step, image);
  }
  return image;
};

/**
 * Where a slot's pin goes, in floor pixels: on the thing in it, or where a
 * thing would stand (the floor, the shelf), hang (the wall) or dangle (the
 * ceiling). Pins, not the slots' whole boxes: the boxes overlap each other.
 */
const pinPoint = (slot: HouseSlot, inside: { x: number; y: number; w: number; h: number } | null): Point => {
  if (inside) return { x: inside.x + inside.w / 2, y: inside.y + inside.h / 2 };
  const x = slot.x + slot.w / 2;
  if (slot.fits === "ceiling") return { x, y: slot.y + 8 };
  if (slot.fits === "wall" || slot.fits === "window") return { x, y: slot.y + slot.h / 2 };
  if (slot.fits === "stand") return { x, y: slot.y + slot.h - 12 };
  return { x, y: slot.y + slot.h - 5 };
};

// Soil beds are two pictures (dug, planted); plants are a handful per plot and
// stage. Each is drawn once and kept, like the room's frames.
const soilArt = new Map<boolean, ImageData>();
const soilImage = (dug: boolean) => {
  let image = soilArt.get(dug);
  if (!image) {
    image = renderSoil(dug);
    soilArt.set(dug, image);
  }
  return image;
};
const plantArt = new Map<string, ImageData>();
const plantImage = (plant: string, step: number, ripe: boolean, frame: number) => {
  const key = `${plant}|${step}|${ripe}|${frame}`;
  let image = plantArt.get(key);
  if (!image) {
    if (plantArt.size > 600) plantArt.clear();
    image = renderPlant(plant, step / 20, ripe, frame);
    plantArt.set(key, image);
  }
  return image;
};

/** Still art at the room's scale, crisp like the floor under it. */
const SceneArt = ({ image, scale, className, style }: { image: ImageData | null; scale: number; className?: string; style?: CSSProperties }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
  }, [image]);
  if (!image) return null;
  return (
    <canvas
      ref={ref}
      className={`pip-sprite ${className ?? ""}`}
      style={{ width: image.width * scale, height: image.height * scale, ...style }}
      aria-hidden="true"
    />
  );
};

/** A plant on its bed; a ripe one glints and sways on the shared 12 fps clock. */
const PlantArt = ({ plant, step, ripe, scale, className, style }: { plant: string; step: number; ripe: boolean; scale: number; className: string; style?: CSSProperties }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = PLOT_W;
    canvas.height = PLOT_H;
    const draw = (frame: number) => context.putImageData(plantImage(plant, step, ripe, frame), 0, 0);
    draw(0);
    if (!ripe || prefersReducedMotion()) return;
    return subscribeTick((tick) => draw(tick % ROOM_LOOP));
  }, [plant, step, ripe]);
  return <canvas ref={ref} className={`pip-sprite ${className}`} style={{ width: PLOT_W * scale, height: PLOT_H * scale, ...style }} aria-hidden="true" />;
};

export type HouseSceneProps = {
  level: HouseLevel;
  /** The floor's place in the house, bottom first: which way a switch slides. */
  floorIndex?: number;
  decor: LevelDecor;
  skin: string;
  outfit: readonly string[];
  /** Something Pip does now (a poke, a treat, a celebration), in place. */
  act: SceneAct | null;
  onActDone: () => void;
  line: string | null;
  /** A move for a free moment, or null to stroll instead. */
  pastime: () => string | null;
  /** Pip's mood is very low: it mopes when resting. */
  mopey: boolean;
  onPoke: () => void;
  decorating: boolean;
  /** The slot being chosen for in the Decorate drawer, lit in the room. */
  selectedSlot?: string | null;
  onSlot: (slot: HouseSlot) => void;
  /** Names what is in a slot, for its label. */
  slotLabel: (slot: HouseSlot) => string;
  /** The arcade cabinet on this floor was selected. */
  onArcade?: () => void;
  /** Pip is elsewhere (in a game): the room shows without it. */
  hidePip?: boolean;
  /** The garden's plots, on a garden floor. */
  plots?: ScenePlot[];
  onPlot?: (plot: ScenePlot) => void;
  plotLabel?: (plot: ScenePlot) => string;
  label: string;
};

/** `errand`: doing a free moment's errand; `tuck`: hopping into bed; `sleep`: in it. */
type Phase = "rest" | "walk" | "act" | "pastime" | "held" | "fall" | "land" | "errand" | "tuck" | "sleep";
/** The bed's front, in floor pixels, drawn over Pip while he sleeps. */
type Tucked = { x: number; y: number; w: number; h: number };
/** A piece of decor on its way into a slot: dropping in over the art, which leaves it out until it lands. */
type Arrival = { key: number; slot: string; image: ImageData; box: { x: number; y: number; w: number; h: number } };
type Look = { skin: string; outfit: readonly string[]; key: string };

let arrivalKey = 1;

/**
 * One floor of Pip's house, big: the floor's art at a whole number of device
 * pixels per pixel (so the pixels stay square at any display scaling), and
 * Pip living in it at the same scale. Pip strolls, fills free moments, can be
 * picked up and dropped, and reacts when poked. In Decorate mode, each slot
 * of the floor gets a pin to choose what goes there.
 *
 * Pip's motion runs in one requestAnimationFrame loop on refs and writes its
 * transform directly; React state changes only when Pip changes what it is
 * doing. The loop stops when the tab is hidden or the scene unmounts.
 *
 * The scene animates its own changes: decor drops into place (and lifts out),
 * new wallpaper wipes over the old, a new floor slides in from above or below,
 * and Pip spins into a new look in a puff of smoke. The garden's plots are
 * sprites over the floor, so a ripe plant can sway, a picked one pop off and
 * a new one sprout.
 */
export const HouseScene = forwardRef<HouseSceneHandle, HouseSceneProps>(function HouseScene(
  {
    level,
    floorIndex = 0,
    decor,
    skin,
    outfit,
    act,
    onActDone,
    line,
    pastime,
    mopey,
    onPoke,
    decorating,
    selectedSlot = null,
    onSlot,
    slotLabel,
    onArcade,
    hidePip = false,
    plots,
    onPlot,
    plotLabel,
    label
  },
  ref
) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const roomRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipRef = useRef<HTMLDivElement | null>(null);
  const spinRef = useRef<HTMLDivElement | null>(null);
  const [per, setPer] = useState(3);
  const base = mopey ? "mope" : "idle";
  const [view, setView] = useState<{ move: string; loops?: number; key: string | number; flip: boolean }>({ move: base, key: "rest", flip: false });

  // ---- size: fill the width, and the window's height below the scene's top ----
  // The room's box just before a resize, so a change of scale can zoom from it.
  const lastRoomBox = useRef<DOMRect | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const width = stage.clientWidth;
      const top = stage.getBoundingClientRect().top;
      const height = Math.max(220, window.innerHeight - Math.max(0, top) - 28);
      lastRoomBox.current = roomRef.current?.getBoundingClientRect() ?? null;
      if (width > 0) setPer(pixelsPerArtPixel(level.w, level.h, width, height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [level.w, level.h]);

  const ratio = window.devicePixelRatio || 1;
  const scale = per / ratio;

  // Pip's own state, and what the loop and the effects read without re-rendering.
  const st = useRef({
    x: level.w / 2,
    y: level.walkY,
    vy: 0,
    phase: "rest" as Phase,
    target: level.w / 2,
    facing: 1,
    nextFree: 0,
    drag: null as null | { id: number; startX: number; startY: number; moved: boolean },
    /** What Pip is off to do, and what is waiting to be done. */
    errand: null as Errand | null,
    queue: [] as Errand[],
    /** Woken until then: no going back to bed. */
    wokeUntil: 0,
    /** A hop into bed, under way. */
    hop: null as null | { fromX: number; fromY: number; toX: number; toY: number; start: number },
    /** When a ripe plant was last pointed out (never, at first), and which. */
    pointedAt: -Infinity,
    lastPointed: -1,
    saidRipe: false,
    /** When asleep, when to next look at the clock for morning. */
    nightCheck: 0
  });
  const live = useRef({ scale, level, base, pastime, onActDone, onPoke, decor, plots, decorating });
  live.current = { scale, level, base, pastime, onActDone, onPoke, decor, plots, decorating };

  // Pip's own lines (a ripe plant pointed out, a wish come true); the page's
  // come first.
  const [ownLine, setOwnLine] = useState<string | null>(null);
  useEffect(() => {
    if (!ownLine) return;
    const timer = window.setTimeout(() => setOwnLine(null), OWN_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [ownLine]);
  const shownLine = line ?? ownLine;

  // The bed's front over Pip while he sleeps in it.
  const [tucked, setTucked] = useState<Tucked | null>(null);
  const tuckedRef = useRef<Tucked | null>(null);
  tuckedRef.current = tucked;
  const frontRef = useRef<HTMLCanvasElement | null>(null);

  // A new scale (a drawer opening beside the room) zooms from the old size
  // rather than jumping: the room eases to its new box.
  const shownPer = useRef(per);
  useLayoutEffect(() => {
    const room = roomRef.current;
    const before = lastRoomBox.current;
    const was = shownPer.current;
    shownPer.current = per;
    if (!room || !before || was === per || prefersReducedMotion()) return;
    const now = room.getBoundingClientRect();
    if (now.width === 0) return;
    room.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${before.left - now.left}px, ${before.top - now.top}px) scale(${before.width / now.width})` },
        { transformOrigin: "0 0", transform: "none" }
      ],
      { duration: 340, easing: "cubic-bezier(0.25, 0.9, 0.35, 1)" }
    );
  }, [per]);

  // ---- a new floor slides in: from above going up, from below going down ----
  const lastFloor = useRef<{ id: string; index: number } | null>(null);
  useLayoutEffect(() => {
    const room = roomRef.current;
    const before = lastFloor.current;
    lastFloor.current = { id: level.id, index: floorIndex };
    if (!room || !before || before.id === level.id || prefersReducedMotion()) return;
    const up = floorIndex > before.index;
    room.animate(
      [
        { transform: `translateY(${up ? -7 : 7}%)`, opacity: 0 },
        { transform: "none", opacity: 1 }
      ],
      { duration: 380, easing: "cubic-bezier(0.2, 0.85, 0.3, 1)" }
    );
  }, [level.id, floorIndex]);

  // ---- the floor's art, and decor arriving and leaving ----------------------------
  const decorKey = JSON.stringify(decor);
  // Slots whose new piece is still dropping in: the art leaves them out until it lands.
  const arriving = useRef(new Map<string, number>());
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const redraw = useRef<(() => void) | null>(null);
  // The decor as it was last drawn, to tell what arrived and what left.
  const drawn = useRef<{ level: string; placed: Map<string, string>; wallpaper: string | null; floor: string | null } | null>(null);
  const timers = useRef(new Set<number>());
  const later = (ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  };
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  /** A box in floor pixels, on screen. */
  const onScreen = (box: { x: number; y: number; w: number; h: number }): Box | null => {
    const room = roomRef.current?.getBoundingClientRect();
    if (!room) return null;
    const k = live.current.scale;
    return { left: room.left + box.x * k, top: room.top + box.y * k, width: box.w * k, height: box.h * k };
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduced = prefersReducedMotion();

    // What changed since the last draw of this floor: pieces to drop in or lift out.
    const placed = new Map(decor.placed.map((entry) => [entry.slot, entry.itemId]));
    const before = drawn.current;
    drawn.current = { level: level.id, placed, wallpaper: decor.wallpaper, floor: decor.floor };
    if (before && before.level !== level.id) {
      arriving.current.clear();
      setArrivals([]);
    }
    const sameFloor = before?.level === level.id;
    if (sameFloor && !reduced) {
      for (const [slotId, itemId] of before.placed) {
        if (placed.get(slotId) === itemId) continue;
        const slot = level.slots.find((entry) => entry.id === slotId);
        const box = slot ? itemBox(itemId, slot) : null;
        const shown = box ? onScreen(box) : null;
        if (!shown) continue;
        try {
          popOff(renderItem(itemId, 0), shown, "lift", nightNow(level));
        } catch {
          // Art mid-edit: no ghost.
        }
        puff({ x: shown.left + shown.width / 2, y: shown.top + shown.height }, { px: live.current.scale, count: 5, color: "#E9E1CF", edge: "#BDB3A0", spread: 30 });
      }
      const fresh: Arrival[] = [];
      for (const [slotId, itemId] of placed) {
        if (before.placed.get(slotId) === itemId) continue;
        const slot = level.slots.find((entry) => entry.id === slotId);
        const box = slot ? itemBox(itemId, slot) : null;
        if (!slot || !box) continue;
        let image: ImageData;
        try {
          image = renderItem(itemId, 0);
        } catch {
          continue;
        }
        const key = arrivalKey++;
        arriving.current.set(slotId, key);
        fresh.push({ key, slot: slotId, image, box });
        later(DROP_LAND_MS, () => {
          playSound("place");
          const shown = onScreen(box);
          if (!shown) return;
          const foot = { x: shown.left + shown.width / 2, y: shown.top + shown.height };
          const k = live.current.scale;
          if (slot.fits === "stand" || slot.fits === "rug" || slot.fits === "top") {
            puff(foot, { px: k, count: 8, color: "#E9E1CF", edge: "#BDB3A0", spread: Math.max(28, shown.width * 0.6) });
          } else {
            burst(centerOf(shown), { px: k, count: 7, sprite: "spark", spread: Math.max(30, shown.width * 0.6), lift: 8, fall: 6 });
          }
        });
        later(DROP_MS, () => {
          // The art takes the piece over first, then the falling copy goes: never a frame without it.
          if (arriving.current.get(slotId) === key) arriving.current.delete(slotId);
          redraw.current?.();
          setArrivals((current) => current.filter((entry) => entry.key !== key));
        });
      }
      if (fresh.length > 0) {
        setArrivals((current) => [...current.filter((entry) => !fresh.some((next) => next.slot === entry.slot)), ...fresh]);
        // Pip goes to see the newest piece once it has landed.
        const newest = fresh[fresh.length - 1];
        const fits = level.slots.find((entry) => entry.id === newest.slot)?.fits;
        if (fits) visit(newest.box, fits);
      }
    }

    // New wallpaper or flooring wipes over the old, top down or left to right.
    const finish = sameFloor && !reduced && (before.wallpaper !== decor.wallpaper || before.floor !== decor.floor) ? (before.wallpaper !== decor.wallpaper ? "wall" : "floor") : null;
    if (finish && canvas.width > 0) {
      const snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.className = "pip-sprite pip-house-canvas pip-house-wipe";
      snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
      canvas.after(snapshot);
      const wipe = snapshot.animate(
        finish === "wall"
          ? [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(100% 0 0 0)" }]
          : [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }],
        { duration: 620, easing: "cubic-bezier(0.45, 0, 0.3, 1)", fill: "both" }
      );
      const done = () => snapshot.remove();
      wipe.finished.then(done, done);
    }

    const toCanvas = (image: ImageData) => {
      const out = document.createElement("canvas");
      out.width = image.width;
      out.height = image.height;
      out.getContext("2d")?.putImageData(image, 0, 0);
      return out;
    };
    let hour = clockHour();
    let frames = new Map<number, HTMLCanvasElement>();
    let framesFor = "";
    let step = 0;
    const draw = (next: number) => {
      step = next;
      const now = clockHour();
      const hidden = [...arriving.current.keys()].sort().join(",");
      if (now !== hour || hidden !== framesFor) {
        hour = now;
        framesFor = hidden;
        frames = new Map();
      }
      let image = frames.get(next);
      if (!image) {
        try {
          const shown = hidden ? { ...decor, placed: decor.placed.filter((entry) => !arriving.current.has(entry.slot)) } : decor;
          const art = renderHouseLevel(level, next, shown, isEvening(Math.floor(hour)), hour) ?? renderGardenFloor(level.w, level.h, level.floorY, next);
          image = toCanvas(art);
        } catch {
          // Art mid-edit can throw; keep the last good frame.
          return;
        }
        frames.set(next, image);
      }
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, level.w, level.h);
      context.drawImage(image, 0, 0);
      // The bed's front over a sleeping Pip: the room's own pixels, lamps and
      // night light included, copied from the frame just drawn.
      const front = frontRef.current;
      const region = tuckedRef.current;
      const frontContext = front?.getContext("2d");
      if (front && region && frontContext) {
        frontContext.imageSmoothingEnabled = false;
        frontContext.clearRect(0, 0, region.w, region.h);
        frontContext.drawImage(canvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
        // His head on the pillow shows through.
        frontContext.clearRect(BED_PILLOW.x, 0, BED_PILLOW.w, BED_PILLOW.h);
      }
    };
    redraw.current = () => draw(step);
    draw(0);
    if (reduced) return;
    return subscribeTick((tick) => draw(tick % ROOM_LOOP));
    // decorKey stands in for decor, a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, decorKey]);

  // ---- the garden's plots ------------------------------------------------------------
  const plotsKey = JSON.stringify(plots ?? []);
  const plotNodes = useRef(new Map<number, HTMLDivElement>());
  const plotAt = useRef(new Map<number, { x: number; locked: boolean; plant: string | null; stage: number; ripe: boolean }>());
  // Plantings on their way in: which plot, and how long its seed takes to land.
  const sprouting = useRef(new Map<number, { until: number; delay: number }>());
  const boxes = useMemo(() => plotBoxes(level, plots?.length ?? 0), [level, plots?.length]);

  // A plot dug: the others shuffle along to make room and the new bed pops up.
  // A plant that grows a stage gives a little stretch; one that ripens sparkles.
  useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    (plots ?? []).forEach((plot, index) => {
      const node = plotNodes.current.get(plot.plot);
      const box = boxes[index];
      const was = plotAt.current.get(plot.plot);
      const stage = plantStage(plot.progress);
      plotAt.current.set(plot.plot, { x: box.x, locked: Boolean(plot.locked), plant: plot.plant, stage, ripe: plot.ripe });
      if (!node || !was || reduced) return;
      const k = live.current.scale;
      if (plot.plant && was.plant === plot.plant && (stage > was.stage || (plot.ripe && !was.ripe))) {
        node.querySelector(".pip-plot-plant")?.animate(
          [{ transform: "none" }, { transform: "scale(0.9, 1.18)", offset: 0.4 }, { transform: "scale(1.06, 0.95)", offset: 0.7 }, { transform: "none" }],
          { duration: 480, easing: "ease-out" }
        );
        if (plot.ripe && !was.ripe) {
          const shown = onScreen(box);
          if (shown) burst({ x: shown.left + shown.width / 2, y: shown.top + shown.height * 0.35 }, { px: k, count: 10, sprite: "spark", spread: shown.width, lift: 14, fall: 6 });
        }
      }
      if (was.x !== box.x) {
        node.animate([{ transform: `translateX(${(was.x - box.x) * k}px)` }, { transform: "none" }], {
          duration: 460,
          easing: "cubic-bezier(0.3, 1.25, 0.5, 1)"
        });
      }
      if (was.locked && !plot.locked) {
        node.animate(
          [
            { transform: "scale(0.2, 0.2)", opacity: 0 },
            { transform: "scale(1.15, 0.85)", opacity: 1, offset: 0.55 },
            { transform: "scale(0.95, 1.06)", offset: 0.8 },
            { transform: "none" }
          ],
          { duration: 560, delay: 120, easing: "ease-out", fill: "backwards" }
        );
        const shown = onScreen(box);
        if (shown) {
          puff({ x: shown.left + shown.width / 2, y: shown.top + shown.height - 4 * k }, { px: k, count: 10, spread: shown.width });
          confetti({ left: shown.left - shown.width, top: shown.top - shown.height, width: shown.width * 3, height: shown.height * 2 }, { px: k, count: 22 });
        }
      }
    });
    // plotsKey stands in for plots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotsKey, boxes]);

  // ---- Pip --------------------------------------------------------------------------
  const show = (move: string, loops?: number, key: string | number = `${move}-${Date.now()}`) =>
    setView({ move, loops, key, flip: st.current.facing < 0 });

  const place = () => {
    const s = st.current;
    const node = pipRef.current;
    if (!node) return;
    const { scale: k } = live.current;
    node.style.transform = `translate(${(s.x - 16) * k}px, ${(s.y - 30) * k}px)`;
  };

  const rest = () => {
    const s = st.current;
    const now = performance.now();
    s.phase = "rest";
    // Something waiting (a new piece to see, a cue) comes soon after; otherwise
    // the next free moment comes in a few seconds.
    const waiting = s.queue.length > 0 ? Math.min(...s.queue.map((errand) => errand.after)) : null;
    s.nextFree = waiting !== null ? Math.max(now + 600, waiting) : now + FREE_MIN_MS + Math.random() * FREE_JITTER_MS;
    show(live.current.base, undefined, "rest");
  };

  /** Says a line of Pip's own, under any the page is showing. */
  const say = (text: string | null | undefined) => {
    if (text) setOwnLine(text);
  };

  const clampX = (x: number) => Math.max(18, Math.min(live.current.level.w - 18, x));

  /** Out of bed (woken, dragged, or the floor changed), standing beside it, awake. */
  const untuck = () => {
    const s = st.current;
    if (s.phase !== "sleep" && s.phase !== "tuck") return;
    const { level: lv, decor: dc } = live.current;
    const bed = bedBox(lv, dc);
    setTucked(null);
    s.hop = null;
    s.x = bed ? clampX(bed.x + bed.w + 8) : s.x;
    s.y = lv.walkY;
    s.wokeUntil = performance.now() + WOKEN_MS;
    place();
    rest();
  };

  /** Pip lies down in the bed, under the quilt, asleep until something wakes him. */
  const sleepIn = (bed: { x: number; y: number; w: number; h: number }) => {
    const s = st.current;
    s.phase = "sleep";
    s.hop = null;
    s.x = bed.x + BED_PIP_X;
    s.y = bed.y + BED_PIP_Y;
    s.facing = 1;
    s.nightCheck = performance.now() + 30_000;
    place();
    show("sleep", undefined, "sleep");
    setTucked({ x: bed.x, y: bed.y + BED_FRONT, w: bed.w, h: bed.h - BED_FRONT });
  };

  /** Into bed: a hop from beside it, or straight in without motion. */
  const tuck = (instant: boolean) => {
    const s = st.current;
    const bed = bedBox(live.current.level, live.current.decor);
    if (!bed) {
      rest();
      return;
    }
    if (instant) {
      sleepIn(bed);
      return;
    }
    s.phase = "tuck";
    s.hop = { fromX: s.x, fromY: s.y, toX: bed.x + BED_PIP_X, toY: bed.y + BED_PIP_Y, start: performance.now() };
    show("land", undefined, "hop");
  };

  /** Arrived where an errand goes (or it goes nowhere): do it. */
  const arrive = () => {
    const s = st.current;
    const errand = s.errand;
    if (!errand) {
      rest();
      return;
    }
    if (errand.face) s.facing = errand.face;
    s.phase = "errand";
    show(errand.move, errand.loops, `errand-${Date.now()}`);
    say(errand.line);
  };

  const startErrand = (errand: Errand, reduced: boolean) => {
    const s = st.current;
    // Without motion, Pip does not walk anywhere: a bed is got into at once.
    if (reduced && errand.kind === "bed") {
      tuck(true);
      return;
    }
    s.errand = errand;
    if (errand.x !== null && !reduced && Math.abs(errand.x - s.x) > 2) {
      s.target = errand.x;
      s.facing = errand.x < s.x ? -1 : 1;
      s.phase = "walk";
      show("walk", undefined, "walk");
      return;
    }
    arrive();
  };

  /** A ripe plant to point out: stand beside it, facing it. */
  const ripeErrand = (): Errand | null => {
    const s = st.current;
    const { level: lv, plots: shown } = live.current;
    if (!shown) return null;
    const beds = plotBoxes(lv, shown.length);
    const ripe = shown.map((plot, index) => ({ plot, box: beds[index] })).filter(({ plot }) => plot.ripe && plot.plant && !plot.locked);
    if (ripe.length === 0) return null;
    const choice = ripe.find(({ plot }) => plot.plot !== s.lastPointed) ?? ripe[0];
    s.lastPointed = choice.plot.plot;
    const middle = choice.box.x + choice.box.w / 2;
    const fromLeft = Math.abs(middle - 17 - s.x) <= Math.abs(middle + 17 - s.x);
    let x = fromLeft ? middle - 17 : middle + 17;
    let face: 1 | -1 = fromLeft ? 1 : -1;
    if (x < 18) [x, face] = [middle + 17, -1];
    else if (x > lv.w - 18) [x, face] = [middle - 17, 1];
    // Said the first time only; after that the pointing says it.
    const line = s.saidRipe ? null : pickOne(RIPE_LINES);
    s.saidRipe = true;
    return { kind: "ripe", x, face, move: "point", loops: 3, line, after: 0 };
  };

  /**
   * What Pip does with a free moment, if anything in particular: what is
   * waiting first (a cue, a new piece to see), then bed at night, then now
   * and then a ripe plant, or an evening yawn. Null: a stroll or a hobby.
   */
  const plan = (now: number, reduced: boolean): Errand | null => {
    const s = st.current;
    const { level: lv, decor: dc, decorating: busy } = live.current;
    const ready = s.queue.findIndex((errand) => errand.after <= now);
    if (ready >= 0) return s.queue.splice(ready, 1)[0];
    if (busy) return null;
    const hour = new Date().getHours();
    const bed = bedBox(lv, dc);
    if (bed && bedtime(hour) && now > s.wokeUntil) {
      return { kind: "bed", x: clampX(bed.x + bed.w * 0.75), face: -1, move: "yawn", loops: 1, after: 0, then: "tuck" };
    }
    if (reduced) return null;
    if (now > s.pointedAt + POINT_EVERY_MS && Math.random() < 0.55) {
      const errand = ripeErrand();
      if (errand) {
        s.pointedAt = now;
        return errand;
      }
    }
    if (isEvening(hour) && Math.random() < 0.25) return { kind: "yawn", x: null, move: "yawn", loops: 1, after: 0 };
    return null;
  };

  /** A piece just put out: once it has landed, Pip goes over and looks at it (up at it, on a wall). */
  const visit = (box: { x: number; y: number; w: number; h: number }, fits: HouseSlot["fits"]) => {
    const s = st.current;
    const up = fits === "wall" || fits === "window" || fits === "ceiling";
    let x = box.x + box.w / 2;
    let face: 1 | -1 = x >= s.x ? 1 : -1;
    if (!up) {
      // Beside it, on the side nearer Pip, turned towards it.
      const left = box.x - 12;
      const right = box.x + box.w + 12;
      const fromLeft = Math.abs(left - s.x) <= Math.abs(right - s.x);
      [x, face] = fromLeft ? [left, 1] : [right, -1];
    }
    const after = performance.now() + VISIT_AFTER_MS;
    s.queue = [...s.queue.filter((errand) => errand.kind !== "visit"), { kind: "visit", x: clampX(x), face, move: up ? "pointup" : "look", loops: up ? 2 : 1, after }];
    if (s.phase === "rest") s.nextFree = Math.min(s.nextFree, after);
  };

  // A new floor: Pip arrives in the middle, on the floor, awake.
  useEffect(() => {
    const s = st.current;
    setTucked(null);
    s.hop = null;
    s.errand = null;
    s.queue = s.queue.filter((errand) => errand.kind === "cue");
    s.x = level.w / 2;
    s.y = level.walkY;
    s.vy = 0;
    rest();
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level.id]);

  // Decorating wakes Pip: the bed may be about to move.
  useEffect(() => {
    if (decorating) untuck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decorating]);

  // The bed's front is drawn from the room's own frame: draw it as it appears.
  useLayoutEffect(() => {
    redraw.current?.();
  }, [tucked]);

  // Cues from the page (a wish granted): done when Pip is next free.
  useEffect(
    () =>
      onPipCue((cue) => {
        const s = st.current;
        const after = performance.now() + 300;
        s.queue = [...s.queue.filter((errand) => errand.kind !== "cue" || errand.move !== cue.move), { kind: "cue", x: null, move: cue.move, loops: cue.loops ?? 1, line: cue.line ?? null, after }];
        if (s.phase === "rest") s.nextFree = Math.min(s.nextFree, after);
      }),
    []
  );

  useEffect(() => {
    place();
  });

  // Resting pose follows the mood.
  useEffect(() => {
    if (st.current.phase === "rest") show(base, undefined, "rest");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Something to do now, from the page: stop (getting out of bed if need be),
  // face the reader, do it. An errand under way waits until after.
  useEffect(() => {
    if (!act) return;
    const s = st.current;
    untuck();
    if (s.phase === "held" || s.phase === "fall") {
      s.y = live.current.level.walkY;
      s.vy = 0;
      place();
    }
    if (s.errand && s.errand.kind !== "bed") s.queue.push({ ...s.errand, after: 0 });
    s.errand = null;
    s.phase = "act";
    show(act.move, act.loops, `act-${act.key}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act?.key]);

  // A new look (the wardrobe, a preview) goes on in a spin and a puff of smoke:
  // the old look turns edge-on, and the new one turns back round.
  const lookKey = `${skin}|${outfit.join("+")}`;
  const [look, setLook] = useState<Look>({ skin, outfit, key: lookKey });
  useLayoutEffect(() => {
    if (lookKey === look.key) return;
    const next = { skin, outfit, key: lookKey };
    const spinner = spinRef.current;
    if (!hidePip) playSound("pop", { pitch: 1.5, volume: 0.45 });
    if (hidePip || !spinner || prefersReducedMotion()) {
      setLook(next);
      return;
    }
    spinner.animate(
      [
        { transform: "translateY(0) rotateY(0deg)" },
        { transform: "translateY(-14%) rotateY(180deg)", offset: 0.45 },
        { transform: "translateY(0) rotateY(360deg)" }
      ],
      { duration: 520, easing: "cubic-bezier(0.4, 0, 0.3, 1)" }
    );
    const box = spinner.getBoundingClientRect();
    const k = live.current.scale;
    const middle = { x: box.left + box.width / 2, y: box.top + box.height * 0.6 };
    puff(middle, { px: k, count: 10, color: "#FFFFFF", edge: "#DCD6C8", spread: box.width * 0.55, rise: box.height * 0.25, duration: 620 });
    burst(middle, { px: k, count: 6, sprite: "spark", spread: box.width * 0.7, lift: box.height * 0.2, fall: 4 });
    // Edge-on at a quarter turn (about 150 ms in, on that curve): the moment to swap.
    const timer = window.setTimeout(() => setLook(next), 150);
    return () => window.clearTimeout(timer);
    // look.key is read, not watched: only a new look starts a spin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey, hidePip]);

  const onSpriteDone = () => {
    const s = st.current;
    if (s.phase === "act") {
      live.current.onActDone();
      rest();
    } else if (s.phase === "errand") {
      const errand = s.errand;
      s.errand = null;
      if (errand?.then === "tuck") tuck(false);
      else rest();
    } else if (s.phase === "pastime" || s.phase === "land") {
      rest();
    }
  };

  // Hidden (in a game), Pip is not in bed either.
  useEffect(() => {
    if (hidePip) untuck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidePip]);

  // The loop: strolls, free moments, errands, falling after a drop, a hop into bed.
  useEffect(() => {
    if (hidePip) return;
    const reduced = prefersReducedMotion();
    let raf = 0;
    let last = 0;
    const tick = (time: number) => {
      const dt = last ? Math.min(0.05, (time - last) / 1000) : 0;
      last = time;
      const s = st.current;
      const { level: lv } = live.current;
      if (s.phase === "walk") {
        const dir = s.target < s.x ? -1 : 1;
        s.x += dir * WALK_SPEED * dt;
        if ((dir < 0 && s.x <= s.target) || (dir > 0 && s.x >= s.target)) {
          s.x = s.target;
          arrive();
        }
        place();
      } else if (s.phase === "fall") {
        s.vy += GRAVITY * dt;
        s.y += s.vy * dt;
        if (s.y >= lv.walkY) {
          s.y = lv.walkY;
          s.vy = 0;
          s.phase = "land";
          show("land", 1);
        }
        place();
      } else if (s.phase === "tuck" && s.hop) {
        // A little arc from beside the bed into it.
        const hop = s.hop;
        const t = Math.min(1, (time - hop.start) / HOP_MS);
        s.x = hop.fromX + (hop.toX - hop.fromX) * t;
        s.y = hop.fromY + (hop.toY - hop.fromY) * t - Math.sin(t * Math.PI) * 12;
        place();
        if (t >= 1) {
          const bed = bedBox(lv, live.current.decor);
          if (bed) sleepIn(bed);
          else rest();
        }
      } else if (s.phase === "sleep" && time > s.nightCheck) {
        // Morning comes while the tab is open: up, with a stretch.
        s.nightCheck = time + 30_000;
        if (!bedtime(new Date().getHours())) {
          untuck();
          s.wokeUntil = 0;
          s.errand = { kind: "cue", x: null, move: "stretch", loops: 1, after: 0 };
          arrive();
        }
      } else if (s.phase === "rest" && time > s.nextFree) {
        const errand = plan(time, reduced);
        const move = errand || reduced ? null : Math.random() < 0.45 ? live.current.pastime() : null;
        if (errand) {
          startErrand(errand, reduced);
        } else if (reduced) {
          // Without motion there are no strolls; look again in a while.
          s.nextFree = time + 5000;
        } else if (move) {
          s.phase = "pastime";
          show(move, 2);
        } else {
          const margin = 18;
          let target = margin + Math.random() * (lv.w - margin * 2);
          if (Math.abs(target - s.x) < 20) target = s.x < lv.w / 2 ? s.x + 40 : s.x - 40;
          s.target = Math.max(margin, Math.min(lv.w - margin, target));
          s.facing = s.target < s.x ? -1 : 1;
          s.phase = "walk";
          show("walk", undefined, "walk");
        }
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!raf && document.visibilityState === "visible") {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hidePip]);

  // ---- coming back after reading --------------------------------------------------------
  // A focus session done since Pip last saw the reader (on this device): Pip
  // says hello, out of bed if need be. Not on a first look (nothing to come
  // back from), and not over a celebration already queued, which says it.
  const sessionsDone = usePipWardrobeStore((state) => state.overview?.sessionsDone ?? null);
  const suspended = usePipStore((state) => state.suspended);
  useEffect(() => {
    if (sessionsDone === null || suspended || hidePip) return;
    const seen = readNumber(GREETED_KEY);
    if (seen !== null && sessionsDone <= seen) return;
    const timer = window.setTimeout(() => {
      writeNumber(GREETED_KEY, sessionsDone);
      const pip = usePipStore.getState();
      if (seen === null || pip.reaction || pip.queue.length > 0) return;
      pip.react("welcome", { loops: 1, line: pickOne(GREETINGS) });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [sessionsDone, suspended, hidePip]);

  // ---- the rain barrel -----------------------------------------------------------------
  // On a garden floor: the water reading poured while nothing grew, waiting for
  // the next planting. New water since the garden was last on screen rains
  // into it, after the plots have had theirs.
  const gardenWater = usePipWardrobeStore((state) => state.overview?.garden ?? null);
  const barrel = plots ? barrelBox(level) : null;
  const barrelWater = gardenWater ? Math.round(gardenWater.barrel) : 0;
  const barrelCap = gardenWater?.barrelCap ?? 120;
  useEffect(() => {
    if (!barrel || !gardenWater || suspended) return;
    const seen = readNumber(BARREL_SEEN_KEY);
    if (seen === null || barrelWater - seen < 1 || prefersReducedMotion()) {
      writeNumber(BARREL_SEEN_KEY, barrelWater);
      return;
    }
    const timer = window.setTimeout(() => {
      writeNumber(BARREL_SEEN_KEY, barrelWater);
      const shown = onScreen(barrel);
      if (!shown) return;
      const k = live.current.scale;
      floatText({ x: shown.left + shown.width / 2, y: shown.top - 6 * k }, `+${barrelWater - seen} water`, "water");
      void rain(shown, shown.top + 4 * k, { px: k, count: 8, spread: 420 });
    }, 1100);
    return () => window.clearTimeout(timer);
    // The barrel box follows the floor; its water is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barrel !== null, barrelWater, suspended]);

  // ---- what the page can ask of the scene ------------------------------------------------
  const plotIndex = (plot: number) => (plots ?? []).findIndex((entry) => entry.plot === plot);
  useImperativeHandle(ref, () => ({
    pixel: () => live.current.scale,
    room: () => roomRef.current?.getBoundingClientRect() ?? null,
    pip: () => spinRef.current?.getBoundingClientRect() ?? null,
    pipPoint: (part) => {
      const box = spinRef.current?.getBoundingClientRect();
      if (!box) return null;
      // Pip's mouth sits a little forward of centre, in the 32 px frame.
      const forward = st.current.facing < 0 ? -1 : 1;
      return part === "mouth"
        ? { x: box.left + box.width * (0.5 + (3 / 32) * forward), y: box.top + box.height * (18 / 32) }
        : { x: box.left + box.width / 2, y: box.top + box.height * (8 / 32) };
    },
    dropStart: (slotId, itemId) => {
      const slot = live.current.level.slots.find((entry) => entry.id === slotId);
      const box = slot ? itemBox(itemId, slot) : null;
      return box ? onScreen({ ...box, y: box.y - DROP_FROM }) : null;
    },
    reap: (plot, plantId) => {
      const index = plotIndex(plot);
      if (index < 0) return null;
      const shown = onScreen(plotBoxes(live.current.level, plots?.length ?? 0)[index]);
      if (!shown) return null;
      const k = live.current.scale;
      try {
        popOff(renderPlant(plantId, 1, true, 0), shown, "pick", nightNow(live.current.level));
      } catch {
        // Art mid-edit: the seeds still fly.
      }
      const middle = { x: shown.left + shown.width / 2, y: shown.top + shown.height * 0.45 };
      burst(middle, { px: k, count: 12, colors: ["#8FD66A", "#4FA84A", "#2F7A36", "#FFE36B"], spread: shown.width * 1.1, lift: shown.height * 0.3 });
      puff({ x: middle.x, y: shown.top + SOIL_TOP * k }, { px: k, count: 6, spread: shown.width * 0.7 });
      return shown;
    },
    expectSprout: (plot, tossed) => {
      if (prefersReducedMotion()) return;
      const delay = (tossed ? TOSS_MS : 0) + SEED_FALL_MS;
      sprouting.current.set(plot, { until: performance.now() + delay + 2500, delay });
    },
    sow: (plot, from) => {
      const index = plotIndex(plot);
      const shown = index < 0 ? null : onScreen(plotBoxes(live.current.level, plots?.length ?? 0)[index]);
      if (!shown || prefersReducedMotion()) {
        playSound("pop");
        return;
      }
      const k = live.current.scale;
      const soil = { x: shown.left + shown.width / 2, y: shown.top + SOIL_TOP * k };
      const above = { x: soil.x, y: soil.y - Math.max(70, 16 * k) };
      const size = seedPixel(k);
      const tossed = from ? tossSeed(centerOf(from.rect), above, size) : Promise.resolve();
      void tossed
        .then(() => dropSeed(above, soil, size))
        .then(() => {
          puff(soil, { px: k, count: 8, spread: shown.width * 0.8 });
          plotNodes.current.get(plot)?.animate([{ transform: "scale(1, 1)" }, { transform: "scale(1.06, 0.9)", offset: 0.35 }, { transform: "none" }], {
            duration: 260,
            easing: "ease-out"
          });
        });
    },
    rain: (watered) => {
      const k = live.current.scale;
      const all = plotBoxes(live.current.level, plots?.length ?? 0);
      const falls = watered.map(({ plot, gained }, order) => {
        const index = plotIndex(plot);
        const shown = index < 0 ? null : onScreen(all[index]);
        if (!shown) return Promise.resolve();
        const soil = shown.top + SOIL_TOP * k;
        // One plot after another, left to right, like a passing shower.
        return new Promise<void>((done) => window.setTimeout(done, order * 220))
          .then(() => {
            floatText({ x: shown.left + shown.width / 2, y: shown.top - 6 * k }, `+${Math.round(gained)} water`, "water");
            return rain(shown, soil, { px: k, count: 10 + Math.min(8, Math.round(gained / 6)) });
          })
          .then(() => puff({ x: shown.left + shown.width / 2, y: soil }, { px: k, count: 5, color: "#BFE6FF", edge: "#7CC8FF", spread: shown.width * 0.6, rise: 8 }));
      });
      return Promise.all(falls).then(() => undefined);
    },
    celebrate: (title, note) => {
      const box = roomRef.current?.getBoundingClientRect();
      if (!box) return;
      confetti(box, { px: live.current.scale, count: 48 });
      banner(box, title, note);
    }
    // The floor, the scale and Pip are read from refs; the plots are the one
    // prop it closes over, and plotsKey says when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [plotsKey]);

  // ---- carrying Pip ---------------------------------------------------------------
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const s = st.current;
    s.drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    const stage = stageRef.current;

    const move = (e: PointerEvent) => {
      const drag = s.drag;
      if (!drag || e.pointerId !== drag.id || !stage) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_SLOP) return;
      if (!drag.moved) {
        drag.moved = true;
        // Lifted out of bed, or off an errand: it can wait.
        untuck();
        s.errand = null;
        s.phase = "held";
        show("held", undefined, "held");
      }
      const rect = stage.getBoundingClientRect();
      const { scale: k, level: lv } = live.current;
      const x = (e.clientX - rect.left) / k;
      if (Math.abs(x - s.x) > 0.5) s.facing = x < s.x ? -1 : 1;
      s.x = Math.max(10, Math.min(lv.w - 10, x));
      s.y = Math.max(28, Math.min(lv.walkY, (e.clientY - rect.top) / k + HOLD_DROP));
      place();
    };
    const up = (e: PointerEvent) => {
      const drag = s.drag;
      if (!drag || e.pointerId !== drag.id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      s.drag = null;
      if (drag.moved) {
        s.phase = "fall";
        s.vy = 0;
        show("fall", undefined, "fall");
      } else {
        live.current.onPoke();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const s = st.current;
    const lv = live.current.level;
    const dir = event.key === "ArrowLeft" ? -1 : 1;
    untuck();
    s.errand = null;
    s.facing = dir;
    s.target = Math.max(18, Math.min(lv.w - 18, s.x + dir * 24));
    s.phase = prefersReducedMotion() ? "rest" : "walk";
    if (s.phase === "rest") {
      s.x = s.target;
      place();
    }
    show(s.phase === "walk" ? "walk" : live.current.base, undefined, s.phase === "walk" ? "walk" : "rest");
  };

  const arcadeSlot = level.arcade
    ? decor.placed.find((entry) => /arcade|cabinet/i.test(entry.itemId) || /arcade|cabinet/i.test(entry.slot))
    : undefined;
  const arcadeBox = arcadeSlot ? level.slots.find((slot) => slot.id === arcadeSlot.slot) : undefined;
  const pipSize = 32 * scale;
  const night = nightNow(level);
  const now = performance.now();

  return (
    <div ref={stageRef} className="pip-house-stage">
      <div
        ref={roomRef}
        className="pip-house-room"
        data-decorating={decorating || undefined}
        data-night={night || undefined}
        style={{ width: level.w * scale, height: level.h * scale }}
        role="group"
        aria-label={label}
      >
        <canvas ref={canvasRef} width={level.w} height={level.h} className="pip-sprite pip-house-canvas" aria-hidden="true" />

        {arrivals.map((entry) => (
          <SceneArt
            key={entry.key}
            image={entry.image}
            scale={scale}
            className="pip-decor-drop"
            style={
              {
                left: entry.box.x * scale,
                top: entry.box.y * scale,
                "--drop": `${Math.min(DROP_FROM, entry.box.y + entry.box.h) * scale}px`
              } as CSSProperties
            }
          />
        ))}

        {barrel && (
          <div
            className="pip-barrel"
            role="img"
            aria-label={`Rain barrel: ${barrelWater} of ${barrelCap} water, for the next planting. Reading in focus fills it while nothing is growing.`}
            title={`Rain barrel: ${barrelWater} / ${barrelCap} water`}
            style={{ left: barrel.x * scale, top: barrel.y * scale }}
          >
            <SceneArt image={barrelImage(barrelWater / Math.max(1, barrelCap))} scale={scale} />
          </div>
        )}

        {plots &&
          boxes.map((box, index) => {
            const plot = plots[index];
            const state = plot.locked ? "locked" : plot.ripe ? "ripe" : plot.plant ? "growing" : "empty";
            const fresh = sprouting.current.get(plot.plot);
            const sprout = fresh && fresh.until > now ? fresh : null;
            return (
              <div
                key={plot.plot}
                ref={(node) => {
                  if (node) plotNodes.current.set(plot.plot, node);
                  else plotNodes.current.delete(plot.plot);
                }}
                className="pip-plot"
                data-state={state}
                style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale, ["--plot" as string]: index }}
              >
                {plot.locked ? (
                  <span className="pip-plot-dig" aria-hidden="true">
                    <span className="pip-plot-dig-plus">+</span>
                    {plot.price ? <span className="pip-plot-dig-price">{plot.price}</span> : null}
                  </span>
                ) : (
                  <>
                    <SceneArt image={soilImage(!plot.plant)} scale={scale} className="pip-plot-soil" />
                    {plot.plant && (
                      <PlantArt
                        key={plot.plant}
                        plant={plot.plant}
                        step={Math.floor(plot.progress * 20)}
                        ripe={plot.ripe}
                        scale={scale}
                        className={sprout ? "pip-plot-plant pip-plant-sprout" : "pip-plot-plant"}
                        style={sprout ? { animationDelay: `${sprout.delay}ms` } : undefined}
                      />
                    )}
                    {plot.plant && !plot.ripe && (
                      <span className="pip-plot-bar" aria-hidden="true">
                        <span style={{ transform: `scaleX(${Math.max(0.04, plot.progress).toFixed(3)})` }} />
                      </span>
                    )}
                  </>
                )}
                {onPlot && !decorating && (
                  <button
                    type="button"
                    className="pip-house-hotspot pip-plot-hit"
                    onClick={() => onPlot(plot)}
                    aria-label={plotLabel?.(plot) ?? `Plot ${plot.plot}`}
                    title={plotLabel?.(plot)}
                  />
                )}
              </div>
            );
          })}

        {arcadeBox && onArcade && !decorating && (
          <button
            type="button"
            className="pip-house-hotspot pip-house-arcade"
            style={{ left: arcadeBox.x * scale, top: arcadeBox.y * scale, width: arcadeBox.w * scale, height: arcadeBox.h * scale }}
            onClick={onArcade}
            aria-label="The arcade cabinet: play a game"
            title="Play a game"
          />
        )}

        {!hidePip && (
          <div ref={pipRef} className="pip-house-pip" style={{ width: pipSize, height: pipSize }}>
            <div ref={spinRef} className="pip-house-pip-spin">
              <button
                type="button"
                className="pip-house-pip-button"
                style={{ width: pipSize, height: pipSize, transform: view.flip ? "scaleX(-1)" : undefined }}
                onPointerDown={onPointerDown}
                onClick={(event) => {
                  // Pointer presses are handled on release; this is the keyboard.
                  if (event.detail === 0) onPoke();
                }}
                onKeyDown={onKeyDown}
                aria-label={
                  shownLine
                    ? `Pip says “${shownLine}” Select to poke, drag to carry, arrow keys to walk.`
                    : tucked
                      ? "Pip, asleep in bed. Select to wake, drag to carry, arrow keys to walk."
                      : "Pip. Select to poke, drag to carry, arrow keys to walk."
                }
              >
                <PipSprite move={view.move} size={pipSize} skin={look.skin} outfit={look.outfit} loops={view.loops} playKey={view.key} onDone={onSpriteDone} />
              </button>
            </div>
            {shownLine && (
              <div className="pip-house-say" aria-hidden="true">
                <PipSay key={shownLine} text={shownLine} />
              </div>
            )}
          </div>
        )}

        {/* The bed's front, over Pip while he sleeps: tucked in under the quilt. */}
        {tucked && !hidePip && (
          <canvas
            ref={frontRef}
            width={tucked.w}
            height={tucked.h}
            className="pip-sprite pip-bed-front"
            style={{ left: tucked.x * scale, top: tucked.y * scale, width: tucked.w * scale, height: tucked.h * scale }}
            aria-hidden="true"
          />
        )}

        {decorating &&
          level.slots.map((slot) => {
            const inside = decor.placed.find((entry) => entry.slot === slot.id)?.itemId ?? null;
            const pin = pinPoint(slot, inside ? itemBox(inside, slot) : null);
            return (
              // A point-sized button at the pin: the dot and the slot's outline hang off it.
              <button
                key={slot.id}
                type="button"
                className="pip-slot-pin"
                data-kind={slot.fits}
                data-filled={inside ? true : undefined}
                aria-pressed={selectedSlot === slot.id}
                style={{ left: pin.x * scale, top: pin.y * scale }}
                onClick={() => onSlot(slot)}
                aria-label={slotLabel(slot)}
                title={slotLabel(slot)}
              >
                <span
                  className="pip-slot-area"
                  aria-hidden="true"
                  style={{ left: (slot.x - pin.x) * scale, top: (slot.y - pin.y) * scale, width: slot.w * scale, height: slot.h * scale }}
                />
                <span className="pip-slot-dot" aria-hidden="true">
                  <UiIcon name={inside ? "edit" : "plus"} size={inside ? 12 : 15} />
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
});
