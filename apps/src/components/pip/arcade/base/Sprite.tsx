import { useEffect, useRef } from "react";
import { gameArt, type GameArt } from "../gameArt";

/**
 * One of the camp's pictures, small, where a word would otherwise be: a
 * building on its button, a hero's face, a magpie camp on its card. Drawn
 * once onto a little canvas with square pixels, as large as fits its box.
 */

let shared: GameArt | null = null;
/** The camp's art in Pip's plain colours: these pictures have no Pip in them, so one set serves everyone. */
const art = () => (shared ??= gameArt("base", "", []));
/** The same art, for a picture made of several of these (the guide's front: `NightCard.tsx`). */
export const baseArt = art;

type Props = {
  name: string;
  variant?: number;
  /** The box to fit in, in CSS pixels. */
  box: number;
  className?: string;
  /** Which of its frames (1.5.11: a page's flutter); the first when not said. */
  frame?: number;
};

export const Sprite = ({ name, variant, box, className = "", frame = 0 }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sprite = art().sprite(name, frame, variant === undefined ? {} : { variant });
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !sprite) return;
    canvas.width = sprite.w;
    canvas.height = sprite.h;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, sprite.w, sprite.h);
    ctx.drawImage(sprite.image, 0, 0);
  }, [sprite]);
  if (!sprite) {
    return <span className={className} style={{ display: "inline-block", width: box, height: box }} aria-hidden="true" />;
  }
  // Whole steps of size where there is room for them, so the pixels stay square and even.
  const fit = Math.min(box / sprite.w, box / sprite.h);
  const scale = fit >= 1 ? Math.floor(fit * 2) / 2 : fit;
  return <canvas ref={canvasRef} className={`pip-sprite ${className}`} style={{ width: sprite.w * scale, height: sprite.h * scale }} aria-hidden="true" />;
};

const stillOnly = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** Frames a second Pip idles at where she is only a face beside her words. */
const FACE_FPS = 6;

/**
 * Pip herself, as the reader has dressed her, beside what she has to say:
 * the camp's to-dos are hers, so she is the one who says them.
 */
export const PipFace = ({ skin, outfit, box, move = "idle", className = "" }: { skin: string; outfit: readonly string[]; box: number; move?: string; className?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worn = outfit.join("|");
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const pip = gameArt("base", skin, worn ? worn.split("|") : []);
    const draw = (frame: number) => {
      const sprite = pip.pip(move, frame);
      if (canvas.width !== sprite.w || canvas.height !== sprite.h) {
        canvas.width = sprite.w;
        canvas.height = sprite.h;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, sprite.w, sprite.h);
      ctx.drawImage(sprite.image, 0, 0);
    };
    draw(0);
    if (stillOnly()) return;
    let frame = 0;
    const timer = window.setInterval(() => draw(++frame), 1000 / FACE_FPS);
    return () => window.clearInterval(timer);
  }, [skin, worn, move]);
  return <canvas ref={canvasRef} className={`pip-sprite ${className}`} style={{ width: box, height: box, objectFit: "contain" }} aria-hidden="true" />;
};
