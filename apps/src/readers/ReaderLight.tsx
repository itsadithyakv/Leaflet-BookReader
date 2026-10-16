import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { brightnessOutput, percent, warmOpacity, type LightKind } from "./readingLight";
import {
  enterReader,
  hasScreenBrightness,
  hideLightPill,
  holdLightPill,
  leaveReader,
  resetLight,
  setLight,
  startLevel,
  useReadingLight
} from "./readingLightStore";
import { DOUBLE_TAP_MS } from "./pageGestures";
import "./typePanel.css";
import "./readingLight.css";

/** How long the pill stays after the finger lifts, and how long it takes to fade. */
export const PILL_STAYS_MS = 1000;
const PILL_FADE_MS = 240;

/**
 * The reader's light over its page (readers/readingLight.ts): the warm wash,
 * the dark veil, and the pill that shows a level while it is set. Put inside
 * the reader's own box, last; while it is there the window's brightness is
 * the reader's, and when it goes the system's again.
 */
export const ReadingLight = () => {
  const brightness = useReadingLight((state) => state.brightness);
  const warmth = useReadingLight((state) => state.warmth);
  useEffect(() => {
    enterReader();
    return leaveReader;
  }, []);
  const veil = brightnessOutput(brightness, hasScreenBrightness()).veil;
  const warm = warmOpacity(warmth);
  return (
    <>
      {warm > 0 && <div className="reading-light-warm" style={{ opacity: warm }} aria-hidden="true" />}
      {veil > 0 && <div className="reading-light-veil" style={{ opacity: veil }} aria-hidden="true" />}
      <LightPill />
    </>
  );
};

const PillIcon = ({ kind }: { kind: LightKind }) =>
  kind === "brightness" ? <Sun size={16} strokeWidth={2} aria-hidden="true" /> : <Moon size={15} strokeWidth={2} aria-hidden="true" />;

/** The level being set; it fades a moment after the finger lifts. A double tap on it puts that light back. */
const LightPill = () => {
  const pill = useReadingLight((state) => state.pill);
  const held = useReadingLight((state) => state.pillHeld);
  const stamp = useReadingLight((state) => state.pillStamp);
  const brightness = useReadingLight((state) => state.brightness);
  const warmth = useReadingLight((state) => state.warmth);
  const [fading, setFading] = useState(false);
  const lastTapRef = useRef(0);
  useEffect(() => {
    setFading(false);
    if (!pill || held) {
      return undefined;
    }
    const fade = window.setTimeout(() => setFading(true), PILL_STAYS_MS);
    const gone = window.setTimeout(hideLightPill, PILL_STAYS_MS + PILL_FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, [pill, held, stamp]);
  if (!pill) {
    return null;
  }
  const level = pill === "brightness" ? brightness : warmth;
  const label = pill === "brightness" ? "Brightness" : "Warmth";
  const value = level === null ? "Auto" : percent(level);
  return (
    <button
      type="button"
      className={`reading-light-pill reader-panel reader-border ${fading ? "is-fading" : ""}`}
      aria-label={`${label} ${value}`}
      title={pill === "brightness" ? "Double-tap: follow system brightness" : "Double-tap: no warmth"}
      onPointerUp={() => {
        const now = performance.now();
        if (now - lastTapRef.current <= DOUBLE_TAP_MS + 120) {
          lastTapRef.current = 0;
          resetLight(pill);
        } else {
          lastTapRef.current = now;
          holdLightPill();
        }
      }}
    >
      <PillIcon kind={pill} />
      <span className="reading-light-pill-value">{value}</span>
    </button>
  );
};

/** Brightness and warmth as sliders, for Text settings (a mouse has no edge to swipe). */
export const ReadingLightRows = () => {
  const brightness = useReadingLight((state) => state.brightness);
  const warmth = useReadingLight((state) => state.warmth);
  // (While following the system, the slider sits where a swipe would start.)
  useReadingLight((state) => state.system);
  const shown = Math.round((brightness ?? startLevel("brightness")) * 100);
  return (
    <>
      <div className="reader-type-row">
        <span className="reader-type-label reader-muted" id="reader-light-brightness">
          Brightness
        </span>
        <div className="reading-light-control">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={shown}
            onChange={(event) => setLight("brightness", Number(event.target.value) / 100, { pill: false })}
            aria-labelledby="reader-light-brightness"
            aria-valuetext={brightness === null ? "Follows the system" : `${shown}%`}
            title={brightness === null ? "Follows the system" : `${shown}%`}
          />
          <button
            type="button"
            className={`reader-notes-tab reading-light-auto ${brightness === null ? "is-active" : ""}`}
            aria-pressed={brightness === null}
            onClick={() => resetLight("brightness", { pill: false })}
            title="Follow system brightness"
          >
            Auto
          </button>
        </div>
      </div>
      <div className="reader-type-row">
        <span className="reader-type-label reader-muted" id="reader-light-warmth">
          Warmth
        </span>
        <div className="reading-light-control">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(warmth * 100)}
            onChange={(event) => setLight("warmth", Number(event.target.value) / 100, { pill: false })}
            aria-labelledby="reader-light-warmth"
            title={`${Math.round(warmth * 100)}%`}
          />
          <span className="reading-light-auto" aria-hidden="true" />
        </div>
      </div>
    </>
  );
};
