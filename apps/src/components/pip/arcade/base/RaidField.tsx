import { useEffect, useRef, type ReactNode } from "react";
import { frameGate, runScene } from "../frameGate";
import { paintGround, paintLive, type Looks, type RaidScene } from "./raidPaint";
import type { FieldView } from "./raidLayout";

/**
 * A raid's field on the page (the Magpie Lands, 2026-10-24): two canvases a pixel to each of the field's (the ground,
 * painted once, and what moves over it), scaled by the page a whole number of device pixels at a time, and whatever
 * is laid over them (tags, the targets a tap may pick) in `children`, placed by the same view.
 *
 * Still (scouting, planning) it is painted when what it shows changes (`paintKey`). In a fight `tick` is asked at
 * every frame the screen gives: it moves the battle on and says whether anything is moving, and the field is painted
 * at about thirty a second while it is, and not at all once everything has come to rest.
 */
/** `now`: seconds since the field was put up, the clock the field's specks and falls are timed by. */
export type FieldTick = (now: number) => { busy: boolean; blend: number };

type Props = {
  view: FieldView;
  scene: RaidScene;
  looks: Looks;
  /** What the still field shows, as a key: painted again when it changes. */
  paintKey: string;
  /** In a fight: moves it on, and says whether to keep painting. */
  tick?: FieldTick;
  label: string;
  children?: ReactNode;
};

export const RaidField = ({ view, scene, looks, paintKey, tick, label, children }: Props) => {
  const groundRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  /** When the field was first painted in a fight (the frames' clock, ms): kept when it is laid out again, so its clock runs on. */
  const startedRef = useRef(-1);

  // The ground: once for the field as it is turned, and for the approach picked out.
  useEffect(() => {
    if (groundRef.current) paintGround(groundRef.current, view, scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.orient, view.w, view.h, scene.battle, scene.art, scene.season]);

  // Still: painted when it changes.
  useEffect(() => {
    if (tick) return;
    const canvas = liveRef.current;
    const ctx = canvas?.getContext?.("2d");
    if (!canvas || !ctx) return;
    if (canvas.width !== view.w || canvas.height !== view.h) {
      canvas.width = view.w;
      canvas.height = view.h;
    }
    paintLive(ctx, view, scene, looks, 0, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintKey, view.orient, view.w, view.h, scene.battle, Boolean(tick)]);

  // In a fight: the battle moves on with the clock, and is painted while anything moves.
  const fighting = Boolean(tick);
  useEffect(() => {
    if (!fighting) return;
    const canvas = liveRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext?.("2d") ?? null;
    if (canvas.width !== view.w || canvas.height !== view.h) {
      canvas.width = view.w;
      canvas.height = view.h;
    }
    const gate = frameGate();
    const loop = runScene(
      canvas,
      (time) => {
        if (startedRef.current < 0) startedRef.current = time;
        const now = (time - startedRef.current) / 1000;
        const said = tickRef.current?.(now) ?? { busy: false, blend: 1 };
        if (ctx && gate.due(time)) paintLive(ctx, view, sceneRef.current, looks, now, said.blend);
        // At rest: looked at again in a while (the end card may want the field once more), not every frame.
        return said.busy ? undefined : 250;
      },
      { resumed: gate.reset }
    );
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fighting, view.orient, view.w, view.h, looks]);

  const size = { width: view.w * view.css, height: view.h * view.css, left: view.left, top: view.top };
  return (
    <div className="pip-raid-field" role="group" aria-label={label}>
      <canvas ref={groundRef} className={`${view.crisp ? "pip-sprite " : ""}pip-raid-canvas`} width={view.w} height={view.h} style={size} aria-hidden="true" />
      <canvas ref={liveRef} className={`${view.crisp ? "pip-sprite " : ""}pip-raid-canvas`} width={view.w} height={view.h} style={size} aria-hidden="true" />
      {children}
    </div>
  );
};
