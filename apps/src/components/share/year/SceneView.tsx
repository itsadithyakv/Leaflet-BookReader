import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { UiIcon } from "../../UiIcon";
import { subscribeTick } from "../../../pip/ticker";
import type { YearReview } from "../yearReview";
import type { SceneClock } from "./controls";
import {
  drawBars,
  drawCalendar,
  drawChapterRoad,
  drawDayArc,
  drawDeck,
  drawHourglass,
  drawRosette,
  drawShelf,
  drawStack,
  drawRestingPages,
  easeOut,
  pipFrame,
  within,
  type Box
} from "./draw";
import { PALETTE, sceneCopy, shownMonths, type SceneCopy, type SceneId } from "./scenes";

/**
 * One scene of the story on screen: its words arriving in staggered lines,
 * its figure counting up, its picture playing (`draw.ts`, the same drawing
 * as the picture to share), and Pip. Every scene has an entrance, a moment
 * and a held end; the held end is the elements' own resting style, and the
 * motion is CSS animations from where they start (`story.css`), so with
 * motion reduced (or `still`) the scene is simply its end.
 *
 * Motion is transforms and opacity only; the pictures draw on their own
 * canvas for the second or two they move, then stop.
 */

type Props = {
  id: SceneId;
  review: YearReview;
  clock: SceneClock;
  still: boolean;
  covers: Map<string, CanvasImageSource>;
  highlightAt: number;
  onSwapHighlight?: () => void;
  /** The summary's own share key. */
  shareKey?: ReactNode;
};

// When things happen in a scene, in ms from its start.
const AT = { eyebrow: 0, big: 120, unit: 300, count: 260, countFor: 1300, picture: 520, pictureFor: 2100, lines: 1500, pip: 380 };

const delay = (ms: number): CSSProperties => ({ ["--d" as string]: `${ms}ms` });

/** A title as large as the stage takes on one line: "2026" at its largest, "4 months" or "First weeks" smaller (a heavy figure is about 0.6 of its size wide). */
const titleSize = (text: string, largest: number): CSSProperties => ({ fontSize: `${Math.min(largest, 84 / (0.6 * Math.max(1, text.length)))}cqw` });

/** Words that arrive one after another. */
const Words = ({ text, from, step = 55, className }: { text: string; from: number; step?: number; className?: string }) => (
  <span className={className}>
    {text.split(/(\s+)/).map((part, at) =>
      /^\s+$/.test(part) ? (
        part
      ) : (
        <span key={at} className="ys-word ys-in" style={delay(from + Math.floor(at / 2) * step)}>
          {part}
        </span>
      )
    )}
  </span>
);

/** A number counting up from nothing with an ease-out, on the scene's clock (so a hold stops it). */
const CountUp = ({ to, clock, still, start = AT.count, length = AT.countFor, suffix = "" }: { to: number; clock: SceneClock; still: boolean; start?: number; length?: number; suffix?: string }) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const show = (value: number) => {
      node.textContent = `${Math.round(value).toLocaleString()}${suffix}`;
    };
    if (still || typeof requestAnimationFrame === "undefined") {
      show(to);
      return undefined;
    }
    let frame = 0;
    const step = () => {
      const t = within(clock.time(), start, start + length);
      show(to * easeOut(t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [to, clock, still, start, length, suffix]);
  // The end, as it is first drawn: what a screen reader and a still scene read.
  return (
    <span ref={ref} className="ys-count">
      {`${to.toLocaleString()}${suffix}`}
    </span>
  );
};

/**
 * A scene's picture on its own canvas: drawn as its motion goes from the
 * scene's clock, for as long as it moves, at the screen's own sharpness (two
 * device pixels a pixel at most: a phone's GPU has better things to do).
 */
const SceneCanvas = ({ draw, clock, still, start = AT.picture, length = AT.pictureFor }: { draw: (context: CanvasRenderingContext2D, box: Box, t: number) => void; clock: SceneClock; still: boolean; start?: number; length?: number }) => {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext("2d");
    if (!node || !context) return undefined;
    let frame = 0;
    let width = 0;
    let height = 0;
    const paint = (t: number) => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const box = node.getBoundingClientRect();
      if (box.width !== width || box.height !== height) {
        width = box.width;
        height = box.height;
        node.width = Math.max(1, Math.round(width * ratio));
        node.height = Math.max(1, Math.round(height * ratio));
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      drawRef.current(context, { x: 0, y: 0, width, height }, t);
    };
    const run = () => {
      const t = still ? 1 : within(clock.time(), start, start + length);
      paint(t);
      if (t < 1) frame = requestAnimationFrame(run);
    };
    run();
    // A new size (the window, the phone turned) is drawn again where the motion has got to.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => paint(still ? 1 : within(clock.time(), start, start + length))) : null;
    observer?.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [clock, still, start, length]);
  return <canvas ref={canvas} className="ys-canvas" aria-hidden="true" />;
};

/**
 * Pip on the story's own canvas, crisp: a whole number of device pixels for
 * each of hers, the size snapped down, never scaled by CSS in between. A
 * light rim keeps her clear of a dark field (as in the pictures to share).
 * She moves on the app's one 12 fps clock, and holds her pose when motion is
 * reduced.
 */
export const StoryPip = ({ move, skin, outfit, size, still, rim, className }: { move: string; skin?: string; outfit?: string[]; size: number; still: boolean; rim: string | null; className?: string }) => {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [scale, setScale] = useState(() => pipScale(size));
  useEffect(() => {
    const update = () => setScale(pipScale(size));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [size]);
  const outfitKey = (outfit ?? []).join("+");
  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext("2d");
    if (!node || !context) return undefined;
    const looks = outfitKey ? outfitKey.split("+") : [];
    const draw = (frame: number | "poster") => {
      try {
        const art = pipFrame(move, frame, skin, looks, rim);
        context.imageSmoothingEnabled = false;
        context.clearRect(0, 0, node.width, node.height);
        context.drawImage(art, 0, 0, node.width, node.height);
      } catch {
        // No picture of her here (a test, an old engine): the space stays.
      }
    };
    if (still) {
      draw("poster");
      return undefined;
    }
    let frame = 0;
    draw(0);
    return subscribeTick(() => draw(++frame));
  }, [move, skin, outfitKey, still, rim, scale.backing]);
  return (
    <canvas
      ref={canvas}
      width={scale.backing}
      height={scale.backing}
      className={`ys-pip-canvas ${className ?? ""}`}
      style={{ width: scale.css, height: scale.css, ["--pip-px" as string]: `${scale.css / 32}px` }}
      aria-hidden="true"
    />
  );
};

export const pipScale = (size: number) => {
  const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const perPixel = Math.max(1, Math.floor((size * ratio) / 32 + 1e-6));
  return { backing: perPixel * 32, css: (perPixel * 32) / ratio };
};

/** The width of the stage in CSS pixels, for Pip's size (the rest of the scene is in the stage's own units). */
const useStageWidth = (ref: React.RefObject<HTMLElement | null>) => {
  const [width, setWidth] = useState(390);
  useLayoutEffect(() => {
    const own = ref.current;
    const node = (typeof own?.closest === "function" ? own.closest(".ys-stage") : null) as HTMLElement | null;
    if (!node) return undefined;
    const update = () => setWidth(node.getBoundingClientRect().width || 390);
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [ref]);
  return width;
};

/** The big figure: a number counting up, or a name set in the serif. */
const Big = ({ copy, clock, still }: { copy: SceneCopy; clock: SceneClock; still: boolean }) => {
  if (copy.count !== undefined) {
    const suffix = copy.big.endsWith("%") ? "%" : "";
    return (
      <p className="ys-big ys-pop" style={delay(AT.big)}>
        <CountUp to={copy.count} clock={clock} still={still} suffix={suffix} />
      </p>
    );
  }
  const long = copy.big.length > 14;
  return (
    <p className={`ys-big is-name ${long ? "is-long" : ""}`}>
      <Words text={copy.big} from={AT.big} step={90} />
    </p>
  );
};

export const SceneView = ({ id, review, clock, still, covers, highlightAt, onSwapHighlight, shareKey }: Props) => {
  const copy = useMemo(() => sceneCopy(id, review, { highlightAt }), [id, review, highlightAt]);
  const palette = PALETTE[id];
  const root = useRef<HTMLDivElement | null>(null);
  const stage = useStageWidth(root);
  const rim = palette.dark ? "#fffbf0" : null;
  const big = id === "opening" || id === "kind" || id === "empty";
  const pipSize = stage * (big ? 0.5 : id === "summary" ? 0.26 : 0.22);
  const pip = copy.pip ? (
    <div className={`ys-pip ${big ? "is-big" : "is-small"} ys-hop`} style={{ ...delay(AT.pip), ["--pip-step" as string]: `${pipScale(pipSize).css / 32}px` }}>
      <StoryPip move={copy.pip.move} skin={copy.pip.skin} outfit={copy.pip.outfit} size={pipSize} still={still} rim={rim} />
    </div>
  ) : null;

  const picture = (draw: (context: CanvasRenderingContext2D, box: Box, t: number) => void, className = "") => (
    <div className={`ys-visual ${className}`}>
      <SceneCanvas draw={draw} clock={clock} still={still} />
    </div>
  );

  let body: ReactNode = null;
  switch (id) {
    case "opening":
    case "empty":
      body = (
        <>
          <p className="ys-eyebrow ys-in" style={delay(AT.eyebrow)}>
            {copy.eyebrow}
          </p>
          <p className="ys-big ys-title" style={titleSize(copy.big, 34)}>
            {copy.big.split("").map((letter, at) => (
              <span key={at} className={`ys-letter ys-drop${letter === " " ? " is-gap" : ""}`} style={delay(AT.big + at * 70)}>
                {letter === " " ? "" : letter}
              </span>
            ))}
          </p>
          <p className="ys-unit ys-in" style={delay(AT.unit + 260)}>
            {copy.unit}
          </p>
          <div className="ys-visual is-pip">
            {id === "opening" && <SceneCanvas draw={(context, box, t) => drawRestingPages(context, box, palette, 2026, t)} clock={clock} still={still} start={3600} length={1200} />}
            {pip}
          </div>
        </>
      );
      break;
    case "time":
      body = (
        <>
          <Head copy={copy} clock={clock} still={still} />
          {picture((context, box, t) => drawHourglass(context, { ...box, width: box.width * 0.62 }, t, palette), "is-left")}
        </>
      );
      break;
    case "days":
      body = (
        <>
          <Head copy={copy} clock={clock} still={still} />
          {picture((context, box, t) =>
            drawCalendar(context, box, { year: review.year, months: shownMonths(review), days: review.readDays, runFrom: review.longestRunFrom, runLength: review.longestRun }, t, palette)
          )}
        </>
      );
      break;
    case "books":
      body = (
        <>
          <Head copy={copy} clock={clock} still={still} />
          {picture((context, box, t) => drawShelf(context, box, copy.shelf ?? [], covers, t, palette))}
        </>
      );
      break;
    case "kind":
      body = (
        <>
          <Head copy={copy} clock={clock} still={still} />
          <div className="ys-visual is-pip">
            <SceneCanvas draw={(context, box, t) => drawRosette(context, box, t, palette)} clock={clock} still={still} start={200} length={1800} />
            {pip}
          </div>
        </>
      );
      break;
    case "faithful":
      body = (
        <>
          <Head copy={copy} clock={clock} still={still} />
          {picture((context, box, t) => drawStack(context, box, copy.stack ?? [], t, palette, copy.big))}
        </>
      );
      break;
    case "when":
      body = (
        <>
          <Head copy={copy} clock={clock} still={still} />
          {review.dayShare && picture((context, box, t) => drawDayArc(context, box, review.dayShare!, t, palette))}
        </>
      );
      break;
    case "month":
      body = (
        <>
          <Head copy={copy} clock={clock} still={still} />
          {picture((context, box, t) => drawBars(context, box, { months: shownMonths(review), byMonth: review.byMonth, busiest: review.busiestMonth }, t, palette))}
        </>
      );
      break;
    case "lines":
      body = (
        <>
          <p className="ys-eyebrow ys-in" style={delay(AT.eyebrow)}>
            {copy.eyebrow}
          </p>
          <div className="ys-lines-body">
          {copy.quote ? (
            <figure className="ys-quote" key={highlightAt}>
              <span className="ys-quote-mark ys-pop" style={delay(100)} aria-hidden="true">
                “
              </span>
              <blockquote className={copy.quote.text.length > 200 ? "is-long" : copy.quote.text.length > 110 ? "is-mid" : ""}>
                <Words text={copy.quote.text} from={260} step={copy.quote.text.length > 160 ? 18 : 34} />
              </blockquote>
              {copy.quote.by && (
                <figcaption className="ys-in" style={delay(1500)}>
                  {copy.quote.by}
                </figcaption>
              )}
              {copy.quote.note && (
                <p className="ys-note ys-in" style={delay(1700)}>
                  {copy.quote.note}
                </p>
              )}
              {review.highlightChoices.length > 1 && onSwapHighlight && (
                <button type="button" className="ys-swap ys-in" style={delay(1700)} data-ys-control onClick={onSwapHighlight} aria-label="Another line" title="Another line">
                  <UiIcon name="sync" size={16} />
                </button>
              )}
            </figure>
          ) : (
            <p className="ys-big is-name">
              <Words text={copy.big} from={AT.big} step={90} />
            </p>
          )}
          {copy.word && (
            <div className="ys-word-card ys-in" style={delay(copy.quote ? 2000 : 600)}>
              {copy.quote && <span className="ys-word-name">{copy.word.word}</span>}
              <span className="ys-word-why">{copy.word.why}</span>
              <span className="ys-word-meaning">{copy.word.meaning}</span>
            </div>
          )}
          </div>
        </>
      );
      break;
    case "hollow":
      body = (
        <>
          <Head copy={copy} clock={clock} still={still} />
          {review.hollow && picture((context, box, t) => drawChapterRoad(context, box, review.hollow!, t, palette))}
        </>
      );
      break;
    case "study":
      body = (
        <>
          <Head copy={copy} clock={clock} still={still} />
          {picture((context, box, t) => drawDeck(context, box, review.cardsMade, review.cardsLearnt, t, palette))}
        </>
      );
      break;
    case "summary":
      body = (
        <>
          <p className="ys-eyebrow ys-in" style={delay(0)}>
            {copy.eyebrow}
          </p>
          <p className="ys-big ys-title is-summary" style={titleSize(copy.big, 30)}>
            {copy.big.split("").map((letter, at) => (
              <span key={at} className={`ys-letter ys-drop${letter === " " ? " is-gap" : ""}`} style={delay(80 + at * 60)}>
                {letter === " " ? "" : letter}
              </span>
            ))}
          </p>
          <p className="ys-unit ys-in" style={delay(420)}>
            {copy.unit}
          </p>
          <dl className="ys-figures">
            {(copy.figures ?? []).map((figure, at) => {
              const number = Number(figure.value.replace(/[^\d]/g, ""));
              return (
                <div key={figure.label} className="ys-figure ys-in" style={delay(600 + at * 140)}>
                  <dt className="ys-figure-value">
                    {Number.isFinite(number) && figure.value.replace(/[\d,.\s]/g, "") === "" ? (
                      <CountUp to={number} clock={clock} still={still} start={700 + at * 140} length={1100} />
                    ) : (
                      figure.value
                    )}
                  </dt>
                  <dd className="ys-figure-label">{figure.label}</dd>
                </div>
              );
            })}
          </dl>
          {shareKey}
        </>
      );
      break;
  }

  const lines = id === "summary" || id === "lines" ? [] : copy.lines.filter(Boolean);
  const style = {
    ["--f1" as string]: palette.field[0],
    ["--f2" as string]: palette.field[1],
    ["--ink" as string]: palette.ink,
    ["--soft" as string]: palette.soft,
    ["--accent" as string]: palette.accent,
    ["--glow" as string]: palette.glow
  } as CSSProperties;

  return (
    <div ref={root} className={`ys-scene ys-${id} ${palette.dark ? "is-dark" : "is-light"} ${copy.pip && !big ? "has-pip" : ""}`} style={style}>
      <div className="ys-copy">
        {body}
        {lines.length > 0 && (
          <div className="ys-lines">
            {lines.map((line, at) => (
              <p key={at} className="ys-in" style={delay(AT.lines + at * 220)}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
      {!big && pip}
    </div>
  );
};

/** Most scenes begin alike: the eyebrow, the big figure, its unit. */
const Head = ({ copy, clock, still }: { copy: SceneCopy; clock: SceneClock; still: boolean }) => (
  <>
    <p className="ys-eyebrow ys-in" style={delay(AT.eyebrow)}>
      {copy.eyebrow}
    </p>
    <Big copy={copy} clock={clock} still={still} />
    {copy.unit && (
      <p className="ys-unit ys-in" style={delay(AT.unit)}>
        {copy.unit}
      </p>
    )}
  </>
);
