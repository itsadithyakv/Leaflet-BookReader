import { useShallow } from "zustand/react/shallow";
import { usePipStore } from "../store/pipStore";
import { usePipPresence } from "../pip/usePipPresence";
import { PipSprite } from "./PipSprite";

/**
 * The logo, and Pip's home. There is one Pip: when it is home it sits here as
 * the logo (asleep if nothing has been read today); when it is out in the app
 * this spot shows its outline. Selecting it calls Pip home or lets it out, and
 * a Pip thrown up into it goes home.
 */
export const PipHome = () => {
  const { mode, inside, leaving, setHome } = usePipStore(
    useShallow((state) => ({
      mode: state.mode,
      inside: state.inside,
      leaving: state.doorSwinging,
      setHome: state.setHome
    }))
  );
  const { asleep } = usePipPresence();

  // With Pip switched off, the logo is simply Pip, holding still.
  if (mode === "off") {
    return (
      <span className="leaflet-logo-pip">
        <PipSprite move="idle" size={44} snap="nearest" still label="Leaflet" />
      </span>
    );
  }

  const present = inside && !leaving;
  const move = present ? (asleep ? "sleep" : "idle") : "home-empty";
  const label = inside ? "Leaflet. Let Pip out" : "Leaflet. Call Pip home";

  return (
    <button type="button" className="leaflet-logo-pip pip-home" data-pip-home onClick={() => setHome(!inside)} aria-label={label} title={inside ? "Let Pip out" : "Call Pip home"}>
      <PipSprite move={move} size={44} snap="nearest" playKey={move} />
    </button>
  );
};
