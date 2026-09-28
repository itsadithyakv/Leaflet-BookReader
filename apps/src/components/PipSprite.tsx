import { useEffect, useRef, useState } from "react";
import { LIB, SCENERY, SKINS, dress, renderFrame, resolve, type PipMove, type PipSkin } from "../pip/core";
import { currentTick, subscribeTick, TICKS_PER_SECOND } from "../pip/ticker";

// Looked up by id, and re-indexed when LIB grows: the book scenes register
// themselves after start-up (see loadBookScenes).
let moveIndex: Record<string, PipMove> = {};
let indexedCount = -1;
const moveById = (id: string): PipMove | undefined => {
  if (indexedCount !== LIB.length + SCENERY.length) {
    moveIndex = Object.fromEntries([...LIB, ...SCENERY].map((move) => [move.id, move]));
    indexedCount = LIB.length + SCENERY.length;
  }
  return moveIndex[id];
};
const SKIN_BY_ID: Record<string, PipSkin> = Object.fromEntries(SKINS.map((skin) => [skin.id, skin]));

// Frames are pure functions of (move, skin, frame), so each is drawn once and
// reused. A whole move in one skin is a few hundred KB at most; the cap only
// guards against a session that plays every move in every skin.
const frames = new Map<string, ImageData>();
const FRAME_CAP = 4000;

/**
 * A skin wearing an outfit. A dressed skin keeps its base's id, so the outfit
 * is part of every cache key below; dressing is memoised so a sprite does not
 * build a new skin object (and restart its move) on every render.
 */
const dressed = new Map<string, PipSkin>();
const wearing = (skin: PipSkin, outfitKey: string) => {
  if (!outfitKey) {
    return skin;
  }
  const key = `${skin.id}|${outfitKey}`;
  let worn = dressed.get(key);
  if (!worn) {
    worn = dress(skin, outfitKey.split("+"));
    dressed.set(key, worn);
  }
  return worn;
};

const frameFor = (move: PipMove, skin: PipSkin, outfitKey: string, frame: number) => {
  const looped = ((frame % move.loop) + move.loop) % move.loop;
  const key = `${move.id}|${skin.id}|${outfitKey}|${looped}`;
  let image = frames.get(key);
  if (!image) {
    if (frames.size >= FRAME_CAP) {
      frames.clear();
    }
    image = renderFrame(move, looped, resolve(skin, looped));
    frames.set(key, image);
  }
  return image;
};

let scratch: HTMLCanvasElement | null = null;
const scratchContext = () => {
  if (!scratch) {
    scratch = document.createElement("canvas");
    scratch.width = 32;
    scratch.height = 32;
  }
  return scratch.getContext("2d");
};

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * Pixel art only stays crisp at a whole number of device pixels per sprite
 * pixel. Windows commonly scales by 125% or 150%, so the scale is chosen in
 * device pixels and the CSS size derived from it, never rounding up past the
 * size asked for.
 */
/** The CSS size a sprite of `size` actually renders at on this display. */
export const pipCssSize = (size: number, snap: "down" | "nearest" = "down") => pixelScale(size, snap).css;

const pixelScale = (size: number, snap: "down" | "nearest") => {
  const ratio = window.devicePixelRatio || 1;
  const exact = (size * ratio) / 32;
  const perPixel = Math.max(1, snap === "nearest" ? Math.round(exact) : Math.floor(exact + 1e-6));
  return { backing: perPixel * 32, css: (perPixel * 32) / ratio };
};

export type PipSpriteProps = {
  /** A move id from the library; unknown ids fall back to idle. */
  move: string;
  /** Target size in CSS pixels. The sprite never renders larger than this. */
  size: number;
  skin?: string;
  /** Accessory ids worn over the skin (the Pip tab's wardrobe). */
  outfit?: readonly string[];
  /** Play this many loops, then call `onDone`. Omit to loop forever. */
  loops?: number;
  onDone?: () => void;
  /** Changing this restarts the move, so the same reaction can play twice. */
  playKey?: string | number;
  className?: string;
  label?: string;
  /** Hold the move's still pose instead of animating. */
  still?: boolean;
  /**
   * "down" (default) never exceeds `size`. "nearest" may overshoot slightly,
   * for spots like the header where a much smaller sprite reads worse.
   */
  snap?: "down" | "nearest";
};

export const PipSprite = ({
  move,
  size,
  skin = "sprout",
  outfit,
  loops,
  onDone,
  playKey,
  className,
  label,
  still = false,
  snap = "down"
}: PipSpriteProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [scale, setScale] = useState(() => pixelScale(size, snap));

  // Re-measure on resize and on a change of display scale, which does not
  // always fire resize (dragging the window to a monitor with other scaling).
  useEffect(() => {
    let query: MediaQueryList | null = null;
    const update = () => {
      setScale(pixelScale(size, snap));
      query?.removeEventListener("change", update);
      try {
        query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        query.addEventListener("change", update);
      } catch {
        query = null;
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      query?.removeEventListener("change", update);
    };
  }, [size, snap]);

  const definition = moveById(move) ?? (moveById("idle") as PipMove);
  // A string, so a new array with the same items is the same outfit.
  const outfitKey = outfit && outfit.length > 0 ? outfit.join("+") : "";
  const skinDefinition = wearing(SKIN_BY_ID[skin] ?? SKINS[0], outfitKey);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const source = scratchContext();
    if (!canvas || !context || !source || !scratch) {
      return;
    }
    const draw = (frame: number) => {
      source.putImageData(frameFor(definition, skinDefinition, outfitKey, frame), 0, 0);
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(scratch as HTMLCanvasElement, 0, 0, canvas.width, canvas.height);
    };
    const totalFrames = loops ? loops * definition.loop : Infinity;

    // Reduced motion: one still pose. A finite move still "ends" on time, so
    // anything waiting on it (the Nook returning to idle) behaves the same.
    if (still || prefersReducedMotion()) {
      draw(definition.poster);
      if (!Number.isFinite(totalFrames)) {
        return;
      }
      const timer = window.setTimeout(() => onDoneRef.current?.(), (totalFrames / TICKS_PER_SECOND) * 1000);
      return () => window.clearTimeout(timer);
    }

    const start = currentTick();
    let finished = false;
    draw(0);
    return subscribeTick((tick) => {
      if (finished) {
        return;
      }
      const frame = tick - start;
      if (frame >= totalFrames) {
        finished = true;
        onDoneRef.current?.();
        return;
      }
      draw(frame);
    });
  }, [definition, skinDefinition, outfitKey, loops, playKey, scale.backing, still]);

  return (
    <canvas
      ref={canvasRef}
      width={scale.backing}
      height={scale.backing}
      className={`pip-sprite ${className ?? ""}`}
      style={{ width: scale.css, height: scale.css }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
};
