import { useEffect, useRef, useState } from "react";
import { Check, Flag, Map as MapIcon, RotateCcw, Star } from "lucide-react";
import { FEATS, MISSED } from "../../../../pip/base/feats";
import { BLADES } from "../../../../pip/base/guards";
import { DECOR, type RaidEnd } from "../../../../pip/base/rules";
import { playSound } from "../../../../pip/sound";
import { CountUp } from "../../../community/CountUp";
import { currentTier } from "../../../../platform/perfTier";
import { Sprite } from "./Sprite";

/**
 * How a raid came out (the Magpie Lands, 2026-10-24; raids-plan.md, section 3), over the field it was fought on: the
 * stars landing one at a time, and for each the thing it was for, ticked, or for one missed the one line that says
 * why (`feats.ts` `MISSED`). Then what was carried home, flying up to the acorn count as the camp's acorns always do
 * (`collect.tsx`, through `onLoot`). "Try again" while there is rest for it; "Back to the map", where the stronghold's
 * stars are already filled in. A raid sent without the reader ends on the same card.
 */

const FIRST_STAR_MS = 450;
const NEXT_STAR_MS = 380;

const stillOnly = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches || currentTier() === "minimal";
  } catch {
    return currentTier() === "minimal";
  }
};

/** What each star was for, said as done. */
const DONE = ["Took the nest", "Pulled down most of it"];

/** Each star's line: done, or why it was missed (the result's keys, in the stars' order). */
export const starLines = (end: Pick<RaidEnd, "earned" | "feat" | "missed">): Array<{ won: boolean; text: string }> | null => {
  if (!end.earned || !end.feat) return null;
  const missed = [...(end.missed ?? [])];
  return end.earned.map((won, index) => (won ? { won, text: index < 2 ? DONE[index] : FEATS[end.feat!] } : { won, text: MISSED[missed.shift() ?? "nest"] }));
};

type Props = {
  end: RaidEnd;
  /** The raid was a friend's camp: no "Try again" (one raid a day each). */
  friend?: boolean;
  /** Fight it again (spending more rest); null when there is none, with why in `againWhy`. */
  onAgain: (() => void) | null;
  againWhy?: string | null;
  onMap: () => void;
  /** Where the loot flies home from, and how much: the camp sends it to the count. */
  onLoot: (from: Element, loot: number) => void;
};

export const RaidEndCard = ({ end, friend = false, onAgain, againWhy = null, onMap, onLoot }: Props) => {
  const still = stillOnly();
  const [landed, setLanded] = useState(still ? end.stars : 0);
  const [carried, setCarried] = useState(still ? end.loot : 0);
  const acornRef = useRef<HTMLSpanElement | null>(null);
  const lootRef = useRef(onLoot);
  lootRef.current = onLoot;
  const lines = starLines(end);

  useEffect(() => {
    playSound(end.won ? "fanfare" : "womp", { volume: 0.8 });
    const timers: number[] = [];
    const home = () => {
      setCarried(end.loot);
      if (end.loot > 0 && acornRef.current) lootRef.current(acornRef.current, end.loot);
    };
    if (still) {
      home();
      return;
    }
    for (let star = 1; star <= end.stars; star++) {
      timers.push(
        window.setTimeout(() => {
          setLanded(star);
          playSound("star", { pitch: 1 + 0.18 * (star - 1) });
        }, FIRST_STAR_MS + (star - 1) * NEXT_STAR_MS)
      );
    }
    timers.push(window.setTimeout(home, FIRST_STAR_MS + end.stars * NEXT_STAR_MS + 120));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // Once, for the raid it is the end of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end]);

  return (
    <section className={`pip-base-result pip-raid-end-card ${end.won ? "is-won" : "is-lost"}`} aria-label="How the raid went">
      <p className="pip-base-result-word">{end.banner ? "The King falls!" : end.won ? (friend ? "Raided!" : "Taken!") : "Beaten back"}</p>
      <p className="pip-base-result-stars" role="img" aria-label={`${end.stars} of 3 stars`}>
        {[1, 2, 3].map((star) => (
          <span key={star} className={`pip-base-result-star ${star <= landed ? "is-won" : ""}`}>
            <Star size={34} aria-hidden fill={star <= landed ? "currentColor" : "none"} />
          </span>
        ))}
      </p>
      {lines && (
        <ul className="pip-raid-lines">
          {lines.map((line, index) => (
            <li key={index} className={line.won ? "is-won" : "is-missed"}>
              {line.won ? <Check size={13} aria-hidden /> : <span className="pip-raid-lines-dot" aria-hidden="true" />}
              <span>{line.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="pip-base-result-loot">
        <span ref={acornRef} className="inline-flex">
          <Sprite name="acorn" box={20} />
        </span>
        <strong>
          +<CountUp value={carried} duration={650} />
        </strong>
        <span className="sr-only"> acorns carried home</span>
      </p>
      {end.banner && (
        <p className="pip-base-chip is-lit">
          <Flag size={13} aria-hidden /> The month's banner is yours
        </p>
      )}
      {end.blade !== null && (
        <p className="pip-base-chip is-lit" title={BLADES[end.blade].title}>
          <Sprite name="blade" variant={end.blade} box={18} /> {BLADES[end.blade].name} is the camp's
        </p>
      )}
      {end.home !== null && (
        <p className="pip-base-chip is-good">
          <Sprite name="decor" variant={end.home} box={18} /> The {DECOR[end.home].name.toLowerCase()} is home again
        </p>
      )}
      <div className="pip-raid-end-keys">
        {!friend && (
          <button type="button" className="tactile-button flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-60" disabled={!onAgain} title={onAgain ? "Plan it again: this spends a raid's rest" : (againWhy ?? undefined)} onClick={() => onAgain?.()}>
            <RotateCcw size={13} aria-hidden /> Try again
          </button>
        )}
        <button type="button" className="tactile-button tactile-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold" autoFocus onClick={onMap}>
          <MapIcon size={13} aria-hidden /> Back to the map
        </button>
      </div>
      <p className="sr-only" aria-live="polite">{`${end.won ? "Taken" : "Beaten back"}, ${end.stars} stars, ${end.loot} acorns.`}</p>
    </section>
  );
};
