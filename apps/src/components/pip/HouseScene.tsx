import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { renderHouseLevel, type HouseLevel, type HouseSlot, type LevelDecor } from "../../pip/home.js";
import { PLOT_H, PLOT_W, renderGardenFloor, renderPlot } from "../../pip/garden.js";
import { subscribeTick } from "../../pip/ticker";
import { PipSprite } from "../PipSprite";
import { PipSay } from "../PipSay";
import { pixelsPerArtPixel } from "./PixelImage";

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

export type HouseSceneProps = {
  level: HouseLevel;
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

/**
 * One floor of Pip's house, big: the floor's art at a whole number of device
 * pixels per pixel (so the pixels stay square at any display scaling), and
 * Pip living in it at the same scale. Pip strolls, fills free moments, can be
 * picked up and dropped, and reacts when poked. In Decorate mode, each slot
 * of the floor is a button.
 *
 * Pip's motion runs in one requestAnimationFrame loop on refs and writes its
 * transform directly; React state changes only when Pip changes what it is
 * doing. The loop stops when the tab is hidden or the scene unmounts.
 */
export const HouseScene = ({
  level,
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
  onSlot,
  slotLabel,
  onArcade,
  hidePip = false,
  plots,
  onPlot,
  plotLabel,
  label
}: HouseSceneProps) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipRef = useRef<HTMLDivElement | null>(null);
  const [per, setPer] = useState(3);
  const base = mopey ? "mope" : "idle";
  const [view, setView] = useState<{ move: string; loops?: number; key: string | number; flip: boolean }>({ move: base, key: "rest", flip: false });

  // ---- size: fill the width, and the window's height below the scene's top ----
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const width = stage.clientWidth;
      const top = stage.getBoundingClientRect().top;
      const height = Math.max(220, window.innerHeight - Math.max(0, top) - 28);
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

  // ---- the floor's art ----------------------------------------------------------
  const decorKey = JSON.stringify(decor);
  const plotsKey = JSON.stringify(plots ?? []);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const toCanvas = (image: ImageData) => {
      const out = document.createElement("canvas");
      out.width = image.width;
      out.height = image.height;
      out.getContext("2d")?.putImageData(image, 0, 0);
      return out;
    };
    const boxes = plotBoxes(level, plots?.length ?? 0);
    let hour = clockHour();
    let frames = new Map<number, HTMLCanvasElement>();
    const plotFrames = new Map<string, HTMLCanvasElement>();
    const draw = (step: number) => {
      const now = clockHour();
      if (now !== hour) {
        hour = now;
        frames = new Map();
      }
      let image = frames.get(step);
      if (!image) {
        try {
          const art =
            renderHouseLevel(level, step, decor, isEvening(Math.floor(hour)), hour) ??
            renderGardenFloor(level.w, level.h, level.floorY, step);
          image = toCanvas(art);
        } catch {
          // Art mid-edit can throw; keep the last good frame.
          return;
        }
        frames.set(step, image);
      }
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, level.w, level.h);
      context.drawImage(image, 0, 0);
      (plots ?? []).forEach((plot, index) => {
        if (plot.locked) return;
        const key = `${plot.plant}|${Math.floor(plot.progress * 20)}|${plot.ripe}|${step}`;
        let sprite = plotFrames.get(key);
        if (!sprite) {
          sprite = toCanvas(renderPlot(plot.plant, plot.progress, plot.ripe, step));
          plotFrames.set(key, sprite);
        }
        context.drawImage(sprite, boxes[index].x, boxes[index].y);
      });
    };
    draw(0);
    if (prefersReducedMotion()) return;
    return subscribeTick((tick) => draw(tick % ROOM_LOOP));
    // decorKey and plotsKey stand in for decor and plots, new objects on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, decorKey, plotsKey]);

  // ---- Pip --------------------------------------------------------------------------
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

  return (
    <div ref={stageRef} className="pip-house-stage">
      <div className="pip-house-room" style={{ width: level.w * scale, height: level.h * scale }} role="group" aria-label={label}>
        <canvas ref={canvasRef} width={level.w} height={level.h} className="pip-sprite pip-house-canvas" aria-hidden="true" />

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

        {decorating &&
          level.slots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              className="pip-house-hotspot pip-house-slot"
              data-kind={slot.fits}
              style={{ left: slot.x * scale, top: slot.y * scale, width: Math.max(12, slot.w) * scale, height: Math.max(12, slot.h) * scale }}
              onClick={() => onSlot(slot)}
              aria-label={slotLabel(slot)}
              title={slotLabel(slot)}
            />
          ))}

        {plots &&
          onPlot &&
          !decorating &&
          plotBoxes(level, plots.length).map((box, index) => {
            const plot = plots[index];
            return (
              <button
                key={plot.plot}
                type="button"
                className="pip-house-hotspot pip-plot"
                data-state={plot.locked ? "locked" : plot.ripe ? "ripe" : plot.plant ? "growing" : "empty"}
                style={{ left: box.x * scale, top: (box.y - 4) * scale, width: box.w * scale, height: (box.h + 4) * scale }}
                onClick={() => onPlot(plot)}
                aria-label={plotLabel?.(plot) ?? `Plot ${plot.plot}`}
                title={plotLabel?.(plot)}
              >
                {plot.locked && <span className="pip-plot-sign">+</span>}
                {!plot.locked && plot.plant && !plot.ripe && (
                  <span className="pip-plot-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(plot.progress * 100)}%` }} />
                  </span>
                )}
              </button>
            );
          })}

        {!hidePip && (
          <div ref={pipRef} className="pip-house-pip" style={{ width: pipSize, height: pipSize }}>
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
              <PipSprite move={view.move} size={pipSize} skin={skin} outfit={outfit} loops={view.loops} playKey={view.key} onDone={onSpriteDone} />
            </button>
            {line && (
              <div className="pip-house-say" aria-hidden="true">
                <PipSay key={line} text={line} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
