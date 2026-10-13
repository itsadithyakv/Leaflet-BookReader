import type { KeyboardEvent, ReactNode } from "react";
import { AudioWaveform, CloudRain, Coffee, Droplets, Flame, MoonStar, TrainFront, Waves, Wind, type LucideIcon } from "lucide-react";
import { UiIcon } from "../components/UiIcon";
import { SCENES, SCENE_ORDER, type SceneId } from "./scenes";
import type { SceneOffer } from "./useSceneShop";

/**
 * The pieces the radio's two sets of controls are built from (the popover
 * in the readers, the panel in Pip's room): the scenes to choose from, a
 * switch, the volume. Each takes what it shows and says what was done; none
 * knows about sound.
 */

const SCENE_ICON: Record<SceneId, LucideIcon> = {
  rain: CloudRain,
  fire: Flame,
  cafe: Coffee,
  wind: Wind,
  waves: Waves,
  brown: AudioWaveform,
  crickets: MoonStar,
  stream: Droplets,
  train: TrainFront
};

type SceneChoicesProps = {
  scene: SceneId;
  /** The chosen scene is sounding (or will, when a book is open): it is lit, not only outlined. */
  lit: boolean;
  onChoose: (scene: SceneId) => void;
  label: string;
  /** Scenes still to be bought with seeds, and what each costs (unlock.ts). Left out, every scene can be chosen. */
  locked?: ReadonlyMap<SceneId, number>;
  /** A locked scene was selected: the reader is looking at it, to buy it or not. */
  onLocked?: (scene: SceneId) => void;
  /** The locked scene being looked at. */
  looking?: SceneId | null;
};

/**
 * The scenes, as a radio group: arrows move through them, choosing as they
 * go. A scene still to be bought is not one of the choices: it stands after
 * them as a key of its own, with its price in seeds, and selecting it only
 * asks about it (the arrows pass it by, since an arrow chooses).
 */
export const SceneChoices = ({ scene, lit, onChoose, label, locked, onLocked, looking }: SceneChoicesProps) => {
  const open = SCENE_ORDER.filter((id) => !locked?.has(id));
  const shut = SCENE_ORDER.filter((id) => locked?.has(id));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) {
      return;
    }
    // The reader's own arrows (a page, a chapter) are not for this.
    event.preventDefault();
    event.stopPropagation();
    const next = open[(Math.max(0, open.indexOf(scene)) + step + open.length) % open.length];
    onChoose(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-scene="${next}"]`)?.focus();
  };
  return (
    <div className="ambience-scenes">
      {/* The choices are the group; the grid lays its keys out with the locked ones after them. */}
      <div className="ambience-scenes-open" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {open.map((id) => {
          const Icon = SCENE_ICON[id];
          const on = scene === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (open.indexOf(scene) < 0 && id === open[0]) ? 0 : -1}
              data-scene={id}
              data-lit={on && lit}
              title={SCENES[id].hint}
              className="ambience-scene"
              onClick={() => onChoose(id)}
            >
              <Icon size={18} strokeWidth={2} aria-hidden="true" />
              <span>{SCENES[id].name}</span>
            </button>
          );
        })}
      </div>
      {shut.map((id) => {
        const Icon = SCENE_ICON[id];
        const price = locked?.get(id) ?? 0;
        return (
          <button
            key={id}
            type="button"
            data-scene={id}
            data-locked="true"
            aria-pressed={looking === id}
            aria-label={`${SCENES[id].name}: ${price} seeds`}
            title={SCENES[id].hint}
            className="ambience-scene"
            onClick={() => onLocked?.(id)}
          >
            <Icon size={18} strokeWidth={2} aria-hidden="true" />
            <span>{SCENES[id].name}</span>
            <span className="ambience-price">
              <UiIcon name="seed" size={11} />
              {price}
            </span>
          </button>
        );
      })}
    </div>
  );
};

type SceneOfferRowProps = {
  offer: SceneOffer;
  onBuy: () => void;
  onCancel: () => void;
};

/**
 * A locked sound, selected: its name, its price, and Buy (or how many more
 * seeds it takes). The question before a purchase, in one row; a refusal
 * from the shop is said under it.
 */
export const SceneOfferRow = ({ offer, onBuy, onCancel }: SceneOfferRowProps) => {
  const within = offer.ready && offer.short === 0;
  return (
    <div className="ambience-offer" role="group" aria-label={`${offer.name}, ${offer.price} seeds`}>
      <div className="ambience-row">
        <span className="ambience-offer-name min-w-0 flex-1">
          {offer.name}
          <span className="ambience-price">
            <UiIcon name="seed" size={11} />
            {offer.price}
          </span>
        </span>
        <button type="button" className="ambience-listen" data-kind="buy" disabled={!within || offer.buying} onClick={onBuy}>
          {offer.ready && offer.short > 0 ? `${offer.short} more` : "Buy"}
        </button>
        <button type="button" className="ambience-offer-close" onClick={onCancel} aria-label="Not now" title="Not now">
          <UiIcon name="close" size={12} />
        </button>
      </div>
      <p className="ambience-note" aria-live="polite">
        {offer.error ?? `${SCENES[offer.scene].hint}.`}
      </p>
    </div>
  );
};

type SwitchProps = {
  on: boolean;
  onChange: (on: boolean) => void;
  title: string;
  note?: ReactNode;
};

/** A switch with its name beside it, and a line under the name where one helps. */
export const AmbienceSwitch = ({ on, onChange, title, note }: SwitchProps) => (
  <button type="button" role="switch" aria-checked={on} aria-label={title} className="ambience-switch" onClick={() => onChange(!on)}>
    <span>
      <span className="ambience-switch-title">{title}</span>
      {note && <span className="ambience-note mt-0.5 block">{note}</span>}
    </span>
    <span className="ambience-toggle" aria-hidden="true" />
  </button>
);

type VolumeProps = {
  volume: number;
  onChange: (volume: number) => void;
};

/** The volume, 0 to 100. The browser's slider: arrows, Home and End work it. */
export const VolumeSlider = ({ volume, onChange }: VolumeProps) => {
  const percent = Math.round(volume * 100);
  return (
    <label className="ambience-volume">
      <span className="ambience-label">Volume</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-valuetext={`${percent}%`}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <output>{percent}%</output>
    </label>
  );
};
