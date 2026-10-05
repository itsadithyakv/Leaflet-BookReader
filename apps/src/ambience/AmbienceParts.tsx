import type { KeyboardEvent, ReactNode } from "react";
import { AudioWaveform, CloudRain, Coffee, Flame, Waves, Wind, type LucideIcon } from "lucide-react";
import { SCENES, SCENE_ORDER, type SceneId } from "./scenes";

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
  brown: AudioWaveform
};

type SceneChoicesProps = {
  scene: SceneId;
  /** The chosen scene is sounding (or will, when a book is open): it is lit, not only outlined. */
  lit: boolean;
  onChoose: (scene: SceneId) => void;
  label: string;
};

/** The scenes, as a radio group: arrows move through them, choosing as they go. */
export const SceneChoices = ({ scene, lit, onChoose, label }: SceneChoicesProps) => {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) {
      return;
    }
    // The reader's own arrows (a page, a chapter) are not for this.
    event.preventDefault();
    event.stopPropagation();
    const next = SCENE_ORDER[(SCENE_ORDER.indexOf(scene) + step + SCENE_ORDER.length) % SCENE_ORDER.length];
    onChoose(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-scene="${next}"]`)?.focus();
  };
  return (
    <div className="ambience-scenes" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {SCENE_ORDER.map((id) => {
        const Icon = SCENE_ICON[id];
        const on = scene === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
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
