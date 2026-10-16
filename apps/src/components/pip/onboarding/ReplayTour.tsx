import { RotateCcw } from "lucide-react";
import { useBaseStore } from "../../../store/baseStore";
import { welcome as api, welcomeOf } from "./welcomeApi";

/**
 * "Replay the tour", behind the Hollow's (i): Pip's first session again,
 * as a demo. Every step is a "next"; nothing is built, opened or given.
 * Only for a camp whose own tour is over.
 */
export const ReplayTour = ({ onStart }: { onStart?: () => void }) => {
  const done = useBaseStore((state) => welcomeOf(state.base)?.tutorial.done ?? false);
  if (!done) return null;
  return (
    <button
      type="button"
      className="tactile-button mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs"
      title="Pip shows you round the camp again. Nothing is built or given."
      onClick={() => {
        api.replay();
        onStart?.();
      }}
    >
      <RotateCcw size={13} aria-hidden /> Replay the tour
    </button>
  );
};
