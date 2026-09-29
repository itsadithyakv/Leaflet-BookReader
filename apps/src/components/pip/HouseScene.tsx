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
import { PLOT_H, PLOT_W, renderGardenFloor, renderPlant, renderSoil } from "../../pip/garden.js";
import { subscribeTick } from "../../pip/ticker";
import { PipSprite } from "../PipSprite";
import { PipSay } from "../PipSay";
import { UiIcon } from "../UiIcon";
import { pixelsPerArtPixel } from "./PixelImage";
import { banner, burst, centerOf, confetti, dropSeed, popOff, puff, seedPixel, tossSeed, type Box, type Captured, type Point } from "./fx";

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
export const DROP_FROM = 26;
/** A seed tossed from a packet to above its plot, then dropped in. */
const TOSS_MS = 480;
const SEED_FALL_MS = 300;
/** The soil's top edge within a plot sprite (garden.js: SOIL_H is 7). */
const SOIL_TOP = PLOT_H - 8;

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
  plot: (plot: number) => Box | null;
  /** Where an item will sit in a slot of this floor, lifted by the drop it lands with. */
  dropStart: (slotId: string, itemId: string) => Box | null;
  /** A just-picked plant springs off its plot. Returns where it stood. */
  reap: (plot: number, plantId: string) => Box | null;
  /** The planting about to land in this plot sprouts in once its seed is down. */
  expectSprout: (plot: number, tossed: boolean) => void;
  /** A seed flies from a packet (if given), drops into the plot, and the soil puffs. */
  sow: (plot: number, from: Captured | null) => void;
  /** Confetti and a title over the room, for a big moment. */
  celebrate: (title: string, note: string) => void;
};

/** Evenings (and nights) the house dims and its lamps glow. */
const isEvening = (hour: number) => hour >= 19 || hour < 6;

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

type Phase = "rest" | "walk" | "act" | "pastime" | "held" | "fall" | "land";
type Arrival = { key: number; slot: string; fits: HouseSlot["fits"]; image: ImageData; box: { x: number; y: number; w: number; h: number } };
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
    drag: null as null | { id: number; startX: number; startY: number; moved: boolean }
  });
  const live = useRef({ scale, level, base, pastime, onActDone, onPoke });
  live.current = { scale, level, base, pastime, onActDone, onPoke };

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
  const seen = useRef<{ level: string; placed: Map<string, string>; wallpaper: string | null; floor: string | null } | null>(null);
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
    const before = seen.current;
    seen.current = { level: level.id, placed, wallpaper: decor.wallpaper, floor: decor.floor };
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
          popOff(renderItem(itemId, 0), shown, "lift");
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
        fresh.push({ key, slot: slotId, fits: slot.fits, image, box });
        later(DROP_LAND_MS, () => {
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
      if (fresh.length > 0) setArrivals((current) => [...current.filter((entry) => !fresh.some((next) => next.slot === entry.slot)), ...fresh]);
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
  const plotAt = useRef(new Map<number, { x: number; locked: boolean }>());
  // Plantings on their way in: which plot, and how long its seed takes to land.
  const sprouting = useRef(new Map<number, { until: number; delay: number }>());
  const boxes = useMemo(() => plotBoxes(level, plots?.length ?? 0), [level, plots?.length]);

  // A plot dug: the others shuffle along to make room and the new bed pops up.
  useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    (plots ?? []).forEach((plot, index) => {
      const node = plotNodes.current.get(plot.plot);
      const box = boxes[index];
      const was = plotAt.current.get(plot.plot);
      plotAt.current.set(plot.plot, { x: box.x, locked: Boolean(plot.locked) });
      if (!node || !was || reduced) return;
      const k = live.current.scale;
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
  const show =(move: string, loops?: number, key: string | number = `${move}-${Date.now()}`) =>
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
    s.phase = "rest";
    s.nextFree = performance.now() + FREE_MIN_MS + Math.random() * FREE_JITTER_MS;
    show(live.current.base, undefined, "rest");
  };

  // A new floor: Pip arrives in the middle, on the floor.
  useEffect(() => {
    const s = st.current;
    s.x = level.w / 2;
    s.y = level.walkY;
    s.vy = 0;
    rest();
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level.id]);

  useEffect(() => {
    place();
  });

  // Resting pose follows the mood.
  useEffect(() => {
    if (st.current.phase === "rest") show(base, undefined, "rest");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Something to do now, from the page: stop, face the reader, do it.
  useEffect(() => {
    if (!act) return;
    const s = st.current;
    if (s.phase === "held" || s.phase === "fall") {
      s.y = live.current.level.walkY;
      s.vy = 0;
      place();
    }
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
    // Edge-on at a quarter turn: the moment to swap.
    const timer = window.setTimeout(() => setLook(next), 110);
    return () => window.clearTimeout(timer);
    // look.key is read, not watched: only a new look starts a spin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey, hidePip]);

  const onSpriteDone = () => {
    const s = st.current;
    if (s.phase === "act") {
      live.current.onActDone();
      rest();
    } else if (s.phase === "pastime" || s.phase === "land") {
      rest();
    }
  };

  // The loop: strolls, free moments, falling after a drop.
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
          rest();
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
      } else if (s.phase === "rest" && !reduced && time > s.nextFree) {
        const move = Math.random() < 0.45 ? live.current.pastime() : null;
        if (move) {
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
    plot: (plot) => {
      const index = plotIndex(plot);
      return index < 0 ? null : onScreen(plotBoxes(live.current.level, plots?.length ?? 0)[index]);
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
        popOff(renderPlant(plantId, 1, true, 0), shown, "pick");
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
      if (!shown) return;
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
    celebrate: (title, note) => {
      const box = roomRef.current?.getBoundingClientRect();
      if (!box) return;
      confetti(box, { px: live.current.scale, count: 48 });
      banner(box, title, note);
    }
    // Everything it reads is on refs.
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
  const night = level.night || isEvening(new Date().getHours());
  const now = performance.now();

  return (
    <div ref={stageRef} className="pip-house-stage">
      <div
        ref={roomRef}
        className="pip-house-room"
        data-decorating={decorating || undefined}
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
                "--drop": `${Math.min(DROP_FROM, entry.box.y + entry.box.h) * scale}px`,
                filter: night ? "brightness(0.62) saturate(0.85)" : undefined
              } as CSSProperties
            }
          />
        ))}

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
                aria-label={line ? `Pip says “${line}” Select to poke, drag to carry, arrow keys to walk.` : "Pip. Select to poke, drag to carry, arrow keys to walk."}
              >
                <PipSprite move={view.move} size={pipSize} skin={look.skin} outfit={look.outfit} loops={view.loops} playKey={view.key} onDone={onSpriteDone} />
              </button>
            </div>
            {line && (
              <div className="pip-house-say" aria-hidden="true">
                <PipSay key={line} text={line} />
              </div>
            )}
          </div>
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
