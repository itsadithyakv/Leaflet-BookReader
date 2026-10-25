import { useState, type ReactNode } from "react";
import { ArrowRight, Info, X } from "lucide-react";
import type { Quirk } from "../../../../pip/base/quirks";
import { QUIRKS } from "../../../../pip/base/quirks";
import { Sprite } from "./Sprite";

/**
 * Scouting a stronghold (the Magpie Lands, 2026-10-24; raids-plan.md, section 2), free and before anything is spent:
 * the field shows it whole, its approaches and their hazards, the perches' reach, the hoards, the nest and the
 * champion. Beside it, this card: what it is, its quirk by name with an icon (what it does and what beats it behind
 * the (i)), and the three stars, the third the stronghold's feat. "Plan" goes on to the squad.
 */

/** Each quirk's picture: one of the field's own pieces. */
const QUIRK_ART: Readonly<Record<Quirk, { name: string; variant?: number; frame?: number }>> = {
  hedge: { name: "raidzone", variant: 0 },
  crow: { name: "raidperch", variant: 1 },
  ford: { name: "raidzone", variant: 3 },
  fog: { name: "landfog", variant: 1 },
  gate: { name: "raidwall", variant: 2 },
  pits: { name: "raidzone", variant: 2 }
};

export const QuirkIcon = ({ quirk, box = 22 }: { quirk: Quirk; box?: number }) => {
  const art = QUIRK_ART[quirk];
  return <Sprite name={art.name} variant={art.variant} frame={art.frame} box={box} />;
};

/** Three star pips, `count` of them won (the map's own, `pip-lands-stars`). */
export const StarPips = ({ count, earned, size = "card" }: { count?: number; earned?: readonly boolean[]; size?: "card" | "map" | "hud" }) => {
  const won = earned ?? [0, 1, 2].map((index) => index < (count ?? 0));
  return (
    <span className={`pip-lands-stars is-${size}`} role="img" aria-label={`${won.filter(Boolean).length} of 3 stars`}>
      {won.map((on, index) => (
        <i key={index} className={on ? "is-won" : ""} aria-hidden="true" />
      ))}
    </span>
  );
};

type Props = {
  name: string;
  sub: string;
  picture: ReactNode;
  quirk: Quirk | null;
  featWords: string;
  /** The stronghold's lord or champion, if one holds it. */
  champion: { name: string; variant: number } | null;
  /** A replay's best so far. */
  best: number | null;
  /** The King wants two. */
  need: number;
  onPlan: () => void;
  onClose: () => void;
};

export const RaidScout = ({ name, sub, picture, quirk, featWords, champion, best, need, onPlan, onClose }: Props) => {
  const [told, setTold] = useState(false);
  const info = quirk ? QUIRKS[quirk] : null;
  return (
    <section className="pip-raid-panel pip-raid-scout" aria-label={`Scouting ${name}`}>
      <button type="button" className="pip-raid-key pip-raid-panel-close" aria-label="Back to the map" title="Back to the map" onClick={onClose}>
        <X size={15} aria-hidden />
      </button>
      <header className="pip-lands-card-head">
        <span className="pip-lands-card-pic">{picture}</span>
        <span className="min-w-0 flex-1">
          <h3 className="pip-lands-card-name">{name}</h3>
          <span className="pip-lands-card-sub">{sub}</span>
        </span>
      </header>
      {info && quirk && (
        <div className="pip-raid-quirk">
          <span className="pip-base-chip pip-raid-quirk-chip">
            <QuirkIcon quirk={quirk} box={20} />
            {info.name}
          </span>
          <button type="button" className="pip-raid-key pip-raid-info" aria-label={`What ${info.name.toLowerCase()} does`} aria-expanded={told} title={`${info.does}. ${info.beats}.`} onClick={() => setTold((was) => !was)}>
            <Info size={13} aria-hidden />
          </button>
          {told && (
            <p className="pip-raid-quirk-told" role="note">
              {info.does}. <strong>{info.beats}.</strong>
            </p>
          )}
        </div>
      )}
      {champion && (
        <p className="pip-lands-card-sub pip-lands-lord">
          <Sprite name="champion" variant={champion.variant} box={20} />
          {champion.name}
        </p>
      )}
      <ol className="pip-raid-goals" aria-label={need > 1 ? "The stars: two to win" : "The stars"}>
        <li>
          <StarPips count={1} />
          <span>Take the nest</span>
        </li>
        <li>
          <StarPips count={2} />
          <span>Pull down most of it</span>
        </li>
        <li className="is-feat">
          <StarPips count={3} />
          <span>{featWords}</span>
        </li>
      </ol>
      {best !== null && (
        <p className="pip-lands-card-best">
          Best <StarPips count={best} />
        </p>
      )}
      <div className="pip-lands-keys">
        <button type="button" className="tactile-button tactile-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold" autoFocus onClick={onPlan}>
          Plan <ArrowRight size={13} aria-hidden />
        </button>
      </div>
    </section>
  );
};
