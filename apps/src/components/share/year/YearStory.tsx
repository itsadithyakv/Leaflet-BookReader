import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Share2, X } from "lucide-react";
import { framing, type YearReview } from "../yearReview";
import { HOLD_MS, SceneClock, keyAction, releaseAction, stepTo, type StoryAction } from "./controls";
import { grainUrl } from "./draw";
import { Particles } from "./Particles";
import { SceneView } from "./SceneView";
import { ShareSheet } from "./ShareSheet";
import { PALETTE, SCENE_MS, chooseScenes, type SceneId } from "./scenes";
import "./story.css";

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * The year as a story (docs/design/year-in-pages.md): full screen and upright
 * on a phone; on a computer a 9:16 stage in the middle of a window washed in
 * the scene's colours. Tap or click right to go on, left to go back, hold to
 * pause, swipe down (or Esc) to close; the arrow keys too. Bars at the top
 * say how far it has come. A scene with nothing to say is not in it.
 *
 * Every scene can be shared as a picture (`ShareSheet`), the summary most of
 * all. With motion reduced each scene is its held end, and they wait to be
 * moved on.
 */
export const YearStory = ({
  review,
  covers,
  onClose,
  earlier,
  later,
  onYear,
  still: forcedStill = false,
  startAt = 0
}: {
  review: YearReview;
  covers: Map<string, CanvasImageSource>;
  onClose: () => void;
  /** The years either side with reading in them, to step to from the summary. */
  earlier?: number;
  later?: number;
  onYear?: (year: number) => void;
  /** Every scene at its held end (reduced motion; and for pictures of the screen). */
  still?: boolean;
  startAt?: number;
}) => {
  const scenes = useMemo(() => chooseScenes(review), [review]);
  const [at, setAt] = useState(() => Math.min(Math.max(0, startAt), scenes.length - 1));
  const [leaving, setLeaving] = useState<{ id: SceneId; key: number } | null>(null);
  const [held, setHeld] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [highlightAt, setHighlightAt] = useState(0);
  const [visit, setVisit] = useState(0);
  const still = forcedStill || reducedMotion();
  const id = scenes[Math.min(at, scenes.length - 1)];
  const palette = PALETTE[id];
  const paused = held || sharing || hidden;
  // A fresh clock for each visit to a scene: going back plays it again.
  const clock = useMemo(() => new SceneClock(), [at, visit]);
  const stage = useRef<HTMLDivElement | null>(null);
  const press = useRef<{ x: number; y: number; at: number; timer: number; held: boolean; id: number } | null>(null);
  const title = framing(review).title;

  useEffect(() => {
    if (paused) clock.pause();
    else clock.resume();
  }, [paused, clock]);

  useEffect(() => setAt((current) => Math.min(current, scenes.length - 1)), [scenes.length]);

  const go = useCallback(
    (action: Exclude<StoryAction, null>) => {
      const next = stepTo(at, scenes.length, action);
      if (next === null) {
        onClose();
        return;
      }
      if (next === at) {
        return;
      }
      if (!still) {
        setLeaving({ id, key: Date.now() });
      }
      setAt(next);
      setVisit((count) => count + 1);
    },
    [at, scenes.length, id, onClose, still]
  );

  // The leaving scene fades under the new one, then goes.
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => setLeaving(null), 460);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  // Keys, and a hidden window pauses it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (sharing) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setSharing(false);
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (event.key === " " && target?.closest?.("button")) return;
      const action = keyAction(event.key);
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        go(action);
      }
    };
    const onVisible = () => setHidden(document.hidden);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [go, sharing]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stage.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest?.("[data-ys-control]") || event.button > 0) return;
    const timer = window.setTimeout(() => {
      if (press.current) {
        press.current.held = true;
        setHeld(true);
      }
    }, HOLD_MS);
    press.current = { x: event.clientX, y: event.clientY, at: performance.now(), timer, held: false, id: event.pointerId };
    // Let go anywhere (off the stage, off the window) still ends the hold.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const down = press.current;
    if (!down || down.id !== event.pointerId) return;
    window.clearTimeout(down.timer);
    press.current = null;
    setHeld(false);
    const box = stage.current?.getBoundingClientRect();
    const action = releaseAction({
      x: event.clientX - (box?.left ?? 0),
      width: box?.width ?? 0,
      dx: event.clientX - down.x,
      dy: event.clientY - down.y,
      heldMs: down.held ? HOLD_MS : performance.now() - down.at
    });
    if (action) go(action);
  };
  const onPointerCancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setHeld(false);
  };

  const ms = SCENE_MS[id];
  const last = at === scenes.length - 1;
  const grainDark = useMemo(() => grainUrl(true), []);
  const grainLight = useMemo(() => grainUrl(false), []);
  const field = (scene: SceneId): CSSProperties => ({
    ["--f1" as string]: PALETTE[scene].field[0],
    ["--f2" as string]: PALETTE[scene].field[1],
    ["--grain" as string]: (PALETTE[scene].dark ? grainDark : grainLight) ? `url(${PALETTE[scene].dark ? grainDark : grainLight})` : "none"
  });
  const share = (
    <button type="button" className="ys-share-key ys-in" style={{ ["--d" as string]: "1500ms" }} data-ys-control onClick={() => setSharing(true)}>
      <Share2 size={18} aria-hidden />
      Share
    </button>
  );

  return (
    <div className="ys-root" role="dialog" aria-modal="true" aria-label={title} style={{ ["--ink" as string]: palette.ink, background: palette.field[1] }}>
      {/* The window's backdrop, in the scene's colours (it is the whole screen on a phone). */}
      <div className="ys-backdrop" aria-hidden="true">
        {leaving && <div key={`b${leaving.key}`} className="ys-field" style={field(leaving.id)} />}
        <div key={`b${at}-${visit}`} className={`ys-field ${leaving ? "is-entering" : ""}`} style={field(id)} />
      </div>
      <button type="button" className="ys-side is-back" aria-label="Back" title="Back (←)" disabled={at === 0} onClick={() => go("back")} data-ys-control>
        <ChevronLeft size={22} aria-hidden />
      </button>
      <div
        ref={stage}
        tabIndex={-1}
        className={`ys-stage ${paused ? "is-paused" : ""} ${still ? "is-still" : ""}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(event) => event.preventDefault()}
      >
        {leaving && (
          <div key={`l${leaving.key}`} className="ys-layer is-leaving" style={field(leaving.id)} aria-hidden="true">
            <div className="ys-field" />
          </div>
        )}
        <div key={`s${at}-${visit}`} className={`ys-layer ${leaving ? "is-entering" : ""}`} style={field(id)}>
          <div className="ys-field" />
          {(id === "opening" || id === "summary") && <Particles kind={id === "opening" ? "pages" : "confetti"} clock={clock} still={still} palette={palette} start={id === "opening" ? 700 : 200} />}
          <SceneView
            id={id}
            review={review}
            clock={clock}
            still={still}
            covers={covers}
            highlightAt={highlightAt}
            onSwapHighlight={() => setHighlightAt((value) => value + 1)}
            shareKey={
              id === "summary" ? (
                <div className="ys-summary-keys" data-ys-control>
                  {earlier !== undefined && onYear && (
                    <button type="button" className="ys-year-key ys-in" style={{ ["--d" as string]: "1600ms" }} onClick={() => onYear(earlier)} title={`${earlier}`}>
                      <ChevronLeft size={16} aria-hidden />
                      {earlier}
                    </button>
                  )}
                  {share}
                  {later !== undefined && onYear && (
                    <button type="button" className="ys-year-key ys-in" style={{ ["--d" as string]: "1600ms" }} onClick={() => onYear(later)} title={`${later}`}>
                      {later}
                      <ChevronRight size={16} aria-hidden />
                    </button>
                  )}
                </div>
              ) : undefined
            }
          />
        </div>

        <div className="ys-bars" aria-hidden="true">
          {scenes.map((scene, index) => (
            <span key={scene} className={`ys-bar ${index < at || (index === at && still) ? "is-done" : ""} ${index === at && !still ? "is-now" : ""}`}>
              <i
                key={index === at ? `${at}-${visit}` : scene}
                style={index === at ? ({ ["--ms" as string]: `${ms}ms` } as CSSProperties) : undefined}
                onAnimationEnd={index === at && !last ? () => go("next") : undefined}
              />
            </span>
          ))}
        </div>
        <p className="ys-sr" aria-live="polite">{`${at + 1} of ${scenes.length}`}</p>
        <div className="ys-keys" data-ys-control>
          {id !== "empty" && (
            <button type="button" className="ys-key" onClick={() => setSharing(true)} aria-label="Share this" title="Share this">
              <Share2 size={18} aria-hidden />
            </button>
          )}
          <button type="button" className="ys-key" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X size={20} aria-hidden />
          </button>
        </div>
        {sharing && <ShareSheet scene={id} review={review} covers={covers} highlightAt={highlightAt} onClose={() => setSharing(false)} />}
      </div>
      <button type="button" className="ys-side is-next" aria-label="Next" title="Next (→)" disabled={last} onClick={() => go("next")} data-ys-control>
        <ChevronRight size={22} aria-hidden />
      </button>
    </div>
  );
};
