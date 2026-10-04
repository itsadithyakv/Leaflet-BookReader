import { useEffect, useRef } from "react";
import { EVENT_MS, SKY_H, renderSky, skyEvents, skySignature, type SkyEvent, type SkyEventKind } from "../../pip/sky.js";
import { subscribeTick } from "../../pip/ticker";

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** Something asked for by hand (development only), under way since `at`. */
type Forced = { kind: SkyEventKind; at: number; seed: number };

/**
 * The sky over the garden, behind its glass: the real time of day, clouds
 * drifting, the sun or the moon and stars, birds, and now and then a dragon,
 * a shooting star or a balloon (pip/sky.js decides what and when, from the
 * clock alone).
 *
 * Cheap on purpose. It rides the sprites' shared 12-a-second clock (which
 * stops while the window is hidden), and draws only when the picture would
 * change: a cloud has moved a pixel, a bird is crossing. A still sky costs a
 * string comparison a tick. Without motion it is a still picture of the hour,
 * redrawn once a minute, with nothing flying.
 */
export const GardenSky = ({ width, scale }: { width: number; scale: number }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const still = prefersReducedMotion();
    let forced: Forced | null = null;
    let last = "";
    const draw = () => {
      const now = Date.now();
      // The clock's own rare things, or one asked for by hand.
      let events: SkyEvent[] = skyEvents(now);
      if (forced) {
        const t = (now - forced.at) / EVENT_MS[forced.kind];
        if (t >= 1) forced = null;
        else events = [{ kind: forced.kind, t, seed: forced.seed }];
      }
      const signature = skySignature(width, SKY_H, now, events, still);
      if (signature === last) return;
      last = signature;
      context.putImageData(renderSky(width, SKY_H, now, events, still), 0, 0);
    };
    draw();
    // Development only: `window.__pipSky("dragon")` sends one across now, to look at it
    // (`__pipSky("dragon", 0.5)` starts it halfway, for a hidden window that gets no frames).
    const hook = (kind: SkyEventKind = "dragon", through = 0) => {
      forced = { kind, at: Date.now() - through * EVENT_MS[kind], seed: Math.floor(Math.random() * 1000) };
      last = "";
      draw();
    };
    const dev = window as unknown as { __pipSky?: typeof hook };
    if (import.meta.env.DEV) dev.__pipSky = hook;
    const stop = still ? (() => { const timer = window.setInterval(draw, 60_000); return () => window.clearInterval(timer); })() : subscribeTick(draw);
    return () => {
      stop();
      if (import.meta.env.DEV) delete dev.__pipSky;
    };
  }, [width]);

  return <canvas ref={ref} width={width} height={SKY_H} className="pip-sprite pip-garden-sky" style={{ width: width * scale, height: SKY_H * scale }} aria-hidden="true" />;
};
