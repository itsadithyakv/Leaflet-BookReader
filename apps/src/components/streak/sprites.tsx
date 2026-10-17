import type { FlameState } from "./streakModel";

/**
 * The streak's pixel art, in Pip's style: a hard dark outline, flat colours,
 * drawn as SVG squares with crisp edges so it stays sharp at any size the
 * chip or the panel asks for (whole multiples of the art). The colours are
 * CSS variables (streak.css), so a flame is lit, embers or out by a class and
 * follows the light and dark themes without being redrawn. Nothing here
 * moves by itself: a small sprite never twitches.
 */

/** Each row of the art; a letter names its colour, "." is empty. */
const FLAME = [
  ".....o.....",
  "....oro....",
  "....orro...",
  "...orrro...",
  "...orrrro..",
  "..orrarrro.",
  ".oorraarro.",
  "orrraaarrro",
  "orraayaarro",
  "orraayyaaro",
  "orraayyaaro",
  ".oraayyaro.",
  "..oraaaro..",
  "...ooooo..."
];

const ICE = [
  ".ooooooo.",
  "owwiiiiio",
  "owiiiiiio",
  "oiiiiiiio",
  "oiiiiiijo",
  "oiiiiijjo",
  "oiiiijjjo",
  "ojjjjjjjo",
  ".ooooooo."
];

/** One path per colour: a square for each of its pixels. */
const paths = (art: string[]) => {
  const byColour = new Map<string, string>();
  art.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === ".") return;
      byColour.set(cell, `${byColour.get(cell) ?? ""}M${x} ${y}h1v1h-1z`);
    });
  });
  return [...byColour.entries()];
};

const FLAME_PATHS = paths(FLAME);
const ICE_PATHS = paths(ICE);

/** A whole multiple of the art's pixels, so every one is the same size. */
const sized = (art: string[], scale: number) => ({ width: art[0].length * scale, height: art.length * scale });

export const FlameSprite = ({ state, scale = 2, className = "" }: { state: FlameState; scale?: number; className?: string }) => (
  <svg
    className={`streak-flame streak-flame-${state} ${className}`}
    viewBox={`0 0 ${FLAME[0].length} ${FLAME.length}`}
    {...sized(FLAME, scale)}
    shapeRendering="crispEdges"
    aria-hidden="true"
  >
    {FLAME_PATHS.map(([colour, d]) => (
      <path key={colour} className={`streak-px-${colour}`} d={d} />
    ))}
    {/* Embers: three warm pixels left at the base of a flame not lit today. */}
    {(state === "embers" || state === "risk") && (
      <g className="streak-embers">
        <rect x="4" y="11" width="1" height="1" />
        <rect x="6" y="10" width="1" height="1" />
        <rect x="5" y="12" width="1" height="1" />
      </g>
    )}
  </svg>
);

export const IceCube = ({ scale = 2, className = "" }: { scale?: number; className?: string }) => (
  <svg
    className={`streak-ice ${className}`}
    viewBox={`0 0 ${ICE[0].length} ${ICE.length}`}
    {...sized(ICE, scale)}
    shapeRendering="crispEdges"
    aria-hidden="true"
  >
    {ICE_PATHS.map(([colour, d]) => (
      <path key={colour} className={`streak-px-${colour}`} d={d} />
    ))}
  </svg>
);
