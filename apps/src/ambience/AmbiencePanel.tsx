import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { ambience, useAmbienceState } from "./ambience";
import { AmbienceSwitch, SceneChoices, VolumeSlider } from "./AmbienceParts";
import { SCENES } from "./scenes";
import "./ambience.css";

type AmbiencePanelProps = {
  /** The card it is shown in closes itself (Close, Escape, a click elsewhere); the panel has no close of its own. */
  onClose?: () => void;
};

/**
 * The radio, opened from Pip's room: the same choices the readers have (the
 * scene, the volume, whether it plays while a book is open), and a way to
 * hear them here. It is a card's contents and nothing else: whoever opens it
 * gives it a frame, a title and a way to close (it fits a card 300 px wide).
 *
 * Listening lasts as long as the panel does. It starts by itself only when
 * the radio is already on for reading (opening a radio that is on lets you
 * hear it); otherwise the room stays quiet until a scene is picked or Listen
 * is pressed. Closing the card stops it.
 */
export const AmbiencePanel = (_props: AmbiencePanelProps) => {
  const view = useAmbienceState();
  // Asked once, as the panel opens: turning the switch later does not start or stop the listening.
  const [listening, setListening] = useState(() => ambience.prefs().on);

  useEffect(() => {
    if (!listening) {
      return;
    }
    ambience.startListening();
    return () => ambience.stopListening();
  }, [listening]);

  return (
    <div className="ambience ambience-panel ambience-stack" data-where="room">
      <SceneChoices
        scene={view.scene}
        lit={listening}
        label="What the radio plays"
        onChoose={(scene) => {
          ambience.chooseScene(scene);
          setListening(true);
        }}
      />

      <div className="ambience-row">
        <button
          type="button"
          className="ambience-listen"
          aria-pressed={listening}
          onClick={() => setListening((now) => !now)}
          title={listening ? "Stop listening here" : `Hear ${view.sceneName.toLowerCase()} here`}
        >
          {listening ? <Pause size={15} strokeWidth={2.4} aria-hidden="true" /> : <Play size={15} strokeWidth={2.4} aria-hidden="true" />}
          {listening ? "Stop" : "Listen"}
        </button>
        <p className="ambience-note min-w-0 flex-1" aria-live="polite">
          {listening && view.phase === "away" ? "Resting while Leaflet is out of sight." : `${SCENES[view.scene].hint}.`}
        </p>
      </div>

      <VolumeSlider volume={view.volume} onChange={ambience.setVolume} />

      <AmbienceSwitch on={view.on} onChange={ambience.setOn} title="Play this while I read" note="Starts when a book is open and stops when you leave it." />
      {view.scene === "rain" && <AmbienceSwitch on={view.thunder} onChange={ambience.setThunder} title="Thunder, far off" note="Now and then, a long way away." />}

      <p className="ambience-note">Made by Leaflet as it plays: nothing is downloaded. Pip's own little sounds have their own switch, in Settings.</p>
    </div>
  );
};
