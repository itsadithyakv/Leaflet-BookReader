import { useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { frameGate, runScene } from "../frameGate";
import { screenRatio } from "./fit";
import { paintGround, paintLive, type Looks, type RaidScene } from "./raidPaint";
import { NO_PAN, clampPan, easeCamera, groundBox, type FieldView, type Pan } from "./raidLayout";

/**
 * A raid's field on the page (the Magpie Lands, 2026-10-24): two canvases a pixel to each of the field's (the ground,
 * painted once, and what moves over it), scaled by the page a whole number of device pixels at a time, and whatever
 * is laid over them (tags, the targets a tap may pick) in `children`, placed by the same view. The ground's canvas
 * covers the whole room, the land round the stronghold carried out to its edges on the field's own pixel grid, so the
 * field is never a picture in a frame.
 *
 * Still (scouting, planning) it is painted when what it shows changes (`paintKey`). In a fight `tick` is asked at
 * every frame the screen gives: it moves the battle on and says whether anything is moving, and the field is painted
 * at about thirty a second while it is, and not at all once everything has come to rest.
 *
 * (2026-10-25) The view is framed on the stronghold (`raidLayout.ts` `framedView`), so some of the field lies past the
 * room's edges: a drag moves the picture over it, within `pan`, and in a fight `camera` says where the picture wants
 * to be, which it eases to slowly. Under reduced motion it is not asked: the picture moves only under a finger. What is
 * moved is one layer (both canvases and what is laid over them), by a transform, never a paint.
 */
/** `now`: seconds since the field was put up, the clock the field's specks and falls are timed by. */
export type FieldTick = (now: number) => { busy: boolean; blend: number };
/** Where the picture is, from where it was framed, in CSS pixels. */
export type PanAt = { dx: number; dy: number };

/** A pointer moved this far (CSS pixels) is a drag, not a tap. */
const DRAG_FROM = 6;
/** After a drag the picture is the reader's: the camera leaves it where it was put for so long (ms). */
const HANDS_OFF_MS = 4000;

type Props = {
  view: FieldView;
  /** The room the raid has, in CSS pixels: the ground covers it. */
  roomW: number;
  roomH: number;
  /** How far a drag may move the picture. None: it stays as framed. */
  pan?: Pan;
  /** In a fight, and not still: where the picture wants to be, asked each frame. */
  camera?: () => PanAt | null;
  /** Kept up to date with where the picture is, for what is dropped on it. */
  panRef?: MutableRefObject<PanAt>;
  scene: RaidScene;
  looks: Looks;
  /** What the still field shows, as a key: painted again when it changes. */
  paintKey: string;
  /** In a fight: moves it on, and says whether to keep painting. */
  tick?: FieldTick;
  label: string;
  children?: ReactNode;
};

export const RaidField = ({ view, roomW, roomH, pan = NO_PAN, camera, panRef, scene, looks, paintKey, tick, label, children }: Props) => {
  const groundRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  /** When the field was first painted in a fight (the frames' clock, ms): kept when it is laid out again, so its clock runs on. */
  const startedRef = useRef(-1);

  // ---- where the picture is: from where it was framed, moved by a drag or the camera
  const at = useRef<PanAt>({ dx: 0, dy: 0 });
  const handsOffUntil = useRef(0);
  const place = (next: PanAt) => {
    const kept = clampPan(pan, next.dx, next.dy, screenRatio());
    at.current = kept;
    if (panRef) panRef.current = kept;
    const layer = layerRef.current;
    if (layer) layer.style.transform = kept.dx === 0 && kept.dy === 0 ? "" : `translate(${kept.dx}px, ${kept.dy}px)`;
  };
  // Framed again (the room changed, the next step): back home.
  const panKey = `${view.left}|${view.top}|${view.css}|${pan.minX}|${pan.maxX}|${pan.minY}|${pan.maxY}`;
  useEffect(() => {
    place({ dx: 0, dy: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panKey]);

  const pannable = pan.minX < 0 || pan.maxX > 0 || pan.minY < 0 || pan.maxY > 0;
  const drag = useRef<{ id: number; x: number; y: number; from: PanAt; moving: boolean } | null>(null);
  const dragged = useRef(false);
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pannable || (event.pointerType === "mouse" && event.button !== 0)) return;
    // A drag that starts on a chip or a tag is theirs (the planner's drag onto a path), not the picture's.
    const on = event.target instanceof Element ? event.target : null;
    if (on?.closest?.(".pip-raid-tag, .pip-raid-target")) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, from: { ...at.current }, moving: false };
    dragged.current = false;
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const was = drag.current;
    if (!was || was.id !== event.pointerId) return;
    const dx = event.clientX - was.x;
    const dy = event.clientY - was.y;
    if (!was.moving) {
      if (Math.hypot(dx, dy) < DRAG_FROM) return;
      was.moving = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // No capture: the drag stops at the picture's edge.
      }
    }
    handsOffUntil.current = performance.now() + HANDS_OFF_MS;
    place({ dx: was.from.dx + dx, dy: was.from.dy + dy });
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    const was = drag.current;
    if (!was || was.id !== event.pointerId) return;
    drag.current = null;
    if (was.moving) {
      dragged.current = true;
      handsOffUntil.current = performance.now() + HANDS_OFF_MS;
    }
  };
  // The click that ends a drag is not a tap on what it ended over.
  const swallow = (event: React.MouseEvent) => {
    if (!dragged.current) return;
    dragged.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  // The ground: once for the field as it is laid out in the room, with land enough for wherever it is panned.
  const box = groundBox(view, roomW, roomH, pan);
  useEffect(() => {
    if (groundRef.current) paintGround(groundRef.current, view, scene, box);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.orient, view.w, view.h, box.w, box.h, box.ox, box.oy, scene.battle, scene.art, scene.season, scene.region, scene.edge?.x0, scene.edge?.x1]);

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

  // In a fight: the battle moves on with the clock, and is painted while anything moves; the camera eases with it.
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
    let last = -1;
    const loop = runScene(
      canvas,
      (time) => {
        if (startedRef.current < 0) startedRef.current = time;
        const now = (time - startedRef.current) / 1000;
        const said = tickRef.current?.(now) ?? { busy: false, blend: 1 };
        const dt = last < 0 ? 0 : Math.min(0.1, (time - last) / 1000);
        last = time;
        // The camera, at every frame the screen gives (a transform, not a paint), while the fight goes on.
        const want = said.busy && time >= handsOffUntil.current && !drag.current ? cameraRef.current?.() : null;
        if (want) {
          const next = easeCamera(at.current, want, dt, screenRatio());
          if (next.dx !== at.current.dx || next.dy !== at.current.dy) place(next);
        }
        if (ctx && gate.due(time)) paintLive(ctx, view, sceneRef.current, looks, now, said.blend);
        // At rest: looked at again in a while (the end card may want the field once more), not every frame.
        return said.busy ? undefined : 250;
      },
      {
        resumed: () => {
          gate.reset();
          last = -1;
        }
      }
    );
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fighting, view.orient, view.w, view.h, looks]);

  const size = { width: view.w * view.css, height: view.h * view.css, left: view.left, top: view.top };
  const land = { width: box.w * view.css, height: box.h * view.css, left: box.left, top: box.top };
  return (
    <div
      className="pip-raid-field"
      role="group"
      aria-label={label}
      data-pannable={pannable ? "" : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClickCapture={swallow}
    >
      <div ref={layerRef} className="pip-raid-pan">
        <canvas ref={groundRef} className={`${view.crisp ? "pip-sprite " : ""}pip-raid-canvas`} width={box.w} height={box.h} style={land} aria-hidden="true" data-ground="" />
        <canvas ref={liveRef} className={`${view.crisp ? "pip-sprite " : ""}pip-raid-canvas`} width={view.w} height={view.h} style={size} aria-hidden="true" />
        {children}
      </div>
    </div>
  );
};
