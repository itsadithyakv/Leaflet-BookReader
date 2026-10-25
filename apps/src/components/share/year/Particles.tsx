import { useEffect, useRef } from "react";
import type { SceneClock } from "./controls";
import { clamp01, easeOut, seeded } from "./draw";
import type { ScenePalette } from "./scenes";

/**
 * The story's particles, all on one canvas over the stage: pages lifting out
 * of Pip's book at the opening, confetti over the summary. Capped (fewer on a
 * phone), drawn as plain filled shapes, and only for the few seconds they
 * fly: then the canvas is cleared and nothing runs. Not at all with motion
 * reduced.
 */

export type ParticleKind = "pages" | "confetti";

/** At most this many at once: a phone's GPU is not to be spent on paper. */
export const PARTICLE_CAP = { pages: 22, confetti: 56 } as const;
const FLY_MS = { pages: 4200, confetti: 3800 } as const;

type Particle = { x: number; y: number; vx: number; vy: number; spin: number; turn: number; size: number; colour: string; delay: number; sway: number };

const make = (kind: ParticleKind, count: number, palette: ScenePalette): Particle[] => {
  const random = seeded(kind === "pages" ? 31 : 47);
  const colours = kind === "pages" ? ["#fffbf0", "#fffbf0", "#f3ead6", palette.accent] : [palette.accent, palette.glow, "#fffbf0", "#72ab44", "#b5d294", "#e2557a"];
  return Array.from({ length: count }, (_, at) => ({
    // Pages leave the book (by Pip, low in the middle); confetti falls from above the top.
    x: kind === "pages" ? 0.5 + (random() - 0.5) * 0.12 : random(),
    y: kind === "pages" ? 0.7 : -0.05 - random() * 0.25,
    vx: kind === "pages" ? (random() - 0.5) * 0.5 : (random() - 0.5) * 0.12,
    vy: kind === "pages" ? -(0.32 + random() * 0.32) : 0.28 + random() * 0.22,
    spin: (random() - 0.5) * 5,
    turn: random() * Math.PI,
    size: kind === "pages" ? 0.04 + random() * 0.03 : 0.012 + random() * 0.012,
    colour: colours[at % colours.length],
    delay: random() * (kind === "pages" ? 1600 : 700),
    sway: random() * Math.PI * 2
  }));
};

export const Particles = ({ kind, clock, still, palette, start = 300 }: { kind: ParticleKind; clock: SceneClock; still: boolean; palette: ScenePalette; start?: number }) => {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext("2d");
    if (still || !node || !context || typeof requestAnimationFrame === "undefined") return undefined;
    const narrow = window.innerWidth < 700;
    const count = Math.round(PARTICLE_CAP[kind] * (narrow ? 0.7 : 1));
    const flock = make(kind, count, palette);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const box = node.getBoundingClientRect();
    node.width = Math.max(1, Math.round(box.width * ratio));
    node.height = Math.max(1, Math.round(box.height * ratio));
    const width = box.width;
    const height = box.height;
    let frame = 0;
    const run = () => {
      const time = clock.time() - start;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (time >= FLY_MS[kind]) {
        return;
      }
      for (const bit of flock) {
        const age = (time - bit.delay) / 1000;
        if (age <= 0) continue;
        const life = clamp01(age / ((FLY_MS[kind] - bit.delay) / 1000));
        // In and out softly: the last third fades.
        const fade = Math.min(clamp01(age * 4), 1 - clamp01((life - 0.66) / 0.34));
        const rise = kind === "pages" ? easeOut(Math.min(1, age / 3)) * 3 : age;
        const x = (bit.x + bit.vx * rise + Math.sin(bit.sway + age * 2.2) * 0.015) * width;
        const y = (bit.y + bit.vy * rise) * height;
        const size = bit.size * width;
        context.save();
        context.translate(x, y);
        context.rotate(bit.turn + bit.spin * age * 0.4);
        context.globalAlpha = fade * (kind === "pages" ? 0.92 : 0.95);
        context.fillStyle = bit.colour;
        if (kind === "pages") {
          context.fillRect(-size / 2, -size * 0.65, size, size * 1.3);
          context.fillStyle = "rgba(31, 42, 34, 0.18)";
          context.fillRect(-size * 0.32, -size * 0.3, size * 0.64, size * 0.07);
          context.fillRect(-size * 0.32, -size * 0.05, size * 0.64, size * 0.07);
        } else {
          // A strip that turns over as it falls: its width flips, which reads as a twist.
          const flip = Math.cos(bit.sway + age * 6);
          context.fillRect(-size, (-size * 0.45) * flip, size * 2, size * 0.9 * flip || 1);
        }
        context.restore();
      }
      frame = requestAnimationFrame(run);
    };
    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [kind, clock, still, palette, start]);
  return <canvas ref={canvas} className="ys-particles" aria-hidden="true" />;
};
